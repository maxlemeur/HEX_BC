-- Lot 3.2, entrée 2 (P-14, D-g) : la structure IA s'applique à un brouillon du moteur 3.
--
-- Avant : public.apply_estimate_structure_draft insérait et renommait les sections hors du contrat d'écrivain
-- v3 ; sur une v3 la première écriture échouait (ESTIMATE_V3_WRITER_NOT_SUPPORTED) et le serveur refusait la
-- structure IA par son nom avant tout appel (ESTIMATE_ENGINE_UNAVAILABLE, sous-lot 2.8).
--
-- Après : la fonction lit le moteur de la version sous son verrou. Pour une v3, elle pose le contrat d'écrivain
-- de cette version, écrit les mêmes sections et renommages, puis appelle public.estimate_v3_complete_entry_for_writer
-- (montants du moteur 3 sur la version, assertion du brouillon), comme les entrées par modèle et par ouvrage
-- (20261017225906) et par métré (20261025134000). Sections, provenance de la structure, passage de la preview à
-- « applied » et contenu restent dans la même transaction. Une structure IA ne crée que des sections : les totaux
-- ne changent pas.
-- Copié de 20260306200000, seules les lignes marquées « Lot 3.2 entrée 2 » changent ; v1 et v2 gardent exactement
-- leur chemin. CREATE OR REPLACE conserve propriétaire et droits ; aucune donnée existante n'est réécrite.
-- Régression : supabase/tests/database/estimate-structure-draft-engine-v3.test.sql ; parcours IO08
-- (e2e/army/local/engine-v3-import-optima.e2e.ts).
begin;

do $preflight$
begin
  if to_regprocedure('public.apply_estimate_structure_draft(uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamptz)') is null
    or to_regprocedure('public.estimate_v3_complete_entry_for_writer(uuid,uuid[])') is null
  then
    raise exception 'LOT3_2_ENTRY2_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create or replace function public.apply_estimate_structure_draft(
  p_draft_id uuid,
  p_target_version_id uuid,
  p_applied_by uuid,
  p_created_items jsonb default '[]'::jsonb,
  p_updated_items jsonb default '[]'::jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_applied_at timestamptz default now()
)
returns table (
  created_count integer,
  updated_count integer,
  application_count integer
)
language plpgsql
set search_path = public
as $$
declare
  v_current_tenant_id uuid := public.current_tenant_id();
  v_expected_updated_count integer := 0;
  v_expected_application_count integer := 0;
  -- Lot 3.2 entrée 2 : moteur de la version cible et contrat d'écrivain v3.
  v_target_version public.estimate_versions%rowtype;
  v_is_v3 boolean := false;
  v_previous_v3_writer text := '';
  v_created_ids uuid[] := '{}';
begin
  if p_draft_id is null then
    raise exception 'p_draft_id is required';
  end if;

  if p_target_version_id is null then
    raise exception 'p_target_version_id is required';
  end if;

  if v_current_tenant_id is null then
    raise exception 'tenant context is required';
  end if;

  perform 1
  from public.estimate_structure_drafts d
  where d.id = p_draft_id
    and d.tenant_id = v_current_tenant_id
    and d.target_version_id = p_target_version_id
  for update;

  if not found then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_NOT_FOUND';
  end if;

  perform 1
  from public.estimate_structure_drafts d
  where d.id = p_draft_id
    and d.tenant_id = v_current_tenant_id
    and d.target_version_id = p_target_version_id
    and d.status = 'pending';

  if not found then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING';
  end if;

  select ev.*
    into v_target_version
  from public.estimate_versions ev
  where ev.id = p_target_version_id
    and ev.tenant_id = v_current_tenant_id
  for update;

  if not found then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_VERSION_NOT_FOUND';
  end if;

  -- Lot 3.2 entrée 2 : une v3 est écrite sous le contrat d'écrivain de cette version, comme les entrées
  -- par modèle, par ouvrage et par métré ; ses montants viennent du moteur 3 en fin de transaction.
  v_is_v3 := v_target_version.calc_engine_version = 3;
  if v_is_v3 then
    -- Seul un brouillon reçoit une structure : une fusion sans renommage n'écrit aucun élément, donc aucun
    -- déclencheur ne le vérifierait ; refus nommé comme toute écriture d'une version figée.
    if v_target_version.status is distinct from 'draft'::public.estimate_status then
      raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_READ_ONLY';
    end if;
    v_previous_v3_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', p_target_version_id::text, true);
  end if;

  with inserted as (
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      h_mo_majoration,
      k_mo_atelier,
      k_mo_chantier,
      selected_supplier_price_id
    )
    select
      payload.id,
      v_current_tenant_id,
      p_target_version_id,
      payload.parent_id,
      'section',
      payload.position,
      payload.title,
      payload.source_provider,
      payload.source_job_id,
      payload.source_file_name,
      payload.source_page,
      1,
      1,
      1,
      null
    from jsonb_to_recordset(coalesce(p_created_items, '[]'::jsonb)) as payload(
      id uuid,
      parent_id uuid,
      item_type text,
      position integer,
      title text,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer
    )
    returning id
  )
  -- Lot 3.2 entrée 2 : les sections créées, pour le moteur 3.
  select count(*), coalesce(array_agg(inserted.id), '{}'::uuid[])
    into created_count, v_created_ids
  from inserted;

  with update_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_updated_items, '[]'::jsonb)) as payload(
      id uuid,
      title text,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer
    )
  ),
  updated as (
    update public.estimate_items ei
    set
      title = payload.title,
      source_provider = payload.source_provider,
      source_job_id = payload.source_job_id,
      source_file_name = payload.source_file_name,
      source_page = payload.source_page
    from update_payload payload
    where ei.id = payload.id
      and ei.tenant_id = v_current_tenant_id
      and ei.version_id = p_target_version_id
      and ei.item_type = 'section'
    returning 1
  )
  select
    (select count(*) from update_payload),
    (select count(*) from updated)
  into v_expected_updated_count, updated_count;

  if updated_count <> v_expected_updated_count then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_TARGET_ITEM_NOT_FOUND';
  end if;

  with application_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_application_rows, '[]'::jsonb)) as payload(
      tenant_id uuid,
      draft_id uuid,
      draft_node_id uuid,
      target_version_id uuid,
      estimate_item_id uuid,
      applied_action text,
      applied_by uuid
    )
  ),
  inserted_applications as (
    insert into public.estimate_structure_draft_applications (
      tenant_id,
      draft_id,
      draft_node_id,
      target_version_id,
      estimate_item_id,
      applied_action,
      applied_by
    )
    select
      v_current_tenant_id,
      p_draft_id,
      payload.draft_node_id,
      p_target_version_id,
      payload.estimate_item_id,
      payload.applied_action,
      coalesce(payload.applied_by, p_applied_by)
    from application_payload payload
    returning 1
  )
  select
    (select count(*) from application_payload),
    (select count(*) from inserted_applications)
  into v_expected_application_count, application_count;

  if application_count <> v_expected_application_count then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_APPLICATION_INSERT_FAILED';
  end if;

  -- Lot 3.2 entrée 2 : montants du moteur 3 sur la version et leur assertion, puis fin du contrat.
  if v_is_v3 then
    perform public.estimate_v3_complete_entry_for_writer(p_target_version_id, v_created_ids);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', v_previous_v3_writer, true);
  end if;

  update public.estimate_structure_drafts
  set
    status = 'applied',
    applied_at = coalesce(p_applied_at, now()),
    updated_at = now()
  where id = p_draft_id
    and tenant_id = v_current_tenant_id;

  return query
  select
    created_count,
    updated_count,
    application_count;
end;
$$;

comment on function public.apply_estimate_structure_draft(uuid, uuid, uuid, jsonb, jsonb, jsonb, timestamptz) is
  'Atomic AI structure apply: sections created and renamed, structure provenance rows, preview marked applied. On an engine 3 draft, under the v3 writer contract with public.estimate_v3_complete_entry_for_writer (lot 3.2, entry 2).';

commit;
