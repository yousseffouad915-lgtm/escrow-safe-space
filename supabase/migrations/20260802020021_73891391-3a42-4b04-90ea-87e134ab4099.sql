
CREATE OR REPLACE FUNCTION public.support_context()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schema_json JSONB;
  fee_bps INT;
  stats JSONB;
BEGIN
  SELECT jsonb_object_agg(t.table_name, t.cols) INTO schema_json
  FROM (
    SELECT c.table_name, jsonb_agg(c.column_name ORDER BY c.ordinal_position) AS cols
    FROM information_schema.columns c
    JOIN information_schema.tables tt
      ON tt.table_schema = c.table_schema AND tt.table_name = c.table_name AND tt.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
    GROUP BY c.table_name
  ) t;

  SELECT COALESCE((SELECT contracts.fee_bps FROM public.contracts ORDER BY created_at DESC LIMIT 1), 700)
    INTO fee_bps;

  SELECT jsonb_build_object(
    'open_projects', (SELECT count(*) FROM public.projects WHERE status = 'open'),
    'active_contracts', (SELECT count(*) FROM public.contracts WHERE status IN ('funded_locked','work_submitted')),
    'open_disputes', (SELECT count(*) FROM public.dispute_tickets WHERE status = 'open')
  ) INTO stats;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'platform_fee_percent', round(fee_bps::numeric / 100, 2),
    'auto_release_days', 3,
    'kyc', jsonb_build_object('document_types', jsonb_build_array('national_id','passport'), 'automated', true),
    'deposits_automated', true,
    'disputes_manual_only', true,
    'schema', schema_json,
    'stats', stats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.support_context() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_context() TO service_role;
