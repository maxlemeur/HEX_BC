-- Métré M2 v0.1 : application d'un métré revu à un brouillon du moteur 3.
--
-- Avant : public.apply_takeoff_job_atomic passait toujours par public.apply_takeoff_job (conventions
-- v1/v2 : unité dans description, montants historiques) puis par public.recalculate_takeoff_estimate_version.
-- Sur une v3, la première écriture échouait (ESTIMATE_V3_WRITER_NOT_SUPPORTED) et le serveur refusait le
-- métré par son nom avant tout dépôt (TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED).
--
-- Après :
-- 1. private.takeoff_apply_v3_lines écrit les lignes d'un métré dans une v3, sous le contrat d'écrivain
--    de cette version :
--    - l'unité de chaque item inclus passe par le référentiel partagé (private.normalize_unit) : un code
--      d'unité, ou un statut de ligne pour une mention (« PM », « compris »…). Une unité inconnue refuse
--      toute l'application, items nommés (TAKEOFF_V3_UNIT_UNRESOLVED, 22023) : rien n'est écrit et la
--      revue permet de corriger l'unité ou d'exclure l'item ;
--    - une ligne neuve porte le prix d'achat 0 € et aucune heure, comme une ligne de métré v1/v2 et
--      comme une ligne d'import DPGF v3 sans prix (« ligne à 0 € ») ; la règle de mapping « prix »
--      reste la seule source de prix ;
--    - la fusion rapproche une ligne existante de la section par désignation et par unité résolue
--      (code, ou statut d'une mention), et ne change que sa quantité, sa désignation et sa provenance ;
--    - chaque ligne porte source_provider 'takeoff', le job, le fichier, la page, et
--      source_metadata.takeoff_item_id : le lien item → ligne est écrit avec la ligne.
-- 2. public.apply_takeoff_job_atomic lit le moteur de la version sous verrou. Pour une v3 (brouillon
--    seulement), il pose le contrat d'écrivain, écrit les lignes par 1., garde les mêmes contrôles et
--    actions de mapping (renommage, prix, catégorie, ouvrage par public.materialize_estimate_assembly_tree,
--    qui convertit déjà les heures en heures par unité ou refuse par son nom), puis calcule et vérifie
--    les montants par public.estimate_v3_complete_entry_for_writer. Il n'appelle jamais le recalcul
--    historique sur une v3. Le passage du job à 'applied', les lignes et leurs montants restent dans la
--    même transaction ; un second appel est refusé par TAKEOFF_JOB_COMPLETED_REQUIRED.
-- Copié de 20260813201300, seules les lignes marquées « M2 v0.1 » changent ; v1 et v2 gardent
-- exactement leur chemin. CREATE OR REPLACE conserve propriétaire et droits ; aucune donnée existante
-- n'est réécrite.
begin;

do $preflight$
begin
  if to_regprocedure('public.estimate_v3_complete_entry_for_writer(uuid,uuid[])') is null
    or to_regprocedure('private.normalize_unit(text)') is null
    or to_regprocedure('public.apply_takeoff_job_atomic(uuid,text,uuid,jsonb)') is null
  then
    raise exception 'TAKEOFF_V3_APPLY_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create function private.takeoff_apply_v3_lines(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid
)
returns table (
  takeoff_item_id uuid,
  estimate_item_id uuid,
  created boolean
)
language plpgsql
set search_path = ''
as $$
declare
  job_row public.takeoff_jobs%rowtype;
  target_version public.estimate_versions%rowtype;
  unresolved jsonb;
  parent_max_position integer := 0;
begin
  select job.*
    into job_row
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  select version.*
    into target_version
  from public.estimate_versions as version
  where version.id = job_row.estimate_version_id
    and version.tenant_id = job_row.tenant_id;

  -- Appelée seulement par public.apply_takeoff_job_atomic, qui a déjà contrôlé le job, la version,
  -- la section et le plan de mapping, puis posé le contrat d'écrivain de cette version.
  if target_version.id is null
    or target_version.calc_engine_version is distinct from 3
    or target_version.status is distinct from 'draft'::public.estimate_status
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '')
      <> target_version.id::text
    or p_strategy is null
    or p_strategy not in ('append', 'merge')
  then
    raise exception using errcode = '0A000', message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  drop table if exists pg_temp._takeoff_v3_apply_source;
  create temporary table _takeoff_v3_apply_source (
    takeoff_item_id uuid primary key,
    source_order integer not null,
    designation text not null,
    unit text not null,
    unit_code text,
    pricing_status public.estimate_line_pricing_status,
    quantity numeric(12,3) not null,
    source_file_name text,
    source_page integer,
    normalized_title text not null,
    unit_key text
  ) on commit drop;

  insert into pg_temp._takeoff_v3_apply_source (
    takeoff_item_id, source_order, designation, unit, unit_code, pricing_status, quantity,
    source_file_name, source_page, normalized_title, unit_key
  )
  select
    item.id,
    row_number() over (order by item.created_at, item.id),
    btrim(item.designation),
    btrim(item.unit),
    resolved.unit_code,
    case when resolved.unit_code is not null then 'priced'::public.estimate_line_pricing_status
      else resolved.pricing_status end,
    item.quantity,
    item.source_file_name,
    item.source_page,
    lower(regexp_replace(btrim(item.designation), '\s+', ' ', 'g')),
    coalesce(resolved.unit_code, 'status:' || resolved.pricing_status::text)
  from public.takeoff_items as item
  cross join lateral private.normalize_unit(item.unit) as resolved
  where item.job_id = job_row.id
    and item.tenant_id = job_row.tenant_id
    and not item.is_excluded;

  -- Une unité que le référentiel ne connaît pas n'est jamais devinée : l'application entière est
  -- refusée, items nommés, avant toute écriture de ligne.
  select jsonb_agg(
      jsonb_build_object(
        'takeoff_item_id', source.takeoff_item_id,
        'designation', source.designation,
        'unit', source.unit
      )
      order by source.source_order
    )
    into unresolved
  from pg_temp._takeoff_v3_apply_source as source
  where source.unit_key is null;

  if unresolved is not null then
    raise exception using
      errcode = '22023',
      message = 'TAKEOFF_V3_UNIT_UNRESOLVED',
      detail = jsonb_build_object('items', unresolved)::text;
  end if;

  drop table if exists pg_temp._takeoff_v3_apply_matches;
  create temporary table _takeoff_v3_apply_matches (
    takeoff_item_id uuid primary key,
    estimate_item_id uuid not null unique
  ) on commit drop;

  if p_strategy = 'merge' then
    insert into pg_temp._takeoff_v3_apply_matches (takeoff_item_id, estimate_item_id)
    with source_ranked as (
      select
        source.takeoff_item_id,
        source.normalized_title,
        source.unit_key,
        row_number() over (
          partition by source.normalized_title, source.unit_key
          order by source.source_order
        ) as match_rank
      from pg_temp._takeoff_v3_apply_source as source
    ), existing_ranked as (
      select
        item.id,
        lower(regexp_replace(btrim(item.title), '\s+', ' ', 'g')) as normalized_title,
        coalesce(item.unit_code, 'status:' || item.pricing_status::text) as unit_key,
        row_number() over (
          partition by
            lower(regexp_replace(btrim(item.title), '\s+', ' ', 'g')),
            coalesce(item.unit_code, 'status:' || item.pricing_status::text)
          order by item.position, item.id
        ) as match_rank
      from public.estimate_items as item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
        and item.item_type = 'line'::public.estimate_item_type
        and item.parent_id is not distinct from p_target_section_id
    )
    select source.takeoff_item_id, existing.id
    from source_ranked as source
    join existing_ranked as existing
      on existing.normalized_title = source.normalized_title
     and existing.unit_key = source.unit_key
     and existing.match_rank = source.match_rank;

    -- La fusion garde le chiffrage de la ligne (prix, heures par unité, statut, unité) : seules la
    -- quantité, la désignation et la provenance viennent du métré.
    return query
    update public.estimate_items as item
    set
      quantity = source.quantity,
      title = source.designation,
      source_provider = 'takeoff',
      source_job_id = job_row.id,
      source_file_name = source.source_file_name,
      source_page = source.source_page,
      source_metadata = coalesce(item.source_metadata, '{}'::jsonb)
        || jsonb_build_object('takeoff_item_id', source.takeoff_item_id),
      updated_at = statement_timestamp()
    from pg_temp._takeoff_v3_apply_matches as matched
    join pg_temp._takeoff_v3_apply_source as source
      on source.takeoff_item_id = matched.takeoff_item_id
    where item.id = matched.estimate_item_id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    returning source.takeoff_item_id, item.id, false;
  end if;

  select coalesce(max(item.position), 0)
    into parent_max_position
  from public.estimate_items as item
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from p_target_section_id;

  return query
  insert into public.estimate_items as item (
    tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_code, pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
    pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
    source_provider, source_job_id, source_file_name, source_page, source_metadata
  )
  select
    target_version.tenant_id,
    target_version.id,
    p_target_section_id,
    'line'::public.estimate_item_type,
    parent_max_position + row_number() over (order by source.source_order)::integer,
    source.designation,
    source.unit,
    source.quantity,
    source.unit_code,
    source.pricing_status,
    0,
    target_version.tax_rate_bp,
    1,
    0,
    1,
    1,
    0,
    0,
    0,
    0,
    'takeoff',
    job_row.id,
    source.source_file_name,
    source.source_page,
    jsonb_build_object('takeoff_item_id', source.takeoff_item_id)
  from pg_temp._takeoff_v3_apply_source as source
  where not exists (
    select 1
    from pg_temp._takeoff_v3_apply_matches as matched
    where matched.takeoff_item_id = source.takeoff_item_id
  )
  order by source.source_order
  returning (item.source_metadata ->> 'takeoff_item_id')::uuid, item.id, true;
end;
$$;

comment on function private.takeoff_apply_v3_lines(uuid, text, uuid) is
  'Takeoff M2 v0.1: writes the included takeoff items of a job as engine 3 lines under the writer contract of their draft (units through the shared referential, TAKEOFF_V3_UNIT_UNRESOLVED otherwise; provenance and takeoff_item_id on the line; no amount). Called by public.apply_takeoff_job_atomic only.';

revoke all on function private.takeoff_apply_v3_lines(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.apply_takeoff_job_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text,
  item_links jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_strategy text := lower(btrim(coalesce(p_strategy, '')));
  job_row public.takeoff_jobs%rowtype;
  project_owner_id uuid;
  legacy_strategy text;
  legacy_created_count integer := 0;
  legacy_updated_count integer := 0;
  legacy_ignored_count integer := 0;
  legacy_created_ids uuid[] := '{}'::uuid[];
  legacy_scope text;
  mapping_row record;
  assembly_item_ids uuid[];
  assembly_position integer;
  raw_output_count integer := 0;
  assembly_source_count integer := 0;
  mapped_line_count integer := 0;
  -- M2 v0.1 : moteur de la version cible et contrat d'écrivain v3 en vigueur avant l'application.
  target_engine_version smallint;
  target_version_status public.estimate_status;
  previous_v3_writer text := '';
begin
  if coalesce(current_setting('app.takeoff_apply_job', true), '') <> 'on'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') <> 'on'
  then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  if (select auth.uid()) is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if normalized_strategy not in ('append', 'replace', 'merge') then
    raise exception 'TAKEOFF_APPLY_STRATEGY_INVALID' using errcode = '22023';
  end if;

  if normalized_strategy = 'replace' and p_target_section_id is null then
    raise exception 'TAKEOFF_ROOT_REPLACE_DISABLED' using errcode = '22023';
  end if;

  select job.*
    into job_row
  from public.takeoff_jobs as job
  where job.id = p_job_id
  for update;

  if job_row.id is null then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not coalesce(public.has_tenant_role(
    job_row.tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  ), false) then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if job_row.status <> 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_JOB_COMPLETED_REQUIRED' using errcode = 'P0001';
  end if;

  select project.user_id
    into project_owner_id
  from public.estimate_versions as version
  join public.estimate_projects as project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = job_row.estimate_version_id
    and version.tenant_id = job_row.tenant_id;

  if project_owner_id is null then
    raise exception 'ESTIMATE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- M2 v0.1 : le moteur est lu dans la transaction, sous le verrou de la version que
  -- public.apply_takeoff_job prend aussi pour une v1/v2. Une v3 ne reçoit un métré qu'en brouillon.
  select version.calc_engine_version, version.status
    into target_engine_version, target_version_status
  from public.estimate_versions as version
  where version.id = job_row.estimate_version_id
    and version.tenant_id = job_row.tenant_id
  for update;

  if target_engine_version = 3
    and target_version_status <> 'draft'::public.estimate_status
  then
    raise exception 'TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED' using errcode = 'P0001';
  end if;

  if p_target_section_id is not null and not exists (
    select 1
    from public.estimate_items as target
    where target.id = p_target_section_id
      and target.version_id = job_row.estimate_version_id
      and target.tenant_id = job_row.tenant_id
      and target.item_type = 'section'::public.estimate_item_type
  ) then
    raise exception 'TAKEOFF_TARGET_SECTION_INVALID' using errcode = '22023';
  end if;

  -- M2 v0.1 : une v3 verrouille sa section cible comme public.apply_takeoff_job le fait pour une v1/v2.
  if target_engine_version = 3 and p_target_section_id is not null then
    perform 1
    from public.estimate_items as target
    where target.id = p_target_section_id
      and target.version_id = job_row.estimate_version_id
      and target.tenant_id = job_row.tenant_id
    for update;
  end if;

  if p_mapping_plan is null
    or jsonb_typeof(p_mapping_plan) <> 'array'
    or exists (
      select 1
      from jsonb_array_elements(p_mapping_plan) as entry(value)
      where jsonb_typeof(entry.value) <> 'object'
        or entry.value - array[
          'item_id',
          'source_order',
          'rule_id',
          'action',
          'designation',
          'unit_price_cents',
          'category_id',
          'assembly_id'
        ] <> '{}'::jsonb
        or not entry.value ?& array[
          'item_id',
          'source_order',
          'rule_id',
          'action',
          'designation',
          'unit_price_cents',
          'category_id',
          'assembly_id'
        ]
    )
  then
    raise exception 'TAKEOFF_ATOMIC_MAPPING_PLAN_INVALID' using errcode = '22023';
  end if;

  drop table if exists pg_temp._atomic_takeoff_mapping_plan;
  create temporary table _atomic_takeoff_mapping_plan (
    item_id uuid primary key,
    source_order integer not null unique,
    rule_id uuid,
    action text not null,
    designation text not null,
    unit_price_cents integer,
    category_id uuid,
    assembly_id uuid
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_mapping_plan (
    item_id,
    source_order,
    rule_id,
    action,
    designation,
    unit_price_cents,
    category_id,
    assembly_id
  )
  select
    plan.item_id,
    plan.source_order,
    plan.rule_id,
    plan.action,
    btrim(plan.designation),
    plan.unit_price_cents,
    plan.category_id,
    plan.assembly_id
  from jsonb_to_recordset(p_mapping_plan) as plan(
    item_id uuid,
    source_order integer,
    rule_id uuid,
    action text,
    designation text,
    unit_price_cents integer,
    category_id uuid,
    assembly_id uuid
  );

  if (
    select count(*) from pg_temp._atomic_takeoff_mapping_plan
  ) <> (
    select count(*)
    from public.takeoff_items as item
    where item.job_id = job_row.id
      and item.tenant_id = job_row.tenant_id
  ) or exists (
    with expected as (
      select
        item.id,
        (row_number() over (order by item.created_at, item.id) - 1)::integer
          as source_order
      from public.takeoff_items as item
      where item.job_id = job_row.id
        and item.tenant_id = job_row.tenant_id
    )
    select 1
    from expected
    full join pg_temp._atomic_takeoff_mapping_plan as plan
      on plan.item_id = expected.id
    where plan.item_id is null
      or expected.id is null
      or plan.source_order <> expected.source_order
  ) then
    raise exception 'TAKEOFF_ATOMIC_MAPPING_PLAN_STALE' using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where plan.source_order < 0
      or plan.action not in (
        'none',
        'rename',
        'set_price',
        'set_category',
        'apply_assembly',
        'skip'
      )
      or char_length(plan.designation) not between 1 and 500
      or (
        plan.action = 'rename'
        and plan.designation = btrim(item.designation)
      )
      or (
        plan.action <> 'rename'
        and plan.designation is distinct from btrim(item.designation)
      )
      or (plan.action = 'set_price') is distinct from
        (plan.unit_price_cents is not null)
      or coalesce(plan.unit_price_cents, 0) < 0
      or (plan.action = 'set_category') is distinct from
        (plan.category_id is not null)
      or (plan.action = 'apply_assembly') is distinct from
        (plan.assembly_id is not null)
      or (
        item.is_excluded
        and (
          plan.action <> 'none'
          or plan.designation is distinct from btrim(item.designation)
          or plan.unit_price_cents is not null
          or plan.category_id is not null
          or plan.assembly_id is not null
        )
      )
  ) then
    raise exception 'TAKEOFF_ATOMIC_MAPPING_PLAN_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_temp._atomic_takeoff_mapping_plan as plan
    left join public.estimate_categories as category
      on category.id = plan.category_id
     and category.tenant_id = job_row.tenant_id
    where plan.action = 'set_category'
      and category.id is null
  ) then
    raise exception 'TAKEOFF_MAPPING_CATEGORY_INVALID' using errcode = '23503';
  end if;

  for mapping_row in
    select plan.assembly_id
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where plan.action = 'apply_assembly'
      and not item.is_excluded
    order by plan.source_order
  loop
    if not exists (
      select 1
      from public.estimate_assemblies as assembly
      where assembly.id = mapping_row.assembly_id
        and assembly.tenant_id = job_row.tenant_id
    ) then
      raise exception 'TAKEOFF_MAPPING_ASSEMBLY_INVALID' using errcode = '23503';
    end if;

    if not exists (
      select 1
      from public.estimate_assembly_items as item
      where item.assembly_id = mapping_row.assembly_id
        and item.tenant_id = job_row.tenant_id
    ) and not exists (
      select 1
      from public.estimate_assembly_members as member
      where member.parent_assembly_id = mapping_row.assembly_id
        and member.tenant_id = job_row.tenant_id
    ) then
      raise exception 'TAKEOFF_MAPPING_ASSEMBLY_EMPTY' using errcode = '22023';
    end if;

    if exists (
      with recursive assembly_tree(id) as (
        select mapping_row.assembly_id
        union
        select member.child_assembly_id
        from public.estimate_assembly_members as member
        join assembly_tree as parent
          on parent.id = member.parent_assembly_id
        where member.tenant_id = job_row.tenant_id
      )
      select 1
      from assembly_tree
      join public.estimate_assembly_items as item
        on item.assembly_id = assembly_tree.id
       and item.tenant_id = job_row.tenant_id
      where item.cost_type = 'labor'
        and item.labor_role_id is null
    ) then
      raise exception 'ESTIMATE_ASSEMBLY_LABOR_ROLE_REQUIRED'
        using errcode = '23502';
    end if;

    if exists (
      with recursive assembly_tree(id) as (
        select mapping_row.assembly_id
        union
        select member.child_assembly_id
        from public.estimate_assembly_members as member
        join assembly_tree as parent
          on parent.id = member.parent_assembly_id
        where member.tenant_id = job_row.tenant_id
      )
      select 1
      from assembly_tree
      join public.estimate_assembly_items as item
        on item.assembly_id = assembly_tree.id
       and item.tenant_id = job_row.tenant_id
      left join public.labor_roles as role
        on role.id = item.labor_role_id
       and role.tenant_id = job_row.tenant_id
       and role.user_id = project_owner_id
      where item.labor_role_id is not null
        and role.id is null
    ) then
      raise exception 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH'
        using errcode = '23503';
    end if;
  end loop;

  perform set_config('app.takeoff_apply_atomic', 'on', true);

  update public.takeoff_items as item
  set
    designation = plan.designation,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_mapping_plan as plan
  where item.id = plan.item_id
    and item.job_id = job_row.id
    and item.tenant_id = job_row.tenant_id
    and not item.is_excluded
    and plan.action = 'rename';

  update public.takeoff_items as item
  set
    is_excluded = true,
    exclusion_reason = case
      when plan.action = 'skip'
        then 'Exclu par regle de mapping: skip'
      else 'Exclu par regle de mapping: apply_assembly'
    end,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_mapping_plan as plan
  where item.id = plan.item_id
    and item.job_id = job_row.id
    and item.tenant_id = job_row.tenant_id
    and not item.is_excluded
    and plan.action in ('skip', 'apply_assembly');

  select count(*)
    into raw_output_count
  from pg_temp._atomic_takeoff_mapping_plan as plan
  join public.takeoff_items as item
    on item.id = plan.item_id
   and item.job_id = job_row.id
   and item.tenant_id = job_row.tenant_id
  where not item.is_excluded;

  select count(*)
    into assembly_source_count
  from pg_temp._atomic_takeoff_mapping_plan as plan
  join public.takeoff_items as item
    on item.id = plan.item_id
   and item.job_id = job_row.id
   and item.tenant_id = job_row.tenant_id
  where plan.action = 'apply_assembly'
    and item.exclusion_reason = 'Exclu par regle de mapping: apply_assembly';

  if raw_output_count = 0 and assembly_source_count = 0 then
    raise exception 'APPLY_NO_INCLUDABLE_ITEMS' using errcode = '22023';
  end if;

  if target_engine_version = 3 then
    -- M2 v0.1 : toute écriture de cette application dans une v3 (suppression du remplacement, lignes,
    -- prix, catégories, ouvrages) se fait sous le contrat d'écrivain de cette version, comme les
    -- entrées par modèle et par ouvrage (20261017225906).
    previous_v3_writer := coalesce(current_setting('miaouffrage.estimate_v3_writer', true), '');
    perform set_config('miaouffrage.estimate_v3_writer', job_row.estimate_version_id::text, true);
  end if;

  legacy_strategy := normalized_strategy;
  if normalized_strategy = 'replace' then
    with recursive descendants as (
      select root.id
      from public.estimate_items as root
      where root.id = p_target_section_id
        and root.version_id = job_row.estimate_version_id
        and root.tenant_id = job_row.tenant_id
      union all
      select child.id
      from public.estimate_items as child
      join descendants as parent on parent.id = child.parent_id
      where child.version_id = job_row.estimate_version_id
        and child.tenant_id = job_row.tenant_id
    )
    delete from public.estimate_items as item
    using descendants
    where item.id = descendants.id
      and item.id <> p_target_section_id
      and item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id;

    legacy_strategy := 'append';
  end if;

  drop table if exists pg_temp._atomic_takeoff_created_ids;
  create temporary table _atomic_takeoff_created_ids (
    id uuid primary key
  ) on commit drop;

  drop table if exists pg_temp._atomic_takeoff_line_map;
  create temporary table _atomic_takeoff_line_map (
    takeoff_item_id uuid primary key,
    estimate_item_id uuid not null unique
  ) on commit drop;

  if target_engine_version = 3 then
    -- M2 v0.1 : lignes v3 par private.takeoff_apply_v3_lines (unité par le référentiel partagé,
    -- provenance et item de métré écrits sur la ligne). Aucun montant ici : ils viennent du moteur 3
    -- en fin de transaction.
    select count(*)::integer
      into legacy_ignored_count
    from public.takeoff_items as item
    where item.job_id = job_row.id
      and item.tenant_id = job_row.tenant_id
      and item.is_excluded;

    drop table if exists pg_temp._atomic_takeoff_v3_lines;
    create temporary table _atomic_takeoff_v3_lines
    on commit drop
    as
    select line.takeoff_item_id, line.estimate_item_id, line.created
    from private.takeoff_apply_v3_lines(
      job_row.id,
      legacy_strategy,
      p_target_section_id
    ) as line;

    insert into pg_temp._atomic_takeoff_created_ids (id)
    select line.estimate_item_id
    from pg_temp._atomic_takeoff_v3_lines as line
    where line.created
    on conflict do nothing;

    insert into pg_temp._atomic_takeoff_line_map (
      takeoff_item_id,
      estimate_item_id
    )
    select line.takeoff_item_id, line.estimate_item_id
    from pg_temp._atomic_takeoff_v3_lines as line;

    select count(*)::integer
      into legacy_updated_count
    from pg_temp._atomic_takeoff_v3_lines as line
    where not line.created;

    update public.estimate_versions as version
    set updated_at = statement_timestamp()
    where version.id = job_row.estimate_version_id
      and version.tenant_id = job_row.tenant_id;

    update public.takeoff_jobs as job
    set
      status = 'applied'::public.takeoff_job_status,
      completed_at = coalesce(job.completed_at, statement_timestamp()),
      updated_at = statement_timestamp()
    where job.id = job_row.id
      and job.tenant_id = job_row.tenant_id;
  else
    select
      result.created_count,
      result.updated_count,
      result.ignored_count,
      result.created_ids,
      result.scope
      into
        legacy_created_count,
        legacy_updated_count,
        legacy_ignored_count,
        legacy_created_ids,
        legacy_scope
    from public.apply_takeoff_job(
      p_job_id,
      legacy_strategy,
      p_target_section_id
    ) as result;

    insert into pg_temp._atomic_takeoff_created_ids (id)
    select id
    from unnest(coalesce(legacy_created_ids, '{}'::uuid[])) as created(id)
    on conflict do nothing;

    insert into pg_temp._atomic_takeoff_line_map (
      takeoff_item_id,
      estimate_item_id
    )
    with source_ranked as (
      select
        plan.item_id,
        lower(regexp_replace(plan.designation, '\\s+', ' ', 'g'))
          as normalized_title,
        lower(regexp_replace(coalesce(item.unit, ''), '\\s+', ' ', 'g'))
          as normalized_description,
        row_number() over (
          partition by
            lower(regexp_replace(plan.designation, '\\s+', ' ', 'g')),
            lower(regexp_replace(coalesce(item.unit, ''), '\\s+', ' ', 'g'))
          order by plan.source_order, plan.item_id
        ) as match_rank
      from pg_temp._atomic_takeoff_mapping_plan as plan
      join public.takeoff_items as item
        on item.id = plan.item_id
       and item.job_id = job_row.id
       and item.tenant_id = job_row.tenant_id
      where not item.is_excluded
    ), estimate_ranked as (
      select
        item.id,
        lower(regexp_replace(btrim(item.title), '\\s+', ' ', 'g'))
          as normalized_title,
        lower(regexp_replace(coalesce(btrim(item.description), ''), '\\s+', ' ', 'g'))
          as normalized_description,
        row_number() over (
          partition by
            lower(regexp_replace(btrim(item.title), '\\s+', ' ', 'g')),
            lower(regexp_replace(coalesce(btrim(item.description), ''), '\\s+', ' ', 'g'))
          order by item.position, item.id
        ) as match_rank
      from public.estimate_items as item
      where item.version_id = job_row.estimate_version_id
        and item.tenant_id = job_row.tenant_id
        and item.item_type = 'line'::public.estimate_item_type
        and item.parent_id is not distinct from p_target_section_id
        and item.source_job_id = job_row.id
    )
    select source.item_id, estimate.id
    from source_ranked as source
    join estimate_ranked as estimate
      on estimate.normalized_title = source.normalized_title
     and estimate.normalized_description = source.normalized_description
     and estimate.match_rank = source.match_rank;
  end if;

  select count(*)
    into mapped_line_count
  from pg_temp._atomic_takeoff_line_map;

  if mapped_line_count <> raw_output_count then
    raise exception 'TAKEOFF_ATOMIC_LINE_MAPPING_FAILED' using errcode = '40001';
  end if;

  update public.estimate_items as item
  set
    unit_price_ht_cents = plan.unit_price_cents,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_line_map as line_map
  join pg_temp._atomic_takeoff_mapping_plan as plan
    on plan.item_id = line_map.takeoff_item_id
  where item.id = line_map.estimate_item_id
    and item.version_id = job_row.estimate_version_id
    and item.tenant_id = job_row.tenant_id
    and plan.action = 'set_price';

  update public.estimate_items as item
  set
    category_id = plan.category_id,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_line_map as line_map
  join pg_temp._atomic_takeoff_mapping_plan as plan
    on plan.item_id = line_map.takeoff_item_id
  where item.id = line_map.estimate_item_id
    and item.version_id = job_row.estimate_version_id
    and item.tenant_id = job_row.tenant_id
    and plan.action = 'set_category';

  for mapping_row in
    select
      plan.item_id,
      plan.assembly_id,
      item.source_file_name,
      item.source_page
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where plan.action = 'apply_assembly'
      and item.exclusion_reason = 'Exclu par regle de mapping: apply_assembly'
    order by plan.source_order
  loop
    select coalesce(max(item.position), 0) + 1
      into assembly_position
    from public.estimate_items as item
    where item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id
      and item.parent_id is not distinct from p_target_section_id;

    select coalesce(array_agg(inserted.id), '{}'::uuid[])
      into assembly_item_ids
    from public.materialize_estimate_assembly_tree(
      job_row.estimate_version_id,
      mapping_row.assembly_id,
      p_target_section_id,
      assembly_position,
      1,
      0
    ) as inserted;

    if coalesce(cardinality(assembly_item_ids), 0) = 0 then
      raise exception 'TAKEOFF_MAPPING_ASSEMBLY_INSERT_FAILED'
        using errcode = 'P0001';
    end if;

    insert into pg_temp._atomic_takeoff_created_ids (id)
    select id from unnest(assembly_item_ids) as created(id)
    on conflict do nothing;

    update public.estimate_items as item
    set
      source_provider = 'takeoff',
      source_job_id = job_row.id,
      source_file_name = mapping_row.source_file_name,
      source_page = mapping_row.source_page,
      source_metadata = coalesce(item.source_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'takeoff_item_id', mapping_row.item_id,
          'mapping_action', 'apply_assembly',
          'assembly_id', mapping_row.assembly_id
        ),
      updated_at = statement_timestamp()
    where item.id = any(assembly_item_ids)
      and item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id;
  end loop;

  if target_engine_version = 3 then
    -- M2 v0.1 : unités des lignes d'ouvrage, montants du moteur 3 sur toutes les lignes et sur la
    -- version, puis leur assertion (private.estimate_v3_assert_draft) ; jamais le recalcul historique.
    perform public.estimate_v3_complete_entry_for_writer(
      job_row.estimate_version_id,
      coalesce(
        (select array_agg(created.id) from pg_temp._atomic_takeoff_created_ids as created),
        '{}'::uuid[]
      )
    );
    perform set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);
  else
    perform public.recalculate_takeoff_estimate_version(
      job_row.estimate_version_id,
      job_row.tenant_id
    );
  end if;

  return query
  select
    (select count(*)::integer from pg_temp._atomic_takeoff_created_ids),
    legacy_updated_count,
    greatest(legacy_ignored_count - assembly_source_count, 0),
    coalesce(
      (
        select array_agg(created.id order by created.id)
        from pg_temp._atomic_takeoff_created_ids as created
      ),
      '{}'::uuid[]
    ),
    case
      when p_target_section_id is null then 'version'
      else 'section'
    end,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'takeoff_item_id', line_map.takeoff_item_id,
            'estimate_item_id', line_map.estimate_item_id
          )
          order by line_map.takeoff_item_id
        )
        from pg_temp._atomic_takeoff_line_map as line_map
      ),
      '[]'::jsonb
    );
end;
$$;

revoke all on function public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

comment on function public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb) is
  'Atomic takeoff apply behind public.apply_takeoff_job_guarded_atomic: mapping plan checks and actions, then engine 1/2 lines through public.apply_takeoff_job and the historical recalculation, or engine 3 lines (draft only) through private.takeoff_apply_v3_lines and public.estimate_v3_complete_entry_for_writer under the v3 writer contract (M2 v0.1).';

commit;
