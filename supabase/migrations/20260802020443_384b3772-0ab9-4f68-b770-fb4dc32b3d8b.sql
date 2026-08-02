
CREATE OR REPLACE FUNCTION public.support_context()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schema_json JSONB;
  fee_bps NUMERIC;
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

  -- Current configured fee = the default on contracts.fee_bps (single source of truth).
  SELECT NULLIF(regexp_replace(column_default, '[^0-9]', '', 'g'), '')::numeric
    INTO fee_bps
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = 'fee_bps';

  fee_bps := COALESCE(fee_bps, 700);

  SELECT jsonb_build_object(
    'open_projects', (SELECT count(*) FROM public.projects WHERE status = 'open'),
    'active_contracts', (SELECT count(*) FROM public.contracts WHERE status IN ('funded_locked','work_submitted')),
    'open_disputes', (SELECT count(*) FROM public.dispute_tickets WHERE status = 'open')
  ) INTO stats;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'platform_fee_percent', round(fee_bps / 100, 2),
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
