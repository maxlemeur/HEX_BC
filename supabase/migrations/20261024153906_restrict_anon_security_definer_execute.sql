-- Supabase advisor 0028 lists these SECURITY DEFINER functions of public: they kept
-- the default EXECUTE of PUBLIC and anon, or the anon grant of the schema's default
-- privileges, so an unauthenticated request could call them through /rest/v1/rpc as
-- their owner. No Data API caller is anonymous. With a null auth.uid(),
-- cleanup_expired_draft_locks deleted the expired locks of every tenant.
-- Drop PUBLIC and anon only. authenticated keeps its explicit grant, used by the RLS
-- policies, the app and the triggers on the tables it writes; service_role keeps its
-- default grant. Idempotent: revoking an absent grant is a no-op.

-- RLS helpers and signed-in RPCs.
revoke execute on function public.can_access_affaire_intake_project(uuid, uuid) from public, anon;
revoke execute on function public.can_access_takeoff_estimate_version(uuid, uuid) from public, anon;
revoke execute on function public.can_access_takeoff_project(uuid, uuid) from public, anon;
revoke execute on function public.can_bootstrap_tenant_membership(
  uuid, uuid, public.tenant_role
) from public, anon;
revoke execute on function public.can_read_affaire_intake_project(uuid, uuid) from public, anon;
revoke execute on function public.cleanup_expired_draft_locks(uuid) from public, anon;
revoke execute on function public.current_tenant_id() from public, anon;
revoke execute on function public.has_tenant_role(uuid, public.tenant_role[]) from public, anon;
revoke execute on function public.is_tenant_member(uuid) from public, anon;
revoke execute on function public.log_estimate_batch_audit(uuid, jsonb) from public, anon;

-- Trigger functions.
revoke execute on function public.bootstrap_takeoff_feature_flags() from public, anon;
revoke execute on function public.guard_estimate_review_comments_insert() from public, anon;
revoke execute on function public.guard_estimate_review_correction_items_insert() from public, anon;
revoke execute on function public.guard_estimate_review_correction_items_update() from public, anon;
revoke execute on function public.guard_estimate_review_cycles_insert() from public, anon;
revoke execute on function public.log_estimate_audit() from public, anon;
