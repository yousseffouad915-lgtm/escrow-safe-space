
-- 1) Fee: 5% → 7%
ALTER TABLE public.contracts ALTER COLUMN fee_bps SET DEFAULT 700;
UPDATE public.contracts SET fee_bps = 700
  WHERE status IN ('pending_funding','funded_locked','work_submitted','disputed');

-- 2) Wallet defaults: 0. Reset existing balances.
ALTER TABLE public.wallets ALTER COLUMN available_cents SET DEFAULT 0;
UPDATE public.wallets SET available_cents = 0, updated_at = now();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.wallets (user_id, available_cents, locked_cents)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3) Route platform fees to the super-admin's wallet as well.
CREATE OR REPLACE FUNCTION public._release_contract(_contract_id uuid, _actor uuid, _reason text)
RETURNS contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.contracts;
  fee BIGINT;
  payout BIGINT;
  admin_uid uuid;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF c.status NOT IN ('work_submitted','disputed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  fee := (c.amount_cents * c.fee_bps) / 10000;
  payout := c.amount_cents - fee;

  UPDATE public.wallets SET locked_cents = locked_cents - c.amount_cents, updated_at = now()
    WHERE user_id = c.client_id;
  UPDATE public.wallets SET available_cents = available_cents + payout, updated_at = now()
    WHERE user_id = c.freelancer_id;

  UPDATE public.platform_wallet SET collected_fees_cents = collected_fees_cents + fee, updated_at = now()
    WHERE id = 1;

  -- Credit super-admin's internal wallet with the platform fee.
  SELECT super_admin_id INTO admin_uid FROM public.admin_config WHERE id = 1;
  IF admin_uid IS NOT NULL THEN
    INSERT INTO public.wallets (user_id, available_cents, locked_cents)
      VALUES (admin_uid, fee, 0)
      ON CONFLICT (user_id) DO UPDATE SET
        available_cents = public.wallets.available_cents + EXCLUDED.available_cents,
        updated_at = now();
    INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, related_contract_id, memo)
      VALUES (admin_uid, fee, 'platform_fee', c.id, 'Platform fee 7% credited to admin wallet');
  END IF;

  INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, related_contract_id, memo) VALUES
    (c.freelancer_id, payout, 'escrow_release', c.id, 'Escrow released (93% payout after 7% fee)'),
    (c.client_id, 0, 'platform_fee', c.id, 'Platform fee 7% deducted');

  UPDATE public.contracts SET
    status = 'approved_released',
    approved_at = COALESCE(approved_at, now()),
    resolved_at = COALESCE(resolved_at, now())
  WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, fee_cents, actor_id, reason)
    VALUES (c.id, 'Released', c.amount_cents, fee, _actor, _reason);

  INSERT INTO public.notifications (user_id, type, title, body, related_id) VALUES
    (c.freelancer_id, 'payment_released', 'Payment released',
      'Your payment (net of 7% platform fee) is now in your wallet.', c.id),
    (c.client_id, 'payment_released', 'Payment released to freelancer',
      COALESCE(_reason, 'Escrow released.'), c.id);

  RETURN c;
END;
$$;

-- 4) Notification type for deposit reviews (safe if already exists).
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'deposit_reviewed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'work_delivered';

-- 5) Deposit requests (wallet top-ups)
DO $$ BEGIN
  CREATE TYPE public.deposit_method AS ENUM ('vodafone_cash','instapay','reference','card');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.deposit_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  method public.deposit_method not null,
  amount_cents bigint not null check (amount_cents > 0),
  reference text,
  receipt_path text,
  status public.deposit_status not null default 'pending',
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT ON public.deposit_requests TO authenticated;
GRANT ALL ON public.deposit_requests TO service_role;

ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deposit_requests_select" ON public.deposit_requests;
CREATE POLICY "deposit_requests_select" ON public.deposit_requests FOR SELECT
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "deposit_requests_insert" ON public.deposit_requests;
CREATE POLICY "deposit_requests_insert" ON public.deposit_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Admin approve/reject deposit
CREATE OR REPLACE FUNCTION public.admin_review_deposit(_deposit_id uuid, _approve boolean, _notes text)
RETURNS deposit_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deposit_requests;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO d FROM public.deposit_requests WHERE id = _deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.deposit_requests SET
    status = CASE WHEN _approve THEN 'approved'::public.deposit_status ELSE 'rejected'::public.deposit_status END,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    notes = _notes
  WHERE id = _deposit_id RETURNING * INTO d;

  IF _approve THEN
    INSERT INTO public.wallets (user_id, available_cents, locked_cents)
      VALUES (d.user_id, d.amount_cents, 0)
      ON CONFLICT (user_id) DO UPDATE SET
        available_cents = public.wallets.available_cents + EXCLUDED.available_cents,
        updated_at = now();
    INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, memo)
      VALUES (d.user_id, d.amount_cents, 'deposit',
        'Wallet top-up approved (' || d.method::text || ')');
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (d.user_id, 'deposit_reviewed',
    CASE WHEN _approve THEN 'Top-up approved' ELSE 'Top-up rejected' END,
    COALESCE(_notes, ''), d.id);

  RETURN d;
END;
$$;

-- 6) Deliverables table
CREATE TABLE IF NOT EXISTS public.contract_deliverables (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint not null default 0,
  mime_type text,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS contract_deliverables_contract_idx ON public.contract_deliverables(contract_id);

GRANT SELECT, INSERT ON public.contract_deliverables TO authenticated;
GRANT ALL ON public.contract_deliverables TO service_role;
ALTER TABLE public.contract_deliverables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deliverables_select" ON public.contract_deliverables;
CREATE POLICY "deliverables_select" ON public.contract_deliverables FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_id AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "deliverables_insert" ON public.contract_deliverables;
CREATE POLICY "deliverables_insert" ON public.contract_deliverables FOR INSERT
  WITH CHECK (
    uploader_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_id AND c.freelancer_id = auth.uid()
    )
  );

-- 7) Storage policies for the two private buckets
-- deposit-receipts: users manage their own folder; admin reads all.
DROP POLICY IF EXISTS "deposit_receipts_own_read" ON storage.objects;
CREATE POLICY "deposit_receipts_own_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'deposit-receipts'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin'))
  );
DROP POLICY IF EXISTS "deposit_receipts_own_write" ON storage.objects;
CREATE POLICY "deposit_receipts_own_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deposit-receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- deliverables: uploader (freelancer) writes to their own folder; contract parties + admin read.
DROP POLICY IF EXISTS "deliverables_read" ON storage.objects;
CREATE POLICY "deliverables_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'deliverables'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.contract_deliverables d
        JOIN public.contracts c ON c.id = d.contract_id
        WHERE d.file_path = storage.objects.name
          AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
      )
    )
  );
DROP POLICY IF EXISTS "deliverables_write" ON storage.objects;
CREATE POLICY "deliverables_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deliverables'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
