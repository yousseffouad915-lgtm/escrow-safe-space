CREATE OR REPLACE FUNCTION public.request_withdrawal(_method public.withdrawal_method, _destination text, _amount_cents bigint)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE w public.wallets; r public.withdrawal_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF _destination IS NULL OR length(trim(_destination)) = 0 THEN RAISE EXCEPTION 'DESTINATION_REQUIRED'; END IF;

  SELECT * INTO w FROM public.wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR w.available_cents < _amount_cents THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  UPDATE public.wallets SET available_cents = available_cents - _amount_cents, updated_at = now()
    WHERE user_id = auth.uid();

  INSERT INTO public.withdrawal_requests (user_id, method, destination, amount_cents)
    VALUES (auth.uid(), _method, trim(_destination), _amount_cents) RETURNING * INTO r;

  INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, memo)
    VALUES (auth.uid(), -_amount_cents, 'withdrawal', 'Withdrawal requested (' || _method::text || ')');

  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(_withdrawal_id uuid, _approve boolean, _notes text)
RETURNS public.withdrawal_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.withdrawal_requests;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM public.withdrawal_requests WHERE id = _withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.withdrawal_requests SET
    status = CASE WHEN _approve THEN 'paid'::public.withdrawal_status ELSE 'rejected'::public.withdrawal_status END,
    reviewed_by = auth.uid(), reviewed_at = now(), notes = _notes
  WHERE id = _withdrawal_id RETURNING * INTO r;

  IF NOT _approve THEN
    UPDATE public.wallets SET available_cents = available_cents + r.amount_cents, updated_at = now()
      WHERE user_id = r.user_id;
    INSERT INTO public.wallet_ledger (user_id, delta_cents, kind, memo)
      VALUES (r.user_id, r.amount_cents, 'withdrawal_refund', 'Withdrawal rejected — amount returned');
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  VALUES (r.user_id, 'withdrawal_reviewed',
    CASE WHEN _approve THEN 'Withdrawal paid' ELSE 'Withdrawal rejected' END,
    COALESCE(_notes, ''), r.id);

  RETURN r;
END;
$$;
