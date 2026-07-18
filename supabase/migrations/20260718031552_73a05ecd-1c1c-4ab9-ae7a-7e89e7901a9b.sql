
-- ============================================================================
-- TrustLaunch Phase 1 — schema, RLS, escrow engine
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('client', 'freelancer', 'admin');
CREATE TYPE public.kyc_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.project_status AS ENUM ('open', 'awarded', 'closed', 'cancelled');
CREATE TYPE public.proposal_status AS ENUM ('submitted', 'accepted', 'rejected', 'withdrawn');
CREATE TYPE public.contract_status AS ENUM (
  'pending_funding','funded_locked','work_submitted',
  'approved_released','disputed','refunded','cancelled'
);
CREATE TYPE public.escrow_state AS ENUM ('Pending','Locked','Released','Refunded','Disputed');
CREATE TYPE public.ledger_kind AS ENUM (
  'deposit','escrow_lock','escrow_release','escrow_refund','platform_fee'
);
CREATE TYPE public.notification_type AS ENUM (
  'new_proposal','escrow_deposit_confirmed','revision_requested',
  'payment_released','contract_funded','dispute_opened',
  'dispute_resolved','kyc_status_changed'
);

-- ---------------------------------------------------------------------------
-- admin_config: single-row table holding the Super-Admin UUID
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  super_admin_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- placeholder; the real UUID is inserted via migration once user provides it
INSERT INTO public.admin_config (id, super_admin_id) VALUES (1, NULL);

GRANT SELECT ON public.admin_config TO authenticated;
GRANT ALL ON public.admin_config TO service_role;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_config readable by all authenticated" ON public.admin_config
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- prevent admin role from ever being inserted at runtime
CREATE OR REPLACE FUNCTION public.forbid_admin_role_write()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    RAISE EXCEPTION 'admin role cannot be assigned at runtime';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_forbid_admin_role
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.forbid_admin_role_write();

-- ---------------------------------------------------------------------------
-- has_role: admin ↔ admin_config.super_admin_id, else user_roles lookup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _role = 'admin' THEN
      EXISTS (SELECT 1 FROM public.admin_config WHERE id = 1 AND super_admin_id = _user_id)
    ELSE
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  END
$$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, anon;

-- profiles policies
CREATE POLICY "profiles self read"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles admin read"  ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- user_roles policies
CREATE POLICY "roles self read"   ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "roles self insert" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND role <> 'admin');
CREATE POLICY "roles self delete" ON public.user_roles FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "roles admin read"  ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- Auto-create profile + wallet on signup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.wallets (user_id, available_cents, locked_cents)
  VALUES (NEW.id, 100000, 0) -- seed $1000 for demo
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- kyc_submissions
-- ---------------------------------------------------------------------------
CREATE TABLE public.kyc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id_document_path TEXT NOT NULL,
  selfie_path TEXT NOT NULL,
  status public.kyc_status NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  notes TEXT
);
CREATE INDEX idx_kyc_user ON public.kyc_submissions(user_id);
GRANT SELECT, INSERT ON public.kyc_submissions TO authenticated;
GRANT ALL ON public.kyc_submissions TO service_role;
ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kyc self read"   ON public.kyc_submissions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "kyc self insert" ON public.kyc_submissions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "kyc admin read"  ON public.kyc_submissions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "kyc admin update" ON public.kyc_submissions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- wallets, ledger, platform_wallet
-- ---------------------------------------------------------------------------
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available_cents BIGINT NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  locked_cents BIGINT NOT NULL DEFAULT 0 CHECK (locked_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet self read" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta_cents BIGINT NOT NULL,
  kind public.ledger_kind NOT NULL,
  related_contract_id UUID,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_user ON public.wallet_ledger(user_id, created_at DESC);
GRANT SELECT ON public.wallet_ledger TO authenticated;
GRANT ALL ON public.wallet_ledger TO service_role;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger self read" ON public.wallet_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ledger admin read" ON public.wallet_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.platform_wallet (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  collected_fees_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.platform_wallet (id) VALUES (1);
GRANT SELECT ON public.platform_wallet TO authenticated;
GRANT ALL ON public.platform_wallet TO service_role;
ALTER TABLE public.platform_wallet ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform wallet admin read" ON public.platform_wallet FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  budget_cents BIGINT NOT NULL CHECK (budget_cents > 0),
  deadline DATE,
  status public.project_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_status ON public.projects(status, created_at DESC);
GRANT SELECT ON public.projects TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects public read open" ON public.projects FOR SELECT TO anon, authenticated USING (status = 'open');
CREATE POLICY "projects owner read"       ON public.projects FOR SELECT TO authenticated USING (auth.uid() = client_id);
CREATE POLICY "projects owner insert"     ON public.projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = client_id);
CREATE POLICY "projects owner update"     ON public.projects FOR UPDATE TO authenticated USING (auth.uid() = client_id);
CREATE POLICY "projects admin read"       ON public.projects FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------
CREATE TABLE public.proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  freelancer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cover_letter TEXT NOT NULL CHECK (char_length(cover_letter) BETWEEN 10 AND 3000),
  bid_cents BIGINT NOT NULL CHECK (bid_cents > 0),
  estimated_days INT NOT NULL CHECK (estimated_days BETWEEN 1 AND 365),
  status public.proposal_status NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, freelancer_id)
);
CREATE INDEX idx_proposals_project ON public.proposals(project_id);
CREATE INDEX idx_proposals_freelancer ON public.proposals(freelancer_id);
GRANT SELECT, INSERT, UPDATE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals freelancer read" ON public.proposals FOR SELECT TO authenticated USING (auth.uid() = freelancer_id);
CREATE POLICY "proposals freelancer insert" ON public.proposals FOR INSERT TO authenticated WITH CHECK (auth.uid() = freelancer_id);
CREATE POLICY "proposals freelancer update" ON public.proposals FOR UPDATE TO authenticated USING (auth.uid() = freelancer_id);
CREATE POLICY "proposals client read"     ON public.proposals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.client_id = auth.uid()));
CREATE POLICY "proposals admin read" ON public.proposals FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------
CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id),
  proposal_id UUID NOT NULL REFERENCES public.proposals(id),
  client_id UUID NOT NULL REFERENCES auth.users(id),
  freelancer_id UUID NOT NULL REFERENCES auth.users(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_bps INT NOT NULL DEFAULT 500 CHECK (fee_bps BETWEEN 0 AND 10000),
  status public.contract_status NOT NULL DEFAULT 'pending_funding',
  auto_release_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  disputed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_contracts_client ON public.contracts(client_id);
CREATE INDEX idx_contracts_freelancer ON public.contracts(freelancer_id);
CREATE INDEX idx_contracts_auto_release ON public.contracts(auto_release_at) WHERE status = 'work_submitted';
GRANT SELECT ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts party read" ON public.contracts FOR SELECT TO authenticated
  USING (auth.uid() = client_id OR auth.uid() = freelancer_id);
CREATE POLICY "contracts admin read" ON public.contracts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- escrow_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE public.escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  state public.escrow_state NOT NULL,
  amount_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL DEFAULT 0,
  actor_id UUID REFERENCES auth.users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_escrow_contract ON public.escrow_transactions(contract_id, created_at DESC);
GRANT SELECT ON public.escrow_transactions TO authenticated;
GRANT ALL ON public.escrow_transactions TO service_role;
ALTER TABLE public.escrow_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escrow party read" ON public.escrow_transactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = contract_id
    AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())));
CREATE POLICY "escrow admin read" ON public.escrow_transactions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  related_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif self read" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif self update" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ---------------------------------------------------------------------------
-- Storage RLS for kyc-documents bucket
-- ---------------------------------------------------------------------------
CREATE POLICY "kyc storage self upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "kyc storage self read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "kyc storage admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-documents' AND public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- ESCROW ENGINE — SECURITY DEFINER RPCs
-- ============================================================================

-- helper: require KYC approved for a user
CREATE OR REPLACE FUNCTION public.require_kyc_approved(_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_submissions
    WHERE user_id = _user_id AND status = 'approved'
    ORDER BY submitted_at DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION 'KYC_REQUIRED';
  END IF;
END;
$$;

-- fund_contract: client deposits amount into escrow lock
CREATE OR REPLACE FUNCTION public.fund_contract(_contract_id UUID)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.contracts;
  w public.wallets;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.client_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.status <> 'pending_funding' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.require_kyc_approved(c.client_id);

  SELECT * INTO w FROM public.wallets WHERE user_id = c.client_id FOR UPDATE;
  IF w.available_cents < c.amount_cents THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  UPDATE public.wallets SET
    available_cents = available_cents - c.amount_cents,
    locked_cents    = locked_cents + c.amount_cents,
    updated_at = now()
  WHERE user_id = c.client_id;

  INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, related_contract_id, memo)
  VALUES (c.client_id, -c.amount_cents, 'escrow_lock', c.id, 'Funds locked in escrow');

  UPDATE public.contracts SET status = 'funded_locked' WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, actor_id, reason)
  VALUES (c.id, 'Locked', c.amount_cents, auth.uid(), 'Client funded contract');

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES
    (c.client_id, 'escrow_deposit_confirmed', 'Funds secured in escrow',
      'Your payment is safely locked until you approve the work.', c.id),
    (c.freelancer_id, 'contract_funded', 'Contract funded — you can start work',
      'The client has locked the funds in escrow. You can now begin the project.', c.id);

  RETURN c;
END;
$$;

-- submit_work: freelancer marks work delivered; starts 3-day auto-release timer
CREATE OR REPLACE FUNCTION public.submit_work(_contract_id UUID)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.contracts;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.freelancer_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.status <> 'funded_locked' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.contracts SET
    status = 'work_submitted',
    submitted_at = now(),
    auto_release_at = now() + INTERVAL '3 days'
  WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (c.client_id, 'revision_requested',
    'Work submitted for review',
    'Please review the delivered work. Funds auto-release in 3 days if no action is taken.',
    c.id);

  RETURN c;
END;
$$;

-- internal release helper (used by both manual approve and auto-release)
CREATE OR REPLACE FUNCTION public._release_contract(_contract_id UUID, _actor UUID, _reason TEXT)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.contracts;
  fee BIGINT;
  payout BIGINT;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF c.status NOT IN ('work_submitted','disputed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  fee := (c.amount_cents * c.fee_bps) / 10000;
  payout := c.amount_cents - fee;

  -- client: release locked funds
  UPDATE public.wallets SET
    locked_cents = locked_cents - c.amount_cents,
    updated_at = now()
  WHERE user_id = c.client_id;

  -- freelancer: receive payout
  UPDATE public.wallets SET
    available_cents = available_cents + payout,
    updated_at = now()
  WHERE user_id = c.freelancer_id;

  -- platform: collect fee
  UPDATE public.platform_wallet SET
    collected_fees_cents = collected_fees_cents + fee,
    updated_at = now()
  WHERE id = 1;

  INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, related_contract_id, memo) VALUES
    (c.freelancer_id, payout, 'escrow_release', c.id, 'Escrow released (95% payout)'),
    (c.client_id, 0, 'platform_fee', c.id, 'Platform fee 5% deducted');

  UPDATE public.contracts SET
    status = 'approved_released',
    approved_at = COALESCE(approved_at, now()),
    resolved_at = COALESCE(resolved_at, now())
  WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, fee_cents, actor_id, reason)
  VALUES (c.id, 'Released', c.amount_cents, fee, _actor, _reason);

  INSERT INTO public.notifications (user_id, type, title, body, related_id) VALUES
    (c.freelancer_id, 'payment_released', 'Payment released',
      'Your payment (net of 5% platform fee) is now in your wallet.', c.id),
    (c.client_id, 'payment_released', 'Payment released to freelancer',
      COALESCE(_reason, 'Escrow released.'), c.id);

  RETURN c;
END;
$$;

-- approve_work: client manually releases
CREATE OR REPLACE FUNCTION public.approve_work(_contract_id UUID)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.contracts;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.client_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.status <> 'work_submitted' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  RETURN public._release_contract(_contract_id, auth.uid(), 'Client approved work');
END;
$$;

-- open_dispute: client disputes work; goes to admin
CREATE OR REPLACE FUNCTION public.open_dispute(_contract_id UUID, _reason TEXT)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.contracts;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.client_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.status <> 'work_submitted' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.contracts SET status = 'disputed', disputed_at = now() WHERE id = c.id RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, actor_id, reason)
  VALUES (c.id, 'Disputed', c.amount_cents, auth.uid(), _reason);

  INSERT INTO public.notifications (user_id, type, title, body, related_id) VALUES
    (c.freelancer_id, 'dispute_opened', 'Dispute opened on your contract',
      COALESCE(_reason, 'Client has requested review by admin.'), c.id),
    (c.client_id, 'dispute_opened', 'Dispute submitted',
      'Our team will review and resolve shortly.', c.id);

  RETURN c;
END;
$$;

-- admin_resolve_dispute: admin releases or refunds
CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(_contract_id UUID, _release BOOLEAN, _reason TEXT)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.contracts;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT * INTO c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF c.status <> 'disputed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  IF _release THEN
    RETURN public._release_contract(_contract_id, auth.uid(), COALESCE(_reason,'Admin ruled in favor of freelancer'));
  END IF;

  -- refund path
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
$$;

-- run_auto_releases: called by cron; releases any work_submitted past auto_release_at
CREATE OR REPLACE FUNCTION public.run_auto_releases()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT id FROM public.contracts
           WHERE status = 'work_submitted' AND auto_release_at <= now()
  LOOP
    PERFORM public._release_contract(r.id, NULL, 'Auto-released after 3-day window');
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- accept_proposal: creates contract in pending_funding
CREATE OR REPLACE FUNCTION public.accept_proposal(_proposal_id UUID)
RETURNS public.contracts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.proposals;
  pr public.projects;
  c public.contracts;
BEGIN
  SELECT * INTO p FROM public.proposals WHERE id = _proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROPOSAL_NOT_FOUND'; END IF;
  SELECT * INTO pr FROM public.projects WHERE id = p.project_id FOR UPDATE;
  IF pr.client_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF pr.status <> 'open' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p.status <> 'submitted' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.require_kyc_approved(pr.client_id);
  PERFORM public.require_kyc_approved(p.freelancer_id);

  UPDATE public.proposals SET status = 'accepted' WHERE id = p.id;
  UPDATE public.proposals SET status = 'rejected' WHERE project_id = pr.id AND id <> p.id AND status = 'submitted';
  UPDATE public.projects SET status = 'awarded' WHERE id = pr.id;

  INSERT INTO public.contracts (project_id, proposal_id, client_id, freelancer_id, amount_cents)
  VALUES (pr.id, p.id, pr.client_id, p.freelancer_id, p.bid_cents)
  RETURNING * INTO c;

  INSERT INTO public.escrow_transactions (contract_id, state, amount_cents, actor_id, reason)
  VALUES (c.id, 'Pending', c.amount_cents, auth.uid(), 'Contract created — awaiting funding');

  INSERT INTO public.notifications (user_id, type, title, body, related_id) VALUES
    (p.freelancer_id, 'new_proposal', 'Your proposal was accepted!',
      'The client will fund escrow shortly.', c.id);

  RETURN c;
END;
$$;

-- request_revision: notification only, no state change
CREATE OR REPLACE FUNCTION public.request_revision(_contract_id UUID, _note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.contracts;
BEGIN
  SELECT * INTO c FROM public.contracts WHERE id = _contract_id;
  IF c.client_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.status <> 'work_submitted' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (c.freelancer_id, 'revision_requested', 'Revision requested', _note, c.id);
END;
$$;

-- admin_review_kyc
CREATE OR REPLACE FUNCTION public.admin_review_kyc(_kyc_id UUID, _approve BOOLEAN, _notes TEXT)
RETURNS public.kyc_submissions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.kyc_submissions;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.kyc_submissions SET
    status = CASE WHEN _approve THEN 'approved'::public.kyc_status ELSE 'rejected'::public.kyc_status END,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    notes = _notes
  WHERE id = _kyc_id RETURNING * INTO k;
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (k.user_id, 'kyc_status_changed',
    CASE WHEN _approve THEN 'KYC approved' ELSE 'KYC rejected' END,
    COALESCE(_notes, ''), k.id);
  RETURN k;
END;
$$;

-- grant execute on RPCs
GRANT EXECUTE ON FUNCTION public.fund_contract(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_work(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_work(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_dispute(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_proposal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_revision(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_kyc(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_auto_releases() TO service_role;

-- enable pg_cron + pg_net (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- schedule auto-release every 15 minutes (uses direct RPC — no external HTTP)
SELECT cron.schedule(
  'trustlaunch-auto-release',
  '*/15 * * * *',
  $$ SELECT public.run_auto_releases(); $$
);
