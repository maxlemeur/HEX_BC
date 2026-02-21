-- EST-046: seal transitions and append-only estimate version events.

alter table public.estimate_versions
  add column if not exists seal_hash text;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_seal_hash_hex64_check;

alter table public.estimate_versions
  add constraint estimate_versions_seal_hash_hex64_check
  check (
    seal_hash is null
    or seal_hash ~ '^[0-9a-fA-F]{64}$'
  );

create or replace function public.validate_estimate_version_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status = 'sent')
      or (old.status = 'sent' and new.status in ('accepted', 'archived'))
      or (old.status = 'accepted' and new.status = 'archived')
    ) then
      raise exception 'Invalid estimate status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if old.status = 'draft' and new.status = 'sent' then
    if new.seal_hash is null or new.seal_hash !~ '^[0-9a-fA-F]{64}$' then
      raise exception 'seal_hash must be a 64-character hex string when moving draft -> sent';
    end if;
  elsif new.seal_hash is distinct from old.seal_hash then
    raise exception 'seal_hash is immutable except during draft -> sent transition';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_estimate_version_transition on public.estimate_versions;
create trigger validate_estimate_version_transition
  before update on public.estimate_versions
  for each row execute procedure public.validate_estimate_version_transition();

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if new.status = old.status then
      raise exception 'Estimate version is read-only';
    end if;

    if new.created_at is distinct from old.created_at
      or new.project_id is distinct from old.project_id
      or new.version_number is distinct from old.version_number
      or new.title is distinct from old.title
      or new.date_devis is distinct from old.date_devis
      or new.validite_jours is distinct from old.validite_jours
      or new.margin_multiplier is distinct from old.margin_multiplier
      or new.margin_mode is distinct from old.margin_mode
      or new.currency is distinct from old.currency
      or new.margin_bp is distinct from old.margin_bp
      or new.discount_bp is distinct from old.discount_bp
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
      or new.seal_hash is distinct from old.seal_hash
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

create table if not exists public.estimate_version_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  event_type text not null check (event_type in ('sent')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists estimate_version_events_created_at_idx
  on public.estimate_version_events (created_at desc);
create index if not exists estimate_version_events_tenant_id_idx
  on public.estimate_version_events (tenant_id);
create index if not exists estimate_version_events_estimate_version_id_idx
  on public.estimate_version_events (estimate_version_id);

create or replace function public.assign_estimate_version_events_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_version_events_tenant_id on public.estimate_version_events;
create trigger set_estimate_version_events_tenant_id
  before insert on public.estimate_version_events
  for each row execute procedure public.assign_estimate_version_events_tenant_id();

alter table public.estimate_version_events enable row level security;

drop policy if exists "Users can view estimate version events" on public.estimate_version_events;
drop policy if exists "Users can insert estimate version events" on public.estimate_version_events;

create policy "Users can view estimate version events"
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
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert estimate version events"
  on public.estimate_version_events
  for insert
  to authenticated
  with check (
    (created_by is null or created_by = (select auth.uid()))
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_version_events.estimate_version_id
        and v.tenant_id = estimate_version_events.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'invariant_violation', 'seal'));

create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
  target_tenant_id uuid;
  target_action text := tg_op;
begin
  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_new->>'estimate_version_id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_old->>'estimate_version_id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid,
    nullif(target_new->>'created_by', '')::uuid,
    nullif(target_old->>'created_by', '')::uuid
  );

  target_tenant_id := coalesce(
    nullif(target_new->>'tenant_id', '')::uuid,
    nullif(target_old->>'tenant_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_version_events' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_record_id;
    end if;
  end if;

  if target_tenant_id is null then
    if target_version_id is not null then
      select v.tenant_id
        into target_tenant_id
      from public.estimate_versions v
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.tenant_id
        into target_tenant_id
      from public.estimate_projects p
      where p.id = target_record_id;
    elsif target_row_user_id is not null then
      select tm.tenant_id
        into target_tenant_id
      from public.tenant_memberships tm
      where tm.user_id = target_row_user_id
      order by tm.is_default desc, tm.created_at asc
      limit 1;
    end if;
  end if;

  if tg_table_name = 'estimate_versions'
    and tg_op = 'UPDATE'
    and coalesce(target_old->>'status', '') = 'draft'
    and coalesce(target_new->>'status', '') = 'sent'
  then
    target_action := 'seal';
  end if;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    coalesce(target_tenant_id, public.current_tenant_id()),
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    target_action,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists estimate_version_events_audit_trigger on public.estimate_version_events;
create trigger estimate_version_events_audit_trigger
  after insert or update or delete on public.estimate_version_events
  for each row execute procedure public.log_estimate_audit();
