-- EST-037: business rules engine (margin/discount/approval) with tenant-scoped approvals.

do $$
begin
  create type public.estimate_rule_type as enum ('min_margin', 'max_discount', 'require_approval');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_rule_scope_type as enum ('global', 'category', 'client');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_rule_action as enum ('warn', 'block', 'require_approval');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_approval_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.estimate_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_type public.estimate_rule_type not null,
  scope_type public.estimate_rule_scope_type not null default 'global',
  scope_id uuid,
  threshold_value numeric not null,
  action public.estimate_rule_action not null,
  is_active boolean not null default true,
  check (threshold_value >= 0)
);

create index if not exists estimate_rules_tenant_active_idx
  on public.estimate_rules (tenant_id, is_active);
create index if not exists estimate_rules_tenant_scope_idx
  on public.estimate_rules (tenant_id, scope_type, scope_id);

create table if not exists public.estimate_approvals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  rule_id uuid not null references public.estimate_rules(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  status public.estimate_approval_status not null default 'pending',
  decided_at timestamptz,
  check (
    (
      status = 'pending'
      and approved_by is null
      and decided_at is null
    )
    or (
      status in ('approved', 'rejected')
      and approved_by is not null
      and decided_at is not null
    )
  )
);

create index if not exists estimate_approvals_tenant_status_idx
  on public.estimate_approvals (tenant_id, status, created_at desc);
create index if not exists estimate_approvals_tenant_version_idx
  on public.estimate_approvals (tenant_id, version_id, created_at desc);
create index if not exists estimate_approvals_tenant_rule_idx
  on public.estimate_approvals (tenant_id, rule_id, created_at desc);

create unique index if not exists estimate_approvals_pending_unique_idx
  on public.estimate_approvals (tenant_id, version_id, rule_id)
  where status = 'pending';

create or replace function public.assign_estimate_rules_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_approvals_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  version_tenant_id uuid;
  rule_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into version_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if new.rule_id is not null then
    select er.tenant_id
      into rule_tenant_id
    from public.estimate_rules er
    where er.id = new.rule_id;
  end if;

  if version_tenant_id is null and rule_tenant_id is null then
    new.tenant_id := coalesce(new.tenant_id, public.current_tenant_id());
    return new;
  end if;

  if version_tenant_id is not null and rule_tenant_id is not null and version_tenant_id <> rule_tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_APPROVAL_TENANT_MISMATCH',
        detail = format('version_id=%s and rule_id=%s belong to different tenants', new.version_id, new.rule_id);
  end if;

  new.tenant_id := coalesce(version_tenant_id, rule_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

create or replace function public.guard_estimate_approvals_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.rule_id is distinct from new.rule_id
    or old.requested_by is distinct from new.requested_by
    or old.created_at is distinct from new.created_at
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_APPROVAL_IMMUTABLE_FIELDS',
        detail = 'tenant_id/version_id/rule_id/requested_by/created_at cannot be changed.';
  end if;

  if new.status = 'pending' then
    if new.approved_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_APPROVAL_PENDING_INVALID',
          detail = 'pending approvals cannot carry approved_by/decided_at.';
    end if;
  else
    if new.status not in ('approved', 'rejected') then
      raise exception
        using
          errcode = '22023',
          message = 'ESTIMATE_APPROVAL_STATUS_INVALID',
          detail = format('status=%s is not supported', new.status);
    end if;

    if new.approved_by is null or new.decided_at is null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_APPROVAL_DECISION_INVALID',
          detail = 'approved/rejected approvals must carry approved_by and decided_at.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_rules_updated_at on public.estimate_rules;
create trigger set_estimate_rules_updated_at
  before update on public.estimate_rules
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_rules_tenant_id on public.estimate_rules;
create trigger set_estimate_rules_tenant_id
  before insert on public.estimate_rules
  for each row execute procedure public.assign_estimate_rules_tenant_id();

drop trigger if exists set_estimate_approvals_updated_at on public.estimate_approvals;
create trigger set_estimate_approvals_updated_at
  before update on public.estimate_approvals
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_approvals_tenant_id on public.estimate_approvals;
create trigger set_estimate_approvals_tenant_id
  before insert or update on public.estimate_approvals
  for each row execute procedure public.assign_estimate_approvals_tenant_id();

drop trigger if exists guard_estimate_approvals_update_trigger on public.estimate_approvals;
create trigger guard_estimate_approvals_update_trigger
  before update on public.estimate_approvals
  for each row execute procedure public.guard_estimate_approvals_update();

alter table public.estimate_rules enable row level security;
alter table public.estimate_approvals enable row level security;

drop policy if exists "Tenant members can view estimate rules" on public.estimate_rules;
drop policy if exists "Tenant admins can manage estimate rules" on public.estimate_rules;

drop policy if exists "Tenant members can view estimate approvals" on public.estimate_approvals;
drop policy if exists "Tenant members can create estimate approvals" on public.estimate_approvals;
drop policy if exists "Tenant admins can decide estimate approvals" on public.estimate_approvals;

create policy "Tenant members can view estimate rules"
  on public.estimate_rules
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage estimate rules"
  on public.estimate_rules
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Tenant members can view estimate approvals"
  on public.estimate_approvals
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can create estimate approvals"
  on public.estimate_approvals
  for insert
  to authenticated
  with check (
    (select public.is_tenant_member(tenant_id))
    and requested_by = (select auth.uid())
    and status = 'pending'
    and approved_by is null
    and decided_at is null
  );

create policy "Tenant admins can decide estimate approvals"
  on public.estimate_approvals
  for update
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check (
    (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    and (
      status = 'pending'
      or (
        status in ('approved', 'rejected')
        and approved_by = (select auth.uid())
        and decided_at is not null
      )
    )
  );
