-- Preserve reviewed DPGF hierarchy while retaining the legacy line-only payload contract.

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
security invoker
set search_path = public
as $$
declare
  v_project public.estimate_projects%rowtype;
  v_import public.dpgf_imports%rowtype;
  v_latest_version public.estimate_versions%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_root_section_id uuid := gen_random_uuid();
  v_level_one_section_id uuid;
  v_level_two_section_id uuid;
  v_item_id uuid;
  v_parent_id uuid;
  v_item_payload jsonb;
  v_item_ordinality bigint;
  v_item_type text;
  v_section_level integer;
  v_next_version_number integer;
  v_inserted_count integer := 0;
  v_total_ht_cents integer := 0;
  v_total_tax_cents integer := 0;
  v_total_ttc_cents integer := 0;
  v_resolved_version_title text;
  v_resolved_section_title text;
  v_source_metadata jsonb;
  v_source_page integer;
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
    h_mo_majoration,
    k_mo_atelier,
    k_mo_chantier,
    source_provider,
    source_file_name,
    source_metadata
  )
  values (
    v_root_section_id,
    v_project.tenant_id,
    v_version_id,
    null,
    'section',
    1,
    v_resolved_section_title,
    1,
    1,
    1,
    'dpgf',
    v_import.filename,
    jsonb_build_object('import_id', p_import_id, 'kind', 'import_root')
  );

  for v_item_payload, v_item_ordinality in
    select input_rows.value, input_rows.ordinality
    from jsonb_array_elements(p_lines) with ordinality as input_rows(value, ordinality)
    order by input_rows.ordinality
  loop
    if jsonb_typeof(v_item_payload) <> 'object' then
      raise exception 'Each p_lines entry must be a JSON object';
    end if;

    v_item_type := lower(nullif(trim(coalesce(v_item_payload ->> 'item_type', '')), ''));
    if v_item_type is null then
      v_item_type := 'line';
    end if;
    if v_item_type not in ('line', 'section') then
      raise exception 'Unsupported import item_type: %', v_item_type;
    end if;

    v_source_metadata :=
      case
        when jsonb_typeof(v_item_payload -> 'source_metadata') = 'object'
          then v_item_payload -> 'source_metadata'
        else '{}'::jsonb
      end
      || jsonb_strip_nulls(
        jsonb_build_object(
          'mapped_row_id', nullif(trim(v_item_payload ->> 'mapped_row_id'), ''),
          'row_index',
            case
              when coalesce(v_item_payload ->> 'row_index', '') ~ '^[0-9]+$'
                then (v_item_payload ->> 'row_index')::integer
              else null
            end,
          'notes', nullif(trim(v_item_payload ->> 'notes'), '')
        )
      );
    v_source_page :=
      case
        when coalesce(v_item_payload ->> 'source_page', '') ~ '^[1-9][0-9]*$'
          then (v_item_payload ->> 'source_page')::integer
        else null
      end;

    if v_item_type = 'section' then
      if coalesce(v_item_payload ->> 'section_level', '') !~ '^[12]$' then
        raise exception 'section_level must be 1 or 2';
      end if;
      v_section_level := (v_item_payload ->> 'section_level')::integer;

      if v_section_level = 1 then
        v_parent_id := v_root_section_id;
        v_level_two_section_id := null;
      else
        if v_level_one_section_id is null then
          raise exception 'A level 2 section requires a preceding level 1 section';
        end if;
        v_parent_id := v_level_one_section_id;
      end if;

      v_item_id := gen_random_uuid();
      insert into public.estimate_items (
        id,
        tenant_id,
        version_id,
        parent_id,
        item_type,
        position,
        title,
        h_mo_majoration,
        k_mo_atelier,
        k_mo_chantier,
        source_provider,
        source_file_name,
        source_page,
        source_metadata
      )
      values (
        v_item_id,
        v_project.tenant_id,
        v_version_id,
        v_parent_id,
        'section',
        v_item_ordinality::integer,
        coalesce(
          nullif(trim(v_item_payload ->> 'title'), ''),
          format('Section %s', v_item_ordinality::text)
        ),
        1,
        1,
        1,
        'dpgf',
        v_import.filename,
        v_source_page,
        v_source_metadata
      );

      if v_section_level = 1 then
        v_level_one_section_id := v_item_id;
      else
        v_level_two_section_id := v_item_id;
      end if;
    else
      v_parent_id := coalesce(
        v_level_two_section_id,
        v_level_one_section_id,
        v_root_section_id
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
        source_provider,
        source_file_name,
        source_page,
        source_metadata,
        line_total_ht_cents,
        line_tax_cents,
        line_total_ttc_cents
      )
      values (
        v_project.tenant_id,
        v_version_id,
        v_parent_id,
        'line',
        v_item_ordinality::integer,
        coalesce(
          nullif(trim(v_item_payload ->> 'title'), ''),
          format('Ligne %s', v_item_ordinality::text)
        ),
        null,
        nullif(trim(v_item_payload ->> 'description'), ''),
        coalesce((v_item_payload ->> 'quantity')::numeric, 0),
        coalesce((v_item_payload ->> 'unit_price_ht_cents')::integer, 0),
        coalesce((v_item_payload ->> 'tax_rate_bp')::integer, 2000),
        coalesce((v_item_payload ->> 'k_fo')::numeric, 1),
        coalesce((v_item_payload ->> 'h_mo')::numeric, 0),
        coalesce((v_item_payload ->> 'h_mo_majoration')::numeric, 1),
        coalesce((v_item_payload ->> 'k_mo')::numeric, 1),
        null,
        null,
        null,
        null,
        null,
        null,
        coalesce((v_item_payload ->> 'pu_ht_cents')::integer, 0),
        null,
        null,
        null,
        null,
        'dpgf',
        v_import.filename,
        v_source_page,
        v_source_metadata,
        coalesce((v_item_payload ->> 'line_total_ht_cents')::integer, 0),
        coalesce((v_item_payload ->> 'line_tax_cents')::integer, 0),
        coalesce((v_item_payload ->> 'line_total_ttc_cents')::integer, 0)
      );

      v_inserted_count := v_inserted_count + 1;
    end if;
  end loop;

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
    v_root_section_id,
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
