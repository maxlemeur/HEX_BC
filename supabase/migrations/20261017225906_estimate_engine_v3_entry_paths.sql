-- Lot 2, sub-lot 2.8 (M6): engine 3 entry paths (design §6.1 M6, §7, D16, P-12, P-14).
-- Contract, failure modes and proofs: docs/testing/estimate-engine-v3-2.8.md.
--
-- 1. estimate_template_items gains the v3 line columns (unit_code, pricing_status, hours per unit), null
--    and 'priced' on every existing template; create_estimate_template_from_version and
--    duplicate_estimate_template copy them.
-- 2. public.estimate_v3_complete_entry_for_writer: under the v3 writer contract, resolves the unit of the
--    new lines through the shared referential (a code, or a status mention), then stores the amounts of
--    the v3 engine (private.estimate_v3_compute) on every line and on the version, and asserts them
--    (private.estimate_v3_assert_draft). Same trust model as the M4 writer bridges.
-- 3. insert_estimate_template_into_version: into a v3, hours per unit from the template, or h / Q
--    half up to 4 decimals for a v1/v2 template; Q = 0 with hours is refused, line named
--    (ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY).
-- 4. materialize_estimate_assembly_tree and insert_estimate_assembly_into_version: into a v3, hours per
--    unit = h_mo / default quantity, exact to 4 decimals; refused, component named, when the default
--    quantity is 0 with hours (ESTIMATE_V3_ASSEMBLY_HOURS_WITHOUT_QUANTITY) or when the quotient is not
--    exact (ESTIMATE_V3_ASSEMBLY_HOURS_PER_UNIT_INEXACT).
-- 5. private.generated_ouvrage_insert_line accepts unit_code, pricing_status and hours per unit;
--    commit_generated_ouvrages writes a v3 under the writer contract and lets the bridge compute its
--    amounts (the client sends no projection for a v3).
-- finalize_estimate_assembly_calculation stays v1/v2: a v3 gets its amounts at insertion (point 2).
-- Each function is copied from its latest definition (20261014114943, 20260304180000, 20261013002038,
-- 20260722132425, 20261012043643, 20261012215942) with only the lines above changed. CREATE OR REPLACE
-- keeps owners and ACLs. No existing row is rewritten.
begin;

do $preflight$
begin
  if to_regprocedure('private.estimate_v3_compute(uuid)') is null
    or to_regprocedure('private.estimate_v3_assert_draft(uuid)') is null
    or to_regprocedure('private.normalize_unit(text)') is null
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'estimate_items' and column_name = 'h_mo_per_unit') then
    raise exception 'LOT2_2_8_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

alter table public.estimate_template_items
  add column if not exists unit_code text references public.measurement_units(code),
  add column if not exists pricing_status public.estimate_line_pricing_status not null default 'priced',
  add column if not exists h_mo_per_unit numeric(12,4),
  add column if not exists h_mo_atelier_per_unit numeric(12,4),
  add column if not exists h_mo_chantier_per_unit numeric(12,4);
alter table public.estimate_template_items drop constraint if exists estimate_template_items_v3_section_columns_check;
alter table public.estimate_template_items add constraint estimate_template_items_v3_section_columns_check check (
  item_type = 'line'
  or (unit_code is null and pricing_status = 'priced' and h_mo_per_unit is null
    and h_mo_atelier_per_unit is null and h_mo_chantier_per_unit is null)
);
alter table public.estimate_template_items drop constraint if exists estimate_template_items_v3_hours_per_unit_nonnegative_check;
alter table public.estimate_template_items add constraint estimate_template_items_v3_hours_per_unit_nonnegative_check check (
  (h_mo_per_unit is null or h_mo_per_unit >= 0)
  and (h_mo_atelier_per_unit is null or h_mo_atelier_per_unit >= 0)
  and (h_mo_chantier_per_unit is null or h_mo_chantier_per_unit >= 0)
);
comment on column public.estimate_template_items.unit_code is
  'Engine 3 unit code of a template line saved from a v3 (D9); null on templates saved from engines 1 and 2.';
comment on column public.estimate_template_items.h_mo_per_unit is
  'Engine 3 labour hours per unit of a template line saved from a v3 (D4); null otherwise: inserting such a line into a v3 converts h / Q.';

create or replace function public.estimate_v3_complete_entry_for_writer(p_version_id uuid, p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  computed jsonb;
begin
  if p_version_id is null
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '') <> p_version_id::text
    or not exists (select 1 from public.estimate_versions version
      where version.id = p_version_id and version.calc_engine_version = 3)
  then
    raise exception using errcode = '0A000', message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  -- The unit of each new line through the shared referential: a code, or a status mention (no amount).
  update public.estimate_items item
  set unit_code = resolved.unit_code,
    pricing_status = coalesce(resolved.pricing_status, item.pricing_status)
  from (
    select line.id, unit.unit_code, unit.pricing_status
    from public.estimate_items line
    cross join lateral private.normalize_unit(line.description) unit
    where line.id = any(coalesce(p_item_ids, '{}'))
      and line.version_id = p_version_id
      and line.item_type = 'line'
      and line.unit_code is null
      and line.pricing_status = 'priced'
  ) resolved
  where item.id = resolved.id
    and (resolved.unit_code is not null or resolved.pricing_status is not null);

  -- Amounts of the v3 engine on every line (a new line moves the allocations) and on the version.
  computed := private.estimate_v3_compute(p_version_id);
  update public.estimate_items item
  set pu_ht_cents = (line.value ->> 'pu_ht_cents')::integer,
    line_total_ht_cents = (line.value ->> 'line_total_ht_cents')::integer,
    line_tax_cents = (line.value ->> 'line_tax_cents')::integer,
    line_total_ttc_cents = (line.value ->> 'line_total_ttc_cents')::integer
  from jsonb_array_elements(computed -> 'lines') as line(value)
  where item.id = (line.value ->> 'id')::uuid
    and item.version_id = p_version_id
    and (item.pu_ht_cents, item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents)
      is distinct from ((line.value ->> 'pu_ht_cents')::integer, (line.value ->> 'line_total_ht_cents')::integer,
        (line.value ->> 'line_tax_cents')::integer, (line.value ->> 'line_total_ttc_cents')::integer);
  update public.estimate_versions version
  set gross_ht_cents = (computed -> 'totals' ->> 'gross_ht_cents')::integer,
    discount_applied_cents = (computed -> 'totals' ->> 'discount_applied_cents')::integer,
    commercial_rounding_cents = (computed -> 'totals' ->> 'commercial_rounding_cents')::integer,
    total_ht_cents = (computed -> 'totals' ->> 'total_ht_cents')::integer,
    total_tax_cents = (computed -> 'totals' ->> 'total_tax_cents')::integer,
    total_ttc_cents = (computed -> 'totals' ->> 'total_ttc_cents')::integer
  where version.id = p_version_id;
  perform private.estimate_v3_assert_draft(p_version_id);
end;
$$;

comment on function public.estimate_v3_complete_entry_for_writer(uuid, uuid[]) is
  'Entry path bridge for the security invoker v3 writers (templates, library assemblies, generated ouvrages): unit codes of the new lines, then the v3 engine amounts stored and asserted. Only inside the writer contract of that version (M6).';
revoke all on function public.estimate_v3_complete_entry_for_writer(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.estimate_v3_complete_entry_for_writer(uuid, uuid[]) to authenticated, service_role;

-- Copied from 20261014114943; only the v3 columns are added to the copies.
CREATE OR REPLACE FUNCTION public.create_estimate_template_from_version(p_source_version_id uuid, p_name text, p_description text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    discount_amount_cents,
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
    source_version.discount_amount_cents,
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
    line_total_ttc_cents,
    unit_code,
    pricing_status,
    h_mo_per_unit,
    h_mo_atelier_per_unit,
    h_mo_chantier_per_unit
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
    src.line_total_ttc_cents,
    -- 2.8 (M6): a template saved from a v3 keeps its units and hours per unit.
    src.unit_code,
    src.pricing_status,
    src.h_mo_per_unit,
    src.h_mo_atelier_per_unit,
    src.h_mo_chantier_per_unit
  from public.estimate_items src
  join _estimate_template_item_map map on map.old_id = src.id
  left join _estimate_template_item_map parent_map on parent_map.old_id = src.parent_id
  where src.version_id = p_source_version_id;

  return new_template_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_estimate_template(p_template_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    discount_amount_cents,
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
    source_template.discount_amount_cents,
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
    line_total_ttc_cents,
    unit_code,
    pricing_status,
    h_mo_per_unit,
    h_mo_atelier_per_unit,
    h_mo_chantier_per_unit
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
    src.line_total_ttc_cents,
    src.unit_code,
    src.pricing_status,
    src.h_mo_per_unit,
    src.h_mo_atelier_per_unit,
    src.h_mo_chantier_per_unit
  from public.estimate_template_items src
  join _estimate_template_duplicate_map map on map.old_id = src.id
  left join _estimate_template_duplicate_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return new_template_id;
end;
$function$;

-- Copied from 20260304180000; only the v3 branch is added.
create or replace function public.insert_estimate_template_into_version(
  p_version_id uuid,
  p_template_id uuid,
  p_after_item_id uuid default null
)
returns setof public.estimate_items
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_template public.estimate_templates%rowtype;
  anchor_item record;
  target_parent_id uuid;
  target_position integer;
  tpl_item record;
  inserted_item public.estimate_items%rowtype;
  -- Mapping from template_item_id -> new estimate_item_id (for parent references)
  id_map jsonb := '{}'::jsonb;
  new_parent_id uuid;
  root_min_position integer := 1;
  section_offset integer := 0;
  -- 2.8 (M6): engine 3 target.
  is_v3 boolean := false;
  previous_v3_writer text := '';
  inserted_ids uuid[] := '{}';
  line_quantity numeric;
  hours_per_unit numeric;
  atelier_per_unit numeric;
  chantier_per_unit numeric;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Load target version
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

  -- 2.8 (M6): a v3 is written under its writer contract; its amounts come from the v3 engine.
  is_v3 := target_version.calc_engine_version = 3;
  if is_v3 then
    previous_v3_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version.id::text, true);
  end if;

  -- Load source template
  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id));

  if not found then
    raise exception 'Estimate template not found or access denied';
  end if;

  if source_template.tenant_id <> target_version.tenant_id then
    raise exception 'Estimate template and version tenant mismatch';
  end if;

  -- Ensure template has items
  if not exists (
    select 1
    from public.estimate_template_items ti
    where ti.template_id = source_template.id
      and ti.tenant_id = source_template.tenant_id
  ) then
    raise exception 'Estimate template has no items';
  end if;

  -- Determine insertion point
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

  -- Count root-level template items to know how many positions to shift
  -- and normalize root insertion positions relative to the first root.
  select coalesce(min(ti.position), 1), count(*)::integer
    into root_min_position, section_offset
  from public.estimate_template_items ti
  where ti.template_id = source_template.id
    and ti.tenant_id = source_template.tenant_id
    and ti.parent_id is null;

  -- Shift existing items to make room
  if target_parent_id is null then
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null
    for update;

    update public.estimate_items
    set position = position + section_offset
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
    set position = position + section_offset
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id = target_parent_id
      and position >= target_position;
  end if;

  -- Insert all template items in parent-first order so nested descendants
  -- keep their full hierarchy in the target version.
  for tpl_item in
    with recursive template_tree as (
      select
        ti.*,
        lpad(greatest(ti.position, 1)::text, 10, '0') || '_' || ti.id::text as sort_path
      from public.estimate_template_items ti
      where ti.template_id = source_template.id
        and ti.tenant_id = source_template.tenant_id
        and ti.parent_id is null

      union all

      select
        child.*,
        template_tree.sort_path || '.' || lpad(greatest(child.position, 1)::text, 10, '0') || '_' || child.id::text as sort_path
      from public.estimate_template_items child
      inner join template_tree on template_tree.id = child.parent_id
      where child.template_id = source_template.id
        and child.tenant_id = source_template.tenant_id
    )
    select *
    from template_tree
    order by sort_path asc
  loop
    if tpl_item.parent_id is null then
      new_parent_id := target_parent_id;
    else
      new_parent_id := nullif(id_map ->> tpl_item.parent_id::text, '')::uuid;
      if new_parent_id is null then
        raise exception 'Estimate template hierarchy is invalid';
      end if;
    end if;

    -- 2.8 (M6, P-12): hours per unit for a v3, from the template or converted h / Q (half up, 4 decimals).
    hours_per_unit := null; atelier_per_unit := null; chantier_per_unit := null;
    if is_v3 and tpl_item.item_type = 'line' then
      line_quantity := coalesce(tpl_item.quantity, 1);
      if tpl_item.h_mo_per_unit is not null then
        hours_per_unit := tpl_item.h_mo_per_unit;
        atelier_per_unit := tpl_item.h_mo_atelier_per_unit;
        chantier_per_unit := tpl_item.h_mo_chantier_per_unit;
      else
        if line_quantity = 0 and (coalesce(tpl_item.h_mo, 0) > 0 or coalesce(tpl_item.h_mo_atelier, 0) > 0
          or coalesce(tpl_item.h_mo_chantier, 0) > 0) then
          raise exception using errcode = '22023', message = 'ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY',
            detail = tpl_item.title;
        end if;
        hours_per_unit := case when line_quantity = 0 then 0 else round(coalesce(tpl_item.h_mo, 0) / line_quantity, 4) end;
        atelier_per_unit := case when tpl_item.h_mo_atelier is null then null when line_quantity = 0 then 0
          else round(tpl_item.h_mo_atelier / line_quantity, 4) end;
        chantier_per_unit := case when tpl_item.h_mo_chantier is null then null when line_quantity = 0 then 0
          else round(tpl_item.h_mo_chantier / line_quantity, 4) end;
      end if;
    end if;

    insert into public.estimate_items (
      tenant_id, version_id, parent_id, item_type, position, title, description,
      quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
      h_mo_atelier, k_mo_atelier, labor_role_atelier_id,
      h_mo_chantier, k_mo_chantier, labor_role_chantier_id,
      pu_ht_cents, labor_role_id, category_id, supply_type_id,
      line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
      unit_code, pricing_status, h_mo_per_unit, h_mo_atelier_per_unit, h_mo_chantier_per_unit
    )
    values (
      target_version.tenant_id,
      target_version.id,
      new_parent_id,
      tpl_item.item_type,
      case
        when tpl_item.parent_id is null
          then target_position + greatest(tpl_item.position, 1) - root_min_position
        else greatest(tpl_item.position, 1)
      end,
      tpl_item.title,
      tpl_item.description,
      -- Sections have null numeric fields
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.quantity, 1) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.unit_price_ht_cents, 0) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.tax_rate_bp, target_version.tax_rate_bp, 2000) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.k_fo, 1) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.h_mo, 0) end,
      case when tpl_item.item_type = 'section' then 1.0 else coalesce(tpl_item.h_mo_majoration, 1.0) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.k_mo, 1) end,
      case when tpl_item.item_type = 'section' then null else tpl_item.h_mo_atelier end,
      case when tpl_item.item_type = 'section' then 1.0 else coalesce(tpl_item.k_mo_atelier, 1.0) end,
      case when tpl_item.item_type = 'section' then null else tpl_item.labor_role_atelier_id end,
      case when tpl_item.item_type = 'section' then null else tpl_item.h_mo_chantier end,
      case when tpl_item.item_type = 'section' then 1.0 else coalesce(tpl_item.k_mo_chantier, 1.0) end,
      case when tpl_item.item_type = 'section' then null else tpl_item.labor_role_chantier_id end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.pu_ht_cents, 0) end,
      case when tpl_item.item_type = 'section' then null else tpl_item.labor_role_id end,
      case when tpl_item.item_type = 'section' then null else tpl_item.category_id end,
      case when tpl_item.item_type = 'section' then null else tpl_item.supply_type_id end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.line_total_ht_cents, 0) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.line_tax_cents, 0) end,
      case when tpl_item.item_type = 'section' then null else coalesce(tpl_item.line_total_ttc_cents, 0) end,
      case when is_v3 and tpl_item.item_type = 'line' then tpl_item.unit_code end,
      case when is_v3 and tpl_item.item_type = 'line' then coalesce(tpl_item.pricing_status, 'priced')
        else 'priced' end::public.estimate_line_pricing_status,
      hours_per_unit,
      atelier_per_unit,
      chantier_per_unit
    )
    returning *
    into inserted_item;

    -- Store mapping: template_item_id -> new_item_id
    id_map := id_map || jsonb_build_object(tpl_item.id::text, inserted_item.id::text);

    if is_v3 then
      inserted_ids := inserted_ids || inserted_item.id;
    else
      return next inserted_item;
    end if;
  end loop;

  -- Update version timestamp
  update public.estimate_versions
  set updated_at = now()
  where id = target_version.id
    and tenant_id = target_version.tenant_id;

  if is_v3 then
    perform public.estimate_v3_complete_entry_for_writer(target_version.id, inserted_ids);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);
    return query
    select item.* from public.estimate_items item
    where item.id = any(inserted_ids)
    order by array_position(inserted_ids, item.id);
  end if;

  return;
end;
$$;

-- Copied from 20261013002038 and 20260722132425; only the v3 branch is added.
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
  -- 2.8 (M6): hours per unit of a component inserted into a v3.
  item_quantity numeric;
  hours_per_unit numeric;
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

      -- 2.8 (M6, D16): into a v3, hours per unit = h_mo / default quantity, exact to 4 decimals.
      hours_per_unit := null;
      if target_version.calc_engine_version = 3 then
        item_quantity := coalesce(assembly_item.default_quantity, 1);
        if item_quantity = 0 and coalesce(assembly_item.h_mo, 0) > 0 then
          raise exception using errcode = '22023', message = 'ESTIMATE_V3_ASSEMBLY_HOURS_WITHOUT_QUANTITY',
            detail = assembly_item.title;
        end if;
        hours_per_unit := case when item_quantity = 0 then 0 else coalesce(assembly_item.h_mo, 0) / item_quantity end;
        if hours_per_unit <> round(hours_per_unit, 4) then
          raise exception using errcode = '22023', message = 'ESTIMATE_V3_ASSEMBLY_HOURS_PER_UNIT_INEXACT',
            detail = assembly_item.title;
        end if;
        hours_per_unit := round(hours_per_unit, 4);
      end if;

      insert into public.estimate_items (
        tenant_id, version_id, parent_id, item_type, position, title,
        description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo,
        supply_type_id, h_mo, h_mo_majoration, k_mo, pu_ht_cents,
        labor_role_id, line_total_ht_cents, line_tax_cents,
        line_total_ttc_cents, source_provider, source_metadata, h_mo_per_unit
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
        0,
        'assembly_library',
        jsonb_build_object(
          'kind', 'assembly_library',
          'library_origin', jsonb_build_object(
            'assembly_id', source_assembly.id,
            'assembly_item_id', assembly_item.id,
            'source_metadata', assembly_item.source_metadata
          )
        ),
        hours_per_unit
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
  -- 2.8 (M6): engine 3 target.
  previous_v3_writer text := '';
  inserted_ids uuid[];
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

  if target_version.calc_engine_version = 3 then
    -- 2.8 (M6): a v3 is written under its writer contract; its amounts come from the v3 engine.
    previous_v3_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version.id::text, true);
    select coalesce(array_agg(materialized.id), '{}') into inserted_ids
    from public.materialize_estimate_assembly_tree(
      target_version.id, source_assembly.id, target_parent_id, target_position, 1, 0
    ) materialized;
    update public.estimate_versions
    set updated_at = now()
    where id = target_version.id
      and tenant_id = target_version.tenant_id;
    perform public.estimate_v3_complete_entry_for_writer(target_version.id, inserted_ids);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);
    return query
    select item.* from public.estimate_items item
    where item.id = any(inserted_ids)
    order by array_position(inserted_ids, item.id);
    return;
  end if;

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

-- Copied from 20261012043643; only the v3 keys are accepted and written.
create or replace function private.generated_ouvrage_insert_line(p_version_id uuid,p_id uuid,data jsonb,projection jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.estimate_versions%rowtype; item public.estimate_items%rowtype; normalized jsonb; next_position integer; has_labor boolean; has_supply boolean;
begin
  select * into v from public.estimate_versions where id=p_version_id;
  if jsonb_typeof(data) is distinct from 'object' or data-array['item_type','parent_id','title','description','quantity','unit_price_ht_cents','k_fo','h_mo','k_mo','labor_role_id','source_provider','source_file_name','source_page','unit_code','pricing_status','h_mo_per_unit']<>'{}'::jsonb
    or data->>'item_type'<>'line' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if not exists(select 1 from public.estimate_items where id=(data->>'parent_id')::uuid and version_id=p_version_id and tenant_id=v.tenant_id and item_type='section') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(max(position),0)+1 into next_position from public.estimate_items where version_id=p_version_id and parent_id=(data->>'parent_id')::uuid;
  normalized:=jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1,'position',next_position)||data||
    jsonb_build_object('id',p_id,'tenant_id',v.tenant_id,'version_id',p_version_id)||(projection-'id');
  select * into item from jsonb_populate_record(null::public.estimate_items,normalized);
  has_supply:=coalesce(item.unit_price_ht_cents,0)>0; has_labor:=coalesce(item.h_mo,0)>0 or item.labor_role_id is not null;
  if not(data?'line_nature') then item.line_nature:=(case when has_labor and not has_supply then 'labor_only' when has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature; end if;
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit)
    values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,null,null,null,null,null,null,item.pu_ht_cents,item.labor_role_id,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_file_name,item.source_page,
      -- 2.8 (M6): a v3 line carries its unit and its yield per unit.
      item.unit_code,coalesce(item.pricing_status,'priced'),item.h_mo_per_unit);
end $$;

-- Copied from 20261012215942; only the v3 branch is added.
create or replace function public.commit_generated_ouvrages(p_version_id uuid,p_draft_id uuid,p_operation_key uuid,p_expected_updated_at timestamptz,
  p_draft_lock_session_id uuid,p_accepted_candidates jsonb,p_prepared_candidates jsonb,p_fallback_section jsonb,p_item_updates jsonb,p_version_patch jsonb,p_calculation_context jsonb,p_expected_preferred_role jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; v public.estimate_versions%rowtype; saved private.generated_ouvrage_application_receipts%rowtype;
  accepted jsonb; canonical_accepted jsonb:='[]'; canonical jsonb; prepared jsonb; review jsonb; reviewed_values jsonb; mapping jsonb; components jsonb; summary jsonb; component jsonb; projection jsonb; item_data jsonb; trace jsonb;
  source_ids jsonb; primary_source jsonb; applied_payload jsonb; library_source jsonb; applications jsonb:='[]'; response jsonb; d jsonb; raw_context jsonb; preferred_role jsonb;
  accepted_ids uuid[]; prepared_ids uuid[]; actual_ids uuid[]; supplied_ids uuid[]; created_item_ids uuid[]:='{}'; role_ids uuid[]; all_created_ids uuid[];
  target_tenant uuid; project_owner uuid; actor uuid; target_candidate_id uuid; assembly_id uuid; target_section uuid; next_position integer; ordinal integer:=0; lot_label text; assembly_name text;
  ds_total bigint; ds_fo bigint; ds_mo bigint; hours_total numeric; event_time timestamptz; breakdown jsonb; valid boolean;
  parent_fo numeric; parent_mo numeric; previous_rollup bigint; current_rollup bigint; raw_component jsonb; trace_ids uuid[]; labor_ids uuid[];
  is_v3 boolean:=false; previous_v3_writer text:='';
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  select * into v from public.estimate_versions where id=p_version_id;
  -- 2.8 (M6): a v3 gets its amounts from the v3 engine (no client projection) under its writer contract.
  is_v3:=v.calc_engine_version=3;
  if p_operation_key is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  canonical:=private.canonical_generated_ouvrage_request(p_version_id,p_draft_id,actor,p_expected_updated_at,p_accepted_candidates);
  canonical_accepted:=canonical->'acceptedCandidates';
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into accepted_ids from jsonb_array_elements(canonical_accepted)x;
  if cardinality(accepted_ids)<>(select count(distinct x) from unnest(accepted_ids)x) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select * into saved from private.generated_ouvrage_application_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id<>actor or saved.tenant_id<>target_tenant or saved.project_id<>v.project_id or saved.canonical_request is distinct from canonical then perform private.generated_ouvrage_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||case when saved.response->>'outcome'='abandoned' then '{}'::jsonb else jsonb_build_object('replayed',true) end||jsonb_build_object('currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
  end if;
  perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  if v.updated_at is distinct from p_expected_updated_at then perform private.generated_ouvrage_error('STALE'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_candidates where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_drafts where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_items where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_item_sources where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_candidate_sources where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_source_fragments where draft_id=p_draft_id order by id for share nowait;
  if jsonb_typeof(p_prepared_candidates) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or octet_length(jsonb_build_array(p_prepared_candidates,p_item_updates,p_version_patch,p_calculation_context)::text)>2097152 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into prepared_ids from jsonb_array_elements(p_prepared_candidates)x;
  if prepared_ids is distinct from accepted_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg(u.id),'{}') into all_created_ids from jsonb_array_elements(p_prepared_candidates)x cross join lateral unnest(array[(x->>'estimateItemId')::uuid,(x->>'assemblyId')::uuid,(x->>'applicationId')::uuid,(x->>'snapshotId')::uuid])u(id);
  if cardinality(all_created_ids)<>(select count(distinct x) from unnest(all_created_ids)x) or array_position(all_created_ids,null) is not null
    or exists(select 1 from public.estimate_items where id=any(all_created_ids)) or exists(select 1 from public.estimate_assemblies where id=any(all_created_ids))
    or exists(select 1 from public.estimate_generated_ouvrage_applications where id=any(all_created_ids)) or exists(select 1 from public.estimate_generated_ouvrage_work_snapshots where id=any(all_created_ids)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if is_v3 and (p_version_patch<>'{}'::jsonb or p_item_updates<>'[]'::jsonb) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if not is_v3 and (p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents']<>'{}'::jsonb or not(p_version_patch?&array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or exists(select 1 from jsonb_each(p_version_patch)n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates)x where jsonb_typeof(x)<>'object' or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']))
    or exists(select 1 from jsonb_array_elements(p_item_updates)x cross join lateral jsonb_each(x-'id')n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates)x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids)x) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select jsonb_build_object('id',id,'name',name,'hourly_rate_cents',hourly_rate_cents,'is_active',is_active,'position',position) into preferred_role
    from public.labor_roles where tenant_id=target_tenant and user_id=project_owner and is_active order by position,id limit 1;
  if coalesce(preferred_role,'null'::jsonb) is distinct from coalesce(p_expected_preferred_role,'null'::jsonb) then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  if is_v3 then
    previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true);
  end if;
  if exists(select 1 from jsonb_array_elements(canonical_accepted)x where x->'lotId'='null'::jsonb) then
    if jsonb_typeof(p_fallback_section) is distinct from 'object' or p_fallback_section-array['id','created']<>'{}'::jsonb or not(p_fallback_section?&array['id','created']) or jsonb_typeof(p_fallback_section->'created')<>'boolean' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    target_section:=(p_fallback_section->>'id')::uuid;
    if (p_fallback_section->>'created')::boolean then
      if target_section=any(all_created_ids) or exists(select 1 from public.estimate_items where id=target_section) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      select coalesce(max(position),0)+1 into next_position from public.estimate_items where version_id=p_version_id and parent_id is null;
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,source_provider) values(target_section,p_version_id,null,'section',next_position,'À classer','generated_ouvrage');
    elsif not exists(select 1 from public.estimate_items where id=target_section and version_id=p_version_id and tenant_id=target_tenant and item_type='section' and parent_id is null
      and regexp_replace(lower(regexp_replace(normalize(btrim(title),NFD),U&'[\0300-\036f]','','g')),'\s+',' ','g')='a classer') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  elsif p_fallback_section is not null and p_fallback_section<>'null'::jsonb then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  for accepted in select * from jsonb_array_elements(canonical_accepted) loop
    target_candidate_id:=(accepted->>'candidateId')::uuid;
    select x into prepared from jsonb_array_elements(p_prepared_candidates)x where (x->>'candidateId')::uuid=target_candidate_id;
    if prepared-array['candidateId','subdetailId','estimateItemId','assemblyId','applicationId','snapshotId','resolvedLotId','placementMode','estimateItemMapping','componentProjections','item']<>'{}'::jsonb
      or not(prepared?&array['candidateId','subdetailId','estimateItemId','assemblyId','applicationId','snapshotId','resolvedLotId','placementMode','estimateItemMapping','componentProjections','item']) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    review:=private.generated_ouvrage_review(p_draft_id,target_candidate_id);
    if review->'candidate'='null'::jsonb then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
    if review->'candidate'->>'resolution_status'<>'pending' or review->'subdetailDraft'->>'status' is distinct from 'reviewed'
      or exists(select 1 from public.estimate_generated_ouvrage_applications app where app.candidate_id=target_candidate_id) then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    if review->>'reviewToken' is distinct from accepted->>'reviewToken' then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    -- Historical inconsistent links must not be copied into immutable provenance.
    if exists(select 1 from jsonb_array_elements(review->'candidateSources')l where not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=l->>'source_fragment_id'))
      or exists(select 1 from jsonb_array_elements(review->'itemSources')l where not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=l->>'source_fragment_id'))
      or exists(select 1 from jsonb_array_elements(review->'items')i where i->>'source_fragment_id' is not null and not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=i->>'source_fragment_id')) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (review->'subdetailDraft'->>'id')::uuid is distinct from (prepared->>'subdetailId')::uuid then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    reviewed_values:=coalesce(review->'subdetailDraft'->'generation_metadata'->'reviewed_candidate',jsonb_build_object('designation',review->'candidate'->'designation','unit',review->'candidate'->'unit','quantity',review->'candidate'->'quantity'));
    if regexp_replace(btrim(reviewed_values->>'designation'),'\s+',' ','g') is distinct from accepted->>'designation'
      or nullif(btrim(reviewed_values->>'unit'),'') is distinct from accepted->>'unit' or (reviewed_values->>'quantity')::numeric is distinct from (accepted->>'quantity')::numeric then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    target_section:=coalesce((accepted->>'lotId')::uuid,(p_fallback_section->>'id')::uuid);
    if target_section is distinct from (prepared->>'resolvedLotId')::uuid or prepared->>'placementMode' is distinct from (case when accepted->>'lotId' is null then 'fallback_unclassified' else 'explicit' end) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select title into lot_label from public.estimate_items where id=target_section and version_id=p_version_id and tenant_id=target_tenant and item_type='section';
    if not found then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    components:=private.generated_ouvrage_components(review,prepared->'componentProjections',(accepted->>'quantity')::numeric);
    if exists(select 1 from jsonb_array_elements(components)x where x->>'costType'='labor') and preferred_role is null then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
    select coalesce(sum((x->>'dsCents')::bigint),0),coalesce(sum((x->>'dsCents')::bigint)filter(where x->>'costType'<>'labor'),0),coalesce(sum((x->>'dsCents')::bigint)filter(where x->>'costType'='labor'),0) into ds_total,ds_fo,ds_mo from jsonb_array_elements(components)x;
    select coalesce(sum((x->>'hMo')::numeric),0) into hours_total from jsonb_array_elements(prepared->'componentProjections')x;
    mapping:=prepared->'estimateItemMapping';
    if jsonb_typeof(mapping) is distinct from 'object' or mapping-array['source','mode','unitPriceHtCents','hMo','kFo','kMo','laborRoleId','laborRoleName','laborRoleHourlyRateCents','totalDsCents','nonLaborDsCents','laborDsCents','costBreakdown','laborTrace']<>'{}'::jsonb
      or mapping->>'source' is distinct from 'generated_ouvrage_subdetail_review' or mapping->>'mode' not in('no_labor','legacy_labor_allocated','labor_hours_only','labor_hours_role_without_rate')
      or ds_total is distinct from (review->'subdetailDraft'->'summary'->>'ds_cents')::bigint or ds_total is distinct from (mapping->>'totalDsCents')::bigint
      or ds_fo is distinct from (mapping->>'nonLaborDsCents')::bigint or ds_mo is distinct from (mapping->>'laborDsCents')::bigint or hours_total is distinct from (mapping->>'hMo')::numeric then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if mapping->>'laborRoleId' is not null and ((mapping->>'laborRoleId')::uuid is distinct from (preferred_role->>'id')::uuid or mapping->>'laborRoleName' is distinct from preferred_role->>'name' or mapping->'laborRoleHourlyRateCents' is distinct from preferred_role->'hourly_rate_cents') then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
    if mapping->>'laborRoleId' is null and (mapping->>'laborRoleName' is not null or mapping->>'laborRoleHourlyRateCents' is not null) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (accepted->>'quantity')::numeric<>round((accepted->>'quantity')::numeric,3) or (accepted->>'quantity')::numeric>999999999.999
      or exists(select 1 from unnest(array['hMo','kFo','kMo'])key where jsonb_typeof(mapping->key)<>'number' or (mapping->>key)::numeric<0 or (mapping->>key)::numeric>999999999.999 or (mapping->>key)::numeric<>round((mapping->>key)::numeric,3))
      or jsonb_typeof(mapping->'unitPriceHtCents')<>'number' or (mapping->>'unitPriceHtCents')::numeric<0 or (mapping->>'unitPriceHtCents')::numeric>2147483647 or (mapping->>'unitPriceHtCents')::numeric<>trunc((mapping->>'unitPriceHtCents')::numeric) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    parent_fo:=(accepted->>'quantity')::numeric*(mapping->>'unitPriceHtCents')::numeric*(mapping->>'kFo')::numeric;
    parent_mo:=(mapping->>'hMo')::numeric*coalesce((mapping->>'laborRoleHourlyRateCents')::numeric,0)*(mapping->>'kMo')::numeric;
    if round(parent_fo) is distinct from ds_fo or round(parent_mo) is distinct from ds_mo or round(parent_fo+parent_mo) is distinct from ds_total then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(jsonb_agg(jsonb_build_object('costType',kind,'componentCount',n,'quantity',quantity,'dsCents',ds) order by first_ordinal),'[]') into breakdown from (
      select x.value->>'costType' kind,count(*) n,sum((x.value->>'quantity')::numeric) quantity,sum((x.value->>'dsCents')::bigint)ds,min(x.ordinality)first_ordinal from jsonb_array_elements(components)with ordinality x group by x.value->>'costType') q;
    if mapping->'costBreakdown' is distinct from breakdown or jsonb_typeof(mapping->'laborTrace') is distinct from 'array' or jsonb_array_length(mapping->'laborTrace')<>(select count(*) from jsonb_array_elements(components)x where x->>'costType'='labor') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into trace_ids from jsonb_array_elements(mapping->'laborTrace')x;
    select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into labor_ids from jsonb_array_elements(components)x where x->>'costType'='labor';
    if trace_ids is distinct from labor_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    for trace in select * from jsonb_array_elements(mapping->'laborTrace') loop
      select x into component from jsonb_array_elements(components)x where (x->>'componentId')::uuid=(trace->>'componentId')::uuid and x->>'costType'='labor';
      select x into projection from jsonb_array_elements(prepared->'componentProjections')x where (x->>'componentId')::uuid=(trace->>'componentId')::uuid;
      select x into raw_component from jsonb_array_elements(review->'items')x where (x->>'id')::uuid=(trace->>'componentId')::uuid;
      if component is null or trace-array['componentId','designation','unit','quantity','derivedHours','hoursSource','dsCents']<>'{}'::jsonb
        or trace->'designation' is distinct from component->'designation' or trace->'unit' is distinct from component->'unit' or trace->'quantity' is distinct from component->'quantity' or trace->'dsCents' is distinct from component->'dsCents'
        or trace->'derivedHours' is distinct from projection->'hMo' or trace->>'hoursSource' is distinct from private.generated_ouvrage_hours(raw_component,(accepted->>'quantity')::numeric)->>'source' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    end loop;
    summary:=jsonb_build_object('componentCount',jsonb_array_length(components),'dsCents',ds_total,
      'indicativeTargetPriceCents',review->'subdetailDraft'->'summary'->'indicative_target_price_cents','confidence',review->'subdetailDraft'->'summary'->'confidence',
      'pricingSource',review->'subdetailDraft'->'summary'->'pricing_source','riskSignals',coalesce(review->'subdetailDraft'->'summary'->'risk_signals','[]'),
      'facts',coalesce(review->'subdetailDraft'->'summary'->'facts','[]'),'hypotheses',coalesce(review->'subdetailDraft'->'summary'->'hypotheses','[]'),'inferences',coalesce(review->'subdetailDraft'->'summary'->'inferences','[]'));
    select coalesce(jsonb_agg(x->'source_fragment_id' order by (x->>'source_rank')::integer,x->>'id'),'[]') into source_ids from jsonb_array_elements(review->'candidateSources')x;
    select f into primary_source from jsonb_array_elements(review->'candidateSources')l join jsonb_array_elements(review->'fragments')f on f->>'id'=l->>'source_fragment_id' order by (l->>'source_rank')::integer,l->>'id' limit 1;
    item_data:=prepared->'item';
    if (item_data->>'parent_id')::uuid is distinct from target_section or item_data->>'title' is distinct from accepted->>'designation' or item_data->'description' is distinct from accepted->'unit'
      or item_data->'quantity' is distinct from accepted->'quantity' or item_data->'unit_price_ht_cents' is distinct from mapping->'unitPriceHtCents'
      or item_data->'h_mo' is distinct from mapping->'hMo' or item_data->'k_fo' is distinct from mapping->'kFo' or item_data->'k_mo' is distinct from mapping->'kMo'
      or item_data->'labor_role_id' is distinct from mapping->'laborRoleId' or item_data->>'source_provider' is distinct from 'generated_ouvrage'
      or item_data->>'source_file_name' is distinct from primary_source->>'source_file_name' or item_data->>'source_page' is distinct from primary_source->>'source_page_from' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    assembly_id:=(prepared->>'assemblyId')::uuid; assembly_name:=(accepted->>'designation')||' · '||left(target_candidate_id::text,8);
    library_source:=jsonb_build_object('kind','generated_ouvrage','draft_id',p_draft_id,'candidate_id',target_candidate_id,'source_fragment_ids',source_ids,'summary',summary,'estimate_item_mapping',mapping);
    insert into public.estimate_assemblies(id,tenant_id,created_by,name,description,reference_code,unit,pricing_source,ds_cents,indicative_target_price_cents,source_metadata)
      values(assembly_id,target_tenant,actor,assembly_name,'Ouvrage compose genere depuis '||(accepted->>'designation'),'EST383-'||upper(left(target_candidate_id::text,8)),accepted->>'unit','generated_ouvrage_review',ds_total,(summary->>'indicativeTargetPriceCents')::integer,library_source);
    ordinal:=0; previous_rollup:=0;
    for component in select * from jsonb_array_elements(components) loop
      ordinal:=ordinal+1; select x into projection from jsonb_array_elements(prepared->'componentProjections')x where x->>'componentId'=component->>'componentId';
      if component->>'costType'='labor' and ((projection->>'kFo')::numeric<>0 or round((projection->>'hMo')::numeric*(preferred_role->>'hourly_rate_cents')::numeric*(projection->>'kMo')::numeric) is distinct from (projection->>'dsCents')::numeric)
        or component->>'costType'<>'labor' and (projection->>'kMo')::numeric<>0 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      insert into public.estimate_assembly_items(tenant_id,assembly_id,title,unit,k_fo,k_mo,h_mo,labor_role_id,default_quantity,position,cost_type,unit_cost_ht_cents,loss_coeff_bp,yield_value,yield_unit,source_metadata)
        values(target_tenant,assembly_id,component->>'designation',component->>'unit',(projection->>'kFo')::numeric,(projection->>'kMo')::numeric,(projection->>'hMo')::numeric,case when component->>'costType'='labor' then (preferred_role->>'id')::uuid else null end,(component->>'quantity')::numeric,ordinal,component->>'costType',(component->>'unitCostHtCents')::integer,(component->>'lossCoeffBp')::integer,(component->>'yieldValue')::numeric,component->>'yieldUnit',
          jsonb_build_object('kind','generated_ouvrage','component_id',component->'componentId','source_label',component->'sourceLabel','confidence',component->'confidence','facts',component->'facts','hypotheses',component->'hypotheses','inferences',component->'inferences','risk_signals',component->'riskSignals','sources',component->'sources'));
      select ds_cents into current_rollup from public.estimate_assemblies where id=assembly_id;
      if current_rollup-previous_rollup is distinct from (projection->>'dsCents')::bigint then perform private.generated_ouvrage_error('APPLY_REJECTED'); end if;
      previous_rollup:=current_rollup;
    end loop;
    -- Reuse the existing canonical rollup, never silently overwrite its result.
    perform public.refresh_estimate_assembly_rollup(assembly_id);
    if not exists(select 1 from public.estimate_assemblies where id=assembly_id and ds_cents=ds_total and coalesce(avg_time_hours,0)=hours_total) then perform private.generated_ouvrage_error('APPLY_REJECTED'); end if;
    if is_v3 then
      -- 2.8 (M6, D16): the line carries the yield per unit, h / Q half up to 4 decimals, never a total of
      -- hours (h_mo is derived); Q = 0 with hours is refused by name. Amounts come from the bridge below.
      if (accepted->>'quantity')::numeric=0 and (mapping->>'hMo')::numeric>0 then
        raise exception using errcode='22023',message='ESTIMATE_V3_GENERATED_HOURS_WITHOUT_QUANTITY',detail=accepted->>'designation';
      end if;
      item_data:=(item_data-'h_mo')||jsonb_build_object('h_mo_per_unit',case when (accepted->>'quantity')::numeric=0 then 0
        else round((mapping->>'hMo')::numeric/(accepted->>'quantity')::numeric,4) end);
      projection:=jsonb_build_object('pu_ht_cents',0,'line_total_ht_cents',0,'line_tax_cents',0,'line_total_ttc_cents',0);
    else
      select x into projection from jsonb_array_elements(p_item_updates)x where (x->>'id')::uuid=(prepared->>'estimateItemId')::uuid;
    end if;
    if projection is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    perform private.generated_ouvrage_insert_line(p_version_id,(prepared->>'estimateItemId')::uuid,item_data,projection);
    created_item_ids:=array_append(created_item_ids,(prepared->>'estimateItemId')::uuid);
    applied_payload:=jsonb_build_object('designation',accepted->'designation','unit',accepted->'unit','quantity',accepted->'quantity','lot_id',target_section,
      'suggested_lot_id',review->'candidate'->'suggested_lot_id','ai_status',review->'candidate'->'ai_status','confidence',review->'candidate'->'confidence','source_fragment_ids',source_ids,
      'requested_lot_id',accepted->'lotId','resolved_lot_id',target_section,'resolved_lot_label',lot_label,'placement_mode',prepared->>'placementMode',
      'fallback_section_created',accepted->>'lotId' is null and coalesce((p_fallback_section->>'created')::boolean,false),'estimate_item_mapping',mapping);
    insert into public.estimate_generated_ouvrage_applications(id,tenant_id,draft_id,candidate_id,target_version_id,estimate_item_id,applied_by,applied_payload)
      values((prepared->>'applicationId')::uuid,target_tenant,p_draft_id,target_candidate_id,p_version_id,(prepared->>'estimateItemId')::uuid,actor,applied_payload);
    insert into public.estimate_generated_ouvrage_work_snapshots(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,assembly_id,estimate_item_id,applied_by,summary,components,metadata)
      values((prepared->>'snapshotId')::uuid,target_tenant,v.project_id,p_version_id,p_draft_id,target_candidate_id,assembly_id,(prepared->>'estimateItemId')::uuid,actor,
        summary||jsonb_build_object('assembly_name',assembly_name,'assembly_reference_code','EST383-'||upper(left(target_candidate_id::text,8))),components,
        jsonb_build_object('applied_values',applied_payload,'estimate_item_mapping',mapping,'ai_status',review->'candidate'->'ai_status','confidence',review->'candidate'->'confidence'));
    update public.estimate_generated_ouvrage_candidates set resolution_status='inserted',metadata=metadata||jsonb_build_object('applied_values',applied_payload) where id=target_candidate_id;
    applications:=applications||jsonb_build_array(jsonb_build_object('candidateId',target_candidate_id,'subdetailId',prepared->'subdetailId','assemblyId',assembly_id,'estimateItemId',prepared->'estimateItemId','applicationId',prepared->'applicationId','snapshotId',prepared->'snapshotId'));
  end loop;
  select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (v.calc_engine_version=2 or id=any(created_item_ids));
  if not is_v3 and actual_ids is distinct from supplied_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id])r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
  if v.calc_engine_version=2 and exists(select 1 from unnest(role_ids)r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
    'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  select * into v from public.estimate_versions where id=p_version_id;
  if is_v3 then
    update public.estimate_versions set updated_at=now() where id=p_version_id;
    perform public.estimate_v3_complete_entry_for_writer(p_version_id,created_item_ids);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
  else
    perform public.bulk_update_estimate_items(p_version_id,p_item_updates,p_version_patch,v.updated_at);
  end if;
  d:=private.generated_ouvrage_project_draft(p_draft_id);
  update public.estimate_generated_ouvrage_subdetail_drafts set status='applied',applied_at=clock_timestamp() where draft_id=p_draft_id and parent_work_id=any(accepted_ids);
  insert into public.estimate_version_events(estimate_version_id,event_type,created_by,metadata)
    values(p_version_id,'generated_ouvrage_inserted',actor,jsonb_build_object('draft_id',p_draft_id,'candidate_ids',to_jsonb(accepted_ids),'inserted_count',cardinality(accepted_ids)));
  select * into v from public.estimate_versions where id=p_version_id;
  event_time:=clock_timestamp();
  response:=jsonb_build_object('ok',true,'insertedCount',cardinality(accepted_ids),'draftStatus',d->>'status','projectId',v.project_id,'versionId',p_version_id,'applications',applications,
    'version',jsonb_build_object('id',v.id,'updatedAt',v.updated_at),'totals',jsonb_build_object('totalHtCents',v.total_ht_cents,'totalTaxCents',v.total_tax_cents,'totalTtcCents',v.total_ttc_cents),
    'receipt',jsonb_build_object('operationKey',p_operation_key,'actorId',actor,'versionId',p_version_id,'draftId',p_draft_id,'expectedUpdatedAt',p_expected_updated_at,'acceptedCandidates',canonical_accepted,'committedAt',event_time));
  if octet_length(response::text)>2097152 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  insert into private.generated_ouvrage_application_receipts(version_id,operation_key,tenant_id,project_id,draft_id,actor_id,canonical_request,response,committed_at)
    values(p_version_id,p_operation_key,target_tenant,v.project_id,p_draft_id,actor,canonical,response,event_time);
  return response||jsonb_build_object('replayed',false,'currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.generated_ouvrage_error('INVALID_INPUT'); return null;
  when integrity_constraint_violation then perform private.generated_ouvrage_error('APPLY_REJECTED'); return null;
end $$;

commit;
