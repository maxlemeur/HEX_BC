-- V3-017: keep approval decision journal reads fast on audit screens.

create index if not exists estimate_version_events_approval_decision_lookup_idx
  on public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    created_by,
    occurred_at desc
  )
  where event_type = 'approval_decided';

create index if not exists estimate_version_events_approval_decision_status_idx
  on public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    ((metadata ->> 'decision')),
    occurred_at desc
  )
  where event_type = 'approval_decided';

drop policy if exists "Tenant members can view estimate version events" on public.estimate_version_events;
drop policy if exists "Users can view scoped estimate version events" on public.estimate_version_events;

create policy "Users can view scoped estimate version events"
  on public.estimate_version_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_version_events.estimate_version_id
        and v.tenant_id = estimate_version_events.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role, 'director'::public.tenant_role]
            )
          )
        )
    )
    or (select public.is_admin_user())
  );
