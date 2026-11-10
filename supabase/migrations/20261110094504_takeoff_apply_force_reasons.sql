-- TI-686 D10 (lot 2, M4). No remote application is authorized here.
-- An administrator forces each blocked line of a takeoff job with a coded reason and a justification of 10 to 500
-- characters (H7). The override audit takeoff.apply.override (written by the route as the service role) changes format:
--   metadata.forced_justifications: the justifications, each stored once (no cap on the number of lines);
--   metadata.forced_items: [{"item_id", "reason_code", "false_positive_rules"?, "justification_index"}], one per blocked
--   line; false_positive_rules (the rules at fault, without duplicate) for « rule_false_positive » only.
-- The job-level metadata.justification is gone: the former audit is refused, with no transition window (H10).
-- Reasons: rule_false_positive and duplicate_resolved hold on readable results that are not to compute again, on the
-- failures that block the line as TI-681 defines them (public.takeoff_item_rule_blocked: a quantity warning such as a
-- scale, a printed surface or an overlap never blocks): a false positive names only rules among them; a resolved
-- duplicate needs a blocking zone_overlap or room_overlap failure. The four others always hold. No rule_codes are
-- stored: the applied job's rule_results are frozen, the statistics read them.
-- - enforce_takeoff_apply_security: re-created from its newest body, 20261109205839_takeoff_targeted_quantity_review.sql
--   (TI-681), only the job-level justification check replaced by the checks above (lines marked « TI-686 D10 »); its
--   pinned fragments (level C proof and page, the advisory lock, the draft lock, the consumption) are unchanged.
-- - private.takeoff_apply_forced_item_valid: one forced entry against its line (exact keys, reason, index of a valid
--   justification, applicability); stable, invoker, search_path pg_catalog, false on any error, executable by nobody
--   (the trigger runs as its owner).
-- - private.takeoff_mark_provisions: re-created from its newest body (20261110094503_takeoff_apply_provisions.sql, M3),
--   reading the forced entries of the consumed audit instead of blocked_item_ids and writing each source's coded reason
--   (forced_reason); everything else unchanged (lines marked « TI-686 M4 »). Both guarded overloads call it unchanged.
-- CREATE OR REPLACE keeps owners and grants (restated below); no data is rewritten. The TS twin is
-- src/lib/takeoff/force-reasons.ts (route, apply wizard).
begin;

create function private.takeoff_apply_forced_item_valid(
  p_forced jsonb,
  p_item public.takeoff_items,
  p_justifications jsonb
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  reason text;
  justification jsonb;
  blocking_rules text[];
  named jsonb;
begin
  if pg_catalog.jsonb_typeof(p_forced) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_forced -> 'item_id') is distinct from 'string'
    or p_forced ->> 'item_id' is distinct from p_item.id::text
    or pg_catalog.jsonb_typeof(p_forced -> 'reason_code') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_forced -> 'justification_index') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_justifications) is distinct from 'array'
  then
    return false;
  end if;

  reason := p_forced ->> 'reason_code';
  if reason not in ('rule_false_positive', 'additional_evidence', 'engineer_or_client_confirmation',
    'controlled_correction', 'duplicate_resolved', 'priced_hypothesis')
  then
    return false;
  end if;

  -- Exactly its keys: the rules at fault for a false positive, and only for it.
  if exists (
      select 1 from pg_catalog.jsonb_object_keys(p_forced) as entry_key(name)
      where entry_key.name not in ('item_id', 'reason_code', 'justification_index', 'false_positive_rules')
    )
    or (p_forced ? 'false_positive_rules') is distinct from (reason = 'rule_false_positive')
  then
    return false;
  end if;

  -- An integer index of a justification of 10 to 500 characters once its blanks are trimmed.
  if (p_forced ->> 'justification_index') !~ '^[0-9]{1,9}$'
    or (p_forced ->> 'justification_index')::integer >= pg_catalog.jsonb_array_length(p_justifications)
  then
    return false;
  end if;
  justification := p_justifications -> (p_forced ->> 'justification_index')::integer;
  if pg_catalog.jsonb_typeof(justification) is distinct from 'string'
    or pg_catalog.char_length(pg_catalog.regexp_replace(justification #>> '{}', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
      not between 10 and 500
  then
    return false;
  end if;

  if reason not in ('rule_false_positive', 'duplicate_resolved') then
    return true;
  end if;

  -- A reason that names a rule: on readable results not to compute again, the rules whose failure blocks the line, one
  -- failure at a time through the predicate the trigger counts lines with (TI-681).
  if pg_catalog.jsonb_typeof(p_item.rule_results) is distinct from 'array' or coalesce(p_item.rules_stale, false) then
    return false;
  end if;
  select coalesce(pg_catalog.array_agg(distinct entry.value ->> 'rule'), '{}'::text[])
    into blocking_rules
  from pg_catalog.jsonb_array_elements(p_item.rule_results) as entry(value)
  where pg_catalog.jsonb_typeof(entry.value) = 'object'
    and pg_catalog.jsonb_typeof(entry.value -> 'rule') = 'string'
    and public.takeoff_item_rule_blocked(pg_catalog.jsonb_build_array(entry.value), false, p_item.is_verified);

  if reason = 'duplicate_resolved' then
    return blocking_rules && array['zone_overlap', 'room_overlap']::text[];
  end if;

  -- A false positive names one or more of those rules, each once.
  named := p_forced -> 'false_positive_rules';
  return pg_catalog.jsonb_typeof(named) = 'array'
    and pg_catalog.jsonb_array_length(named) > 0
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(named) as named_rule(value)
      where pg_catalog.jsonb_typeof(named_rule.value) is distinct from 'string'
        or not ((named_rule.value #>> '{}') = any(blocking_rules))
    )
    and (select pg_catalog.count(distinct named_rule.value) from pg_catalog.jsonb_array_elements(named) as named_rule(value))
      = pg_catalog.jsonb_array_length(named);
exception
  when others then
    return false;
end;
$$;

comment on function private.takeoff_apply_forced_item_valid(jsonb, public.takeoff_items, jsonb) is
  'TI-686 D10: whether one forced entry of an override audit (metadata.forced_items) holds for its blocked line: exact keys, a known coded reason, the index of a valid justification, and for rule_false_positive or duplicate_resolved the failures that block the line (takeoff_item_rule_blocked) on readable, fresh results. Called by enforce_takeoff_apply_security only.';

revoke all on function private.takeoff_apply_forced_item_valid(jsonb, public.takeoff_items, jsonb)
  from public, anon, authenticated, service_role;

-- From 20261109205839_takeoff_targeted_quantity_review.sql (TI-681); only the lines marked « TI-686 D10 » change.
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
          -- TI-686 D10 (H7, H10): no job-level justification any more (an audit that keeps one is the former format,
          -- refused); each justification stored once, of 10 to 500 characters once its blanks are trimmed (the TS
          -- noteText rule).
          and not (al.after_data -> 'metadata' ? 'justification')
          and jsonb_typeof(al.after_data -> 'metadata' -> 'forced_justifications') = 'array'
          and jsonb_array_length(
            case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_justifications') = 'array'
              then al.after_data -> 'metadata' -> 'forced_justifications' else '[]'::jsonb end
          ) > 0
          and not exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_justifications') = 'array'
                then al.after_data -> 'metadata' -> 'forced_justifications' else '[]'::jsonb end
            ) as justification(value)
            where jsonb_typeof(justification.value) is distinct from 'string'
              or char_length(regexp_replace(justification.value #>> '{}', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
                not between 10 and 500
          )
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
          -- TI-686 D10: one forced entry per blocked line (as many entries as blocked lines, each line found: no
          -- duplicate, no entry for another line), its coded reason holding for the line as it is now.
          and jsonb_typeof(al.after_data -> 'metadata' -> 'forced_items') = 'array'
          and jsonb_array_length(
            case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_items') = 'array'
              then al.after_data -> 'metadata' -> 'forced_items' else '[]'::jsonb end
          ) = blocked_items_count
          and not exists (
            select 1
            from public.takeoff_items ti
            where ti.id = any(blocked_ids)
              and ti.tenant_id = new.tenant_id
              and not exists (
                select 1
                from jsonb_array_elements(
                  case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_items') = 'array'
                    then al.after_data -> 'metadata' -> 'forced_items' else '[]'::jsonb end
                ) as forced(value)
                where forced.value ->> 'item_id' = ti.id::text
                  and private.takeoff_apply_forced_item_valid(
                    forced.value, ti, al.after_data -> 'metadata' -> 'forced_justifications'
                  )
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

revoke all on function public.enforce_takeoff_apply_security()
  from public, anon, authenticated, service_role;

-- From 20261110094503_takeoff_apply_provisions.sql (M3); only the lines marked « TI-686 M4 » change.
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
  ),
  marked as (
    select
      links.estimate_item_id,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id,
          'forced', forced.item_id is not null,
          'forced_reason', forced.reason_code,
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
  'TI-686 D10/D12: writes or removes source_metadata.takeoff_provision on the estimate lines a takeoff application touched (final links and materialized ouvrage lines): sources forced by the consumed override audit of the job (with their coded reason) or entered as a hypothesis. Internal display only (H9). Called by both overloads of public.apply_takeoff_job_guarded_atomic only.';

revoke all on function private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated, service_role;

commit;
