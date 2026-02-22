-- EST-122: move estimate item across parents with atomic dual reordering.

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
  end if;

  if target_item.item_type = 'section' then
    if target_parent_id is not null and target_parent_item.parent_id is not null then
      raise exception 'section target_parent_id must reference a root section';
    end if;

    if target_parent_id is not null and exists (
      select 1
      from public.estimate_items section_child
      where section_child.version_id = target_version_id
        and section_child.tenant_id = target_version.tenant_id
        and section_child.parent_id = target_item_id
        and section_child.item_type = 'section'
    ) then
      raise exception 'section with subsections cannot become a subsection';
    end if;
  end if;

  if target_item.item_type = 'line'
     and target_parent_id is not null
     and target_parent_item.parent_id is not null then
    if not exists (
      select 1
      from public.estimate_items parent_section
      where parent_section.id = target_parent_item.parent_id
        and parent_section.version_id = target_version_id
        and parent_section.tenant_id = target_version.tenant_id
        and parent_section.item_type = 'section'
        and parent_section.parent_id is null
    ) then
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
