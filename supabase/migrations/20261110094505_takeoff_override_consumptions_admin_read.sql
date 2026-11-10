-- TI-686 D10 (lot 2, M5). No remote application is authorized here.
-- The pilot metrics publish, per rule, the false positives an administrator declared when forcing lines into an
-- estimate (H19). Only a consumed override forced anything, so the metrics route reads the consumptions with the
-- signed-in administrator's client (H11): an administrator of the tenant reads its consumptions, read-only.
-- - public.takeoff_apply_override_consumptions (20260713132407_harden_takeoff_apply_and_storage.sql): row level
--   security stays enabled and forced; authenticated gains SELECT only, filtered by the policy below (the same test as
--   « Admins can view audit logs », which already lets them read the override audits). No write is granted: the apply
--   trigger (enforce_takeoff_apply_security, security definer) remains the only writer, and a deleted consumption would
--   make its override consumable again.
-- - anon gains nothing; service_role keeps its privileges.
begin;

grant select on table public.takeoff_apply_override_consumptions to authenticated;

create policy "Admins can view override consumptions"
  on public.takeoff_apply_override_consumptions
  for select
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

commit;
