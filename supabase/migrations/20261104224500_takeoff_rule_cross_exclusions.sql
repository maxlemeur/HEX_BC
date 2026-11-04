-- TI-677 (métré L5, suites des revues de L5a et L5b), PR B: a cross-line rule
-- failure no longer blocks a line once every partner it names is left out.
-- Codex #160 (thread 4467409538): a line whose duplicate (zone_overlap) or
-- overlapping room (room_overlap) is a line the mapping plan skips stayed
-- blocked. The rules ran on the stored exclusions; the application RPC
-- excludes the skipped lines (skip, apply_assembly: an assembly is inserted at
-- quantity 1, never from the line) and then the trigger counted the retained
-- line's stored failure. The results now carry their partners' count
-- (details.partner_count, details.overlap_count; src/lib/takeoff/rules/
-- evaluate.ts): a failure whose partners, all named (as many distinct line
-- ids as the count), are all excluded now does not block, in the trigger as in
-- checkApplyGuard (src/lib/takeoff/rules/blocking.ts leftOutByPartners). The
-- rules would pass the line: an excluded line is no partner. Zones never
-- registered, a cut list, a partner not found and results computed before this
-- version (no count) keep blocking. A partner excluded by an edit outside the
-- application makes the line stale anyway (stale_takeoff_rule_peers) until the
-- server computes it again: this only settles exclusions made inside the
-- application's transaction. Only takeoff_item_rule_blocked changes (stable
-- now: it reads the partners' exclusion), so the apply trigger keeps its
-- definition.

create or replace function public.takeoff_rule_failure_left_out(p_result jsonb)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  ids jsonb;
  total jsonb;
  listed integer;
begin
  if p_result ->> 'code' = 'ZONE_OVERLAP_DUPLICATE' then
    if pg_catalog.jsonb_typeof(p_result #> '{details,partners}') is distinct from 'array' then
      return false;
    end if;
    select coalesce(pg_catalog.jsonb_agg(coalesce(partner.value -> 'item_id', 'null'::jsonb)), '[]'::jsonb)
      into ids
    from pg_catalog.jsonb_array_elements(p_result #> '{details,partners}') as partner(value);
    total := p_result #> '{details,partner_count}';
  elsif p_result ->> 'code' = 'ROOM_OVERLAP' then
    ids := p_result #> '{details,overlapping_item_ids}';
    if pg_catalog.jsonb_typeof(ids) is distinct from 'array' then
      return false;
    end if;
    total := p_result #> '{details,overlap_count}';
  else
    return false;
  end if;

  listed := pg_catalog.jsonb_array_length(ids);
  if listed = 0 or pg_catalog.jsonb_typeof(total) is distinct from 'number' then
    return false;
  end if;
  if total::text !~ '^[0-9]{1,6}$' then
    return false;
  end if;
  if total::text::integer <> listed then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(ids) as id(value)
    where pg_catalog.jsonb_typeof(id.value) is distinct from 'string'
      or (id.value #>> '{}') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
  ) then
    return false;
  end if;
  if (select count(distinct id.value) from pg_catalog.jsonb_array_elements_text(ids) as id(value)) <> listed then
    return false;
  end if;
  return not exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(ids) as id(value)
    where not exists (
      select 1 from public.takeoff_items as item
      where item.id = id.value::uuid
        and item.is_excluded
    )
  );
end;
$$;

revoke all on function public.takeoff_rule_failure_left_out(jsonb) from public, anon, authenticated;
grant execute on function public.takeoff_rule_failure_left_out(jsonb) to service_role;

-- The shared predicate of 20261103213336 (blocking.ts): a failed rule that names its partners, all left out, no
-- longer blocks. Stable instead of immutable: it reads the partners' exclusion.
create or replace function public.takeoff_item_rule_blocked(
  p_rule_results jsonb,
  p_rules_stale boolean,
  p_is_verified boolean
)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_rules_stale, false) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_rule_results) = 'array' then p_rule_results else '[]'::jsonb end
    ) as entry(value)
    where entry.value ->> 'status' = 'fail'
      and (
        entry.value -> 'acceptable' is distinct from 'true'::jsonb
        or not coalesce(p_is_verified, false)
      )
      and not public.takeoff_rule_failure_left_out(entry.value)
  );
$$;

revoke all on function public.takeoff_item_rule_blocked(jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.takeoff_item_rule_blocked(jsonb, boolean, boolean) to service_role;
