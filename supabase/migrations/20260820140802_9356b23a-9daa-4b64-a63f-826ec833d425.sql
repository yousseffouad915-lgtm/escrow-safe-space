REVOKE EXECUTE ON FUNCTION public.request_withdrawal(public.withdrawal_method, text, bigint) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_review_withdrawal(uuid, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(public.withdrawal_method, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_withdrawal(uuid, boolean, text) TO authenticated;