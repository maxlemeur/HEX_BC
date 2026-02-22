-- EST-036: append-only estimate version events timeline.

alter table public.estimate_version_events
  add column if not exists occurred_at timestamptz;

update public.estimate_version_events
set occurred_at = coalesce(occurred_at, created_at, now())
where occurred_at is null;

alter table public.estimate_version_events
  alter column occurred_at set default now();

alter table public.estimate_version_events
  alter column occurred_at set not null;

alter table public.estimate_version_events
  drop constraint if exists estimate_version_events_event_type_check;

alter table public.estimate_version_events
  add constraint estimate_version_events_event_type_check
  check (
    event_type in ('sent', 'accepted', 'archived', 'rejected', 'seal_verified')
  );

create index if not exists estimate_version_events_occurred_at_idx
  on public.estimate_version_events (occurred_at desc);

create index if not exists estimate_version_events_version_occurred_at_idx
  on public.estimate_version_events (estimate_version_id, occurred_at desc, created_at desc);

create or replace function public.guard_estimate_version_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    using
      errcode = '42501',
      message = 'ESTIMATE_VERSION_EVENTS_APPEND_ONLY',
      detail = 'estimate_version_events is append-only and does not allow update/delete.';
end;
$$;

drop trigger if exists estimate_version_events_append_only_guard on public.estimate_version_events;
create trigger estimate_version_events_append_only_guard
  before update or delete on public.estimate_version_events
  for each row execute procedure public.guard_estimate_version_events_append_only();

create or replace function public.log_estimate_version_event(
  p_estimate_version_id uuid,
  p_event_type text,
  p_created_by uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns public.estimate_version_events
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant_id uuid;
  normalized_event_type text := lower(trim(coalesce(p_event_type, '')));
  inserted_row public.estimate_version_events;
begin
  if normalized_event_type = '' then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = 'event_type is required.';
  end if;

  if normalized_event_type not in ('sent', 'accepted', 'archived', 'rejected', 'seal_verified') then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = format('Unsupported event_type: %s', normalized_event_type);
  end if;

  select ev.tenant_id
    into target_tenant_id
  from public.estimate_versions ev
  where ev.id = p_estimate_version_id;

  if target_tenant_id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_VERSION_NOT_FOUND',
        detail = format('estimate_version_id=%s', p_estimate_version_id);
  end if;

  if p_created_by is not null
    and not exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = target_tenant_id
        and tm.user_id = p_created_by
    )
    and not exists (
      select 1
      from public.profiles profile
      where profile.id = p_created_by
        and profile.role = 'admin'
    ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_EVENT_ACTOR_NOT_ALLOWED',
        detail = format('created_by=%s is not allowed for tenant_id=%s', p_created_by, target_tenant_id);
  end if;

  insert into public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    event_type,
    metadata,
    created_by,
    occurred_at
  )
  values (
    target_tenant_id,
    p_estimate_version_id,
    normalized_event_type,
    coalesce(p_metadata, '{}'::jsonb),
    p_created_by,
    coalesce(p_occurred_at, now())
  )
  returning *
  into inserted_row;

  return inserted_row;
end;
$$;

revoke all on function public.log_estimate_version_event(uuid, text, uuid, jsonb, timestamptz) from public;
revoke all on function public.log_estimate_version_event(uuid, text, uuid, jsonb, timestamptz) from authenticated;
grant execute on function public.log_estimate_version_event(uuid, text, uuid, jsonb, timestamptz) to service_role;

drop policy if exists "Users can view estimate version events" on public.estimate_version_events;
drop policy if exists "Users can insert estimate version events" on public.estimate_version_events;
drop policy if exists "Tenant members can view estimate version events" on public.estimate_version_events;
drop policy if exists "Service role can insert estimate version events" on public.estimate_version_events;

create policy "Tenant members can view estimate version events"
  on public.estimate_version_events
  for select
  to authenticated
  using (
    tenant_id is not null
    and (
      (select public.is_tenant_member(tenant_id))
      or (select public.is_admin_user())
    )
  );

create policy "Service role can insert estimate version events"
  on public.estimate_version_events
  for insert
  to service_role
  with check (true);
