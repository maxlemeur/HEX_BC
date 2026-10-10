-- 20260812032857_govern_estimate_calc_engine_v2 retired these legacy creators from the
-- Data API but revoked only public, anon and authenticated. Supabase default privileges
-- granted EXECUTE on new public functions to service_role, so a service-role call could
-- still bypass the canonical v2 creation facade. Idempotent: revoking an absent grant
-- is a no-op.
revoke all on function public.instantiate_estimate_from_template(
  uuid, text, text, date, integer
) from service_role;

revoke all on function public.instantiate_estimate_template_into_project(
  uuid, uuid, text, date, integer
) from service_role;

revoke all on function public.create_affaire_from_import_lines(
  uuid, text, text, text, text, text, jsonb
) from service_role;

revoke all on function public.create_estimate_version_from_import_lines(
  uuid, uuid, text, text, jsonb
) from service_role;
