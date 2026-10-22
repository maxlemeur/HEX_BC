-- The takeoff apply guard trusts audit evidence, including override events.
-- Authenticated Data API clients must not be able to mint that evidence.
-- Keep the existing narrow invariant-violation audit path for estimates.
drop policy if exists "Authenticated can insert scoped audit logs" on public.audit_logs;

create policy "Authenticated can insert invariant violation audit logs"
  on public.audit_logs
  for insert
  to authenticated
  with check (
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
  );
