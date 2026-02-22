-- EST-163: suggestion learning from manual corrections.

alter table if exists public.feature_flags
  add column if not exists value text;

create table if not exists public.suggestion_corrections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_id uuid not null references public.estimate_suggestion_rules(id) on delete cascade,
  field_name text not null check (
    field_name in (
      'description',
      'category_id',
      'k_fo',
      'k_mo',
      'labor_role_id',
      'supply_type_id'
    )
  ),
  original_value text,
  corrected_value text,
  item_title text not null default '',
  user_id uuid not null references public.profiles(id) on delete restrict
);

alter table public.suggestion_corrections
  alter column tenant_id set default public.current_tenant_id();

create index if not exists suggestion_corrections_rule_field_corrected_idx
  on public.suggestion_corrections (rule_id, field_name, corrected_value);

create index if not exists suggestion_corrections_tenant_created_idx
  on public.suggestion_corrections (tenant_id, created_at desc);

create index if not exists suggestion_corrections_tenant_rule_idx
  on public.suggestion_corrections (tenant_id, rule_id);

create or replace function public.assign_suggestion_corrections_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.rule_id is not null then
    select esr.tenant_id
      into parent_tenant_id
    from public.estimate_suggestion_rules esr
    where esr.id = new.rule_id;
  end if;

  new.tenant_id := coalesce(parent_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

drop trigger if exists set_suggestion_corrections_tenant_id
  on public.suggestion_corrections;
create trigger set_suggestion_corrections_tenant_id
  before insert or update on public.suggestion_corrections
  for each row execute procedure public.assign_suggestion_corrections_tenant_id();

alter table public.suggestion_corrections enable row level security;

drop policy if exists "Tenant members can view suggestion corrections"
  on public.suggestion_corrections;
drop policy if exists "Tenant members can insert suggestion corrections"
  on public.suggestion_corrections;
drop policy if exists "Tenant admins can delete suggestion corrections"
  on public.suggestion_corrections;

create policy "Tenant members can view suggestion corrections"
  on public.suggestion_corrections
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can insert suggestion corrections"
  on public.suggestion_corrections
  for insert
  to authenticated
  with check (
    (select public.is_tenant_member(tenant_id))
    and user_id = (select auth.uid())
  );

create policy "Tenant admins can delete suggestion corrections"
  on public.suggestion_corrections
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create table if not exists public.suggestion_learning_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_id uuid not null references public.estimate_suggestion_rules(id) on delete cascade,
  field_name text not null check (
    field_name in (
      'description',
      'category_id',
      'k_fo',
      'k_mo',
      'labor_role_id',
      'supply_type_id'
    )
  ),
  corrected_value text,
  status text not null check (status in ('approved', 'rejected')),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now()
);

alter table public.suggestion_learning_reviews
  alter column tenant_id set default public.current_tenant_id();

drop trigger if exists set_suggestion_learning_reviews_updated_at
  on public.suggestion_learning_reviews;
create trigger set_suggestion_learning_reviews_updated_at
  before update on public.suggestion_learning_reviews
  for each row execute procedure public.set_updated_at();

create unique index if not exists suggestion_learning_reviews_unique_triplet_idx
  on public.suggestion_learning_reviews (
    tenant_id,
    rule_id,
    field_name,
    coalesce(corrected_value, '__NULL__')
  );

create index if not exists suggestion_learning_reviews_tenant_rule_idx
  on public.suggestion_learning_reviews (tenant_id, rule_id);

create or replace function public.assign_suggestion_learning_reviews_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.rule_id is not null then
    select esr.tenant_id
      into parent_tenant_id
    from public.estimate_suggestion_rules esr
    where esr.id = new.rule_id;
  end if;

  new.tenant_id := coalesce(parent_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

drop trigger if exists set_suggestion_learning_reviews_tenant_id
  on public.suggestion_learning_reviews;
create trigger set_suggestion_learning_reviews_tenant_id
  before insert or update on public.suggestion_learning_reviews
  for each row execute procedure public.assign_suggestion_learning_reviews_tenant_id();

alter table public.suggestion_learning_reviews enable row level security;

drop policy if exists "Tenant members can view suggestion learning reviews"
  on public.suggestion_learning_reviews;
drop policy if exists "Tenant admins can manage suggestion learning reviews"
  on public.suggestion_learning_reviews;

create policy "Tenant members can view suggestion learning reviews"
  on public.suggestion_learning_reviews
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage suggestion learning reviews"
  on public.suggestion_learning_reviews
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create or replace function public.get_suggestion_learnings(
  target_tenant_id uuid default public.current_tenant_id(),
  threshold integer default 3,
  include_inactive boolean default false
)
returns table (
  rule_id uuid,
  field_name text,
  corrected_value text,
  correction_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  review_status text,
  decided_by uuid,
  decided_at timestamptz,
  is_active boolean,
  sample_original_value text,
  sample_item_title text
)
language sql
stable
set search_path = public
as $$
  with normalized as (
    select
      coalesce(target_tenant_id, public.current_tenant_id()) as tenant_id,
      greatest(coalesce(threshold, 3), 1) as min_corrections
  ),
  aggregated as (
    select
      c.rule_id,
      c.field_name,
      c.corrected_value,
      count(*)::integer as correction_count,
      min(c.created_at) as first_seen_at,
      max(c.created_at) as last_seen_at,
      (
        array_agg(c.original_value order by c.created_at desc)
          filter (where c.original_value is not null)
      )[1] as sample_original_value,
      (
        array_agg(c.item_title order by c.created_at desc)
          filter (where c.item_title is not null and btrim(c.item_title) <> '')
      )[1] as sample_item_title
    from public.suggestion_corrections c
    join normalized n on n.tenant_id = c.tenant_id
    group by c.rule_id, c.field_name, c.corrected_value
  ),
  merged as (
    select
      a.rule_id,
      a.field_name,
      a.corrected_value,
      a.correction_count,
      a.first_seen_at,
      a.last_seen_at,
      r.status as review_status,
      r.decided_by,
      r.decided_at,
      case
        when r.status = 'approved' then true
        when r.status = 'rejected' then false
        else a.correction_count >= n.min_corrections
      end as is_active,
      a.sample_original_value,
      a.sample_item_title
    from aggregated a
    join normalized n on true
    left join public.suggestion_learning_reviews r
      on r.tenant_id = n.tenant_id
      and r.rule_id = a.rule_id
      and r.field_name = a.field_name
      and coalesce(r.corrected_value, '__NULL__') = coalesce(a.corrected_value, '__NULL__')
  )
  select
    merged.rule_id,
    merged.field_name,
    merged.corrected_value,
    merged.correction_count,
    merged.first_seen_at,
    merged.last_seen_at,
    merged.review_status,
    merged.decided_by,
    merged.decided_at,
    merged.is_active,
    merged.sample_original_value,
    merged.sample_item_title
  from merged
  where include_inactive or merged.is_active
  order by merged.is_active desc, merged.correction_count desc, merged.last_seen_at desc;
$$;

create or replace function public.purge_suggestion_corrections(
  target_tenant_id uuid default public.current_tenant_id(),
  retention_months integer default 12
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  scoped_tenant_id uuid := coalesce(target_tenant_id, public.current_tenant_id());
  normalized_retention_months integer := greatest(1, least(coalesce(retention_months, 12), 120));
  deleted_count integer := 0;
begin
  if scoped_tenant_id is null then
    return 0;
  end if;

  if not (select public.has_tenant_role(scoped_tenant_id, array['admin'::public.tenant_role])) then
    raise exception 'Access denied';
  end if;

  delete from public.suggestion_corrections
  where tenant_id = scoped_tenant_id
    and created_at < (now() - make_interval(months => normalized_retention_months));

  get diagnostics deleted_count = row_count;

  delete from public.suggestion_learning_reviews r
  where r.tenant_id = scoped_tenant_id
    and not exists (
      select 1
      from public.suggestion_corrections c
      where c.tenant_id = r.tenant_id
        and c.rule_id = r.rule_id
        and c.field_name = r.field_name
        and coalesce(c.corrected_value, '__NULL__') = coalesce(r.corrected_value, '__NULL__')
    );

  return deleted_count;
end;
$$;

grant execute on function public.get_suggestion_learnings(uuid, integer, boolean) to authenticated;
grant execute on function public.purge_suggestion_corrections(uuid, integer) to authenticated;

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'EST_163_SUGGESTION_LEARNING', false, null
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'EST_163_SUGGESTION_LEARNING_THRESHOLD', true, '3'
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'EST_163_SUGGESTION_LEARNING_RETENTION_MONTHS', true, '12'
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;
