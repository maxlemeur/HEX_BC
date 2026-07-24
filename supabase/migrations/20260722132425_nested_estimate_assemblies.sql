-- Allow reusable estimate assemblies to contain other reusable assemblies.
-- Library references stay live; insertion into an estimate materializes a snapshot.

create table public.estimate_assembly_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  parent_assembly_id uuid not null
    references public.estimate_assemblies(id) on delete cascade,
  child_assembly_id uuid not null
    references public.estimate_assemblies(id) on delete restrict,
  quantity numeric(12,3) not null default 1 check (quantity >= 0),
  position integer not null check (position >= 1),
  unique (parent_assembly_id, child_assembly_id),
  unique (parent_assembly_id, position),
  check (parent_assembly_id <> child_assembly_id)
);

create index estimate_assembly_members_tenant_id_idx
  on public.estimate_assembly_members (tenant_id);
create index estimate_assembly_members_child_assembly_id_idx
  on public.estimate_assembly_members (child_assembly_id);

drop trigger if exists set_estimate_assembly_members_updated_at
  on public.estimate_assembly_members;
create trigger set_estimate_assembly_members_updated_at
  before update on public.estimate_assembly_members
  for each row execute procedure public.set_updated_at();

create or replace function public.validate_estimate_assembly_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
  child_tenant_id uuid;
  ancestor_depth integer := 0;
  descendant_depth integer := 0;
begin
  select a.tenant_id
    into parent_tenant_id
  from public.estimate_assemblies a
  where a.id = new.parent_assembly_id;

  select a.tenant_id
    into child_tenant_id
  from public.estimate_assemblies a
  where a.id = new.child_assembly_id;

  if parent_tenant_id is null or child_tenant_id is null then
    raise exception 'Estimate assembly member references an unknown assembly';
  end if;

  if parent_tenant_id <> child_tenant_id then
    raise exception 'Estimate assembly members must belong to the same tenant';
  end if;

  if new.parent_assembly_id = new.child_assembly_id then
    raise exception 'An estimate assembly cannot contain itself';
  end if;

  new.tenant_id := parent_tenant_id;

  if exists (
    with recursive descendants(assembly_id, path) as (
      select new.child_assembly_id, array[new.child_assembly_id]
      union all
      select member.child_assembly_id, descendants.path || member.child_assembly_id
      from descendants
      join public.estimate_assembly_members member
        on member.parent_assembly_id = descendants.assembly_id
        and member.tenant_id = parent_tenant_id
        and member.id <> new.id
      where not member.child_assembly_id = any(descendants.path)
    )
    select 1
    from descendants
    where assembly_id = new.parent_assembly_id
  ) then
    raise exception 'Estimate assembly composition would create a cycle';
  end if;

  with recursive ancestors(assembly_id, depth, path) as (
    select new.parent_assembly_id, 0, array[new.parent_assembly_id]
    union all
    select member.parent_assembly_id, ancestors.depth + 1,
      ancestors.path || member.parent_assembly_id
    from ancestors
    join public.estimate_assembly_members member
      on member.child_assembly_id = ancestors.assembly_id
      and member.tenant_id = parent_tenant_id
      and member.id <> new.id
    where not member.parent_assembly_id = any(ancestors.path)
  )
  select coalesce(max(depth), 0)
    into ancestor_depth
  from ancestors;

  with recursive descendants(assembly_id, depth, path) as (
    select new.child_assembly_id, 0, array[new.child_assembly_id]
    union all
    select member.child_assembly_id, descendants.depth + 1,
      descendants.path || member.child_assembly_id
    from descendants
    join public.estimate_assembly_members member
      on member.parent_assembly_id = descendants.assembly_id
      and member.tenant_id = parent_tenant_id
      and member.id <> new.id
    where not member.child_assembly_id = any(descendants.path)
  )
  select coalesce(max(depth), 0)
    into descendant_depth
  from descendants;

  if ancestor_depth + 1 + descendant_depth > 2 then
    raise exception 'Estimate assembly composition is limited to two nested levels';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_estimate_assembly_member()
  from public, anon, authenticated;

drop trigger if exists validate_estimate_assembly_member
  on public.estimate_assembly_members;
create trigger validate_estimate_assembly_member
  before insert or update of tenant_id, parent_assembly_id, child_assembly_id
  on public.estimate_assembly_members
  for each row execute function public.validate_estimate_assembly_member();

alter table public.estimate_assembly_members enable row level security;

drop policy if exists "Users read estimate assembly members"
  on public.estimate_assembly_members;
create policy "Users read estimate assembly members"
  on public.estimate_assembly_members
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

drop policy if exists "Users insert estimate assembly members"
  on public.estimate_assembly_members;
create policy "Users insert estimate assembly members"
  on public.estimate_assembly_members
  for insert
  to authenticated
  with check ((select public.is_tenant_member(tenant_id)));

drop policy if exists "Users update estimate assembly members"
  on public.estimate_assembly_members;
create policy "Users update estimate assembly members"
  on public.estimate_assembly_members
  for update
  to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

drop policy if exists "Users delete estimate assembly members"
  on public.estimate_assembly_members;
create policy "Users delete estimate assembly members"
  on public.estimate_assembly_members
  for delete
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

grant select, insert, update, delete
  on public.estimate_assembly_members
  to authenticated;

create or replace function public.refresh_estimate_assembly_rollup(
  p_assembly_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  direct_cost_cents bigint := 0;
  direct_labor_hours numeric := 0;
  member_cost_cents bigint := 0;
  member_labor_hours numeric := 0;
begin
  select
    coalesce(sum(round(
      case
        when item.cost_type = 'labor' then 0
        else coalesce(item.default_quantity, 0)
          * item.unit_cost_ht_cents
          * greatest(coalesce(item.k_fo, 1), 0)
      end
      + coalesce(item.h_mo, 0)
        * case
            when role.id is not null then coalesce(role.hourly_rate_cents, 0)
            when item.cost_type = 'labor' then item.unit_cost_ht_cents
            else 0
          end
        * greatest(coalesce(item.k_mo, 1), 0)
    )), 0),
    coalesce(sum(coalesce(item.h_mo, 0)), 0)
  into direct_cost_cents, direct_labor_hours
  from public.estimate_assembly_items item
  left join public.labor_roles role
    on role.id = item.labor_role_id
    and role.tenant_id = item.tenant_id
  where item.assembly_id = p_assembly_id;

  select
    coalesce(sum(round(member.quantity * child.ds_cents)), 0),
    coalesce(sum(member.quantity * coalesce(child.avg_time_hours, 0)), 0)
  into member_cost_cents, member_labor_hours
  from public.estimate_assembly_members member
  join public.estimate_assemblies child
    on child.id = member.child_assembly_id
    and child.tenant_id = member.tenant_id
  where member.parent_assembly_id = p_assembly_id;

  update public.estimate_assemblies assembly
  set
    ds_cents = greatest(direct_cost_cents + member_cost_cents, 0)::integer,
    avg_time_hours = nullif(direct_labor_hours + member_labor_hours, 0)
  where assembly.id = p_assembly_id;
end;
$$;

revoke execute on function public.refresh_estimate_assembly_rollup(uuid)
  from public, anon;
grant execute on function public.refresh_estimate_assembly_rollup(uuid)
  to authenticated;

create or replace function public.refresh_estimate_assembly_after_item_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_estimate_assembly_rollup(old.assembly_id);
  else
    perform public.refresh_estimate_assembly_rollup(new.assembly_id);
    if tg_op = 'UPDATE' and old.assembly_id <> new.assembly_id then
      perform public.refresh_estimate_assembly_rollup(old.assembly_id);
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.refresh_estimate_assembly_after_item_change()
  from public, anon, authenticated;

drop trigger if exists refresh_estimate_assembly_after_item_change
  on public.estimate_assembly_items;
create trigger refresh_estimate_assembly_after_item_change
  after insert or update or delete on public.estimate_assembly_items
  for each row execute function public.refresh_estimate_assembly_after_item_change();

create or replace function public.refresh_estimate_assembly_after_member_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_estimate_assembly_rollup(old.parent_assembly_id);
  else
    perform public.refresh_estimate_assembly_rollup(new.parent_assembly_id);
    if tg_op = 'UPDATE'
      and old.parent_assembly_id <> new.parent_assembly_id
    then
      perform public.refresh_estimate_assembly_rollup(old.parent_assembly_id);
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.refresh_estimate_assembly_after_member_change()
  from public, anon, authenticated;

drop trigger if exists refresh_estimate_assembly_after_member_change
  on public.estimate_assembly_members;
create trigger refresh_estimate_assembly_after_member_change
  after insert or update or delete on public.estimate_assembly_members
  for each row execute function public.refresh_estimate_assembly_after_member_change();

create or replace function public.propagate_estimate_assembly_rollup()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_id uuid;
begin
  if old.ds_cents is not distinct from new.ds_cents
    and old.avg_time_hours is not distinct from new.avg_time_hours
  then
    return null;
  end if;

  for parent_id in
    select member.parent_assembly_id
    from public.estimate_assembly_members member
    where member.child_assembly_id = new.id
      and member.tenant_id = new.tenant_id
  loop
    perform public.refresh_estimate_assembly_rollup(parent_id);
  end loop;

  return null;
end;
$$;

revoke execute on function public.propagate_estimate_assembly_rollup()
  from public, anon, authenticated;

drop trigger if exists propagate_estimate_assembly_rollup
  on public.estimate_assemblies;
create trigger propagate_estimate_assembly_rollup
  after update of ds_cents, avg_time_hours on public.estimate_assemblies
  for each row execute function public.propagate_estimate_assembly_rollup();

create or replace function public.replace_estimate_assembly_contents(
  p_assembly_id uuid,
  p_items jsonb,
  p_members jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_assembly public.estimate_assemblies%rowtype;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
  normalized_members jsonb := coalesce(p_members, '[]'::jsonb);
  inserted_count integer := 0;
begin
  if jsonb_typeof(normalized_items) <> 'array'
    or jsonb_typeof(normalized_members) <> 'array'
  then
    raise exception 'Assembly contents must be JSON arrays';
  end if;

  if jsonb_array_length(normalized_items) + jsonb_array_length(normalized_members) = 0 then
    raise exception 'Estimate assembly must contain at least one item or member';
  end if;

  if jsonb_array_length(normalized_items) > 50
    or jsonb_array_length(normalized_members) > 20
  then
    raise exception 'Estimate assembly content limit exceeded';
  end if;

  if exists (
    select position
    from (
      select item.position
      from jsonb_to_recordset(normalized_items) as item(position integer)
      union all
      select member.position
      from jsonb_to_recordset(normalized_members) as member(position integer)
    ) contents
    group by position
    having count(*) > 1
  ) then
    raise exception 'Estimate assembly content positions must be unique';
  end if;

  select assembly.*
    into target_assembly
  from public.estimate_assemblies assembly
  where assembly.id = p_assembly_id
    and (select public.is_tenant_member(assembly.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  delete from public.estimate_assembly_items
  where assembly_id = target_assembly.id
    and tenant_id = target_assembly.tenant_id;

  delete from public.estimate_assembly_members
  where parent_assembly_id = target_assembly.id
    and tenant_id = target_assembly.tenant_id;

  insert into public.estimate_assembly_items (
    tenant_id, assembly_id, title, unit, k_fo, k_mo, labor_role_id,
    supply_type_id, default_quantity, h_mo, position, cost_type,
    unit_cost_ht_cents, loss_coeff_bp, yield_value, yield_unit,
    source_metadata
  )
  select
    target_assembly.tenant_id,
    target_assembly.id,
    item.title,
    nullif(btrim(coalesce(item.unit, '')), ''),
    coalesce(item.k_fo, 1),
    coalesce(item.k_mo, 1),
    item.labor_role_id,
    item.supply_type_id,
    item.default_quantity,
    coalesce(item.h_mo, 0),
    item.position,
    coalesce(item.cost_type, 'material'),
    coalesce(item.unit_cost_ht_cents, 0),
    coalesce(item.loss_coeff_bp, 0),
    item.yield_value,
    nullif(btrim(coalesce(item.yield_unit, '')), ''),
    coalesce(item.source_metadata, '{}'::jsonb)
  from jsonb_to_recordset(normalized_items) as item(
    title text, unit text, k_fo numeric, k_mo numeric, labor_role_id uuid,
    supply_type_id uuid, default_quantity numeric, h_mo numeric,
    position integer, cost_type text, unit_cost_ht_cents integer,
    loss_coeff_bp integer, yield_value numeric, yield_unit text,
    source_metadata jsonb
  );

  get diagnostics inserted_count = row_count;

  insert into public.estimate_assembly_members (
    tenant_id, parent_assembly_id, child_assembly_id, quantity, position
  )
  select
    target_assembly.tenant_id,
    target_assembly.id,
    member.child_assembly_id,
    coalesce(member.quantity, 1),
    member.position
  from jsonb_to_recordset(normalized_members) as member(
    child_assembly_id uuid,
    quantity numeric,
    position integer
  );

  inserted_count := inserted_count + jsonb_array_length(normalized_members);
  perform public.refresh_estimate_assembly_rollup(target_assembly.id);
  return inserted_count;
end;
$$;

revoke execute on function public.replace_estimate_assembly_contents(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.replace_estimate_assembly_contents(uuid, jsonb, jsonb)
  to authenticated;

create or replace function public.materialize_estimate_assembly_tree(
  p_version_id uuid,
  p_assembly_id uuid,
  p_parent_item_id uuid,
  p_section_position integer,
  p_quantity_multiplier numeric,
  p_depth integer
)
returns setof public.estimate_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_assembly public.estimate_assemblies%rowtype;
  inserted_section public.estimate_items%rowtype;
  inserted_line public.estimate_items%rowtype;
  content record;
  assembly_item public.estimate_assembly_items%rowtype;
  assembly_member public.estimate_assembly_members%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_depth < 0 or p_depth > 2 then
    raise exception 'Estimate assembly composition is limited to two nested levels';
  end if;

  if p_quantity_multiplier < 0 then
    raise exception 'Estimate assembly quantity must be positive';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and (select public.is_tenant_member(version.tenant_id));

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Estimate version is read only';
  end if;

  select assembly.*
    into source_assembly
  from public.estimate_assemblies assembly
  where assembly.id = p_assembly_id
    and assembly.tenant_id = target_version.tenant_id
    and (select public.is_tenant_member(assembly.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if p_parent_item_id is not null and not exists (
    select 1
    from public.estimate_items parent_item
    where parent_item.id = p_parent_item_id
      and parent_item.version_id = target_version.id
      and parent_item.tenant_id = target_version.tenant_id
      and parent_item.item_type = 'section'
  ) then
    raise exception 'Estimate assembly parent section is invalid';
  end if;

  insert into public.estimate_items (
    tenant_id, version_id, parent_id, item_type, position, title
  )
  values (
    target_version.tenant_id,
    target_version.id,
    p_parent_item_id,
    'section',
    p_section_position,
    source_assembly.name
  )
  returning * into inserted_section;

  return next inserted_section;

  for content in
    select 'item'::text as content_type, item.id as content_id,
      item.position, item.created_at
    from public.estimate_assembly_items item
    where item.assembly_id = source_assembly.id
      and item.tenant_id = source_assembly.tenant_id
    union all
    select 'member'::text, member.id, member.position, member.created_at
    from public.estimate_assembly_members member
    where member.parent_assembly_id = source_assembly.id
      and member.tenant_id = source_assembly.tenant_id
    order by position, created_at
  loop
    if content.content_type = 'item' then
      select item.*
        into assembly_item
      from public.estimate_assembly_items item
      where item.id = content.content_id;

      insert into public.estimate_items (
        tenant_id, version_id, parent_id, item_type, position, title,
        description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo,
        supply_type_id, h_mo, h_mo_majoration, k_mo, pu_ht_cents,
        labor_role_id, line_total_ht_cents, line_tax_cents,
        line_total_ttc_cents
      )
      values (
        target_version.tenant_id,
        target_version.id,
        inserted_section.id,
        'line',
        assembly_item.position,
        assembly_item.title,
        nullif(btrim(coalesce(assembly_item.unit, '')), ''),
        coalesce(assembly_item.default_quantity, 1) * p_quantity_multiplier,
        case
          when assembly_item.cost_type = 'labor' then 0
          else coalesce(assembly_item.unit_cost_ht_cents, 0)
        end,
        coalesce(target_version.tax_rate_bp, 2000),
        coalesce(assembly_item.k_fo, 1),
        assembly_item.supply_type_id,
        coalesce(assembly_item.h_mo, 0) * p_quantity_multiplier,
        1,
        coalesce(assembly_item.k_mo, 1),
        0,
        assembly_item.labor_role_id,
        0,
        0,
        0
      )
      returning * into inserted_line;

      return next inserted_line;
    else
      select member.*
        into assembly_member
      from public.estimate_assembly_members member
      where member.id = content.content_id;

      return query
      select *
      from public.materialize_estimate_assembly_tree(
        target_version.id,
        assembly_member.child_assembly_id,
        inserted_section.id,
        assembly_member.position,
        p_quantity_multiplier * assembly_member.quantity,
        p_depth + 1
      );
    end if;
  end loop;

  return;
end;
$$;

revoke execute on function public.materialize_estimate_assembly_tree(
  uuid, uuid, uuid, integer, numeric, integer
) from public, anon;
grant execute on function public.materialize_estimate_assembly_tree(
  uuid, uuid, uuid, integer, numeric, integer
) to authenticated;

create or replace function public.insert_estimate_assembly_into_version(
  p_version_id uuid,
  p_assembly_id uuid,
  p_after_item_id uuid default null
)
returns setof public.estimate_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_assembly public.estimate_assemblies%rowtype;
  anchor_item record;
  target_parent_id uuid;
  target_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and (select public.is_tenant_member(version.tenant_id));

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Estimate version is read only';
  end if;

  select assembly.*
    into source_assembly
  from public.estimate_assemblies assembly
  where assembly.id = p_assembly_id
    and (select public.is_tenant_member(assembly.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if source_assembly.tenant_id <> target_version.tenant_id then
    raise exception 'Estimate assembly and version tenant mismatch';
  end if;

  if not exists (
    select 1 from public.estimate_assembly_items item
    where item.assembly_id = source_assembly.id
      and item.tenant_id = source_assembly.tenant_id
  ) and not exists (
    select 1 from public.estimate_assembly_members member
    where member.parent_assembly_id = source_assembly.id
      and member.tenant_id = source_assembly.tenant_id
  ) then
    raise exception 'Estimate assembly has no contents';
  end if;

  if p_after_item_id is not null then
    select item.id, item.parent_id, item.position
      into anchor_item
    from public.estimate_items item
    where item.id = p_after_item_id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;

    if not found then
      raise exception 'after_item_id invalide';
    end if;

    target_parent_id := anchor_item.parent_id;
    target_position := anchor_item.position + 1;
  else
    target_parent_id := null;
    select coalesce(max(item.position), 0) + 1
      into target_position
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is null;
  end if;

  perform 1
  from public.estimate_items item
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from target_parent_id
  for update;

  update public.estimate_items
  set position = position + 1
  where version_id = target_version.id
    and tenant_id = target_version.tenant_id
    and parent_id is not distinct from target_parent_id
    and position >= target_position;

  return query
  select *
  from public.materialize_estimate_assembly_tree(
    target_version.id,
    source_assembly.id,
    target_parent_id,
    target_position,
    1,
    0
  );

  update public.estimate_versions
  set updated_at = now()
  where id = target_version.id
    and tenant_id = target_version.tenant_id;

  return;
end;
$$;

revoke execute on function public.insert_estimate_assembly_into_version(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.insert_estimate_assembly_into_version(
  uuid, uuid, uuid
) to authenticated;
