-- EST-181: estimate templates and instantiation.

create table if not exists public.estimate_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  source_version_id uuid references public.estimate_versions(id) on delete set null,
  name text not null,
  description text,
  margin_multiplier numeric not null default 1 check (margin_multiplier >= 0),
  margin_mode public.estimate_margin_mode not null default 'fixed',
  currency text not null default 'EUR',
  margin_bp integer not null default 0 check (margin_bp >= 0),
  discount_bp integer not null default 0 check (discount_bp >= 0),
  tax_rate_bp integer not null default 2000 check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),
  rounding_mode public.estimate_rounding_mode not null default 'none',
  rounding_step_cents integer not null default 1 check (rounding_step_cents >= 1),
  validite_jours integer not null default 30 check (validite_jours >= 1),
  unique (tenant_id, created_by, name)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_templates'
      and column_name = 'user_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_templates'
      and column_name = 'created_by'
  ) then
    execute 'alter table public.estimate_templates rename column user_id to created_by';
  end if;
end;
$$;

alter table public.estimate_templates
  add column if not exists created_by uuid references public.profiles(id) on delete restrict,
  add column if not exists source_version_id uuid references public.estimate_versions(id) on delete set null,
  add column if not exists margin_multiplier numeric not null default 1 check (margin_multiplier >= 0),
  add column if not exists margin_mode public.estimate_margin_mode not null default 'fixed',
  add column if not exists currency text not null default 'EUR',
  add column if not exists margin_bp integer not null default 0 check (margin_bp >= 0),
  add column if not exists discount_bp integer not null default 0 check (discount_bp >= 0),
  add column if not exists tax_rate_bp integer not null default 2000 check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),
  add column if not exists rounding_mode public.estimate_rounding_mode not null default 'none',
  add column if not exists rounding_step_cents integer not null default 1 check (rounding_step_cents >= 1),
  add column if not exists validite_jours integer not null default 30 check (validite_jours >= 1);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_templates'
      and column_name = 'created_by'
  ) and not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'estimate_templates'
      and i.indisunique
      and (
        select array_agg(att.attname order by key_cols.ordinality)
        from unnest(i.indkey::int2[]) with ordinality as key_cols(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = t.oid
         and att.attnum = key_cols.attnum
      ) = array['tenant_id', 'created_by', 'name']::text[]
  ) then
    execute 'create unique index if not exists estimate_templates_tenant_created_by_name_key on public.estimate_templates (tenant_id, created_by, name)';
  end if;
end;
$$;

create table if not exists public.estimate_template_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  parent_id uuid references public.estimate_template_items(id) on delete cascade deferrable initially deferred,
  item_type public.estimate_item_type not null,
  position integer not null default 0,
  title text not null,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  h_mo_majoration numeric(12,4) not null default 1.0,
  k_mo numeric(12,3),
  h_mo_atelier numeric(12,3),
  k_mo_atelier numeric(12,3) default 1.0,
  labor_role_atelier_id uuid references public.labor_roles(id) on delete set null,
  h_mo_chantier numeric(12,3),
  k_mo_chantier numeric(12,3) default 1.0,
  labor_role_chantier_id uuid references public.labor_roles(id) on delete set null,
  pu_ht_cents integer,
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  category_id uuid references public.estimate_categories(id) on delete set null,
  supply_type_id uuid references public.supply_types(id) on delete set null,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer,
  check (quantity is null or quantity >= 0),
  check (unit_price_ht_cents is null or unit_price_ht_cents >= 0),
  check (tax_rate_bp is null or (tax_rate_bp >= 0 and tax_rate_bp <= 10000)),
  check (k_fo is null or k_fo >= 0),
  check (h_mo is null or h_mo >= 0),
  check (h_mo_majoration >= 0),
  check (k_mo is null or k_mo >= 0),
  check (h_mo_atelier is null or h_mo_atelier >= 0),
  check (k_mo_atelier is null or k_mo_atelier >= 0),
  check (h_mo_chantier is null or h_mo_chantier >= 0),
  check (k_mo_chantier is null or k_mo_chantier >= 0),
  check (pu_ht_cents is null or pu_ht_cents >= 0),
  check (line_total_ht_cents is null or line_total_ht_cents >= 0),
  check (line_tax_cents is null or line_tax_cents >= 0),
  check (line_total_ttc_cents is null or line_total_ttc_cents >= 0),
  check (
    line_total_ht_cents is null
    or line_total_ttc_cents is null
    or line_total_ttc_cents >= line_total_ht_cents
  ),
  check (
    (
      item_type = 'section'
      and quantity is null
      and unit_price_ht_cents is null
      and tax_rate_bp is null
      and k_fo is null
      and h_mo is null
      and h_mo_majoration = 1.0
      and k_mo is null
      and h_mo_atelier is null
      and k_mo_atelier = 1.0
      and labor_role_atelier_id is null
      and h_mo_chantier is null
      and k_mo_chantier = 1.0
      and labor_role_chantier_id is null
      and pu_ht_cents is null
      and labor_role_id is null
      and category_id is null
      and supply_type_id is null
      and line_total_ht_cents is null
      and line_tax_cents is null
      and line_total_ttc_cents is null
    )
    or
    (
      item_type = 'line'
      and quantity is not null
      and unit_price_ht_cents is not null
      and tax_rate_bp is not null
      and k_fo is not null
      and h_mo is not null
      and h_mo_majoration is not null
      and k_mo is not null
      and pu_ht_cents is not null
      and line_total_ht_cents is not null
      and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  )
);

drop trigger if exists set_estimate_templates_updated_at on public.estimate_templates;
create trigger set_estimate_templates_updated_at
  before update on public.estimate_templates
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_template_items_updated_at on public.estimate_template_items;
create trigger set_estimate_template_items_updated_at
  before update on public.estimate_template_items
  for each row execute procedure public.set_updated_at();

create index if not exists estimate_templates_tenant_created_at_idx
  on public.estimate_templates (tenant_id, created_at desc);
create index if not exists estimate_templates_source_version_id_idx
  on public.estimate_templates (source_version_id);
create index if not exists estimate_template_items_tenant_id_idx
  on public.estimate_template_items (tenant_id);
create index if not exists estimate_template_items_template_id_idx
  on public.estimate_template_items (template_id);
create index if not exists estimate_template_items_parent_id_idx
  on public.estimate_template_items (parent_id);
create index if not exists estimate_template_items_category_id_idx
  on public.estimate_template_items (category_id);
create index if not exists estimate_template_items_labor_role_id_idx
  on public.estimate_template_items (labor_role_id);
create unique index if not exists estimate_template_items_root_position_unique
  on public.estimate_template_items (template_id, position)
  where parent_id is null;
create unique index if not exists estimate_template_items_child_position_unique
  on public.estimate_template_items (parent_id, position)
  where parent_id is not null;

create or replace function public.assign_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_table_name = 'purchase_order_items' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'purchase_order_devis' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'estimate_versions' then
    select ep.tenant_id
      into parent_tenant_id
    from public.estimate_projects ep
    where ep.id = new.project_id;
  elsif tg_table_name = 'estimate_items' then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  elsif tg_table_name = 'estimate_templates' and new.tenant_id is null then
    parent_tenant_id := public.current_tenant_id();
  elsif tg_table_name = 'estimate_template_items' then
    select et.tenant_id
      into parent_tenant_id
    from public.estimate_templates et
    where et.id = new.template_id;
  elsif tg_table_name = 'audit_logs' and new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  elsif tg_table_name = 'dpgf_rows_raw' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  elsif tg_table_name = 'dpgf_rows_mapped' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;

    if parent_tenant_id is null and new.raw_row_id is not null then
      select drr.tenant_id
        into parent_tenant_id
      from public.dpgf_rows_raw drr
      where drr.id = new.raw_row_id;
    end if;
  elsif tg_table_name = 'dpgf_mappings' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_templates_tenant_id on public.estimate_templates;
create trigger set_estimate_templates_tenant_id
  before insert or update on public.estimate_templates
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_template_items_tenant_id on public.estimate_template_items;
create trigger set_estimate_template_items_tenant_id
  before insert or update on public.estimate_template_items
  for each row execute procedure public.assign_tenant_id();

alter table public.estimate_templates enable row level security;
alter table public.estimate_template_items enable row level security;

drop policy if exists "Users can manage estimate templates" on public.estimate_templates;
drop policy if exists "Users can view estimate template items" on public.estimate_template_items;
drop policy if exists "Users can insert estimate template items" on public.estimate_template_items;
drop policy if exists "Users can update estimate template items" on public.estimate_template_items;
drop policy if exists "Users can delete estimate template items" on public.estimate_template_items;

create policy "Users can manage estimate templates"
  on public.estimate_templates
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      created_by = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      created_by = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can view estimate template items"
  on public.estimate_template_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert estimate template items"
  on public.estimate_template_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    and (
      estimate_template_items.parent_id is null
      or exists (
        select 1
        from public.estimate_template_items p
        where p.id = estimate_template_items.parent_id
          and p.template_id = estimate_template_items.template_id
          and p.tenant_id = estimate_template_items.tenant_id
      )
    )
  );

create policy "Users can update estimate template items"
  on public.estimate_template_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    and (
      estimate_template_items.parent_id is null
      or exists (
        select 1
        from public.estimate_template_items p
        where p.id = estimate_template_items.parent_id
          and p.template_id = estimate_template_items.template_id
          and p.tenant_id = estimate_template_items.tenant_id
      )
    )
  );

create policy "Users can delete estimate template items"
  on public.estimate_template_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create or replace function public.create_estimate_template_from_version(
  p_source_version_id uuid,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  source_owner_id uuid;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Template name is required';
  end if;

  select v.*, p.user_id
    into source_version, source_owner_id
  from public.estimate_versions v
  join public.estimate_projects p
    on p.id = v.project_id
   and p.tenant_id = v.tenant_id
  where v.id = p_source_version_id
    and (select public.is_tenant_member(v.tenant_id))
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template source version not found or access denied';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_version.tenant_id,
    current_user_id,
    source_version.id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.validite_jours
  );

  create temporary table _estimate_template_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = p_source_version_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
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
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_template_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
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
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_template_item_map map on map.old_id = src.id
  left join _estimate_template_item_map parent_map on parent_map.old_id = src.parent_id
  where src.version_id = p_source_version_id;

  return new_template_id;
end;
$$;

create or replace function public.duplicate_estimate_template(
  p_template_id uuid,
  p_name text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
  duplicate_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  duplicate_name := nullif(btrim(coalesce(p_name, '')), '');
  if duplicate_name is null then
    duplicate_name := source_template.name || ' (copie)';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_template.tenant_id,
    current_user_id,
    source_template.source_version_id,
    duplicate_name,
    source_template.description,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    source_template.validite_jours
  );

  create temporary table _estimate_template_duplicate_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_duplicate_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
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
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
    new_template_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
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
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_duplicate_map map on map.old_id = src.id
  left join _estimate_template_duplicate_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return new_template_id;
end;
$$;

drop function if exists public.instantiate_estimate_from_template(
  uuid,
  text,
  text,
  date,
  integer
);

create function public.instantiate_estimate_from_template(
  p_template_id uuid,
  p_project_name text,
  p_version_title text,
  p_date_devis date,
  p_validite_jours integer
)
returns table (project_id uuid, version_id uuid)
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_project_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
  target_validite_jours integer;
  total_ht integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_project_name, '')), '') is null then
    raise exception 'Project name is required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  target_validite_jours := coalesce(p_validite_jours, source_template.validite_jours);
  if target_validite_jours <= 0 then
    raise exception 'validite_jours must be greater than 0';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0)
    into total_ht, total_tax
  from public.estimate_template_items item
  where item.template_id = p_template_id
    and item.tenant_id = source_template.tenant_id
    and item.item_type = 'line';

  total_ttc := total_ht + total_tax;

  insert into public.estimate_projects (
    id,
    tenant_id,
    user_id,
    name
  )
  values (
    new_project_id,
    source_template.tenant_id,
    current_user_id,
    btrim(p_project_name)
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
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    new_version_id,
    source_template.tenant_id,
    new_project_id,
    1,
    'draft',
    nullif(btrim(coalesce(p_version_title, '')), ''),
    coalesce(p_date_devis, current_date),
    target_validite_jours,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    total_ht,
    total_tax,
    total_ttc
  );

  create temporary table _estimate_template_instantiation_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_instantiation_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

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
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
    new_version_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
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
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_instantiation_map map on map.old_id = src.id
  left join _estimate_template_instantiation_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return query
  select new_project_id, new_version_id;
end;
$$;
