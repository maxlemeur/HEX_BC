-- TI-686 D10/D12 (lot 2, M3). No remote application is authorized here.
-- A takeoff line an administrator forced past the apply guard (D10; H8: whatever still blocks it since TI-681: no
-- localized proof or page on level C, results to compute again, a failure of a blocking rule such as a blocked
-- material), or whose quantity was entered as a hypothesis (D12), reaches the estimate as an internal provision. The
-- estimate line built from it carries source_metadata.takeoff_provision:
--   {"version": 1, "job_id": "…", "sources": [{"takeoff_item_id": "…", "forced": true|false, "forced_reason": null,
--     "entry_category": <the item's quantity_entry_category>}]}
-- with only the sources that are provisions (forced, or entered as a hypothesis). It states facts (H18): the explicit
-- treatment TI-682 will add (a reserve in the offer) lives outside it, under the reserved key offer_treatment, which
-- this lot neither writes nor reads; the default treatment is the internal provision. The line prints to the client
-- as an ordinary priced line whose amount is the provision (H9): no client output reads source_metadata, and the
-- override is never printed. The marker is an internal display, never a guard: a draft's source_metadata stays
-- writable through the Data API, copies carry it and a later manual edit keeps it.
--
-- One writer, private.takeoff_mark_provisions, called last by both guarded overloads, in the application's transaction:
-- - forced lines: the blocked lines of the override audit consumed for this job (takeoff_apply_override_consumptions,
--   inserted by enforce_takeoff_apply_security in the same transaction; a job applies once);
-- - sources: the final item links, plus the ouvrage lines this application materialized (apply_assembly), so that a
--   hypothesis folded into an ouvrage keeps its marker (H20); joined to the job's takeoff items, frozen once applied;
-- - on every line touched: the marker when a source is a provision, else the key removed (the last application wins);
--   bounded by version and tenant, a v3 draft written under its writer contract; no amount changes.
--
-- The overloads are copied from their newest definitions, both in 20261109205839_takeoff_targeted_quantity_review.sql
-- (TI-681: private.assert_takeoff_single_quantity_source before the application, private.finalize_takeoff_lengths on its
-- result; the 5-argument overload no longer requires a DPGF quantity review). No later migration redefines them, nor
-- apply_takeoff_job_atomic or finalize_takeoff_lengths. The marker is written on finalize_takeoff_lengths' output: the
-- created ids and links it returns, so a merged length line names the provision sources of every run it merged and a
-- removed duplicate is not touched. Only the lines marked « TI-686 M3 » change. CREATE OR REPLACE keeps owner and
-- grants (restated below); no data is rewritten.
begin;

create function private.takeoff_mark_provisions(
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

  with forced as (
    select distinct blocked.item_id
    from public.takeoff_apply_override_consumptions as consumed
    join public.audit_logs as audit
      on audit.id = consumed.audit_log_id
     and audit.tenant_id = consumed.tenant_id
    cross join lateral pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(audit.after_data #> '{metadata,blocked_item_ids}') = 'array'
        then audit.after_data #> '{metadata,blocked_item_ids}' else '[]'::jsonb end
    ) as blocked(item_id)
    where consumed.job_id = p_job_id
      and consumed.tenant_id = p_tenant_id
      and consumed.estimate_version_id = p_version_id
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
  ),
  marked as (
    select
      links.estimate_item_id,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id,
          'forced', forced.item_id is not null,
          'forced_reason', null,
          'entry_category', source.quantity_entry_category
        )
        order by source.id
      ) filter (where forced.item_id is not null or source.quantity_entry_category = 'hypothesis') as sources
    from links
    left join public.takeoff_items as source
      on source.id::text = links.takeoff_item_id
     and source.job_id = p_job_id
     and source.tenant_id = p_tenant_id
    left join forced
      on forced.item_id = source.id::text
    group by links.estimate_item_id
  ),
  next_state as (
    select
      item.id,
      case
        when marked.sources is null then item.source_metadata - 'takeoff_provision'
        else coalesce(item.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_provision',
          pg_catalog.jsonb_build_object('version', 1, 'job_id', p_job_id, 'sources', marked.sources))
      end as source_metadata
    from marked
    join public.estimate_items as item
      on item.id = marked.estimate_item_id
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
  'TI-686 D10/D12: writes or removes source_metadata.takeoff_provision on the estimate lines a takeoff application touched (final links and materialized ouvrage lines): sources forced by the consumed override audit of the job or entered as a hypothesis. Internal display only (H9). Called by both overloads of public.apply_takeoff_job_guarded_atomic only.';

revoke all on function private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated, service_role;

-- From 20261109205839_takeoff_targeted_quantity_review.sql (4 arguments: a version without DPGF line).
-- The guarded applications of 20260813201300 take the version's lock before the job's row and lines (the inner
-- apply_takeoff_job_atomic locks the job first): the review, the writer, the peer invalidation and a job's completion
-- never hold lines of the version while an application waits for them, nor touch the lines of a job being applied.
-- Their search_path stays exactly pg_catalog (pinned by security-invariants and takeoff-apply-security-definer).
create or replace function public.apply_takeoff_job_guarded_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb
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
  job_tenant_id uuid;
  job_version_id uuid;
  -- TI-686 M3: the application's finalized result, returned once its provisions are marked.
  applied record;
begin
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

  if exists (
    select 1
    from public.estimate_items as item
    where item.tenant_id = job_tenant_id
      and item.version_id = job_version_id
      and item.item_type = 'line'
      and item.source_provider = 'dpgf'
  ) then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED'
      using errcode = '42501';
  end if;

  -- TI-677: the version's lock (the writer's and the review's) before any lock on the job or its lines: a save of
  -- another job's line waits for the application instead of invalidating the job being applied.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job_version_id::text, 0));
  perform set_config('app.takeoff_apply_job', 'on', true);
  perform set_config('app.takeoff_apply_atomic', 'on', true);
  perform private.assert_takeoff_single_quantity_source(p_job_id);
  -- TI-686 M3: the finalized result (merged length lines), kept to mark its provisions before it is returned.
  select finalized.* into applied from public.apply_takeoff_job_atomic(
    p_job_id,p_strategy,p_target_section_id,p_mapping_plan) as result
  cross join lateral private.finalize_takeoff_lengths(p_job_id,result.created_count,result.updated_count,
    result.ignored_count,result.created_ids,result.scope,result.item_links,p_mapping_plan) finalized;
  -- TI-686 M3: a forced line or an entered hypothesis enters the estimate as an internal provision.
  perform private.takeoff_mark_provisions(p_job_id,job_tenant_id,job_version_id,applied.item_links,applied.created_ids);
  return query select applied.created_count,applied.updated_count,applied.ignored_count,applied.created_ids,
    applied.scope,applied.item_links;
end;
$$;

revoke all on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb
) from public, anon;
grant execute on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb
) to authenticated;

-- From 20261109205839_takeoff_targeted_quantity_review.sql (5 arguments: a DPGF authorization).
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

  select permit.id, coalesce(permit.review_summary->'quantity_policy', '[]'::jsonb), permit.review_summary->'quantity_sources', permit.review_summary->>'quantity_version_stamp'
    into authorization_id, quantity_policy, quantity_sources, comparison_stamp
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
  select target.target_id, source.id as takeoff_item_id, source.quantity, source.updated_at
  from pg_temp._p680_targets target cross join lateral jsonb_to_recordset(target.takeoff_items)
    as source(id uuid,quantity numeric,updated_at timestamptz);
  create unique index on pg_temp._p680_sources(takeoff_item_id);
  if exists(select 1 from pg_temp._p680_sources source
    left join public.takeoff_items item on item.id=source.takeoff_item_id and item.job_id=p_job_id
      and item.tenant_id=job_tenant_id and not item.is_excluded
      and item.updated_at=source.updated_at and item.quantity=source.quantity
    where item.id is null) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  perform private.assert_takeoff_single_quantity_source(p_job_id);
  select result.* into applied
  from public.apply_takeoff_job_atomic(p_job_id,p_strategy,p_target_section_id,p_mapping_plan) result;

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

    update public.estimate_items item set
      quantity=target.priced_quantity,
      title=target.original_title, description=target.original_description,
      unit_price_ht_cents=coalesce(mapping.unit_price_cents,target.original_price),
      category_id=case when mapping.has_category then mapping.category_id else target.original_category end,
      source_provider='dpgf', source_job_id=p_job_id,
      source_file_name=target.source_file_name, source_page=target.source_page,
      source_metadata=target.source_metadata||jsonb_build_object('takeoff_quantity_policy',jsonb_build_object(
        'version',1,'job_id',p_job_id,'reference_quantity',target.reference_quantity,
        'measured_quantity',target.measured_quantity,'priced_quantity',target.priced_quantity,
        'absolute_gap',target.absolute_gap,'reviewed',target.reviewed,'item_ids',mapping.item_ids)),
      updated_at=statement_timestamp()
    from pg_temp._p680_targets target
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

  -- TI-686 M3: the finalized result of 20261109205839 (merged length lines), kept to mark its provisions first.
  select finalized.* into final_result from private.finalize_takeoff_lengths(p_job_id,
    applied.created_count-cardinality(removed_ids),
    applied.updated_count+additional_updates,applied.ignored_count,
    coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[]),applied.scope,
    coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',output.takeoff_item_id,
      'estimate_item_id',coalesce(source.target_id,output.estimate_item_id)) order by output.takeoff_item_id)
      from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._p680_sources source on source.takeoff_item_id=output.takeoff_item_id),'[]'::jsonb),p_mapping_plan) finalized;
  -- TI-686 M3: a forced line or an entered hypothesis enters the estimate as an internal provision.
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
