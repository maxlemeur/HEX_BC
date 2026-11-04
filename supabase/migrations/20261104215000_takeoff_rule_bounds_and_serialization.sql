-- TI-677 (métré L5, suites des revues de L5a et L5b): prerequisites of
-- MERGEONE_TAKEOFF_RULES=1. Nothing here changes a version no rule reads
-- (the worker writes rule inputs only with the flag on).
-- - Low confidence threshold: one reading for the apply trigger and the TS
--   guard (src/lib/takeoff/guards.ts parseLowConfidenceThreshold). Number()
--   read « 0x1 » as 1 where SQL fell back to 0.5, rounded more than 17 digits
--   where SQL kept them, and the flag reader trimmed a tab SQL kept: the two
--   sides blocked different lines and an override's audit never matched.
--   Both now trim like JS trim(), accept a decimal of at most 100 characters
--   with an exponent of at most 3 digits, between 0 and 1 (else 0.5), and
--   round it up to the 1e-4 confidences are stored at (numeric(5,4)): the
--   same lines block as with the exact value.
-- - Serialized saves of one version: a review save locked its line, then the
--   peer invalidation (stale_takeoff_rule_peers) locked every other line of
--   the version; two saves of one version could each hold one line and wait
--   for the other's, and one was cancelled (deadlock, Codex #160). The review
--   saves through update_takeoff_item_for_review, which takes the version's
--   lock (the writer's: takeoff-rules:<version>) before its line's. The peer
--   invalidation, the worker's insertion and a job's completion take the same
--   lock before they lock lines, so the review, the writer and the worker
--   never hold lines of one version while waiting for each other.
-- - The writer leaves a line whose results exceed the column's bounds (16
--   results, 65,536 bytes) stale instead of failing its whole chunk: the
--   server bounds them before the write (boundRuleResults, measured as
--   jsonb text), this is the database's own guard.

create or replace function public.takeoff_low_confidence_threshold(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  -- The characters JS trim() removes (WhiteSpace and LineTerminator), at both ends.
  trimmed text := pg_catalog.regexp_replace(p_value,
    '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g');
  threshold numeric;
begin
  if trimmed is null
    or pg_catalog.length(trimmed) > 100
    or trimmed !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,3})?$'
  then
    return 0.5;
  end if;
  threshold := trimmed::numeric;
  if threshold < 0 or threshold > 1 then
    return 0.5;
  end if;
  return pg_catalog.ceil(threshold * 10000) / 10000;
end;
$$;

revoke all on function public.takeoff_low_confidence_threshold(text) from public, anon, authenticated;
grant execute on function public.takeoff_low_confidence_threshold(text) to service_role;

-- The apply guard of 20261103213336, reading the threshold above; the rest unchanged.
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

    select count(*)::integer
      into blocked_items_count
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
                ti.confidence is null
                or ti.confidence < low_confidence_threshold
              )
            )
            or nullif(btrim(ti.evidence), '') is null
            or ti.source_page is null
            or ti.source_page < 1
          )
        )
        or public.takeoff_item_rule_blocked(ti.rule_results, ti.rules_stale, ti.is_verified)
      );

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
                        ti.confidence is null
                        or ti.confidence < low_confidence_threshold
                      )
                    )
                    or nullif(btrim(ti.evidence), '') is null
                    or ti.source_page is null
                    or ti.source_page < 1
                  )
                )
                or public.takeoff_item_rule_blocked(ti.rule_results, ti.rules_stale, ti.is_verified)
              )
              and not (
                al.after_data -> 'metadata' -> 'blocked_item_ids'
              ) ? ti.id::text
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

-- The review's save of one line: the version's lock first (the writer's), then the line as PostgREST would update
-- it, under the caller's rights (RLS, the whitelist and attestation triggers). Returns the saved row, or none when the
-- line changed since it was read (updated_at) or is not visible. Only the fields a review saves are accepted.
create or replace function public.update_takeoff_item_for_review(
  p_tenant_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb
)
returns setof public.takeoff_items
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  version_id uuid;
  assignments text;
begin
  if pg_catalog.jsonb_typeof(p_fields) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_fields) as field(name)
      where field.name <> all (array[
        'designation', 'quantity', 'unit', 'source_page', 'is_excluded', 'exclusion_reason', 'is_verified',
        'verified_at', 'verified_by', 'evidence', 'quantity_entered_at', 'quantity_entered_by', 'updated_at'
      ])
    )
  then
    raise exception 'TAKEOFF_ITEM_PATCH_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.string_agg(pg_catalog.format('%I = patch.%I', field.name, field.name), ', ' order by field.name)
    into assignments
  from pg_catalog.jsonb_object_keys(p_fields) as field(name);
  if assignments is null then
    return;
  end if;

  select job.estimate_version_id
    into version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id
    and job.tenant_id = p_tenant_id;
  if version_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || version_id::text, 0));

  return query execute pg_catalog.format(
    'update public.takeoff_items as item set %s
     from pg_catalog.jsonb_populate_record(null::public.takeoff_items, $1) as patch
     where item.id = $2 and item.job_id = $3 and item.tenant_id = $4 and item.updated_at = $5
     returning item.*',
    assignments
  ) using p_fields, p_item_id, p_job_id, p_tenant_id, p_expected_updated_at;
end;
$$;

revoke all on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb) to authenticated, service_role;

-- The peer invalidation of 20261103213336, taking the lock of each version it invalidates (in order) before it locks
-- any of its lines. A statement that makes nothing stale (an application's own exclusions) takes no lock.
create or replace function public.stale_takeoff_rule_peers()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  versions uuid[];
  version_id uuid;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select pg_catalog.array_agg(distinct changed_job.estimate_version_id order by changed_job.estimate_version_id)
      into versions
    from new_rows as changed
    join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
    where changed.rules_stale;
  else
    select pg_catalog.array_agg(distinct changed_job.estimate_version_id order by changed_job.estimate_version_id)
      into versions
    from new_rows as changed
    join old_rows as previous on previous.id = changed.id
    join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
    where changed.rules_stale and changed.rules_stale_at is distinct from previous.rules_stale_at;
  end if;
  if versions is null then
    return null;
  end if;

  foreach version_id in array versions loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || version_id::text, 0));
  end loop;

  if tg_op = 'INSERT' then
    update public.takeoff_items as item
    set rules_stale = true, rules_stale_at = pg_catalog.clock_timestamp()
    from public.takeoff_jobs as job
    where job.status = 'completed'::public.takeoff_job_status
      and item.job_id = job.id
      and item.tenant_id = job.tenant_id
      -- Every line the rules read: evaluated, or awaiting its first evaluation (stale since the worker wrote it).
      and (item.rules_evaluated_at is not null or item.rules_stale)
      and (job.tenant_id, job.estimate_version_id) in (
        select changed_job.tenant_id, changed_job.estimate_version_id
        from new_rows as changed
        join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
        where changed.rules_stale
      );
  else
    update public.takeoff_items as item
    set rules_stale = true, rules_stale_at = pg_catalog.clock_timestamp()
    from public.takeoff_jobs as job
    where job.status = 'completed'::public.takeoff_job_status
      and item.job_id = job.id
      and item.tenant_id = job.tenant_id
      -- Every line the rules read: evaluated, or awaiting its first evaluation (stale since the worker wrote it).
      and (item.rules_evaluated_at is not null or item.rules_stale)
      and (job.tenant_id, job.estimate_version_id) in (
        select changed_job.tenant_id, changed_job.estimate_version_id
        from new_rows as changed
        join old_rows as previous on previous.id = changed.id
        join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
        where changed.rules_stale and changed.rules_stale_at is distinct from previous.rules_stale_at
      );
  end if;
  return null;
end;
$$;

revoke all on function public.stale_takeoff_rule_peers() from public, anon, authenticated;

-- A job's completion (20261103213336) takes its version's lock before it locks the version's lines.
create or replace function public.stale_takeoff_rule_lines_on_completion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || new.estimate_version_id::text, 0));
  update public.takeoff_items as item
  set rules_stale = true, rules_stale_at = pg_catalog.clock_timestamp()
  from public.takeoff_jobs as job
  where job.tenant_id = new.tenant_id
    and job.estimate_version_id = new.estimate_version_id
    and job.status = 'completed'::public.takeoff_job_status
    and item.job_id = job.id
    and item.tenant_id = job.tenant_id
    and (item.rules_evaluated_at is not null or item.rules_stale);
  return null;
end;
$$;

revoke all on function public.stale_takeoff_rule_lines_on_completion() from public, anon, authenticated;

-- The writer of 20261103213336; a line whose results exceed the column's bounds is left stale, never written, and
-- the rest of its chunk is (before: the whole chunk failed on the check and every line stayed stale).
create or replace function public.write_takeoff_rule_results(
  p_tenant_id uuid,
  p_estimate_version_id uuid,
  p_items jsonb,
  p_transforms jsonb default '[]'::jsonb,
  p_stamp text default null
)
returns table (item_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  writable uuid[];
begin
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_transforms, '[]'::jsonb)) is distinct from 'array'
  then
    raise exception 'TAKEOFF_RULE_RESULTS_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('takeoff-rules:' || p_estimate_version_id::text, 0)
  );
  if p_stamp is not null and p_stamp is distinct from public.takeoff_rule_version_stamp(p_tenant_id, p_estimate_version_id) then
    return;
  end if;

  -- Completed jobs no application holds; holding them keeps an application from starting meanwhile.
  select coalesce(pg_catalog.array_agg(job.id), '{}'::uuid[])
    into writable
  from (
    select candidate.id
    from public.takeoff_jobs as candidate
    where candidate.tenant_id = p_tenant_id
      and candidate.estimate_version_id = p_estimate_version_id
      and candidate.status = 'completed'::public.takeoff_job_status
    for share skip locked
  ) as job;

  update public.takeoff_item_geometries as stored
  set geometry = pg_catalog.jsonb_set(stored.geometry, '{transform}', coalesce(entry.transform, 'null'::jsonb))
  from pg_catalog.jsonb_to_recordset(coalesce(p_transforms, '[]'::jsonb)) as entry(item_id uuid, transform jsonb)
  where stored.takeoff_item_id = entry.item_id
    and stored.tenant_id = p_tenant_id
    and stored.job_id = any(writable)
    and (
      entry.transform is null
      or entry.transform = 'null'::jsonb
      or (pg_catalog.jsonb_typeof(entry.transform) = 'array' and pg_catalog.jsonb_array_length(entry.transform) = 6)
    );

  return query
  update public.takeoff_items as item
  set rule_results = entry.results,
    rules_evaluated_at = pg_catalog.statement_timestamp(),
    rules_stale = false
  from pg_catalog.jsonb_to_recordset(p_items) as entry(id uuid, results jsonb, expected_updated_at timestamptz,
    expected_stale_at timestamptz)
  where item.id = entry.id
    and item.tenant_id = p_tenant_id
    and item.job_id = any(writable)
    and item.updated_at = entry.expected_updated_at
    -- Made stale again since read (a partner's edit after the stamp check): left stale.
    and item.rules_stale_at is not distinct from entry.expected_stale_at
    -- TI-677: results over the column's bounds leave their line stale; the rest of the chunk is written.
    and case when pg_catalog.jsonb_typeof(entry.results) = 'array'
      then pg_catalog.jsonb_array_length(entry.results) <= 16 and pg_catalog.octet_length(entry.results::text) <= 65536
      else false end
  returning item.id;
end;
$$;

revoke all on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) to service_role;
