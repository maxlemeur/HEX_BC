-- TI-682 lot D4. No remote application is authorized here.
-- A DPGF target sums the measures it keeps. It used to hold the measure of the last takeoff applied (« le dernier
-- gagne »): two takeoffs of two pages, or of two zones, feeding one DPGF line left it with the second one only.
--
-- What this migration changes:
-- - private.takeoff_compose_dpgf_targets (new): the composition of the DPGF targets an application touches. A target's
--   composition (source_metadata.takeoff_quantity_policy, version 2) lists what each takeoff line still brings to it, raw
--   and in its unit. The application takes out the earlier lines of the pages it replaces, adds its own lines and writes
--   max(DPGF reference, Σ measured + Σ protective); a length is rounded once, on the sum. A version 1 policy (one
--   takeoff, written before D4) is read through the composition the service read from its frozen lines, bound to the
--   target's state, its takeoff and exactly its lines; a target no policy fed holds nothing to keep.
-- - public.apply_takeoff_job_guarded_atomic (5 arguments), from its newest definition (20261112025548): it reads what
--   each line brings from the permit, keeps the version's DPGF targets as they were before the writer, writes the
--   composition, and writes a target whose page it replaces without feeding it.
-- - private.assert_takeoff_pages_once, from 20261112025548: the provisional refusals dpgf_keep_both (D-6) and
--   dpgf_not_replaced fall: keeping both counts both, replacing a page takes its part out.
-- - private.takeoff_mark_provisions, from 20261111124022: a DPGF target rests on the hypotheses of every line it keeps,
--   so its provision marker keeps the sources of the other takeoffs still in its composition (a « quantité
--   provisionnelle » declared on it stands while they do) and loses them with their page. Other lines: unchanged.
-- - A line « Fusionner » writes onto a DPGF target this application does not feed but recomposes (a page it replaces) is
--   refused (TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT), never overwritten.
-- The 4-argument overload (a version without DPGF line), the page decisions, the replacement of the other lines,
-- finalize_takeoff_lengths and the source selection (TI-681) are untouched.
-- Errors: TAKEOFF_PAGE_DECISION_INVALID « dpgf_part_unknown » (22023) when a page of a takeoff whose part per page is
-- unknown (a version 1 policy its lines no longer give back) is replaced: never all of it removed;
-- TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE (40001) when a composition or a contribution is not the service's reading.
-- No data is rewritten: a target changes only when a takeoff feeding it, or replacing one of its pages, applies; a
-- version that is no longer a draft is never written (record_takeoff_page_decisions, apply_takeoff_job_atomic).
begin;

-- The composition ---------------------------------------------------------------------------------------------------

-- The DPGF targets an application touches: those its lines feed (pg_temp._p680_targets, what each line brings in
-- pg_temp._p680_sources) and those with an earlier part on a page it replaces (pg_temp._ti682_choices). Each is read as it
-- was before the writer (pg_temp._d4_before):
-- - a version 2 policy: its contributions;
-- - a version 1 policy (one takeoff, written before D4): the composition the service read for it from its frozen lines
--   (p_compositions), bound to the target's state, its takeoff and exactly its lines; refused without it
--   (TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE): a version 1 policy is never overwritten unread;
-- - no policy: nothing.
-- The lines of the pages a decision replaces leave it (a contribution that mixes them with lines of other pages cannot be
-- cut: TAKEOFF_PAGE_DECISION_INVALID « dpgf_part_unknown »), the new takeoff's lines enter it, a line is never counted
-- twice. Fills pg_temp._d4_composed: per target, whether this application feeds it, its sums, its rounding factor and its
-- version 2 policy. Written max(DPGF reference, Σ measured + Σ protective) by the application.
create function private.takeoff_compose_dpgf_targets(p_job_id uuid, p_tenant_id uuid, p_version_id uuid, p_compositions jsonb)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  failure uuid;
begin
  if coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;
  if pg_catalog.to_regclass('pg_temp._d4_before') is null or pg_catalog.to_regclass('pg_temp._ti682_choices') is null
    or pg_catalog.to_regclass('pg_temp._p680_sources') is null then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  drop table if exists pg_temp._d4_stored;
  create temporary table _d4_stored on commit drop as
  select before.id, (target.target_id is not null) as fed, before.updated_at, before.source_metadata, policy.value as policy,
    -- The policy's version: 2 (a composition), 1 (one takeoff, before D4), 0 (none).
    case when pg_catalog.jsonb_typeof(policy.value) is distinct from 'object' then 0
      when policy.value ->> 'version' = '2' then 2
      when private.takeoff_uuid_or_null(policy.value -> 'job_id') is not null
        and pg_catalog.jsonb_typeof(policy.value -> 'item_ids') = 'array' then 1
      else 0 end as kind,
    (select reading.value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_compositions) = 'array'
        then p_compositions else '[]'::jsonb end) as reading(value)
      where private.takeoff_uuid_or_null(reading.value -> 'target_id') = before.id limit 1) as reading,
    coalesce(target.reference_quantity,
      case when pg_catalog.jsonb_typeof(policy.value -> 'reference_quantity') = 'number' then (policy.value ->> 'reference_quantity')::numeric end,
      case when pg_catalog.jsonb_typeof(before.source_metadata -> 'dpgf_source_quantity') = 'number'
        then (before.source_metadata ->> 'dpgf_source_quantity')::numeric end) as reference,
    coalesce(target.reviewed, false) as reviewed
  from pg_temp._d4_before as before
  left join pg_temp._p680_targets as target on target.target_id = before.id
  cross join lateral (select before.source_metadata -> 'takeoff_quantity_policy' as value) as policy
  where target.target_id is not null
    or exists (select 1 from pg_temp._ti682_choices as choice where choice.estimate_item_id = before.id and choice.decision = 'replace');

  -- A version 1 policy is read through the service's composition of exactly its takeoff and its lines.
  if exists (select 1 from pg_temp._d4_stored as stored
    cross join lateral (select array(select private.takeoff_uuid_or_null(id.value) from pg_catalog.jsonb_array_elements(stored.policy -> 'item_ids') as id(value)
      order by 1) as ids) as own
    where stored.kind = 1 and (stored.reading is null
      or (stored.reading ->> 'expected_updated_at')::timestamptz is distinct from stored.updated_at
      or private.takeoff_uuid_or_null(stored.reading -> 'job_id') is distinct from private.takeoff_uuid_or_null(stored.policy -> 'job_id')
      or pg_catalog.jsonb_typeof(stored.reading -> 'contributions') is distinct from 'array'
      or pg_catalog.jsonb_array_length(stored.reading -> 'contributions') = 0
      or array(select private.takeoff_uuid_or_null(id.value) from pg_catalog.jsonb_array_elements(stored.reading -> 'item_ids') as id(value)
        order by 1) is distinct from own.ids
      or array(select private.takeoff_uuid_or_null(id.value) from pg_catalog.jsonb_array_elements(stored.reading -> 'contributions') as part(value)
        cross join lateral pg_catalog.jsonb_array_elements(part.value -> 'item_ids') as id(value) order by 1) is distinct from own.ids
      or exists (select 1 from pg_catalog.jsonb_array_elements(stored.reading -> 'contributions') as part(value)
        where private.takeoff_uuid_or_null(part.value -> 'job_id') is distinct from private.takeoff_uuid_or_null(stored.policy -> 'job_id')))) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode = '40001';
  end if;

  drop table if exists pg_temp._d4_parts;
  create temporary table _d4_parts on commit drop as
  select stored.id as target_id, private.takeoff_uuid_or_null(part.value -> 'job_id') as job_id,
    array(select private.takeoff_uuid_or_null(id.value) from pg_catalog.jsonb_array_elements(part.value -> 'item_ids') as id(value)
      order by 1) as item_ids,
    case when pg_catalog.jsonb_typeof(part.value -> 'quantity') = 'number' then (part.value ->> 'quantity')::numeric end as quantity,
    case when pg_catalog.jsonb_typeof(part.value -> 'protective') = 'number' then (part.value ->> 'protective')::numeric else 0 end as protective,
    case when pg_catalog.jsonb_typeof(part.value -> 'printed_gap') = 'number' then (part.value ->> 'printed_gap')::numeric else 0 end as printed_gap
  from pg_temp._d4_stored as stored
  cross join lateral pg_catalog.jsonb_array_elements(case stored.kind when 2 then coalesce(stored.policy -> 'contributions', '[]'::jsonb)
    when 1 then stored.reading -> 'contributions' else '[]'::jsonb end) as part(value);
  if exists (select 1 from pg_temp._d4_parts as part where part.job_id is null or part.quantity is null or part.quantity < 0
      or part.protective < 0 or part.printed_gap < 0 or pg_catalog.cardinality(part.item_ids) = 0
      or pg_catalog.array_position(part.item_ids, null) is not null) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode = '40001';
  end if;

  -- The earlier lines of the pages replaced: a contribution goes whole, or stays whole.
  drop table if exists pg_temp._d4_removed;
  create temporary table _d4_removed on commit drop as
  select distinct choice.estimate_item_id as target_id, removed.id as item_id
  from pg_temp._ti682_choices as choice cross join lateral pg_catalog.unnest(choice.item_ids) as removed(id)
  where choice.decision = 'replace';
  select part.target_id into failure
  from pg_temp._d4_parts as part
  where exists (select 1 from pg_catalog.unnest(part.item_ids) as id(value) join pg_temp._d4_removed as removed
      on removed.target_id = part.target_id and removed.item_id = id.value)
    and exists (select 1 from pg_catalog.unnest(part.item_ids) as id(value) where not exists (select 1 from pg_temp._d4_removed as removed
      where removed.target_id = part.target_id and removed.item_id = id.value))
  order by part.target_id
  limit 1;
  if failure is not null then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('scope', 'page', 'reason', 'dpgf_part_unknown', 'estimate_item_id', failure)::text;
  end if;
  delete from pg_temp._d4_parts as part
  where exists (select 1 from pg_catalog.unnest(part.item_ids) as id(value) join pg_temp._d4_removed as removed
    on removed.target_id = part.target_id and removed.item_id = id.value);

  -- The new takeoff's lines, as the service measured them.
  insert into pg_temp._d4_parts (target_id, job_id, item_ids, quantity, protective, printed_gap)
  select source.target_id, p_job_id, array[source.takeoff_item_id], source.measured, source.protective, source.printed_gap
  from pg_temp._p680_sources as source;

  -- A line is counted once: never twice in one target, never in two targets, and the new takeoff only by its own lines.
  if exists (select 1 from pg_temp._d4_parts as part cross join lateral pg_catalog.unnest(part.item_ids) as id(value)
      group by id.value having pg_catalog.count(*) > 1)
    or exists (select 1 from pg_temp._d4_parts as part where part.job_id = p_job_id
      and not exists (select 1 from pg_temp._p680_sources as source where source.target_id = part.target_id
        and part.item_ids = array[source.takeoff_item_id])) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode = '40001';
  end if;

  drop table if exists pg_temp._d4_composed;
  create temporary table _d4_composed on commit drop as
  select sums.target_id, sums.fed, sums.reference, sums.measured, sums.protective, written.priced, written.absolute_gap,
    unit.factor,
    -- Version 2: its sums, the takeoff that wrote it last, every line it keeps and what each brings.
    pg_catalog.jsonb_build_object('version', 2, 'job_id', p_job_id, 'reference_quantity', sums.reference,
      'measured_quantity', sums.measured, 'priced_quantity', written.priced, 'absolute_gap', written.absolute_gap,
      'reviewed', sums.reviewed, 'item_ids', sums.item_ids, 'contributions', sums.contributions) as policy
  from (
    select stored.id as target_id, stored.fed, stored.reference, stored.reviewed,
      pg_catalog.trim_scale(pg_catalog.round(coalesce(pg_catalog.sum(part.quantity), 0), 4)) as measured,
      pg_catalog.trim_scale(pg_catalog.round(coalesce(pg_catalog.sum(part.protective), 0), 4)) as protective,
      coalesce(pg_catalog.sum(part.printed_gap), 0) as printed_gap,
      coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', part.job_id, 'item_ids', pg_catalog.to_jsonb(part.item_ids),
          'quantity', part.quantity, 'protective', part.protective, 'printed_gap', part.printed_gap)
        order by part.job_id, part.item_ids[1]) filter (where part.target_id is not null), '[]'::jsonb) as contributions,
      coalesce((select pg_catalog.jsonb_agg(id.value order by id.value) from pg_temp._d4_parts as own
        cross join lateral pg_catalog.unnest(own.item_ids) as id(value) where own.target_id = stored.id), '[]'::jsonb) as item_ids
    from pg_temp._d4_stored as stored
    left join pg_temp._d4_parts as part on part.target_id = stored.id
    group by stored.id, stored.fed, stored.reference, stored.reviewed
  ) as sums
  cross join lateral (select pg_catalog.trim_scale(pg_catalog.round(greatest(coalesce(sums.reference, 0),
      sums.measured + sums.protective), 4)) as priced,
    case when sums.reference is not null then pg_catalog.trim_scale(pg_catalog.round(greatest(pg_catalog.abs(sums.measured - sums.reference),
      sums.printed_gap), 4)) end as absolute_gap) as written
  join public.estimate_items as item on item.id = sums.target_id and item.version_id = p_version_id and item.tenant_id = p_tenant_id
  cross join lateral (select case coalesce((private.normalize_unit(coalesce(item.unit_code, item.description))).unit_code,
      private.unit_token(coalesce(item.unit_code, item.description)))
      when 'm' then 1::numeric when 'ml' then 1::numeric when 'metre' then 1::numeric when 'metres' then 1::numeric
      when 'cm' then 0.01::numeric when 'mm' then 0.001::numeric when 'km' then 1000::numeric end as factor) as unit;
end;
$$;
revoke all on function private.takeoff_compose_dpgf_targets(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;


-- The provisions -----------------------------------------------------------------------------------------------------

-- From 20261111124022_takeoff_hypothesis_provision_marker.sql, its newest definition; only the lines marked « TI-682 D4 »
-- change. Both overloads of apply_takeoff_job_guarded_atomic call it, on the links the application left: a line that is
-- not a DPGF target is marked exactly as before (its sources, this takeoff's, in the same order).
create or replace function private.takeoff_mark_provisions(
  p_job_id uuid,
  p_tenant_id uuid,
  p_version_id uuid,
  p_item_links jsonb,
  p_created_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  engine smallint;
  old_writer text := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
begin
  select version.calc_engine_version
    into engine
  from public.estimate_versions as version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id;

  -- A v3 draft's lines are written under its writer contract (the amounts are not touched).
  if engine = 3 then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', p_version_id::text, true);
  end if;

  -- TI-686 M4: the forced lines and their coded reason, from the forced entries of the consumed audit (one per blocked
  -- line, enforce_takeoff_apply_security); a job applies once, the latest audit wins should it not.
  with forced as (
    select distinct on (entry.value ->> 'item_id')
      entry.value ->> 'item_id' as item_id,
      entry.value ->> 'reason_code' as reason_code
    from public.takeoff_apply_override_consumptions as consumed
    join public.audit_logs as audit
      on audit.id = consumed.audit_log_id
     and audit.tenant_id = consumed.tenant_id
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(audit.after_data #> '{metadata,forced_items}') = 'array'
        then audit.after_data #> '{metadata,forced_items}' else '[]'::jsonb end
    ) as entry(value)
    where consumed.job_id = p_job_id
      and consumed.tenant_id = p_tenant_id
      and consumed.estimate_version_id = p_version_id
      and pg_catalog.jsonb_typeof(entry.value) = 'object'
      and pg_catalog.jsonb_typeof(entry.value -> 'item_id') = 'string'
    order by entry.value ->> 'item_id', audit.created_at desc, audit.id desc
  ),
  links as (
    select link.estimate_item_id, link.takeoff_item_id
    from pg_catalog.jsonb_to_recordset(
      case when pg_catalog.jsonb_typeof(p_item_links) = 'array' then p_item_links else '[]'::jsonb end
    ) as link(takeoff_item_id text, estimate_item_id uuid)
    union
    select item.id, item.source_metadata ->> 'takeoff_item_id'
    from public.estimate_items as item
    where item.id = any(coalesce(p_created_ids, '{}'::uuid[]))
      and item.version_id = p_version_id
      and item.tenant_id = p_tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.source_metadata ->> 'mapping_action' = 'apply_assembly'
    -- TI-682 D4: every DPGF target this application composed (its version 2 policy names this takeoff), one it no longer
    -- feeds included (a page it replaces took its part out).
    union
    select item.id, null::text
    from public.estimate_items as item
    where item.version_id = p_version_id
      and item.tenant_id = p_tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.source_provider = 'dpgf'
      and item.source_metadata #>> '{takeoff_quantity_policy,version}' = '2'
      and item.source_metadata #>> '{takeoff_quantity_policy,job_id}' = p_job_id::text
  ),
  -- TI-682 D4: a DPGF target sums the measures it keeps, so it rests on the hypotheses of every line it keeps: the sources
  -- its marker names from the other takeoffs stay while their lines stay in its composition, and leave with them.
  earlier as (
    select item.id as estimate_item_id, pg_catalog.jsonb_agg(source.value) as sources
    from public.estimate_items as item
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(item.source_metadata #> '{takeoff_provision,sources}') = 'array'
        then item.source_metadata #> '{takeoff_provision,sources}' else '[]'::jsonb end) as source(value)
    where item.version_id = p_version_id
      and item.tenant_id = p_tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.source_provider = 'dpgf'
      and item.source_metadata #>> '{takeoff_quantity_policy,version}' = '2'
      and item.source_metadata #>> '{takeoff_quantity_policy,job_id}' = p_job_id::text
      and pg_catalog.jsonb_typeof(item.source_metadata #> '{takeoff_quantity_policy,item_ids}') = 'array'
      and pg_catalog.jsonb_typeof(source.value -> 'takeoff_item_id') = 'string'
      and item.source_metadata #> '{takeoff_quantity_policy,item_ids}' @> pg_catalog.jsonb_build_array(source.value -> 'takeoff_item_id')
      and not exists (select 1 from public.takeoff_items as own
        where own.id = private.takeoff_uuid_or_null(source.value -> 'takeoff_item_id') and own.job_id = p_job_id)
    group by item.id
  ),
  marked as (
    select
      links.estimate_item_id,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id,
          'forced', forced.item_id is not null,
          'forced_reason', forced.reason_code,
          'entry_category', source.quantity_entry_category,
          -- TI-682 lot C: why the source is an hypothesis (entered_hypothesis, estimated, non_observable), or null.
          'hypothesis_cause', public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category)
        )
        order by source.id
      -- TI-682 lot C: a forced source, or any hypothesis (an entered one as before, now also an estimate or a quantity a
      -- plan cannot show that its reviewer included without entering it).
      ) filter (where forced.item_id is not null
        or public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is not null) as sources
    from links
    left join public.takeoff_items as source
      on source.id::text = links.takeoff_item_id
     and source.job_id = p_job_id
     and source.tenant_id = p_tenant_id
    left join forced
      on forced.item_id = source.id::text
    group by links.estimate_item_id
  ),
  -- TI-682 D4: this takeoff's sources and those a DPGF target keeps of the other takeoffs, by takeoff line.
  combined as (
    select marked.estimate_item_id,
      (select pg_catalog.jsonb_agg(entry.value order by entry.value ->> 'takeoff_item_id')
        from pg_catalog.jsonb_array_elements(coalesce(marked.sources, '[]'::jsonb) || coalesce(earlier.sources, '[]'::jsonb))
          as entry(value)) as sources
    from marked
    left join earlier on earlier.estimate_item_id = marked.estimate_item_id
  ),
  next_state as (
    select
      item.id,
      case
        when combined.sources is null then item.source_metadata - 'takeoff_provision'
        else coalesce(item.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_provision',
          pg_catalog.jsonb_build_object('version', 1, 'job_id', p_job_id, 'sources', combined.sources))
      end as source_metadata
    from combined
    join public.estimate_items as item
      on item.id = combined.estimate_item_id
     and item.version_id = p_version_id
     and item.tenant_id = p_tenant_id
     and item.item_type = 'line'::public.estimate_item_type
  )
  update public.estimate_items as item
  set source_metadata = next_state.source_metadata
  from next_state
  where item.id = next_state.id
    and item.version_id = p_version_id
    and item.tenant_id = p_tenant_id
    and item.source_metadata is distinct from next_state.source_metadata;

  if engine = 3 then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);
  end if;
end;
$$;

comment on function private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[]) is
  'TI-686 D10/D12, TI-682 lot C and D4: writes or removes source_metadata.takeoff_provision on the estimate lines a takeoff application touched (final links, materialized ouvrage lines and the DPGF targets it composed): sources forced by the consumed override audit of the job (with their coded reason) or resting on an hypothesis (public.takeoff_item_hypothesis_cause: entered, estimated or not observable), each with its hypothesis_cause; a DPGF target also keeps the sources of the other takeoffs whose lines its composition keeps. Internal display only (H9). Called by both overloads of public.apply_takeoff_job_guarded_atomic only.';

revoke all on function private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated, service_role;


-- The last net, after everything the application wrote: on every page the takeoff now brings into the estimate, each
-- earlier contribution still there is one a decision keeps (« keep_both », or a line kept in a replacement), source
-- line by source line. Without any decision: TAKEOFF_PAGE_ALREADY_APPLIED, the first page named. With decisions that
-- no longer cover the estimate: TAKEOFF_PAGE_DECISION_STALE. TI-682 D4: a DPGF target sums the measures it keeps, so
-- « keep both » and a replacement of its page are no longer refused for it (dpgf_keep_both and dpgf_not_replaced fall):
-- its composition keeps or loses the page's part (private.takeoff_compose_dpgf_targets).
create or replace function private.assert_takeoff_pages_once(p_job_id uuid, p_version_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  job_tenant uuid;
  uncovered jsonb;
  has_decisions boolean;
begin
  if coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;
  select job.tenant_id into job_tenant from public.takeoff_jobs as job where job.id = p_job_id;
  select exists (select 1 from public.takeoff_page_decisions as decision
    where decision.job_id = p_job_id and decision.tenant_id = job_tenant and decision.estimate_version_id = p_version_id
      and decision.decided_by = (select auth.uid()))
    into has_decisions;

  -- The pages the takeoff now brings: its lines still included once the application left out what the mapping plan
  -- skips or folds into an assembly.
  drop table if exists pg_temp._ti682_uncovered;
  create temporary table _ti682_uncovered on commit drop as
  select conflict.*
  from private.takeoff_page_conflicts(p_version_id, p_job_id, null) as conflict
  where not exists (select 1 from public.takeoff_page_decisions as decision
    cross join lateral pg_catalog.jsonb_array_elements(decision.lines) as line(value)
    where decision.job_id = p_job_id and decision.tenant_id = job_tenant and decision.estimate_version_id = p_version_id
      and decision.decided_by = (select auth.uid())
      and (line.value ->> 'estimate_item_id')::uuid = conflict.estimate_item_id
      and (decision.decision = 'keep_both' or line.value ->> 'action' = 'keep')
      and (conflict.earlier_item_id is null or line.value -> 'item_ids' @> pg_catalog.jsonb_build_array(conflict.earlier_item_id)));

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('estimate_item_id', conflict.estimate_item_id,
      'earlier_job_id', conflict.earlier_job_id, 'source_file_name', conflict.source_file_name,
      'source_page', conflict.source_page, 'plan_file_id', (select new_item.metadata #>> '{source_document,plan_file_id}'
        from public.takeoff_items as new_item where new_item.id = any(conflict.new_item_ids)
          and new_item.metadata #>> '{source_document,kind}' = 'plan_file' order by new_item.id limit 1))
      order by conflict.page_rank, conflict.estimate_item_id)
    into uncovered
  from pg_temp._ti682_uncovered as conflict
  where conflict.page_rank = (select pg_catalog.min(first.page_rank) from pg_temp._ti682_uncovered as first);
  if uncovered is not null then
    if has_decisions then
      raise exception 'TAKEOFF_PAGE_DECISION_STALE' using errcode = '40001',
        detail = private.takeoff_page_refusal_detail('page_not_decided', uncovered);
    end if;
    raise exception 'TAKEOFF_PAGE_ALREADY_APPLIED' using errcode = '23514',
      detail = private.takeoff_page_refusal_detail('page_already_applied', uncovered);
  end if;

end;
$$;
revoke all on function private.assert_takeoff_pages_once(uuid, uuid) from public, anon, authenticated, service_role;


-- From 20261112025548_takeoff_page_decisions.sql (5 arguments: a DPGF authorization), its newest definition. Lines marked
-- « TI-682 D4 »; those marked « TI-682 D » are unchanged.
create or replace function public.apply_takeoff_job_guarded_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb,
  p_dpgf_authorization_token text
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text,
  item_links jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := (select auth.uid());
  job_tenant_id uuid;
  job_version_id uuid;
  authorization_id uuid;
  quantity_policy jsonb;
  quantity_sources jsonb;
  comparison_stamp text;
  applied record;
  engine integer;
  old_writer text;
  removed_ids uuid[] := '{}'::uuid[];
  additional_updates integer := 0;
  -- TI-686 M3: the finalized result, returned once its provisions are marked.
  final_result record;
  -- TI-682 D: the links after the DPGF consolidation, and what the page replacement did with them.
  consolidated_links jsonb;
  replaced record;
  -- TI-682 D4: the compositions the service read for the version 1 policies of the version's DPGF targets.
  compositions jsonb;
begin
  if caller_id is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if lower(btrim(coalesce(p_strategy, ''))) = 'replace'
    and p_target_section_id is null
  then
    raise exception 'TAKEOFF_ROOT_REPLACE_DISABLED' using errcode = '22023';
  end if;

  select job.tenant_id, job.estimate_version_id
    into job_tenant_id, job_version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(
      job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ), false)
  then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  perform public.assert_takeoff_active_tenant(p_job_id, job_tenant_id);

  select permit.id, coalesce(permit.review_summary->'quantity_policy', '[]'::jsonb), permit.review_summary->'quantity_sources', permit.review_summary->>'quantity_version_stamp',
    -- TI-682 D4
    coalesce(permit.review_summary->'dpgf_compositions', '[]'::jsonb)
    into authorization_id, quantity_policy, quantity_sources, comparison_stamp, compositions
  from public.takeoff_apply_authorizations as permit
  where permit.authorization_token_hash = encode(
      sha256(convert_to(p_dpgf_authorization_token, 'UTF8')),
      'hex'
    )
    and permit.tenant_id = job_tenant_id
    and permit.job_id = p_job_id
    and permit.estimate_version_id = job_version_id
    and permit.user_id = caller_id
    and permit.consumed_at is null
    and permit.expires_at > statement_timestamp()
  for update;

  if authorization_id is null then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_INVALID'
      using errcode = '42501';
  end if;

  update public.takeoff_apply_authorizations as permit
  set
    authorization_token_hash = null,
    consumed_at = statement_timestamp()
  where permit.id = authorization_id;

  -- TI-677: the version's lock (the writer's and the review's) before any lock on the job or its lines: a save of
  -- another job's line waits for the application instead of invalidating the job being applied.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job_version_id::text, 0));
  perform set_config('app.takeoff_apply_job', 'on', true);
  perform set_config('app.takeoff_apply_atomic', 'on', true);
  -- The service minted a snapshot of every target/source used in this comparison.
  -- Lock the version before checking it and before the inner writer locks a job.
  select version.calc_engine_version into engine
  from public.estimate_versions version
  where version.id=job_version_id and version.tenant_id=job_tenant_id
  for update;

  if comparison_stamp is not null and comparison_stamp is distinct from public.takeoff_rule_version_stamp(job_tenant_id,job_version_id) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  if quantity_sources is not null and (
    jsonb_array_length(quantity_sources) <> (select count(*) from public.takeoff_items where job_id=p_job_id and tenant_id=job_tenant_id)
    or exists(select 1 from jsonb_to_recordset(quantity_sources)
      as snapshot(id uuid,updated_at timestamptz,quantity numeric,designation text,unit text,is_excluded boolean)
      left join public.takeoff_items item on item.id=snapshot.id and item.job_id=p_job_id and item.tenant_id=job_tenant_id
        and item.updated_at=snapshot.updated_at and item.quantity=snapshot.quantity and item.designation=snapshot.designation
        and item.unit=snapshot.unit and item.is_excluded=snapshot.is_excluded
      where item.id is null)) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  drop table if exists pg_temp._p680_targets;
  create temporary table _p680_targets on commit drop as
  select policy.*, item.title as original_title, item.description as original_description,
    item.unit_price_ht_cents as original_price, item.category_id as original_category
  from jsonb_to_recordset(quantity_policy) as policy(
    target_id uuid, expected_updated_at timestamptz, reference_quantity numeric, measured_quantity numeric,
    priced_quantity numeric, absolute_gap numeric, reviewed boolean, review_decision_id uuid, review_updated_at timestamptz,
    source_file_name text, source_page integer,
    source_metadata jsonb, takeoff_items jsonb)
  left join public.estimate_items item on item.id=policy.target_id
    and item.version_id=job_version_id and item.tenant_id=job_tenant_id
    and item.source_provider='dpgf' and item.updated_at=policy.expected_updated_at;
  create unique index on pg_temp._p680_targets(target_id);

  if exists(select 1 from pg_temp._p680_targets) then
    if lower(btrim(p_strategy)) <> 'merge' then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MERGE_REQUIRED' using errcode='22023';
    end if;
    if exists(select 1 from pg_temp._p680_targets where original_title is null
      or measured_quantity is null or priced_quantity is null
      or reference_quantity<0 or measured_quantity<0 or priced_quantity<greatest(reference_quantity,measured_quantity)
      or source_metadata is null or jsonb_typeof(takeoff_items) is distinct from 'array'
      or jsonb_array_length(takeoff_items)=0) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
    end if;
    if exists(select 1 from pg_temp._p680_targets target where coalesce(reviewed,false)
      and not exists(select 1 from public.takeoff_dpgf_review_decisions decision
        where decision.id=target.review_decision_id and decision.tenant_id=job_tenant_id
          and decision.takeoff_job_id=p_job_id and decision.updated_at=target.review_updated_at)) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
    end if;
    -- TI-681: quantity differences recommend review; the protective maximum remains mandatory.
  end if;

  drop table if exists pg_temp._p680_sources;
  create temporary table _p680_sources on commit drop as
  -- TI-682 D4: with what each line brings to its target (in the target's unit, raw), the composition's new part.
  select target.target_id, source.id as takeoff_item_id, source.quantity, source.updated_at,
    source.measured, source.protective, source.printed_gap
  from pg_temp._p680_targets target cross join lateral jsonb_to_recordset(target.takeoff_items)
    as source(id uuid,quantity numeric,updated_at timestamptz,measured numeric,protective numeric,printed_gap numeric);
  create unique index on pg_temp._p680_sources(takeoff_item_id);
  if exists(select 1 from pg_temp._p680_sources source
    left join public.takeoff_items item on item.id=source.takeoff_item_id and item.job_id=p_job_id
      and item.tenant_id=job_tenant_id and not item.is_excluded
      and item.updated_at=source.updated_at and item.quantity=source.quantity
    where item.id is null) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  -- TI-682 D4: what each line brings is the service's, bound to the measure it authorized for its target.
  if exists(select 1 from pg_temp._p680_sources source where source.measured is null or source.measured<0
      or coalesce(source.protective,-1)<0 or coalesce(source.printed_gap,-1)<0)
    or exists(select 1 from pg_temp._p680_targets target where target.measured_quantity is distinct from
      (select round(sum(source.measured),4) from pg_temp._p680_sources source where source.target_id=target.target_id)) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;
  -- TI-682 D4: the version's DPGF targets as they are before anything is written: their stored compositions.
  drop table if exists pg_temp._d4_before;
  create temporary table _d4_before on commit drop as
  select item.id, item.updated_at, item.source_metadata from public.estimate_items item
  where item.version_id=job_version_id and item.tenant_id=job_tenant_id and item.item_type='line' and item.source_provider='dpgf';

  perform private.assert_takeoff_single_quantity_source(p_job_id);
  -- TI-682 D: the earlier contributions of the pages this takeoff reads and its decisions, before anything is written.
  perform private.takeoff_prepare_page_decisions(p_job_id, job_tenant_id, job_version_id, p_strategy, p_mapping_plan);
  select result.* into applied
  from public.apply_takeoff_job_atomic(p_job_id,p_strategy,p_target_section_id,
    private.takeoff_page_writer_plan(p_mapping_plan)) result;
  -- TI-682 D4: the composition of every DPGF target this application feeds or whose page it replaces.
  perform private.takeoff_compose_dpgf_targets(p_job_id, job_tenant_id, job_version_id, compositions);

  if exists(select 1 from pg_temp._p680_targets) then
    -- Retain all existing mapping/engine guards. Only this invocation's newly created duplicate
    -- outputs may be consolidated; another pre-existing estimate line must never be deleted.
    drop table if exists pg_temp._p680_outputs;
    create temporary table _p680_outputs on commit drop as
    select source.target_id, source.takeoff_item_id, output.estimate_item_id,
      plan.action, plan.unit_price_cents, plan.category_id
    from pg_temp._p680_sources source
    left join jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      on output.takeoff_item_id=source.takeoff_item_id
    left join jsonb_to_recordset(p_mapping_plan) as plan(item_id uuid,action text,unit_price_cents integer,category_id uuid)
      on plan.item_id=source.takeoff_item_id;
    if exists(select 1 from pg_temp._p680_outputs output where output.estimate_item_id is null
      or (not output.estimate_item_id=any(applied.created_ids)
        and not exists(select 1 from pg_temp._p680_targets target where target.target_id=output.estimate_item_id))) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT' using errcode='40001';
    end if;
    if exists(select 1 from pg_temp._p680_outputs group by target_id
      having count(distinct unit_price_cents) filter(where action='set_price')>1
        or count(distinct category_id) filter(where action='set_category')>1) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT' using errcode='22023';
    end if;
    old_writer:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
    if engine=3 then perform set_config('miaouffrage.estimate_v3_writer',job_version_id::text,true); end if;

    select count(*)::integer into additional_updates from pg_temp._p680_targets target
    where not exists(select 1 from pg_temp._p680_outputs output where output.estimate_item_id=target.target_id
      and not output.estimate_item_id=any(applied.created_ids));

    -- TI-682 D4: the target sums the measures it keeps (rounded once, on the sum, by finalize_takeoff_lengths).
    update public.estimate_items item set
      quantity=composed.priced,
      title=target.original_title, description=target.original_description,
      unit_price_ht_cents=coalesce(mapping.unit_price_cents,target.original_price),
      category_id=case when mapping.has_category then mapping.category_id else target.original_category end,
      source_provider='dpgf', source_job_id=p_job_id,
      source_file_name=target.source_file_name, source_page=target.source_page,
      source_metadata=target.source_metadata||jsonb_build_object('takeoff_quantity_policy',composed.policy),
      updated_at=statement_timestamp()
    from pg_temp._p680_targets target
    join pg_temp._d4_composed composed on composed.target_id=target.target_id
    join (select target_id,
      max(unit_price_cents) filter(where action='set_price') as unit_price_cents,
      (array_agg(category_id) filter(where action='set_category'))[1] as category_id,
      bool_or(action='set_category') as has_category,
      jsonb_agg(takeoff_item_id order by takeoff_item_id) as item_ids
      from pg_temp._p680_outputs group by target_id) mapping on mapping.target_id=target.target_id
    where item.id=target.target_id and item.version_id=job_version_id and item.tenant_id=job_tenant_id;

    select coalesce(array_agg(distinct output.estimate_item_id),'{}'::uuid[]) into removed_ids
    from pg_temp._p680_outputs output where output.estimate_item_id=any(applied.created_ids)
      and not exists(select 1 from pg_temp._p680_targets target where target.target_id=output.estimate_item_id);
    delete from public.estimate_items item where item.id=any(removed_ids)
      and item.version_id=job_version_id and item.tenant_id=job_tenant_id;

    if engine=3 then
      perform public.estimate_v3_complete_entry_for_writer(job_version_id,
        coalesce((select array_agg(target_id) from pg_temp._p680_targets),'{}'::uuid[]));
      perform set_config('miaouffrage.estimate_v3_writer',old_writer,true);
    else
      perform public.recalculate_takeoff_estimate_version(job_version_id,job_tenant_id);
    end if;
  end if;

  -- TI-682 D4: a target whose page this application replaces without feeding it loses that page's part (its new measure
  -- entered elsewhere, or nowhere). Rounded here, once, on what it keeps: no line of this takeoff reaches it.
  if exists(select 1 from pg_temp._d4_composed composed where not composed.fed) then
    -- TI-682 D4: the writer must not have put a line of this takeoff on such a target (« Fusionner » matches by title and
    -- unit, outside the reconciliation): its composition would overwrite that measure. Refused, as replacing its page was
    -- before the sum (dpgf_not_replaced).
    if exists(select 1 from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      join pg_temp._d4_composed composed on composed.target_id=output.estimate_item_id and not composed.fed) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT' using errcode='40001';
    end if;
    old_writer:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
    if engine=3 then perform set_config('miaouffrage.estimate_v3_writer',job_version_id::text,true); end if;
    update public.estimate_items item set
      quantity=case when composed.factor is not null then ceil(composed.priced*composed.factor)/composed.factor else composed.priced end,
      source_provider='dpgf', source_job_id=p_job_id,
      source_metadata=(before.source_metadata-'takeoff_length_rounding')||jsonb_build_object('takeoff_quantity_policy',composed.policy),
      updated_at=statement_timestamp()
    from pg_temp._d4_composed composed
    join pg_temp._d4_before before on before.id=composed.target_id
    where not composed.fed and item.id=composed.target_id and item.version_id=job_version_id and item.tenant_id=job_tenant_id;
    additional_updates:=additional_updates+(select count(*)::integer from pg_temp._d4_composed composed where not composed.fed);
    if engine=3 then
      perform public.estimate_v3_complete_entry_for_writer(job_version_id,
        coalesce((select array_agg(composed.target_id) from pg_temp._d4_composed composed where not composed.fed),'{}'::uuid[]));
      perform set_config('miaouffrage.estimate_v3_writer',old_writer,true);
    else
      perform public.recalculate_takeoff_estimate_version(job_version_id,job_tenant_id);
    end if;
  end if;

  -- TI-682 D: the links after the DPGF consolidation (a source of a target now on its target), then the replaced pages.
  consolidated_links := coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',output.takeoff_item_id,
      'estimate_item_id',coalesce(source.target_id,output.estimate_item_id)) order by output.takeoff_item_id)
      from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._p680_sources source on source.takeoff_item_id=output.takeoff_item_id),'[]'::jsonb);
  select result.* into replaced from private.takeoff_replace_pages(p_job_id, job_tenant_id, job_version_id,
    consolidated_links, coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[])) as result;
  removed_ids := removed_ids || replaced.removed_ids;

  -- TI-686 M3: the finalized result of 20261109205839 (merged length lines), kept to mark its provisions first.
  -- TI-682 D: on the links the replacement left.
  select finalized.* into final_result from private.finalize_takeoff_lengths(p_job_id,
    applied.created_count-(select count(*)::integer from unnest(applied.created_ids) ids(id) where id=any(removed_ids)),
    applied.updated_count+additional_updates+cardinality(replaced.updated_ids),applied.ignored_count,
    coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[]),applied.scope,
    replaced.remaining_links,p_mapping_plan) finalized;
  -- TI-682 D: a page another takeoff brought enters only by a decision.
  perform private.assert_takeoff_pages_once(p_job_id, job_version_id);
  -- TI-686 M3: a forced line or an entered hypothesis enters the estimate as an internal provision. TI-682 D: the
  -- replaced lines too, from the new takeoff's sources (the last takeoff wins).
  final_result.item_links := coalesce((select jsonb_agg(link.value order by link.value ->> 'takeoff_item_id')
    from jsonb_array_elements(coalesce(final_result.item_links, '[]'::jsonb) || replaced.handled_links) as link(value)), '[]'::jsonb);
  perform private.takeoff_mark_provisions(p_job_id,job_tenant_id,job_version_id,final_result.item_links,
    final_result.created_ids);
  return query select final_result.created_count,final_result.updated_count,final_result.ignored_count,
    final_result.created_ids,final_result.scope,final_result.item_links;
end;
$$;

revoke all on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb, text
) from public, anon;
grant execute on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb, text
) to authenticated;

commit;
