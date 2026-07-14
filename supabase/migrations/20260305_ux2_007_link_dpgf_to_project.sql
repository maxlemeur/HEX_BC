-- UX2-007: lier les imports DPGF a un projet estimate (optionnel).

alter table public.dpgf_imports
  add column if not exists project_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dpgf_imports_project_id_fkey'
      and conrelid = 'public.dpgf_imports'::regclass
  ) then
    alter table public.dpgf_imports
      add constraint dpgf_imports_project_id_fkey
      foreign key (project_id)
      references public.estimate_projects(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists dpgf_imports_tenant_project_created_at_idx
  on public.dpgf_imports (tenant_id, project_id, created_at desc)
  where project_id is not null;

create index if not exists dpgf_imports_project_id_idx
  on public.dpgf_imports (project_id)
  where project_id is not null;

drop policy if exists "Users can manage own dpgf imports" on public.dpgf_imports;

create policy "Users can manage own dpgf imports"
  on public.dpgf_imports
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
    and (
      project_id is null
      or exists (
        select 1
        from public.estimate_projects p
        where p.id = dpgf_imports.project_id
          and p.tenant_id = dpgf_imports.tenant_id
          and (
            p.user_id = (select auth.uid())
            or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
          )
      )
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
    and (
      project_id is null
      or exists (
        select 1
        from public.estimate_projects p
        where p.id = dpgf_imports.project_id
          and p.tenant_id = dpgf_imports.tenant_id
          and (
            p.user_id = (select auth.uid())
            or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
          )
      )
    )
  );

-- Consolidated from 20260305_ux2_009_create_estimate_version_from_import_lines.sql to keep migration versions unique.
-- UX2-009: create Vn+1 from mapped DPGF rows in one short transaction.

create or replace function public.create_estimate_version_from_import_lines(
  p_project_id uuid,
  p_import_id uuid,
  p_version_title text,
  p_section_title text,
  p_lines jsonb
)
returns table (
  version_id uuid,
  section_id uuid,
  inserted_count integer,
  total_ht_cents integer,
  total_tax_cents integer,
  total_ttc_cents integer
)
language plpgsql
set search_path = public
as $$
declare
  v_project public.estimate_projects%rowtype;
  v_import public.dpgf_imports%rowtype;
  v_latest_version public.estimate_versions%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_section_id uuid := gen_random_uuid();
  v_next_version_number integer;
  v_inserted_count integer := 0;
  v_total_ht_cents integer := 0;
  v_total_tax_cents integer := 0;
  v_total_ttc_cents integer := 0;
  v_resolved_version_title text;
  v_resolved_section_title text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines cannot be empty';
  end if;

  select p.*
    into v_project
  from public.estimate_projects p
  where p.id = p_project_id
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate project not found or access denied';
  end if;

  select di.*
    into v_import
  from public.dpgf_imports di
  where di.id = p_import_id
    and di.tenant_id = v_project.tenant_id
    and di.project_id = p_project_id
    and (
      di.user_id = (select auth.uid())
      or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'DPGF import not found, not linked, or access denied';
  end if;

  select coalesce(max(v.version_number), 0) + 1
    into v_next_version_number
  from public.estimate_versions v
  where v.project_id = v_project.id
    and v.tenant_id = v_project.tenant_id;

  select v.*
    into v_latest_version
  from public.estimate_versions v
  where v.project_id = v_project.id
    and v.tenant_id = v_project.tenant_id
  order by v.version_number desc
  limit 1;

  v_resolved_version_title := nullif(trim(coalesce(p_version_title, '')), '');
  if v_resolved_version_title is null then
    v_resolved_version_title := 'Import DPGF';
  end if;

  v_resolved_section_title := nullif(trim(coalesce(p_section_title, '')), '');
  if v_resolved_section_title is null then
    v_resolved_section_title := format(
      'Import DPGF %s',
      to_char(now(), 'DD/MM/YYYY HH24:MI')
    );
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
    seal_hash,
    parent_version_id,
    variant_label
  )
  values (
    v_version_id,
    v_project.tenant_id,
    v_project.id,
    v_next_version_number,
    'draft',
    v_resolved_version_title,
    coalesce(v_latest_version.date_devis, current_date),
    coalesce(v_latest_version.validite_jours, 30),
    coalesce(v_latest_version.margin_multiplier, 1),
    coalesce(v_latest_version.margin_mode, 'fixed'::public.estimate_margin_mode),
    coalesce(v_latest_version.currency, 'EUR'),
    coalesce(v_latest_version.margin_bp, 0),
    coalesce(v_latest_version.discount_bp, 0),
    coalesce(v_latest_version.discount_mode, 'simple'::public.estimate_discount_mode),
    coalesce(v_latest_version.discount_steps, '{}'::integer[]),
    coalesce(v_latest_version.global_coefficient, 1),
    coalesce(v_latest_version.tax_rate_bp, 2000),
    coalesce(v_latest_version.rounding_mode, 'none'::public.estimate_rounding_mode),
    coalesce(v_latest_version.rounding_step_cents, 1),
    0,
    0,
    0,
    null,
    null,
    null
  );

  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    aid,
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
    v_section_id,
    v_project.tenant_id,
    v_version_id,
    null,
    'section',
    1,
    v_resolved_section_title,
    null,
    null,
    null,
    null,
    null,
    null,
    1.0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );

  insert into public.estimate_items (
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    aid,
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
    v_project.tenant_id,
    v_version_id,
    v_section_id,
    'line',
    row_number() over (order by line_ordinality),
    coalesce(
      nullif(trim(line_payload ->> 'title'), ''),
      format('Ligne %s', line_ordinality::text)
    ),
    null,
    nullif(trim(line_payload ->> 'description'), ''),
    coalesce((line_payload ->> 'quantity')::numeric, 0),
    coalesce((line_payload ->> 'unit_price_ht_cents')::integer, 0),
    coalesce((line_payload ->> 'tax_rate_bp')::integer, 2000),
    coalesce((line_payload ->> 'k_fo')::numeric, 1),
    coalesce((line_payload ->> 'h_mo')::numeric, 0),
    coalesce((line_payload ->> 'h_mo_majoration')::numeric, 1),
    coalesce((line_payload ->> 'k_mo')::numeric, 1),
    null,
    null,
    null,
    null,
    null,
    null,
    coalesce((line_payload ->> 'pu_ht_cents')::integer, 0),
    null,
    null,
    null,
    null,
    coalesce((line_payload ->> 'line_total_ht_cents')::integer, 0),
    coalesce((line_payload ->> 'line_tax_cents')::integer, 0),
    coalesce((line_payload ->> 'line_total_ttc_cents')::integer, 0)
  from jsonb_array_elements(p_lines) with ordinality as input_rows(line_payload, line_ordinality);

  get diagnostics v_inserted_count = row_count;

  select
    coalesce(sum(i.line_total_ht_cents), 0),
    coalesce(sum(i.line_tax_cents), 0),
    coalesce(sum(i.line_total_ttc_cents), 0)
    into v_total_ht_cents, v_total_tax_cents, v_total_ttc_cents
  from public.estimate_items i
  where i.tenant_id = v_project.tenant_id
    and i.version_id = v_version_id
    and i.item_type = 'line';

  update public.estimate_versions
  set
    total_ht_cents = v_total_ht_cents,
    total_tax_cents = v_total_tax_cents,
    total_ttc_cents = v_total_ttc_cents
  where id = v_version_id
    and tenant_id = v_project.tenant_id;

  return query
  select
    v_version_id,
    v_section_id,
    v_inserted_count,
    v_total_ht_cents,
    v_total_tax_cents,
    v_total_ttc_cents;
end;
$$;

revoke all on function public.create_estimate_version_from_import_lines(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public;

revoke all on function public.create_estimate_version_from_import_lines(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from authenticated;

grant execute on function public.create_estimate_version_from_import_lines(
  uuid,
  uuid,
  text,
  text,
  jsonb
) to authenticated;

-- Consolidated from 20260305_ux2_010_mapping_memory_upsert.sql to keep migration versions unique.
-- UX2-010: atomic UPSERT for mapping memory + tenant-aware unique key.

-- Replace legacy unique key (user_id, source_column, target_field)
-- with tenant-aware key to support strict multi-tenant isolation.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'mapping_memory_user_id_source_column_target_field_key'
      and conrelid = 'public.mapping_memory'::regclass
  ) then
    alter table public.mapping_memory
      drop constraint mapping_memory_user_id_source_column_target_field_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mapping_memory_tenant_user_source_target_key'
      and conrelid = 'public.mapping_memory'::regclass
  ) then
    alter table public.mapping_memory
      add constraint mapping_memory_tenant_user_source_target_key
      unique (tenant_id, user_id, source_column, target_field);
  end if;
end;
$$;

create index if not exists mapping_memory_tenant_user_source_idx
  on public.mapping_memory (tenant_id, user_id, source_column);

create or replace function public.upsert_mapping_memory_bulk(p_entries jsonb)
returns table (
  tenant_id uuid,
  user_id uuid,
  source_column text,
  target_field text,
  usage_count integer,
  confidence numeric
)
language plpgsql
set search_path = public
as $$
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a JSON array';
  end if;

  return query
  with normalized_entries as (
    select distinct
      (entry ->> 'tenant_id')::uuid as tenant_id,
      (entry ->> 'user_id')::uuid as user_id,
      nullif(trim(entry ->> 'source_column'), '') as source_column,
      nullif(trim(entry ->> 'target_field'), '') as target_field
    from jsonb_array_elements(p_entries) as payload(entry)
    where jsonb_typeof(entry) = 'object'
  ),
  filtered_entries as (
    select
      tenant_id,
      user_id,
      source_column,
      target_field
    from normalized_entries
    where tenant_id is not null
      and user_id is not null
      and source_column is not null
      and target_field is not null
  ),
  upserted as (
    insert into public.mapping_memory (
      tenant_id,
      user_id,
      source_column,
      target_field,
      usage_count,
      confidence,
      last_used_at
    )
    select
      tenant_id,
      user_id,
      source_column,
      target_field,
      1,
      0.6000::numeric(5,4),
      now()
    from filtered_entries
    on conflict (tenant_id, user_id, source_column, target_field)
    do update
      set usage_count = mapping_memory.usage_count + 1,
          confidence = least(
            0.9800::numeric(5,4),
            round(
              (
                mapping_memory.confidence
                + ((1.0000::numeric - mapping_memory.confidence) * 0.1500::numeric)
              )::numeric,
              4
            )
          ),
          last_used_at = now()
    returning
      mapping_memory.tenant_id,
      mapping_memory.user_id,
      mapping_memory.source_column,
      mapping_memory.target_field,
      mapping_memory.usage_count,
      mapping_memory.confidence
  )
  select
    upserted.tenant_id,
    upserted.user_id,
    upserted.source_column,
    upserted.target_field,
    upserted.usage_count,
    upserted.confidence
  from upserted;
end;
$$;
