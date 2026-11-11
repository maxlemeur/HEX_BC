-- TI-682 lot B (D11, D12). No remote application is authorized here.
-- 1. An hypothesis is never preselected.
--    A line's quantity is an hypothesis when its author entered it as one (quantity_entry_category « hypothesis »,
--    TI-686 D12), or when nobody attested it and either the takeoff was asked for an estimate
--    (metadata.quantity_nature « estimated ») or a plan cannot show it (metadata.rule_inputs.non_observable, TI-664).
--    An entry attested on anything else is no hypothesis. public.takeoff_item_hypothesis_cause reads it once; its
--    TypeScript twin (src/lib/takeoff/hypothesis.ts) runs the same vectors
--    (supabase/tests/database/takeoff-hypothesis-preselection.test.sql).
--    A new line that is an hypothesis nobody attested starts excluded, with its reason: the worker writes it so, and the
--    insert trigger below holds it for every writer. Including it afterwards is its reviewer's decision (an update the
--    trigger never reads). A line written with its author's entry is left as written. A line written again from a
--    snapshot (the level A rollback) starts excluded again when it is such an hypothesis: the error falls on the side
--    of the review.
-- 2. The vector reading and the vision reading of one page are never counted together.
--    From 20261109205839_takeoff_targeted_quantity_review.sql (the latest body). Unchanged: two alternative readings
--    the worker paired (metadata.quantity_source.group) are refused. New: an included vector line the worker did not
--    pair is refused beside an included vision line of its page (file, page, source document), unless the vision
--    line's unit proves it counts something else:
--    - a count (« u ») never doubles a measure: it stays beside it;
--    - a length stays beside a measured room, a surface beside a measured run; never beside a measured insulation,
--      which the model reads in metres or in square metres;
--    - nothing else is a proof: a lump sum or a set (« fft », « ens »), a mass, a unit the referential does not
--      know, no unit.
--    For want of a proof the lines are on one page too: a page, a file or a source document missing on either line.
--    The lines the worker's selection retained keep passing: its vector lines carry their group. The exception keeps
--    its name and code; its detail says which reasoning refused, on which page and for which kind of measure
--    (src/lib/takeoff/apply-errors.ts).
--    As before, the check reads the lines as stored, before the application: a line the mapping plan skips is still
--    included here until it is excluded in the review. It reads one job: two jobs of one page are not compared. It
--    reads the page each line stores, which its reviewer may correct.
begin;

create or replace function public.takeoff_item_hypothesis_cause(p_metadata jsonb, p_quantity_entry_category text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_quantity_entry_category = 'hypothesis' then 'entered_hypothesis'
    when p_quantity_entry_category is not null then null
    when pg_catalog.jsonb_typeof(p_metadata) is distinct from 'object' then null
    when p_metadata -> 'quantity_nature' = '"estimated"'::jsonb then 'estimated'
    when pg_catalog.jsonb_typeof(p_metadata -> 'rule_inputs') = 'object'
      and pg_catalog.jsonb_typeof(p_metadata -> 'rule_inputs' -> 'non_observable') = 'string'
      and p_metadata -> 'rule_inputs' ->> 'non_observable' <> ''
      then 'non_observable'
  end;
$$;

comment on function public.takeoff_item_hypothesis_cause(jsonb, text) is
  'TI-682 D11/D12: why a takeoff line''s quantity is an hypothesis (entered_hypothesis, estimated, non_observable), or null; the same reading as src/lib/takeoff/hypothesis.ts.';

revoke all on function public.takeoff_item_hypothesis_cause(jsonb, text) from public, anon, authenticated;
grant execute on function public.takeoff_item_hypothesis_cause(jsonb, text) to service_role;

create or replace function public.exclude_new_takeoff_hypothesis()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cause text;
begin
  if new.is_excluded then
    return new;
  end if;
  cause := public.takeoff_item_hypothesis_cause(new.metadata, new.quantity_entry_category);
  if cause = 'estimated' then
    new.is_excluded := true;
    new.exclusion_reason := 'Hypothèse non présélectionnée : quantité estimée, sans mesure sur un plan. Incluez la ligne pour la compter.';
  elsif cause = 'non_observable' then
    new.is_excluded := true;
    new.exclusion_reason := 'Hypothèse non présélectionnée : quantité non lisible sur un plan. Saisissez-la avec sa justification pour la compter.';
  end if;
  return new;
end;
$$;

revoke all on function public.exclude_new_takeoff_hypothesis() from public, anon, authenticated, service_role;

drop trigger if exists exclude_new_takeoff_hypothesis on public.takeoff_items;
create trigger exclude_new_takeoff_hypothesis
  before insert on public.takeoff_items
  for each row
  execute procedure public.exclude_new_takeoff_hypothesis();

-- What a takeoff unit measures: the dimension of its referential unit (« ml » and « m » are lengths, « m2 » an area,
-- « u » a count, « fft » a lump sum…), and the metric lengths and areas the referential does not hold; null when
-- nothing says it (no unit, a pricing status such as « PM », a unit the referential does not know).
create or replace function private.takeoff_unit_dimension(p_unit text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select unit.dimension from public.measurement_units unit
      where unit.code = (private.normalize_unit(p_unit)).unit_code),
    case private.unit_token(p_unit)
      when 'cm' then 'length' when 'mm' then 'length' when 'km' then 'length'
      when 'cm2' then 'area' when 'mm2' then 'area' when 'km2' then 'area' when 'ha' then 'area'
    end);
$$;
revoke all on function private.takeoff_unit_dimension(text) from public, anon, authenticated, service_role;

create or replace function private.assert_takeoff_single_quantity_source(p_job_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare
  conflict record;
begin
  if exists(select 1 from public.takeoff_items item where item.job_id=p_job_id and not item.is_excluded
    and item.metadata#>>'{quantity_source,group}' is not null
    group by item.metadata#>>'{quantity_source,group}'
    having count(distinct item.metadata#>>'{quantity_source,origin}')>1) then
    raise exception 'TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT' using errcode='23514',
      detail=jsonb_build_object('scope','group')::text;
  end if;

  -- TI-682 (D11): a vector line the worker did not pair, beside a vision line that may be on its page and that
  -- nothing proves to count something else.
  select vector.source_file_name, vector.source_page, private.takeoff_unit_dimension(vector.unit) as dimension
    into conflict
  from public.takeoff_items vector
  join public.takeoff_items model on model.job_id=vector.job_id and not model.is_excluded
    and not coalesce(model.metadata,'{}'::jsonb) ? 'vector'
    and (model.source_file_name is null or vector.source_file_name is null
      or model.source_file_name=vector.source_file_name)
    and (model.source_page is null or vector.source_page is null or model.source_page=vector.source_page)
    and (nullif(model.metadata->'source_document','null'::jsonb) is null
      or nullif(vector.metadata->'source_document','null'::jsonb) is null
      or model.metadata->'source_document'=vector.metadata->'source_document')
    -- The vision line's unit proves another quantity: a count, or the other measure of a run or a room.
    and not coalesce(
      private.takeoff_unit_dimension(model.unit)='count'
      or (vector.metadata#>>'{vector,kind}' is distinct from 'insulation'
        and private.takeoff_unit_dimension(model.unit) in ('length','area')
        and private.takeoff_unit_dimension(vector.unit) in ('length','area')
        and private.takeoff_unit_dimension(model.unit)<>private.takeoff_unit_dimension(vector.unit)),
      false)
  where vector.job_id=p_job_id and not vector.is_excluded and vector.metadata ? 'vector'
    and vector.metadata#>>'{quantity_source,group}' is null
  order by vector.source_file_name, vector.source_page, vector.id
  limit 1;
  if found then
    raise exception 'TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT' using errcode='23514',
      detail=jsonb_build_object('scope','page','dimension',conflict.dimension,
        'source_file_name',conflict.source_file_name,'source_page',conflict.source_page)::text;
  end if;
end;
$$;
revoke all on function private.assert_takeoff_single_quantity_source(uuid) from public,anon,authenticated,service_role;

commit;
