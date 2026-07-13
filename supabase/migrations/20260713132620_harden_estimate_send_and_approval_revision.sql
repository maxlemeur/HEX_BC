-- Bind approvals to immutable estimate content and reserve workflow state
-- transitions for narrow database commands.

alter table public.estimate_versions
  add column if not exists content_revision bigint not null default 1;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_content_revision_positive_check;
alter table public.estimate_versions
  add constraint estimate_versions_content_revision_positive_check
  check (content_revision > 0);

alter table public.estimate_review_cycles
  add column if not exists requested_content_revision bigint;

alter table public.estimate_review_cycles
  drop constraint if exists estimate_review_cycles_requested_content_revision_positive_check;
alter table public.estimate_review_cycles
  add constraint estimate_review_cycles_requested_content_revision_positive_check
  check (requested_content_revision is null or requested_content_revision > 0);

alter table public.estimate_approvals
  add column if not exists approved_content_revision bigint;

alter table public.estimate_approvals
  drop constraint if exists estimate_approvals_approved_content_revision_positive_check;
alter table public.estimate_approvals
  add constraint estimate_approvals_approved_content_revision_positive_check
  check (approved_content_revision is null or approved_content_revision > 0);

create index if not exists estimate_approvals_freshness_idx
  on public.estimate_approvals (
    tenant_id,
    version_id,
    rule_id,
    approved_content_revision,
    created_at desc
  );

create or replace function public.guard_estimate_version_workflow_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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
  then
    new.content_revision := old.content_revision + 1;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_estimate_version_workflow_columns()
  from public, anon, authenticated;

drop trigger if exists aaa_guard_estimate_version_workflow_columns
  on public.estimate_versions;
create trigger aaa_guard_estimate_version_workflow_columns
  before update on public.estimate_versions
  for each row execute function public.guard_estimate_version_workflow_columns();

create or replace function public.bump_estimate_content_revision_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_version_ids uuid[];
  target_status public.estimate_status;
begin
  target_version_ids := case
    when tg_op = 'INSERT' then array[new.version_id]
    when tg_op = 'DELETE' then array[old.version_id]
    else array[old.version_id, new.version_id]
  end;

  if tg_op = 'UPDATE'
    and (to_jsonb(new) - 'updated_at') is not distinct from
      (to_jsonb(old) - 'updated_at')
  then
    return new;
  end if;

  -- Lock both parents in a stable order when an item is moved between versions.
  for target_version_id in
    select distinct candidate.version_id
    from unnest(target_version_ids) as candidate(version_id)
    where candidate.version_id is not null
    order by candidate.version_id
  loop
    target_status := null;
    select version.status
      into target_status
    from public.estimate_versions version
    where version.id = target_version_id
    for update;

    -- A cascading parent delete removes the version before its child rows.
    if target_status is null then
      if tg_op = 'DELETE' then
        continue;
      end if;
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_VERSION_NOT_FOUND';
    end if;

    if target_status <> 'draft'::public.estimate_status then
      raise exception
        using
          errcode = '42501',
          message = 'ESTIMATE_VERSION_READ_ONLY';
    end if;

    update public.estimate_versions version
    set content_revision = version.content_revision + 1
    where version.id = target_version_id;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.bump_estimate_content_revision_from_item()
  from public, anon, authenticated;

drop trigger if exists bump_estimate_content_revision_from_item
  on public.estimate_items;
create trigger bump_estimate_content_revision_from_item
  after insert or update or delete on public.estimate_items
  for each row execute function public.bump_estimate_content_revision_from_item();

create or replace function public.capture_estimate_review_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_content_revision bigint;
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

  select version.content_revision
    into current_content_revision
  from public.estimate_versions version
  where version.id = new.version_id
    and version.tenant_id = new.tenant_id
    and version.status = 'draft'::public.estimate_status
  for share;

  if current_content_revision is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_REVIEW_DRAFT_NOT_FOUND';
  end if;

  new.requested_content_revision := current_content_revision;
  return new;
end;
$$;

revoke execute on function public.capture_estimate_review_content_revision()
  from public, anon, authenticated;

drop trigger if exists capture_estimate_review_content_revision
  on public.estimate_review_cycles;
create trigger capture_estimate_review_content_revision
  before insert or update on public.estimate_review_cycles
  for each row execute function public.capture_estimate_review_content_revision();

create or replace function public.get_estimate_content_revision(
  p_version_id uuid
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select version.content_revision
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = public.current_tenant_id();
$$;

revoke execute on function public.get_estimate_content_revision(uuid)
  from public, anon;
grant execute on function public.get_estimate_content_revision(uuid)
  to authenticated, service_role;

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

  next_status := case
    when p_decision = 'changes_requested'::public.estimate_review_decision
      then 'rejected'::public.estimate_approval_status
    else 'approved'::public.estimate_approval_status
  end;

  select cycle.*
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = scoped_tenant_id
    and cycle.decision is null
  for update;

  if cycle_row.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  select version.content_revision
    into current_content_revision
  from public.estimate_versions version
  where version.id = cycle_row.version_id
    and version.tenant_id = cycle_row.tenant_id
    and version.status = 'draft'::public.estimate_status
  for update;

  if current_content_revision is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_DRAFT_NOT_FOUND';
  end if;

  if cycle_row.requested_content_revision is null
    or current_content_revision <> cycle_row.requested_content_revision
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_REVIEW_SNAPSHOT_STALE';
  end if;

  if jsonb_array_length(resolved_comments) > 0 then
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
    );
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

drop policy if exists "Tenant members can create estimate approvals"
  on public.estimate_approvals;
create policy "Tenant writers can create estimate approvals"
  on public.estimate_approvals
  for insert
  to authenticated
  with check (
    requested_by = (select auth.uid())
    and status = 'pending'::public.estimate_approval_status
    and approved_by is null
    and decided_at is null
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.estimate_versions version
      join public.estimate_projects project on project.id = version.project_id
      where version.id = estimate_approvals.version_id
        and version.tenant_id = estimate_approvals.tenant_id
        and project.tenant_id = version.tenant_id
        and version.status = 'draft'::public.estimate_status
        and (
          project.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            version.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

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

  select approval.*
    into approval_row
  from public.estimate_approvals approval
  where approval.id = p_approval_id
    and approval.tenant_id = scoped_tenant_id
    and approval.status = 'pending'::public.estimate_approval_status
  for update;

  if approval_row.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_APPROVAL_PENDING_NOT_FOUND';
  end if;

  select cycle.*
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.tenant_id = approval_row.tenant_id
    and cycle.version_id = approval_row.version_id
    and cycle.decision is null
  order by cycle.cycle_number desc
  limit 1
  for update;

  select version.content_revision
    into current_content_revision
  from public.estimate_versions version
  where version.id = approval_row.version_id
    and version.tenant_id = approval_row.tenant_id
    and version.status = 'draft'::public.estimate_status
  for update;

  if current_content_revision is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_DRAFT_NOT_FOUND';
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
    and approval.status = 'pending'::public.estimate_approval_status;

  if cycle_row.id is not null and remaining_pending_count = 0 then
    select case
      when exists (
        select 1
        from public.estimate_approvals approval
        where approval.tenant_id = cycle_row.tenant_id
          and approval.version_id = cycle_row.version_id
          and approval.created_at >= cycle_row.requested_at
          and approval.status = 'rejected'::public.estimate_approval_status
      ) then 'changes_requested'::public.estimate_review_decision
      else 'approved'::public.estimate_review_decision
    end
    into cycle_decision;

    update public.estimate_review_cycles cycle
    set
      decision = cycle_decision,
      decided_by = current_user_id,
      decided_at = decision_timestamp
    where cycle.id = cycle_row.id
      and cycle.tenant_id = cycle_row.tenant_id
      and cycle.decision is null
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

drop policy if exists "Tenant admins can decide estimate approvals"
  on public.estimate_approvals;
drop policy if exists "Tenant approvers can decide estimate approvals"
  on public.estimate_approvals;

create or replace function public.transition_estimate_version_status(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_next_status public.estimate_status,
  p_seal_hash text,
  p_actor_user_id uuid,
  p_event_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns public.estimate_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_version public.estimate_versions%rowtype;
  updated_version public.estimate_versions;
  expected_event_type text;
  trusted_metadata jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select version.*
    into current_version
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update;

  if current_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  if current_version.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  expected_event_type := case p_next_status
    when 'sent'::public.estimate_status then 'sent'
    when 'accepted'::public.estimate_status then 'accepted'
    when 'archived'::public.estimate_status then 'archived'
    else null
  end;

  if expected_event_type is null then
    raise exception using errcode = '22023', message = 'ESTIMATE_STATUS_TRANSITION_INVALID';
  end if;

  if current_version.status = 'draft'::public.estimate_status
    and p_next_status = 'sent'::public.estimate_status
  then
    if p_seal_hash is null or p_seal_hash !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'ESTIMATE_SEAL_INVALID';
    end if;
  elsif p_seal_hash is not null then
    raise exception using errcode = '22023', message = 'ESTIMATE_SEAL_UNEXPECTED';
  end if;

  update public.estimate_versions version
  set
    status = p_next_status,
    seal_hash = case
      when p_next_status = 'sent'::public.estimate_status then p_seal_hash
      else version.seal_hash
    end
  where version.id = current_version.id
    and version.tenant_id = current_version.tenant_id
    and version.updated_at = current_version.updated_at
  returning version.* into updated_version;

  if updated_version.id is null then
    raise exception using errcode = '40001', message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  trusted_metadata := coalesce(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
    'previous_status', current_version.status,
    'next_status', p_next_status
  );
  if p_seal_hash is not null then
    trusted_metadata := trusted_metadata || jsonb_build_object('seal_hash', p_seal_hash);
  end if;

  perform public.log_estimate_version_event(
    p_version_id,
    expected_event_type,
    p_actor_user_id,
    trusted_metadata,
    coalesce(p_occurred_at, now())
  );

  return updated_version;
end;
$$;

revoke execute on function public.transition_estimate_version_status(
  uuid,
  uuid,
  timestamptz,
  public.estimate_status,
  text,
  uuid,
  jsonb,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.transition_estimate_version_status(
  uuid,
  uuid,
  timestamptz,
  public.estimate_status,
  text,
  uuid,
  jsonb,
  timestamptz
) to service_role;
