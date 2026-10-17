-- Lot 2, sous-lot 2.1 (M1) : le moteur de calcul 3 est admis, fermé par défaut.
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md (D2, §6.4, §7,
-- §14 « 2.1 ») ; preuves : docs/testing/estimate-engine-v3-2.1.md et
-- supabase/tests/database/estimate-calc-engine-v3-guards.test.sql.
--
-- Après cette migration :
--   - aucune RPC ni aucun contrat d'insertion ne crée de v3 ; seule une insertion sans contrat
--     par le propriétaire natif (fixtures de test) en crée une ;
--   - la v3 hérite de toute la gouvernance v2 (colonnes figées, propriétaire des rôles,
--     invalidation du gel, revue, fraîcheur à la publication) ;
--   - tout écrivain non adapté échoue fermé (ESTIMATE_V3_WRITER_NOT_SUPPORTED) : seule une
--     transaction portant miaouffrage.estimate_v3_writer = <id de version> écrit une colonne de
--     calcul d'une v3 ; aucune RPC ne le pose avant M4 ;
--   - l'émission est refusée par son nom (ESTIMATE_V3_EMISSION_NOT_READY) jusqu'à M5 ;
--   - la file d'approbation affiche une marge indisponible (NULL) pour une v3.
--
-- Prédicat d'héritage : private.calc_engine_freezes_snapshot(engine) (vrai pour 2 et 3) dans les
-- fonctions security definer. Les gardes security invoker s'exécutent sous authenticated ou
-- service_role, à qui le schéma private est fermé (20260719132414) : elles portent le même
-- prédicat en ligne, « in (2, 3) ». Aucune colonne n'est ajoutée ; aucune donnée n'est reprise.

do $preflight$
begin
  if exists (
    select 1
    from public.estimate_versions version
    where version.calc_engine_version not in (1, 2)
  ) then
    raise exception 'ESTIMATE_CALC_ENGINE_V3_PREFLIGHT: a version already uses an engine other than 1 or 2';
  end if;
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.estimate_versions'::regclass
      and constraint_row.conname = 'estimate_versions_calc_engine_version_check'
      and pg_get_constraintdef(constraint_row.oid) = 'CHECK ((calc_engine_version = ANY (ARRAY[1, 2])))'
  ) then
    raise exception 'ESTIMATE_CALC_ENGINE_V3_PREFLIGHT: the engine CHECK differs from the reviewed definition';
  end if;
end;
$preflight$;

alter table public.estimate_versions
  drop constraint estimate_versions_calc_engine_version_check;

alter table public.estimate_versions
  add constraint estimate_versions_calc_engine_version_check
  check (calc_engine_version in (1, 2, 3));

comment on column public.estimate_versions.calc_engine_version is
  'Immutable calculation contract. Production creation uses v2; duplication preserves its source; retired legacy creators remain pinned to v1. Engine 3 is admitted fail-closed (lot 2, sub-lot 2.1): only a contract-less insertion by the native owner creates it, unadapted writers and emission refuse it by name.';

create or replace function private.calc_engine_freezes_snapshot(p_calc_engine_version smallint)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(p_calc_engine_version = 2 or p_calc_engine_version = 3, false);
$$;

comment on function private.calc_engine_freezes_snapshot(smallint) is
  'Inheritance predicate of the v2 governance: engines 2 and 3 freeze a calculation snapshot, engine 1 does not.';

revoke all on function private.calc_engine_freezes_snapshot(smallint)
  from public, anon, authenticated, service_role;

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

  if target_engine_version in (2, 3)
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

  if target_engine_version in (2, 3) then
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

  if target_engine_version in (2, 3) and (
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
  -- by any v2 or v3 version next, in a single deterministic order, so neither role
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
      and version.calc_engine_version in (2, 3)
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
      and version.calc_engine_version in (2, 3)
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
       and version.calc_engine_version in (2, 3)
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
     and version.calc_engine_version in (2, 3)
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

  if target_version.calc_engine_version in (2, 3) and (
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

  if private.calc_engine_freezes_snapshot(current_calc_engine_version) and (
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
    where private.calc_engine_freezes_snapshot(version.calc_engine_version)
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
    where private.calc_engine_freezes_snapshot(version.calc_engine_version)
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
    where private.calc_engine_freezes_snapshot(version.calc_engine_version)
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
  if new.status not in (
      'sending'::public.estimate_status,
      'sent'::public.estimate_status
    )
    or new.status is not distinct from old.status
  then
    return new;
  end if;

  -- Lot 2, sub-lot 2.1: no v3 emission contract exists yet (client contract 2 lands
  -- with M5). A v3 is refused by name, even with a fresh snapshot.
  if new.calc_engine_version = 3 then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_EMISSION_NOT_READY';
  end if;

  if new.calc_engine_version <> 2 then
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

create or replace function public.enforce_estimate_calc_engine_on_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.calc_engine_version not in (1, 2, 3) then
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

  -- Lot 2, sub-lot 2.1: no insertion contract produces engine 3 before M4. Only a
  -- contract-less insertion by the native owner (test fixtures) creates a v3; a
  -- duplication or any other contract keeps the source engine and is refused.
  if new.calc_engine_version = 3
    and (
      current_user <> 'postgres'
      or coalesce(
        pg_catalog.current_setting(
          'miaouffrage.estimate_version_insert_contract',
          true
        ),
        ''
      ) <> ''
    )
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_estimate_calc_engine_on_insert()
  from public, anon, authenticated;

create or replace function public.estimate_offer_client_items_match(snapshot jsonb,version public.estimate_versions)
returns boolean language sql stable security invoker set search_path='' as $$
  select (version).calc_engine_version in (1,2)
    and (select count(*) from jsonb_array_elements(snapshot->'rows'))=(select count(*) from public.estimate_items where version_id=(version).id and tenant_id=(version).tenant_id)
    and not exists(
      select 1 from jsonb_array_elements(snapshot->'rows')r
      left join public.estimate_items i on i.id=(r->>'id')::uuid and i.version_id=(version).id and i.tenant_id=(version).tenant_id
      where i.id is null or r->>'kind' is distinct from i.item_type::text
        or r->'parentId' is distinct from coalesce(to_jsonb(i.parent_id),'null'::jsonb)
        or (r->>'position')::integer is distinct from i.position
        or r->>'title' is distinct from coalesce(nullif(public.estimate_offer_trim(i.title),''),'Sans titre')
        or (i.item_type='line' and ((r->>'quantity')::numeric is distinct from i.quantity
          or r->>'unit' is distinct from coalesce(nullif(public.estimate_offer_trim(i.description),''),'-')))
        or ((version).calc_engine_version=2 and i.item_type='line' and (
          i.snapshot_pu_ht_cents is null or i.snapshot_fo_ht_cents is null or i.snapshot_mo_ht_cents is null
          or i.snapshot_mo_atelier_ht_cents is null or i.snapshot_mo_chantier_ht_cents is null
          or i.line_total_ht_cents is null or i.line_tax_cents is null or i.line_total_ttc_cents is null
          or i.snapshot_fo_ht_cents::bigint+i.snapshot_mo_ht_cents::bigint<>i.line_total_ht_cents::bigint
          or i.snapshot_mo_atelier_ht_cents::bigint+i.snapshot_mo_chantier_ht_cents::bigint<>i.snapshot_mo_ht_cents::bigint
          or i.line_total_ht_cents::bigint+i.line_tax_cents::bigint<>i.line_total_ttc_cents::bigint
          or (r->>'saleHtCents')::bigint is distinct from i.line_total_ht_cents::bigint
          or (r->>'unitSaleHtCents')::bigint is distinct from i.snapshot_pu_ht_cents::bigint
          or (r ? 'foSaleHtCents' and ((r->>'foSaleHtCents')::bigint is distinct from i.snapshot_fo_ht_cents::bigint
            or (r->>'moSaleHtCents')::bigint is distinct from i.snapshot_mo_ht_cents::bigint)))))
    and ((version).calc_engine_version<>2 or ((version).calc_snapshot_content_revision=(version).content_revision and (version).calc_snapshot_context is not null));
$$;
revoke all on function public.estimate_offer_client_items_match(jsonb,public.estimate_versions) from public,anon,authenticated;
grant execute on function public.estimate_offer_client_items_match(jsonb,public.estimate_versions) to service_role;

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
        -- A v3 margin (net markup) needs its own frozen evidence (M4).
        when version.calc_engine_version <> 2 then null
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

-- Contrat d'écrivain v3 sur les lignes (D2, §6.4 point 1). M4 le complète (colonnes v3,
-- refus des colonnes v3 sur une v1/v2). Libres sans contrat : libellé, rang, repère,
-- rattachement et horodatage d'une ligne, ainsi que sa suppression ; la garde v2 héritée et la
-- garde de révision refusent toujours toute écriture d'une version finalisée.
create or replace function public.guard_estimate_item_engine_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_engine_version smallint;
  previous_engine_version smallint;
begin
  select version.calc_engine_version
    into target_engine_version
  from public.estimate_versions version
  where version.id = new.version_id;

  if tg_op = 'UPDATE' and old.version_id is distinct from new.version_id then
    select version.calc_engine_version
      into previous_engine_version
    from public.estimate_versions version
    where version.id = old.version_id;
  end if;

  if target_engine_version is distinct from 3
    and previous_engine_version is distinct from 3
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.version_id is not distinct from new.version_id
    and to_jsonb(new) - array['title', 'position', 'aid', 'parent_id', 'updated_at']
      = to_jsonb(old) - array['title', 'position', 'aid', 'parent_id', 'updated_at']
  then
    return new;
  end if;

  if previous_engine_version is not distinct from 3
    or coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
      ''
    ) <> new.version_id::text
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_item_engine_columns()
  from public, anon, authenticated;

drop trigger if exists aay_guard_estimate_item_engine_columns
  on public.estimate_items;
create trigger aay_guard_estimate_item_engine_columns
  before insert or update on public.estimate_items
  for each row execute function public.guard_estimate_item_engine_columns();

-- Contrat d'écrivain v3 sur les versions (D2, §6.4 point 2). Les colonnes de calcul d'une v3
-- exigent le contrat lié à cette version ; restent libres le statut, l'approbation, le sceau,
-- content_revision, les colonnes non calculatoires et la remise à NULL du gel par
-- l'invalidation. Un changement de moteur est laissé à ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE
-- (aaa_guard_estimate_version_workflow_columns), qui reste le premier refus.
create or replace function public.guard_estimate_version_engine_v3_writer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.calc_engine_version is distinct from 3
    or new.calc_engine_version is distinct from old.calc_engine_version
    or coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
      ''
    ) = old.id::text
  then
    return new;
  end if;

  if new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.margin_bp is distinct from old.margin_bp
    or new.global_coefficient is distinct from old.global_coefficient
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_amount_cents is distinct from old.discount_amount_cents
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.contractor_role is distinct from old.contractor_role
    or new.currency is distinct from old.currency
    or (
      new.calc_snapshot_content_revision is not null
      and new.calc_snapshot_content_revision is distinct from
        old.calc_snapshot_content_revision
    )
    or (
      new.calc_snapshot_context is not null
      and new.calc_snapshot_context is distinct from old.calc_snapshot_context
    )
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_version_engine_v3_writer()
  from public, anon, authenticated;

drop trigger if exists aac_guard_estimate_version_engine_v3_writer
  on public.estimate_versions;
create trigger aac_guard_estimate_version_engine_v3_writer
  before update on public.estimate_versions
  for each row execute function public.guard_estimate_version_engine_v3_writer();

-- Aucun document d'une v3 avant le contrat client 2 (M5 remplace ce refus).
create or replace function public.guard_estimate_document_engine_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.estimate_versions version
    where version.id = new.version_id
      and version.calc_engine_version = 3
  ) then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_EMISSION_NOT_READY';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_document_engine_v3()
  from public, anon, authenticated;

drop trigger if exists aa_guard_estimate_document_engine_v3
  on public.estimate_documents;
create trigger aa_guard_estimate_document_engine_v3
  before insert or update on public.estimate_documents
  for each row execute function public.guard_estimate_document_engine_v3();
