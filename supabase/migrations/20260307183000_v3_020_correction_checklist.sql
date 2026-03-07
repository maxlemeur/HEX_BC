-- V3-020: correction checklist snapshots and treatment trail for approval rework loops.

do $$
begin
  alter type public.estimate_review_comment_scope add value if not exists 'exception';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_review_comment_scope add value if not exists 'hypothesis';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_review_correction_status as enum (
    'pending',
    'corrected',
    'to_discuss'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  where con.conrelid = 'public.estimate_review_comments'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%scope_type = ''project''%'
    and pg_get_constraintdef(con.oid) ilike '%approval_rule%';

  if constraint_name is not null then
    execute format(
      'alter table public.estimate_review_comments drop constraint %I',
      constraint_name
    );
  end if;
end
$$;

alter table if exists public.estimate_review_comments
  drop constraint if exists estimate_review_comments_scope_check,
  add constraint estimate_review_comments_scope_check
  check (
    (
      scope_type = 'project'
      and scope_id is null
    )
    or (
      scope_type in (
        'lot',
        'line',
        'approval_rule',
        'exception',
        'hypothesis'
      )
      and scope_id is not null
    )
  );

create table if not exists public.estimate_review_correction_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  cycle_id uuid not null references public.estimate_review_cycles(id) on delete cascade,
  source_comment_id uuid not null unique
    references public.estimate_review_comments(id) on delete cascade,
  scope_type public.estimate_review_comment_scope not null,
  scope_id uuid,
  scope_label text not null,
  comment text not null,
  status public.estimate_review_correction_status not null default 'pending',
  last_treated_at timestamptz,
  last_treated_by uuid references public.profiles(id) on delete set null,
  last_treatment_note text,
  constraint estimate_review_correction_items_scope_check
    check (
      (
        scope_type = 'project'
        and scope_id is null
      )
      or (
        scope_type in (
          'lot',
          'line',
          'approval_rule',
          'exception',
          'hypothesis'
        )
        and scope_id is not null
      )
    ),
  constraint estimate_review_correction_items_scope_label_not_blank_check
    check (length(btrim(scope_label)) > 0),
  constraint estimate_review_correction_items_comment_not_blank_check
    check (length(btrim(comment)) > 0),
  constraint estimate_review_correction_items_treatment_consistency_check
    check (
      (
        status = 'pending'
        and last_treated_at is null
        and last_treated_by is null
        and last_treatment_note is null
      )
      or (
        status in ('corrected', 'to_discuss')
        and last_treated_at is not null
        and last_treated_by is not null
      )
    ),
  constraint estimate_review_correction_items_note_not_blank_check
    check (
      last_treatment_note is null
      or length(btrim(last_treatment_note)) > 0
    )
);

create index if not exists estimate_review_correction_items_cycle_status_idx
  on public.estimate_review_correction_items (tenant_id, cycle_id, status, created_at asc);

create index if not exists estimate_review_correction_items_version_idx
  on public.estimate_review_correction_items (tenant_id, version_id, created_at desc);

create table if not exists public.estimate_review_correction_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  cycle_id uuid not null references public.estimate_review_cycles(id) on delete cascade,
  item_id uuid not null
    references public.estimate_review_correction_items(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  previous_status public.estimate_review_correction_status not null,
  next_status public.estimate_review_correction_status not null,
  note text,
  constraint estimate_review_correction_events_note_not_blank_check
    check (note is null or length(btrim(note)) > 0),
  constraint estimate_review_correction_events_status_change_check
    check (previous_status <> next_status)
);

create index if not exists estimate_review_correction_events_item_created_idx
  on public.estimate_review_correction_events (item_id, created_at asc);

create index if not exists estimate_review_correction_events_cycle_created_idx
  on public.estimate_review_correction_events (tenant_id, cycle_id, created_at asc);

create or replace function public.assign_estimate_review_correction_items_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cycle_row record;
  comment_row record;
begin
  select c.tenant_id, c.version_id
    into cycle_row
  from public.estimate_review_cycles c
  where c.id = new.cycle_id;

  if cycle_row.tenant_id is null then
    raise exception using message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  select rc.tenant_id, rc.version_id, rc.cycle_id
    into comment_row
  from public.estimate_review_comments rc
  where rc.id = new.source_comment_id;

  if comment_row.tenant_id is null then
    raise exception using message = 'ESTIMATE_REVIEW_COMMENT_NOT_FOUND';
  end if;

  if comment_row.cycle_id <> new.cycle_id then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_CYCLE_MISMATCH';
  end if;

  if comment_row.version_id <> cycle_row.version_id then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_VERSION_MISMATCH';
  end if;

  new.tenant_id := cycle_row.tenant_id;
  new.version_id := cycle_row.version_id;
  return new;
end;
$$;

create or replace function public.guard_estimate_review_comments_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row public.estimate_review_cycles;
  scoped_item record;
  scoped_rule record;
  scoped_alert record;
  scoped_hypothesis record;
begin
  select *
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.id = new.cycle_id;

  if cycle_row.id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  if cycle_row.decision is not null then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  if trim(coalesce(new.scope_label, '')) = '' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_SCOPE_LABEL_REQUIRED';
  end if;

  if trim(coalesce(new.comment, '')) = '' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_COMMENT_REQUIRED';
  end if;

  if new.scope_type = 'project' then
    if new.scope_id is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_PROJECT_SCOPE_INVALID';
    end if;
    return new;
  end if;

  if new.scope_type in ('lot', 'line') then
    select item.id, item.item_type
      into scoped_item
    from public.estimate_items item
    where item.id = new.scope_id
      and item.version_id = new.version_id
      and item.tenant_id = new.tenant_id;

    if scoped_item.id is null then
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_REVIEW_SCOPE_ITEM_NOT_FOUND';
    end if;

    if (
      new.scope_type = 'lot'
      and scoped_item.item_type <> 'section'
    ) or (
      new.scope_type = 'line'
      and scoped_item.item_type <> 'line'
    ) then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_SCOPE_ITEM_TYPE_INVALID';
    end if;

    return new;
  end if;

  if new.scope_type = 'approval_rule' then
    select rule.id
      into scoped_rule
    from public.estimate_rules rule
    where rule.id = new.scope_id
      and rule.tenant_id = new.tenant_id;

    if scoped_rule.id is null then
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_REVIEW_SCOPE_RULE_NOT_FOUND';
    end if;

    return new;
  end if;

  if new.scope_type = 'exception' then
    select alert.id
      into scoped_alert
    from public.estimate_risk_alerts alert
    where alert.id = new.scope_id
      and alert.version_id = new.version_id
      and alert.tenant_id = new.tenant_id;

    if scoped_alert.id is null then
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_REVIEW_SCOPE_EXCEPTION_NOT_FOUND';
    end if;

    return new;
  end if;

  if new.scope_type = 'hypothesis' then
    select entry.id
      into scoped_hypothesis
    from public.affaire_register_entries entry
    join public.estimate_versions version on version.id = new.version_id
    where entry.id = new.scope_id
      and entry.tenant_id = new.tenant_id
      and entry.project_id = version.project_id
      and entry.kind = 'assumption'
      and entry.is_active;

    if scoped_hypothesis.id is null then
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_REVIEW_SCOPE_HYPOTHESIS_NOT_FOUND';
    end if;

    return new;
  end if;

  raise exception
    using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_SCOPE_INVALID';
end;
$$;

create or replace function public.guard_estimate_review_correction_items_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_comment public.estimate_review_comments;
begin
  select *
    into source_comment
  from public.estimate_review_comments comment
  where comment.id = new.source_comment_id;

  if source_comment.id is null then
    raise exception using message = 'ESTIMATE_REVIEW_COMMENT_NOT_FOUND';
  end if;

  if source_comment.cycle_id <> new.cycle_id then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_CYCLE_MISMATCH';
  end if;

  if source_comment.version_id <> new.version_id then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_VERSION_MISMATCH';
  end if;

  if source_comment.scope_type <> new.scope_type
    or source_comment.scope_id is distinct from new.scope_id
    or source_comment.scope_label <> new.scope_label
    or source_comment.comment <> new.comment
  then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_COMMENT_SNAPSHOT_MISMATCH';
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_review_correction_items_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.cycle_id is distinct from new.cycle_id
    or old.source_comment_id is distinct from new.source_comment_id
    or old.scope_type is distinct from new.scope_type
    or old.scope_id is distinct from new.scope_id
    or old.scope_label is distinct from new.scope_label
    or old.comment is distinct from new.comment
    or old.created_at is distinct from new.created_at
  then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_ITEM_IMMUTABLE_FIELDS';
  end if;

  if new.status = 'pending' then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_PENDING_NOT_ALLOWED';
  end if;

  if new.last_treated_at is null or new.last_treated_by is null then
    raise exception using message = 'ESTIMATE_REVIEW_CORRECTION_TREATMENT_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_review_correction_items_updated_at on public.estimate_review_correction_items;
create trigger set_estimate_review_correction_items_updated_at
  before update on public.estimate_review_correction_items
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_review_correction_items_tenant_id on public.estimate_review_correction_items;
create trigger set_estimate_review_correction_items_tenant_id
  before insert or update on public.estimate_review_correction_items
  for each row execute procedure public.assign_estimate_review_correction_items_tenant_id();

drop trigger if exists guard_estimate_review_correction_items_insert_trigger on public.estimate_review_correction_items;
create trigger guard_estimate_review_correction_items_insert_trigger
  before insert on public.estimate_review_correction_items
  for each row execute procedure public.guard_estimate_review_correction_items_insert();

drop trigger if exists guard_estimate_review_correction_items_update_trigger on public.estimate_review_correction_items;
create trigger guard_estimate_review_correction_items_update_trigger
  before update on public.estimate_review_correction_items
  for each row execute procedure public.guard_estimate_review_correction_items_update();

alter table public.estimate_review_correction_items enable row level security;
alter table public.estimate_review_correction_events enable row level security;

drop policy if exists "Tenant members can view estimate review correction items" on public.estimate_review_correction_items;
drop policy if exists "Tenant approvers can create estimate review correction items" on public.estimate_review_correction_items;
drop policy if exists "Estimate owners can update estimate review correction items" on public.estimate_review_correction_items;

create policy "Tenant members can view estimate review correction items"
  on public.estimate_review_correction_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_correction_items.version_id
        and v.tenant_id = estimate_review_correction_items.tenant_id
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

create policy "Tenant approvers can create estimate review correction items"
  on public.estimate_review_correction_items
  for insert
  to authenticated
  with check (
    status = 'pending'
    and last_treated_at is null
    and last_treated_by is null
    and last_treatment_note is null
    and (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
  );

create policy "Estimate owners can update estimate review correction items"
  on public.estimate_review_correction_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_correction_items.version_id
        and v.tenant_id = estimate_review_correction_items.tenant_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_correction_items.version_id
        and v.tenant_id = estimate_review_correction_items.tenant_id
        and p.user_id = (select auth.uid())
    )
    and status in ('corrected', 'to_discuss')
    and last_treated_at is not null
    and last_treated_by = (select auth.uid())
  );

drop policy if exists "Tenant members can view estimate review correction events" on public.estimate_review_correction_events;
create policy "Tenant members can view estimate review correction events"
  on public.estimate_review_correction_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_correction_events.version_id
        and v.tenant_id = estimate_review_correction_events.tenant_id
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
set search_path = public
as $$
declare
  current_user_id uuid;
  cycle_row estimate_review_cycles;
  updated_approval_count integer := 0;
  decision_timestamp timestamptz := now();
  next_status estimate_approval_status;
  resolved_comments jsonb := coalesce(p_comments, '[]'::jsonb);
begin
  current_user_id := auth.uid();
  next_status :=
    case
      when p_decision = 'changes_requested' then 'rejected'::estimate_approval_status
      else 'approved'::estimate_approval_status
    end;

  if current_user_id is null then
    raise exception
      using
        errcode = '42501',
        message = 'AUTHENTICATION_REQUIRED';
  end if;

  if jsonb_typeof(resolved_comments) <> 'array' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_COMMENTS_INVALID';
  end if;

  select *
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = public.current_tenant_id()
    and cycle.decision is null
  for update;

  if cycle_row.id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

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
      comment.scope_type::estimate_review_comment_scope,
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
      id,
      tenant_id,
      version_id,
      cycle_id,
      scope_type,
      scope_id,
      scope_label,
      comment
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
  where p_decision = 'changes_requested';

  with updated as (
    update public.estimate_approvals approval
    set
      status = next_status,
      approved_by = current_user_id,
      decided_at = decision_timestamp
    where approval.tenant_id = cycle_row.tenant_id
      and approval.version_id = cycle_row.version_id
      and approval.status = 'pending'
    returning approval.id, approval.rule_id
  )
  select
    coalesce(array_agg(updated.id order by updated.id), '{}'::uuid[]),
    coalesce(array_agg(updated.rule_id order by updated.id), '{}'::uuid[]),
    count(*)::integer
  into approval_ids, rule_ids, updated_approval_count
  from updated;

  if updated_approval_count = 0 then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_APPROVALS_PENDING_NOT_FOUND';
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
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  comment_count := jsonb_array_length(resolved_comments);
  return next;
end;
$$;

create or replace function public.record_estimate_review_correction_action(
  p_item_id uuid,
  p_status public.estimate_review_correction_status,
  p_note text default null
)
returns table (
  item_id uuid,
  cycle_id uuid,
  version_id uuid,
  status public.estimate_review_correction_status,
  treated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  item_row public.estimate_review_correction_items;
  owner_user_id uuid;
  next_note text := nullif(btrim(coalesce(p_note, '')), '');
  action_timestamp timestamptz := now();
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_status not in (
    'corrected'::public.estimate_review_correction_status,
    'to_discuss'::public.estimate_review_correction_status
  ) then
    raise exception using errcode = '22023', message = 'ESTIMATE_REVIEW_CORRECTION_STATUS_INVALID';
  end if;

  select item.*
    into item_row
  from public.estimate_review_correction_items item
  where item.id = p_item_id
    and item.tenant_id = public.current_tenant_id()
  for update;

  if item_row.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_CORRECTION_ITEM_NOT_FOUND';
  end if;

  select project.user_id
    into owner_user_id
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id
  where version.id = item_row.version_id
    and version.tenant_id = item_row.tenant_id;

  if owner_user_id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_REVIEW_CORRECTION_OWNER_NOT_FOUND';
  end if;

  if owner_user_id <> current_user_id then
    raise exception using errcode = '42501', message = 'ESTIMATE_REVIEW_CORRECTION_OWNER_REQUIRED';
  end if;

  if item_row.status = p_status then
    raise exception using errcode = '23514', message = 'ESTIMATE_REVIEW_CORRECTION_STATUS_UNCHANGED';
  end if;

  update public.estimate_review_correction_items item
  set
    status = p_status,
    last_treated_at = action_timestamp,
    last_treated_by = current_user_id,
    last_treatment_note = next_note
  where item.id = item_row.id;

  insert into public.estimate_review_correction_events (
    tenant_id,
    version_id,
    cycle_id,
    item_id,
    actor_user_id,
    previous_status,
    next_status,
    note
  )
  values (
    item_row.tenant_id,
    item_row.version_id,
    item_row.cycle_id,
    item_row.id,
    current_user_id,
    item_row.status,
    p_status,
    next_note
  );

  item_id := item_row.id;
  cycle_id := item_row.cycle_id;
  version_id := item_row.version_id;
  status := p_status;
  treated_at := action_timestamp;
  return next;
end;
$$;

grant execute on function public.record_estimate_review_correction_action(
  uuid,
  public.estimate_review_correction_status,
  text
) to authenticated;
