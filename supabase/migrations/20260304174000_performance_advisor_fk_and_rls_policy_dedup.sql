-- Resolve remaining Supabase performance advisor findings:
-- 1) add missing covering indexes for foreign keys
-- 2) merge/split overlapping permissive RLS policies to avoid duplicate checks

create index if not exists takeoff_mapping_rules_created_by_idx
  on public.takeoff_mapping_rules (created_by);

create index if not exists takeoff_run_metrics_result_id_idx
  on public.takeoff_run_metrics (result_id);

-- audit_logs: consolidate two overlapping permissive INSERT policies into one.
drop policy if exists "Authenticated can insert takeoff audit logs" on public.audit_logs;
drop policy if exists "Server can insert invariant violation audit logs" on public.audit_logs;
drop policy if exists "Authenticated can insert scoped audit logs" on public.audit_logs;

create policy "Authenticated can insert scoped audit logs"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    (
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
    )
    or (
      action = 'invariant_violation'
      and user_id = (select auth.uid())
      and table_name in ('estimate_versions', 'estimate_items')
      and estimate_version_id is not null
      and exists (
        select 1
        from public.estimate_versions ev
        join public.estimate_projects ep
          on ep.id = ev.project_id
         and ep.tenant_id = ev.tenant_id
        where ev.id = audit_logs.estimate_version_id
          and ev.tenant_id = audit_logs.tenant_id
          and (select public.is_tenant_member(ev.tenant_id))
          and (
            ep.user_id = (select auth.uid())
            or (select public.has_tenant_role(ev.tenant_id, array['admin'::public.tenant_role]))
          )
      )
      and (
        (table_name = 'estimate_versions' and record_id = estimate_version_id)
        or (
          table_name = 'estimate_items'
          and exists (
            select 1
            from public.estimate_items ei
            where ei.id = audit_logs.record_id
              and ei.version_id = audit_logs.estimate_version_id
              and ei.tenant_id = audit_logs.tenant_id
          )
        )
      )
    )
  );

-- takeoff_mapping_rules: keep tenant-member SELECT and split admin ALL into INSERT/UPDATE/DELETE.
drop policy if exists "Current tenant can manage takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant members can view takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant admins can manage takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant admins can insert takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant admins can update takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant admins can delete takeoff mapping rules" on public.takeoff_mapping_rules;

create policy "Current tenant members can view takeoff mapping rules"
  on public.takeoff_mapping_rules
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
  );

create policy "Current tenant admins can insert takeoff mapping rules"
  on public.takeoff_mapping_rules
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );

create policy "Current tenant admins can update takeoff mapping rules"
  on public.takeoff_mapping_rules
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );

create policy "Current tenant admins can delete takeoff mapping rules"
  on public.takeoff_mapping_rules
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );
