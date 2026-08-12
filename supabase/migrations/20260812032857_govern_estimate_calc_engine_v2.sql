-- Govern the v2 calculation engine without rewriting historical estimates.
-- Every production creation workflow uses the canonical v2 facade. Duplication
-- preserves the source engine; retired template/import RPCs remain pinned to v1
-- but lose their authenticated execution capability.

do $$
begin
  if exists (
    select 1
    from public.estimate_versions
    where calc_engine_version not in (1, 2)
  ) then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED';
  end if;
end;
$$;

alter table public.estimate_versions
  alter column calc_engine_version set default 1;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_calc_engine_version_check;

alter table public.estimate_versions
  add constraint estimate_versions_calc_engine_version_check
  check (calc_engine_version in (1, 2));

alter table public.estimate_versions
  add column if not exists calc_snapshot_content_revision bigint,
  add column if not exists calc_snapshot_context jsonb;

alter table public.estimate_review_cycles
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists superseded_by_cycle_id uuid
    references public.estimate_review_cycles(id) on delete set null
    deferrable initially deferred;

alter table public.estimate_review_cycles
  drop constraint if exists estimate_review_cycles_superseded_check;
alter table public.estimate_review_cycles
  add constraint estimate_review_cycles_superseded_check
  check (
    (
      superseded_at is null
      and superseded_by is null
      and superseded_by_cycle_id is null
    )
    or (
      superseded_at is not null
      and superseded_by is not null
    )
  );

alter table public.estimate_approvals
  add column if not exists review_cycle_id uuid
    references public.estimate_review_cycles(id) on delete cascade,
  add column if not exists superseded_at timestamptz;

drop index if exists public.estimate_review_cycles_open_cycle_idx;
create unique index estimate_review_cycles_open_cycle_idx
  on public.estimate_review_cycles (tenant_id, version_id)
  where decision is null and superseded_at is null;

drop index if exists public.estimate_review_cycles_open_assigned_reviewer_idx;
create index estimate_review_cycles_open_assigned_reviewer_idx
  on public.estimate_review_cycles (
    tenant_id,
    assigned_reviewer_id,
    requested_at desc
  )
  where decision is null
    and superseded_at is null
    and assigned_reviewer_id is not null;

drop index if exists public.estimate_approvals_pending_unique_idx;
create unique index estimate_approvals_pending_unique_idx
  on public.estimate_approvals (tenant_id, version_id, rule_id)
  where status = 'pending'::public.estimate_approval_status
    and superseded_at is null;

create unique index if not exists estimate_approvals_review_cycle_rule_idx
  on public.estimate_approvals (review_cycle_id, rule_id)
  where review_cycle_id is not null;

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
      'approval_submitted',
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
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  normalized_event_type text := lower(trim(coalesce(p_event_type, '')));
  inserted_row public.estimate_version_events;
begin
  if normalized_event_type = '' then
    raise exception using
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
    'approval_submitted',
    'approval_decided',
    'generated_ouvrage_draft_created',
    'generated_ouvrage_inserted',
    'generated_ouvrage_discarded'
  ) then
    raise exception using
      errcode = '22023',
      message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
      detail = format('Unsupported event_type: %s', normalized_event_type);
  end if;

  select version.tenant_id
    into target_tenant_id
  from public.estimate_versions version
  where version.id = p_estimate_version_id;

  if target_tenant_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ESTIMATE_VERSION_NOT_FOUND',
      detail = format('estimate_version_id=%s', p_estimate_version_id);
  end if;

  if p_created_by is not null
    and not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = target_tenant_id
        and membership.user_id = p_created_by
    )
    and not exists (
      select 1
      from public.profiles profile
      where profile.id = p_created_by
        and profile.role = 'admin'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_EVENT_ACTOR_NOT_ALLOWED',
      detail = format(
        'created_by=%s is not allowed for tenant_id=%s',
        p_created_by,
        target_tenant_id
      );
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
  returning * into inserted_row;

  return inserted_row;
end;
$$;

revoke all on function public.log_estimate_version_event(
  uuid,
  text,
  uuid,
  jsonb,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.log_estimate_version_event(
  uuid,
  text,
  uuid,
  jsonb,
  timestamptz
) to service_role;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_calc_snapshot_revision_check;
alter table public.estimate_versions
  add constraint estimate_versions_calc_snapshot_revision_check
  check (
    calc_snapshot_content_revision is null
    or calc_snapshot_content_revision > 0
  );

alter table public.estimate_versions
  drop constraint if exists estimate_versions_calc_snapshot_context_check;
alter table public.estimate_versions
  add constraint estimate_versions_calc_snapshot_context_check
  check (
    calc_snapshot_context is null
    or jsonb_typeof(calc_snapshot_context) = 'object'
  );

comment on column public.estimate_versions.calc_snapshot_content_revision is
  'Content revision whose governed v2 item/footer snapshot is ready for contractual publication.';
comment on column public.estimate_versions.calc_snapshot_context is
  'Immutable external calculation inputs used to publish a governed v2 snapshot.';

alter table public.estimate_items
  add column if not exists snapshot_pu_ht_cents integer,
  add column if not exists snapshot_fo_ht_cents integer,
  add column if not exists snapshot_mo_ht_cents integer,
  add column if not exists snapshot_mo_atelier_ht_cents integer,
  add column if not exists snapshot_mo_chantier_ht_cents integer;

alter table public.estimate_items
  drop constraint if exists estimate_items_v2_snapshot_nonnegative_check;
alter table public.estimate_items
  add constraint estimate_items_v2_snapshot_nonnegative_check
  check (
    snapshot_pu_ht_cents is null
    or (
      snapshot_pu_ht_cents >= 0
      and snapshot_fo_ht_cents >= 0
      and snapshot_mo_ht_cents >= 0
      and snapshot_mo_atelier_ht_cents >= 0
      and snapshot_mo_chantier_ht_cents >= 0
    )
  );

alter table public.estimate_items
  drop constraint if exists estimate_items_v2_snapshot_complete_check;
alter table public.estimate_items
  add constraint estimate_items_v2_snapshot_complete_check
  check (
    (
      snapshot_pu_ht_cents is null
      and snapshot_fo_ht_cents is null
      and snapshot_mo_ht_cents is null
      and snapshot_mo_atelier_ht_cents is null
      and snapshot_mo_chantier_ht_cents is null
    )
    or (
      snapshot_pu_ht_cents is not null
      and snapshot_fo_ht_cents is not null
      and snapshot_mo_ht_cents is not null
      and snapshot_mo_atelier_ht_cents is not null
      and snapshot_mo_chantier_ht_cents is not null
      and snapshot_fo_ht_cents + snapshot_mo_ht_cents = line_total_ht_cents
      and snapshot_mo_atelier_ht_cents + snapshot_mo_chantier_ht_cents =
        snapshot_mo_ht_cents
    )
  );

comment on column public.estimate_items.snapshot_pu_ht_cents is
  'Immutable unit sale price snapshot published for a finalized v2 estimate.';
comment on column public.estimate_items.snapshot_fo_ht_cents is
  'Immutable material sale allocation published for a finalized v2 estimate.';
comment on column public.estimate_items.snapshot_mo_ht_cents is
  'Immutable labor sale allocation published for a finalized v2 estimate.';
comment on column public.estimate_items.snapshot_mo_atelier_ht_cents is
  'Immutable workshop labor sale allocation published for a finalized v2 estimate.';
comment on column public.estimate_items.snapshot_mo_chantier_ht_cents is
  'Immutable site labor sale allocation published for a finalized v2 estimate.';

comment on column public.estimate_versions.calc_engine_version is
  'Immutable calculation contract. Production creation uses v2; duplication preserves its source; retired legacy creators remain pinned to v1.';

create or replace function public.guard_estimate_v2_snapshot_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_engine_version smallint;
  target_version_status public.estimate_status;
  target_project_owner_id uuid;
  target_tenant_id uuid;
begin
  if tg_op = 'DELETE' then
    target_version_id := old.version_id;
  else
    target_version_id := new.version_id;
  end if;

  select
    version.calc_engine_version,
    version.status,
    project.user_id,
    version.tenant_id
  into
    target_engine_version,
    target_version_status,
    target_project_owner_id,
    target_tenant_id
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = target_version_id
  for share of project;

  if target_engine_version = 2
    and target_version_status <> 'draft'::public.estimate_status
  then
    if tg_op = 'DELETE'
      or (
        tg_op = 'UPDATE'
        and to_jsonb(new) - 'updated_at' is distinct from
          to_jsonb(old) - 'updated_at'
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_VERSION_READ_ONLY';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if target_engine_version = 2 then
    perform role.id
    from public.labor_roles role
    join (
      select distinct referenced.role_id
      from unnest(array[
        new.labor_role_id,
        new.labor_role_atelier_id,
        new.labor_role_chantier_id
      ]::uuid[]) as referenced(role_id)
      where referenced.role_id is not null
    ) referenced on referenced.role_id = role.id
    order by role.id
    for share of role;
  end if;

  if target_engine_version = 2 and (
      (
        new.labor_role_id is not null
        and not exists (
          select 1
          from public.labor_roles role
          where role.id = new.labor_role_id
            and role.tenant_id = target_tenant_id
            and role.user_id = target_project_owner_id
        )
      )
      or (
        new.labor_role_atelier_id is not null
        and not exists (
          select 1
          from public.labor_roles role
          where role.id = new.labor_role_atelier_id
            and role.tenant_id = target_tenant_id
            and role.user_id = target_project_owner_id
        )
      )
      or (
        new.labor_role_chantier_id is not null
        and not exists (
          select 1
          from public.labor_roles role
          where role.id = new.labor_role_chantier_id
            and role.tenant_id = target_tenant_id
            and role.user_id = target_project_owner_id
        )
      )
    )
  then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if tg_op = 'INSERT' then
    if (
        new.snapshot_pu_ht_cents is not null
        or new.snapshot_fo_ht_cents is not null
        or new.snapshot_mo_ht_cents is not null
        or new.snapshot_mo_atelier_ht_cents is not null
        or new.snapshot_mo_chantier_ht_cents is not null
      )
      and (
        current_user <> 'service_role'
        or coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) <> 'on'
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
    end if;
    return new;
  end if;

  if (
      new.snapshot_pu_ht_cents is distinct from old.snapshot_pu_ht_cents
      or new.snapshot_fo_ht_cents is distinct from old.snapshot_fo_ht_cents
      or new.snapshot_mo_ht_cents is distinct from old.snapshot_mo_ht_cents
      or new.snapshot_mo_atelier_ht_cents is distinct from
        old.snapshot_mo_atelier_ht_cents
      or new.snapshot_mo_chantier_ht_cents is distinct from
        old.snapshot_mo_chantier_ht_cents
    )
    and (
      current_user <> 'service_role'
      or coalesce(
        pg_catalog.current_setting(
          'miaouffrage.estimate_v2_snapshot_freeze',
          true
        ),
        ''
      ) <> 'on'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
  end if;

  if coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_v2_snapshot_freeze',
        true
      ),
      ''
    ) <> 'on'
    and (
      new.parent_id is distinct from old.parent_id
      or new.item_type is distinct from old.item_type
      or new.quantity is distinct from old.quantity
      or new.unit_price_ht_cents is distinct from old.unit_price_ht_cents
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.k_fo is distinct from old.k_fo
      or new.h_mo is distinct from old.h_mo
      or new.h_mo_majoration is distinct from old.h_mo_majoration
      or new.k_mo is distinct from old.k_mo
      or new.h_mo_atelier is distinct from old.h_mo_atelier
      or new.k_mo_atelier is distinct from old.k_mo_atelier
      or new.labor_role_atelier_id is distinct from old.labor_role_atelier_id
      or new.h_mo_chantier is distinct from old.h_mo_chantier
      or new.k_mo_chantier is distinct from old.k_mo_chantier
      or new.labor_role_chantier_id is distinct from old.labor_role_chantier_id
      or new.pu_ht_cents is distinct from old.pu_ht_cents
      or new.labor_role_id is distinct from old.labor_role_id
      or new.line_total_ht_cents is distinct from old.line_total_ht_cents
      or new.line_tax_cents is distinct from old.line_tax_cents
      or new.line_total_ttc_cents is distinct from old.line_total_ttc_cents
    )
  then
    new.snapshot_pu_ht_cents := null;
    new.snapshot_fo_ht_cents := null;
    new.snapshot_mo_ht_cents := null;
    new.snapshot_mo_atelier_ht_cents := null;
    new.snapshot_mo_chantier_ht_cents := null;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_v2_snapshot_columns()
  from public, anon, authenticated;

drop trigger if exists aaz_guard_estimate_v2_snapshot_columns
  on public.estimate_items;
create trigger aaz_guard_estimate_v2_snapshot_columns
  before insert or update or delete on public.estimate_items
  for each row execute function public.guard_estimate_v2_snapshot_columns();

create or replace function public.guard_estimate_project_v2_owner_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- The project UPDATE already owns the project row lock. Lock every role used
  -- by any v2 version next, in a single deterministic order, so neither role
  -- ownership nor a concurrent v2 item write can race this validation.
  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from public.estimate_versions version
    join public.estimate_items item
      on item.version_id = version.id
     and item.tenant_id = version.tenant_id
    cross join lateral (
      values
        (item.labor_role_id),
        (item.labor_role_atelier_id),
        (item.labor_role_chantier_id)
    ) referenced(role_id)
    where version.project_id = old.id
      and version.tenant_id = old.tenant_id
      and version.calc_engine_version = 2
      and referenced.role_id is not null
  )
  order by role.id
  for share of role;

  -- Apply the same invariant to draft, sending, sent, accepted, and rejected
  -- versions. A transfer is safe only after all referenced roles already
  -- belong to the candidate owner.
  if exists (
    select 1
    from public.estimate_versions version
    join public.estimate_items item
      on item.version_id = version.id
     and item.tenant_id = version.tenant_id
    cross join lateral (
      values
        (item.labor_role_id),
        (item.labor_role_atelier_id),
        (item.labor_role_chantier_id)
    ) referenced(role_id)
    left join public.labor_roles role
      on role.id = referenced.role_id
     and role.tenant_id = version.tenant_id
     and role.user_id = new.user_id
    where version.project_id = old.id
      and version.tenant_id = old.tenant_id
      and version.calc_engine_version = 2
      and referenced.role_id is not null
      and role.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_PROJECT_OWNER_LABOR_ROLE_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_project_v2_owner_change()
  from public, anon, authenticated;

drop trigger if exists aaz_guard_estimate_project_v2_owner_change
  on public.estimate_projects;
create trigger aaz_guard_estimate_project_v2_owner_change
  before update of user_id on public.estimate_projects
  for each row execute function public.guard_estimate_project_v2_owner_change();

create or replace function public.guard_labor_role_v2_owner_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.estimate_items item
      join public.estimate_versions version
        on version.id = item.version_id
       and version.tenant_id = item.tenant_id
       and version.calc_engine_version = 2
      where item.tenant_id = old.tenant_id
        and old.id in (
          item.labor_role_id,
          item.labor_role_atelier_id,
          item.labor_role_chantier_id
        )
    ) then
      raise exception using
        errcode = '23503',
        message = 'ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE';
    end if;
    return old;
  end if;

  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- The UPDATE already locks this labor-role row. Any concurrent v2 item
  -- insert/update must acquire the same role lock in its item guard before it
  -- can validate and commit the reference.
  if exists (
    select 1
    from public.estimate_items item
    join public.estimate_versions version
      on version.id = item.version_id
     and version.tenant_id = item.tenant_id
     and version.calc_engine_version = 2
    join public.estimate_projects project
      on project.id = version.project_id
     and project.tenant_id = version.tenant_id
    where item.tenant_id = old.tenant_id
      and old.id in (
        item.labor_role_id,
        item.labor_role_atelier_id,
        item.labor_role_chantier_id
      )
      and project.user_id <> new.user_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_labor_role_v2_owner_change()
  from public, anon, authenticated;

drop trigger if exists aaz_guard_labor_role_v2_owner_change
  on public.labor_roles;
create trigger aaz_guard_labor_role_v2_owner_change
  before update of user_id or delete on public.labor_roles
  for each row execute function public.guard_labor_role_v2_owner_change();

create or replace function public.guard_estimate_review_cycles_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  assigned_reviewer_role public.tenant_role;
  trusted_supersession boolean :=
    current_user = 'service_role'
    and coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_review_cycle_supersession',
        true
      ),
      ''
    ) = 'on';
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.cycle_number is distinct from new.cycle_number
    or old.requested_by is distinct from new.requested_by
    or old.requested_at is distinct from new.requested_at
    or old.carried_over_from_cycle_id is distinct from
      new.carried_over_from_cycle_id
    or old.created_at is distinct from new.created_at
    or old.submission_message is distinct from new.submission_message
    or old.assigned_reviewer_id is distinct from new.assigned_reviewer_id
    or old.requested_content_revision is distinct from
      new.requested_content_revision
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_IMMUTABLE_FIELDS';
  end if;

  if (
      old.superseded_at is distinct from new.superseded_at
      or old.superseded_by is distinct from new.superseded_by
      or old.superseded_by_cycle_id is distinct from
        new.superseded_by_cycle_id
    )
    and not trusted_supersession
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_SUPERSESSION_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  if old.superseded_at is not null and (
      old.superseded_at is distinct from new.superseded_at
      or old.superseded_by is distinct from new.superseded_by
      or old.superseded_by_cycle_id is distinct from
        new.superseded_by_cycle_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_SUPERSESSION_IMMUTABLE';
  end if;

  if old.superseded_at is not null and (
      old.decision is distinct from new.decision
      or old.decided_by is distinct from new.decided_by
      or old.decided_at is distinct from new.decided_at
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_SUPERSEDED';
  end if;

  if old.decision is not null and (
      old.decision is distinct from new.decision
      or old.decided_by is distinct from new.decided_by
      or old.decided_at is distinct from new.decided_at
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  if new.submission_message is not null
    and trim(new.submission_message) = ''
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_SUBMISSION_MESSAGE_REQUIRED';
  end if;

  if new.assigned_reviewer_id is not null then
    select membership.role
      into assigned_reviewer_role
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.assigned_reviewer_id
      and membership.role in (
        'admin'::public.tenant_role,
        'director'::public.tenant_role
      )
    order by membership.is_default desc, membership.created_at asc
    limit 1;

    if assigned_reviewer_role is null then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_ASSIGNED_REVIEWER_INVALID';
    end if;
  end if;

  if new.decision is null then
    if new.decided_by is not null or new.decided_at is not null then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_OPEN_CYCLE_INVALID';
    end if;
  elsif new.decided_by is null or new.decided_at is null then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_REVIEW_DECISION_INVALID';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_review_cycles_update()
  from public, anon, authenticated;

create or replace function public.guard_estimate_approvals_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  trusted_supersession boolean :=
    current_user = 'service_role'
    and coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_review_cycle_supersession',
        true
      ),
      ''
    ) = 'on';
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.rule_id is distinct from new.rule_id
    or old.requested_by is distinct from new.requested_by
    or old.created_at is distinct from new.created_at
    or old.review_cycle_id is distinct from new.review_cycle_id
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_APPROVAL_IMMUTABLE_FIELDS';
  end if;

  if old.superseded_at is distinct from new.superseded_at
    and not trusted_supersession
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_SUPERSESSION_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  if old.superseded_at is not null
    and old.superseded_at is distinct from new.superseded_at
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_SUPERSESSION_IMMUTABLE';
  end if;

  if old.superseded_at is not null and (
      old.status is distinct from new.status
      or old.approved_by is distinct from new.approved_by
      or old.decided_at is distinct from new.decided_at
      or old.approved_content_revision is distinct from
        new.approved_content_revision
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_APPROVAL_SUPERSEDED';
  end if;

  if new.status = 'pending'::public.estimate_approval_status then
    if new.approved_by is not null or new.decided_at is not null then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_APPROVAL_PENDING_INVALID';
    end if;
  else
    if new.status not in (
      'approved'::public.estimate_approval_status,
      'rejected'::public.estimate_approval_status
    ) then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_APPROVAL_STATUS_INVALID';
    end if;

    if new.decided_at is null then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_APPROVAL_DECISION_INVALID';
    end if;

    if new.approved_by is null and not (
        old.status = new.status
        and old.status in (
          'approved'::public.estimate_approval_status,
          'rejected'::public.estimate_approval_status
        )
        and old.approved_by is not null
        and old.decided_at is not distinct from new.decided_at
      )
    then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_APPROVAL_DECISION_INVALID';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_approvals_update()
  from public, anon, authenticated;

revoke insert on table public.estimate_review_cycles
  from public, anon, authenticated;
revoke insert on table public.estimate_approvals
  from public, anon, authenticated;
revoke update on table public.estimate_review_cycles
  from public, anon, authenticated;
revoke update on table public.estimate_approvals
  from public, anon, authenticated;

drop policy if exists "Estimate owners can create review cycles"
  on public.estimate_review_cycles;
drop policy if exists "Tenant members can create estimate approvals"
  on public.estimate_approvals;
drop policy if exists "Tenant writers can create estimate approvals"
  on public.estimate_approvals;
drop policy if exists "Tenant approvers can close review cycles"
  on public.estimate_review_cycles;
drop policy if exists "Tenant admins can decide estimate approvals"
  on public.estimate_approvals;
drop policy if exists "Tenant approvers can decide estimate approvals"
  on public.estimate_approvals;

create or replace function public.open_estimate_review_cycle(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_assigned_reviewer_id uuid,
  p_rule_ids uuid[],
  p_submission_message text default null,
  p_event_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_project public.estimate_projects%rowtype;
  normalized_rule_ids uuid[];
  normalized_submission_message text := nullif(btrim(p_submission_message), '');
  normalized_event_metadata jsonb := coalesce(p_event_metadata, '{}'::jsonb);
  existing_cycle public.estimate_review_cycles%rowtype;
  latest_cycle public.estimate_review_cycles%rowtype;
  opened_cycle public.estimate_review_cycles%rowtype;
  opened_cycle_id uuid;
  supersession_timestamp timestamptz := statement_timestamp();
  opened_approvals jsonb;
  requested_rule_count integer;
  valid_rule_count integer;
  previous_supersession_setting text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_OPEN_REQUIRES_SERVICE_ROLE';
  end if;

  if p_version_id is null
    or p_tenant_id is null
    or p_actor_user_id is null
    or p_assigned_reviewer_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_OPEN_INPUT_REQUIRED';
  end if;

  if p_submission_message is not null
    and normalized_submission_message is null
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_SUBMISSION_MESSAGE_REQUIRED';
  end if;

  if jsonb_typeof(normalized_event_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_EVENT_METADATA_INVALID';
  end if;

  select array_agg(distinct requested.rule_id order by requested.rule_id)
    into normalized_rule_ids
  from unnest(coalesce(p_rule_ids, '{}'::uuid[])) requested(rule_id)
  where requested.rule_id is not null;

  requested_rule_count := coalesce(array_length(normalized_rule_ids, 1), 0);
  if requested_rule_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_RULE_IDS_REQUIRED';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  join public.tenants tenant
    on tenant.id = version.tenant_id
   and tenant.is_active
  join public.tenant_memberships actor_membership
    on actor_membership.tenant_id = version.tenant_id
   and actor_membership.user_id = p_actor_user_id
   and actor_membership.role in (
     'admin'::public.tenant_role,
     'engineer'::public.tenant_role
   )
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
    and version.status = 'draft'::public.estimate_status
    and not project.is_archived
    and (
      project.user_id = p_actor_user_id
      or actor_membership.role = 'admin'::public.tenant_role
    )
  for update of version, project;

  if target_version.id is null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_OPEN_FORBIDDEN';
  end if;

  select project.*
    into target_project
  from public.estimate_projects project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id;

  if target_version.calc_engine_version = 2 and (
      target_version.calc_snapshot_content_revision is distinct from
        target_version.content_revision
      or target_version.calc_snapshot_context is null
    )
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_SNAPSHOT_STALE';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships reviewer_membership
    where reviewer_membership.tenant_id = p_tenant_id
      and reviewer_membership.user_id = p_assigned_reviewer_id
      and reviewer_membership.role in (
        'admin'::public.tenant_role,
        'director'::public.tenant_role
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ESTIMATE_REVIEW_ASSIGNED_REVIEWER_INVALID';
  end if;

  perform rule.id
  from public.estimate_rules rule
  where rule.tenant_id = p_tenant_id
    and rule.id = any(normalized_rule_ids)
  order by rule.id
  for share of rule;

  select count(*)::integer
    into valid_rule_count
  from public.estimate_rules rule
  where rule.tenant_id = p_tenant_id
    and rule.id = any(normalized_rule_ids)
    and rule.is_active;

  if valid_rule_count <> requested_rule_count then
    raise exception using
      errcode = 'P0001',
      message = 'ESTIMATE_REVIEW_RULES_INVALID';
  end if;

  perform cycle.id
  from public.estimate_review_cycles cycle
  where cycle.tenant_id = p_tenant_id
    and cycle.version_id = p_version_id
  order by cycle.cycle_number, cycle.id
  for update of cycle;

  perform approval.id
  from public.estimate_approvals approval
  where approval.tenant_id = p_tenant_id
    and approval.version_id = p_version_id
  order by approval.id
  for update of approval;

  select cycle.*
    into existing_cycle
  from public.estimate_review_cycles cycle
  where cycle.tenant_id = p_tenant_id
    and cycle.version_id = p_version_id
    and cycle.decision is null
    and cycle.superseded_at is null
  order by cycle.cycle_number desc
  limit 1;

  if existing_cycle.id is not null
    and existing_cycle.requested_content_revision =
      target_version.content_revision
    and existing_cycle.requested_by = p_actor_user_id
    and existing_cycle.assigned_reviewer_id = p_assigned_reviewer_id
    and existing_cycle.submission_message is not distinct from
      normalized_submission_message
    and (
      select coalesce(array_agg(approval.rule_id order by approval.rule_id), '{}')
      from public.estimate_approvals approval
      where approval.tenant_id = p_tenant_id
        and approval.version_id = p_version_id
        and approval.review_cycle_id = existing_cycle.id
        and approval.status = 'pending'::public.estimate_approval_status
        and approval.superseded_at is null
    ) = normalized_rule_ids
  then
    select coalesce(jsonb_agg(to_jsonb(approval) order by approval.rule_id), '[]')
      into opened_approvals
    from public.estimate_approvals approval
    where approval.tenant_id = p_tenant_id
      and approval.version_id = p_version_id
      and approval.review_cycle_id = existing_cycle.id
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null;

    return jsonb_build_object(
      'created', false,
      'cycle', to_jsonb(existing_cycle),
      'approvals', opened_approvals
    );
  end if;

  select cycle.*
    into latest_cycle
  from public.estimate_review_cycles cycle
  where cycle.tenant_id = p_tenant_id
    and cycle.version_id = p_version_id
  order by cycle.cycle_number desc
  limit 1;

  previous_supersession_setting := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_review_cycle_supersession',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_review_cycle_supersession',
    'on',
    true
  );

  opened_cycle_id := gen_random_uuid();

  if existing_cycle.id is not null then
    update public.estimate_review_cycles cycle
    set
      superseded_at = supersession_timestamp,
      superseded_by = p_actor_user_id,
      superseded_by_cycle_id = opened_cycle_id
    where cycle.id = existing_cycle.id
      and cycle.decision is null
      and cycle.superseded_at is null;
  end if;

  -- Historical pending approvals were keyed only by version/rule and can have
  -- no review_cycle_id. Supersede every active pending row before inserting
  -- the replacement rule set so the unique pending contract stays fail-closed.
  update public.estimate_approvals approval
  set superseded_at = supersession_timestamp
  where approval.tenant_id = p_tenant_id
    and approval.version_id = p_version_id
    and approval.status = 'pending'::public.estimate_approval_status
    and approval.superseded_at is null;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_review_cycle_supersession',
    previous_supersession_setting,
    true
  );

  insert into public.estimate_review_cycles (
    id,
    tenant_id,
    version_id,
    cycle_number,
    requested_by,
    requested_at,
    submission_message,
    assigned_reviewer_id,
    carried_over_from_cycle_id
  )
  values (
    opened_cycle_id,
    p_tenant_id,
    p_version_id,
    coalesce(latest_cycle.cycle_number, 0) + 1,
    p_actor_user_id,
    supersession_timestamp,
    normalized_submission_message,
    p_assigned_reviewer_id,
    latest_cycle.id
  )
  returning * into opened_cycle;

  insert into public.estimate_approvals (
    tenant_id,
    version_id,
    rule_id,
    requested_by,
    status,
    review_cycle_id
  )
  select
    p_tenant_id,
    p_version_id,
    requested.rule_id,
    p_actor_user_id,
    'pending'::public.estimate_approval_status,
    opened_cycle.id
  from unnest(normalized_rule_ids) requested(rule_id)
  order by requested.rule_id;

  select coalesce(jsonb_agg(to_jsonb(approval) order by approval.rule_id), '[]')
    into opened_approvals
  from public.estimate_approvals approval
  where approval.tenant_id = p_tenant_id
    and approval.version_id = p_version_id
    and approval.review_cycle_id = opened_cycle.id
    and approval.status = 'pending'::public.estimate_approval_status
    and approval.superseded_at is null;

  perform public.log_estimate_version_event(
    p_version_id,
    'approval_submitted',
    p_actor_user_id,
    normalized_event_metadata || jsonb_build_object(
      'cycleId', opened_cycle.id,
      'cycleNumber', opened_cycle.cycle_number,
      'requestedRuleIds', to_jsonb(normalized_rule_ids),
      'requestedApprovalCount', requested_rule_count,
      'assignedReviewerUserId', p_assigned_reviewer_id,
      'submissionMessage', normalized_submission_message
    ),
    opened_cycle.requested_at
  );

  return jsonb_build_object(
    'created', true,
    'cycle', to_jsonb(opened_cycle),
    'approvals', opened_approvals
  );
end;
$$;

revoke all on function public.open_estimate_review_cycle(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid[],
  text,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.open_estimate_review_cycle(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid[],
  text,
  jsonb
) to service_role;

create or replace function public.decide_estimate_review_cycle(
  p_cycle_id uuid,
  p_decision public.estimate_review_decision,
  p_comments jsonb default '[]'::jsonb
)
returns table (
  cycle_id uuid,
  cycle_number integer,
  approval_ids uuid[],
  rule_ids uuid[],
  comment_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  scoped_tenant_id uuid := public.current_tenant_id();
  cycle_row public.estimate_review_cycles%rowtype;
  resolved_cycle_version_id uuid;
  current_content_revision bigint;
  updated_approval_count integer := 0;
  decision_timestamp timestamptz := now();
  next_status public.estimate_approval_status;
  resolved_comments jsonb := coalesce(p_comments, '[]'::jsonb);
  audit_comments jsonb := '[]'::jsonb;
  audit_scopes jsonb := '[]'::jsonb;
  audit_perimeter_label text := 'Affaire complete';
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if scoped_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONTEXT_REQUIRED';
  end if;

  if not public.has_tenant_role(
    scoped_tenant_id,
    array['admin'::public.tenant_role, 'director'::public.tenant_role]
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_APPROVAL_DECISION_FORBIDDEN';
  end if;

  if jsonb_typeof(resolved_comments) <> 'array' then
    raise exception using errcode = '22023', message = 'ESTIMATE_REVIEW_COMMENTS_INVALID';
  end if;

  if p_decision = 'changes_requested'::public.estimate_review_decision
    and jsonb_array_length(resolved_comments) = 0
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_CORRECTION_COMMENTS_REQUIRED';
  end if;

  if p_decision =
      'approved_with_reservations'::public.estimate_review_decision
    and jsonb_array_length(resolved_comments) = 0
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_RESERVATION_COMMENTS_REQUIRED';
  end if;

  next_status := case
    when p_decision = 'changes_requested'::public.estimate_review_decision
      then 'rejected'::public.estimate_approval_status
    else 'approved'::public.estimate_approval_status
  end;

  select cycle.version_id
    into resolved_cycle_version_id
  from public.estimate_review_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = scoped_tenant_id;

  if resolved_cycle_version_id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  select version.content_revision
    into current_content_revision
  from public.estimate_versions version
  where version.id = resolved_cycle_version_id
    and version.tenant_id = scoped_tenant_id
    and version.status = 'draft'::public.estimate_status
  for update;

  if current_content_revision is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_DRAFT_NOT_FOUND';
  end if;

  select cycle.*
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = scoped_tenant_id
    and cycle.version_id = resolved_cycle_version_id
  for update;

  if cycle_row.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  if cycle_row.superseded_at is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_SUPERSEDED';
  end if;

  if cycle_row.decision is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  if cycle_row.requested_content_revision is null
    or current_content_revision <> cycle_row.requested_content_revision
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_REVIEW_SNAPSHOT_STALE';
  end if;

  perform approval.id
  from public.estimate_approvals approval
  where approval.tenant_id = cycle_row.tenant_id
    and approval.version_id = cycle_row.version_id
    and approval.status = 'pending'::public.estimate_approval_status
    and approval.superseded_at is null
    and (
      approval.review_cycle_id = cycle_row.id
      or approval.review_cycle_id is null
    )
  order by approval.id
  for update of approval;

  if jsonb_array_length(resolved_comments) > 0 then
    with inserted_comments as (
      insert into public.estimate_review_comments (
        tenant_id,
        version_id,
        cycle_id,
        scope_type,
        scope_id,
        scope_label,
        comment,
        created_by
      )
      select
        cycle_row.tenant_id,
        cycle_row.version_id,
        cycle_row.id,
        comment.scope_type::public.estimate_review_comment_scope,
        comment.scope_id,
        comment.scope_label,
        comment.comment,
        current_user_id
      from jsonb_to_recordset(resolved_comments) as comment(
        scope_type text,
        scope_id uuid,
        scope_label text,
        comment text
      )
      returning
        estimate_review_comments.id,
        estimate_review_comments.tenant_id,
        estimate_review_comments.version_id,
        estimate_review_comments.cycle_id,
        estimate_review_comments.scope_type,
        estimate_review_comments.scope_id,
        estimate_review_comments.scope_label,
        estimate_review_comments.comment
    )
    insert into public.estimate_review_correction_items (
      tenant_id,
      version_id,
      cycle_id,
      source_comment_id,
      scope_type,
      scope_id,
      scope_label,
      comment
    )
    select
      inserted.tenant_id,
      inserted.version_id,
      inserted.cycle_id,
      inserted.id,
      inserted.scope_type,
      inserted.scope_id,
      inserted.scope_label,
      inserted.comment
    from inserted_comments inserted
    where p_decision =
      'changes_requested'::public.estimate_review_decision;
  end if;

  with updated as (
    update public.estimate_approvals approval
    set
      status = next_status,
      approved_by = current_user_id,
      decided_at = decision_timestamp,
      approved_content_revision = case
        when next_status = 'approved'::public.estimate_approval_status
          then current_content_revision
        else null
      end
    where approval.tenant_id = cycle_row.tenant_id
      and approval.version_id = cycle_row.version_id
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
      and (
        approval.review_cycle_id = cycle_row.id
        or approval.review_cycle_id is null
      )
    returning approval.id, approval.rule_id
  )
  select
    coalesce(array_agg(updated.id order by updated.id), '{}'::uuid[]),
    coalesce(array_agg(updated.rule_id order by updated.id), '{}'::uuid[]),
    count(*)::integer
  into approval_ids, rule_ids, updated_approval_count
  from updated;

  if updated_approval_count = 0 then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_APPROVALS_PENDING_NOT_FOUND';
  end if;

  update public.estimate_review_cycles cycle
  set
    decision = p_decision,
    decided_by = current_user_id,
    decided_at = decision_timestamp
  where cycle.id = cycle_row.id
    and cycle.tenant_id = cycle_row.tenant_id
    and cycle.decision is null
    and cycle.superseded_at is null
  returning cycle.id, cycle.cycle_number
  into cycle_id, cycle_number;

  if cycle_id is null then
    raise exception using errcode = '42501', message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  comment_count := jsonb_array_length(resolved_comments);

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'scopeType', comment.scope_type,
      'scopeId', comment.scope_id,
      'scopeLabel', comment.scope_label,
      'comment', comment.comment
    )),
    '[]'::jsonb
  )
  into audit_comments
  from jsonb_to_recordset(resolved_comments) as comment(
    scope_type text,
    scope_id uuid,
    scope_label text,
    comment text
  );

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'scopeType', scoped.scope_type,
      'scopeId', scoped.scope_id,
      'scopeLabel', scoped.scope_label
    )),
    '[]'::jsonb
  )
  into audit_scopes
  from (
    select distinct on (comment.scope_type, comment.scope_id)
      comment.scope_type,
      comment.scope_id,
      comment.scope_label
    from jsonb_to_recordset(resolved_comments) as comment(
      scope_type text,
      scope_id uuid,
      scope_label text,
      comment text
    )
    order by comment.scope_type, comment.scope_id, comment.scope_label
  ) scoped;

  if jsonb_array_length(audit_scopes) > 0 then
    audit_perimeter_label := audit_scopes->0->>'scopeLabel';
    if jsonb_array_length(audit_scopes) > 1 then
      audit_perimeter_label := audit_perimeter_label
        || ' + '
        || (jsonb_array_length(audit_scopes) - 1)::text
        || ' autres';
    end if;
  end if;

  perform public.log_estimate_version_event(
    cycle_row.version_id,
    'approval_decided',
    current_user_id,
    jsonb_build_object(
      'decision', p_decision,
      'approvalOutcome', next_status,
      'cycleId', cycle_id,
      'cycleNumber', cycle_number,
      'approvalIds', to_jsonb(approval_ids),
      'ruleIds', to_jsonb(rule_ids),
      'commentCount', comment_count,
      'scopeCount', jsonb_array_length(audit_scopes),
      'perimeterLabel', audit_perimeter_label,
      'scopes', audit_scopes,
      'comments', audit_comments,
      'rulesTriggered', '[]'::jsonb
    ),
    decision_timestamp
  );

  return next;
end;
$$;

revoke execute on function public.decide_estimate_review_cycle(
  uuid,
  public.estimate_review_decision,
  jsonb
) from public, anon;
grant execute on function public.decide_estimate_review_cycle(
  uuid,
  public.estimate_review_decision,
  jsonb
) to authenticated;

create or replace function public.decide_estimate_approval(
  p_approval_id uuid,
  p_status public.estimate_approval_status
)
returns public.estimate_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  scoped_tenant_id uuid := public.current_tenant_id();
  approval_row public.estimate_approvals%rowtype;
  cycle_row public.estimate_review_cycles%rowtype;
  resolved_approval_version_id uuid;
  resolved_approval_cycle_id uuid;
  current_content_revision bigint;
  decided_approval public.estimate_approvals;
  decision_timestamp timestamptz := now();
  remaining_pending_count integer := 0;
  cycle_decision public.estimate_review_decision;
  rule_label text := 'Regle de validation';
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if scoped_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONTEXT_REQUIRED';
  end if;

  if not public.has_tenant_role(
    scoped_tenant_id,
    array['admin'::public.tenant_role, 'director'::public.tenant_role]
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_APPROVAL_DECISION_FORBIDDEN';
  end if;

  if p_status not in (
    'approved'::public.estimate_approval_status,
    'rejected'::public.estimate_approval_status
  ) then
    raise exception using errcode = '22023', message = 'ESTIMATE_APPROVAL_STATUS_INVALID';
  end if;

  select approval.version_id, approval.review_cycle_id
    into resolved_approval_version_id, resolved_approval_cycle_id
  from public.estimate_approvals approval
  where approval.id = p_approval_id
    and approval.tenant_id = scoped_tenant_id;

  if resolved_approval_version_id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_APPROVAL_PENDING_NOT_FOUND';
  end if;

  select version.content_revision
    into current_content_revision
  from public.estimate_versions version
  where version.id = resolved_approval_version_id
    and version.tenant_id = scoped_tenant_id
    and version.status = 'draft'::public.estimate_status
  for update;

  if current_content_revision is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_DRAFT_NOT_FOUND';
  end if;

  if resolved_approval_cycle_id is not null then
    select cycle.*
      into cycle_row
    from public.estimate_review_cycles cycle
    where cycle.id = resolved_approval_cycle_id
      and cycle.tenant_id = scoped_tenant_id
      and cycle.version_id = resolved_approval_version_id
    for update;
  else
    select cycle.*
      into cycle_row
    from public.estimate_review_cycles cycle
    where cycle.tenant_id = scoped_tenant_id
      and cycle.version_id = resolved_approval_version_id
      and cycle.decision is null
      and cycle.superseded_at is null
    order by cycle.cycle_number desc
    limit 1
    for update;
  end if;

  select approval.*
    into approval_row
  from public.estimate_approvals approval
  where approval.id = p_approval_id
    and approval.tenant_id = scoped_tenant_id
    and approval.version_id = resolved_approval_version_id
  for update;

  if approval_row.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_APPROVAL_PENDING_NOT_FOUND';
  end if;

  if approval_row.superseded_at is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_APPROVAL_SUPERSEDED';
  end if;

  if approval_row.status <> 'pending'::public.estimate_approval_status then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_APPROVAL_PENDING_NOT_FOUND';
  end if;

  if resolved_approval_cycle_id is not null
    and (
      approval_row.review_cycle_id is distinct from
        resolved_approval_cycle_id
      or
      cycle_row.id is null
      or cycle_row.superseded_at is not null
      or cycle_row.decision is not null
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_NOT_ACTIVE';
  end if;

  if cycle_row.id is not null
    and (
      cycle_row.requested_content_revision is null
      or current_content_revision <> cycle_row.requested_content_revision
    )
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_REVIEW_SNAPSHOT_STALE';
  end if;

  update public.estimate_approvals approval
  set
    status = p_status,
    approved_by = current_user_id,
    decided_at = decision_timestamp,
    approved_content_revision = case
      when p_status = 'approved'::public.estimate_approval_status
        then current_content_revision
      else null
    end
  where approval.id = approval_row.id
    and approval.status = 'pending'::public.estimate_approval_status
    and approval.superseded_at is null
  returning approval.* into decided_approval;

  if decided_approval.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_APPROVAL_PENDING_NOT_FOUND';
  end if;

  select case rule.rule_type::text
    when 'min_margin' then 'Marge minimale'
    when 'max_discount' then 'Remise maximale'
    when 'require_approval' then 'Validation requise'
    when 'critical_exceptions_max' then 'Exceptions critiques'
    when 'missing_line_evidence_max' then 'Preuves de lignes manquantes'
    when 'dpgf_coverage_min' then 'Couverture DPGF'
    when 'takeoff_evidence_coverage_min' then 'Couverture des preuves de metre'
    else initcap(replace(rule.rule_type::text, '_', ' '))
  end
  into rule_label
  from public.estimate_rules rule
  where rule.id = decided_approval.rule_id
    and rule.tenant_id = decided_approval.tenant_id;

  rule_label := coalesce(rule_label, 'Regle de validation');

  select count(*)::integer
    into remaining_pending_count
  from public.estimate_approvals approval
  where approval.tenant_id = decided_approval.tenant_id
    and approval.version_id = decided_approval.version_id
    and approval.status = 'pending'::public.estimate_approval_status
    and approval.superseded_at is null
    and (
      cycle_row.id is null
      or approval.review_cycle_id = cycle_row.id
      or approval.review_cycle_id is null
    );

  if cycle_row.id is not null and remaining_pending_count = 0 then
    select case
      when exists (
        select 1
        from public.estimate_approvals approval
        where approval.tenant_id = cycle_row.tenant_id
          and approval.version_id = cycle_row.version_id
          and approval.superseded_at is null
          and (
            approval.review_cycle_id = cycle_row.id
            or approval.review_cycle_id is null
          )
          and approval.status = 'rejected'::public.estimate_approval_status
      ) then 'changes_requested'::public.estimate_review_decision
      else 'approved'::public.estimate_review_decision
    end
    into cycle_decision;

    -- This facade has no review-comment payload. It may record intermediate
    -- per-rule rejections, but it must not close a governed cycle as
    -- changes_requested without the mandatory comment/checklist transaction.
    if cycle_decision =
        'changes_requested'::public.estimate_review_decision
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_CORRECTION_COMMENTS_REQUIRED';
    end if;

    update public.estimate_review_cycles cycle
    set
      decision = cycle_decision,
      decided_by = current_user_id,
      decided_at = decision_timestamp
    where cycle.id = cycle_row.id
      and cycle.tenant_id = cycle_row.tenant_id
      and cycle.decision is null
      and cycle.superseded_at is null
    returning cycle.* into cycle_row;

    if cycle_row.decision is null then
      raise exception using errcode = '42501', message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
    end if;
  else
    cycle_decision := case
      when p_status = 'rejected'::public.estimate_approval_status
        then 'changes_requested'::public.estimate_review_decision
      else 'approved'::public.estimate_review_decision
    end;
  end if;

  perform public.log_estimate_version_event(
    decided_approval.version_id,
    'approval_decided',
    current_user_id,
    jsonb_build_object(
      'decision', cycle_decision,
      'approvalOutcome', p_status,
      'cycleId', cycle_row.id,
      'cycleNumber', cycle_row.cycle_number,
      'approvalIds', jsonb_build_array(decided_approval.id),
      'ruleIds', jsonb_build_array(decided_approval.rule_id),
      'commentCount', 0,
      'scopeCount', 1,
      'perimeterLabel', rule_label,
      'scopes', jsonb_build_array(jsonb_build_object(
        'scopeType', 'approval_rule',
        'scopeId', decided_approval.rule_id,
        'scopeLabel', rule_label
      )),
      'comments', '[]'::jsonb,
      'rulesTriggered', jsonb_build_array(jsonb_build_object(
        'ruleId', decided_approval.rule_id,
        'label', rule_label,
        'signalKey', 'approval',
        'message', 'Decision d approbation enregistree',
        'thresholdValue', 0,
        'actualValue', null,
        'sourceState', 'ready',
        'approvalStatus', p_status
      ))
    ),
    decision_timestamp
  );

  return decided_approval;
end;
$$;

revoke execute on function public.decide_estimate_approval(
  uuid,
  public.estimate_approval_status
) from public, anon;
grant execute on function public.decide_estimate_approval(
  uuid,
  public.estimate_approval_status
) to authenticated;

create or replace function public.capture_estimate_review_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_content_revision bigint;
  current_calc_engine_version smallint;
  current_snapshot_content_revision bigint;
  current_snapshot_context jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.requested_content_revision is distinct from old.requested_content_revision then
      raise exception
        using
          errcode = '42501',
          message = 'ESTIMATE_REVIEW_CONTENT_REVISION_IMMUTABLE';
    end if;
    return new;
  end if;

  select
    version.content_revision,
    version.calc_engine_version,
    version.calc_snapshot_content_revision,
    version.calc_snapshot_context
  into
    current_content_revision,
    current_calc_engine_version,
    current_snapshot_content_revision,
    current_snapshot_context
  from public.estimate_versions version
  where version.id = new.version_id
    and version.tenant_id = new.tenant_id
    and version.status = 'draft'::public.estimate_status
  for update;

  if current_content_revision is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_REVIEW_DRAFT_NOT_FOUND';
  end if;

  if current_calc_engine_version = 2 and (
      current_snapshot_content_revision is distinct from current_content_revision
      or current_snapshot_context is null
    )
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_SNAPSHOT_STALE';
  end if;

  new.requested_content_revision := current_content_revision;
  return new;
end;
$$;

revoke all on function public.capture_estimate_review_content_revision()
  from public, anon, authenticated;

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if (
      to_jsonb(new) - array['status', 'seal_hash', 'updated_at']
    ) is distinct from (
      to_jsonb(old) - array['status', 'seal_hash', 'updated_at']
    ) then
      raise exception 'Estimate version is read-only';
    end if;

    if old.status = 'sending' then
      if new.status = old.status and not (
        old.seal_hash is null
        and new.seal_hash is not null
        and new.seal_hash ~ '^[0-9a-fA-F]{64}$'
      ) then
        raise exception 'Estimate version is read-only';
      end if;
    else
      if new.status = old.status
        or new.seal_hash is distinct from old.seal_hash
      then
        raise exception 'Estimate version is read-only';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_version_workflow_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.calc_engine_version is distinct from old.calc_engine_version then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE';
  end if;

  if (
      new.calc_snapshot_content_revision is distinct from
        old.calc_snapshot_content_revision
      or new.calc_snapshot_context is distinct from old.calc_snapshot_context
    )
    and not (
      (
        current_user = 'service_role'
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) = 'on'
      )
      or (
        pg_trigger_depth() > 1
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_invalidation',
            true
          ),
          ''
        ) = 'on'
        and new.calc_snapshot_content_revision is null
        and new.calc_snapshot_context is null
      )
    )
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
  end if;

  if (
    new.status is distinct from old.status
    or new.seal_hash is distinct from old.seal_hash
  ) and current_user <> 'service_role' then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  if new.content_revision is distinct from old.content_revision
    and pg_trigger_depth() = 1
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_CONTENT_REVISION_IS_MANAGED';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.version_number is distinct from old.version_number
    or new.title is distinct from old.title
    or new.exclusions is distinct from old.exclusions
    or new.date_devis is distinct from old.date_devis
    or new.validite_jours is distinct from old.validite_jours
    or new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.currency is distinct from old.currency
    or new.margin_bp is distinct from old.margin_bp
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.global_coefficient is distinct from old.global_coefficient
    or new.max_section_depth is distinct from old.max_section_depth
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.parent_version_id is distinct from old.parent_version_id
    or new.variant_label is distinct from old.variant_label
    or new.calc_engine_version is distinct from old.calc_engine_version
    or new.contractor_role is distinct from old.contractor_role
    or new.calc_snapshot_context is distinct from old.calc_snapshot_context
  then
    new.content_revision := old.content_revision + 1;
  end if;

  return new;
end;
$$;

-- A v2 draft snapshot depends on tenant calculation context that lives outside
-- estimate_versions. Invalidate it in the same transaction as a relevant
-- context mutation, otherwise content_revision alone can report a stale
-- snapshot as fresh. Finalized versions remain immutable historical records.
create or replace function public.invalidate_estimate_v2_snapshot_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_tenant_id uuid;
  new_tenant_id uuid;
  old_role_id uuid;
  new_role_id uuid;
  old_flag_is_relevant boolean := false;
  new_flag_is_relevant boolean := false;
  previous_invalidation_setting text;
begin
  if tg_table_schema <> 'public' then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_INVALIDATION_SOURCE_INVALID';
  end if;

  if tg_table_name = 'margin_tiers' then
    if tg_op = 'UPDATE'
      and new.tenant_id is not distinct from old.tenant_id
      and new.threshold_cents is not distinct from old.threshold_cents
      and new.multiplier is not distinct from old.multiplier
      and new.position is not distinct from old.position
    then
      return new;
    end if;

    if tg_op <> 'INSERT' then
      old_tenant_id := old.tenant_id;
    end if;
    if tg_op <> 'DELETE' then
      new_tenant_id := new.tenant_id;
    end if;
  elsif tg_table_name = 'labor_roles' then
    if tg_op = 'UPDATE'
      and new.tenant_id is not distinct from old.tenant_id
      and new.user_id is not distinct from old.user_id
      and new.hourly_rate_cents is not distinct from old.hourly_rate_cents
    then
      return new;
    end if;

    if tg_op <> 'INSERT' then
      old_tenant_id := old.tenant_id;
      old_role_id := old.id;
    end if;
    if tg_op <> 'DELETE' then
      new_tenant_id := new.tenant_id;
      new_role_id := new.id;
    end if;
  elsif tg_table_name = 'feature_flags' then
    if tg_op <> 'INSERT' then
      old_flag_is_relevant :=
        pg_catalog.upper(pg_catalog.btrim(old.flag_key)) =
          'EST_031_LABOR_SPLIT';
    end if;
    if tg_op <> 'DELETE' then
      new_flag_is_relevant :=
        pg_catalog.upper(pg_catalog.btrim(new.flag_key)) =
          'EST_031_LABOR_SPLIT';
    end if;

    if not old_flag_is_relevant and not new_flag_is_relevant then
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end if;

    if tg_op = 'UPDATE'
      and new.tenant_id is not distinct from old.tenant_id
      and new.flag_key is not distinct from old.flag_key
      and new.enabled is not distinct from old.enabled
    then
      return new;
    end if;

    if old_flag_is_relevant then
      old_tenant_id := old.tenant_id;
    end if;
    if new_flag_is_relevant then
      new_tenant_id := new.tenant_id;
    end if;
  else
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_INVALIDATION_SOURCE_INVALID';
  end if;

  previous_invalidation_setting := pg_catalog.current_setting(
    'miaouffrage.estimate_v2_snapshot_invalidation',
    true
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_invalidation',
    'on',
    true
  );

  if tg_table_name = 'margin_tiers' then
    update public.estimate_versions version
    set
      calc_snapshot_content_revision = null,
      calc_snapshot_context = null
    where version.calc_engine_version = 2
      and version.status = 'draft'::public.estimate_status
      and version.margin_mode = 'tiered'::public.estimate_margin_mode
      and version.tenant_id in (old_tenant_id, new_tenant_id)
      and (
        version.calc_snapshot_content_revision is not null
        or version.calc_snapshot_context is not null
      );
  elsif tg_table_name = 'labor_roles' then
    update public.estimate_versions version
    set
      calc_snapshot_content_revision = null,
      calc_snapshot_context = null
    where version.calc_engine_version = 2
      and version.status = 'draft'::public.estimate_status
      and version.tenant_id in (old_tenant_id, new_tenant_id)
      and (
        version.calc_snapshot_content_revision is not null
        or version.calc_snapshot_context is not null
      )
      and exists (
        select 1
        from public.estimate_items item
        where item.version_id = version.id
          and item.tenant_id = version.tenant_id
          and (
            item.labor_role_id in (old_role_id, new_role_id)
            or item.labor_role_atelier_id in (old_role_id, new_role_id)
            or item.labor_role_chantier_id in (old_role_id, new_role_id)
          )
      );
  else
    update public.estimate_versions version
    set
      calc_snapshot_content_revision = null,
      calc_snapshot_context = null
    where version.calc_engine_version = 2
      and version.status = 'draft'::public.estimate_status
      and version.tenant_id in (old_tenant_id, new_tenant_id)
      and (
        version.calc_snapshot_content_revision is not null
        or version.calc_snapshot_context is not null
      );
  end if;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_invalidation',
    coalesce(previous_invalidation_setting, ''),
    true
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_estimate_v2_snapshot_context()
  from public, anon, authenticated, service_role;

drop trigger if exists invalidate_estimate_v2_snapshot_from_margin_tiers
  on public.margin_tiers;
create trigger invalidate_estimate_v2_snapshot_from_margin_tiers
  after insert or delete or update of
    tenant_id,
    threshold_cents,
    multiplier,
    position
  on public.margin_tiers
  for each row execute function public.invalidate_estimate_v2_snapshot_context();

drop trigger if exists invalidate_estimate_v2_snapshot_from_labor_roles
  on public.labor_roles;
create trigger invalidate_estimate_v2_snapshot_from_labor_roles
  after delete or update of tenant_id, user_id, hourly_rate_cents
  on public.labor_roles
  for each row execute function public.invalidate_estimate_v2_snapshot_context();

drop trigger if exists invalidate_estimate_v2_snapshot_from_feature_flags
  on public.feature_flags;
create trigger invalidate_estimate_v2_snapshot_from_feature_flags
  after insert or delete or update of tenant_id, flag_key, enabled
  on public.feature_flags
  for each row execute function public.invalidate_estimate_v2_snapshot_context();

create or replace function public.require_fresh_v2_snapshot_for_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  line_count bigint;
  complete_snapshot_count bigint;
  snapshot_total_ht bigint;
  snapshot_total_tax bigint;
  snapshot_total_ttc bigint;
begin
  if new.calc_engine_version <> 2
    or new.status not in (
      'sending'::public.estimate_status,
      'sent'::public.estimate_status
    )
    or new.status is not distinct from old.status
  then
    return new;
  end if;

  if new.calc_snapshot_content_revision is null
    or new.calc_snapshot_content_revision <> new.content_revision
    or new.calc_snapshot_context is null
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_SNAPSHOT_STALE';
  end if;

  select
    count(*),
    count(*) filter (
      where item.snapshot_pu_ht_cents is not null
        and item.snapshot_fo_ht_cents is not null
        and item.snapshot_mo_ht_cents is not null
        and item.snapshot_mo_atelier_ht_cents is not null
        and item.snapshot_mo_chantier_ht_cents is not null
        and item.line_total_ht_cents is not null
        and item.line_tax_cents is not null
        and item.line_total_ttc_cents is not null
        and item.snapshot_fo_ht_cents + item.snapshot_mo_ht_cents =
          item.line_total_ht_cents
        and item.snapshot_mo_atelier_ht_cents
          + item.snapshot_mo_chantier_ht_cents = item.snapshot_mo_ht_cents
        and item.line_total_ttc_cents =
          item.line_total_ht_cents + item.line_tax_cents
    ),
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
  into
    line_count,
    complete_snapshot_count,
    snapshot_total_ht,
    snapshot_total_tax,
    snapshot_total_ttc
  from public.estimate_items item
  where item.version_id = new.id
    and item.tenant_id = new.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  if line_count <> complete_snapshot_count
    or snapshot_total_ht <> new.total_ht_cents
    or snapshot_total_tax <> new.total_tax_cents
    or snapshot_total_ttc <> new.total_ttc_cents
  then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_V2_SNAPSHOT_INVALID';
  end if;

  return new;
end;
$$;

revoke all on function public.require_fresh_v2_snapshot_for_publication()
  from public, anon, authenticated;

drop trigger if exists aad_require_fresh_v2_snapshot_for_publication
  on public.estimate_versions;
create trigger aad_require_fresh_v2_snapshot_for_publication
  before update on public.estimate_versions
  for each row execute function public.require_fresh_v2_snapshot_for_publication();

create or replace function public.enforce_estimate_calc_engine_on_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.calc_engine_version not in (1, 2) then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED';
  end if;

  if (select auth.uid()) is not null
    and coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_version_insert_contract',
        true
      ),
      ''
    ) not in ('canonical_v2', 'duplicate_source', 'legacy_v1')
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_VERSION_CREATION_RPC_REQUIRED';
  end if;

  if coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  ) = 'canonical_v2'
  then
    new.calc_engine_version := 2;
  end if;

  if coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  ) = 'legacy_v1'
  then
    new.calc_engine_version := 1;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_estimate_calc_engine_on_insert()
  from public, anon, authenticated;

drop trigger if exists enforce_estimate_calc_engine_on_insert
  on public.estimate_versions;
create trigger enforce_estimate_calc_engine_on_insert
  before insert on public.estimate_versions
  for each row execute function public.enforce_estimate_calc_engine_on_insert();

-- Authenticated callers may create versions only through the hardened
-- SECURITY DEFINER duplication facade below. Direct relation inserts remain
-- unavailable even if a caller forges a custom session setting.
revoke insert on table public.estimate_versions from authenticated;

drop function if exists public.persist_estimate_creation_atomic(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb
);

create function public.persist_estimate_creation_atomic(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_project_payload jsonb,
  p_version_payload jsonb,
  p_items jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_user_id uuid := p_actor_user_id;
  actor_role public.tenant_role;
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  import_row public.dpgf_imports%rowtype;
  import_claimed_rows integer := 0;
  item_total_ht bigint := 0;
  item_total_tax bigint := 0;
  item_total_ttc bigint := 0;
  next_version_number integer;
  version_contractor_role text;
  previous_insert_contract text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select membership.role
    into actor_role
  from public.tenant_memberships membership
  join public.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.is_active
  where membership.tenant_id = p_tenant_id
    and membership.user_id = actor_user_id;

  if actor_user_id is null
    or p_tenant_id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CREATION_ROLE_REQUIRED';
  end if;

  if p_version_payload is null
    or jsonb_typeof(p_version_payload) <> 'object'
    or p_version_payload - array[
      'id',
      'title',
      'date_devis',
      'validite_jours',
      'margin_multiplier',
      'margin_mode',
      'currency',
      'margin_bp',
      'discount_bp',
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'calc_engine_version',
      'contractor_role',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents'
    ] <> '{}'::jsonb
    or coalesce(
      (p_version_payload->>'calc_engine_version')::smallint,
      2
    ) <> 2
    or coalesce(
      nullif(btrim(p_version_payload->>'contractor_role'), ''),
      'principal'
    ) not in ('principal', 'subcontractor')
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  version_contractor_role := coalesce(
    nullif(btrim(p_version_payload->>'contractor_role'), ''),
    'principal'
  )::text;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
  end if;

  -- The FK and hierarchy trigger are immediate, so make the accepted payload
  -- order explicit before any project/import mutation: every child must follow
  -- its section parent and every payload id must be unique and concrete.
  if exists (
    with payload_item as (
      select
        entry.ordinality,
        (entry.value->>'id')::uuid as id,
        (entry.value->>'parent_id')::uuid as parent_id,
        entry.value->>'item_type' as item_type
      from jsonb_array_elements(p_items) with ordinality
        as entry(value, ordinality)
    )
    select 1
    from payload_item as child
    left join payload_item as parent on parent.id = child.parent_id
    where child.id is null
      or child.item_type is null
      or child.item_type not in ('section', 'line')
      or (child.item_type = 'line' and child.parent_id is null)
      or (
        child.parent_id is not null
        and (
          parent.id is null
          or parent.item_type <> 'section'
          or parent.ordinality >= child.ordinality
        )
      )
    union all
    select 1
    from payload_item
    group by payload_item.id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_HIERARCHY_INVALID';
  end if;

  if p_import_id is not null then
    select source_import.*
      into import_row
    from public.dpgf_imports as source_import
    where source_import.id = p_import_id
      and source_import.tenant_id = p_tenant_id
      and (
        source_import.user_id = actor_user_id
        or actor_role = 'admin'::public.tenant_role
      )
    for update;

    if import_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'DPGF_IMPORT_NOT_WRITABLE';
    end if;

    if import_row.project_id is not null
      and (
        p_project_id is null
        or import_row.project_id <> p_project_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  if (p_version_payload->>'total_ht_cents') is null
    or (p_version_payload->>'total_tax_cents') is null
    or (p_version_payload->>'total_ttc_cents') is null
    or (p_version_payload->>'total_ht_cents')::integer < 0
    or (p_version_payload->>'total_tax_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer <>
      (p_version_payload->>'total_ht_cents')::integer
      + (p_version_payload->>'total_tax_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_INVALID';
  end if;

  if version_contractor_role = 'subcontractor'
    and (
      (p_version_payload->>'total_tax_cents')::integer <> 0
      or (p_version_payload->>'total_ttc_cents')::integer <>
        (p_version_payload->>'total_ht_cents')::integer
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      item_type public.estimate_item_type,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    )
    where item.item_type = 'line'
      and (
        item.line_total_ht_cents is null
        or item.line_tax_cents is null
        or item.line_total_ttc_cents is null
        or item.line_total_ht_cents < 0
        or item.line_tax_cents < 0
        or item.line_total_ttc_cents < 0
        or item.line_total_ttc_cents <>
          item.line_total_ht_cents + item.line_tax_cents
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEM_TOTALS_INVALID';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
    into item_total_ht, item_total_tax, item_total_ttc
  from jsonb_to_recordset(p_items) as item(
    item_type public.estimate_item_type,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.item_type = 'line'::public.estimate_item_type;

  if item_total_ht <> (p_version_payload->>'total_ht_cents')::integer
    or item_total_tax <> (p_version_payload->>'total_tax_cents')::integer
    or item_total_ttc <> (p_version_payload->>'total_ttc_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_job_id uuid
    )
    left join public.estimate_categories category
      on category.id = item.category_id
     and category.tenant_id = p_tenant_id
    left join public.supply_types supply_type
      on supply_type.id = item.supply_type_id
     and supply_type.tenant_id = p_tenant_id
    left join public.supplier_pricebook supplier_price
      on supplier_price.id = item.selected_supplier_price_id
     and supplier_price.tenant_id = p_tenant_id
    left join public.takeoff_jobs source_job
      on source_job.id = item.source_job_id
     and source_job.tenant_id = p_tenant_id
    where (item.category_id is not null and category.id is null)
      or (item.supply_type_id is not null and supply_type.id is null)
      or (
        item.selected_supplier_price_id is not null
        and supplier_price.id is null
      )
      or (item.source_job_id is not null and source_job.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_ITEM_REFERENCE_TENANT_MISMATCH';
  end if;

  if p_project_id is null then
    if p_project_payload is null
      or jsonb_typeof(p_project_payload) <> 'object'
      or p_project_payload - array[
        'id',
        'name',
        'reference',
        'client_name',
        'notes'
      ] <> '{}'::jsonb
      or btrim(coalesce(p_project_payload->>'name', '')) = ''
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_PAYLOAD_INVALID';
    end if;

    insert into public.estimate_projects (
      id,
      tenant_id,
      user_id,
      name,
      reference,
      client_name,
      notes,
      is_archived
    )
    values (
      (p_project_payload->>'id')::uuid,
      p_tenant_id,
      actor_user_id,
      btrim(p_project_payload->>'name'),
      nullif(btrim(p_project_payload->>'reference'), ''),
      nullif(btrim(p_project_payload->>'client_name'), ''),
      nullif(btrim(p_project_payload->>'notes'), ''),
      false
    )
    returning * into project_row;

    next_version_number := 1;
  else
    if p_project_payload is not null then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_SELECTOR_INVALID';
    end if;

    select project.*
      into project_row
    from public.estimate_projects as project
    where project.id = p_project_id
      and project.tenant_id = p_tenant_id
    for update;

    if project_row.id is null
      or project_row.is_archived
      or (
        project_row.user_id <> actor_user_id
        and actor_role <> 'admin'::public.tenant_role
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_PROJECT_NOT_WRITABLE';
    end if;

    select coalesce(max(version.version_number), 0) + 1
      into next_version_number
    from public.estimate_versions as version
    where version.project_id = project_row.id
      and version.tenant_id = p_tenant_id;
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from jsonb_to_recordset(p_items) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(p_items) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(p_items) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      labor_role_id uuid,
      labor_role_atelier_id uuid,
      labor_role_chantier_id uuid
    )
    left join public.labor_roles labor_role
      on labor_role.id = item.labor_role_id
     and labor_role.tenant_id = p_tenant_id
     and labor_role.user_id = project_row.user_id
    left join public.labor_roles atelier_role
      on atelier_role.id = item.labor_role_atelier_id
     and atelier_role.tenant_id = p_tenant_id
     and atelier_role.user_id = project_row.user_id
    left join public.labor_roles chantier_role
      on chantier_role.id = item.labor_role_chantier_id
     and chantier_role.tenant_id = p_tenant_id
     and chantier_role.user_id = project_row.user_id
    where (item.labor_role_id is not null and labor_role.id is null)
      or (item.labor_role_atelier_id is not null and atelier_role.id is null)
      or (item.labor_role_chantier_id is not null and chantier_role.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if import_row.id is not null and import_row.project_id is null then
    update public.dpgf_imports as source_import
    set project_id = project_row.id
    where source_import.id = import_row.id
      and source_import.tenant_id = p_tenant_id
      and source_import.project_id is null;

    get diagnostics import_claimed_rows = row_count;
    if import_claimed_rows <> 1 then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    'canonical_v2',
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    (p_version_payload->>'id')::uuid,
    p_tenant_id,
    project_row.id,
    next_version_number,
    'draft'::public.estimate_status,
    nullif(btrim(p_version_payload->>'title'), ''),
    (p_version_payload->>'date_devis')::date,
    (p_version_payload->>'validite_jours')::integer,
    (p_version_payload->>'margin_multiplier')::numeric,
    (p_version_payload->>'margin_mode')::public.estimate_margin_mode,
    p_version_payload->>'currency',
    (p_version_payload->>'margin_bp')::integer,
    (p_version_payload->>'discount_bp')::integer,
    (p_version_payload->>'discount_mode')::public.estimate_discount_mode,
    array(
      select discount_step.value::integer
      from jsonb_array_elements_text(p_version_payload->'discount_steps')
        as discount_step(value)
    ),
    (p_version_payload->>'global_coefficient')::numeric,
    (p_version_payload->>'tax_rate_bp')::integer,
    (p_version_payload->>'rounding_mode')::public.estimate_rounding_mode,
    (p_version_payload->>'rounding_step_cents')::integer,
    (p_version_payload->>'max_section_depth')::integer,
    coalesce((p_version_payload->>'calc_engine_version')::smallint, 2),
    version_contractor_role::text,
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer
  )
  returning * into version_row;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  if jsonb_array_length(p_items) > 0 then
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      h_mo_atelier,
      k_mo_atelier,
      labor_role_atelier_id,
      h_mo_chantier,
      k_mo_chantier,
      labor_role_chantier_id,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      source_metadata,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    select
      coalesce(item.id, gen_random_uuid()),
      p_tenant_id,
      version_row.id,
      item.parent_id,
      item.item_type,
      item.position,
      item.title,
      item.description,
      item.quantity,
      item.unit_price_ht_cents,
      item.tax_rate_bp,
      item.k_fo,
      item.h_mo,
      coalesce(item.h_mo_majoration, 1),
      item.k_mo,
      item.h_mo_atelier,
      coalesce(item.k_mo_atelier, 1),
      item.labor_role_atelier_id,
      item.h_mo_chantier,
      coalesce(item.k_mo_chantier, 1),
      item.labor_role_chantier_id,
      item.pu_ht_cents,
      item.labor_role_id,
      item.category_id,
      item.supply_type_id,
      item.selected_supplier_price_id,
      item.source_provider,
      item.source_job_id,
      item.source_file_name,
      item.source_page,
      coalesce(item.source_metadata, '{}'::jsonb),
      item.line_total_ht_cents,
      item.line_tax_cents,
      item.line_total_ttc_cents
    from jsonb_to_recordset(p_items) as item(
      id uuid,
      parent_id uuid,
      item_type public.estimate_item_type,
      position integer,
      title text,
      description text,
      quantity numeric,
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric,
      h_mo numeric,
      h_mo_majoration numeric,
      k_mo numeric,
      h_mo_atelier numeric,
      k_mo_atelier numeric,
      labor_role_atelier_id uuid,
      h_mo_chantier numeric,
      k_mo_chantier numeric,
      labor_role_chantier_id uuid,
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer,
      source_metadata jsonb,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    );
  end if;

  return jsonb_build_object(
    'project', to_jsonb(project_row),
    'version', to_jsonb(version_row)
  );
end;
$$;

revoke all on function public.persist_estimate_creation_atomic(
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;
grant execute on function public.persist_estimate_creation_atomic(
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  uuid
) to service_role;

create or replace function public.freeze_estimate_v2_snapshot(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_actor_user_id uuid,
  p_purpose text,
  p_calculation_context jsonb,
  p_item_snapshots jsonb,
  p_version_totals jsonb
)
returns public.estimate_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  actor_role public.tenant_role;
  snapshot_count bigint;
  distinct_snapshot_count bigint;
  stored_line_count bigint;
  snapshot_total_ht bigint;
  snapshot_total_tax bigint;
  snapshot_total_ttc bigint;
  expected_total_ht integer;
  expected_total_tax integer;
  expected_total_ttc integer;
  expected_calculation_context jsonb;
  effective_labor_roles jsonb;
  effective_margin_tiers jsonb;
  effective_margin_multiplier numeric;
  labor_split_enabled boolean;
  frozen_version public.estimate_versions;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_purpose not in ('send', 'approval') then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_SNAPSHOT_PURPOSE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  join public.tenants tenant
    on tenant.id = version.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = version.tenant_id
   and membership.user_id = p_actor_user_id
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  select project.user_id, membership.role
    into project_owner_id, actor_role
  from public.estimate_projects project
  join public.tenants tenant
    on tenant.id = project.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = project.tenant_id
   and membership.user_id = p_actor_user_id
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
  for share of project, tenant, membership;

  if target_version.id is null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_NOT_WRITABLE';
  end if;

  if actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    or (
      project_owner_id <> p_actor_user_id
      and actor_role <> 'admin'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_NOT_WRITABLE';
  end if;

  if p_purpose = 'send' and not exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id = p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  if p_purpose = 'approval' and exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id <> p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_CONFLICT';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.content_revision is distinct from p_expected_content_revision then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status <> 'draft'::public.estimate_status
    or target_version.calc_engine_version <> 2
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT';
  end if;

  if p_calculation_context is null
    or jsonb_typeof(p_calculation_context) <> 'object'
    or p_calculation_context - array[
      'labor_split_enabled',
      'labor_roles',
      'margin_tiers',
      'effective_margin_multiplier'
    ] <> '{}'::jsonb
    or not p_calculation_context ?& array[
      'labor_split_enabled',
      'labor_roles',
      'margin_tiers',
      'effective_margin_multiplier'
    ]
    or jsonb_typeof(p_calculation_context->'labor_split_enabled') <> 'boolean'
    or jsonb_typeof(p_calculation_context->'labor_roles') <> 'array'
    or jsonb_typeof(p_calculation_context->'margin_tiers') <> 'array'
    or jsonb_typeof(
      p_calculation_context->'effective_margin_multiplier'
    ) <> 'number'
    or (p_calculation_context->>'effective_margin_multiplier')::numeric <= 0
    or (p_calculation_context->>'effective_margin_multiplier')::numeric > 100
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_CALCULATION_CONTEXT_INVALID';
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_atelier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_chantier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from (
      select item.labor_role_id as role_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_atelier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_chantier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
    ) referenced
    left join public.labor_roles role
      on role.id = referenced.role_id
     and role.tenant_id = target_version.tenant_id
     and role.user_id = project_owner_id
    where referenced.role_id is not null
      and role.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', referenced.role_id,
          'hourly_rate_cents', coalesce(role.hourly_rate_cents, 0)
        )
        order by referenced.role_id
      ),
      '[]'::jsonb
    )
    into effective_labor_roles
  from (
    select item.labor_role_id as role_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    union
    select item.labor_role_atelier_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    union
    select item.labor_role_chantier_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
  ) referenced
  left join public.labor_roles role
    on role.id = referenced.role_id
   and role.tenant_id = target_version.tenant_id
   and role.user_id = project_owner_id
  where referenced.role_id is not null;

  if target_version.margin_mode = 'tiered'::public.estimate_margin_mode then
    perform tier.id
    from public.margin_tiers tier
    where tier.tenant_id = target_version.tenant_id
    order by tier.threshold_cents, tier.position, tier.id
    for share;

    select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'threshold_cents', tier.threshold_cents,
            'multiplier', tier.multiplier
          )
          order by tier.threshold_cents, tier.position, tier.id
        ),
        '[]'::jsonb
      )
      into effective_margin_tiers
    from public.margin_tiers tier
    where tier.tenant_id = target_version.tenant_id;

    if effective_margin_tiers = '[]'::jsonb then
      effective_margin_tiers := '[
        {"threshold_cents": 0, "multiplier": 1.6},
        {"threshold_cents": 10000000, "multiplier": 1.45},
        {"threshold_cents": 100000000, "multiplier": 1.4}
      ]'::jsonb;
    end if;
  else
    effective_margin_tiers := '[]'::jsonb;
  end if;

  effective_margin_multiplier :=
    (p_calculation_context->>'effective_margin_multiplier')::numeric;

  if target_version.margin_mode = 'fixed'::public.estimate_margin_mode then
    if effective_margin_multiplier is distinct from
      target_version.margin_multiplier
    then
      raise exception using
        errcode = '40001',
        message = 'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT';
    end if;
  elsif not exists (
    select 1
    from jsonb_to_recordset(effective_margin_tiers) as tier(
      threshold_cents bigint,
      multiplier numeric
    )
    where tier.multiplier = effective_margin_multiplier
  ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT';
  end if;

  perform flag.id
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT'
  for share;

  select coalesce(bool_or(flag.enabled), false)
    into labor_split_enabled
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT';

  -- Mirror the v2 calculator's mode selection. When the tenant flag is on but
  -- a line has no active split payload, h_mo still uses the legacy role. Once
  -- a split payload is active, legacy h_mo is ignored and each positive
  -- atelier/chantier duration must carry its dedicated role.
  if exists (
    select 1
    from public.estimate_items item
    cross join lateral (
      select labor_split_enabled and (
        coalesce(item.h_mo_atelier, 0) > 0
        or item.labor_role_atelier_id is not null
        or coalesce(item.h_mo_chantier, 0) > 0
        or item.labor_role_chantier_id is not null
        or coalesce(item.k_mo_atelier, 1) <> 1
        or coalesce(item.k_mo_chantier, 1) <> 1
      ) as use_split
    ) calculation_mode
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and (
        (
          not calculation_mode.use_split
          and coalesce(item.h_mo, 0) > 0
          and item.labor_role_id is null
        )
        or (
          calculation_mode.use_split
          and (
            (
              coalesce(item.h_mo_atelier, 0) > 0
              and item.labor_role_atelier_id is null
            )
            or (
              coalesce(item.h_mo_chantier, 0) > 0
              and item.labor_role_chantier_id is null
            )
          )
        )
      )
  ) then
    raise exception using
      errcode = '23502',
      message = 'ESTIMATE_V2_LABOR_ROLE_REQUIRED';
  end if;

  expected_calculation_context := jsonb_build_object(
    'labor_split_enabled', labor_split_enabled,
    'labor_roles', effective_labor_roles,
    'margin_tiers', effective_margin_tiers,
    'effective_margin_multiplier', effective_margin_multiplier
  );

  if p_calculation_context is distinct from expected_calculation_context then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_CALCULATION_CONTEXT_CONFLICT';
  end if;

  if p_item_snapshots is null
    or jsonb_typeof(p_item_snapshots) <> 'array'
    or exists (
      select 1
      from jsonb_array_elements(p_item_snapshots) snapshot(value)
      where jsonb_typeof(snapshot.value) <> 'object'
        or snapshot.value - array[
          'id',
          'snapshot_pu_ht_cents',
          'snapshot_fo_ht_cents',
          'snapshot_mo_ht_cents',
          'snapshot_mo_atelier_ht_cents',
          'snapshot_mo_chantier_ht_cents',
          'line_total_ht_cents',
          'line_tax_cents',
          'line_total_ttc_cents'
        ] <> '{}'::jsonb
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_ITEM_SNAPSHOT_INVALID';
  end if;

  if p_version_totals is null
    or jsonb_typeof(p_version_totals) <> 'object'
    or p_version_totals - array[
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_TOTALS_INVALID';
  end if;

  expected_total_ht := (p_version_totals->>'total_ht_cents')::integer;
  expected_total_tax := (p_version_totals->>'total_tax_cents')::integer;
  expected_total_ttc := (p_version_totals->>'total_ttc_cents')::integer;

  if expected_total_ht is null
    or expected_total_tax is null
    or expected_total_ttc is null
    or expected_total_ht < 0
    or expected_total_tax < 0
    or expected_total_ttc < 0
    or expected_total_ttc <> expected_total_ht + expected_total_tax
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_TOTALS_INVALID';
  end if;

  select
    count(*),
    count(distinct snapshot.id),
    coalesce(sum(snapshot.line_total_ht_cents), 0),
    coalesce(sum(snapshot.line_tax_cents), 0),
    coalesce(sum(snapshot.line_total_ttc_cents), 0)
  into
    snapshot_count,
    distinct_snapshot_count,
    snapshot_total_ht,
    snapshot_total_tax,
    snapshot_total_ttc
  from jsonb_to_recordset(p_item_snapshots) as snapshot(
    id uuid,
    snapshot_pu_ht_cents integer,
    snapshot_fo_ht_cents integer,
    snapshot_mo_ht_cents integer,
    snapshot_mo_atelier_ht_cents integer,
    snapshot_mo_chantier_ht_cents integer,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where snapshot.id is not null
    and snapshot.snapshot_pu_ht_cents is not null
    and snapshot.snapshot_fo_ht_cents is not null
    and snapshot.snapshot_mo_ht_cents is not null
    and snapshot.snapshot_mo_atelier_ht_cents is not null
    and snapshot.snapshot_mo_chantier_ht_cents is not null
    and snapshot.snapshot_pu_ht_cents >= 0
    and snapshot.snapshot_fo_ht_cents >= 0
    and snapshot.snapshot_mo_ht_cents >= 0
    and snapshot.snapshot_mo_atelier_ht_cents >= 0
    and snapshot.snapshot_mo_chantier_ht_cents >= 0
    and snapshot.snapshot_fo_ht_cents + snapshot.snapshot_mo_ht_cents =
      snapshot.line_total_ht_cents
    and snapshot.snapshot_mo_atelier_ht_cents
      + snapshot.snapshot_mo_chantier_ht_cents = snapshot.snapshot_mo_ht_cents
    and snapshot.line_total_ht_cents is not null
    and snapshot.line_tax_cents is not null
    and snapshot.line_total_ttc_cents is not null
    and snapshot.line_total_ht_cents >= 0
    and snapshot.line_tax_cents >= 0
    and snapshot.line_total_ttc_cents >= 0
    and snapshot.line_total_ttc_cents =
      snapshot.line_total_ht_cents + snapshot.line_tax_cents;

  if snapshot_count <> jsonb_array_length(p_item_snapshots)
    or distinct_snapshot_count <> snapshot_count
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_ITEM_SNAPSHOT_INVALID';
  end if;

  select count(*)
    into stored_line_count
  from public.estimate_items item
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  if stored_line_count <> snapshot_count
    or exists (
      select 1
      from jsonb_to_recordset(p_item_snapshots) as snapshot(id uuid)
      left join public.estimate_items item
        on item.id = snapshot.id
       and item.version_id = target_version.id
       and item.tenant_id = target_version.tenant_id
       and item.item_type = 'line'::public.estimate_item_type
      where item.id is null
    )
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_ITEM_SNAPSHOT_CONFLICT';
  end if;

  if snapshot_total_ht <> expected_total_ht
    or snapshot_total_tax <> expected_total_tax
    or snapshot_total_ttc <> expected_total_ttc
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_SNAPSHOT_TOTALS_MISMATCH';
  end if;

  if target_version.calc_snapshot_content_revision =
      target_version.content_revision
    and target_version.calc_snapshot_context = p_calculation_context
    and target_version.total_ht_cents = expected_total_ht
    and target_version.total_tax_cents = expected_total_tax
    and target_version.total_ttc_cents = expected_total_ttc
    and not exists (
      select 1
      from public.estimate_items item
      join jsonb_to_recordset(p_item_snapshots) as snapshot(
        id uuid,
        snapshot_pu_ht_cents integer,
        snapshot_fo_ht_cents integer,
        snapshot_mo_ht_cents integer,
        snapshot_mo_atelier_ht_cents integer,
        snapshot_mo_chantier_ht_cents integer,
        line_total_ht_cents integer,
        line_tax_cents integer,
        line_total_ttc_cents integer
      ) on snapshot.id = item.id
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
        and item.item_type = 'line'::public.estimate_item_type
        and (
          item.snapshot_pu_ht_cents is distinct from
            snapshot.snapshot_pu_ht_cents
          or item.snapshot_fo_ht_cents is distinct from
            snapshot.snapshot_fo_ht_cents
          or item.snapshot_mo_ht_cents is distinct from
            snapshot.snapshot_mo_ht_cents
          or item.snapshot_mo_atelier_ht_cents is distinct from
            snapshot.snapshot_mo_atelier_ht_cents
          or item.snapshot_mo_chantier_ht_cents is distinct from
            snapshot.snapshot_mo_chantier_ht_cents
          or item.line_total_ht_cents is distinct from
            snapshot.line_total_ht_cents
          or item.line_tax_cents is distinct from snapshot.line_tax_cents
          or item.line_total_ttc_cents is distinct from
            snapshot.line_total_ttc_cents
        )
    )
  then
    return target_version;
  end if;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'on',
    true
  );

  update public.estimate_items item
  set
    snapshot_pu_ht_cents = snapshot.snapshot_pu_ht_cents,
    snapshot_fo_ht_cents = snapshot.snapshot_fo_ht_cents,
    snapshot_mo_ht_cents = snapshot.snapshot_mo_ht_cents,
    snapshot_mo_atelier_ht_cents = snapshot.snapshot_mo_atelier_ht_cents,
    snapshot_mo_chantier_ht_cents = snapshot.snapshot_mo_chantier_ht_cents,
    line_total_ht_cents = snapshot.line_total_ht_cents,
    line_tax_cents = snapshot.line_tax_cents,
    line_total_ttc_cents = snapshot.line_total_ttc_cents
  from jsonb_to_recordset(p_item_snapshots) as snapshot(
    id uuid,
    snapshot_pu_ht_cents integer,
    snapshot_fo_ht_cents integer,
    snapshot_mo_ht_cents integer,
    snapshot_mo_atelier_ht_cents integer,
    snapshot_mo_chantier_ht_cents integer,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.id = snapshot.id
    and item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id;

  update public.estimate_versions version
  set
    total_ht_cents = expected_total_ht,
    total_tax_cents = expected_total_tax,
    total_ttc_cents = expected_total_ttc,
    calc_snapshot_context = p_calculation_context
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id
  returning version.* into frozen_version;

  update public.estimate_versions version
  set calc_snapshot_content_revision = version.content_revision
  where version.id = frozen_version.id
    and version.tenant_id = frozen_version.tenant_id
  returning version.* into frozen_version;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'off',
    true
  );

  if frozen_version.id is null then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  return frozen_version;
end;
$$;

revoke all on function public.freeze_estimate_v2_snapshot(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.freeze_estimate_v2_snapshot(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

create or replace function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
  item_id_map jsonb := '{}'::jsonb;
  previous_insert_contract text;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
    and p.tenant_id = v.tenant_id
  join public.tenants tenant
    on tenant.id = p.tenant_id
    and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = p.tenant_id
    and membership.user_id = actor_user_id
  where v.id = duplicate_estimate_version.source_version_id
    and not p.is_archived
    and membership.role in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    and (
      p.user_id = actor_user_id
      or membership.role = 'admin'::public.tenant_role
    )
  for update of p, v;

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := duplicate_estimate_version.source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    'duplicate_source',
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    exclusions,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label,
    max_section_depth
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.exclusions,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.calc_engine_version,
    source_version.contractor_role,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label,
    source_version.max_section_depth
  );

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  select coalesce(
    jsonb_object_agg(item.id::text, gen_random_uuid()::text),
    '{}'::jsonb
  )
    into item_id_map
  from public.estimate_items as item
  where item.version_id = duplicate_estimate_version.source_version_id
    and item.tenant_id = source_version.tenant_id;

  with recursive source_item_hierarchy as (
    select
      root.id,
      root.parent_id,
      0 as depth
    from public.estimate_items root
    where root.version_id = duplicate_estimate_version.source_version_id
      and root.parent_id is null

    union all

    select
      child.id,
      child.parent_id,
      parent.depth + 1
    from public.estimate_items child
    join source_item_hierarchy parent on parent.id = child.parent_id
    where child.version_id = duplicate_estimate_version.source_version_id
  )
  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    aid,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    selected_supplier_price_id,
    source_provider,
    source_job_id,
    source_file_name,
    source_page,
    source_metadata,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    (item_id_map->>hierarchy.id::text)::uuid,
    source_version.tenant_id,
    new_version_id,
    (item_id_map->>src.parent_id::text)::uuid,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.aid,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from source_item_hierarchy hierarchy
  join public.estimate_items src on src.id = hierarchy.id
  order by hierarchy.depth asc, src.position asc, src.id asc;

  with carry_over_takeoff_jobs as materialized (
    select
      job.id as takeoff_job_id,
      job.estimate_version_id as provenance_source_version_id
    from public.takeoff_jobs job
    where job.tenant_id = source_version.tenant_id
      and (
        job.estimate_version_id = duplicate_estimate_version.source_version_id
        or exists (
          select 1
          from public.takeoff_version_links inherited_link
          where inherited_link.tenant_id = source_version.tenant_id
            and inherited_link.takeoff_job_id = job.id
            and inherited_link.target_version_id =
              duplicate_estimate_version.source_version_id
        )
        or exists (
          select 1
          from public.takeoff_dpgf_review_decisions decision
          where decision.tenant_id = source_version.tenant_id
            and decision.takeoff_job_id = job.id
            and decision.version_id =
              duplicate_estimate_version.source_version_id
        )
      )
    order by job.id
    for share of job
  )
  insert into public.takeoff_version_links (
    tenant_id,
    takeoff_job_id,
    source_version_id,
    target_version_id,
    linked_at,
    linked_by
  )
  select
    source_version.tenant_id,
    candidate.takeoff_job_id,
    candidate.provenance_source_version_id,
    new_version_id,
    now(),
    null
  from carry_over_takeoff_jobs candidate
  on conflict (takeoff_job_id, target_version_id) do nothing;

  insert into public.takeoff_dpgf_review_decisions (
    id,
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    review_reference,
    line_label,
    line_position,
    source_file_name,
    source_page,
    carried_over_from_version_id,
    carried_over_at,
    decision,
    reason,
    decided_at,
    updated_at,
    decided_by
  )
  select
    gen_random_uuid(),
    src.tenant_id,
    new_version_id,
    src.takeoff_job_id,
    (item_id_map->>src.estimate_item_id::text)::uuid,
    src.review_reference,
    src.line_label,
    src.line_position,
    src.source_file_name,
    src.source_page,
    duplicate_estimate_version.source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version.source_version_id;

  return new_version_id;
end;
$$;

revoke all on function public.duplicate_estimate_version(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.duplicate_estimate_version(uuid, boolean)
  to authenticated;

-- The application now routes every template/import creation through the
-- canonical service-role facade above. Keep the legacy functions only for
-- migration-history compatibility and remove their Data API capability.
revoke all on function public.instantiate_estimate_from_template(
  uuid,
  text,
  text,
  date,
  integer
) from public, anon, authenticated;
revoke all on function public.instantiate_estimate_template_into_project(
  uuid,
  uuid,
  text,
  date,
  integer
) from public, anon, authenticated;
revoke all on function public.create_affaire_from_import_lines(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.create_estimate_version_from_import_lines(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public, anon, authenticated;

-- Superseded review cycles are historical records, never actionable queue
-- entries. Keep the established result contract while filtering the source
-- CTE once so every downstream aggregate sees only the active cycle.
create or replace function public.list_approval_queue(
  p_sort_by text default 'priority'
)
returns table (
  project_id uuid,
  version_id uuid,
  cycle_id uuid,
  project_name text,
  client_name text,
  version_number integer,
  amount_ht_cents bigint,
  margin_bp integer,
  requested_at timestamptz,
  submission_message text,
  comment_count bigint,
  reviewer_state text,
  exception_count bigint,
  max_risk_score integer,
  cause_code_counts jsonb,
  latest_job_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  scoped_tenant_id uuid := public.current_tenant_id();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if scoped_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONTEXT_REQUIRED';
  end if;

  if not (
    select public.has_tenant_role(
      scoped_tenant_id,
      array['admin'::public.tenant_role, 'director'::public.tenant_role]
    )
  ) then
    raise exception using errcode = '42501', message = 'APPROVAL_QUEUE_ACCESS_DENIED';
  end if;

  return query
  with open_cycles as (
    select
      cycle.id as cycle_id,
      cycle.version_id,
      cycle.requested_at,
      cycle.submission_message,
      cycle.tenant_id
    from public.estimate_review_cycles cycle
    where cycle.decision is null
      and cycle.superseded_at is null
      and cycle.tenant_id = scoped_tenant_id
  ),
  cycle_versions as (
    select
      open_cycle.cycle_id,
      open_cycle.requested_at,
      open_cycle.submission_message,
      version.id as version_id,
      version.project_id,
      version.version_number,
      version.total_ht_cents::bigint as amount_ht_cents,
      case
        when version.calc_engine_version = 1 then version.margin_bp
        when version.calc_snapshot_content_revision = version.content_revision
          and jsonb_typeof(
          version.calc_snapshot_context->'effective_margin_multiplier'
        ) = 'number'
          and (
            version.calc_snapshot_context->>'effective_margin_multiplier'
          )::numeric > 0
        then greatest(
          0,
          round(
            (
              1 - 1 / (
                version.calc_snapshot_context->>
                  'effective_margin_multiplier'
              )::numeric
            ) * 10000
          )::integer
        )
        else null
      end as margin_bp
    from open_cycles open_cycle
    join public.estimate_versions version
      on version.id = open_cycle.version_id
     and version.tenant_id = open_cycle.tenant_id
  ),
  with_project as (
    select
      cycle_version.*,
      project.name as project_name,
      project.client_name
    from cycle_versions cycle_version
    join public.estimate_projects project
      on project.id = cycle_version.project_id
  ),
  comments_agg as (
    select
      comment.cycle_id,
      count(*) as comment_count
    from public.estimate_review_comments comment
    join open_cycles open_cycle on open_cycle.cycle_id = comment.cycle_id
    group by comment.cycle_id
  ),
  reviewer_states as (
    select
      queue_state.cycle_id,
      queue_state.state as reviewer_state
    from public.approval_queue_reviewer_states queue_state
    where queue_state.tenant_id = scoped_tenant_id
      and queue_state.reviewer_id = current_user_id
  ),
  risk_agg as (
    select
      risk.version_id,
      sum(risk.cnt)::bigint as exception_count,
      max(risk.max_cause_risk_score) as max_risk_score,
      jsonb_object_agg(risk.cause_code, risk.cnt) as cause_code_counts
    from (
      select
        alert.version_id,
        alert.cause_code,
        count(*) as cnt,
        max(alert.risk_score) as max_cause_risk_score
      from public.estimate_risk_alerts alert
      join open_cycles open_cycle
        on open_cycle.version_id = alert.version_id
      where alert.is_active
        and alert.status = 'to_process'
        and alert.tenant_id = scoped_tenant_id
      group by alert.version_id, alert.cause_code
    ) risk
    group by risk.version_id
  ),
  latest_jobs as (
    select distinct on (job.estimate_version_id)
      job.estimate_version_id as version_id,
      job.id as latest_job_id
    from public.takeoff_jobs job
    join open_cycles open_cycle
      on open_cycle.version_id = job.estimate_version_id
    where job.status in ('completed', 'applied')
    order by
      job.estimate_version_id,
      job.completed_at desc nulls last
  )
  select
    scoped_project.project_id,
    scoped_project.version_id,
    scoped_project.cycle_id,
    scoped_project.project_name,
    scoped_project.client_name,
    scoped_project.version_number,
    scoped_project.amount_ht_cents,
    scoped_project.margin_bp,
    scoped_project.requested_at,
    scoped_project.submission_message,
    coalesce(comment_totals.comment_count, 0) as comment_count,
    reviewer_state.reviewer_state,
    coalesce(risk_totals.exception_count, 0) as exception_count,
    coalesce(risk_totals.max_risk_score, 0) as max_risk_score,
    coalesce(risk_totals.cause_code_counts, '{}'::jsonb) as cause_code_counts,
    latest_job.latest_job_id
  from with_project scoped_project
  left join comments_agg comment_totals
    on comment_totals.cycle_id = scoped_project.cycle_id
  left join reviewer_states reviewer_state
    on reviewer_state.cycle_id = scoped_project.cycle_id
  left join risk_agg risk_totals
    on risk_totals.version_id = scoped_project.version_id
  left join latest_jobs latest_job
    on latest_job.version_id = scoped_project.version_id
  order by
    case
      when p_sort_by = 'priority'
        then coalesce(risk_totals.max_risk_score, 0)
    end desc nulls last,
    case
      when p_sort_by = 'priority' then scoped_project.requested_at
    end asc,
    case
      when p_sort_by = 'amount' then scoped_project.amount_ht_cents
    end desc nulls last,
    case
      when p_sort_by = 'margin' then scoped_project.margin_bp
    end asc nulls last,
    case
      when p_sort_by = 'age' then scoped_project.requested_at
    end asc,
    scoped_project.requested_at asc;
end;
$$;

revoke all on function public.list_approval_queue(text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_approval_queue(text)
  to authenticated;

-- Trigger-level fencing also protects privileged writers: a historical cycle
-- can be read for audit, but never receives new comments.
create or replace function public.guard_estimate_review_comment_active_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_decision public.estimate_review_decision;
  cycle_superseded_at timestamptz;
begin
  select cycle.decision, cycle.superseded_at
    into cycle_decision, cycle_superseded_at
  from public.estimate_review_cycles cycle
  where cycle.id = new.cycle_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  if cycle_superseded_at is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_SUPERSEDED';
  end if;

  if cycle_decision is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_review_comment_active_cycle()
  from public, anon, authenticated;

drop trigger if exists aaz_guard_estimate_review_comment_active_cycle
  on public.estimate_review_comments;
create trigger aaz_guard_estimate_review_comment_active_cycle
  before insert on public.estimate_review_comments
  for each row execute function
    public.guard_estimate_review_comment_active_cycle();

drop policy if exists "Tenant approvers can create estimate review comments"
  on public.estimate_review_comments;

revoke insert on table public.estimate_review_comments from public;
revoke insert on table public.estimate_review_comments
  from anon, authenticated;

-- Correction snapshots may be created while a changes-requested decision is
-- being committed, and treated after that decision closes the cycle. They are
-- never valid for approved or superseded cycles, nor for a comment carried by
-- a different/superseded cycle.
create or replace function public.guard_estimate_review_correction_active_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.estimate_review_cycles%rowtype;
  source_comment public.estimate_review_comments%rowtype;
  source_cycle_superseded_at timestamptz;
begin
  select cycle.*
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.id = new.cycle_id;

  if cycle_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  if cycle_row.superseded_at is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CYCLE_SUPERSEDED';
  end if;

  if tg_op = 'INSERT' then
    if cycle_row.decision is not null
      and cycle_row.decision <>
        'changes_requested'::public.estimate_review_decision
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CORRECTION_CYCLE_INVALID';
    end if;
  elsif cycle_row.decision is distinct from
      'changes_requested'::public.estimate_review_decision
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_CORRECTION_CYCLE_INVALID';
  end if;

  select comment.*
    into source_comment
  from public.estimate_review_comments comment
  where comment.id = new.source_comment_id;

  if source_comment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ESTIMATE_REVIEW_COMMENT_NOT_FOUND';
  end if;

  select source_cycle.superseded_at
    into source_cycle_superseded_at
  from public.estimate_review_cycles source_cycle
  where source_cycle.id = source_comment.cycle_id;

  if source_cycle_superseded_at is not null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_REVIEW_COMMENT_SUPERSEDED';
  end if;

  if source_comment.cycle_id <> cycle_row.id then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_CYCLE_MISMATCH';
  end if;

  if source_comment.version_id <> cycle_row.version_id
    or source_comment.tenant_id <> cycle_row.tenant_id
  then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_VERSION_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_review_correction_active_context()
  from public, anon, authenticated;

drop trigger if exists aaz_guard_estimate_review_correction_active_context
  on public.estimate_review_correction_items;
create trigger aaz_guard_estimate_review_correction_active_context
  before insert or update on public.estimate_review_correction_items
  for each row execute function
    public.guard_estimate_review_correction_active_context();

drop policy if exists "Tenant approvers can create estimate review correction items"
  on public.estimate_review_correction_items;

revoke insert on table public.estimate_review_correction_items from public;
revoke insert on table public.estimate_review_correction_items
  from anon, authenticated;
