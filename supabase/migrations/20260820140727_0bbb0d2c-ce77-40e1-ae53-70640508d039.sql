ALTER TYPE public.ledger_kind ADD VALUE IF NOT EXISTS 'withdrawal';
ALTER TYPE public.ledger_kind ADD VALUE IF NOT EXISTS 'withdrawal_refund';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'withdrawal_reviewed';
DO $$ BEGIN
  CREATE TYPE public.withdrawal_status AS ENUM ('pending','paid','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.withdrawal_method AS ENUM ('vodafone_cash','instapay','bank');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method public.withdrawal_method NOT NULL,
  destination text NOT NULL,
  amount_cents bigint NOT NULL,
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.withdrawal_requests TO authenticated;
GRANT ALL ON public.withdrawal_requests TO service_role;

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "withdrawals self read" ON public.withdrawal_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "withdrawals admin read" ON public.withdrawal_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER update_withdrawal_requests_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
