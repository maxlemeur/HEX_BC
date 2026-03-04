-- EST-025: add cascade discount mode/steps and global coefficient on estimates.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'estimate_discount_mode'
  ) then
    create type public.estimate_discount_mode as enum ('simple', 'cascade');
  end if;
end;
$$;

alter table public.estimate_versions
  add column if not exists discount_mode public.estimate_discount_mode not null default 'simple',
  add column if not exists discount_steps integer[] not null default '{}',
  add column if not exists global_coefficient numeric not null default 1;

alter table public.estimate_templates
  add column if not exists discount_mode public.estimate_discount_mode not null default 'simple',
  add column if not exists discount_steps integer[] not null default '{}',
  add column if not exists global_coefficient numeric not null default 1;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_discount_mode_steps_check;
alter table public.estimate_versions
  add constraint estimate_versions_discount_mode_steps_check
  check (discount_mode <> 'simple' or cardinality(discount_steps) = 0);

alter table public.estimate_versions
  drop constraint if exists estimate_versions_global_coefficient_nonnegative_check;
alter table public.estimate_versions
  add constraint estimate_versions_global_coefficient_nonnegative_check
  check (global_coefficient >= 0);

alter table public.estimate_templates
  drop constraint if exists estimate_templates_discount_mode_steps_check;
alter table public.estimate_templates
  add constraint estimate_templates_discount_mode_steps_check
  check (discount_mode <> 'simple' or cardinality(discount_steps) = 0);

alter table public.estimate_templates
  drop constraint if exists estimate_templates_global_coefficient_nonnegative_check;
alter table public.estimate_templates
  add constraint estimate_templates_global_coefficient_nonnegative_check
  check (global_coefficient >= 0);

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if new.status = old.status then
      raise exception 'Estimate version is read-only';
    end if;

    if new.created_at is distinct from old.created_at
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
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
      or new.seal_hash is distinct from old.seal_hash
      or new.parent_version_id is distinct from old.parent_version_id
      or new.variant_label is distinct from old.variant_label
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
begin
  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
  where v.id = source_version_id
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := source_version_id;

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
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
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
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label
  );

  create temporary table _estimate_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = source_version_id;

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
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
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
    src.selected_supplier_price_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

  return new_version_id;
end;
$$;

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
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Template name is required';
  end if;

  select v.*
    into source_version
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
    discount_mode,
    discount_steps,
    global_coefficient,
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
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
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
    discount_mode,
    discount_steps,
    global_coefficient,
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
    source_template.discount_mode,
    source_template.discount_steps,
    source_template.global_coefficient,
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

create or replace function public.instantiate_estimate_from_template(
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
    discount_mode,
    discount_steps,
    global_coefficient,
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
    source_template.discount_mode,
    source_template.discount_steps,
    source_template.global_coefficient,
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
