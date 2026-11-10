-- TI-681: targeted quantity recommendations; technical, tenant, lock and OCC protections remain.
begin;

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
      and coalesce(entry.value ->> 'code', '') not in ('DN_NETWORK_NETWORK_MISSING', 'DN_NETWORK_MATERIAL_MISSING', 'DN_NETWORK_DN_MISSING', 'DN_NETWORK_DN_NOT_IN_SERIES', 'ZONE_OVERLAP_DUPLICATE', 'ZONE_OVERLAP_UNREGISTERED', 'SCALE_DIMENSION_MISMATCH', 'AREA_PRINTED_MISMATCH', 'ROOM_OVERLAP', 'CLOSED_BOX_LABEL', 'CLOSED_BOX_SHAPE', 'NON_OBSERVABLE_TO_ENTER')
      and (
        entry.value -> 'acceptable' is distinct from 'true'::jsonb
        or not coalesce(p_is_verified, false)
      )
      and not public.takeoff_rule_failure_left_out(entry.value)
  );
$$;

create or replace function public.enforce_takeoff_apply_security()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  configured_threshold text;
  low_confidence_threshold numeric;
  blocked_ids uuid[] := '{}'::uuid[];
  blocked_items_count integer := 0;
  has_valid_override boolean := false;
  override_audit_id uuid;
begin
  if new.status = 'applied' and old.status is distinct from new.status then
    if caller_id is null then
      raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('takeoff-job:' || new.id::text, 0)
    );

    if not exists (
      select 1
      from public.draft_locks dl
      where dl.version_id = new.estimate_version_id
        and dl.tenant_id = new.tenant_id
        and dl.user_id = (select auth.uid())
        and dl.expires_at > statement_timestamp()
    ) then
      raise exception 'TAKEOFF_APPLY_LOCK_REQUIRED' using errcode = 'P0001';
    end if;

    select ff.value
      into configured_threshold
    from public.feature_flags ff
    where ff.tenant_id = new.tenant_id
      and ff.flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD'
      and ff.enabled = true
    limit 1;

    -- TI-677: read as the TS guard reads it (parseLowConfidenceThreshold), so both block the same lines and an
    -- admin override's audit carries this exact value.
    low_confidence_threshold := public.takeoff_low_confidence_threshold(configured_threshold);

    select coalesce(array_agg(ti.id order by ti.id), '{}'::uuid[])
      into blocked_ids
    from public.takeoff_items ti
    where ti.job_id = new.id
      and ti.tenant_id = new.tenant_id
      and ti.is_excluded = false
      and (
        (
          new.level = 'C'
          and (
            (
              ti.is_verified = false
              and (
                false -- TI-681: confidence recommends review, never blocks application.
              )
            )
            or nullif(btrim(ti.evidence), '') is null
            or ti.source_page is null
            or ti.source_page < 1
          )
        )
        or public.takeoff_item_rule_blocked(ti.rule_results, ti.rules_stale, ti.is_verified)
      );
    blocked_items_count := cardinality(blocked_ids);

    if blocked_items_count > 0 then
      if (select public.has_tenant_role(
        new.tenant_id,
        array['admin'::public.tenant_role]
      )) then
        select al.id
          into override_audit_id
        from public.audit_logs al
        where al.action = 'takeoff.apply.override'
          and al.table_name = 'takeoff_jobs'
          and al.record_id = new.id
          and al.estimate_version_id = new.estimate_version_id
          and al.tenant_id = new.tenant_id
          and al.user_id = (select auth.uid())
          and al.created_at >= statement_timestamp() - interval '15 minutes'
          and al.created_at <= statement_timestamp() + interval '5 seconds'
          and al.after_data ->> 'action' = 'takeoff.apply.override'
          and al.after_data ->> 'job_id' = new.id::text
          and al.after_data ->> 'tenant_id' = new.tenant_id::text
          and al.after_data ->> 'user_id' = caller_id::text
          and jsonb_typeof(
            al.after_data -> 'metadata' -> 'blocked_item_ids'
          ) = 'array'
          and jsonb_array_length(
            al.after_data -> 'metadata' -> 'blocked_item_ids'
          ) = (
            al.after_data -> 'metadata' ->> 'blocked_items_count'
          )::integer
          and coalesce(
            al.after_data -> 'metadata' ->> 'blocked_items_count',
            ''
          ) ~ '^[0-9]+$'
          and (
            al.after_data -> 'metadata' ->> 'blocked_items_count'
          )::integer = blocked_items_count
          and coalesce(
            al.after_data -> 'metadata' ->> 'threshold',
            ''
          ) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
          and (
            al.after_data -> 'metadata' ->> 'threshold'
          )::numeric = low_confidence_threshold
          and char_length(
            btrim(coalesce(
              al.after_data -> 'metadata' ->> 'justification',
              ''
            ))
          ) between 10 and 500
          and not exists (
            select 1
            from unnest(blocked_ids) as blocked(id)
            where not (
              al.after_data -> 'metadata' -> 'blocked_item_ids'
            ) ? blocked.id::text
          )
          -- TI-677 (PR D): each lifted line as the override recorded it.
          and jsonb_typeof(al.after_data -> 'metadata' -> 'blocked_items_state') = 'array'
          and jsonb_array_length(
            case when jsonb_typeof(al.after_data -> 'metadata' -> 'blocked_items_state') = 'array'
              then al.after_data -> 'metadata' -> 'blocked_items_state' else '[]'::jsonb end
          ) = blocked_items_count
          and not exists (
            select 1
            from public.takeoff_items ti
            where ti.id = any(blocked_ids)
              and ti.tenant_id = new.tenant_id
              and not exists (
                select 1
                from jsonb_array_elements(
                  case when jsonb_typeof(al.after_data -> 'metadata' -> 'blocked_items_state') = 'array'
                    then al.after_data -> 'metadata' -> 'blocked_items_state' else '[]'::jsonb end
                ) as state(value)
                where public.takeoff_apply_override_state_holds(state.value, ti)
              )
          )
          and not exists (
            select 1
            from public.takeoff_apply_override_consumptions consumed
            where consumed.audit_log_id = al.id
          )
        order by al.created_at desc, al.id desc
        limit 1;

        has_valid_override := override_audit_id is not null;
      end if;

      if not has_valid_override then
        raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
      end if;

      insert into public.takeoff_apply_override_consumptions (
        audit_log_id,
        tenant_id,
        job_id,
        estimate_version_id,
        user_id
      )
      values (
        override_audit_id,
        new.tenant_id,
        new.id,
        new.estimate_version_id,
        caller_id
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.select_takeoff_quantity_sources(p_job_id uuid, p_tenant_id uuid, p_choices jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if not exists(select 1 from public.takeoff_jobs job where job.id=p_job_id and job.tenant_id=p_tenant_id
    and job.status='processing') then
    raise exception 'TAKEOFF_QUANTITY_SOURCE_JOB_INVALID' using errcode='40001';
  end if;
  if jsonb_typeof(p_choices) is distinct from 'array' or exists(
    select 1 from jsonb_to_recordset(p_choices) as choice(id uuid,"group" text,origin text,excluded boolean,comparison jsonb)
    left join public.takeoff_items item on item.id=choice.id and item.job_id=p_job_id and item.tenant_id=p_tenant_id
    where item.id is null or choice.origin not in ('vector','model') or choice.excluded is null
      or choice."group" is null or length(choice."group")>2000
      or (choice.origin='vector') is distinct from (item.metadata ? 'vector')
  ) then
    raise exception 'TAKEOFF_QUANTITY_SOURCE_SELECTION_INVALID' using errcode='22023';
  end if;
  update public.takeoff_items item set is_excluded=choice.excluded,
    exclusion_reason=case when choice.excluded then 'Lecture alternative conservée ; mesure vectorielle prioritaire sur le même périmètre.' else null end,
    metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object('quantity_source',
      coalesce(item.metadata->'quantity_source','{}'::jsonb)||jsonb_build_object('version',1,'group',choice."group",
        'origin',choice.origin,'comparison',choice.comparison))
  from jsonb_to_recordset(p_choices) as choice(id uuid,"group" text,origin text,excluded boolean,comparison jsonb)
  where item.id=choice.id and item.job_id=p_job_id and item.tenant_id=p_tenant_id;
end;
$$;
revoke all on function public.select_takeoff_quantity_sources(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.select_takeoff_quantity_sources(uuid,uuid,jsonb) to service_role;

-- Only the guarded apply entry points can invoke this finalizer. Raw takeoff
-- measures are never changed; only this invocation's new duplicate outputs may be removed.
create or replace function private.finalize_takeoff_lengths(
  p_job_id uuid, p_created_count integer, p_updated_count integer, p_ignored_count integer,
  p_created_ids uuid[], p_scope text, p_links jsonb, p_plan jsonb
)
returns table(created_count integer,updated_count integer,ignored_count integer,created_ids uuid[],scope text,item_links jsonb)
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  job_tenant uuid; job_version uuid; engine smallint;
  previous_writer text:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
  removed uuid[]:='{}'::uuid[]; changed uuid[]:='{}'::uuid[];
begin
  if coalesce(current_setting('app.takeoff_apply_atomic',true),'')<>'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode='42501';
  end if;
  select job.tenant_id,job.estimate_version_id,version.calc_engine_version into job_tenant,job_version,engine
  from public.takeoff_jobs job join public.estimate_versions version on version.id=job.estimate_version_id
    and version.tenant_id=job.tenant_id where job.id=p_job_id;

  drop table if exists pg_temp._ti681_length_targets;
  create temporary table _ti681_length_targets on commit drop as
  select item.id,
    -- Existing destinations retain their identity, even when another line looks identical.
    jsonb_build_array(case when item.id=any(p_created_ids) then null else item.id end,
      (select jsonb_object_agg(field.key,field.value) from jsonb_each(to_jsonb(item)) field
        where field.key=any(array['tenant_id','version_id','parent_id','item_type','title','description','unit_code','unit_price_ht_cents','category_id','supply_type_id','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','k_fo','k_mo','k_mo_atelier','k_mo_chantier','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit','h_mo_majoration','pricing_status','tax_rate_bp','fo_provision','fo_price_origin','selected_supplier_price_id','product_id']
          ||case when engine=3 then '{}'::text[] else array['h_mo','h_mo_atelier','h_mo_chantier'] end)),
      jsonb_agg(distinct jsonb_build_array(source.metadata#>>'{rule_inputs,kind}',source.metadata#>>'{rule_inputs,network}',
        source.metadata#>>'{rule_inputs,material}',source.metadata#>>'{rule_inputs,dn}'))
    ) as identity,
    case when item.source_provider='dpgf' then item.quantity else sum(source.quantity) end as raw_quantity,
    case coalesce((private.normalize_unit(coalesce(item.unit_code,item.description))).unit_code,
      private.unit_token(coalesce(item.unit_code,item.description)))
      when 'm' then 1::numeric when 'ml' then 1::numeric when 'metre' then 1::numeric when 'metres' then 1::numeric
      when 'cm' then 0.01::numeric when 'mm' then 0.001::numeric when 'km' then 1000::numeric end as factor
  from (select distinct link.takeoff_item_id,link.estimate_item_id
    from jsonb_to_recordset(p_links) as link(takeoff_item_id uuid,estimate_item_id uuid)) link
  join public.takeoff_items source on source.id=link.takeoff_item_id and source.job_id=p_job_id and source.tenant_id=job_tenant
  join public.estimate_items item on item.id=link.estimate_item_id and item.tenant_id=job_tenant and item.version_id=job_version
    and item.item_type='line' and item.source_provider in ('takeoff','dpgf')
  join jsonb_to_recordset(p_plan) as plan(item_id uuid,action text) on plan.item_id=source.id and plan.action<>'apply_assembly'
  group by item.id;
  delete from pg_temp._ti681_length_targets where factor is null;

  drop table if exists pg_temp._ti681_length_groups;
  create temporary table _ti681_length_groups on commit drop as
  select (array_agg(target.id order by target.id))[1] as representative,
    array_agg(target.id order by target.id) as ids,sum(target.raw_quantity) as raw_quantity,min(target.factor) as factor
  from pg_temp._ti681_length_targets target group by target.identity;
  select coalesce(array_agg(g.representative),'{}'::uuid[]) into changed from pg_temp._ti681_length_groups g;
  if cardinality(changed)>0 then
    if engine=3 then perform set_config('miaouffrage.estimate_v3_writer',job_version::text,true); end if;
    update public.estimate_items item set quantity=ceil(g.raw_quantity*g.factor)/g.factor,
      source_metadata=coalesce(item.source_metadata,'{}'::jsonb)||jsonb_build_object('takeoff_length_rounding',
        jsonb_build_object('version',1,'job_id',p_job_id,'raw_quantity',g.raw_quantity,'metres_per_unit',g.factor,
          'item_ids',(select jsonb_agg(link.takeoff_item_id order by link.takeoff_item_id)
            from jsonb_to_recordset(p_links) as link(takeoff_item_id uuid,estimate_item_id uuid)
            where link.estimate_item_id=any(g.ids))))
    from pg_temp._ti681_length_groups g where item.id=g.representative and item.tenant_id=job_tenant and item.version_id=job_version;
    select coalesce(array_agg(id),'{}'::uuid[]) into removed
    from pg_temp._ti681_length_groups g cross join lateral unnest(g.ids) ids(id)
    where id<>g.representative and id=any(p_created_ids);
    delete from public.estimate_items item where item.id=any(removed) and item.tenant_id=job_tenant and item.version_id=job_version;
    if engine=3 then
      perform public.estimate_v3_complete_entry_for_writer(job_version,changed);
      perform set_config('miaouffrage.estimate_v3_writer',previous_writer,true);
    else
      perform public.recalculate_takeoff_estimate_version(job_version,job_tenant);
    end if;
  end if;
  return query select p_created_count-cardinality(removed),p_updated_count,p_ignored_count,
    coalesce((select array_agg(id order by id) from unnest(p_created_ids) ids(id) where not id=any(removed)),'{}'::uuid[]),p_scope,
    coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',link.takeoff_item_id,
      'estimate_item_id',coalesce(g.representative,link.estimate_item_id)) order by link.takeoff_item_id)
      from jsonb_to_recordset(p_links) as link(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._ti681_length_groups g on link.estimate_item_id=any(g.ids)),'[]'::jsonb);
exception when others then
  perform set_config('miaouffrage.estimate_v3_writer',previous_writer,true);
  raise;
end;
$$;
revoke all on function private.finalize_takeoff_lengths(uuid,integer,integer,integer,uuid[],text,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.assert_takeoff_single_quantity_source(p_job_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if exists(select 1 from public.takeoff_items item where item.job_id=p_job_id and not item.is_excluded
    and item.metadata#>>'{quantity_source,group}' is not null
    group by item.metadata#>>'{quantity_source,group}'
    having count(distinct item.metadata#>>'{quantity_source,origin}')>1) then
    raise exception 'TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT' using errcode='23514';
  end if;
end;
$$;
revoke all on function private.assert_takeoff_single_quantity_source(uuid) from public,anon,authenticated,service_role;

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
  return query select finalized.* from public.apply_takeoff_job_atomic(
    p_job_id,p_strategy,p_target_section_id,p_mapping_plan) as result
  cross join lateral private.finalize_takeoff_lengths(p_job_id,result.created_count,result.updated_count,
    result.ignored_count,result.created_ids,result.scope,result.item_links,p_mapping_plan) finalized;
end;
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

  return query select finalized.* from private.finalize_takeoff_lengths(p_job_id,
    applied.created_count-cardinality(removed_ids),
    applied.updated_count+additional_updates,applied.ignored_count,
    coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[]),applied.scope,
    coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',output.takeoff_item_id,
      'estimate_item_id',coalesce(source.target_id,output.estimate_item_id)) order by output.takeoff_item_id)
      from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._p680_sources source on source.takeoff_item_id=output.takeoff_item_id),'[]'::jsonb),p_mapping_plan) finalized;
end;
$$;

commit;
