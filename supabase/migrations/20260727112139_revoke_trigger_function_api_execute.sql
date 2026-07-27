-- Trigger functions are internal implementation details. Managed Supabase
-- projects can grant EXECUTE directly to API roles through default privileges,
-- so revoking only PUBLIC does not remove those explicit grants.

revoke execute on function public.assign_portal_tokens_tenant_id()
  from public, anon, authenticated, service_role;

revoke execute on function public.enforce_estimate_document_canonical_path()
  from public, anon, authenticated, service_role;

revoke execute on function public.enforce_plan_set_resource_budget()
  from public, anon, authenticated, service_role;

revoke execute on function public.enforce_takeoff_apply_security()
  from public, anon, authenticated, service_role;

revoke execute on function public.enforce_takeoff_item_mutation_before_apply()
  from public, anon, authenticated, service_role;
