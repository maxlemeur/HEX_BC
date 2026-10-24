-- Reads the items of one estimate version with its select policy checked once per statement, not once per item.
--
-- Observed (TesterArmy CI, 24/10/2026, and an owned native stack with the same planner statistics): the select
-- policy "Users can view estimate items" depends only on the item's tenant_id and version_id, so every item of a
-- version is visible or none is. With statistics that know the version, Postgres hashes the policy's EXISTS once per
-- statement: 10 ms locally (38 ms in CI) for a page of 500 of 2 501 items. When its statistics predate a large
-- version (a fresh stack, a first autoanalyze of small estimates), it estimates one item for the version and runs the
-- policy for each item instead, with the policies of estimate_versions and estimate_projects nested in it: about four
-- is_tenant_member/has_tenant_role calls per item, 130-235 ms per page locally and seconds in CI. Four concurrent pages
-- of one read then crossed the 8 s statement_timeout of the API roles (57014) in PG1000 (GET /api/estimates/:id),
-- V3E20 (risk radar), IO13 (section copy) and the affaire hub line count.
--
-- public.read_estimate_version_items(tenant, version): security definer, stable, called by the API roles (auth.uid()
-- still names the caller). It returns the items of that version of that tenant, as the select policy would show them:
-- - authenticated: only when the caller passes, once, what the select policy of estimate_items requires through the
--   select policies of estimate_versions and estimate_projects it reads: the version belongs to the tenant, its affaire
--   to the same tenant, the caller is a member of that active tenant (or the platform admin, as is_tenant_member and
--   has_tenant_role allow) and owns the affaire or holds the admin or director role. Otherwise no row.
-- - service_role: every item, as the role bypasses RLS on the table. The function runs as its owner, so it reads the
--   role PostgREST set for the request from the role setting, as 20261020004336 does.
-- Its rows are those of the table; PostgREST filters, orders, counts and paginates them like the table's.
-- supabase/tests/database/estimate-version-items-read.test.sql compares it with the policy for every role and pins the
-- policies it restates. No policy, trigger or existing function changes.
begin;

create function public.read_estimate_version_items(p_tenant_id uuid, p_version_id uuid)
returns setof public.estimate_items
language sql
stable
security definer
set search_path = ''
as $$
  select item.*
  from public.estimate_items item
  where item.tenant_id = p_tenant_id
    and item.version_id = p_version_id
    and (
      (select pg_catalog.current_setting('role', true)) = 'service_role'
      or (select exists (
        select 1
        from public.estimate_versions version
        join public.estimate_projects project
          on project.id = version.project_id and project.tenant_id = version.tenant_id
        where version.id = p_version_id
          and version.tenant_id = p_tenant_id
          and (select public.is_tenant_member(p_tenant_id))
          and (
            project.user_id = (select auth.uid())
            or (select public.has_tenant_role(p_tenant_id, array['admin', 'director']::public.tenant_role[]))
          )
      ))
    );
$$;

comment on function public.read_estimate_version_items(uuid, uuid) is
  'Items of one estimate version, with the select policy of estimate_items checked once per statement instead of per item. supabase/migrations/20261024130000_read_estimate_version_items.sql.';

revoke all on function public.read_estimate_version_items(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_estimate_version_items(uuid, uuid) to authenticated, service_role;

commit;
