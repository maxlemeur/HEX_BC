-- V3-016: explicit review cycles and scoped approval comments without exposing the editor.

do $$
begin
  create type public.estimate_review_decision as enum (
    'approved',
    'approved_with_reservations',
    'changes_requested'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_review_comment_scope as enum (
    'project',
    'lot',
    'line',
    'approval_rule'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.estimate_review_cycles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  cycle_number integer not null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decision public.estimate_review_decision,
  decided_at timestamptz,
  carried_over_from_cycle_id uuid references public.estimate_review_cycles(id) on delete set null,
  check (cycle_number > 0),
  check (
    (
      decision is null
      and decided_by is null
      and decided_at is null
    )
    or (
      decision is not null
      and decided_by is not null
      and decided_at is not null
    )
  )
);

create unique index if not exists estimate_review_cycles_version_cycle_number_idx
  on public.estimate_review_cycles (tenant_id, version_id, cycle_number);

create unique index if not exists estimate_review_cycles_open_cycle_idx
  on public.estimate_review_cycles (tenant_id, version_id)
  where decision is null;

create index if not exists estimate_review_cycles_tenant_version_requested_idx
  on public.estimate_review_cycles (tenant_id, version_id, requested_at desc);

create table if not exists public.estimate_review_comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  cycle_id uuid not null references public.estimate_review_cycles(id) on delete cascade,
  scope_type public.estimate_review_comment_scope not null,
  scope_id uuid,
  scope_label text not null,
  comment text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  check (
    (
      scope_type = 'project'
      and scope_id is null
    )
    or (
      scope_type in ('lot', 'line', 'approval_rule')
      and scope_id is not null
    )
  )
);

create index if not exists estimate_review_comments_tenant_cycle_created_idx
  on public.estimate_review_comments (tenant_id, cycle_id, created_at asc);

create index if not exists estimate_review_comments_tenant_version_scope_idx
  on public.estimate_review_comments (tenant_id, version_id, scope_type, created_at desc);

create or replace function public.assign_estimate_review_cycles_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  version_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into version_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  new.tenant_id := coalesce(version_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

create or replace function public.guard_estimate_review_cycles_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cycle_number <= 0 then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_CYCLE_NUMBER_INVALID';
  end if;

  if trim(coalesce(new.requested_by::text, '')) = '' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_REQUESTED_BY_REQUIRED';
  end if;

  if new.decision is null then
    if new.decided_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_OPEN_CYCLE_INVALID';
    end if;
  elsif new.decided_by is null or new.decided_at is null then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_DECISION_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_review_cycles_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.cycle_number is distinct from new.cycle_number
    or old.requested_by is distinct from new.requested_by
    or old.requested_at is distinct from new.requested_at
    or old.carried_over_from_cycle_id is distinct from new.carried_over_from_cycle_id
    or old.created_at is distinct from new.created_at
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_IMMUTABLE_FIELDS';
  end if;

  if old.decision is not null and (
    old.decision is distinct from new.decision
    or old.decided_by is distinct from new.decided_by
    or old.decided_at is distinct from new.decided_at
  ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  if new.decision is null then
    if new.decided_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_OPEN_CYCLE_INVALID';
    end if;
  elsif new.decided_by is null or new.decided_at is null then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_DECISION_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_review_comments_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  version_tenant_id uuid;
  cycle_tenant_id uuid;
  cycle_version_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into version_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if new.cycle_id is not null then
    select cycle.tenant_id, cycle.version_id
      into cycle_tenant_id, cycle_version_id
    from public.estimate_review_cycles cycle
    where cycle.id = new.cycle_id;
  end if;

  if cycle_version_id is not null and new.version_id is not null and cycle_version_id <> new.version_id then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_COMMENT_VERSION_MISMATCH';
  end if;

  new.version_id := coalesce(cycle_version_id, new.version_id);
  new.tenant_id := coalesce(cycle_tenant_id, version_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

create or replace function public.guard_estimate_review_comments_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cycle_row public.estimate_review_cycles;
  scoped_item record;
  scoped_rule record;
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

  raise exception
    using
      errcode = '22023',
      message = 'ESTIMATE_REVIEW_SCOPE_INVALID';
end;
$$;

drop trigger if exists set_estimate_review_cycles_updated_at on public.estimate_review_cycles;
create trigger set_estimate_review_cycles_updated_at
  before update on public.estimate_review_cycles
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_review_cycles_tenant_id on public.estimate_review_cycles;
create trigger set_estimate_review_cycles_tenant_id
  before insert or update on public.estimate_review_cycles
  for each row execute procedure public.assign_estimate_review_cycles_tenant_id();

drop trigger if exists guard_estimate_review_cycles_insert_trigger on public.estimate_review_cycles;
create trigger guard_estimate_review_cycles_insert_trigger
  before insert on public.estimate_review_cycles
  for each row execute procedure public.guard_estimate_review_cycles_insert();

drop trigger if exists guard_estimate_review_cycles_update_trigger on public.estimate_review_cycles;
create trigger guard_estimate_review_cycles_update_trigger
  before update on public.estimate_review_cycles
  for each row execute procedure public.guard_estimate_review_cycles_update();

drop trigger if exists set_estimate_review_comments_tenant_id on public.estimate_review_comments;
create trigger set_estimate_review_comments_tenant_id
  before insert or update on public.estimate_review_comments
  for each row execute procedure public.assign_estimate_review_comments_tenant_id();

drop trigger if exists guard_estimate_review_comments_insert_trigger on public.estimate_review_comments;
create trigger guard_estimate_review_comments_insert_trigger
  before insert on public.estimate_review_comments
  for each row execute procedure public.guard_estimate_review_comments_insert();

alter table public.estimate_review_cycles enable row level security;
alter table public.estimate_review_comments enable row level security;

drop policy if exists "Tenant members can view estimate review cycles" on public.estimate_review_cycles;
drop policy if exists "Estimate owners can create review cycles" on public.estimate_review_cycles;
drop policy if exists "Tenant approvers can close review cycles" on public.estimate_review_cycles;

create policy "Tenant members can view estimate review cycles"
  on public.estimate_review_cycles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_cycles.version_id
        and v.tenant_id = estimate_review_cycles.tenant_id
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

create policy "Estimate owners can create review cycles"
  on public.estimate_review_cycles
  for insert
  to authenticated
  with check (
    requested_by = (select auth.uid())
    and decision is null
    and decided_by is null
    and decided_at is null
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_cycles.version_id
        and v.tenant_id = estimate_review_cycles.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Tenant approvers can close review cycles"
  on public.estimate_review_cycles
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
    and decision is not null
    and decided_by = (select auth.uid())
    and decided_at is not null
  );

drop policy if exists "Tenant members can view estimate review comments" on public.estimate_review_comments;
drop policy if exists "Tenant approvers can create estimate review comments" on public.estimate_review_comments;

create policy "Tenant members can view estimate review comments"
  on public.estimate_review_comments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_review_comments.version_id
        and v.tenant_id = estimate_review_comments.tenant_id
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

create policy "Tenant approvers can create estimate review comments"
  on public.estimate_review_comments
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
    and exists (
      select 1
      from public.estimate_review_cycles cycle
      where cycle.id = estimate_review_comments.cycle_id
        and cycle.tenant_id = estimate_review_comments.tenant_id
        and cycle.version_id = estimate_review_comments.version_id
        and cycle.decision is null
    )
  );
