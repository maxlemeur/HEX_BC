-- UX2-011: create project + first estimate version directly from mapped import lines.

create or replace function public.create_affaire_from_import_lines(
  p_import_id uuid,
  p_project_name text,
  p_project_client text default null,
  p_project_reference text default null,
  p_version_title text default null,
  p_section_title text default null,
  p_lines jsonb default '[]'::jsonb
)
returns table (
  project_id uuid,
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
  v_import public.dpgf_imports%rowtype;
  v_project_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_section_id uuid := gen_random_uuid();
  v_inserted_count integer := 0;
  v_total_ht_cents integer := 0;
  v_total_tax_cents integer := 0;
  v_total_ttc_cents integer := 0;
  v_current_user_id uuid := (select auth.uid());
  v_resolved_project_name text;
  v_resolved_version_title text;
  v_resolved_section_title text;
begin
  if v_current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_import_id is null then
    raise exception 'p_import_id is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'p_lines cannot be empty';
  end if;

  v_resolved_project_name := nullif(trim(coalesce(p_project_name, '')), '');
  if v_resolved_project_name is null then
    raise exception 'p_project_name is required';
  end if;

  select di.*
    into v_import
  from public.dpgf_imports di
  where di.id = p_import_id
    and (select public.is_tenant_member(di.tenant_id))
    and (
      di.user_id = v_current_user_id
      or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'DPGF import not found or access denied';
  end if;

  if v_import.project_id is not null then
    raise exception 'DPGF import already linked to a project';
  end if;

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

  insert into public.estimate_projects (
    id,
    tenant_id,
    user_id,
    name,
    reference,
    client_name,
    notes,
    is_archived
  )
  values (
    v_project_id,
    v_import.tenant_id,
    v_current_user_id,
    v_resolved_project_name,
    nullif(trim(coalesce(p_project_reference, '')), ''),
    nullif(trim(coalesce(p_project_client, '')), ''),
    null,
    false
  );

  update public.dpgf_imports di
  set project_id = v_project_id
  where di.id = v_import.id
    and di.tenant_id = v_import.tenant_id;

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
    v_import.tenant_id,
    v_project_id,
    1,
    'draft',
    v_resolved_version_title,
    current_date,
    30,
    1,
    'fixed'::public.estimate_margin_mode,
    'EUR',
    0,
    0,
    'simple'::public.estimate_discount_mode,
    '{}'::integer[],
    1,
    2000,
    'none'::public.estimate_rounding_mode,
    1,
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
    v_import.tenant_id,
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
    v_import.tenant_id,
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
  where i.tenant_id = v_import.tenant_id
    and i.version_id = v_version_id
    and i.item_type = 'line';

  update public.estimate_versions
  set
    total_ht_cents = v_total_ht_cents,
    total_tax_cents = v_total_tax_cents,
    total_ttc_cents = v_total_ttc_cents
  where id = v_version_id
    and tenant_id = v_import.tenant_id;

  return query
  select
    v_project_id,
    v_version_id,
    v_section_id,
    v_inserted_count,
    v_total_ht_cents,
    v_total_tax_cents,
    v_total_ttc_cents;
end;
$$;

revoke all on function public.create_affaire_from_import_lines(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public;

revoke all on function public.create_affaire_from_import_lines(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from authenticated;

grant execute on function public.create_affaire_from_import_lines(
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;
