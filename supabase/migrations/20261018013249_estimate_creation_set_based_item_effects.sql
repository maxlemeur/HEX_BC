-- Lot 2, sub-lot 2.8 (M8): the atomic creation of a version replays the per-line effects of its items in
-- one pass. A complete OPTIMA lot (1 021 items) fired, per line, a content revision update of the version
-- with its audit row, an audit row for the item, a source coverage lookup and a hierarchy walk, and
-- exceeded the 8 s statement timeout of the API roles in CI (IO01). Contract, failure modes and proofs:
-- docs/testing/estimate-engine-v3-2.8.md, « Création atomique ».
--
-- 1. persist_estimate_creation_atomic sets miaouffrage.estimate_creation_atomic to the id of the version
--    it creates around the insert of its items (set_config local, previous value restored), then calls
--    public.estimate_creation_replay_item_effects_for_writer with the item ids in payload order.
-- 2. Under that contract, and only for the insert of an item of that version, the four per-line triggers
--    (bump_estimate_content_revision_from_item, log_estimate_audit, private.source_coverage_invalidate,
--    validate_estimate_item_hierarchy_depth) return at once. Any other version, any update or delete,
--    and any other writer keep them.
-- 3. The replay, in the order of the per-line triggers: the hierarchy depth of each item (same checks and
--    messages, first failing item in payload order); one content revision step per item (same draft
--    check, one update of + N, which guard_estimate_version_workflow_columns admits only upward, on a
--    draft, with miaouffrage.estimate_creation_replay and the creation contract both bound to that
--    version); one audit row per revision step and per item insert, with the values log_estimate_audit
--    wrote; the source coverage invalidation, replayed item by item when a requirement is scoped to or
--    linked with one of the items. The replay then closes the contract: one replay per creation.
-- Known difference: when a payload carries two different refusals (a depth refusal and a refusal of a
-- later line by another trigger or constraint), the refusal reported may differ. An accepted creation
-- stores the same rows, revisions, audit rows and coverage revisions.
-- Each function is copied from its latest definition (20260311173500, 20260713132620, 20260304212000,
-- 20261011233527, 20261017162000) with only the lines above changed. CREATE OR REPLACE keeps owners and
-- ACLs. No existing row is rewritten.
begin;

do $preflight$
begin
  if to_regprocedure('public.persist_estimate_creation_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid)') is null
    or to_regprocedure('public.estimate_v3_assert_draft_for_writer(uuid)') is null
    or to_regprocedure('private.source_coverage_next(bigint)') is null
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'estimate_versions' and column_name = 'content_revision') then
    raise exception 'LOT2_2_8_M8_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

-- Bridge of the security invoker creation RPC (the private schema stays closed to service_role): it acts
-- only inside the creation contract of that version, which the RPC sets around the insert of its items.
create function public.estimate_creation_replay_item_effects_for_writer(
  p_version_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer := coalesce(cardinality(p_item_ids), 0);
  target_max_depth integer;
  target_status public.estimate_status;
  depth_row record;
  version_before jsonb;
  version_after jsonb;
  base_revision bigint;
  previous_replay text;
  version_user_id uuid;
  item_user_id uuid;
  replayed_item_id uuid;
  identities uuid[];
  descendants uuid[];
  affected uuid[];
  affected_requirement_id uuid;
begin
  if p_version_id is null
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') <> p_version_id::text
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_CREATION_REPLAY_OUTSIDE_CONTRACT';
  end if;

  if item_count = 0 then
    perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', '', true);
    return;
  end if;

  if (select count(distinct replayed.id) from unnest(p_item_ids) as replayed(id)) <> item_count
    or (
      select count(*)
      from public.estimate_items item
      where item.id = any(p_item_ids)
        and item.version_id = p_version_id
    ) <> item_count
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_CREATION_REPLAY_ITEMS_INVALID';
  end if;

  -- validate_estimate_item_hierarchy_depth, item by item in payload order. The creation payload puts
  -- every parent before its children, so the chain seen after the insert is the one each row saw.
  select coalesce(version.max_section_depth, 3)
    into target_max_depth
  from public.estimate_versions version
  where version.id = p_version_id;

  if target_max_depth is null then
    raise exception 'version_id invalide pour estimate_items';
  end if;

  for depth_row in
    with recursive replayed as (
      select item.id, item.parent_id, item.item_type, entry.ordinality
      from unnest(p_item_ids) with ordinality as entry(id, ordinality)
      join public.estimate_items item on item.id = entry.id
    ),
    parent_chain as (
      select replayed.id as origin_id, parent.id, parent.parent_id, parent.item_type, 1 as depth
      from replayed
      join public.estimate_items parent
        on parent.id = replayed.parent_id
       and parent.version_id = p_version_id
      union all
      select parent_chain.origin_id, parent.id, parent.parent_id, parent.item_type, parent_chain.depth + 1
      from parent_chain
      join public.estimate_items parent
        on parent.id = parent_chain.parent_id
       and parent.version_id = p_version_id
      where parent_chain.depth <= item_count
    )
    select
      replayed.ordinality,
      replayed.parent_id,
      replayed.item_type,
      coalesce(max(parent_chain.depth), 0) as parent_depth,
      coalesce(bool_or(parent_chain.item_type <> 'section'), false) as parent_has_invalid_type
    from replayed
    left join parent_chain on parent_chain.origin_id = replayed.id
    group by replayed.ordinality, replayed.parent_id, replayed.item_type
    order by replayed.ordinality
  loop
    if depth_row.parent_id is not null then
      if depth_row.parent_depth = 0 then
        raise exception 'parent_id invalide pour estimate_items';
      end if;

      if depth_row.parent_has_invalid_type then
        raise exception 'Le parent doit etre une section.';
      end if;
    end if;

    if depth_row.item_type = 'section' then
      if depth_row.parent_depth + 1 > target_max_depth then
        raise exception 'Profondeur de section depassee (max %).', target_max_depth;
      end if;
    elsif depth_row.parent_id is null then
      raise exception 'Une ligne doit etre rattachee a une section.';
    elsif depth_row.parent_depth > target_max_depth then
      raise exception
        'Une ligne ne peut pas etre rattachee au-dela du niveau %.',
        target_max_depth;
    end if;
  end loop;

  -- bump_estimate_content_revision_from_item, once per item: the same checks, then one update.
  select version.status
    into target_status
  from public.estimate_versions version
  where version.id = p_version_id
  for update;

  if target_status is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  if target_status <> 'draft'::public.estimate_status then
    raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_READ_ONLY';
  end if;

  select to_jsonb(version.*)
    into version_before
  from public.estimate_versions version
  where version.id = p_version_id;
  base_revision := (version_before->>'content_revision')::bigint;

  previous_replay := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_replay', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', p_version_id::text, true);
  update public.estimate_versions version
  set content_revision = version.content_revision + item_count
  where version.id = p_version_id;
  perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', previous_replay, true);

  select to_jsonb(version.*)
    into version_after
  from public.estimate_versions version
  where version.id = p_version_id;

  -- log_estimate_audit for each revision step, then for the insert of the item, in the order the
  -- per-line triggers wrote them: the user of the request, else the owner of the project.
  version_user_id := coalesce(
    nullif(version_after->>'user_id', '')::uuid,
    nullif(version_before->>'user_id', '')::uuid,
    nullif(version_after->>'created_by', '')::uuid,
    nullif(version_before->>'created_by', '')::uuid
  );
  if version_user_id is null and nullif(version_after->>'project_id', '') is not null then
    select project.user_id
      into version_user_id
    from public.estimate_projects project
    where project.id = (version_after->>'project_id')::uuid;
  end if;

  select project.user_id
    into item_user_id
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id
  where version.id = p_version_id;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  select
    replay.tenant_id,
    replay.user_id,
    replay.table_name,
    replay.record_id,
    replay.estimate_version_id,
    replay.action,
    replay.before_data,
    replay.after_data
  from (
    select
      step.ordinality,
      1 as kind,
      coalesce(
        nullif(version_after->>'tenant_id', '')::uuid,
        nullif(version_before->>'tenant_id', '')::uuid,
        public.current_tenant_id()
      ) as tenant_id,
      coalesce((select auth.uid()), version_user_id) as user_id,
      'estimate_versions'::text as table_name,
      p_version_id as record_id,
      p_version_id as estimate_version_id,
      'UPDATE'::text as action,
      coalesce(
        pg_catalog.lag(step.after_data) over (order by step.ordinality),
        version_before
      ) as before_data,
      step.after_data
    from (
      select
        revision_step.ordinality,
        version_after || jsonb_build_object('content_revision', base_revision + revision_step.ordinality) as after_data
      from generate_series(1, item_count) as revision_step(ordinality)
    ) as step
    union all
    select
      entry.ordinality,
      2,
      coalesce(
        item.tenant_id,
        nullif(version_after->>'tenant_id', '')::uuid,
        public.current_tenant_id()
      ),
      coalesce(
        (select auth.uid()),
        nullif(item_row.value->>'user_id', '')::uuid,
        nullif(item_row.value->>'created_by', '')::uuid,
        item_user_id
      ),
      'estimate_items',
      item.id,
      item.version_id,
      'INSERT',
      null::jsonb,
      item_row.value
    from unnest(p_item_ids) with ordinality as entry(id, ordinality)
    join public.estimate_items item on item.id = entry.id
    cross join lateral (select to_jsonb(item.*) as value offset 0) as item_row
  ) as replay
  order by replay.ordinality, replay.kind;

  -- private.source_coverage_invalidate for each item insert: when a requirement is scoped to or linked
  -- with an item of this creation, the invalidation is replayed item by item as the trigger did. Every
  -- descendant of a new item is a new item: its parent is in the payload, checked above in this version.
  if exists (
      select 1
      from private.estimate_source_coverage_links link
      where link.item_id = any(p_item_ids)
    )
    or exists (
      select 1
      from private.estimate_source_coverage_requirements requirement
      join unnest(p_item_ids) as replayed(id)
        on (requirement.scope->>'dpgfLotId')::uuid = replayed.id
    )
  then
    foreach replayed_item_id in array p_item_ids loop
      identities := array[null::uuid, replayed_item_id];
      with recursive children as (
        select item.id
        from public.estimate_items item
        where item.id = any(identities)
        union
        select child.id
        from public.estimate_items child
        join children on child.parent_id = children.id
      )
      select array_agg(children.id) into descendants from children;
      identities := identities || coalesce(descendants, '{}');

      select array_agg(requirement.id order by requirement.id)
        into affected
      from private.estimate_source_coverage_requirements requirement
      where requirement.id in (
          select link.requirement_id
          from private.estimate_source_coverage_links link
          where link.item_id = any(identities)
        )
        or (requirement.scope->>'dpgfLotId')::uuid = any(identities);

      foreach affected_requirement_id in array coalesce(affected, '{}') loop
        update private.estimate_source_coverage_requirements requirement
        set technical_revision = private.source_coverage_next(requirement.technical_revision)
        where requirement.id = affected_requirement_id
          and exists (
            select 1
            from private.estimate_source_reviews review
            join public.estimate_versions version on version.id = review.version_id
            where review.id = requirement.review_id
          );
      end loop;
    end loop;
  end if;

  -- One replay per creation: a second call in the same transaction would bump and journal twice.
  perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', '', true);
end;
$$;

comment on function public.estimate_creation_replay_item_effects_for_writer(uuid, uuid[]) is
  'Lot 2, sub-lot 2.8 (M8): replays, under the creation contract of a version, the per-line effects of its inserted items (depth, content revision, audit, source coverage) in one pass and with the same results.';

revoke all on function public.estimate_creation_replay_item_effects_for_writer(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.estimate_creation_replay_item_effects_for_writer(uuid, uuid[]) to service_role;

-- Per-line triggers: unchanged outside the creation contract of their version.

create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb;
  target_old jsonb;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
  target_tenant_id uuid;
  target_action text := tg_op;
begin
  -- Lot 2, sub-lot 2.8 (M8): the atomic creation of a version journals the insertion of its items
  -- and its content revision steps itself, in one pass and with the same rows
  -- (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op = 'INSERT' and tg_table_name = 'estimate_items' then
    if new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') then
      return new;
    end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'estimate_versions' then
    if new.id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_replay', true), '')
      and new.id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '')
    then
      return new;
    end if;
  end if;

  target_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;

  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_new->>'estimate_version_id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_old->>'estimate_version_id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  if tg_op = 'DELETE' and target_version_id is not null then
    if not exists (
      select 1
      from public.estimate_versions v
      where v.id = target_version_id
    ) then
      target_version_id := null;
    end if;
  end if;

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid,
    nullif(target_new->>'created_by', '')::uuid,
    nullif(target_old->>'created_by', '')::uuid
  );

  target_tenant_id := coalesce(
    nullif(target_new->>'tenant_id', '')::uuid,
    nullif(target_old->>'tenant_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_version_events' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_record_id;
    end if;
  end if;

  if target_tenant_id is null then
    if target_version_id is not null then
      select v.tenant_id
        into target_tenant_id
      from public.estimate_versions v
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.tenant_id
        into target_tenant_id
      from public.estimate_projects p
      where p.id = target_record_id;
    elsif target_row_user_id is not null then
      select tm.tenant_id
        into target_tenant_id
      from public.tenant_memberships tm
      where tm.user_id = target_row_user_id
      order by tm.is_default desc, tm.created_at asc
      limit 1;
    end if;
  end if;

  if tg_table_name = 'estimate_versions'
    and tg_op = 'UPDATE'
    and coalesce(target_old->>'status', '') = 'draft'
    and coalesce(target_new->>'status', '') = 'sent'
  then
    target_action := 'seal';
  end if;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    coalesce(target_tenant_id, public.current_tenant_id()),
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    target_action,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.bump_estimate_content_revision_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_version_ids uuid[];
  target_status public.estimate_status;
begin
  -- Lot 2, sub-lot 2.8 (M8): the atomic creation of a version bumps the revision once per item
  -- itself, after its insert (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op = 'INSERT' then
    if new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') then
      return new;
    end if;
  end if;

  target_version_ids := case
    when tg_op = 'INSERT' then array[new.version_id]
    when tg_op = 'DELETE' then array[old.version_id]
    else array[old.version_id, new.version_id]
  end;

  if tg_op = 'UPDATE'
    and (to_jsonb(new) - 'updated_at') is not distinct from
      (to_jsonb(old) - 'updated_at')
  then
    return new;
  end if;

  -- Lock both parents in a stable order when an item is moved between versions.
  for target_version_id in
    select distinct candidate.version_id
    from unnest(target_version_ids) as candidate(version_id)
    where candidate.version_id is not null
    order by candidate.version_id
  loop
    target_status := null;
    select version.status
      into target_status
    from public.estimate_versions version
    where version.id = target_version_id
    for update;

    -- A cascading parent delete removes the version before its child rows.
    if target_status is null then
      if tg_op = 'DELETE' then
        continue;
      end if;
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_VERSION_NOT_FOUND';
    end if;

    if target_status <> 'draft'::public.estimate_status then
      raise exception
        using
          errcode = '42501',
          message = 'ESTIMATE_VERSION_READ_ONLY';
    end if;

    update public.estimate_versions version
    set content_revision = version.content_revision + 1
    where version.id = target_version_id;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.validate_estimate_item_hierarchy_depth()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_max_depth integer;
  parent_depth integer := 0;
  parent_has_invalid_type boolean := false;
  target_section_level integer := 1;
begin
  -- Lot 2, sub-lot 2.8 (M8): the atomic creation of a version checks the depth of its items itself,
  -- with the same messages (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op = 'INSERT' then
    if new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') then
      return new;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.parent_id is not distinct from new.parent_id
     and old.item_type is not distinct from new.item_type
     and old.version_id is not distinct from new.version_id
  then
    return new;
  end if;

  select coalesce(ev.max_section_depth, 3)
    into target_max_depth
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if target_max_depth is null then
    raise exception 'version_id invalide pour estimate_items';
  end if;

  if new.parent_id is not null then
    with recursive parent_chain as (
      select item.id, item.parent_id, item.item_type, 1 as depth
      from public.estimate_items item
      where item.id = new.parent_id
        and item.version_id = new.version_id
      union all
      select parent.id, parent.parent_id, parent.item_type, parent_chain.depth + 1
      from public.estimate_items parent
      join parent_chain on parent.id = parent_chain.parent_id
      where parent.version_id = new.version_id
    )
    select
      coalesce(max(parent_chain.depth), 0),
      coalesce(bool_or(parent_chain.item_type <> 'section'), false)
    into parent_depth, parent_has_invalid_type
    from parent_chain;

    if parent_depth = 0 then
      raise exception 'parent_id invalide pour estimate_items';
    end if;

    if parent_has_invalid_type then
      raise exception 'Le parent doit etre une section.';
    end if;
  end if;

  if new.item_type = 'section' then
    target_section_level := parent_depth + 1;
    if target_section_level > target_max_depth then
      raise exception 'Profondeur de section depassee (max %).', target_max_depth;
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception 'Une ligne doit etre rattachee a une section.';
  end if;

  if parent_depth > target_max_depth then
    raise exception
      'Une ligne ne peut pas etre rattachee au-dela du niveau %.',
      target_max_depth;
  end if;

  return new;
end;
$$;

create or replace function private.source_coverage_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
declare old_value jsonb; new_value jsonb; identities uuid[]; affected uuid[]; req uuid; descendants uuid[];
begin
  -- Lot 2, sub-lot 2.8 (M8): the atomic creation of a version replays this invalidation for its items
  -- (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op='INSERT' and tg_table_name='estimate_items' then
    if new.version_id::text=coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic',true),'') then return null; end if;
  end if;
  if tg_op<>'INSERT' then old_value:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_value:=to_jsonb(new); end if;
  if private.source_coverage_technical_row(tg_table_name,old_value) is not distinct from private.source_coverage_technical_row(tg_table_name,new_value) then return null; end if;
  identities:=array[(old_value->>'id')::uuid,(new_value->>'id')::uuid];
  if tg_table_name='estimate_source_coverage_dimensions' then
    select array_agg(id order by id) into affected from private.estimate_source_coverage_requirements where(scope->>'zoneId')::uuid=any(identities) or(scope->>'networkId')::uuid=any(identities);
  elsif tg_table_name='estimate_items' then
    with recursive children as(select id from public.estimate_items where id=any(identities) union select i.id from public.estimate_items i join children c on i.parent_id=c.id)
      select array_agg(id) into descendants from children;
    identities:=identities||coalesce(descendants,'{}');
    select array_agg(id order by id) into affected from private.estimate_source_coverage_requirements where id in(select requirement_id from private.estimate_source_coverage_links where item_id=any(identities)) or(scope->>'dpgfLotId')::uuid=any(identities);
  else
    select array_agg(distinct l.requirement_id order by l.requirement_id) into affected from private.estimate_source_coverage_links l
    where(tg_table_name='affaire_register_entries' and l.register_entry_id=any(identities))
      or(tg_table_name='estimate_generated_ouvrage_applications' and l.application_id=any(identities))
      or(tg_table_name='estimate_generated_ouvrage_work_snapshots' and l.snapshot_id=any(identities))
      or(tg_table_name='estimate_generated_ouvrage_candidates' and l.application_id in(select id from public.estimate_generated_ouvrage_applications where candidate_id=any(identities)))
      or(tg_table_name='estimate_generated_ouvrage_drafts' and l.application_id in(select id from public.estimate_generated_ouvrage_applications where draft_id=any(identities)));
  end if;
  -- Lock all affected requirements in the same order. Cascaded parent deletion
  -- can already have removed them; it must not prevent deleting a draft affaire.
  foreach req in array coalesce(affected,'{}') loop
    update private.estimate_source_coverage_requirements q set technical_revision=private.source_coverage_next(q.technical_revision)
      where q.id=req and exists(select 1 from private.estimate_source_reviews r join public.estimate_versions v on v.id=r.version_id where r.id=q.review_id);
  end loop;
  return null;
end $$;

create or replace function public.guard_estimate_version_workflow_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.calc_engine_version is distinct from old.calc_engine_version then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE';
  end if;

  if (
      new.calc_snapshot_content_revision is distinct from
        old.calc_snapshot_content_revision
      or new.calc_snapshot_context is distinct from old.calc_snapshot_context
    )
    and not (
      (
        current_user = 'service_role'
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) = 'on'
      )
      or (
        pg_trigger_depth() > 1
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_invalidation',
            true
          ),
          ''
        ) = 'on'
        and new.calc_snapshot_content_revision is null
        and new.calc_snapshot_context is null
      )
    )
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
  end if;

  if (
    new.status is distinct from old.status
    or new.seal_hash is distinct from old.seal_hash
  ) and current_user <> 'service_role' then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  -- Lot 2, sub-lot 2.8 (M8): only the replay of the atomic creation of this draft raises its revision
  -- directly, once for all its items.
  if new.content_revision is distinct from old.content_revision
    and pg_trigger_depth() = 1
    and not (
      new.id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_replay', true), '')
      and new.id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '')
      and old.status = 'draft'::public.estimate_status
      and new.content_revision > old.content_revision
    )
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_CONTENT_REVISION_IS_MANAGED';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.version_number is distinct from old.version_number
    or new.title is distinct from old.title
    or new.exclusions is distinct from old.exclusions
    or new.date_devis is distinct from old.date_devis
    or new.validite_jours is distinct from old.validite_jours
    or new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.currency is distinct from old.currency
    or new.margin_bp is distinct from old.margin_bp
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_amount_cents is distinct from old.discount_amount_cents
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.global_coefficient is distinct from old.global_coefficient
    or new.max_section_depth is distinct from old.max_section_depth
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or (
      new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
      and current_user = 'service_role'
      and old.status = 'draft'
      and new.status = 'draft'
      and coalesce(
        pg_catalog.current_setting('miaouffrage.estimate_settings_atomic', true),
        ''
      ) = new.id::text
    )
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.parent_version_id is distinct from old.parent_version_id
    or new.variant_label is distinct from old.variant_label
    or new.calc_engine_version is distinct from old.calc_engine_version
    or new.contractor_role is distinct from old.contractor_role
    or new.calc_snapshot_context is distinct from old.calc_snapshot_context
    or new.sale_coefficient_fo is distinct from old.sale_coefficient_fo
    or new.sale_coefficient_mo is distinct from old.sale_coefficient_mo
    or new.gross_ht_cents is distinct from old.gross_ht_cents
    or new.discount_applied_cents is distinct from old.discount_applied_cents
    or new.commercial_rounding_cents is distinct from old.commercial_rounding_cents
  then
    new.content_revision := old.content_revision + 1;
  end if;

  return new;
end;
$$;

create or replace function public.persist_estimate_creation_atomic(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_project_payload jsonb,
  p_version_payload jsonb,
  p_items jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_user_id uuid := p_actor_user_id;
  actor_role public.tenant_role;
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  import_row public.dpgf_imports%rowtype;
  import_claimed_rows integer := 0;
  item_total_ht bigint := 0;
  item_total_tax bigint := 0;
  item_total_ttc bigint := 0;
  next_version_number integer;
  version_contractor_role text;
  previous_insert_contract text;
  policy_row public.tenant_calc_policies%rowtype;
  policy_engine smallint;
  creates_v3 boolean;
  previous_v3_writer text;
  previous_creation_contract text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select membership.role
    into actor_role
  from public.tenant_memberships membership
  join public.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.is_active
  where membership.tenant_id = p_tenant_id
    and membership.user_id = actor_user_id;

  if actor_user_id is null
    or p_tenant_id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CREATION_ROLE_REQUIRED';
  end if;

  if p_version_payload is null
    or jsonb_typeof(p_version_payload) <> 'object'
    or p_version_payload - array[
      'id',
      'title',
      'date_devis',
      'validite_jours',
      'margin_multiplier',
      'margin_mode',
      'currency',
      'margin_bp',
      'discount_bp',
      'discount_amount_cents',
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'calc_engine_version',
      'contractor_role',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents',
      'sale_coefficient_fo',
      'sale_coefficient_mo',
      'gross_ht_cents',
      'discount_applied_cents',
      'commercial_rounding_cents'
    ] <> '{}'::jsonb
    or coalesce(
      (p_version_payload->>'calc_engine_version')::smallint,
      2
    ) not in (1, 2, 3)
    or coalesce(
      nullif(btrim(p_version_payload->>'contractor_role'), ''),
      'principal'
    ) not in ('principal', 'subcontractor')
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  -- Lot 2, sub-lot 2.5 (D3): the engine is decided by the tenant policy, never by the
  -- client, which only states the engine its projections expect (absent = 2).
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant_id::text, 0)
  );
  select policy.*
    into policy_row
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant_id
  for share;
  policy_engine := coalesce(policy_row.new_estimate_calc_engine, 2);
  if coalesce((p_version_payload->>'calc_engine_version')::smallint, 2) <> policy_engine then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_CALC_POLICY_CONTEXT_CHANGED';
  end if;
  creates_v3 := policy_engine = 3;

  if not creates_v3
    and exists (
      select 1
      from jsonb_each(p_version_payload) entry
      where entry.key in (
          'sale_coefficient_fo', 'sale_coefficient_mo', 'gross_ht_cents',
          'discount_applied_cents', 'commercial_rounding_cents'
        )
        and entry.value <> 'null'::jsonb
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if creates_v3 and (
      exists (
        select 1
        from jsonb_each(p_version_payload) entry
        where entry.key in ('sale_coefficient_fo', 'sale_coefficient_mo')
          and entry.value <> 'null'::jsonb
          and (
            jsonb_typeof(entry.value) <> 'number'
            or entry.value::text::numeric <= 0
            or entry.value::text::numeric > 10
            or pg_catalog.min_scale(entry.value::text::numeric) > 4
          )
      )
      or exists (
        select 1
        from unnest(array['gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents']) as required(key)
        where jsonb_typeof(p_version_payload->required.key) is distinct from 'number'
          or p_version_payload->>required.key !~ '^[0-9]+$'
          or (p_version_payload->>required.key)::numeric > 2147483647
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if p_version_payload ? 'discount_amount_cents'
    and p_version_payload->'discount_amount_cents' <> 'null'::jsonb then
    if jsonb_typeof(p_version_payload->'discount_amount_cents') <> 'number'
      or p_version_payload->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
    if (p_version_payload->>'discount_amount_cents')::numeric > 2147483647
      or p_version_payload->>'discount_mode' is distinct from 'simple'
      or coalesce(jsonb_array_length(p_version_payload->'discount_steps'),0) <> 0 then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
  end if;

  version_contractor_role := coalesce(
    nullif(btrim(p_version_payload->>'contractor_role'), ''),
    'principal'
  )::text;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
  end if;

  -- The hierarchy check (replayed after the insert since M8) and the coverage
  -- replay rely on the accepted payload order, made explicit before any
  -- project/import mutation: every child must follow its section parent in the
  -- payload and every payload id must be unique and concrete.
  if exists (
    with payload_item as (
      select
        entry.ordinality,
        (entry.value->>'id')::uuid as id,
        (entry.value->>'parent_id')::uuid as parent_id,
        entry.value->>'item_type' as item_type
      from jsonb_array_elements(p_items) with ordinality
        as entry(value, ordinality)
    )
    select 1
    from payload_item as child
    left join payload_item as parent on parent.id = child.parent_id
    where child.id is null
      or child.item_type is null
      or child.item_type not in ('section', 'line')
      or (child.item_type = 'line' and child.parent_id is null)
      or (
        child.parent_id is not null
        and (
          parent.id is null
          or parent.item_type <> 'section'
          or parent.ordinality >= child.ordinality
        )
      )
    union all
    select 1
    from payload_item
    group by payload_item.id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_HIERARCHY_INVALID';
  end if;

  if p_import_id is not null then
    select source_import.*
      into import_row
    from public.dpgf_imports as source_import
    where source_import.id = p_import_id
      and source_import.tenant_id = p_tenant_id
      and (
        source_import.user_id = actor_user_id
        or actor_role = 'admin'::public.tenant_role
      )
    for update;

    if import_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'DPGF_IMPORT_NOT_WRITABLE';
    end if;

    if import_row.project_id is not null
      and (
        p_project_id is null
        or import_row.project_id <> p_project_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  if (p_version_payload->>'total_ht_cents') is null
    or (p_version_payload->>'total_tax_cents') is null
    or (p_version_payload->>'total_ttc_cents') is null
    or (p_version_payload->>'total_ht_cents')::integer < 0
    or (p_version_payload->>'total_tax_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer <>
      (p_version_payload->>'total_ht_cents')::integer
      + (p_version_payload->>'total_tax_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_INVALID';
  end if;

  if version_contractor_role = 'subcontractor'
    and (
      (p_version_payload->>'total_tax_cents')::integer <> 0
      or (p_version_payload->>'total_ttc_cents')::integer <>
        (p_version_payload->>'total_ht_cents')::integer
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      item_type public.estimate_item_type,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    )
    where item.item_type = 'line'
      and (
        item.line_total_ht_cents is null
        or item.line_tax_cents is null
        or item.line_total_ttc_cents is null
        or item.line_total_ht_cents < 0
        or item.line_tax_cents < 0
        or item.line_total_ttc_cents < 0
        or item.line_total_ttc_cents <>
          item.line_total_ht_cents + item.line_tax_cents
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEM_TOTALS_INVALID';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
    into item_total_ht, item_total_tax, item_total_ttc
  from jsonb_to_recordset(p_items) as item(
    item_type public.estimate_item_type,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.item_type = 'line'::public.estimate_item_type;

  if item_total_ht <> (p_version_payload->>'total_ht_cents')::integer
    or item_total_tax <> (p_version_payload->>'total_tax_cents')::integer
    or item_total_ttc <> (p_version_payload->>'total_ttc_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_job_id uuid
    )
    left join public.estimate_categories category
      on category.id = item.category_id
     and category.tenant_id = p_tenant_id
    left join public.supply_types supply_type
      on supply_type.id = item.supply_type_id
     and supply_type.tenant_id = p_tenant_id
    left join public.supplier_pricebook supplier_price
      on supplier_price.id = item.selected_supplier_price_id
     and supplier_price.tenant_id = p_tenant_id
    left join public.takeoff_jobs source_job
      on source_job.id = item.source_job_id
     and source_job.tenant_id = p_tenant_id
    where (item.category_id is not null and category.id is null)
      or (item.supply_type_id is not null and supply_type.id is null)
      or (
        item.selected_supplier_price_id is not null
        and supplier_price.id is null
      )
      or (item.source_job_id is not null and source_job.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_ITEM_REFERENCE_TENANT_MISMATCH';
  end if;

  if p_project_id is null then
    if p_project_payload is null
      or jsonb_typeof(p_project_payload) <> 'object'
      or p_project_payload - array[
        'id',
        'name',
        'reference',
        'client_name',
        'notes'
      ] <> '{}'::jsonb
      or btrim(coalesce(p_project_payload->>'name', '')) = ''
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_PAYLOAD_INVALID';
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
      (p_project_payload->>'id')::uuid,
      p_tenant_id,
      actor_user_id,
      btrim(p_project_payload->>'name'),
      nullif(btrim(p_project_payload->>'reference'), ''),
      nullif(btrim(p_project_payload->>'client_name'), ''),
      nullif(btrim(p_project_payload->>'notes'), ''),
      false
    )
    returning * into project_row;

    next_version_number := 1;
  else
    if p_project_payload is not null then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_SELECTOR_INVALID';
    end if;

    select project.*
      into project_row
    from public.estimate_projects as project
    where project.id = p_project_id
      and project.tenant_id = p_tenant_id
    for update;

    if project_row.id is null
      or project_row.is_archived
      or (
        project_row.user_id <> actor_user_id
        and actor_role <> 'admin'::public.tenant_role
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_PROJECT_NOT_WRITABLE';
    end if;

    select coalesce(max(version.version_number), 0) + 1
      into next_version_number
    from public.estimate_versions as version
    where version.project_id = project_row.id
      and version.tenant_id = p_tenant_id;
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from jsonb_to_recordset(p_items) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(p_items) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(p_items) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      labor_role_id uuid,
      labor_role_atelier_id uuid,
      labor_role_chantier_id uuid
    )
    left join public.labor_roles labor_role
      on labor_role.id = item.labor_role_id
     and labor_role.tenant_id = p_tenant_id
     and labor_role.user_id = project_row.user_id
    left join public.labor_roles atelier_role
      on atelier_role.id = item.labor_role_atelier_id
     and atelier_role.tenant_id = p_tenant_id
     and atelier_role.user_id = project_row.user_id
    left join public.labor_roles chantier_role
      on chantier_role.id = item.labor_role_chantier_id
     and chantier_role.tenant_id = p_tenant_id
     and chantier_role.user_id = project_row.user_id
    where (item.labor_role_id is not null and labor_role.id is null)
      or (item.labor_role_atelier_id is not null and atelier_role.id is null)
      or (item.labor_role_chantier_id is not null and chantier_role.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if import_row.id is not null and import_row.project_id is null then
    update public.dpgf_imports as source_import
    set project_id = project_row.id
    where source_import.id = import_row.id
      and source_import.tenant_id = p_tenant_id
      and source_import.project_id is null;

    get diagnostics import_claimed_rows = row_count;
    if import_claimed_rows <> 1 then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when creates_v3 then 'canonical_v3' else 'canonical_v2' end,
    true
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
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
  )
  values (
    (p_version_payload->>'id')::uuid,
    p_tenant_id,
    project_row.id,
    next_version_number,
    'draft'::public.estimate_status,
    nullif(btrim(p_version_payload->>'title'), ''),
    (p_version_payload->>'date_devis')::date,
    (p_version_payload->>'validite_jours')::integer,
    (p_version_payload->>'margin_multiplier')::numeric,
    (p_version_payload->>'margin_mode')::public.estimate_margin_mode,
    p_version_payload->>'currency',
    (p_version_payload->>'margin_bp')::integer,
    (p_version_payload->>'discount_bp')::integer,
    (p_version_payload->>'discount_amount_cents')::integer,
    (p_version_payload->>'discount_mode')::public.estimate_discount_mode,
    array(
      select discount_step.value::integer
      from jsonb_array_elements_text(p_version_payload->'discount_steps')
        as discount_step(value)
    ),
    (p_version_payload->>'global_coefficient')::numeric,
    (p_version_payload->>'tax_rate_bp')::integer,
    (p_version_payload->>'rounding_mode')::public.estimate_rounding_mode,
    (p_version_payload->>'rounding_step_cents')::integer,
    (p_version_payload->>'max_section_depth')::integer,
    policy_engine,
    version_contractor_role::text,
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_fo')::numeric,
      policy_row.default_sale_coefficient_fo
    ) end,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_mo')::numeric,
      policy_row.default_sale_coefficient_mo
    ) end,
    case when creates_v3 then (p_version_payload->>'gross_ht_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'discount_applied_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'commercial_rounding_cents')::integer end
  )
  returning * into version_row;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if creates_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      version_row.id::text,
      true
    );
  end if;

  if jsonb_array_length(p_items) > 0 then
    -- Lot 2, sub-lot 2.8 (M8): under the creation contract of this version, the per-line triggers
    -- (content revision, audit, source coverage, depth) leave its items to one replay, in payload
    -- order, at the end of the insert.
    previous_creation_contract := coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true),
      ''
    );
    perform pg_catalog.set_config(
      'miaouffrage.estimate_creation_atomic',
      version_row.id::text,
      true
    );
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
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      source_metadata,
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
      coalesce(item.id, gen_random_uuid()),
      p_tenant_id,
      version_row.id,
      item.parent_id,
      item.item_type,
      item.position,
      item.title,
      item.description,
      item.quantity,
      item.unit_price_ht_cents,
      item.tax_rate_bp,
      item.k_fo,
      item.h_mo,
      coalesce(item.h_mo_majoration, 1),
      item.k_mo,
      item.h_mo_atelier,
      coalesce(item.k_mo_atelier, 1),
      item.labor_role_atelier_id,
      item.h_mo_chantier,
      coalesce(item.k_mo_chantier, 1),
      item.labor_role_chantier_id,
      item.pu_ht_cents,
      item.labor_role_id,
      item.category_id,
      item.supply_type_id,
      item.selected_supplier_price_id,
      item.source_provider,
      item.source_job_id,
      item.source_file_name,
      item.source_page,
      coalesce(item.source_metadata, '{}'::jsonb),
      item.line_total_ht_cents,
      item.line_tax_cents,
      item.line_total_ttc_cents,
      item.unit_code,
      coalesce(item.pricing_status, 'priced'::public.estimate_line_pricing_status),
      item.h_mo_per_unit,
      item.h_mo_atelier_per_unit,
      item.h_mo_chantier_per_unit
    from jsonb_to_recordset(p_items) as item(
      id uuid,
      parent_id uuid,
      item_type public.estimate_item_type,
      position integer,
      title text,
      description text,
      quantity numeric,
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric,
      h_mo numeric,
      h_mo_majoration numeric,
      k_mo numeric,
      h_mo_atelier numeric,
      k_mo_atelier numeric,
      labor_role_atelier_id uuid,
      h_mo_chantier numeric,
      k_mo_chantier numeric,
      labor_role_chantier_id uuid,
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer,
      source_metadata jsonb,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer,
      unit_code text,
      pricing_status public.estimate_line_pricing_status,
      h_mo_per_unit numeric,
      h_mo_atelier_per_unit numeric,
      h_mo_chantier_per_unit numeric
    );
    perform public.estimate_creation_replay_item_effects_for_writer(
      version_row.id,
      array(
        select (entry.value->>'id')::uuid
        from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
        order by entry.ordinality
      )
    );
    perform pg_catalog.set_config(
      'miaouffrage.estimate_creation_atomic',
      previous_creation_contract,
      true
    );
  end if;

  if creates_v3 then
    perform public.estimate_v3_assert_draft_for_writer(version_row.id);
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

  return jsonb_build_object(
    'project', to_jsonb(project_row),
    'version', to_jsonb(version_row)
  );
end;
$$;

commit;
