-- TI-723. No remote application is authorized here: on the shared database it applies after
-- 20261113175750_takeoff_dpgf_merge_refusals.sql (TI-716), before the code that reads its refusal is deployed.
--
-- A line « Fusionner » never silently overwrites a DPGF line. The writer of a merge matches a takeoff line to the first
-- line of its title and unit in the target section, outside the reconciliation. TI-716 refused it onto a DPGF line this
-- application composes (it feeds the line, or replaces one of its pages) unless the reconciliation links the line to some
-- DPGF line. Onto a DPGF line it neither feeds nor replaces a page of, the writer still made the line an ordinary takeoff
-- line (source_provider 'takeoff', the takeoff's quantity), its DPGF reference and its composition, max(DPGF reference,
-- sum measured + sum protective), lost without a word (pgTAP case 23: 8 ml of DPGF reference became 9 ml of takeoff).
-- That case is now refused with the same code, TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT (40001), and the same reason,
-- merged_outside_reconciliation, whose detail names both lines and adds whether this application composes the DPGF line
-- (`composed`) and what it holds before the writer (`dpgf_quantity`, `dpgf_unit`). The way out is the reconciliation: a
-- line linked to that DPGF line feeds it through its composition, its reference kept. A merge is never turned into a
-- contribution to the composition: that would change what « Fusionner » means. A line the reconciliation links to some DPGF
-- line still counts there and is still accepted onto a DPGF line this application feeds, as TI-716 kept it.
--
-- Redefined from its newest definition (20261113175750): public.apply_takeoff_job_guarded_atomic (5 arguments); only the
-- lines marked « TI-723 » change. private.takeoff_compose_dpgf_targets, the 4-argument overload (which refuses any version
-- with a DPGF line), the page decisions, the sums and every other refusal are untouched. No data is rewritten.
begin;

-- From 20261113175750_takeoff_dpgf_merge_refusals.sql (5 arguments: a DPGF authorization), its newest definition. Only the
-- lines marked « TI-723 » change; those marked « TI-716 », « TI-682 D4 » and « TI-682 D » are unchanged.
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
  -- TI-716: a line « Fusionner » sent onto a DPGF target the application composes, outside the reconciliation. TI-723:
  -- or onto any other DPGF line of the version.
  merged_detail text;
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
  -- TI-682 D4: the version's DPGF targets as they are before anything is written: their stored compositions. TI-716: with
  -- the title, unit and quantity a refusal names (the writer may change a target's quantity before it is composed).
  drop table if exists pg_temp._d4_before;
  create temporary table _d4_before on commit drop as
  -- TI-723: with its description, where an engine 1/2 line keeps its unit (the refusal names it).
  select item.id, item.updated_at, item.source_metadata, item.title, item.unit_code, item.quantity, item.description
  from public.estimate_items item
  where item.version_id=job_version_id and item.tenant_id=job_tenant_id and item.item_type='line' and item.source_provider='dpgf';

  perform private.assert_takeoff_single_quantity_source(p_job_id);
  -- TI-682 D: the earlier contributions of the pages this takeoff reads and its decisions, before anything is written.
  perform private.takeoff_prepare_page_decisions(p_job_id, job_tenant_id, job_version_id, p_strategy, p_mapping_plan);
  select result.* into applied
  from public.apply_takeoff_job_atomic(p_job_id,p_strategy,p_target_section_id,
    private.takeoff_page_writer_plan(p_mapping_plan)) result;
  -- TI-682 D4: the composition of every DPGF target this application feeds or whose page it replaces.
  perform private.takeoff_compose_dpgf_targets(p_job_id, job_tenant_id, job_version_id, compositions);

  -- TI-716: the writer must not have put a line of this takeoff on a DPGF target it composes unless that line feeds a
  -- target (« Fusionner » matches by title and unit, outside the reconciliation): the target's composition, written below,
  -- would overwrite that measure without a word. Refused (TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT), whether this
  -- application feeds the target or only replaces one of its pages, as D4 refused the latter; never overwritten. A line
  -- that feeds some target is counted in that target's composition. Onto a target it does not feed, any line is refused
  -- (D4). The refusal names the line and the target.
  -- TI-723: and onto a DPGF line of the version this application neither feeds nor replaces a page of (_d4_before, outside
  -- _d4_composed): the writer made it an ordinary takeoff line, its DPGF reference and its composition, max(reference,
  -- sum measured + sum protective), lost without a word. Any line is refused there, linked elsewhere or not (a linked one
  -- was refused below already, without a name: the consolidation meets a line that is not its target). The way out is the
  -- reconciliation: linked to that line, it feeds it through its composition. The detail says whether this application
  -- composes the line (`composed`) and what it holds before the writer (`dpgf_quantity`, `dpgf_unit`: its unit code, or the
  -- unit an engine 1/2 line writes in its description, as the screen reads it).
  select jsonb_build_object('reason', 'merged_outside_reconciliation', 'estimate_item_id', before.id,
      'dpgf_title', before.title, 'dpgf_quantity', trim_scale(before.quantity),
      'dpgf_unit', coalesce(before.unit_code, (private.normalize_unit(before.description)).unit_code),
      'takeoff_item_id', output.takeoff_item_id, 'designation', source.designation,
      'quantity', trim_scale(source.quantity), 'unit', source.unit, 'fed', coalesce(composed.fed, false),
      'composed', composed.target_id is not null,
      'linked', exists(select 1 from pg_temp._p680_sources feeding where feeding.takeoff_item_id=output.takeoff_item_id))::text
    into merged_detail
  from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
  join pg_temp._d4_before before on before.id=output.estimate_item_id
  left join pg_temp._d4_composed composed on composed.target_id=output.estimate_item_id
  left join public.takeoff_items source on source.id=output.takeoff_item_id and source.job_id=p_job_id and source.tenant_id=job_tenant_id
  where composed.target_id is null
    or not composed.fed
    or not exists(select 1 from pg_temp._p680_sources feeding where feeding.takeoff_item_id=output.takeoff_item_id)
  order by output.takeoff_item_id
  limit 1;
  if merged_detail is not null then
    raise exception 'TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT' using errcode='40001', detail=merged_detail;
  end if;

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
    -- TI-716: a line of this takeoff the writer put on such a target was refused above, with the fed ones.
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
