-- TKF-013: atomic RPC to apply takeoff items into an estimate version.

create or replace function public.apply_takeoff_job(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid default null
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text
)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_current_tenant_id uuid := public.current_tenant_id();
  v_strategy text := lower(btrim(coalesce(p_strategy, '')));
  v_scope text := null;
  v_job public.takeoff_jobs%rowtype;
  v_version public.estimate_versions%rowtype;
  v_parent_max_position integer := 0;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_ignored_count integer := 0;
  v_created_ids uuid[] := '{}'::uuid[];
  v_raw_ht bigint := 0;
  v_raw_tax bigint := 0;
  v_scaled_ht integer := 0;
  v_scaled_tax integer := 0;
  v_discount_cents integer := 0;
  v_total_ht integer := 0;
  v_total_tax integer := 0;
  v_total_ttc integer := 0;
  v_tax_discount integer := 0;
  v_rounding_step integer := 1;
  v_running_ht integer := 0;
  v_step_bp integer := 0;
  v_step_discount integer := 0;
  v_max_cents constant integer := 2147483647;
begin
  if p_job_id is null then
    raise exception 'p_job_id is required';
  end if;

  if v_current_tenant_id is null then
    raise exception 'tenant context is required';
  end if;

  if v_strategy not in ('append', 'replace', 'merge') then
    raise exception 'p_strategy must be one of: append, replace, merge';
  end if;

  select tj.*
    into v_job
  from public.takeoff_jobs tj
  where tj.id = p_job_id
    and tj.tenant_id = v_current_tenant_id
  for update;

  if not found then
    raise exception 'takeoff job not found for current tenant';
  end if;

  if v_job.status <> 'completed' then
    raise exception 'takeoff job must be in completed status before apply';
  end if;

  select ev.*
    into v_version
  from public.estimate_versions ev
  where ev.id = v_job.estimate_version_id
    and ev.tenant_id = v_job.tenant_id
  for update;

  if not found then
    raise exception 'estimate version not found for takeoff job';
  end if;

  if v_version.status <> 'draft' then
    raise exception 'estimate version must be draft';
  end if;

  if p_target_section_id is not null then
    perform 1
    from public.estimate_items ei
    where ei.id = p_target_section_id
      and ei.version_id = v_version.id
      and ei.tenant_id = v_version.tenant_id
      and ei.item_type = 'section'
    for update;

    if not found then
      raise exception 'p_target_section_id must reference a section in the target version';
    end if;
  end if;

  select count(*)
    into v_ignored_count
  from public.takeoff_items ti
  where ti.job_id = v_job.id
    and ti.tenant_id = v_job.tenant_id
    and ti.is_excluded = true;

  create temporary table _takeoff_apply_source (
    takeoff_item_id uuid primary key,
    source_order integer not null,
    designation text not null,
    unit text,
    quantity numeric(12,3) not null,
    source_file_name text,
    source_page integer,
    normalized_title text not null,
    normalized_description text not null
  ) on commit drop;

  insert into _takeoff_apply_source (
    takeoff_item_id,
    source_order,
    designation,
    unit,
    quantity,
    source_file_name,
    source_page,
    normalized_title,
    normalized_description
  )
  select
    src.id,
    src.source_order,
    src.designation,
    src.unit,
    src.quantity,
    src.source_file_name,
    src.source_page,
    lower(regexp_replace(coalesce(nullif(btrim(src.designation), ''), ''), '\\s+', ' ', 'g')),
    lower(regexp_replace(coalesce(src.unit, ''), '\\s+', ' ', 'g'))
  from (
    select
      ti.id,
      row_number() over (order by ti.created_at, ti.id) as source_order,
      coalesce(nullif(btrim(ti.designation), ''), ti.designation) as designation,
      nullif(btrim(ti.unit), '') as unit,
      ti.quantity,
      ti.source_file_name,
      ti.source_page
    from public.takeoff_items ti
    where ti.job_id = v_job.id
      and ti.tenant_id = v_job.tenant_id
      and ti.is_excluded = false
  ) as src;

  create temporary table _takeoff_apply_created_ids (
    id uuid primary key
  ) on commit drop;

  if v_strategy = 'replace' then
    if not exists (
      select 1
      from _takeoff_apply_source src
    ) then
      raise exception 'APPLY_NO_INCLUDABLE_ITEMS';
    end if;

    if p_target_section_id is null then
      v_scope := 'version';

      delete from public.estimate_items ei
      where ei.version_id = v_version.id
        and ei.tenant_id = v_version.tenant_id;
    else
      v_scope := 'section';

      with recursive descendants as (
        select root.id
        from public.estimate_items root
        where root.id = p_target_section_id
          and root.version_id = v_version.id
          and root.tenant_id = v_version.tenant_id
        union all
        select child.id
        from public.estimate_items child
        join descendants d on d.id = child.parent_id
        where child.version_id = v_version.id
          and child.tenant_id = v_version.tenant_id
      )
      delete from public.estimate_items ei
      using descendants d
      where ei.id = d.id
        and ei.id <> p_target_section_id
        and ei.version_id = v_version.id
        and ei.tenant_id = v_version.tenant_id;
    end if;
  elsif v_strategy = 'append' then
    v_scope := case when p_target_section_id is null then 'version' else 'section' end;
  else
    v_scope := case when p_target_section_id is null then 'version' else 'section' end;
  end if;

  if v_strategy in ('append', 'replace') then
    select coalesce(max(ei.position), 0)
      into v_parent_max_position
    from public.estimate_items ei
    where ei.version_id = v_version.id
      and ei.tenant_id = v_version.tenant_id
      and ei.parent_id is not distinct from p_target_section_id;

    with inserted as (
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
        pu_ht_cents,
        source_provider,
        source_job_id,
        source_file_name,
        source_page,
        line_total_ht_cents,
        line_tax_cents,
        line_total_ttc_cents
      )
      select
        gen_random_uuid(),
        v_version.tenant_id,
        v_version.id,
        p_target_section_id,
        'line',
        v_parent_max_position + row_number() over (order by src.source_order),
        src.designation,
        src.unit,
        src.quantity,
        0,
        v_version.tax_rate_bp,
        1::numeric(12,3),
        0::numeric(12,3),
        1.0::numeric(12,4),
        1::numeric(12,3),
        0,
        'takeoff',
        v_job.id,
        src.source_file_name,
        src.source_page,
        0,
        0,
        0
      from _takeoff_apply_source src
      order by src.source_order
      returning id
    )
    insert into _takeoff_apply_created_ids (id)
    select inserted.id
    from inserted;
  else
    create temporary table _takeoff_apply_matches (
      takeoff_item_id uuid primary key,
      estimate_item_id uuid not null,
      source_order integer not null,
      designation text not null,
      unit text,
      quantity numeric(12,3) not null,
      source_file_name text,
      source_page integer
    ) on commit drop;

    with source_ranked as (
      select
        src.takeoff_item_id,
        src.source_order,
        src.designation,
        src.unit,
        src.quantity,
        src.source_file_name,
        src.source_page,
        src.normalized_title,
        src.normalized_description,
        row_number() over (
          partition by src.normalized_title, src.normalized_description
          order by src.source_order
        ) as match_rank
      from _takeoff_apply_source src
    ),
    existing_ranked as (
      select
        ei.id as estimate_item_id,
        lower(regexp_replace(coalesce(nullif(btrim(ei.title), ''), ''), '\\s+', ' ', 'g')) as normalized_title,
        lower(regexp_replace(coalesce(nullif(btrim(ei.description), ''), ''), '\\s+', ' ', 'g')) as normalized_description,
        row_number() over (
          partition by
            lower(regexp_replace(coalesce(nullif(btrim(ei.title), ''), ''), '\\s+', ' ', 'g')),
            lower(regexp_replace(coalesce(nullif(btrim(ei.description), ''), ''), '\\s+', ' ', 'g'))
          order by ei.position, ei.id
        ) as match_rank
      from public.estimate_items ei
      where ei.version_id = v_version.id
        and ei.tenant_id = v_version.tenant_id
        and ei.item_type = 'line'
        and ei.parent_id is not distinct from p_target_section_id
    )
    insert into _takeoff_apply_matches (
      takeoff_item_id,
      estimate_item_id,
      source_order,
      designation,
      unit,
      quantity,
      source_file_name,
      source_page
    )
    select
      src.takeoff_item_id,
      existing.estimate_item_id,
      src.source_order,
      src.designation,
      src.unit,
      src.quantity,
      src.source_file_name,
      src.source_page
    from source_ranked src
    join existing_ranked existing
      on existing.normalized_title = src.normalized_title
      and existing.normalized_description = src.normalized_description
      and existing.match_rank = src.match_rank;

    update public.estimate_items ei
    set
      quantity = matched.quantity,
      title = matched.designation,
      description = matched.unit,
      line_total_ht_cents = least(
        v_max_cents,
        greatest(0, round(ei.pu_ht_cents::numeric * matched.quantity)::integer)
      ),
      line_tax_cents = least(
        v_max_cents,
        greatest(
          0,
          round(
            round(ei.pu_ht_cents::numeric * matched.quantity)::numeric
            * greatest(ei.tax_rate_bp, 0)::numeric
            / 10000
          )::integer
        )
      ),
      line_total_ttc_cents = least(
        v_max_cents,
        greatest(
          0,
          round(ei.pu_ht_cents::numeric * matched.quantity)::integer
          + round(
            round(ei.pu_ht_cents::numeric * matched.quantity)::numeric
            * greatest(ei.tax_rate_bp, 0)::numeric
            / 10000
          )::integer
        )
      ),
      source_provider = 'takeoff',
      source_job_id = v_job.id,
      source_file_name = matched.source_file_name,
      source_page = matched.source_page
    from _takeoff_apply_matches matched
    where ei.id = matched.estimate_item_id
      and ei.version_id = v_version.id
      and ei.tenant_id = v_version.tenant_id;

    get diagnostics v_updated_count = row_count;

    create temporary table _takeoff_apply_unmatched (
      takeoff_item_id uuid primary key,
      source_order integer not null,
      designation text not null,
      unit text,
      quantity numeric(12,3) not null,
      source_file_name text,
      source_page integer
    ) on commit drop;

    insert into _takeoff_apply_unmatched (
      takeoff_item_id,
      source_order,
      designation,
      unit,
      quantity,
      source_file_name,
      source_page
    )
    select
      src.takeoff_item_id,
      src.source_order,
      src.designation,
      src.unit,
      src.quantity,
      src.source_file_name,
      src.source_page
    from _takeoff_apply_source src
    left join _takeoff_apply_matches matched
      on matched.takeoff_item_id = src.takeoff_item_id
    where matched.takeoff_item_id is null
    order by src.source_order;

    select coalesce(max(ei.position), 0)
      into v_parent_max_position
    from public.estimate_items ei
    where ei.version_id = v_version.id
      and ei.tenant_id = v_version.tenant_id
      and ei.parent_id is not distinct from p_target_section_id;

    with inserted as (
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
        pu_ht_cents,
        source_provider,
        source_job_id,
        source_file_name,
        source_page,
        line_total_ht_cents,
        line_tax_cents,
        line_total_ttc_cents
      )
      select
        gen_random_uuid(),
        v_version.tenant_id,
        v_version.id,
        p_target_section_id,
        'line',
        v_parent_max_position + row_number() over (order by src.source_order),
        src.designation,
        src.unit,
        src.quantity,
        0,
        v_version.tax_rate_bp,
        1::numeric(12,3),
        0::numeric(12,3),
        1.0::numeric(12,4),
        1::numeric(12,3),
        0,
        'takeoff',
        v_job.id,
        src.source_file_name,
        src.source_page,
        0,
        0,
        0
      from _takeoff_apply_unmatched src
      order by src.source_order
      returning id
    )
    insert into _takeoff_apply_created_ids (id)
    select inserted.id
    from inserted;
  end if;

  select count(*)
    into v_created_count
  from _takeoff_apply_created_ids;

  select coalesce(array_agg(created.id order by created.id), '{}'::uuid[])
    into v_created_ids
  from _takeoff_apply_created_ids created;

  select
    coalesce(sum(ei.line_total_ht_cents), 0),
    coalesce(sum(ei.line_tax_cents), 0)
    into v_raw_ht, v_raw_tax
  from public.estimate_items ei
  where ei.version_id = v_version.id
    and ei.tenant_id = v_version.tenant_id
    and ei.item_type = 'line';

  v_scaled_ht := least(
    v_max_cents,
    greatest(
      0,
      round(v_raw_ht::numeric * greatest(v_version.global_coefficient, 0)::numeric)::integer
    )
  );

  v_scaled_tax := least(
    v_max_cents,
    greatest(
      0,
      round(v_raw_tax::numeric * greatest(v_version.global_coefficient, 0)::numeric)::integer
    )
  );

  v_discount_cents := 0;

  if v_version.discount_mode = 'cascade' then
    v_running_ht := v_scaled_ht;

    foreach v_step_bp in array coalesce(v_version.discount_steps, '{}'::integer[]) loop
      v_step_bp := least(greatest(coalesce(v_step_bp, 0), 0), 10000);
      v_step_discount := round(v_running_ht::numeric * v_step_bp::numeric / 10000)::integer;
      v_step_discount := least(greatest(v_step_discount, 0), v_running_ht);
      v_discount_cents := v_discount_cents + v_step_discount;
      v_running_ht := v_running_ht - v_step_discount;

      exit when v_running_ht <= 0;
    end loop;
  else
    if coalesce(cardinality(v_version.discount_steps), 0) > 0 then
      v_step_bp := coalesce(v_version.discount_steps[1], 0);
    else
      v_step_bp := coalesce(v_version.discount_bp, 0);
    end if;

    v_step_bp := least(greatest(v_step_bp, 0), 10000);
    v_discount_cents := round(v_scaled_ht::numeric * v_step_bp::numeric / 10000)::integer;
  end if;

  v_discount_cents := least(greatest(v_discount_cents, 0), v_scaled_ht);

  v_total_ht := greatest(v_scaled_ht - v_discount_cents, 0);
  v_tax_discount := round(
    v_discount_cents::numeric * greatest(v_version.tax_rate_bp, 0)::numeric / 10000
  )::integer;
  v_total_tax := greatest(v_scaled_tax - greatest(v_tax_discount, 0), 0);
  v_total_ttc := v_total_ht + v_total_tax;

  v_rounding_step := greatest(coalesce(v_version.rounding_step_cents, 1), 1);

  if v_version.rounding_mode = 'nearest' then
    v_total_ttc := round(v_total_ttc::numeric / v_rounding_step::numeric)::integer * v_rounding_step;
  elsif v_version.rounding_mode = 'up' then
    v_total_ttc := ceil(v_total_ttc::numeric / v_rounding_step::numeric)::integer * v_rounding_step;
  elsif v_version.rounding_mode = 'down' then
    v_total_ttc := floor(v_total_ttc::numeric / v_rounding_step::numeric)::integer * v_rounding_step;
  end if;

  v_total_ttc := least(v_max_cents, greatest(v_total_ttc, v_total_ht));
  v_total_tax := greatest(v_total_ttc - v_total_ht, 0);

  update public.estimate_versions ev
  set
    total_ht_cents = v_total_ht,
    total_tax_cents = v_total_tax,
    total_ttc_cents = v_total_ttc,
    updated_at = v_now
  where ev.id = v_version.id
    and ev.tenant_id = v_version.tenant_id;

  update public.takeoff_jobs tj
  set
    status = 'applied',
    completed_at = coalesce(tj.completed_at, v_now),
    updated_at = v_now
  where tj.id = v_job.id
    and tj.tenant_id = v_job.tenant_id;

  return query
  select
    v_created_count,
    v_updated_count,
    v_ignored_count,
    v_created_ids,
    v_scope;
end;
$$;

grant execute on function public.apply_takeoff_job(uuid, text, uuid) to authenticated;
