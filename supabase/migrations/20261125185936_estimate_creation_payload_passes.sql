-- V3E20: on the 2,031-item workbook the existence check scanned the parent
-- CTE 2,031 times. Seven checks/locks also rebuilt the full JSON array just
-- to read columns other than fo_price_origin. Patch the installed writer
-- in place so its permissions, locks, effects and calculation stay together.
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
  insert_input text := 'from jsonb_to_recordset(p_items) as item(
      id uuid,';
begin
  if cardinality(string_to_array(body, old_hierarchy)) <> 2
    or cardinality(string_to_array(body, formatter)) <> 9 then
    raise exception 'Unexpected estimate creation writer';
  end if;

  body := replace(body, old_hierarchy, $new$    -- Index both definitions and requirements by UUID in one aggregate.
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
        and (max(item_type) <> 'section' or max(defined_at) >= min(needed_at)))$new$);

  -- The BEFORE INSERT trigger distinguishes an absent origin from an explicit
  -- JSON null. Keep the existing conversion on that recordset alone.
  body := replace(body, formatter, 'p_items');
  if cardinality(string_to_array(body, insert_input)) <> 2 then
    raise exception 'Unexpected estimate item insert';
  end if;
  execute replace(body, insert_input, replace(insert_input, 'p_items', formatter));
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
