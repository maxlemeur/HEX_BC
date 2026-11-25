-- V3E20: on the 2,031-item workbook the existence check scanned the parent
-- CTE 2,031 times. Seven checks/locks also rebuilt the full JSON array just
-- to read columns other than fo_price_origin. Patch the installed writer
-- in place so its permissions, locks, effects and calculation stay together.
-- Neither complete current body is stored in a migration file. For subsequent
-- changes to public.persist_estimate_creation_atomic or
-- public.estimate_creation_replay_item_effects_for_writer, read the installed
-- definition with pg_get_functiondef. Copying an older definition would
-- silently undo these hierarchy and replay changes.
begin;
do $migration$
declare
  body text := pg_get_functiondef(
    'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure);
  old_hierarchy text := $old$    select 1
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
    having count(*) > 1$old$;
  formatter text := 'public.estimate_fo_price_origin_write_input(p_items)';
  origin_columns text := 'item.selected_supplier_price_id,item.fo_price_origin,';
begin
  if cardinality(string_to_array(body, old_hierarchy)) <> 2
    -- Eight formatter call sites: seven reads and the insert.
    or cardinality(string_to_array(body, formatter)) <> 9 then
    raise exception 'Unexpected estimate creation writer';
  end if;

  body := replace(body, old_hierarchy, $new$    -- defined_at is where an ID is declared; needed_at is where a child names it as parent.
    -- The earliest child is sufficient: every child must follow the section.
    select 1
    from (
      select id, ordinality as defined_at, item_type, null::bigint as needed_at,
        item_type is null or item_type not in ('section', 'line')
          or (item_type = 'line' and parent_id is null) as invalid
      from payload_item
      union all
      select parent_id, null, null, ordinality, false
      from payload_item where parent_id is not null
    ) as occurrences
    group by id
    having id is null or count(defined_at) <> 1 or bool_or(invalid)
      or (min(needed_at) is not null
        and (bool_or(item_type <> 'section') or max(defined_at) >= min(needed_at)))$new$);

  -- Keep the typed recordset: the entire lot is converted before any row
  -- reaches insert constraints. Only explicit JSON null needs the clear marker.
  if cardinality(string_to_array(body, origin_columns)) <> 2 then
    raise exception 'Unexpected estimate item insert';
  end if;
  body := replace(body, formatter, 'p_items');
  execute replace(body, origin_columns, $projection$item.selected_supplier_price_id,
      case when item.fo_price_origin is null and item.id in (
        select (entry.value->>'id')::uuid
        from jsonb_array_elements(p_items) as entry(value)
        where entry.value->'fo_price_origin' = 'null'::jsonb
      ) then '{}'::jsonb else item.fo_price_origin end,$projection$);
end
$migration$;

-- The version index can be estimated at one row immediately after creation.
-- In the recursive term that produced ~8 million rejected ancestor pairs.
-- Fetch the one row identified by its primary key, then check version membership.
-- Batch copies can have ancestors outside the payload; look those up the same way.
do $migration$
declare
  body text := pg_get_functiondef('public.estimate_creation_replay_item_effects_for_writer(uuid,uuid[])'::regprocedure);
  origin text;
  old_join text;
begin
  foreach origin in array array['replayed', 'parent_chain'] loop
    old_join := format('join public.estimate_items parent
        on parent.id = %s.parent_id
       and parent.version_id = p_version_id', origin);
    if cardinality(string_to_array(body, old_join)) <> 2 then
      raise exception 'Unexpected estimate hierarchy replay';
    end if;
    body := replace(body, old_join, format('join lateral (
        select i.id, i.parent_id, i.item_type, i.version_id
        from public.estimate_items i where i.id = %s.parent_id
        offset 0
      ) parent on parent.version_id = p_version_id', origin));
  end loop;
  execute body;
end
$migration$;
commit;
