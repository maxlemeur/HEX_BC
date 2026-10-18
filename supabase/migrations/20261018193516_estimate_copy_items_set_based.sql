-- Copies into a v1/v2 draft in one set-based statement. Contract, failure modes and proofs:
-- docs/testing/copy-large-v2.md.
--
-- Observed (owned native stack, 1 000 items, EXPLAIN ANALYZE as authenticated): the three copies of the estimate API
-- (duplicate a section, import sections from another version, import the linked DPGF) inserted their items with one
-- PostgREST insert, so every item checked the insert policy and ran the per-item triggers under the API roles' RLS.
-- The hierarchy depth guard (security invoker) walks the parents through the select policy of estimate_items: 14,5 s
-- of 16,3 s into an empty draft, 1,9 s of 3,6 s in place, with 2 016 000 and 18 000 is_tenant_member calls. The
-- content revision bump with its audit row, the item audit row and the source coverage lookup add 0,1-0,4 s each.
-- About 1 000 items exceeded the 8 s statement_timeout of the API roles (57014): the copy answered 400 and wrote
-- nothing. Under the creation contract (20261018013249) the same insert as authenticated still took ~610 ms (the
-- remaining invoker guards evaluate the policies per row); without RLS it takes ~65 ms, plus ~100 ms for the replay.
--
-- public.copy_estimate_items_atomic(version, draft lock session, items):
-- 1. Security definer, called by the authenticated user (auth.uid() still names the actor, so every audit row keeps
--    its user). It checks once what the insert policy of estimate_items checked per row: the version exists and is a
--    draft, the actor is a member of its active tenant with the admin or engineer role, and owns its affaire unless
--    admin (is_tenant_member and has_tenant_role keep the platform admin exception of the policy). It also holds the
--    actor's live draft lock lease of that page session until it commits, as the batch writer does (a takeover in
--    flight is a refusal, the renewal of the lease is not blocked).
-- 2. Engine 1 and 2 only: a v3 is written through public.commit_estimate_batch (estimate_v3_writer contract).
-- 3. Every item carries the complete copied row (the keys below, nothing else, tenant_id and version_id only when
--    they are those of the version): the stored row is the one the PostgREST insert stored, without column defaults
--    to infer. Ids are unique, a parent inside the payload comes before its children.
-- 4. Under miaouffrage.estimate_creation_atomic bound to the version, the per-item triggers (content revision,
--    audit, source coverage, depth) leave the items to public.estimate_creation_replay_item_effects_for_writer, which
--    replays them in payload order with the same checks and the same rows: the depth of each item over its parents,
--    those already in the draft included (the walk bounded by greatest(item_count, max_section_depth) since
--    20261018180306, which the preflight requires), one content revision step and one version audit row per item,
--    one item audit row per item and the coverage invalidation. The other per-row triggers, constraints and foreign
--    keys run unchanged. The previous contract value is restored.
-- Known difference: a payload carrying two different refusals may report another one first (as for the creation).
-- No trigger or existing function changes. No existing row is rewritten.
begin;

do $preflight$
begin
  if to_regprocedure('public.estimate_creation_replay_item_effects_for_writer(uuid, uuid[])') is null
    or position('parent_chain.depth <= greatest(item_count, target_max_depth)' in (select procedure.prosrc
      from pg_catalog.pg_proc procedure
      where procedure.oid = to_regprocedure('public.estimate_creation_replay_item_effects_for_writer(uuid, uuid[])'))) = 0
    or to_regprocedure('public.is_tenant_member(uuid)') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'draft_locks' and column_name = 'session_id') then
    raise exception 'ESTIMATE_COPY_ITEMS_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create function public.copy_estimate_items_atomic(
  p_version_id uuid,
  p_draft_lock_session_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  copied_keys constant text[] := array[
    'id', 'parent_id', 'item_type', 'position', 'title', 'aid', 'description', 'quantity', 'unit_price_ht_cents',
    'tax_rate_bp', 'k_fo', 'h_mo', 'h_mo_majoration', 'k_mo', 'h_mo_atelier', 'k_mo_atelier', 'labor_role_atelier_id',
    'h_mo_chantier', 'k_mo_chantier', 'labor_role_chantier_id', 'pu_ht_cents', 'labor_role_id', 'category_id',
    'supply_type_id', 'selected_supplier_price_id', 'source_provider', 'source_job_id', 'source_file_name',
    'source_page', 'source_metadata', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents'
  ];
  target_tenant_id uuid;
  target_status public.estimate_status;
  target_engine smallint;
  project_owner_id uuid;
  lease_held boolean;
  item_ids uuid[];
  previous_contract text;
  result_version jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'ESTIMATE_COPY_FORBIDDEN';
  end if;

  -- The insert policy of estimate_items, checked once for the copy instead of once per item.
  select version.tenant_id, project.user_id
    into target_tenant_id, project_owner_id
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id
  where version.id = p_version_id;

  if target_tenant_id is null
    or not public.is_tenant_member(target_tenant_id)
    or not public.has_tenant_role(target_tenant_id, array['admin', 'engineer']::public.tenant_role[])
    or not (
      project_owner_id = actor_id
      or public.has_tenant_role(target_tenant_id, array['admin']::public.tenant_role[])
    )
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_COPY_FORBIDDEN';
  end if;

  select version.status, version.calc_engine_version
    into target_status, target_engine
  from public.estimate_versions version
  where version.id = p_version_id
  for update;

  if target_status is distinct from 'draft'::public.estimate_status then
    raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_READ_ONLY';
  end if;

  if target_engine is not distinct from 3 then
    raise exception using errcode = '0A000', message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  -- The lease stays this page's until the copy commits. KEY SHARE blocks a takeover (delete then insert) but not the
  -- renewal of the lease (an update of expires_at); NOWAIT turns a takeover in flight into a refusal, never a
  -- deadlock with the version lock above (the takeover's insert checks its foreign key on the version).
  begin
    perform 1
    from public.draft_locks lock
    where lock.version_id = p_version_id
      and lock.tenant_id = target_tenant_id
      and lock.user_id = actor_id
      and p_draft_lock_session_id is not null
      and lock.session_id = p_draft_lock_session_id
      and lock.expires_at > pg_catalog.clock_timestamp()
    for key share nowait;
    lease_held := found;
  exception when lock_not_available then
    lease_held := false;
  end;

  if not lease_held then
    raise exception using errcode = '55000', message = 'ESTIMATE_COPY_LOCK_REQUIRED';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) = 0
    or exists (
      select 1
      from jsonb_array_elements(p_items) as entry(value)
      where jsonb_typeof(entry.value) is distinct from 'object'
        or not (entry.value ?& copied_keys)
        or entry.value - copied_keys - array['tenant_id', 'version_id'] <> '{}'::jsonb
        or (entry.value ? 'tenant_id' and lower(entry.value->>'tenant_id') is distinct from target_tenant_id::text)
        or (entry.value ? 'version_id' and lower(entry.value->>'version_id') is distinct from p_version_id::text)
        or jsonb_typeof(entry.value->'id') is distinct from 'string'
        or entry.value->>'item_type' not in ('section', 'line')
    )
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_COPY_ITEMS_INVALID';
  end if;

  -- Ids are unique, and a parent copied with its children precedes them, as each row saw it when inserted alone.
  if exists (
    with payload_item as (
      select entry.ordinality, (entry.value->>'id')::uuid as id, (entry.value->>'parent_id')::uuid as parent_id
      from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
    )
    select 1
    from payload_item child
    join payload_item parent on parent.id = child.parent_id
    where parent.ordinality >= child.ordinality
    union all
    select 1 from payload_item group by payload_item.id having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'ESTIMATE_COPY_ITEMS_INVALID';
  end if;

  item_ids := array(
    select (entry.value->>'id')::uuid
    from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
    order by entry.ordinality
  );

  previous_contract := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', p_version_id::text, true);

  insert into public.estimate_items (
    id, tenant_id, version_id, parent_id, item_type, position, title, aid, description, quantity,
    unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, h_mo_atelier, k_mo_atelier,
    labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id, pu_ht_cents, labor_role_id,
    category_id, supply_type_id, selected_supplier_price_id, source_provider, source_job_id, source_file_name,
    source_page, source_metadata, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
  )
  select
    item.id, target_tenant_id, p_version_id, item.parent_id, item.item_type, item.position, item.title, item.aid,
    item.description, item.quantity, item.unit_price_ht_cents, item.tax_rate_bp, item.k_fo, item.h_mo,
    item.h_mo_majoration, item.k_mo, item.h_mo_atelier, item.k_mo_atelier, item.labor_role_atelier_id,
    item.h_mo_chantier, item.k_mo_chantier, item.labor_role_chantier_id, item.pu_ht_cents, item.labor_role_id,
    item.category_id, item.supply_type_id, item.selected_supplier_price_id, item.source_provider, item.source_job_id,
    item.source_file_name, item.source_page, item.source_metadata, item.line_total_ht_cents, item.line_tax_cents,
    item.line_total_ttc_cents
  from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
  -- jsonb_populate_record applies the column types and typmods, as the PostgREST insert did.
  cross join lateral jsonb_populate_record(null::public.estimate_items, entry.value) as item
  order by entry.ordinality;

  -- Depth (over the stored ancestors too), one content revision step per item, the audit rows and the coverage
  -- invalidation, in payload order; the replay then clears the contract.
  perform public.estimate_creation_replay_item_effects_for_writer(p_version_id, item_ids);
  perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', previous_contract, true);

  select jsonb_build_object('id', version.id, 'updated_at', version.updated_at,
    'content_revision', version.content_revision)
    into result_version
  from public.estimate_versions version
  where version.id = p_version_id;

  return jsonb_build_object('version', result_version, 'item_count', cardinality(item_ids));
end;
$$;

comment on function public.copy_estimate_items_atomic(uuid, uuid, jsonb) is
  'Copies items into a v1/v2 draft in one statement: the insert policy and the draft lock lease are checked once, the per-item effects (depth, content revision, audit, source coverage) are replayed set-based with the same results. docs/testing/copy-large-v2.md.';

revoke all on function public.copy_estimate_items_atomic(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.copy_estimate_items_atomic(uuid, uuid, jsonb) to authenticated;

commit;
