DROP POLICY IF EXISTS "admin_config readable by all authenticated" ON public.admin_config;
CREATE POLICY "admin_config readable by super admin" ON public.admin_config
  FOR SELECT TO authenticated USING (super_admin_id = auth.uid());
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

DROP POLICY IF EXISTS "reviews are public read" ON public.reviews;
CREATE POLICY "reviews readable by signed-in users" ON public.reviews
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
REVOKE SELECT ON public.reviews FROM anon;