-- TI-677 (métré L5, PR D): decisions on the fixed rules, as Thanh validated them on 5 Nov. 2026 (memo on the practice
-- of quantity surveyors, Q2 to Q4).
-- - Keys of the failed rules (takeoff_rule_failure_keys): one per failed rule, code, version and partner,
--   « rule|code|version|partner », read from the stored JSON exactly as the TypeScript reads them
--   (src/lib/takeoff/rules/failure-keys.ts; the same cases run in vitest and pgTAP).
-- - A computation reopens a verified line (Q3). blockingRules and takeoff_item_rule_blocked held any acceptable
--   failure of a verified line settled, even one a partner brought after the verification (a room drawn around it,
--   a run of another zone plan): it passed for settled without anybody seeing it. The writer now withdraws the
--   verification of a line whose new results bring a key it did not have (another rule, code or version, or a new
--   partner); a failure or a partner that disappears closes by itself. The reopening moves updated_at (a review that
--   read the line before reads it again before saving it) and is journaled by the system in the same transaction,
--   with who had verified it. The predicate itself does not change: both sides read the verification it leaves.
--   An unverified line whose failures grow moves too: a review that read it before cannot verify it on what it showed
--   (a failure nobody saw, verified the other way round). The writer returns the version's stamp after its own writes:
--   the next chunk of the same computation writes with it.
-- - The user's decisions are journaled in the save's transaction (Q4): verification, exclusion and its reason,
--   quantity and its entry, designation, unit, page, evidence, by the signed-in user at the database's time. The
--   route wrote them after the save, in a mode that let a save succeed without its trace; it writes none now. An
--   application's own changes stay journaled by the route (takeoff.mapping.applied).
-- - The exclusion reason is required by the database (Q4): a signed-in client excludes no line, and erases no
--   excluded line's reason, without a reason that is not blank. Lines excluded before keep their state.
-- - An admin override is bound to each lifted line's state (Q2): its audit records, per blocked line, the quantity,
--   unit, updated_at, failed rules' keys and stale flag (src/lib/takeoff/apply-override-state.ts), and the apply
--   trigger refuses it once one of them changed, or when it records none (an override written before). It also
--   records what proves the line (designation, evidence, page, verification, entry). The application renames lines of
--   its mapping plan before the trigger counts (updated_at moves in its own transaction): a line it renamed holds when
--   every recorded field but its designation is unchanged.
-- Nothing here redefines a function of 20261104224500 (TI-677 PR B); this migration comes after it.

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
        ) as partners
    ) as failed
    cross join lateral pg_catalog.unnest(
      case when pg_catalog.cardinality(failed.partners) = 0 then array['']::text[] else failed.partners end
    ) as named(id)
    where entry.value ->> 'status' = 'fail'
  ) as failure;
$$;

revoke all on function public.takeoff_rule_failure_keys(jsonb) from public, anon, authenticated;
grant execute on function public.takeoff_rule_failure_keys(jsonb) to service_role;

-- Whether results written over stored ones bring a key the stored ones did not have (TS ruleFailuresReopen).
create or replace function public.takeoff_rule_failures_reopen(p_previous jsonb, p_next jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(public.takeoff_rule_failure_keys(p_next)) as fresh(key)
    where not (public.takeoff_rule_failure_keys(p_previous) ? fresh.key)
  );
$$;

revoke all on function public.takeoff_rule_failures_reopen(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.takeoff_rule_failures_reopen(jsonb, jsonb) to service_role;

-- The writer of 20261104215000, which also reopens the verified lines its results bring a failure they did not have,
-- and journals it (system: no user) in the same transaction; moves every line whose failures grow; and returns, with
-- each line written, the version's stamp after its writes (p_stamp when no line moved). Its result changes: dropped
-- and created again.
drop function if exists public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text);

create function public.write_takeoff_rule_results(
  p_tenant_id uuid,
  p_estimate_version_id uuid,
  p_items jsonb,
  p_transforms jsonb default '[]'::jsonb,
  p_stamp text default null
)
returns table (item_id uuid, version_stamp text)
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  writable uuid[];
  growing jsonb;
  grown_ids uuid[];
  reopened_ids uuid[];
  written uuid[];
  stamp_after text := p_stamp;
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

  -- TI-677 (PR D): the lines whose failures this write grows, locked as read; the verified ones with who had verified
  -- them.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', line.id, 'job_id', line.job_id,
      'is_verified', line.is_verified, 'verified_at', line.verified_at, 'verified_by', line.verified_by,
      'previous', line.rule_results, 'results', line.results)),
      '[]'::jsonb)
    into growing
  from (
    select item.id, item.job_id, item.is_verified, item.verified_at, item.verified_by, item.rule_results, entry.results
    from public.takeoff_items as item
    join pg_catalog.jsonb_to_recordset(p_items) as entry(id uuid, results jsonb, expected_updated_at timestamptz,
      expected_stale_at timestamptz)
      on entry.id = item.id
    where item.tenant_id = p_tenant_id
      and item.job_id = any(writable)
      and item.updated_at = entry.expected_updated_at
      and item.rules_stale_at is not distinct from entry.expected_stale_at
      and case when pg_catalog.jsonb_typeof(entry.results) = 'array'
        then pg_catalog.jsonb_array_length(entry.results) <= 16 and pg_catalog.octet_length(entry.results::text) <= 65536
        else false end
      and public.takeoff_rule_failures_reopen(item.rule_results, entry.results)
    for update of item
  ) as line;

  select coalesce(pg_catalog.array_agg((line.value ->> 'id')::uuid), '{}'::uuid[]),
      coalesce(pg_catalog.array_agg((line.value ->> 'id')::uuid) filter (where (line.value ->> 'is_verified')::boolean), '{}'::uuid[])
    into grown_ids, reopened_ids
  from pg_catalog.jsonb_array_elements(growing) as line(value);

  with saved as (
    update public.takeoff_items as item
    set rule_results = entry.results,
      rules_evaluated_at = pg_catalog.statement_timestamp(),
      rules_stale = false,
      -- A failure nobody saw is not settled: the line waits for a user's verification, and a review that read it
      -- before reads it again (its save moves).
      is_verified = case when item.id = any(reopened_ids) then false else item.is_verified end,
      verified_at = case when item.id = any(reopened_ids) then null else item.verified_at end,
      verified_by = case when item.id = any(reopened_ids) then null else item.verified_by end,
      updated_at = case when item.id = any(grown_ids) then pg_catalog.now() else item.updated_at end
    from pg_catalog.jsonb_to_recordset(p_items) as entry(id uuid, results jsonb, expected_updated_at timestamptz,
      expected_stale_at timestamptz)
    where item.id = entry.id
      and item.tenant_id = p_tenant_id
      and item.job_id = any(writable)
      and item.updated_at = entry.expected_updated_at
      -- Made stale again since read (a partner's edit after the stamp check): left stale.
      and item.rules_stale_at is not distinct from entry.expected_stale_at
      -- TI-677: results over the column's bounds are not written (the line keeps its state); the rest of the chunk is.
      and case when pg_catalog.jsonb_typeof(entry.results) = 'array'
        then pg_catalog.jsonb_array_length(entry.results) <= 16 and pg_catalog.octet_length(entry.results::text) <= 65536
        else false end
    returning item.id
  )
  select coalesce(pg_catalog.array_agg(saved.id), '{}'::uuid[])
    into written
  from saved;

  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, before_data, after_data)
  select distinct on (line.id)
    p_tenant_id, null, 'takeoff_items', line.job_id, p_estimate_version_id, 'takeoff.item.modified',
    pg_catalog.jsonb_build_object('is_verified', true, 'verified_at', line.verified_at, 'verified_by', line.verified_by,
      'rule_failures', public.takeoff_rule_failure_keys(line.previous)),
    pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.item.modified', 'job_id', line.job_id,
      'tenant_id', p_tenant_id, 'user_id', null,
      'metadata', pg_catalog.jsonb_build_object('item_id', line.id, 'field', 'is_verified', 'previous_value', true,
        'next_value', false, 'reason', pg_catalog.left(
          'Règles recalculées : nouvel échec à vérifier (' || coalesce(fresh.codes, '?') || ').', 500)))
  from pg_catalog.jsonb_to_recordset(growing) as line(id uuid, job_id uuid, is_verified boolean, verified_at timestamptz,
    verified_by uuid, previous jsonb, results jsonb)
  cross join lateral (
    select pg_catalog.string_agg(distinct pg_catalog.split_part(keyed.value, '|', 2), ', '
      order by pg_catalog.split_part(keyed.value, '|', 2)) as codes
    from pg_catalog.jsonb_array_elements_text(public.takeoff_rule_failure_keys(line.results)) as keyed(value)
    where not (public.takeoff_rule_failure_keys(line.previous) ? keyed.value)
  ) as fresh
  where line.is_verified
    and line.id = any(written)
  order by line.id;

  -- The stamp the next chunk of the same computation checks: its own moves are not another writer's.
  if written && grown_ids then
    stamp_after := public.takeoff_rule_version_stamp(p_tenant_id, p_estimate_version_id);
  end if;

  return query select written_id, stamp_after from pg_catalog.unnest(written) as written_id;
end;
$$;

revoke all on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) to service_role;

-- The user's decisions on a line, journaled with the save (the review's RPC or the Data API, as the signed-in user).
-- The server's own writes (service role: the rules' writer, the worker) and an application's changes are not users'
-- decisions. Security definer: Data API clients may never write a takeoff audit row themselves.
create or replace function public.audit_takeoff_item_decisions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
begin
  if pg_catalog.current_setting('role', true) is distinct from 'authenticated'
    or coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return null;
  end if;

  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
  select new.tenant_id, actor, 'takeoff_items', new.job_id, job.estimate_version_id, change.action,
    pg_catalog.jsonb_build_object('schema_version', 1, 'action', change.action, 'job_id', new.job_id,
      'tenant_id', new.tenant_id, 'user_id', actor, 'metadata', change.metadata)
  from (
    select field.position,
      case when field.name = 'is_excluded' and new.is_excluded then 'takeoff.item.excluded' else 'takeoff.item.modified' end
        as action,
      case when field.name = 'is_excluded' and new.is_excluded
        then pg_catalog.jsonb_build_object('item_id', new.id, 'is_excluded', true, 'reason', new.exclusion_reason)
        else pg_catalog.jsonb_build_object('item_id', new.id, 'field', field.name, 'previous_value', field.previous,
          'next_value', field.next, 'reason', null)
      end as metadata
    from (values
      (1, 'designation', pg_catalog.to_jsonb(old.designation), pg_catalog.to_jsonb(new.designation)),
      (2, 'quantity', pg_catalog.to_jsonb(old.quantity), pg_catalog.to_jsonb(new.quantity)),
      (3, 'quantity_entered_by', pg_catalog.to_jsonb(old.quantity_entered_by), pg_catalog.to_jsonb(new.quantity_entered_by)),
      (4, 'unit', pg_catalog.to_jsonb(old.unit), pg_catalog.to_jsonb(new.unit)),
      (5, 'source_page', pg_catalog.to_jsonb(old.source_page), pg_catalog.to_jsonb(new.source_page)),
      (6, 'evidence', pg_catalog.to_jsonb(old.evidence), pg_catalog.to_jsonb(new.evidence)),
      (7, 'is_excluded', pg_catalog.to_jsonb(old.is_excluded), pg_catalog.to_jsonb(new.is_excluded)),
      -- The reason of a line that stays excluded (an exclusion carries its own, an inclusion clears it).
      (8, 'exclusion_reason',
        case when old.is_excluded is not distinct from new.is_excluded then pg_catalog.to_jsonb(old.exclusion_reason) end,
        case when old.is_excluded is not distinct from new.is_excluded then pg_catalog.to_jsonb(new.exclusion_reason) end),
      (9, 'is_verified', pg_catalog.to_jsonb(old.is_verified), pg_catalog.to_jsonb(new.is_verified))
    ) as field(position, name, previous, next)
    where field.previous is distinct from field.next
      -- A verification another user takes over is theirs (true to true, in their name).
      or (field.name = 'is_verified' and new.is_verified and old.verified_by is distinct from new.verified_by)
  ) as change
  left join public.takeoff_jobs as job on job.id = new.job_id and job.tenant_id = new.tenant_id
  order by change.position;

  return null;
end;
$$;

revoke all on function public.audit_takeoff_item_decisions() from public, anon, authenticated, service_role;

drop trigger if exists audit_takeoff_item_decisions on public.takeoff_items;
create trigger audit_takeoff_item_decisions
  after update on public.takeoff_items
  for each row
  when (
    old.designation is distinct from new.designation
    or old.quantity is distinct from new.quantity
    or old.quantity_entered_by is distinct from new.quantity_entered_by
    or old.unit is distinct from new.unit
    or old.source_page is distinct from new.source_page
    or old.evidence is distinct from new.evidence
    or old.is_excluded is distinct from new.is_excluded
    or old.exclusion_reason is distinct from new.exclusion_reason
    or old.is_verified is distinct from new.is_verified
    or old.verified_by is distinct from new.verified_by
  )
  execute procedure public.audit_takeoff_item_decisions();

-- A signed-in client excludes a line, or keeps it excluded, with a reason that is not blank (the API requires it as
-- well). An application's own exclusions carry their reason (the mapping plan's action).
create or replace function public.require_takeoff_item_exclusion_reason()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_user = 'authenticated'
    and coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on'
    and new.is_excluded
    and (old.is_excluded is distinct from new.is_excluded or old.exclusion_reason is distinct from new.exclusion_reason)
    and coalesce(new.exclusion_reason, '') !~ '[^[:space:]]'
  then
    raise exception 'TAKEOFF_ITEM_EXCLUSION_REASON_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.require_takeoff_item_exclusion_reason() from public, anon, authenticated, service_role;

drop trigger if exists require_takeoff_item_exclusion_reason on public.takeoff_items;
create trigger require_takeoff_item_exclusion_reason
  before update of is_excluded, exclusion_reason on public.takeoff_items
  for each row
  execute procedure public.require_takeoff_item_exclusion_reason();

-- Whether a blocked line still is as an override recorded it (src/lib/takeoff/apply-override-state.ts): same quantity,
-- unit, failed rules' keys, stale flag, evidence, page, verification and entry, and no save since (updated_at, and the
-- designation); a line the application renamed (its updated_at moved in this very transaction) holds with every
-- recorded field but its designation unchanged. A state that cannot be read never holds.
create or replace function public.takeoff_apply_override_state_holds(p_state jsonb, p_item public.takeoff_items)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if pg_catalog.jsonb_typeof(p_state) is distinct from 'object'
    or p_state ->> 'item_id' is distinct from p_item.id::text
    or pg_catalog.jsonb_typeof(p_state -> 'quantity') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_state -> 'unit') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_state -> 'updated_at') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_state -> 'rule_failures') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_state -> 'rules_stale') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_state -> 'designation') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_state -> 'is_verified') is distinct from 'boolean'
    or not (p_state ? 'evidence' and p_state ? 'source_page' and p_state ? 'quantity_entered_by')
  then
    return false;
  end if;

  if (p_state ->> 'quantity')::numeric is distinct from p_item.quantity
    or p_state ->> 'unit' is distinct from p_item.unit
    or p_state -> 'rule_failures' is distinct from public.takeoff_rule_failure_keys(p_item.rule_results)
    or p_state -> 'rules_stale' is distinct from pg_catalog.to_jsonb(coalesce(p_item.rules_stale, false))
    or p_state -> 'evidence' is distinct from coalesce(pg_catalog.to_jsonb(p_item.evidence), 'null'::jsonb)
    or p_state -> 'source_page' is distinct from coalesce(pg_catalog.to_jsonb(p_item.source_page), 'null'::jsonb)
    or p_state -> 'is_verified' is distinct from pg_catalog.to_jsonb(p_item.is_verified)
    or p_state -> 'quantity_entered_by' is distinct from coalesce(pg_catalog.to_jsonb(p_item.quantity_entered_by), 'null'::jsonb)
  then
    return false;
  end if;

  -- Unchanged since recorded, or changed in this transaction only (the application's own renaming).
  return ((p_state ->> 'updated_at')::timestamptz = p_item.updated_at and p_state ->> 'designation' = p_item.designation)
    or p_item.updated_at = pg_catalog.now();
exception
  when others then
    return false;
end;
$$;

revoke all on function public.takeoff_apply_override_state_holds(jsonb, public.takeoff_items) from public, anon, authenticated;

-- The apply trigger of 20261104215000: the blocked lines are read once, and an override must record each one's state
-- as it still is (takeoff_apply_override_state_holds).
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

revoke all on function public.enforce_takeoff_apply_security()
  from public, anon, authenticated, service_role;
