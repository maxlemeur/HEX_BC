-- TI-664 (métré L5): fixed quantity rules counted by the apply guard (option A).
-- Each line keeps its rule results, written by the worker or the server with
-- the service role only, never by Data API clients:
-- - rule_results: one entry per rule that reads the line (rule, status, code,
--   version, acceptable, reason, details), see docs/metier/regles-metre.md;
-- - rules_evaluated_at: when they were computed (null: never, no rule reads it);
-- - rules_stale: the line changed after its results (quantity, unit, exclusion
--   or page edited by a client): they no longer hold until the server computes
--   them again.
-- The apply trigger counts a line « failed and not settled » as blocked, on
-- every level (the existing reasons stay level C): stale results, or a failed
-- rule while the line is not verified, or a failed rule that verifying never
-- settles (a quantity to enter). takeoff_item_rule_blocked is that one
-- predicate; the TypeScript guard mirrors it (src/lib/takeoff/rules/blocking.ts),
-- so that both block the same lines and an admin override's audit (written from
-- the TypeScript count) still equals the trigger's count.
-- quantity_entered_by / quantity_entered_at attest that a user typed the line's
-- current quantity (a quantity the plan cannot show is entered, never verified):
-- set by the caller for itself, like is_verified, and cleared when the quantity
-- changes without a new attestation.
-- takeoff_vector_pages.rule_anchors keeps what registers two plans of one level
-- (texts printed once, building lines), written by the worker.
-- Writing rule results never moves updated_at: the review's optimistic
-- concurrency token stays the user's own last edit.

alter table public.takeoff_items
  add column rule_results jsonb not null default '[]'::jsonb,
  add column rules_evaluated_at timestamptz,
  add column rules_stale boolean not null default false,
  add column quantity_entered_at timestamptz,
  add column quantity_entered_by uuid references public.profiles(id) on delete set null;

alter table public.takeoff_items
  add constraint takeoff_items_rule_results_shape_check check (
    jsonb_typeof(rule_results) = 'array'
    and jsonb_array_length(rule_results) <= 16
    and octet_length(rule_results::text) <= 65536
  );

create index takeoff_items_quantity_entered_by_idx
  on public.takeoff_items (quantity_entered_by)
  where quantity_entered_by is not null;

alter table public.takeoff_vector_pages
  add column rule_anchors jsonb check (
    rule_anchors is null
    or (jsonb_typeof(rule_anchors) = 'object' and octet_length(rule_anchors::text) <= 262144)
  );

create or replace function public.takeoff_item_rule_blocked(
  p_rule_results jsonb,
  p_rules_stale boolean,
  p_is_verified boolean
)
returns boolean
language sql
immutable
set search_path = pg_catalog
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
  );
$$;

revoke all on function public.takeoff_item_rule_blocked(jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.takeoff_item_rule_blocked(jsonb, boolean, boolean) to service_role;

-- Rule writes never move updated_at: only a change of another column does
-- (the review's optimistic concurrency token stays the user's last edit). A
-- client that writes updated_at itself still gets now(): updated_at stays in
-- the comparison.
drop trigger if exists set_takeoff_items_updated_at on public.takeoff_items;
create trigger set_takeoff_items_updated_at
  before update on public.takeoff_items
  for each row
  when (
    (to_jsonb(old) - array['rule_results', 'rules_evaluated_at', 'rules_stale'])
      is distinct from
    (to_jsonb(new) - array['rule_results', 'rules_evaluated_at', 'rules_stale'])
  )
  execute procedure public.set_updated_at();

-- Content a client edits after the rules ran (quantity, unit, exclusion) makes
-- the results stale: the line blocks until the server computes them again.
-- Everything else is unchanged from 20260813201300 (whitelist, attestation).
create or replace function public.enforce_authenticated_takeoff_item_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_status public.takeoff_job_status;
  parent_level public.takeoff_job_level;
begin
  if current_user <> 'authenticated'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return new;
  end if;

  select job.status, job.level
    into parent_status, parent_level
  from public.takeoff_jobs as job
  where job.id = new.job_id
    and job.tenant_id = new.tenant_id;

  if parent_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_COMPLETED_JOB_REQUIRED' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'quantity_entered_at', 'quantity_entered_by', 'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'quantity_entered_at', 'quantity_entered_by', 'updated_at'
  ]) then
    raise exception 'TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE' using errcode = '42501';
  end if;

  -- Any content edit invalidates an earlier attestation unless the caller
  -- explicitly re-attests the new value in the same statement.
  if old.is_verified
    and (
      new.designation is distinct from old.designation
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.evidence is distinct from old.evidence
      or new.source_page is distinct from old.source_page
    )
    and new.is_verified is not distinct from old.is_verified
    and new.verified_at is not distinct from old.verified_at
    and new.verified_by is not distinct from old.verified_by
  then
    new.is_verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;

  if new.is_verified is distinct from old.is_verified
    or new.verified_at is distinct from old.verified_at
    or new.verified_by is distinct from old.verified_by
  then
    if new.is_verified then
      if new.verified_by is distinct from (select auth.uid())
        or new.verified_at is null
      then
        raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
      end if;
    elsif new.verified_by is not null or new.verified_at is not null then
      raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
    end if;
  end if;

  if parent_level = 'C'::public.takeoff_job_level
    and new.is_verified
    and (
      nullif(btrim(new.evidence), '') is null
      or new.source_page is null
      or new.source_page < 1
    )
  then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_PROOF_REQUIRED' using errcode = '42501';
  end if;

  -- TI-664: a typed quantity is attested by its author, now; a quantity changed
  -- without a new attestation is no longer the one entered.
  if new.quantity is distinct from old.quantity
    and new.quantity_entered_by is not distinct from old.quantity_entered_by
    and new.quantity_entered_at is not distinct from old.quantity_entered_at
  then
    new.quantity_entered_by := null;
    new.quantity_entered_at := null;
  end if;

  if new.quantity_entered_by is distinct from old.quantity_entered_by
    or new.quantity_entered_at is distinct from old.quantity_entered_at
  then
    if new.quantity_entered_by is not null then
      if new.quantity_entered_by is distinct from (select auth.uid())
        or new.quantity_entered_at is null
      then
        raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
      end if;
    elsif new.quantity_entered_at is not null then
      raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
    end if;
  end if;

  -- TI-664: the rules read the quantity, its entry, the unit, the exclusion
  -- and the page (the scale rule) as they are now; after a client edit their
  -- results wait for the server.
  if old.rules_evaluated_at is not null
    and (
      new.quantity is distinct from old.quantity
      or new.quantity_entered_by is distinct from old.quantity_entered_by
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.source_page is distinct from old.source_page
    )
  then
    new.rules_stale := true;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_item_fields()
  from public;

-- The apply guard counts, on every level, the included lines whose rules block
-- them (stale, or failed and not settled); the existing reasons (low confidence
-- not verified, missing proof or page) stay level C. Same count, same override:
-- an admin override's audit must name exactly these lines.
create or replace function public.enforce_takeoff_apply_security()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  configured_threshold text;
  low_confidence_threshold numeric := 0.5;
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

    select btrim(ff.value)
      into configured_threshold
    from public.feature_flags ff
    where ff.tenant_id = new.tenant_id
      and ff.flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD'
      and ff.enabled = true
    limit 1;

    if configured_threshold ~
      '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
    then
      begin
        low_confidence_threshold := configured_threshold::numeric;
        if low_confidence_threshold < 0 or low_confidence_threshold > 1 then
          low_confidence_threshold := 0.5;
        end if;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          low_confidence_threshold := 0.5;
      end;
    end if;

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

-- What the rules of a version read: its completed and applied jobs and their
-- lines, each with the time of its last edit. A recomputation reads this stamp
-- before reading the version and writes only if it is unchanged: an older
-- computation never overwrites a newer one (TI-664 review).
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
    ), '')
  );
$$;

revoke all on function public.takeoff_rule_version_stamp(uuid, uuid) from public, anon, authenticated;
grant execute on function public.takeoff_rule_version_stamp(uuid, uuid) to service_role;

-- The server's write of a version's rule results, service role only. A line
-- changed since the server read it (updated_at moved) keeps its stale results:
-- the computation that change triggers writes it. Nothing is written when the
-- version changed since the computation read it (p_stamp, under a lock per
-- version). Lines of a job no longer completed (applied, cancelled) are never
-- written (an applied line is frozen), nor those of a job an application holds
-- (its row locked): left out, never waited for. Page transforms (registration to
-- the level's frame) go to the geometry the vector reading wrote (TI-662
-- `transform`). Returns the lines written.
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
  from pg_catalog.jsonb_to_recordset(p_items) as entry(id uuid, results jsonb, expected_updated_at timestamptz)
  where item.id = entry.id
    and item.tenant_id = p_tenant_id
    and item.job_id = any(writable)
    and item.updated_at = entry.expected_updated_at
  returning item.id;
end;
$$;

revoke all on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) to service_role;
