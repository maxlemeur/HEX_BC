-- TKF-015: authorize authenticated takeoff audit inserts under strict tenant/job constraints.

drop policy if exists "Authenticated can insert takeoff audit logs" on public.audit_logs;

create policy "Authenticated can insert takeoff audit logs"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    action like 'takeoff.%'
    and user_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
    and table_name in ('takeoff_jobs', 'takeoff_items')
    and estimate_version_id is not null
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.tenant_id = audit_logs.tenant_id
        and tj.estimate_version_id = audit_logs.estimate_version_id
        and (
          (audit_logs.table_name = 'takeoff_jobs' and tj.id = audit_logs.record_id)
          or (
            audit_logs.table_name = 'takeoff_items'
            and exists (
              select 1
              from public.takeoff_items ti
              where ti.id = audit_logs.record_id
                and ti.job_id = tj.id
                and ti.tenant_id = audit_logs.tenant_id
            )
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );
