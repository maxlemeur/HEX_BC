-- TI-680. Reconcile the service-issued quantity snapshot in the same transaction as the existing atomic apply.
-- Preserve DPGF provenance, source measurements, mapping guards, tenant boundaries and engine-pinned amounts.
-- No existing rows are changed by this migration. Existing permits without a snapshot keep their short-lived contract.
begin;

alter table public.takeoff_dpgf_review_decisions add column quantity_snapshot jsonb;
comment on column public.takeoff_dpgf_review_decisions.quantity_snapshot is
  'TI-680: quantities, identities and bases examined by this decision; a changed comparison requires a fresh review.';

create or replace function public.takeoff_rule_version_stamp(p_tenant_id uuid, p_estimate_version_id uuid)
returns text
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select pg_catalog.md5(
    coalesce((
      select pg_catalog.string_agg(job.id::text || ':' || job.status::text, ',' order by job.id)
      from public.takeoff_jobs as job
      where job.tenant_id = p_tenant_id
        and job.estimate_version_id = p_estimate_version_id
        and job.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
    ), '')
    || '|' ||
    coalesce((
      select pg_catalog.string_agg(item.id::text || ':' || item.updated_at::text, ',' order by item.id)
      from public.takeoff_items as item
      join public.takeoff_jobs as job on job.id = item.job_id
      where item.tenant_id = p_tenant_id
        and job.tenant_id = p_tenant_id
        and job.estimate_version_id = p_estimate_version_id
        and job.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
    ), '') || '|' ||
    coalesce((select string_agg(item.id::text||':'||item.updated_at::text,',' order by item.id)
      from public.estimate_items item where item.tenant_id=p_tenant_id and item.version_id=p_estimate_version_id
        and item.source_provider='dpgf'),'') || '|' ||
    coalesce((select string_agg(link.id::text||':'||link.estimate_item_id::text||':'||link.takeoff_item_id::text||':'||link.updated_at::text,',' order by link.id)
      from public.takeoff_dpgf_links link where link.tenant_id=p_tenant_id and link.version_id=p_estimate_version_id),'') || '|' ||
    coalesce((select string_agg(decision.id::text||':'||decision.updated_at::text,',' order by decision.id)
      from public.takeoff_dpgf_review_decisions decision where decision.tenant_id=p_tenant_id
        and decision.version_id=p_estimate_version_id),'')
  );
$$;

create or replace function public.takeoff_rule_failure_keys(p_rule_results jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(pg_catalog.jsonb_agg(failure.key order by failure.key collate "C"), '[]'::jsonb)
  from (
    select distinct failed.prefix || named.id as key
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_rule_results) = 'array' then p_rule_results else '[]'::jsonb end
    ) as entry(value)
    cross join lateral (
      select
        (case when pg_catalog.jsonb_typeof(entry.value -> 'rule') = 'string' and (entry.value ->> 'rule') ~ '^[A-Za-z0-9_]{1,64}$'
          then entry.value ->> 'rule' else '?' end)
        || '|'
        || (case when pg_catalog.jsonb_typeof(entry.value -> 'code') = 'string' and (entry.value ->> 'code') ~ '^[A-Za-z0-9_]{1,64}$'
          then entry.value ->> 'code' else '?' end)
        || '|'
        || (case when pg_catalog.jsonb_typeof(entry.value -> 'version') = 'number' then (
            case when (entry.value ->> 'version')::numeric = pg_catalog.trunc((entry.value ->> 'version')::numeric)
              and (entry.value ->> 'version')::numeric between 0 and 2147483647
            then pg_catalog.trunc((entry.value ->> 'version')::numeric)::bigint::text else '?' end
          ) else '?' end)
        || '|' as prefix,
        array(
          select case when pg_catalog.jsonb_typeof(partner.value -> 'item_id') = 'string'
              and (partner.value ->> 'item_id') ~ '^[0-9A-Za-z-]{1,64}$'
            then pg_catalog.translate(partner.value ->> 'item_id', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
            else '?' end
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(entry.value #> '{details,partners}') = 'array'
              then entry.value #> '{details,partners}' else '[]'::jsonb end
          ) as partner(value)
          union all
          select case when pg_catalog.jsonb_typeof(room.value) = 'string' and (room.value #>> '{}') ~ '^[0-9A-Za-z-]{1,64}$'
            then pg_catalog.translate(room.value #>> '{}', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
            else '?' end
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(entry.value #> '{details,overlapping_item_ids}') = 'array'
              then entry.value #> '{details,overlapping_item_ids}' else '[]'::jsonb end
          ) as room(value)
          union all
          select case when pg_catalog.jsonb_typeof(entry.value #> '{details,quantity_context_key}')='string'
            and (entry.value #>> '{details,quantity_context_key}') ~ '^[0-9A-Za-z-]{1,64}$'
            then pg_catalog.lower(entry.value #>> '{details,quantity_context_key}') else '?' end
          where entry.value #> '{details,quantity_context_key}' is not null
        ) as partners
    ) as failed
    cross join lateral pg_catalog.unnest(
      case when pg_catalog.cardinality(failed.partners) = 0 then array['']::text[] else failed.partners end
    ) as named(id)
    where entry.value ->> 'status' = 'fail'
  ) as failure;
$$;

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
    if exists(select 1 from pg_temp._p680_targets where absolute_gap>reference_quantity/100+0.000000001
      and not coalesce(reviewed,false)) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_REVIEW_REQUIRED' using errcode='23514';
    end if;
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

  return query select applied.created_count-cardinality(removed_ids),
    applied.updated_count+additional_updates,applied.ignored_count,
    coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[]),applied.scope,
    coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',output.takeoff_item_id,
      'estimate_item_id',coalesce(source.target_id,output.estimate_item_id)) order by output.takeoff_item_id)
      from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._p680_sources source on source.takeoff_item_id=output.takeoff_item_id),'[]'::jsonb);
end;
$$;

-- CREATE OR REPLACE preserves the existing owner and grants; no additional API is exposed.
commit;
