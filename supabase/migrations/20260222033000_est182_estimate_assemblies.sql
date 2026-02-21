-- EST-182: reusable estimate assemblies and atomic insertion into estimate versions.

create table if not exists public.estimate_assemblies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  description text,
  unique (tenant_id, name)
);

create table if not exists public.estimate_assembly_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  assembly_id uuid not null references public.estimate_assemblies(id) on delete cascade,
  title text not null,
  unit text,
  k_fo numeric(12,3) not null default 1 check (k_fo >= 0),
  k_mo numeric(12,3) not null default 1 check (k_mo >= 0),
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  default_quantity numeric(12,3) check (default_quantity is null or default_quantity >= 0),
  position integer not null default 1
);

create index if not exists estimate_assemblies_tenant_id_idx
  on public.estimate_assemblies (tenant_id);
create index if not exists estimate_assemblies_tenant_created_at_idx
  on public.estimate_assemblies (tenant_id, created_at desc);
create index if not exists estimate_assembly_items_tenant_id_idx
  on public.estimate_assembly_items (tenant_id);
create index if not exists estimate_assembly_items_assembly_id_idx
  on public.estimate_assembly_items (assembly_id);
create index if not exists estimate_assembly_items_labor_role_id_idx
  on public.estimate_assembly_items (labor_role_id);
create unique index if not exists estimate_assembly_items_assembly_position_key
  on public.estimate_assembly_items (assembly_id, position);

drop trigger if exists set_estimate_assemblies_updated_at on public.estimate_assemblies;
create trigger set_estimate_assemblies_updated_at
  before update on public.estimate_assemblies
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_assembly_items_updated_at on public.estimate_assembly_items;
create trigger set_estimate_assembly_items_updated_at
  before update on public.estimate_assembly_items
  for each row execute procedure public.set_updated_at();

create or replace function public.assign_estimate_assembly_items_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  select a.tenant_id
    into parent_tenant_id
  from public.estimate_assemblies a
  where a.id = new.assembly_id;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_assemblies_tenant_id on public.estimate_assemblies;
create trigger set_estimate_assemblies_tenant_id
  before insert or update on public.estimate_assemblies
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_assembly_items_tenant_id on public.estimate_assembly_items;
create trigger set_estimate_assembly_items_tenant_id
  before insert or update on public.estimate_assembly_items
  for each row execute procedure public.assign_estimate_assembly_items_tenant_id();

alter table public.estimate_assemblies enable row level security;
alter table public.estimate_assembly_items enable row level security;

drop policy if exists "Users can manage estimate assemblies" on public.estimate_assemblies;
create policy "Users can manage estimate assemblies"
  on public.estimate_assemblies
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
  )
  with check (
    (select public.is_tenant_member(tenant_id))
  );

drop policy if exists "Users can manage estimate assembly items" on public.estimate_assembly_items;
create policy "Users can manage estimate assembly items"
  on public.estimate_assembly_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_assemblies a
      where a.id = estimate_assembly_items.assembly_id
        and a.tenant_id = estimate_assembly_items.tenant_id
        and (select public.is_tenant_member(a.tenant_id))
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_assemblies a
      where a.id = estimate_assembly_items.assembly_id
        and a.tenant_id = estimate_assembly_items.tenant_id
        and (select public.is_tenant_member(a.tenant_id))
    )
  );

create or replace function public.insert_estimate_assembly_into_version(
  p_version_id uuid,
  p_assembly_id uuid,
  p_after_item_id uuid default null
)
returns setof public.estimate_items
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_assembly public.estimate_assemblies%rowtype;
  anchor_item record;
  target_parent_id uuid;
  target_position integer;
  inserted_section public.estimate_items%rowtype;
  inserted_line public.estimate_items%rowtype;
  assembly_item public.estimate_assembly_items%rowtype;
  line_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select v.*
    into target_version
  from public.estimate_versions v
  where v.id = p_version_id
    and (select public.is_tenant_member(v.tenant_id));

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Estimate version is read only';
  end if;

  select a.*
    into source_assembly
  from public.estimate_assemblies a
  where a.id = p_assembly_id
    and (select public.is_tenant_member(a.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if source_assembly.tenant_id <> target_version.tenant_id then
    raise exception 'Estimate assembly and version tenant mismatch';
  end if;

  if not exists (
    select 1
    from public.estimate_assembly_items ai
    where ai.assembly_id = source_assembly.id
      and ai.tenant_id = source_assembly.tenant_id
  ) then
    raise exception 'Estimate assembly has no items';
  end if;

  if p_after_item_id is not null then
    select id, parent_id, position
      into anchor_item
    from public.estimate_items
    where id = p_after_item_id
      and version_id = target_version.id
      and tenant_id = target_version.tenant_id;

    if not found then
      raise exception 'after_item_id invalide';
    end if;

    target_parent_id := anchor_item.parent_id;
    target_position := anchor_item.position + 1;
  else
    target_parent_id := null;
    select coalesce(max(i.position), 0) + 1
      into target_position
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null;
  end if;

  if target_parent_id is null then
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null
    for update;

    update public.estimate_items
    set position = position + 1
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id is null
      and position >= target_position;
  else
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id = target_parent_id
    for update;

    update public.estimate_items
    set position = position + 1
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id = target_parent_id
      and position >= target_position;
  end if;

  insert into public.estimate_items (
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title
  )
  values (
    target_version.tenant_id,
    target_version.id,
    target_parent_id,
    'section',
    target_position,
    source_assembly.name
  )
  returning *
  into inserted_section;

  return next inserted_section;

  for assembly_item in
    select ai.*
    from public.estimate_assembly_items ai
    where ai.assembly_id = source_assembly.id
      and ai.tenant_id = source_assembly.tenant_id
    order by ai.position asc, ai.created_at asc
  loop
    line_position := greatest(assembly_item.position, 1);

    insert into public.estimate_items (
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
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    values (
      target_version.tenant_id,
      target_version.id,
      inserted_section.id,
      'line',
      line_position,
      assembly_item.title,
      nullif(btrim(coalesce(assembly_item.unit, '')), ''),
      coalesce(assembly_item.default_quantity, 1),
      0,
      coalesce(target_version.tax_rate_bp, 2000),
      coalesce(assembly_item.k_fo, 1),
      0,
      1,
      coalesce(assembly_item.k_mo, 1),
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      assembly_item.labor_role_id,
      null,
      null,
      null,
      0,
      0,
      0
    )
    returning *
    into inserted_line;

    return next inserted_line;
  end loop;

  update public.estimate_versions
  set updated_at = now()
  where id = target_version.id
    and tenant_id = target_version.tenant_id;

  return;
end;
$$;
