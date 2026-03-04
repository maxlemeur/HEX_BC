-- EST-125: multi-level section hierarchy (1..4) with dynamic depth per estimate version.

alter table public.estimate_versions
  add column if not exists max_section_depth integer;

update public.estimate_versions
set max_section_depth = 2
where max_section_depth is null;

alter table public.estimate_versions
  alter column max_section_depth set default 3;

alter table public.estimate_versions
  alter column max_section_depth set not null;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_max_section_depth_check;

alter table public.estimate_versions
  add constraint estimate_versions_max_section_depth_check
  check (max_section_depth between 1 and 4);

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

  if parent_depth <> target_max_depth then
    raise exception
      'Une ligne doit etre rattachee a une section de niveau %.',
      target_max_depth;
  end if;

  return new;
end;
$$;

drop trigger if exists estimate_items_hierarchy_depth_guard on public.estimate_items;

create trigger estimate_items_hierarchy_depth_guard
  before insert or update of parent_id, item_type, version_id
  on public.estimate_items
  for each row execute procedure public.validate_estimate_item_hierarchy_depth();

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
set search_path = public
as $$
declare
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
        and next_section_level + greatest(descendants.depth - 1, 0) <> coalesce(target_version.max_section_depth, 3)
    ) then
      raise exception 'line target_parent_id must match max_section_depth';
    end if;
  end if;

  if target_item.item_type = 'line' then
    if target_parent_id is null then
      raise exception 'line target_parent_id is required';
    end if;

    if target_parent_level <> coalesce(target_version.max_section_depth, 3) then
      raise exception 'line target_parent_id exceeds maximum depth';
    end if;
  end if;

  create temporary table _move_source_order (
    id uuid primary key,
    position integer not null
  ) on commit drop;

  insert into _move_source_order (id, position)
  select src.id, src.ordinality::integer as position
  from unnest(ordered_source_item_ids) with ordinality as src(id, ordinality);

  get diagnostics source_expected_count = row_count;

  if source_expected_count <> coalesce(array_length(ordered_source_item_ids, 1), 0) then
    raise exception 'ordered_source_item_ids contains duplicates';
  end if;

  if exists (
    select 1
    from _move_source_order source_order
    where source_order.id = target_item_id
  ) then
    raise exception 'ordered_source_item_ids must not contain target_item_id';
  end if;

  create temporary table _move_target_order (
    id uuid primary key,
    position integer not null
  ) on commit drop;

  insert into _move_target_order (id, position)
  select src.id, src.ordinality::integer as position
  from unnest(ordered_target_item_ids) with ordinality as src(id, ordinality);

  get diagnostics target_expected_count = row_count;

  if target_expected_count <> coalesce(array_length(ordered_target_item_ids, 1), 0) then
    raise exception 'ordered_target_item_ids contains duplicates';
  end if;

  if not exists (
    select 1
    from _move_target_order target_order
    where target_order.id = target_item_id
  ) then
    raise exception 'ordered_target_item_ids must contain target_item_id';
  end if;

  if exists (
    select 1
    from _move_source_order source_order
    join _move_target_order target_order
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
    from _move_source_order source_order
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
        from _move_source_order source_order
        where source_order.id = item.id
      )
  ) then
    raise exception 'ordered_source_item_ids is missing source ids';
  end if;

  if exists (
    select 1
    from _move_target_order target_order
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
        from _move_target_order target_order
        where target_order.id = item.id
      )
  ) then
    raise exception 'ordered_target_item_ids is missing target ids';
  end if;

  select target_order.position
    into target_position
  from _move_target_order target_order
  where target_order.id = target_item_id;

  if target_position is null or target_position <= 0 then
    raise exception 'target_item_id position is invalid in ordered_target_item_ids';
  end if;

  update public.estimate_items item
  set position = -source_order.position
  from _move_source_order source_order
  where item.id = source_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from source_parent_id
    and item.id <> target_item_id;

  update public.estimate_items item
  set position = -target_order.position
  from _move_target_order target_order
  where item.id = target_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.id <> target_item_id
    and item.parent_id is not distinct from target_parent_id;

  update public.estimate_items item
  set
    parent_id = target_parent_id,
    position = -target_position
  where item.id = target_item_id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id;

  update public.estimate_items item
  set position = source_order.position
  from _move_source_order source_order
  where item.id = source_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from source_parent_id
    and item.id <> target_item_id;

  get diagnostics source_updated_count = row_count;

  update public.estimate_items item
  set
    parent_id = target_parent_id,
    position = target_order.position
  from _move_target_order target_order
  where item.id = target_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id;

  get diagnostics target_updated_count = row_count;

  if source_updated_count <> source_expected_count then
    raise exception 'ordered_source_item_ids stale write detected';
  end if;

  if target_updated_count <> target_expected_count then
    raise exception 'ordered_target_item_ids stale write detected';
  end if;

  return source_updated_count + target_updated_count;
end;
$$;

grant execute on function public.move_estimate_item(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid[],
  uuid[]
) to authenticated;

