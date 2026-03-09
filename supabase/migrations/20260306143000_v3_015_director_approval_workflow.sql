-- V3-015: director tenant role, approval workflow projection, and audit events.

do $$
begin
  alter type public.tenant_role add value if not exists 'director';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_version_approval_status as enum (
    'not_required',
    'required',
    'in_review',
    'approved',
    'changes_requested'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_rule_type add value if not exists 'critical_exceptions_max';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_rule_type add value if not exists 'missing_line_evidence_max';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_rule_type add value if not exists 'dpgf_coverage_min';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_rule_type add value if not exists 'takeoff_evidence_coverage_min';
exception
  when duplicate_object then null;
end
$$;

alter table public.estimate_versions
  add column if not exists approval_status public.estimate_version_approval_status
    not null default 'not_required',
  add column if not exists approval_summary jsonb
    not null default '{}'::jsonb,
  add column if not exists approval_evaluated_at timestamptz;

create index if not exists estimate_versions_tenant_approval_status_idx
  on public.estimate_versions (tenant_id, approval_status, updated_at desc);

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
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
      or new.parent_version_id is distinct from old.parent_version_id
      or new.variant_label is distinct from old.variant_label
      or new.tenant_id is distinct from old.tenant_id
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

alter table public.estimate_version_events
  drop constraint if exists estimate_version_events_event_type_check;

alter table public.estimate_version_events
  add constraint estimate_version_events_event_type_check
  check (
    event_type in (
      'sent',
      'accepted',
      'archived',
      'rejected',
      'seal_verified',
      'approval_rules_evaluated',
      'approval_status_changed',
      'approval_decided',
      'generated_ouvrage_draft_created',
      'generated_ouvrage_inserted',
      'generated_ouvrage_discarded'
    )
  );

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

  if normalized_event_type not in (
    'sent',
    'accepted',
    'archived',
    'rejected',
    'seal_verified',
    'approval_rules_evaluated',
    'approval_status_changed',
    'approval_decided',
    'generated_ouvrage_draft_created',
    'generated_ouvrage_inserted',
    'generated_ouvrage_discarded'
  ) then
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

drop policy if exists "Users can view estimate items" on public.estimate_items;
create policy "Users can view estimate items"
  on public.estimate_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
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
  );

drop policy if exists "Tenant directors can view estimate projects" on public.estimate_projects;
create policy "Tenant directors can view estimate projects"
  on public.estimate_projects
  for select
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      select public.has_tenant_role(
        tenant_id,
        array['director'::public.tenant_role]
      )
    )
  );

drop policy if exists "Tenant directors can view estimate versions" on public.estimate_versions;
create policy "Tenant directors can view estimate versions"
  on public.estimate_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_projects p
      where p.id = estimate_versions.project_id
        and p.tenant_id = estimate_versions.tenant_id
        and (select public.is_tenant_member(p.tenant_id))
        and (
          select public.has_tenant_role(
            p.tenant_id,
            array['director'::public.tenant_role]
          )
        )
    )
  );

drop policy if exists "Tenant directors can view labor roles" on public.labor_roles;
create policy "Tenant directors can view labor roles"
  on public.labor_roles
  for select
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      select public.has_tenant_role(
        tenant_id,
        array['director'::public.tenant_role]
      )
    )
  );

drop policy if exists "Tenant admins can decide estimate approvals" on public.estimate_approvals;
drop policy if exists "Tenant approvers can decide estimate approvals" on public.estimate_approvals;
create policy "Tenant approvers can decide estimate approvals"
  on public.estimate_approvals
  for update
  to authenticated
  using (
    (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
  )
  with check (
    (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
    and (
      status = 'pending'
      or (
        status in ('approved', 'rejected')
        and approved_by = (select auth.uid())
        and decided_at is not null
      )
    )
  );
