-- Lot 5 (counted marks, second stage of the marks on the plan): an acceptance taken on marks that changed since is a
-- decision to take again.
--
-- An acceptance in the table of items (lot 4's review decisions, 20261122125722_takeoff_item_review_decisions.sql, its
-- command as corrected by 20261122145415_takeoff_item_review_work_tables.sql) certifies an item's answer on a plan. Once
-- the answer has counted marks (20261122144104_takeoff_count_marks.sql), a correction of them (a mark added, moved,
-- removed, restored, retained, given to another item, a page verified, a newer machine generation) changes what was
-- accepted: the acceptance must be taken again. This migration:
--   - records, with each acceptance, the marks revision of its answer, locked by the command after its rows
--     (private.lock_takeoff_count_marks_revision, the marks' own lock: an edit of those marks waits for the command, or
--     the command for the edit), in a new nullable column of public.takeoff_item_answer_decisions;
--   - says it in one rule, private.takeoff_item_decision_effective: an acceptance stands only while every positive row
--     of its answer is verified (B2's rule, unchanged) and while its marks revision is the answer's current one (an
--     acceptance recorded without one counts as taken at revision 0, which an answer without marks keeps);
--   - reads that rule where the table, its facets and the command read the effective decision:
--     private.takeoff_item_table_pairs, rebuilt on B2's body with only this expression changed. Through it
--     private.takeoff_item_table_lines and private.takeoff_item_line_decision (unchanged), public.read_takeoff_item_table,
--     public.count_takeoff_item_table and public.review_takeoff_items read the same decision: an acceptance to take again
--     is « none », the line « pending », and the item can be accepted again;
--   - rebuilds public.review_takeoff_items on 20261122145415's body with three changes only: an acceptance records the
--     locked revision; a set aside clears it and journals the revision of the acceptance it replaced; a reinstatement
--     that gives an acceptance back gives back that revision, so that marks changed meanwhile still ask a new decision.
-- No value of the marks is ever sent by this: the table's retained quantity and the send read what they read.
--
-- What the previous application version sees: nothing. The column is nullable and new, written only by this command
-- (as its owner; a direct write stays refused by B2's trigger); no released writer calls the command, and an answer
-- without marks has revision 0 on both sides, so every decision it reads is the same. The functions keep their
-- signatures, results, owners and grants (a replacement keeps them); the new function is revoked from every role.
--
-- Locks: the decisions table, without waiting (nowait), for the column only; replacing a function takes no table lock.
-- The command's locks: those of 20261122145415, then the marks states of the answers it accepts (for share, in
-- identifier order), after its rows. A holder of a marks state (the marks' edit and publication) never waits for the
-- review key, the rules keys or the rows the command holds: no cycle. Nothing needs to be drained.
begin;

set local lock_timeout = '5s';
-- Bodies are validated when they first run (the database tests run them), as B2 does.
set local check_function_bodies = off;

lock table public.takeoff_item_answer_decisions in access exclusive mode nowait;

-- 1. The marks revision an acceptance was taken on (null: none recorded, read as 0; cleared by a set aside).
alter table public.takeoff_item_answer_decisions add column marks_revision integer
  constraint takeoff_item_answer_decisions_marks_revision_check check (marks_revision between 0 and 1000000);

comment on column public.takeoff_item_answer_decisions.marks_revision is
  'The counted marks revision of the answer when it was accepted (lot 5); a later one makes the acceptance a decision to take again.';

-- 2. The one rule of an answer's effective decision: an acceptance stands while its positive rows are verified and its
--    marks are those it was taken on; any other decision is what it says.
create function private.takeoff_item_decision_effective(p_kind text, p_rows_unverified boolean,
  p_decision_marks_revision integer, p_current_marks_revision integer)
returns text language sql immutable set search_path = '' as $$
  select case when p_kind = 'accepted' and (coalesce(p_rows_unverified, false)
      or coalesce(p_decision_marks_revision, 0) <> coalesce(p_current_marks_revision, 0)) then 'none'
    else coalesce(p_kind, 'none') end
$$;
revoke all on function private.takeoff_item_decision_effective(text, boolean, integer, integer)
  from public, anon, authenticated, service_role;

-- 3. The (item, plan) pairs of the table (B2's body), the effective decision read by the rule above.
create or replace function private.takeoff_item_table_pairs(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, plan_logical_id uuid, plan_file_id uuid, plan_name text, plan_generation text, job_id uuid,
  unit_state text, reading text, answer_id uuid, outcome text, location_key text, location_label text,
  decision_kind text, decision_revision integer, plan_entry_id uuid, answer_job_id uuid, sent boolean,
  decision_effective text)
language sql stable security definer set search_path = '' as $$
  select p.item_id, p.plan_logical_id, p.plan_file_id, p.plan_name, p.plan_generation, p.job_id, p.unit_state, p.reading,
    p.answer_id, p.outcome, loc.location_key, loc.location_label, d.kind, coalesce(d.revision, 0),
    case when p_plan_logical_id is null then pe.id end, a.job_id, coalesce(aj.status::text = 'applied', false),
    private.takeoff_item_decision_effective(d.kind, exists (select 1 from public.takeoff_item_answer_observations o
        join public.takeoff_items i on i.id = o.takeoff_item_id
        where o.answer_id = p.answer_id and o.role = 'contribution' and not i.is_verified),
      d.marks_revision, private.takeoff_count_marks_revision(p.answer_id))
  from private.takeoff_item_reading_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p
  left join public.takeoff_item_answers a on a.id = p.answer_id
  left join public.takeoff_jobs aj on aj.id = a.job_id and aj.tenant_id = p_tenant_id
  left join public.takeoff_item_answer_decisions d on d.answer_id = p.answer_id
  left join public.takeoff_item_entries pe on pe.tenant_id = p_tenant_id and pe.project_id = p_project_id
    and pe.item_id = p.item_id and pe.plan_logical_id = p.plan_logical_id
  left join lateral (
    select coalesce(l.building, '') || '|' || coalesce(l.level, '') as location_key,
      pg_catalog.concat_ws(' · ', l.building, l.level) as location_label
    from public.takeoff_plan_locations l
    where l.tenant_id = p_tenant_id and l.project_id = p_project_id and l.source_id = p.plan_logical_id
      and (l.building is not null or l.level is not null)
    order by l.updated_at desc, l.id
    limit 1
  ) loc on true
$$;

-- 4. The review command (20261122145415's body): an acceptance records its answer's marks revision.
create or replace function public.review_takeoff_items(p_tenant_id uuid, p_project_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  gesture text;
  scope_plan uuid;
  digest text;
  receipt public.takeoff_item_review_commands%rowtype;
  this_command uuid := pg_catalog.gen_random_uuid();
  stale uuid[];
  applied jsonb;
  outcome jsonb;
  now_ timestamptz := pg_catalog.clock_timestamp();
  reason_text text;
  job record;
  threshold numeric;
  marked uuid;
begin
  if actor is null or not coalesce(private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false), false)
    or not coalesce(private.takeoff_item_list_writer(p_tenant_id, p_project_id, actor), false) then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;

  -- The command's form, before anything is read under a lock.
  gesture := p_command ->> 'gesture';
  if pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or p_command -> 'command_version' is distinct from '1'::jsonb
    or gesture is null or gesture not in ('accept_measured', 'set_aside', 'reinstate', 'enter_quantity', 'include_entry')
    or not private.takeoff_item_answer_is_uuid(p_command -> 'intent_key')
    or pg_catalog.jsonb_typeof(p_command -> 'scope') is distinct from 'object'
    or (p_command #>> '{scope,kind}') is null or (p_command #>> '{scope,kind}') not in ('affaire', 'plan')
    or ((p_command #>> '{scope,kind}') = 'plan') <> private.takeoff_item_answer_is_uuid(p_command #> '{scope,plan_logical_id}')
    or pg_catalog.jsonb_typeof(p_command -> 'targets') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_command -> 'targets') not between 1 and 1000
    or pg_catalog.jsonb_typeof(p_command -> 'apply') is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_command -> 'skipped', '[]'::jsonb)) is distinct from 'array'
    or pg_catalog.octet_length(p_command::text) > 4194304
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)
      where pg_catalog.jsonb_typeof(t.value) is distinct from 'object'
        or not private.takeoff_item_answer_is_uuid(t.value -> 'item_id')
        or not private.takeoff_item_answer_is_number(t.value -> 'entry_revision', 0, 2147483647, true)
        or pg_catalog.jsonb_typeof(t.value -> 'answers') is distinct from 'array'
        or pg_catalog.jsonb_array_length(t.value -> 'answers') > 1000
        or exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value)
          where pg_catalog.jsonb_typeof(a.value) is distinct from 'object'
            or not private.takeoff_item_answer_is_uuid(a.value -> 'answer_id')
            or not private.takeoff_item_answer_is_number(a.value -> 'decision_revision', 0, 2147483647, true)
            or not private.takeoff_item_answer_is_number(a.value -> 'entry_revision', 0, 2147483647, true)))
    or (select count(distinct t.value ->> 'item_id') from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value))
      <> pg_catalog.jsonb_array_length(p_command -> 'targets')
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'apply') x(value)
      where not private.takeoff_item_answer_is_uuid(x.value)
        or not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)
          where t.value ->> 'item_id' = x.value #>> '{}'))
    or (gesture = 'include_entry' and pg_catalog.jsonb_array_length(p_command -> 'targets') <> 1)
    or (gesture = 'set_aside' and (coalesce(p_command ->> 'reason', '') not in ('out_of_scope', 'duplicate', 'reading_error', 'other')
      or (p_command -> 'note' is not null and p_command -> 'note' <> 'null'::jsonb
        and not private.takeoff_item_answer_is_text(p_command -> 'note', null, 500))
      or (p_command ->> 'reason' = 'other' and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_command ->> 'note', ''))) < 3)))
    or (gesture = 'enter_quantity' and (
      pg_catalog.jsonb_typeof(p_command -> 'values') is distinct from 'array'
      or coalesce(p_command #>> '{entry,category}', '') not in ('site_survey', 'other_drawing', 'dpgf_cctp',
        'written_confirmation', 'documented_calculation', 'hypothesis')
      or (p_command #> '{entry,note}' is not null and p_command #> '{entry,note}' <> 'null'::jsonb
        and not private.takeoff_item_answer_is_text(p_command #> '{entry,note}', null, 500))
      or (p_command #>> '{entry,category}' = 'hypothesis'
        and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_command #>> '{entry,note}', ''))) not between 10 and 500)
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
        where pg_catalog.jsonb_typeof(v.value) is distinct from 'object'
          or not private.takeoff_item_answer_is_uuid(v.value -> 'item_id')
          or not private.takeoff_item_answer_is_number(v.value -> 'quantity', 0, 999999999.999999, false, true)
          or not private.takeoff_item_answer_is_text(v.value -> 'unit', null, 16))
      -- One value per item of the selection (each one of its targets), and one for each item applied: the member's
      -- values are kept whole in the command (a replay compares them), only those of the items applied are written.
      or (select count(distinct v.value ->> 'item_id') from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value))
        <> pg_catalog.jsonb_array_length(p_command -> 'values')
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'apply') x(value)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
          where v.value ->> 'item_id' = x.value #>> '{}'))
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)
          where v.value ->> 'item_id' = t.value ->> 'item_id')))) then
    raise exception 'TAKEOFF_ITEM_REVIEW_INVALID' using errcode = '22023';
  end if;
  scope_plan := case when p_command #>> '{scope,kind}' = 'plan' then (p_command #>> '{scope,plan_logical_id}')::uuid end;
  -- The member's command: what the server found eligible (apply, skipped) is decided again on a replay, never compared.
  digest := private.takeoff_sha256(p_command - 'apply' - 'skipped');

  -- The affaire's row, as the foreign keys of what this command writes take it, before any key; then one review command
  -- at a time in the affaire, then its receipt.
  perform 1 from public.estimate_projects p where p.id = p_project_id and p.tenant_id = p_tenant_id for key share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-review:' || p_project_id::text, 0));
  select c.* into receipt from public.takeoff_item_review_commands c
  where c.tenant_id = p_tenant_id and c.project_id = p_project_id and c.intent_key = (p_command ->> 'intent_key')::uuid;
  if found then
    if receipt.actor_id is distinct from actor or receipt.command_sha256 is distinct from digest then
      raise exception 'TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return receipt.outcome || '{"replayed": true}'::jsonb;
  end if;

  -- Its work tables are its own, made by this call: whatever a session holds under one of their names beforehand (any
  -- kind, any owner, any definition) is dropped unread, which fires none of its triggers, rules or defaults, or refuses
  -- the call (a view, a sequence, a table something depends on) before anything is written.
  drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
    pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
  create temporary table pg_temp.takeoff_review_lines (item_id uuid primary key, state text,
    scope_entry_id uuid, expected_unit text, reference_quantity numeric) on commit drop;
  create temporary table pg_temp.takeoff_review_pairs (item_id uuid, plan_logical_id uuid, answer_id uuid,
    outcome text, decision_kind text, decision_effective text, decision_revision integer, plan_entry_id uuid,
    plan_entry_revision integer, job_id uuid, sent boolean, reason_code text) on commit drop;
  create temporary table pg_temp.takeoff_review_rules_jobs (job_id uuid primary key) on commit drop;

  -- The targets as they are, read twice for a gesture that writes positive rows: once to know the jobs whose rules keys
  -- it takes (in the job's order, as a member's save of a row takes them: every version's key before every job's two
  -- keys, each in identifier order), then again once those keys are held, so that what is compared and judged below is
  -- what is committed now. A row a targeted review changed meanwhile is judged as it was committed, an answer a new
  -- reading replaced meanwhile is no longer current.
  for pass in 1 .. 2 loop
    truncate pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs;
    insert into pg_temp.takeoff_review_lines
    select l.item_id, l.state, l.scope_entry_id, l.expected_unit, l.reference_quantity
    from private.takeoff_item_table_lines(p_tenant_id, p_project_id, scope_plan) l
    where l.item_id in (select (t.value ->> 'item_id')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value));
    insert into pg_temp.takeoff_review_pairs
    select p.item_id, p.plan_logical_id, p.answer_id, p.outcome, p.decision_kind, p.decision_effective, p.decision_revision,
      p.plan_entry_id, coalesce(pe.revision, 0), p.answer_job_id, p.sent, a.reason_code
    from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, scope_plan) p
    left join public.takeoff_item_answers a on a.id = p.answer_id
    left join public.takeoff_item_entries pe on pe.id = p.plan_entry_id
    where p.answer_id is not null
      and p.item_id in (select (t.value ->> 'item_id')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value));
    exit when pass = 2 or gesture not in ('accept_measured', 'set_aside', 'reinstate');
    for job in
      select x.id, x.estimate_version_id from (
        select distinct j.id, j.estimate_version_id from pg_temp.takeoff_review_pairs p
        join public.takeoff_jobs j on j.id = p.job_id and j.tenant_id = p_tenant_id
        where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
          and j.status = 'completed'
      ) x
      order by x.estimate_version_id is null, x.estimate_version_id, x.id
    loop
      if job.estimate_version_id is null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || job.id::text, 0));
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || job.id::text, 0));
      else
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job.estimate_version_id::text, 0));
      end if;
    end loop;
  end loop;

  -- Compare-and-set: each item read as it is now (its current answers in the scope, their decisions' revisions, the
  -- revision of the plan's entry that stands for each in the affaire's scope, the scope's entry's revision): every
  -- entry that enters the total is the one the selection saw.
  select pg_catalog.array_agg(t.item_id order by t.item_id) into stale
  from (select (t.value ->> 'item_id')::uuid as item_id, (t.value ->> 'entry_revision')::numeric::integer as entry_revision,
      t.value -> 'answers' as answers
    from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)) t
  left join pg_temp.takeoff_review_lines l on l.item_id = t.item_id
  where l.item_id is null
    or coalesce((select e.revision from public.takeoff_item_entries e where e.id = l.scope_entry_id), 0) <> t.entry_revision
    or (select coalesce(pg_catalog.array_agg(p.answer_id::text || '#' || p.decision_revision || '#' || p.plan_entry_revision
          order by p.answer_id), '{}')
        from pg_temp.takeoff_review_pairs p where p.item_id = t.item_id)
      is distinct from
      (select coalesce(pg_catalog.array_agg((a.value ->> 'answer_id')::uuid::text
          || '#' || ((a.value ->> 'decision_revision')::numeric::integer)::text
          || '#' || ((a.value ->> 'entry_revision')::numeric::integer)::text
          order by (a.value ->> 'answer_id')::uuid), '{}')
        from pg_catalog.jsonb_array_elements(t.answers) a(value));

  -- The rules of each gesture on the items the server found eligible, now, under the locks: what no longer holds makes
  -- the selection stale. A plan already sent to an estimate is closed to every gesture, its entries included: what
  -- changes after a send goes through a revision of the send's contribution, never through this command. An
  -- acceptance: a measured item (its answer on the plan in a plan's scope), without the scope's entry, an answer still
  -- to decide, every positive row of its answers to decide without an anomaly the planner names (the tenant's
  -- confidence threshold included), and the total it would retain (private.takeoff_item_total: those rows as they are,
  -- the plans' included entries) in one unit, within 1 % of its DPGF reference. Never a forcing.
  if stale is null then
    if gesture = 'accept_measured' then
      threshold := public.takeoff_low_confidence_threshold((select ff.value from public.feature_flags ff
        where ff.tenant_id = p_tenant_id and ff.flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD' and ff.enabled limit 1));
    end if;
    select pg_catalog.array_agg(x.item_id order by x.item_id) into stale
    from (select (v.value #>> '{}')::uuid as item_id from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value)) x
    join pg_temp.takeoff_review_lines l on l.item_id = x.item_id
    where exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id and p.sent)
      or case gesture
      when 'accept_measured' then not (
        l.state = 'measured' and l.scope_entry_id is null
        and exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id
          and p.decision_effective = 'none' and p.plan_entry_id is null)
        and not exists (select 1 from pg_temp.takeoff_review_pairs p
          join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
          left join public.takeoff_items i on i.id = o.takeoff_item_id and i.tenant_id = p_tenant_id
          where p.item_id = x.item_id and p.outcome = 'measured' and p.decision_effective = 'none' and p.plan_entry_id is null
            and pg_catalog.cardinality(private.takeoff_item_row_anomalies(p.outcome, p.reason_code, i.id is not null,
              i.is_excluded, i.rules_stale, i.rule_results, i.confidence, threshold, i.evidence, i.source_page, i.metadata,
              i.quantity_entry_category, i.unit, l.expected_unit)) > 0)
        and (select pg_catalog.count(distinct private.takeoff_unit_token(q.unit)) <= 1
            and (l.reference_quantity is null or l.reference_quantity < 0 or pg_catalog.count(*) = 0
              or not private.takeoff_quantity_requires_review(l.reference_quantity,
                private.takeoff_item_total(pg_catalog.array_agg(q.quantity))))
          from (
            select e.quantity, e.unit from pg_temp.takeoff_review_pairs p
            join public.takeoff_item_entries e on e.id = p.plan_entry_id
            where p.item_id = x.item_id and p.decision_effective <> 'set_aside' and e.included
            union all
            select i.quantity, i.unit from pg_temp.takeoff_review_pairs p
            join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
            join public.takeoff_items i on i.id = o.takeoff_item_id and i.tenant_id = p_tenant_id
            where p.item_id = x.item_id and p.decision_effective <> 'set_aside' and p.plan_entry_id is null
              and p.outcome = 'measured' and not i.is_excluded
          ) q))
      when 'set_aside' then not exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id
        and p.decision_effective <> 'set_aside')
      when 'reinstate' then not exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id
        and p.decision_kind = 'set_aside')
      when 'enter_quantity' then l.state not in ('not_found', 'uncertain')
      when 'include_entry' then not exists (select 1 from public.takeoff_item_entries e where e.id = l.scope_entry_id
        and e.category = 'hypothesis' and not e.included)
    end;
  end if;
  if stale is not null then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'stale', pg_catalog.to_jsonb(stale));
  end if;

  create temporary table pg_temp.takeoff_review_written (item_id uuid, answer_id uuid) on commit drop;

  if gesture = 'accept_measured' then
    insert into pg_temp.takeoff_review_written
    select p.item_id, p.answer_id from pg_temp.takeoff_review_pairs p
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and p.decision_effective = 'none' and p.plan_entry_id is null;
    -- The positive rows of the measured answers accepted, verified in the member's name as they now are (a job still
    -- completed).
    with rows_ as (
      select i.id, i.is_verified, p.item_id, p.answer_id, p.plan_logical_id from pg_temp.takeoff_review_pairs p
      join pg_temp.takeoff_review_written w on w.answer_id = p.answer_id
      join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
      join public.takeoff_items i on i.id = o.takeoff_item_id
      join public.takeoff_jobs j on j.id = i.job_id and j.tenant_id = i.tenant_id and j.status = 'completed'
      where p.outcome = 'measured' and not i.is_verified
    ), updated as (
      update public.takeoff_items i set is_verified = true, verified_at = now_, verified_by = actor,
        verification_justification = null, updated_at = now_
      from rows_ r where i.id = r.id
      returning i.id
    )
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      takeoff_item_id, event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, r.id, 'row_verified',
      pg_catalog.jsonb_build_object('is_verified', false), pg_catalog.jsonb_build_object('is_verified', true), actor, now_
    from rows_ r join updated u on u.id = r.id;
    -- The marks revision of each answer accepted, locked last, after its rows (lot 5): no correction of its marks commits
    -- between this reading and the acceptance's commit, and one committed later makes it a decision to take again
    -- (private.takeoff_item_decision_effective).
    for marked in select w.answer_id from pg_temp.takeoff_review_written w order by w.answer_id loop
      perform private.lock_takeoff_count_marks_revision(marked);
    end loop;
    insert into public.takeoff_item_answer_decisions as d (answer_id, tenant_id, project_id, item_id, plan_logical_id, kind,
      reason, note, revision, actor_id, decided_at, command_id, marks_revision)
    select w.answer_id, p_tenant_id, p_project_id, w.item_id, p.plan_logical_id, 'accepted', null, null,
      p.decision_revision + 1, actor, now_, this_command, private.takeoff_count_marks_revision(w.answer_id)
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    on conflict (answer_id) do update set kind = excluded.kind, reason = null, note = null, revision = excluded.revision,
      actor_id = excluded.actor_id, decided_at = excluded.decided_at, command_id = excluded.command_id,
      marks_revision = excluded.marks_revision;
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, w.item_id, w.answer_id, p.plan_logical_id, 'accepted',
      pg_catalog.jsonb_build_object('kind', p.decision_effective), pg_catalog.jsonb_build_object('kind', 'accepted'), actor, now_
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id;

  elsif gesture = 'set_aside' then
    reason_text := pg_catalog.left('Écarté dans le tableau des postes : ' || case p_command ->> 'reason'
        when 'out_of_scope' then 'hors périmètre' when 'duplicate' then 'doublon' when 'reading_error' then 'erreur de lecture'
        else 'autre' end
      || coalesce(' — ' || nullif(pg_catalog.btrim(p_command ->> 'note'), ''), ''), 500);
    insert into pg_temp.takeoff_review_written
    select p.item_id, p.answer_id from pg_temp.takeoff_review_pairs p
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and p.decision_kind is distinct from 'set_aside';
    -- The positive rows of the answers set aside, excluded with the reason (a job still completed). What each row was
    -- (its exclusion and its verification: by whom, when, why) is journaled, so that a reinstatement gives it back. A
    -- verification is withdrawn with it, and the rules that read the exclusion wait for the server, as a member's edit
    -- does. A row already excluded with that reason is left as it is.
    with rows_ as (
      select i.id, i.job_id, i.is_excluded, i.exclusion_reason, i.is_verified, i.verified_at, i.verified_by,
        i.verification_justification, p.item_id, p.answer_id, p.plan_logical_id
      from pg_temp.takeoff_review_written w
      join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
      join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
      join public.takeoff_items i on i.id = o.takeoff_item_id
      join public.takeoff_jobs j on j.id = i.job_id and j.tenant_id = i.tenant_id and j.status = 'completed'
      where not (i.is_excluded and i.exclusion_reason is not distinct from reason_text)
    ), updated as (
      update public.takeoff_items i set is_excluded = true, exclusion_reason = reason_text, is_verified = false,
        verified_at = null, verified_by = null, verification_justification = null, updated_at = now_,
        rules_stale = case when i.rules_evaluated_at is not null or i.rules_stale then true else i.rules_stale end,
        rules_stale_at = case when i.rules_evaluated_at is not null or i.rules_stale then now_ else i.rules_stale_at end
      from rows_ r where i.id = r.id
      returning i.id
    ), journaled as (
      insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
        takeoff_item_id, event, before, after, actor_id, at)
      select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, r.id, 'row_excluded',
        pg_catalog.jsonb_build_object('is_excluded', r.is_excluded, 'exclusion_reason', r.exclusion_reason,
          'is_verified', r.is_verified, 'verified_at', r.verified_at, 'verified_by', r.verified_by,
          'verification_justification', r.verification_justification),
        pg_catalog.jsonb_build_object('is_excluded', true, 'exclusion_reason', reason_text), actor, now_
      from rows_ r join updated u on u.id = r.id
      returning takeoff_item_id
    )
    insert into pg_temp.takeoff_review_rules_jobs
    select distinct r.job_id from rows_ r join journaled e on e.takeoff_item_id = r.id
    on conflict do nothing;
    -- The answer's decision before, and every positive row of the answer as the set aside leaves it, changed by it or
    -- not (one already excluded with the reason included): what a reinstatement compares to say nothing changed.
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, w.item_id, w.answer_id, p.plan_logical_id, 'set_aside',
      pg_catalog.jsonb_build_object('kind', p.decision_effective, 'actor_id', case when p.decision_effective <> 'none' then d.actor_id end,
        'decided_at', case when p.decision_effective <> 'none' then d.decided_at end)
        -- The marks revision an acceptance set aside was taken on, given back with it by a reinstatement.
        || case when p.decision_effective = 'accepted' and coalesce(d.marks_revision, 0) > 0
          then pg_catalog.jsonb_build_object('marks_revision', d.marks_revision) else '{}'::jsonb end,
      pg_catalog.jsonb_build_object('kind', 'set_aside', 'reason', p_command ->> 'reason',
        'note', nullif(pg_catalog.btrim(p_command ->> 'note'), ''),
        'rows', coalesce((select pg_catalog.jsonb_object_agg(i.id::text, private.takeoff_item_review_row_state(i))
          from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id = o.takeoff_item_id
          where o.answer_id = w.answer_id and o.role = 'contribution'), '{}'::jsonb)), actor, now_
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    left join public.takeoff_item_answer_decisions d on d.answer_id = w.answer_id;
    insert into public.takeoff_item_answer_decisions as d (answer_id, tenant_id, project_id, item_id, plan_logical_id, kind,
      reason, note, revision, actor_id, decided_at, command_id)
    select w.answer_id, p_tenant_id, p_project_id, w.item_id, p.plan_logical_id, 'set_aside', p_command ->> 'reason',
      nullif(pg_catalog.btrim(p_command ->> 'note'), ''), p.decision_revision + 1, actor, now_, this_command
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    on conflict (answer_id) do update set kind = excluded.kind, reason = excluded.reason, note = excluded.note,
      revision = excluded.revision, actor_id = excluded.actor_id, decided_at = excluded.decided_at,
      command_id = excluded.command_id, marks_revision = null;

  elsif gesture = 'reinstate' then
    insert into pg_temp.takeoff_review_written
    select p.item_id, p.answer_id from pg_temp.takeoff_review_pairs p
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and p.decision_kind = 'set_aside';
    -- Each answer's latest set aside, the decision it replaced, and the rows it excluded with what each was. An answer
    -- every positive row of which holds what the set aside left (none changed since, those it did not change included)
    -- comes back whole: each row as it was, its verification included, and the decision it had. Otherwise each row still
    -- excluded with the set aside's reason gets its exclusion back without its verification, and the answer comes back to
    -- be decided; the journal says which.
    create temporary table pg_temp.takeoff_review_restored (answer_id uuid primary key, item_id uuid,
      plan_logical_id uuid, whole boolean, previous jsonb) on commit drop;
    insert into pg_temp.takeoff_review_restored
    select w.answer_id, w.item_id, p.plan_logical_id,
      pg_catalog.jsonb_typeof(aside.after -> 'rows') = 'object' and not exists (
        select 1 from pg_catalog.jsonb_each(aside.after -> 'rows') snapshot(row_id, state)
        left join public.takeoff_items i on i.id = snapshot.row_id::uuid
        where i.id is null or private.takeoff_item_review_row_state(i) is distinct from snapshot.state),
      aside.before
    from pg_temp.takeoff_review_written w
    join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    left join lateral (
      select ev.command_id, ev.before, ev.after from public.takeoff_item_review_events ev
      where ev.tenant_id = p_tenant_id and ev.project_id = p_project_id and ev.answer_id = w.answer_id and ev.event = 'set_aside'
      order by ev.id desc limit 1
    ) aside on true;
    with excluded_ as (
      select ev.takeoff_item_id, ev.before, ev.after, r.item_id, r.answer_id, r.plan_logical_id, r.whole
      from pg_temp.takeoff_review_restored r
      join lateral (select e.command_id from public.takeoff_item_review_events e
        where e.answer_id = r.answer_id and e.event = 'set_aside' order by e.id desc limit 1) aside on true
      join public.takeoff_item_review_events ev on ev.command_id = aside.command_id and ev.answer_id = r.answer_id
        and ev.event = 'row_excluded'
    ), rows_ as (
      select x.*, i.id, i.job_id from excluded_ x
      join public.takeoff_items i on i.id = x.takeoff_item_id and i.is_excluded
        and i.exclusion_reason is not distinct from (x.after ->> 'exclusion_reason')
      join public.takeoff_jobs j on j.id = i.job_id and j.tenant_id = i.tenant_id and j.status = 'completed'
    ), updated as (
      update public.takeoff_items i set is_excluded = coalesce((r.before ->> 'is_excluded')::boolean, false),
        exclusion_reason = case when coalesce((r.before ->> 'is_excluded')::boolean, false) then r.before ->> 'exclusion_reason' end,
        is_verified = r.whole and coalesce((r.before ->> 'is_verified')::boolean, false),
        verified_at = case when r.whole and coalesce((r.before ->> 'is_verified')::boolean, false)
          then (r.before ->> 'verified_at')::timestamptz end,
        verified_by = case when r.whole and coalesce((r.before ->> 'is_verified')::boolean, false)
          then (r.before ->> 'verified_by')::uuid end,
        verification_justification = case when r.whole and coalesce((r.before ->> 'is_verified')::boolean, false)
          then nullif(r.before -> 'verification_justification', 'null'::jsonb) end,
        updated_at = now_,
        rules_stale = case when i.rules_evaluated_at is not null or i.rules_stale then true else i.rules_stale end,
        rules_stale_at = case when i.rules_evaluated_at is not null or i.rules_stale then now_ else i.rules_stale_at end
      from rows_ r where i.id = r.id
      returning i.id, i.is_excluded, i.exclusion_reason, i.is_verified, i.verified_at, i.verified_by
    ), journaled as (
      insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
        takeoff_item_id, event, before, after, actor_id, at)
      select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, r.id, 'row_restored',
        r.after, pg_catalog.jsonb_build_object('is_excluded', u.is_excluded, 'exclusion_reason', u.exclusion_reason,
          'is_verified', u.is_verified, 'verified_at', u.verified_at, 'verified_by', u.verified_by), actor, now_
      from rows_ r join updated u on u.id = r.id
      returning takeoff_item_id
    )
    insert into pg_temp.takeoff_review_rules_jobs
    select distinct r.job_id from rows_ r join journaled e on e.takeoff_item_id = r.id
    on conflict do nothing;
    update public.takeoff_item_answer_decisions d set
      kind = case when r.whole and r.previous ->> 'kind' = 'accepted' then 'accepted' else 'none' end,
      reason = null, note = null, revision = d.revision + 1,
      actor_id = case when r.whole and r.previous ->> 'kind' = 'accepted' then (r.previous ->> 'actor_id')::uuid else actor end,
      decided_at = case when r.whole and r.previous ->> 'kind' = 'accepted' then (r.previous ->> 'decided_at')::timestamptz
        else now_ end,
      command_id = this_command,
      -- An acceptance given back is bound to the marks it was taken on: changed since, it is a decision to take again.
      marks_revision = case when r.whole and r.previous ->> 'kind' = 'accepted'
        then (r.previous ->> 'marks_revision')::integer end
    from pg_temp.takeoff_review_restored r where d.answer_id = r.answer_id;
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, 'reinstated',
      pg_catalog.jsonb_build_object('kind', 'set_aside'),
      pg_catalog.jsonb_build_object('kind', case when r.whole and r.previous ->> 'kind' = 'accepted' then 'accepted' else 'none' end,
        'restored', case when r.whole then 'whole' else 'changed' end), actor, now_
    from pg_temp.takeoff_review_restored r;

  elsif gesture = 'enter_quantity' then
    with values_ as (
      select (v.value ->> 'item_id')::uuid as item_id, (v.value ->> 'quantity')::numeric as quantity,
        pg_catalog.btrim(v.value ->> 'unit') as unit
      from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
      where (v.value ->> 'item_id')::uuid in (select (x.value #>> '{}')::uuid
        from pg_catalog.jsonb_array_elements(p_command -> 'apply') x(value))
    ), previous as (
      select v.*, e.id as entry_id, e.quantity as old_quantity, e.unit as old_unit, e.category as old_category,
        e.note as old_note, e.included as old_included, coalesce(e.revision, 0) as old_revision
      from values_ v
      left join public.takeoff_item_entries e on e.tenant_id = p_tenant_id and e.project_id = p_project_id
        and e.item_id = v.item_id and e.plan_logical_id is not distinct from scope_plan
    ), written as (
      insert into public.takeoff_item_entries as e (tenant_id, project_id, item_id, plan_logical_id, quantity, unit, category,
        note, included, revision, previous_quantity, previous_unit, actor_id, entered_at, command_id)
      select p_tenant_id, p_project_id, p.item_id, scope_plan, p.quantity, p.unit, p_command #>> '{entry,category}',
        nullif(pg_catalog.btrim(p_command #>> '{entry,note}'), ''), (p_command #>> '{entry,category}') <> 'hypothesis',
        p.old_revision + 1, p.old_quantity, p.old_unit, actor, now_, this_command
      from previous p
      on conflict (tenant_id, project_id, item_id, plan_logical_id) do update set quantity = excluded.quantity,
        unit = excluded.unit, category = excluded.category, note = excluded.note, included = excluded.included,
        revision = excluded.revision, previous_quantity = excluded.previous_quantity, previous_unit = excluded.previous_unit,
        actor_id = excluded.actor_id, entered_at = excluded.entered_at, command_id = excluded.command_id
      returning e.item_id
    )
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, plan_logical_id, event,
      before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, p.item_id, scope_plan, 'entered',
      case when p.entry_id is null then null else pg_catalog.jsonb_build_object('quantity', p.old_quantity, 'unit', p.old_unit,
        'category', p.old_category, 'note', p.old_note, 'included', p.old_included) end,
      pg_catalog.jsonb_build_object('quantity', p.quantity, 'unit', p.unit, 'category', p_command #>> '{entry,category}',
        'note', nullif(pg_catalog.btrim(p_command #>> '{entry,note}'), ''),
        'included', (p_command #>> '{entry,category}') <> 'hypothesis'), actor, now_
    from previous p join written w on w.item_id = p.item_id;
    insert into pg_temp.takeoff_review_written
    select (v.value #>> '{}')::uuid, null from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value);

  else -- include_entry
    with entry_ as (
      -- The entry keeps its author and its time; the inclusion is journaled as the includer's own decision.
      update public.takeoff_item_entries e set included = true, revision = e.revision + 1,
        command_id = this_command
      from pg_temp.takeoff_review_lines l
      where e.id = l.scope_entry_id
        and l.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      returning e.item_id, e.plan_logical_id
    )
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, plan_logical_id, event,
      before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, x.item_id, x.plan_logical_id, 'entry_included',
      '{"included": false}'::jsonb, '{"included": true}'::jsonb, actor, now_
    from entry_ x;
    insert into pg_temp.takeoff_review_written
    select (v.value #>> '{}')::uuid, null from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value);
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', w.item_id, 'answers', w.answers)
      order by w.item_id), '[]'::jsonb)
    into applied
  from (select item_id, (count(answer_id))::integer as answers from pg_temp.takeoff_review_written group by item_id) w;
  -- The jobs whose positive rows this command excluded or gave back: the server computes their rules again after the
  -- commit, and again on a replay, so that a refresh a stopped server owed is finished without deciding anything twice.
  outcome := pg_catalog.jsonb_build_object('outcome', 'applied', 'applied', applied,
    'skipped', coalesce(p_command -> 'skipped', '[]'::jsonb),
    'rules_jobs', coalesce((select pg_catalog.jsonb_agg(r.job_id order by r.job_id) from pg_temp.takeoff_review_rules_jobs r),
      '[]'::jsonb));
  insert into public.takeoff_item_review_commands (id, tenant_id, project_id, intent_key, actor_id, gesture, command_sha256,
    outcome)
  values (this_command, p_tenant_id, p_project_id, (p_command ->> 'intent_key')::uuid, actor, gesture, digest, outcome);
  return outcome || '{"replayed": false}'::jsonb;
end;
$$;

commit;
