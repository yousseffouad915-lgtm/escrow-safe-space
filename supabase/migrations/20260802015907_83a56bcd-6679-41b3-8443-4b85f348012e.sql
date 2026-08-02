
-- 1) KYC extensions
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'national_id',
  ADD COLUMN IF NOT EXISTS back_document_path TEXT,
  ADD COLUMN IF NOT EXISTS auto_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capture_meta JSONB;

CREATE OR REPLACE FUNCTION public.submit_kyc_auto(
  _document_type TEXT,
  _front_path TEXT,
  _back_path TEXT,
  _selfie_path TEXT,
  _meta JSONB DEFAULT NULL
) RETURNS public.kyc_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.kyc_submissions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _document_type NOT IN ('national_id','passport') THEN RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE'; END IF;
  IF _front_path IS NULL OR length(_front_path) = 0 THEN RAISE EXCEPTION 'MISSING_FRONT'; END IF;
  IF _selfie_path IS NULL OR length(_selfie_path) = 0 THEN RAISE EXCEPTION 'MISSING_SELFIE'; END IF;
  IF _document_type = 'national_id' AND (_back_path IS NULL OR length(_back_path) = 0) THEN
    RAISE EXCEPTION 'MISSING_BACK';
  END IF;

  INSERT INTO public.kyc_submissions (
    user_id, id_document_path, back_document_path, selfie_path,
    document_type, status, auto_verified, reviewed_at, capture_meta, notes
  ) VALUES (
    auth.uid(), _front_path, _back_path, _selfie_path,
    _document_type, 'approved', true, now(), _meta,
    'Auto-approved by automated document check'
  ) RETURNING * INTO k;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (auth.uid(), 'kyc_status_changed', 'Identity verified',
          'Your document passed the automated check and your identity is verified.', k.id);

  RETURN k;
END;
$$;

-- 2) Auto-approved wallet top-ups
CREATE OR REPLACE FUNCTION public.create_deposit_auto(
  _method public.deposit_method,
  _amount_cents BIGINT,
  _reference TEXT,
  _receipt_path TEXT
) RETURNS public.deposit_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deposit_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _method IN ('vodafone_cash','instapay') AND (_receipt_path IS NULL OR length(_receipt_path) = 0) THEN
    RAISE EXCEPTION 'RECEIPT_REQUIRED';
  END IF;

  INSERT INTO public.deposit_requests (user_id, method, amount_cents, reference, receipt_path, status, reviewed_at, notes)
  VALUES (auth.uid(), _method, _amount_cents, _reference, _receipt_path, 'approved', now(),
          'Auto-approved by automated verification')
  RETURNING * INTO d;

  INSERT INTO public.wallets (user_id, available_cents, locked_cents)
  VALUES (auth.uid(), _amount_cents, 0)
  ON CONFLICT (user_id) DO UPDATE SET
    available_cents = public.wallets.available_cents + EXCLUDED.available_cents,
    updated_at = now();

  INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, memo)
  VALUES (auth.uid(), _amount_cents, 'deposit', 'Wallet top-up auto-approved (' || _method::text || ')');

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (auth.uid(), 'deposit_reviewed', 'Top-up approved', 'Your wallet has been credited.', d.id);

  RETURN d;
END;
$$;

-- 3) Dispute review tickets
CREATE TABLE IF NOT EXISTS public.dispute_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL,
  client_id UUID NOT NULL,
  freelancer_id UUID NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dispute_tickets TO authenticated;
GRANT ALL ON public.dispute_tickets TO service_role;

ALTER TABLE public.dispute_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dispute tickets admin read" ON public.dispute_tickets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "dispute tickets party read" ON public.dispute_tickets
  FOR SELECT TO authenticated USING (auth.uid() = client_id OR auth.uid() = freelancer_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS update_dispute_tickets_updated_at ON public.dispute_tickets;
CREATE TRIGGER update_dispute_tickets_updated_at
  BEFORE UPDATE ON public.dispute_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- open_dispute now also creates a manual review ticket for the admin
CREATE OR REPLACE FUNCTION public.open_dispute(_contract_id uuid, _reason text)
 RETURNS contracts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.contracts;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.client_id <> auth.uid() AND c.freelancer_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.status <> 'work_submitted' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.contracts SET status = 'disputed', disputed_at = now() WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, actor_id, reason)
  VALUES (c.id, 'Disputed', c.amount_cents, auth.uid(), _reason);

  INSERT INTO public.dispute_tickets (contract_id, opened_by, client_id, freelancer_id, reason)
  VALUES (c.id, auth.uid(), c.client_id, c.freelancer_id, COALESCE(_reason, 'No reason provided'));

  INSERT INTO public.notifications (user_id, type, title, body, related_id) VALUES
    (c.freelancer_id, 'dispute_opened', 'Dispute opened on your contract',
      COALESCE(_reason, 'Client has requested review by admin.'), c.id),
    (c.client_id, 'dispute_opened', 'Dispute submitted',
      'Our team will review and resolve shortly.', c.id);

  RETURN c;
END;
$function$;

-- close tickets when the admin resolves the dispute
CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(_contract_id uuid, _release boolean, _reason text)
 RETURNS contracts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.contracts;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.status <> 'disputed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.dispute_tickets
    SET status = 'resolved', resolved_at = now(), resolution_note = _reason
    WHERE contract_id = _contract_id AND status = 'open';

  IF _release THEN
    RETURN public._release_contract(_contract_id, auth.uid(), COALESCE(_reason,'Admin ruled in favor of freelancer'));
  END IF;

  UPDATE public.wallets SET
    locked_cents = locked_cents - c.amount_cents,
    available_cents = available_cents + c.amount_cents,
    updated_at = now()
  WHERE user_id = c.client_id;

  INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, related_contract_id, memo)
  VALUES (c.client_id, c.amount_cents, 'escrow_refund', c.id, 'Escrow refunded by admin');

  UPDATE public.contracts SET status = 'refunded', resolved_at = now() WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, actor_id, reason)
  VALUES (c.id, 'Refunded', c.amount_cents, auth.uid(), COALESCE(_reason,'Admin refunded to client'));

  INSERT INTO public.notifications (user_id, type, title, body, related_id) VALUES
    (c.client_id, 'dispute_resolved', 'Refund issued', 'Your funds have been returned to your wallet.', c.id),
    (c.freelancer_id, 'dispute_resolved', 'Contract refunded', 'Admin ruled in favor of the client.', c.id);

  RETURN c;
END;
$function$;
