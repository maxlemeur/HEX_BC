-- Reads the risk alerts of one takeoff job and estimate version with their select policy checked once per statement,
-- not once per alert.
--
-- Observed (TesterArmy CI, 21/11/2026, V3E20 on main and on pull requests; an owned native stack with the same journey):
-- a second call of the risk radar of a large estimate (2 937 alerts) answered 400 « Impossible de charger la projection
-- existante du radar de risque. » with 57014. Its read of the existing alerts was the only statement running, on the CPU
-- without any lock wait, until the 8 s statement_timeout of the API roles. The select policy "Current tenant can select
-- estimate risk alerts" runs an EXISTS over takeoff_jobs and estimate_versions for each alert, with the select policy of
-- takeoff_jobs (private.can_access_takeoff_scope, since 20261120204437) and two can_access_takeoff_estimate_version calls
-- nested in it: 0.22 ms per alert locally, twice per page for its exact count. One page of 1 000 took 1 299 ms locally
-- (the same 1 248 ms for the active alerts the DPGF comparison reads), and seconds more in CI. Its correlated conditions
-- leave Postgres no way to hash it whatever its statistics.
--
-- public.read_takeoff_risk_alerts(tenant, version, job): security definer, stable, called by the API roles (auth.uid()
-- still names the caller). It returns the alerts of that job for that version of that tenant, as the select policy
-- would show them:
-- - authenticated: only when the caller passes, once, what the select policy of estimate_risk_alerts requires through
--   the select policies of takeoff_jobs, estimate_versions (and estimate_projects in it) and takeoff_version_links it
--   reads: the tenant is the caller's current one; the job belongs to it and the caller reads it (its scope, or its send
--   receipt); the caller reads the version; the version is the job's own or one a link of the job targets from the job's
--   version; the caller can access both versions as a takeoff (owner of the affaire or admin). The alert's project must
--   be the version's. Otherwise no row.
-- - service_role: every alert of the job and version, as the role bypasses RLS on the table. The function runs as its
--   owner, so it reads the role PostgREST set for the request from the role setting, as 20261024130000 does.
-- Its rows are those of the table; PostgREST filters, orders, counts and paginates them like the table's.
-- supabase/tests/database/takeoff-risk-alerts-read.test.sql compares it with the policy for every role and pins the
-- policies it restates. No table, policy, index or existing function changes: creating a function locks no table.
begin;

set local lock_timeout = '5s';

create function public.read_takeoff_risk_alerts(p_tenant_id uuid, p_version_id uuid, p_job_id uuid)
returns setof public.estimate_risk_alerts
language sql
stable
security definer
set search_path = ''
as $$
  select alert.*
  from public.estimate_risk_alerts alert
  where alert.tenant_id = p_tenant_id
    and alert.version_id = p_version_id
    and alert.takeoff_job_id = p_job_id
    and (
      (select pg_catalog.current_setting('role', true)) = 'service_role'
      -- One row at most (the job and the version by their keys): the project of the version when the caller passes.
      or alert.project_id = (
        select target.project_id
        from public.takeoff_jobs job
        join public.estimate_versions target on target.id = p_version_id
        where job.id = p_job_id
          and job.tenant_id = p_tenant_id
          and p_tenant_id = (select public.current_tenant_id())
          -- The select policy of takeoff_jobs.
          and (
            (select private.can_access_takeoff_scope(job.tenant_id, job.project_id, job.estimate_version_id, false))
            or (select private.can_read_sent_takeoff_job(job.tenant_id, job.project_id, job.id))
          )
          -- The select policies of estimate_versions, through those of estimate_projects.
          and exists (
            select 1
            from public.estimate_projects project
            where project.id = target.project_id
              and project.tenant_id = target.tenant_id
              and (select public.is_tenant_member(project.tenant_id))
              and (
                project.user_id = (select auth.uid())
                or (select public.has_tenant_role(project.tenant_id, array['admin', 'director']::public.tenant_role[]))
              )
          )
          and (
            job.estimate_version_id = p_version_id
            -- The select policy of takeoff_version_links: its job is `job`, whose tenant and policy are checked here.
            or exists (
              select 1
              from public.takeoff_version_links link
              where link.tenant_id = p_tenant_id
                and link.target_version_id = p_version_id
                and link.takeoff_job_id = p_job_id
                and link.source_version_id = job.estimate_version_id
                and (select public.can_access_takeoff_estimate_version(link.source_version_id, link.tenant_id))
                and (select public.can_access_takeoff_estimate_version(link.target_version_id, link.tenant_id))
            )
          )
          and (select public.can_access_takeoff_estimate_version(p_version_id, p_tenant_id))
          and (select public.can_access_takeoff_estimate_version(job.estimate_version_id, p_tenant_id))
      )
    );
$$;

comment on function public.read_takeoff_risk_alerts(uuid, uuid, uuid) is
  'Risk alerts of one takeoff job and estimate version, with the select policy of estimate_risk_alerts checked once per statement instead of per alert. supabase/migrations/20261121160259_read_takeoff_risk_alerts.sql.';

revoke all on function public.read_takeoff_risk_alerts(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_takeoff_risk_alerts(uuid, uuid, uuid) to authenticated, service_role;

commit;
