-- Reorder and move write the per-row effects of their item updates in one pass. Contract, failure modes and proofs:
-- docs/testing/reorder-move-large-v2.md.
--
-- Observed: public.reorder_estimate_items and public.move_estimate_item rewrite every sibling of the parents they
-- touch twice (a negative position first). Each written row ran, under the API roles' RLS, the update policy of
-- estimate_items and its per-row triggers, among them one content revision step of the version (an update of the same
-- estimate_versions row, with its audit row) and one item audit row. Measured locally as authenticated (owned native
-- stack): reversing a section of 1 000 lines took 5,4 s, moving a line between sections of 1 000 and 999 lines 12 s
-- (over the 8 s statement_timeout of the API roles even locally: 400, 57014, nothing moved); the RLS helpers of the
-- policies and invoker guards dominated, then the per-row audit and bump. At the CI load factor both fail.
--
-- 1. Both RPCs keep their signatures, results, refusals and statements. They become security definer and check once
--    what the update policy of estimate_items checked per row: the version exists and is a draft, the caller is a
--    member of its active tenant with the admin or engineer role, and owns its affaire unless admin
--    (is_tenant_member and has_tenant_role keep the platform admin exception of the policy). auth.uid() still names
--    the caller, so every audit row keeps its user. Their rows are restricted to the version's tenant, as the policy
--    did. Execution is granted to authenticated only.
-- 2. Around their item updates they bind miaouffrage.estimate_item_order_atomic to the version (set_config local,
--    previous value restored). Under it, and only for an UPDATE of an item that stays in that version,
--    bump_estimate_content_revision_from_item and log_estimate_audit return at once, and
--    private.source_coverage_invalidate returns at once when nothing but the position (and updated_at), neither of
--    them technical, changed (the old row with the new position and updated_at equals the new row): what it would
--    conclude anyway, without building the two technical rows. Inserts, deletes, other versions and other writers
--    keep them. The hierarchy depth guard and every BEFORE trigger still run per row, unchanged.
-- 3. The negative pass returns the row before and after each update; the final pass returns the new row and takes as
--    its before row the one the negative pass returned (locked, nothing else writes it in between).
--    private.estimate_item_order_replay_effects then writes what the bump and the item audit wrote: one content
--    revision step per write that changes the row beyond updated_at (same draft check), as one update of +N under
--    the creation replay contract of 20261018013249 (both settings bound to this version for that single statement:
--    guard_estimate_version_workflow_columns admits the upward step on a draft and
--    log_estimate_audit leaves its audit rows to the replay; no item is written while they hold), one version audit
--    row per step with consecutive revisions, and one item audit row per write, with the values the triggers wrote.
--    Audit rows carry a random id and now(): their order is not observable, only the rows are.
-- 4. Lock order is unchanged: reorder locks its rows, then the version (as the first per-row bump did); move locks the
--    version first, as before.
-- bump_estimate_content_revision_from_item, log_estimate_audit and private.source_coverage_invalidate are copied from
-- their latest definition (20261018013249) with only the lines marked « Reorder and move » added. CREATE OR REPLACE
-- keeps owners; the two RPCs get explicit grants. No existing row is rewritten.
begin;

do $preflight$
begin
  if to_regprocedure('public.reorder_estimate_items(uuid, uuid, uuid[])') is null
    or to_regprocedure('public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[])') is null
    or to_regprocedure('public.estimate_creation_replay_item_effects_for_writer(uuid, uuid[])') is null
    or to_regprocedure('public.is_tenant_member(uuid)') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
  then
    raise exception 'ESTIMATE_ITEM_ORDER_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

-- The update policy of estimate_items (« Users can update draft estimate items »), checked once for an order
-- operation: the tenant of a draft the caller may write, else a refusal.
create function private.estimate_item_order_writer_tenant(p_version_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_tenant_id uuid;
  target_status public.estimate_status;
  project_owner_id uuid;
begin
  select version.tenant_id, version.status, project.user_id
    into target_tenant_id, target_status, project_owner_id
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = p_version_id;

  if actor_id is null
    or target_tenant_id is null
    or not public.is_tenant_member(target_tenant_id)
    or not public.has_tenant_role(target_tenant_id, array['admin', 'engineer']::public.tenant_role[])
    or not (
      project_owner_id = actor_id
      or public.has_tenant_role(target_tenant_id, array['admin']::public.tenant_role[])
    )
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_ITEM_ORDER_FORBIDDEN';
  end if;

  if target_status is distinct from 'draft'::public.estimate_status then
    raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_READ_ONLY';
  end if;

  return target_tenant_id;
end;
$$;

revoke all on function private.estimate_item_order_writer_tenant(uuid) from public, anon, authenticated, service_role;

-- What bump_estimate_content_revision_from_item and log_estimate_audit wrote for the item updates of an order
-- operation, from the row before and after each write (in write order), under the operation's contract.
create function private.estimate_item_order_replay_effects(
  p_version_id uuid,
  p_before jsonb[],
  p_after jsonb[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  write_count integer := coalesce(cardinality(p_after), 0);
  invalid_count integer;
  step_count integer;
  target_status public.estimate_status;
  version_before jsonb;
  version_after jsonb;
  base_revision bigint;
  previous_creation text;
  previous_replay text;
  version_user_id uuid;
  item_user_id uuid;
begin
  if p_version_id is null
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic', true), '') <> p_version_id::text
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_ITEM_ORDER_REPLAY_OUTSIDE_CONTRACT';
  end if;

  -- One pass over the writes: their shape, and how many are revision steps (bump_estimate_content_revision_from_item:
  -- a write that changes the row beyond updated_at; a changed position settles it without comparing the rows).
  select
    count(*) filter (
      where jsonb_typeof(write.before_data) is distinct from 'object'
        or jsonb_typeof(write.after_data) is distinct from 'object'
        or write.before_data->>'id' is distinct from write.after_data->>'id'
        or write.before_data->>'version_id' is distinct from p_version_id::text
        or write.after_data->>'version_id' is distinct from p_version_id::text
    )::integer,
    count(*) filter (
      where write.before_data->'position' is distinct from write.after_data->'position'
        or (write.after_data - 'updated_at') is distinct from (write.before_data - 'updated_at')
    )::integer
    into invalid_count, step_count
  from unnest(p_before, p_after) as write(before_data, after_data);

  if coalesce(cardinality(p_before), 0) <> write_count or invalid_count > 0 then
    raise exception using errcode = '22023', message = 'ESTIMATE_ITEM_ORDER_REPLAY_WRITES_INVALID';
  end if;

  if write_count = 0 then
    return;
  end if;

  if step_count > 0 then
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

    -- One update of +N under the creation replay contract (20261018013249), held for this statement only.
    previous_creation := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '');
    previous_replay := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_replay', true), '');
    perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', p_version_id::text, true);
    perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', p_version_id::text, true);
    update public.estimate_versions version
    set content_revision = version.content_revision + step_count
    where version.id = p_version_id;
    perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', previous_replay, true);
    perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', previous_creation, true);

    select to_jsonb(version.*)
      into version_after
    from public.estimate_versions version
    where version.id = p_version_id;

    -- log_estimate_audit on estimate_versions: the user of the request, else the row's user, else the affaire owner.
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
  end if;

  -- log_estimate_audit on estimate_items: an item row names no user, so the affaire owner when no request user.
  select project.user_id
    into item_user_id
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id
  where version.id = p_version_id;

  -- log_estimate_audit, as the triggers wrote it: one version row per revision step (step k takes the revision from
  -- base + k - 1 to base + k, the rest of the row being the version after the update), one item row per write. Audit
  -- rows carry a random id and now(): the order of their insertion is not observable, so none is imposed.
  if step_count > 0 then
    insert into public.audit_logs (
      tenant_id, user_id, table_name, record_id, estimate_version_id, action, before_data, after_data
    )
    select
      coalesce(
        nullif(version_after->>'tenant_id', '')::uuid,
        nullif(version_before->>'tenant_id', '')::uuid,
        public.current_tenant_id()
      ),
      coalesce((select auth.uid()), version_user_id),
      'estimate_versions',
      p_version_id,
      p_version_id,
      'UPDATE',
      case
        when step.k = 1 then version_before
        else version_after || jsonb_build_object('content_revision', base_revision + step.k - 1)
      end,
      version_after || jsonb_build_object('content_revision', base_revision + step.k)
    from generate_series(1, step_count) as step(k);
  end if;

  insert into public.audit_logs (
    tenant_id, user_id, table_name, record_id, estimate_version_id, action, before_data, after_data
  )
  select
    coalesce(
      nullif(write.after_data->>'tenant_id', '')::uuid,
      nullif(write.before_data->>'tenant_id', '')::uuid,
      (select version.tenant_id from public.estimate_versions version where version.id = p_version_id),
      public.current_tenant_id()
    ),
    coalesce(
      (select auth.uid()),
      nullif(write.after_data->>'user_id', '')::uuid,
      nullif(write.before_data->>'user_id', '')::uuid,
      nullif(write.after_data->>'created_by', '')::uuid,
      nullif(write.before_data->>'created_by', '')::uuid,
      item_user_id
    ),
    'estimate_items',
    (write.after_data->>'id')::uuid,
    p_version_id,
    'UPDATE',
    write.before_data,
    write.after_data
  from unnest(p_before, p_after) as write(before_data, after_data);
end;
$$;

comment on function private.estimate_item_order_replay_effects(uuid, jsonb[], jsonb[]) is
  'Replays, under the order contract of a version (miaouffrage.estimate_item_order_atomic), the content revision steps and audit rows of the item updates of reorder_estimate_items or move_estimate_item, in one pass and with the same rows. docs/testing/reorder-move-large-v2.md.';

revoke all on function private.estimate_item_order_replay_effects(uuid, jsonb[], jsonb[])
  from public, anon, authenticated, service_role;

create or replace function public.reorder_estimate_items(
  target_version_id uuid,
  target_parent_id uuid,
  ordered_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  locked_ids uuid[];
  first_ids uuid[];
  first_before jsonb[];
  first_after jsonb[];
  second_before jsonb[];
  second_after jsonb[];
  paired_count integer;
  previous_contract text;
  updated_count integer := 0;
begin
  if coalesce(array_length(ordered_item_ids, 1), 0) = 0 then
    return 0;
  end if;

  target_tenant_id := private.estimate_item_order_writer_tenant(target_version_id);

  -- The rows the two statements update, locked first: each statement then reads the row it replaces.
  select coalesce(array_agg(locked.id), '{}')
    into locked_ids
  from (
    select item.id
    from public.estimate_items item
    where item.id = any(ordered_item_ids)
      and item.version_id = target_version_id
      and item.tenant_id = target_tenant_id
      and item.parent_id is not distinct from target_parent_id
    for update
  ) as locked;

  previous_contract := coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_item_order_atomic', target_version_id::text, true);

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_item_ids) with ordinality as src(id, ordinality)
  ),
  written as (
    update public.estimate_items item
    set position = -ordered.position
    from ordered
    join public.estimate_items previous on previous.id = ordered.id
    where item.id = ordered.id
      and item.id = any(locked_ids)
      and item.version_id = target_version_id
      and item.tenant_id = target_tenant_id
      and item.parent_id is not distinct from target_parent_id
    returning item.id, to_jsonb(previous.*) as before_data, to_jsonb(item.*) as after_data
  )
  select coalesce(array_agg(written.id), '{}'), coalesce(array_agg(written.before_data), '{}'),
    coalesce(array_agg(written.after_data), '{}')
    into first_ids, first_before, first_after
  from written;

  -- The second pass replaces the rows the first one returned (locked, nothing else writes them in between).
  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_item_ids) with ordinality as src(id, ordinality)
  ),
  written as (
    update public.estimate_items item
    set position = ordered.position
    from ordered
    where item.id = ordered.id
      and item.id = any(locked_ids)
      and item.version_id = target_version_id
      and item.tenant_id = target_tenant_id
      and item.parent_id is not distinct from target_parent_id
    returning item.id, to_jsonb(item.*) as after_data
  )
  select count(*)::integer, count(first.id)::integer,
    coalesce(array_agg(first.before_data) filter (where first.id is not null), '{}'),
    coalesce(array_agg(written.after_data) filter (where first.id is not null), '{}')
    into updated_count, paired_count, second_before, second_after
  from written
  left join unnest(first_ids, first_after) as first(id, before_data) on first.id = written.id;

  if paired_count <> updated_count then
    raise exception using errcode = 'XX000', message = 'ESTIMATE_ITEM_ORDER_WRITES_INCONSISTENT';
  end if;

  perform private.estimate_item_order_replay_effects(
    target_version_id,
    first_before || second_before,
    first_after || second_after
  );
  perform pg_catalog.set_config('miaouffrage.estimate_item_order_atomic', previous_contract, true);

  return updated_count;
end;
$$;

comment on function public.reorder_estimate_items(uuid, uuid, uuid[]) is
  'Reorders the children of a parent of a draft: the update policy is checked once, the per-row content revision steps and audit rows are written in one pass with the same rows. docs/testing/reorder-move-large-v2.md.';

revoke all on function public.reorder_estimate_items(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.reorder_estimate_items(uuid, uuid, uuid[]) to authenticated;

create or replace function public.move_estimate_item(
  target_version_id uuid,
  target_item_id uuid,
  source_parent_id uuid,
  target_parent_id uuid,
  ordered_source_item_ids uuid[],
  ordered_target_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  target_version public.estimate_versions%rowtype;
  target_item public.estimate_items%rowtype;
  source_parent_item public.estimate_items%rowtype;
  target_parent_item public.estimate_items%rowtype;
  source_expected_count integer := 0;
  target_expected_count integer := 0;
  source_locked_count integer := 0;
  target_locked_count integer := 0;
  source_updated_count integer := 0;
  target_updated_count integer := 0;
  target_position integer := 0;
  target_parent_level integer := 0;
  next_section_level integer := 1;
  previous_contract text;
  all_before jsonb[] := '{}';
  all_after jsonb[] := '{}';
  all_ids uuid[] := '{}';
  first_ids uuid[];
  first_after jsonb[];
  step_ids uuid[];
  step_before jsonb[];
  step_after jsonb[];
  paired_count integer;
begin
  if target_version_id is null then
    raise exception 'target_version_id is required';
  end if;

  if target_item_id is null then
    raise exception 'target_item_id is required';
  end if;

  if ordered_source_item_ids is null then
    raise exception 'ordered_source_item_ids is required';
  end if;

  if ordered_target_item_ids is null then
    raise exception 'ordered_target_item_ids is required';
  end if;

  if source_parent_id is not distinct from target_parent_id then
    raise exception 'source_parent_id and target_parent_id must be different';
  end if;

  if coalesce(array_length(ordered_target_item_ids, 1), 0) = 0 then
    raise exception 'ordered_target_item_ids cannot be empty';
  end if;

  target_tenant_id := private.estimate_item_order_writer_tenant(target_version_id);

  select *
    into target_version
  from public.estimate_versions ev
  where ev.id = target_version_id
  for update;

  if not found then
    raise exception 'target_version_id is invalid';
  end if;

  select *
    into target_item
  from public.estimate_items item
  where item.id = target_item_id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
  for update;

  if not found then
    raise exception 'target_item_id is invalid for target_version_id';
  end if;

  if target_item.parent_id is distinct from source_parent_id then
    raise exception 'source_parent_id mismatch for target_item_id';
  end if;

  if source_parent_id is not null then
    select *
      into source_parent_item
    from public.estimate_items parent
    where parent.id = source_parent_id
      and parent.version_id = target_version_id
      and parent.tenant_id = target_version.tenant_id
      and parent.item_type = 'section'
    for update;

    if not found then
      raise exception 'source_parent_id is invalid for target_version_id';
    end if;
  end if;

  if target_parent_id is not null then
    select *
      into target_parent_item
    from public.estimate_items parent
    where parent.id = target_parent_id
      and parent.version_id = target_version_id
      and parent.tenant_id = target_version.tenant_id
      and parent.item_type = 'section'
    for update;

    if not found then
      raise exception 'target_parent_id is invalid for target_version_id';
    end if;

    with recursive parent_chain as (
      select parent.id, parent.parent_id, 1 as depth
      from public.estimate_items parent
      where parent.id = target_parent_id
        and parent.version_id = target_version_id
        and parent.tenant_id = target_version.tenant_id
      union all
      select next_parent.id, next_parent.parent_id, parent_chain.depth + 1
      from public.estimate_items next_parent
      join parent_chain on next_parent.id = parent_chain.parent_id
      where next_parent.version_id = target_version_id
        and next_parent.tenant_id = target_version.tenant_id
    )
    select coalesce(max(parent_chain.depth), 0)
      into target_parent_level
    from parent_chain;
  end if;

  if target_item.item_type = 'section' then
    if target_parent_id is not null and exists (
      with recursive subtree as (
        select child.id
        from public.estimate_items child
        where child.parent_id = target_item_id
          and child.version_id = target_version_id
          and child.tenant_id = target_version.tenant_id
        union all
        select child.id
        from public.estimate_items child
        join subtree on subtree.id = child.parent_id
        where child.version_id = target_version_id
          and child.tenant_id = target_version.tenant_id
      )
      select 1
      from subtree
      where subtree.id = target_parent_id
    ) then
      raise exception 'section target_parent_id cannot reference its own subtree';
    end if;

    next_section_level := target_parent_level + 1;
    if next_section_level > coalesce(target_version.max_section_depth, 3) then
      raise exception 'section target_parent_id exceeds max_section_depth';
    end if;

    if exists (
      with recursive descendants as (
        select child.id, child.item_type, 1 as depth
        from public.estimate_items child
        where child.parent_id = target_item_id
          and child.version_id = target_version_id
          and child.tenant_id = target_version.tenant_id
        union all
        select child.id, child.item_type, descendants.depth + 1
        from public.estimate_items child
        join descendants on descendants.id = child.parent_id
        where child.version_id = target_version_id
          and child.tenant_id = target_version.tenant_id
      )
      select 1
      from descendants
      where descendants.item_type = 'section'
        and next_section_level + descendants.depth > coalesce(target_version.max_section_depth, 3)
    ) then
      raise exception 'section target_parent_id exceeds max_section_depth';
    end if;

    if exists (
      with recursive descendants as (
        select child.id, child.item_type, 1 as depth
        from public.estimate_items child
        where child.parent_id = target_item_id
          and child.version_id = target_version_id
          and child.tenant_id = target_version.tenant_id
        union all
        select child.id, child.item_type, descendants.depth + 1
        from public.estimate_items child
        join descendants on descendants.id = child.parent_id
        where child.version_id = target_version_id
          and child.tenant_id = target_version.tenant_id
      )
      select 1
      from descendants
      where descendants.item_type = 'line'
        and next_section_level + greatest(descendants.depth - 1, 0) > coalesce(target_version.max_section_depth, 3)
    ) then
      raise exception 'line target_parent_id exceeds max_section_depth';
    end if;
  end if;

  if target_item.item_type = 'line' then
    if target_parent_id is null then
      raise exception 'line target_parent_id is required';
    end if;

    if target_parent_level > coalesce(target_version.max_section_depth, 3) then
      raise exception 'line target_parent_id exceeds maximum depth';
    end if;
  end if;

  -- Tables of a previous move in the same transaction (ON COMMIT DROP keeps them until it ends).
  if to_regclass('pg_temp._move_source_order') is not null then
    drop table pg_temp._move_source_order;
  end if;
  if to_regclass('pg_temp._move_target_order') is not null then
    drop table pg_temp._move_target_order;
  end if;

  create temporary table _move_source_order (
    id uuid primary key,
    position integer not null
  ) on commit drop;

  insert into pg_temp._move_source_order (id, position)
  select src.id, src.ordinality::integer as position
  from unnest(ordered_source_item_ids) with ordinality as src(id, ordinality);

  get diagnostics source_expected_count = row_count;

  if source_expected_count <> coalesce(array_length(ordered_source_item_ids, 1), 0) then
    raise exception 'ordered_source_item_ids contains duplicates';
  end if;

  if exists (
    select 1
    from pg_temp._move_source_order source_order
    where source_order.id = target_item_id
  ) then
    raise exception 'ordered_source_item_ids must not contain target_item_id';
  end if;

  create temporary table _move_target_order (
    id uuid primary key,
    position integer not null
  ) on commit drop;

  insert into pg_temp._move_target_order (id, position)
  select src.id, src.ordinality::integer as position
  from unnest(ordered_target_item_ids) with ordinality as src(id, ordinality);

  get diagnostics target_expected_count = row_count;

  if target_expected_count <> coalesce(array_length(ordered_target_item_ids, 1), 0) then
    raise exception 'ordered_target_item_ids contains duplicates';
  end if;

  if not exists (
    select 1
    from pg_temp._move_target_order target_order
    where target_order.id = target_item_id
  ) then
    raise exception 'ordered_target_item_ids must contain target_item_id';
  end if;

  if exists (
    select 1
    from pg_temp._move_source_order source_order
    join pg_temp._move_target_order target_order
      on target_order.id = source_order.id
  ) then
    raise exception 'ordered_source_item_ids and ordered_target_item_ids overlap';
  end if;

  perform item.id
  from public.estimate_items item
  where item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from source_parent_id
    and item.id <> target_item_id
  for update;

  get diagnostics source_locked_count = row_count;

  if source_locked_count <> source_expected_count then
    raise exception 'ordered_source_item_ids count mismatch';
  end if;

  perform item.id
  from public.estimate_items item
  where item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from target_parent_id
    and item.id <> target_item_id
  for update;

  get diagnostics target_locked_count = row_count;

  if target_locked_count + 1 <> target_expected_count then
    raise exception 'ordered_target_item_ids count mismatch';
  end if;

  if exists (
    select 1
    from pg_temp._move_source_order source_order
    left join public.estimate_items item
      on item.id = source_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from source_parent_id
      and item.id <> target_item_id
    where item.id is null
  ) then
    raise exception 'ordered_source_item_ids contains invalid source ids';
  end if;

  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from source_parent_id
      and item.id <> target_item_id
      and not exists (
        select 1
        from pg_temp._move_source_order source_order
        where source_order.id = item.id
      )
  ) then
    raise exception 'ordered_source_item_ids is missing source ids';
  end if;

  if exists (
    select 1
    from pg_temp._move_target_order target_order
    left join public.estimate_items item
      on item.id = target_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and (
        item.id = target_item_id
        or (
          item.parent_id is not distinct from target_parent_id
          and item.id <> target_item_id
        )
      )
    where item.id is null
  ) then
    raise exception 'ordered_target_item_ids contains invalid target ids';
  end if;

  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from target_parent_id
      and item.id <> target_item_id
      and not exists (
        select 1
        from pg_temp._move_target_order target_order
        where target_order.id = item.id
      )
  ) then
    raise exception 'ordered_target_item_ids is missing target ids';
  end if;

  select target_order.position
    into target_position
  from pg_temp._move_target_order target_order
  where target_order.id = target_item_id;

  if target_position is null or target_position <= 0 then
    raise exception 'target_item_id position is invalid in ordered_target_item_ids';
  end if;

  -- Every row written below is locked above; the three first statements read the row they replace.
  previous_contract := coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_item_order_atomic', target_version_id::text, true);

  with written as (
    update public.estimate_items item
    set position = -source_order.position
    from pg_temp._move_source_order source_order
    join public.estimate_items previous on previous.id = source_order.id
    where item.id = source_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from source_parent_id
      and item.id <> target_item_id
    returning item.id, to_jsonb(previous.*) as before_data, to_jsonb(item.*) as after_data
  )
  select coalesce(array_agg(written.id), '{}'), coalesce(array_agg(written.before_data), '{}'),
    coalesce(array_agg(written.after_data), '{}')
    into step_ids, step_before, step_after
  from written;
  all_ids := all_ids || step_ids;
  all_before := all_before || step_before;
  all_after := all_after || step_after;

  with written as (
    update public.estimate_items item
    set position = -target_order.position
    from pg_temp._move_target_order target_order
    join public.estimate_items previous on previous.id = target_order.id
    where item.id = target_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.id <> target_item_id
      and item.parent_id is not distinct from target_parent_id
    returning item.id, to_jsonb(previous.*) as before_data, to_jsonb(item.*) as after_data
  )
  select coalesce(array_agg(written.id), '{}'), coalesce(array_agg(written.before_data), '{}'),
    coalesce(array_agg(written.after_data), '{}')
    into step_ids, step_before, step_after
  from written;
  all_ids := all_ids || step_ids;
  all_before := all_before || step_before;
  all_after := all_after || step_after;

  with written as (
    update public.estimate_items item
    set
      parent_id = target_parent_id,
      position = -target_position
    from public.estimate_items previous
    where item.id = target_item_id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and previous.id = item.id
    returning item.id, to_jsonb(previous.*) as before_data, to_jsonb(item.*) as after_data
  )
  select coalesce(array_agg(written.id), '{}'), coalesce(array_agg(written.before_data), '{}'),
    coalesce(array_agg(written.after_data), '{}')
    into step_ids, step_before, step_after
  from written;
  all_ids := all_ids || step_ids;
  all_before := all_before || step_before;
  all_after := all_after || step_after;

  -- The final positions replace the rows the three statements above returned (locked, nothing else writes them).
  first_ids := all_ids;
  first_after := all_after;

  with written as (
    update public.estimate_items item
    set position = source_order.position
    from pg_temp._move_source_order source_order
    where item.id = source_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from source_parent_id
      and item.id <> target_item_id
    returning item.id, to_jsonb(item.*) as after_data
  )
  select count(*)::integer, count(first.id)::integer,
    coalesce(array_agg(first.before_data) filter (where first.id is not null), '{}'),
    coalesce(array_agg(written.after_data) filter (where first.id is not null), '{}')
    into source_updated_count, paired_count, step_before, step_after
  from written
  left join unnest(first_ids, first_after) as first(id, before_data) on first.id = written.id;

  if paired_count <> source_updated_count then
    raise exception using errcode = 'XX000', message = 'ESTIMATE_ITEM_ORDER_WRITES_INCONSISTENT';
  end if;
  all_before := all_before || step_before;
  all_after := all_after || step_after;

  with written as (
    update public.estimate_items item
    set
      parent_id = target_parent_id,
      position = target_order.position
    from pg_temp._move_target_order target_order
    where item.id = target_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
    returning item.id, to_jsonb(item.*) as after_data
  )
  select count(*)::integer, count(first.id)::integer,
    coalesce(array_agg(first.before_data) filter (where first.id is not null), '{}'),
    coalesce(array_agg(written.after_data) filter (where first.id is not null), '{}')
    into target_updated_count, paired_count, step_before, step_after
  from written
  left join unnest(first_ids, first_after) as first(id, before_data) on first.id = written.id;

  if paired_count <> target_updated_count then
    raise exception using errcode = 'XX000', message = 'ESTIMATE_ITEM_ORDER_WRITES_INCONSISTENT';
  end if;
  all_before := all_before || step_before;
  all_after := all_after || step_after;

  if source_updated_count <> source_expected_count then
    raise exception 'ordered_source_item_ids stale write detected';
  end if;

  if target_updated_count <> target_expected_count then
    raise exception 'ordered_target_item_ids stale write detected';
  end if;

  perform private.estimate_item_order_replay_effects(target_version_id, all_before, all_after);
  perform pg_catalog.set_config('miaouffrage.estimate_item_order_atomic', previous_contract, true);

  return source_updated_count + target_updated_count;
end;
$$;

comment on function public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[]) is
  'Moves an item of a draft to another parent and renumbers both sibling lists: the update policy is checked once, the per-row content revision steps and audit rows are written in one pass with the same rows. docs/testing/reorder-move-large-v2.md.';

revoke all on function public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[]) to authenticated;

-- Per-row triggers: unchanged outside the order contract of their version.

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
  -- Lot 2, sub-lot 2.8 (M6b): the atomic creation of a version journals the insertion of its items
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
  -- Reorder and move: an order operation journals the updates of its items itself
  -- (private.estimate_item_order_replay_effects).
  elsif tg_op = 'UPDATE' and tg_table_name = 'estimate_items' then
    if old.version_id = new.version_id
      and new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic', true), '')
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
  -- Lot 2, sub-lot 2.8 (M6b): the atomic creation of a version bumps the revision once per item
  -- itself, after its insert (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op = 'INSERT' then
    if new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') then
      return new;
    end if;
  -- Reorder and move: an order operation takes one revision step per written item itself
  -- (private.estimate_item_order_replay_effects).
  elsif tg_op = 'UPDATE' then
    if old.version_id = new.version_id
      and new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic', true), '')
    then
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

create or replace function private.source_coverage_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
declare old_value jsonb; new_value jsonb; identities uuid[]; affected uuid[]; req uuid; descendants uuid[];
  -- Reorder and move: the item as it was, but with its new position and updated_at.
  moved_only public.estimate_items;
begin
  -- Lot 2, sub-lot 2.8 (M6b): the atomic creation of a version replays this invalidation for its items
  -- (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op='INSERT' and tg_table_name='estimate_items' then
    if new.version_id::text=coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic',true),'') then return null; end if;
  end if;
  -- Reorder and move: the update of an item that stays in the version of the order contract and changes nothing but
  -- its position (and updated_at), neither of them technical, has nothing to invalidate.
  if tg_op='UPDATE' and tg_table_name='estimate_items' then
    if old.version_id=new.version_id
      and new.version_id::text=coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic',true),'')
      and old.parent_id is not distinct from new.parent_id
    then
      moved_only:=old; moved_only.position:=new.position; moved_only.updated_at:=new.updated_at;
      if moved_only is not distinct from new then return null; end if;
    end if;
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

commit;
