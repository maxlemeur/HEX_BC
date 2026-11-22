-- Lot 4, B2: the review of the table of items — decisions on the stored answers, quantities entered, their journal,
-- and the table's readers.
--
-- The answers of an item on a plan (B1, 20261122080845_takeoff_item_answers.sql) are the raw reading, never changed.
-- Their review is kept apart, here:
--   - a decision on an answer, with or without a positive observation: accepted, set aside (one reason, a note for
--     « other ») or neither again after a reinstatement; it has a revision, its author (the member's session) and the
--     command that wrote it;
--   - a quantity entered by a member for the whole item (the affaire) or for its answer on one plan: value, unit,
--     category, note (required for an hypothesis), the value before; an entered hypothesis counts only once a member
--     included it by its own decision;
--   - a journal per line and per row of every effect, and one receipt per command (its intention key).
-- One command, public.review_takeoff_items, called with the member's session, writes them in one transaction:
-- compare-and-set on each answer's being current (its id among the current readings of the item in the scope, B1's
-- digest is not unique across identical readings) and on each decision's and entry's revision; a stale selection
-- writes nothing and names its items. It re-checks the rules each gesture needs under its locks (an acceptance only of
-- a measured item whose positive rows can be verified; never a forcing), and carries an acceptance to is_verified and a
-- set aside to is_excluded / exclusion_reason of the answers' positive rows (takeoff_items) in the same transaction,
-- with the controls of a verification and the staleness of the rules a client edit causes.
-- The readers of the table page, filter, order (the decisions to take first, then the list's order) and count its
-- facets in SQL, by state, plan, family, location and decision, with the state rule of B1 (one SQL rule, a pure
-- function now, that B1's states function calls).
--
-- What the previous application version sees while this is applied and after: nothing changes in its writes or answers.
--   - Every new relation is written only by public.review_takeoff_items (as its owner); no member writes it directly.
--   - No column, constraint, index, trigger or policy of an existing table changes. One function is replaced,
--     private.takeoff_item_reading_states (B1's only body), with the same results: its state expression moves to
--     private.takeoff_item_state, unchanged.
--   - The new foreign keys reference estimate_projects, takeoff_list_items and takeoff_item_answers: deleting a row of
--     those probes the new indexes (empty for every row a released writer deletes).
--   - takeoff_items rows are written only for jobs of a list (B1's answers exist only for those), and only by this
--     command, never by a released writer's path.
--
-- The command's locks, in this order, never the reverse: the affaire's row (for key share, as a foreign key takes it),
-- the affaire's review key takeoff-item-review:<affaire> (taken by this command only), the rules keys of the jobs whose
-- positive rows it writes (each version's takeoff-rules:<version>, then each job without a version's
-- takeoff-job-rules:<job> and takeoff-job:<job>, in identifier order, as a member's save of a row takes them), then the
-- rows of takeoff_items and its own relations. The readers take none.
--
-- Locks: every lock this migration needs is taken first, without waiting (nowait); a busy table refuses the migration
-- at once, nothing applied. Held for the DDL only. Nothing is copied or backfilled.
begin;

set local lock_timeout = '5s';
-- Bodies are validated when they first run (the database tests run every one): validating them here would lock the
-- tables they name.
set local check_function_bodies = off;

lock table public.estimate_projects, public.takeoff_list_items, public.takeoff_item_answers in share row exclusive mode nowait;

-- 1. Direct writes: only the command (as the owner) writes these relations; the service role keeps its table rights
--    but its direct write is refused, and the journal and the receipts are never updated.
create function private.refuse_takeoff_item_review_direct_write()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user = 'service_role' then
    raise exception 'TAKEOFF_ITEM_REVIEW_WRITER_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and tg_table_name in ('takeoff_item_review_commands', 'takeoff_item_review_events') then
    raise exception 'TAKEOFF_ITEM_REVIEW_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.refuse_takeoff_item_review_direct_write() from public, anon, authenticated, service_role;

-- 2. One receipt per command: its intention key, its author, its gesture, the digest of the command as received, and
--    what it answered. The same key and the same command answer the same; another command under the key is a conflict.
create table public.takeoff_item_review_commands (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  intent_key uuid not null,
  actor_id uuid not null,
  gesture text not null check (gesture in ('accept_measured', 'set_aside', 'reinstate', 'enter_quantity', 'include_entry')),
  command_sha256 text not null check (command_sha256 ~ '^[0-9a-f]{64}$'),
  outcome jsonb not null check (pg_catalog.jsonb_typeof(outcome) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_item_review_commands_intent_key unique (tenant_id, project_id, intent_key),
  constraint takeoff_item_review_commands_scope_key unique (id, tenant_id, project_id),
  constraint takeoff_item_review_commands_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade
);

-- 3. The current decision on an answer (B1), with or without a positive observation. kind « none »: reinstated, the
--    answer waits for a decision again; the revision goes on, so that a selection read before still compares.
create table public.takeoff_item_answer_decisions (
  answer_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  item_id uuid not null,
  plan_logical_id uuid not null,
  kind text not null check (kind in ('accepted', 'set_aside', 'none')),
  reason text check (reason in ('out_of_scope', 'duplicate', 'reading_error', 'other')),
  note text check (note = pg_catalog.btrim(note) and pg_catalog.char_length(note) between 1 and 500),
  revision integer not null check (revision >= 1),
  actor_id uuid not null,
  decided_at timestamptz not null,
  command_id uuid not null,
  constraint takeoff_item_answer_decisions_kind_reason_check check ((kind = 'set_aside') = (reason is not null)
    and (note is null or kind = 'set_aside') and (reason is distinct from 'other' or note is not null)),
  constraint takeoff_item_answer_decisions_answer_fkey foreign key (answer_id, tenant_id, project_id, item_id, plan_logical_id)
    references public.takeoff_item_answers (id, tenant_id, project_id, item_id, plan_logical_id) on delete cascade,
  -- Checked at the commit: the command's receipt is written after its effects.
  constraint takeoff_item_answer_decisions_command_fkey foreign key (command_id, tenant_id, project_id)
    references public.takeoff_item_review_commands (id, tenant_id, project_id) on delete cascade deferrable initially deferred
);
create index takeoff_item_answer_decisions_item_idx on public.takeoff_item_answer_decisions (tenant_id, project_id, item_id);
create index takeoff_item_answer_decisions_command_idx on public.takeoff_item_answer_decisions (command_id);

-- 4. A quantity entered by a member: for the whole item (plan_logical_id null: it replaces the item's total, measured
--    contributions are never added to it) or for the item's answer on one plan. One per scope; a new entry replaces it
--    and keeps the value before. The category is one of the quantity entries' (20261110094501): a note is required for
--    an hypothesis (10 to 500 code points without the blanks at its ends), at most 500 otherwise; an hypothesis counts
--    only once included.
create table public.takeoff_item_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  item_id uuid not null,
  plan_logical_id uuid,
  quantity numeric not null check (quantity > 0 and quantity < 1000000000),
  unit text not null check (unit = pg_catalog.btrim(unit) and pg_catalog.char_length(unit) between 1 and 16),
  category text not null check (category in ('site_survey', 'other_drawing', 'dpgf_cctp', 'written_confirmation',
    'documented_calculation', 'hypothesis')),
  note text check (note = pg_catalog.btrim(note) and pg_catalog.char_length(note) between 1 and 500),
  included boolean not null,
  revision integer not null check (revision >= 1),
  previous_quantity numeric check (previous_quantity > 0),
  previous_unit text,
  actor_id uuid not null,
  entered_at timestamptz not null,
  command_id uuid not null,
  constraint takeoff_item_entries_hypothesis_check check (category <> 'hypothesis'
    or pg_catalog.char_length(coalesce(note, '')) between 10 and 500),
  constraint takeoff_item_entries_included_check check (category = 'hypothesis' or included),
  constraint takeoff_item_entries_previous_check check ((previous_quantity is null) = (previous_unit is null)),
  constraint takeoff_item_entries_scope_key unique nulls not distinct (tenant_id, project_id, item_id, plan_logical_id),
  constraint takeoff_item_entries_item_fkey foreign key (item_id, tenant_id, project_id)
    references public.takeoff_list_items (id, tenant_id, project_id) on delete cascade,
  constraint takeoff_item_entries_command_fkey foreign key (command_id, tenant_id, project_id)
    references public.takeoff_item_review_commands (id, tenant_id, project_id) on delete cascade deferrable initially deferred
);
create index takeoff_item_entries_command_idx on public.takeoff_item_entries (command_id);

-- 5. The journal: one row per effect of a command, per item and, when it has one, per answer and per row of
--    takeoff_items, with what it was before and after. History: no key to the answer or the row, which may go.
create table public.takeoff_item_review_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  command_id uuid not null,
  item_id uuid not null,
  answer_id uuid,
  plan_logical_id uuid,
  takeoff_item_id uuid,
  event text not null check (event in ('accepted', 'set_aside', 'reinstated', 'entered', 'entry_included',
    'row_verified', 'row_excluded', 'row_restored')),
  before jsonb,
  after jsonb,
  actor_id uuid not null,
  at timestamptz not null,
  constraint takeoff_item_review_events_command_fkey foreign key (command_id, tenant_id, project_id)
    references public.takeoff_item_review_commands (id, tenant_id, project_id) on delete cascade deferrable initially deferred
);
create index takeoff_item_review_events_item_idx on public.takeoff_item_review_events (tenant_id, project_id, item_id);
create index takeoff_item_review_events_command_idx on public.takeoff_item_review_events (command_id);
create index takeoff_item_review_events_row_idx on public.takeoff_item_review_events (takeoff_item_id)
  where takeoff_item_id is not null;

do $$
declare
  relation text;
begin
  foreach relation in array array['takeoff_item_review_commands', 'takeoff_item_answer_decisions', 'takeoff_item_entries',
    'takeoff_item_review_events']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function '
      || 'private.refuse_takeoff_item_review_direct_write()', relation || '_writer', relation);
  end loop;
  -- The decisions, the entries and the journal are read like the affaire (the rule of its answers and its list).
  foreach relation in array array['takeoff_item_answer_decisions', 'takeoff_item_entries', 'takeoff_item_review_events']
  loop
    execute format('create policy %I on public.%I for select to authenticated using '
      || '((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)))', relation || '_reader_select',
      relation);
    execute format('grant select on public.%I to authenticated', relation);
  end loop;
end;
$$;

-- 6. The state of an item from its readings (B1, lot 4 section 3.2), as a pure function: no plan asked, to_measure; at
--    full coverage, uncertain when one answer is, measured when one is, not_found otherwise; a plan still queued or
--    read, reading; no plan answered, failed; some, incomplete. B1's states function calls it (same results); its
--    TypeScript twin, the reading's rule (src/lib/takeoff/poste-aggregation.ts) as the table reads it
--    (src/lib/takeoff/item-answer-aggregation.ts), runs the vectors of supabase/tests/database/takeoff-item-review.test.sql.
create function private.takeoff_item_state(p_expected integer, p_answered integer, p_in_flight integer,
  p_uncertain integer, p_measured integer)
returns text language sql immutable set search_path = '' as $$
  select case when p_expected = 0 then 'to_measure'
    when p_answered = p_expected then case when p_uncertain > 0 then 'uncertain' when p_measured > 0 then 'measured'
      else 'not_found' end
    when p_in_flight > 0 then 'reading'
    when p_answered = 0 then 'failed'
    else 'incomplete' end
$$;

-- What an acceptance certifies, from the stored facts, as the planner judges it (src/lib/takeoff/item-table.ts and
-- quantity-policy.ts run the vectors of supabase/tests/database/takeoff-item-review.test.sql): the unit as the screen
-- compares it (toUnitToken), a text blank as the screen trims it (String.prototype.trim), what keeps a measured answer's
-- positive row out of the bulk acceptance (itemAnswerAnomalies, in its order) and a quantity that needs a look against
-- its DPGF reference (compareQuantityPairs: more than 1 % apart).
create function private.takeoff_unit_token(p_unit text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.translate(pg_catalog.regexp_replace(
    normalize(coalesce(p_unit, ''), NFD), '[̀-ͯ]', '', 'g'), '²³', '23')), '[^a-z0-9]+', '', 'g')
$$;

create function private.takeoff_text_blank(p_text text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_text, '') !~ '[^\u0009-\u000d    -     　﻿]'
$$;

create function private.takeoff_item_row_anomalies(p_outcome text, p_reason_code text, p_row_found boolean,
  p_is_excluded boolean, p_rules_stale boolean, p_rule_results jsonb, p_confidence numeric, p_threshold numeric,
  p_evidence text, p_source_page integer, p_metadata jsonb, p_entry_category text, p_unit text, p_expected_unit text)
returns text[] language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(a.code order by a.rank), '{}') from (values
    (1, 'hypothesis', p_row_found and public.takeoff_item_hypothesis_cause(p_metadata, p_entry_category) is not null),
    (2, 'low_confidence', p_row_found and coalesce(p_confidence < p_threshold, false)),
    (3, 'missing_evidence', not p_row_found or private.takeoff_text_blank(p_evidence) or coalesce(p_source_page < 1, true)),
    (4, 'rule_failed', p_row_found and exists (select 1 from pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(p_rule_results) = 'array' then p_rule_results else '[]'::jsonb end) r(value)
      where pg_catalog.jsonb_typeof(r.value) = 'object' and r.value ->> 'status' = 'fail')),
    (5, 'rules_stale', p_row_found and coalesce(p_rules_stale, false)),
    (6, 'alert', (p_outcome = 'measured' and p_reason_code is not null) or (p_row_found and coalesce(p_is_excluded, false))),
    (7, 'unit_mismatch', p_row_found and p_outcome = 'measured' and coalesce(p_expected_unit, '') <> ''
      and private.takeoff_unit_token(p_unit) <> private.takeoff_unit_token(p_expected_unit))
  ) a(rank, code, hit) where a.hit
$$;

create function private.takeoff_quantity_requires_review(p_reference numeric, p_measured numeric)
returns boolean language sql immutable set search_path = '' as $$
  select pg_catalog.abs(p_measured - p_reference) > p_reference * 0.01 + 0.000000001
$$;

-- The total an acceptance would retain, the one compared with the DPGF reference (one rule, the planner's itemPartsTotal
-- in src/lib/takeoff/item-table.ts): its parts are the positive rows of its measured answers as they now are and the
-- plans' included entries; each part is rounded to the millionth, half away from zero, from its decimal value; the parts
-- are then added exactly, so their order changes nothing. No part, no total.
create function private.takeoff_item_total(p_parts numeric[])
returns numeric language sql immutable set search_path = '' as $$
  select pg_catalog.sum(pg_catalog.round(part, 6)) from pg_catalog.unnest(p_parts) as parts(part)
$$;

-- What a member's targeted save may change on a positive row: a set aside journals it for every positive row of its
-- answer (changed by it or not), a reinstatement compares it, so that a row changed in between is never given back what
-- it was.
create function private.takeoff_item_review_row_state(p_row public.takeoff_items)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('designation', p_row.designation, 'quantity', p_row.quantity, 'unit', p_row.unit,
    'source_page', p_row.source_page, 'evidence', p_row.evidence, 'is_excluded', p_row.is_excluded,
    'exclusion_reason', p_row.exclusion_reason, 'is_verified', p_row.is_verified, 'verified_at', p_row.verified_at,
    'verified_by', p_row.verified_by, 'verification_justification', p_row.verification_justification,
    'quantity_entered_at', p_row.quantity_entered_at, 'quantity_entered_by', p_row.quantity_entered_by,
    'quantity_entry_category', p_row.quantity_entry_category, 'quantity_entry_note', p_row.quantity_entry_note)
$$;

-- From 20261122080845_takeoff_item_answers.sql (its only body), the state expression now private.takeoff_item_state.
create or replace function private.takeoff_item_reading_states(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, item_position integer, state text, expected integer, answered integer, in_flight integer,
  ended integer)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select r.id from public.takeoff_list_revisions r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
    order by r.revision desc limit 1
  ), counts as (
    select e.item_id, e.position, count(p.plan_logical_id)::integer as expected,
      (count(*) filter (where p.reading = 'answered'))::integer as answered,
      (count(*) filter (where p.reading = 'in_flight'))::integer as in_flight,
      (count(*) filter (where p.reading = 'ended'))::integer as ended,
      (count(*) filter (where p.reading = 'answered' and p.outcome = 'uncertain'))::integer as uncertain,
      (count(*) filter (where p.reading = 'answered' and p.outcome = 'measured'))::integer as measured
    from public.takeoff_list_revision_entries e
    join latest on latest.id = e.revision_id
    left join private.takeoff_item_reading_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p on p.item_id = e.item_id
    group by e.item_id, e.position
  )
  select c.item_id, c.position,
    private.takeoff_item_state(c.expected, c.answered, c.in_flight, c.uncertain, c.measured),
    c.expected, c.answered, c.in_flight, c.ended
  from counts c
$$;

-- The decision a line of the table waits for or carries, from its answers in the scope: none without an answer; every
-- answer set aside, set_aside (an entry, the scope's or a plan's, is kept and counts for nothing); the scope's entry,
-- entered; an answer without a decision or an entry (an acceptance a targeted edit withdrew included), pending; else
-- entered when a plan's entry stands for an answer, accepted otherwise.
create function private.takeoff_item_line_decision(p_answers integer, p_undecided integer, p_set_aside integer,
  p_plan_entries integer, p_scope_entry boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_answers = 0 then 'none'
    when p_set_aside = p_answers then 'set_aside'
    when p_scope_entry then 'entered'
    when p_undecided > 0 then 'pending'
    when p_plan_entries > 0 then 'entered'
    else 'accepted' end
$$;

-- 7. The table's lines, for the readers and the command alike (no access check here: each caller makes its own).
-- The (item, plan) pairs of B1 in the scope, with each plan's location as recorded on its source (lot 3's annotation:
-- its building and level when an operator set them; a plan located only by the reading of its title block is not
-- located here), its current answer's decision and the plan's entry; the answer's job, sent or not (applied to an
-- estimate: its rows are the estimate's, no bulk command writes them); and the decision as it stands: an acceptance
-- whose positive rows a targeted edit no longer holds verified is none again (a decision to take).
create function private.takeoff_item_table_pairs(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, plan_logical_id uuid, plan_file_id uuid, plan_name text, plan_generation text, job_id uuid,
  unit_state text, reading text, answer_id uuid, outcome text, location_key text, location_label text,
  decision_kind text, decision_revision integer, plan_entry_id uuid, answer_job_id uuid, sent boolean,
  decision_effective text)
language sql stable security definer set search_path = '' as $$
  select p.item_id, p.plan_logical_id, p.plan_file_id, p.plan_name, p.plan_generation, p.job_id, p.unit_state, p.reading,
    p.answer_id, p.outcome, loc.location_key, loc.location_label, d.kind, coalesce(d.revision, 0),
    case when p_plan_logical_id is null then pe.id end, a.job_id, coalesce(aj.status::text = 'applied', false),
    case when d.kind = 'accepted' and exists (select 1 from public.takeoff_item_answer_observations o
        join public.takeoff_items i on i.id = o.takeoff_item_id
        where o.answer_id = p.answer_id and o.role = 'contribution' and not i.is_verified) then 'none'
      else coalesce(d.kind, 'none') end
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

-- Each item of the latest list revision in the scope (in a plan's scope, only the items asked about on that plan), with
-- its source facts (never a digest or a note of the import), its family (its section path), its state (B1) and the
-- decision of its line.
create function private.takeoff_item_table_lines(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, item_position integer, label text, expected_unit text, sections jsonb,
  reference_quantity numeric, origin_kind text, dpgf_reference text, family text, state text, expected integer,
  answered integer, in_flight integer, ended integer, decision text, scope_entry_id uuid)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select r.id from public.takeoff_list_revisions r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
    order by r.revision desc limit 1
  ), pairs as materialized (
    select * from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, p_plan_logical_id)
  ), decided as (
    select p.item_id, count(*)::integer as answers,
      (count(*) filter (where p.decision_effective = 'none' and p.plan_entry_id is null))::integer as undecided,
      (count(*) filter (where p.decision_effective = 'set_aside'))::integer as set_aside,
      (count(*) filter (where p.plan_entry_id is not null and p.decision_effective <> 'set_aside'))::integer as plan_entries
    from pairs p where p.answer_id is not null group by p.item_id
  )
  select e.item_id, e.position, e.label, e.expected_unit, e.sections, e.reference_quantity, e.origin_kind,
    case when e.origin_kind = 'dpgf' then e.origin ->> 'reference' end,
    (select pg_catalog.string_agg(s.value ->> 'title', ' / ' order by s.ordinality)
      from pg_catalog.jsonb_array_elements(e.sections) with ordinality s(value, ordinality)),
    st.state, st.expected, st.answered, st.in_flight, st.ended,
    private.takeoff_item_line_decision(coalesce(d.answers, 0), coalesce(d.undecided, 0), coalesce(d.set_aside, 0),
      coalesce(d.plan_entries, 0), se.id is not null),
    se.id
  from public.takeoff_list_revision_entries e
  join latest on latest.id = e.revision_id
  join private.takeoff_item_reading_states(p_tenant_id, p_project_id, p_plan_logical_id) st on st.item_id = e.item_id
  left join decided d on d.item_id = e.item_id
  left join public.takeoff_item_entries se on se.tenant_id = p_tenant_id and se.project_id = p_project_id
    and se.item_id = e.item_id and se.plan_logical_id is not distinct from p_plan_logical_id
  where p_plan_logical_id is null or exists (select 1 from pairs p where p.item_id = e.item_id)
$$;

-- A decision and an entry as the readers give them.
create function private.takeoff_item_decision_document(p_decision public.takeoff_item_answer_decisions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_decision.answer_id is null then null else pg_catalog.jsonb_build_object('kind', p_decision.kind,
    'revision', p_decision.revision, 'reason', p_decision.reason, 'note', p_decision.note, 'actor_id', p_decision.actor_id,
    'decided_at', p_decision.decided_at) end
$$;

create function private.takeoff_item_entry_document(p_entry public.takeoff_item_entries)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_entry.id is null then null else pg_catalog.jsonb_build_object('item_id', p_entry.item_id,
    'plan_logical_id', p_entry.plan_logical_id, 'quantity', p_entry.quantity, 'unit', p_entry.unit,
    'category', p_entry.category, 'note', p_entry.note, 'included', p_entry.included, 'revision', p_entry.revision,
    'previous_quantity', p_entry.previous_quantity, 'previous_unit', p_entry.previous_unit, 'actor_id', p_entry.actor_id,
    'entered_at', p_entry.entered_at) end
$$;

-- 8. The table's page, for the readers of the affaire (one access check for the statement): the items of the latest
--    list revision in the scope, filtered by state, family, location (of a plan they were read on) and decision, or the
--    items named; ordered with the decisions to take first, then the list's order; from an offset, or from the page
--    that holds the item in focus. Each item with its facts, its state, its coverage, its decision, the count of
--    matching items and its readings: per plan asked, the plan, its location, the latest job asked and its unit's
--    state, the current answer (B1's document), its decision and the plan's entry; and the scope's entry.
create function public.read_takeoff_item_table(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid default null,
  p_states text[] default null, p_families text[] default null, p_locations text[] default null,
  p_decisions text[] default null, p_item_ids uuid[] default null, p_focus_item_id uuid default null,
  p_offset integer default 0, p_limit integer default 50)
returns table (item_id uuid, item_position integer, label text, expected_unit text, sections jsonb,
  reference_quantity numeric, origin_kind text, dpgf_reference text, family text, state text, expected integer,
  answered integer, in_flight integer, ended integer, decision text, matching_items integer, page_offset integer,
  focus_found boolean, readings jsonb, entry jsonb)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false) as ok
  ), pairs as materialized (
    select p.* from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p
    where (select ok from allowed)
  ), lines as materialized (
    select l.* from private.takeoff_item_table_lines(p_tenant_id, p_project_id, p_plan_logical_id) l
    where (select ok from allowed)
      and (p_states is null or l.state = any (p_states))
      and (p_families is null or l.family = any (p_families))
      and (p_decisions is null or l.decision = any (p_decisions))
      and (p_item_ids is null or l.item_id = any (p_item_ids))
      and (p_locations is null or exists (select 1 from pairs p where p.item_id = l.item_id
        and p.location_key = any (p_locations)))
  ), ordered as materialized (
    select l.*, (row_number() over (order by (l.decision = 'pending') desc, l.item_position) - 1)::integer as idx,
      (count(*) over ())::integer as matching
    from lines l
  ), bounds as (
    select least(greatest(coalesce(p_limit, 50), 1), 1001) as size,
      (select o.idx from ordered o where o.item_id = p_focus_item_id) as focus_idx
  ), window_ as (
    select b.size, b.focus_idx is not null as focus_found,
      case when b.focus_idx is not null then (b.focus_idx / b.size) * b.size
        else greatest(coalesce(p_offset, 0), 0) end as start
    from bounds b
  )
  select o.item_id, o.item_position, o.label, o.expected_unit, o.sections, o.reference_quantity, o.origin_kind,
    o.dpgf_reference, o.family, o.state, o.expected, o.answered, o.in_flight, o.ended, o.decision, o.matching, w.start,
    w.focus_found,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('plan_logical_id', p.plan_logical_id,
        'plan_file_id', p.plan_file_id, 'plan_name', p.plan_name, 'plan_generation', p.plan_generation,
        'location_key', p.location_key, 'location_label', p.location_label, 'job_id', p.job_id, 'unit_state', p.unit_state,
        'reading', p.reading,
        'answer', (select private.takeoff_item_answer_document(a) from public.takeoff_item_answers a where a.id = p.answer_id),
        'decision', (select private.takeoff_item_decision_document(d) from public.takeoff_item_answer_decisions d
          where d.answer_id = p.answer_id and p.decision_effective <> 'none'),
        'decision_revision', p.decision_revision, 'sent', p.sent,
        'entry', (select private.takeoff_item_entry_document(x) from public.takeoff_item_entries x where x.id = p.plan_entry_id))
        order by p.plan_name, p.plan_logical_id)
      from pairs p where p.item_id = o.item_id), '[]'::jsonb),
    (select private.takeoff_item_entry_document(x) from public.takeoff_item_entries x where x.id = o.scope_entry_id)
  from ordered o
  cross join window_ w
  where o.idx >= w.start and o.idx < w.start + w.size
  order by o.idx
$$;

-- The table's facets in the scope, before any filter (a filter never hides its own options): the items per state, per
-- decision, per family, per location (an item read on several plans of a place counts once) and per plan.
create function public.count_takeoff_item_table(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid default null)
returns table (facet text, value text, label text, items integer)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false) as ok
  ), lines as materialized (
    select l.* from private.takeoff_item_table_lines(p_tenant_id, p_project_id, p_plan_logical_id) l
    where (select ok from allowed)
  ), pairs as materialized (
    select p.* from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p
    where (select ok from allowed)
  )
  select 'state', l.state, null::text, count(*)::integer from lines l group by l.state
  union all
  select 'decision', l.decision, null, count(*)::integer from lines l group by l.decision
  union all
  select 'family', l.family, null, count(*)::integer from lines l where l.family is not null group by l.family
  union all
  select 'location', p.location_key, min(p.location_label), count(distinct p.item_id)::integer
  from pairs p where p.location_key is not null group by p.location_key
  union all
  select 'plan', p.plan_logical_id::text, min(p.plan_name), count(distinct p.item_id)::integer
  from pairs p group by p.plan_logical_id
$$;

-- 9. The review command, called with the member's session (its actor is the session's user, never a client's word).
--    p_command: {command_version: 1, intent_key, gesture, scope: {kind: affaire} | {kind: plan, plan_logical_id},
--    targets: [{item_id, entry_revision, answers: [{answer_id, decision_revision, entry_revision}]}] (every item of the
--    selection, as read: in the affaire's scope an answer's entry_revision is that of its plan's entry, 0 without one or
--    in a plan's scope, where the plan's entry is the scope's), apply: [item_id] (those the server found eligible),
--    skipped: [{item_id, label, reason}] (the others, kept in the receipt), and per gesture: reason and note
--    (set_aside), values [{item_id, quantity, unit}] and entry {category, note} (enter_quantity).
--    Answers {outcome: applied, applied: [{item_id, answers}], skipped}, or {outcome: stale, stale: [item_id]} with
--    nothing written: an item not in the latest list or not in the scope, its current answers in the scope not exactly
--    those given, a decision's or an entry's revision moved (the scope's or a plan's), or an item the server found
--    eligible that no longer is (its state, its answers, or one of its positive rows that cannot be verified any more). The receipt is read first:
--    the same command under its key (its gesture, scope, targets and fields; apply and skipped are the server's) answers
--    what it answered (replayed: true), whatever changed since.
--    Refuses: TAKEOFF_ITEM_REVIEW_FORBIDDEN (no session, not the affaire's takeoff operator in the tenant the member
--    works in now), TAKEOFF_ITEM_REVIEW_INVALID (a malformed command), TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT (another
--    command under the key).
--    Locks, in the order of the head of this file: the affaire's row (for key share), the affaire's review key (a new
--    advisory key), the rules keys of each job whose positive rows it may write as public.update_takeoff_item_for_review
--    takes them (takeoff-rules:<version> for a job sent to a version, every version first; takeoff-job-rules:<job> then
--    takeoff-job:<job> otherwise; each in identifier order), before any row is judged; then the rows (takeoff_items),
--    then its own relations. A positive row is written only while its job is completed (a job sent keeps its rows).
create function public.review_takeoff_items(p_tenant_id uuid, p_project_id uuid, p_command jsonb)
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

  create temporary table if not exists pg_temp.takeoff_review_lines (item_id uuid primary key, state text,
    scope_entry_id uuid, expected_unit text, reference_quantity numeric) on commit drop;
  create temporary table if not exists pg_temp.takeoff_review_pairs (item_id uuid, plan_logical_id uuid, answer_id uuid,
    outcome text, decision_kind text, decision_effective text, decision_revision integer, plan_entry_id uuid,
    plan_entry_revision integer, job_id uuid, sent boolean, reason_code text) on commit drop;
  create temporary table if not exists pg_temp.takeoff_review_rules_jobs (job_id uuid primary key) on commit drop;
  truncate pg_temp.takeoff_review_rules_jobs;

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

  create temporary table if not exists pg_temp.takeoff_review_written (item_id uuid, answer_id uuid) on commit drop;
  truncate pg_temp.takeoff_review_written;

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
    insert into public.takeoff_item_answer_decisions as d (answer_id, tenant_id, project_id, item_id, plan_logical_id, kind,
      reason, note, revision, actor_id, decided_at, command_id)
    select w.answer_id, p_tenant_id, p_project_id, w.item_id, p.plan_logical_id, 'accepted', null, null,
      p.decision_revision + 1, actor, now_, this_command
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    on conflict (answer_id) do update set kind = excluded.kind, reason = null, note = null, revision = excluded.revision,
      actor_id = excluded.actor_id, decided_at = excluded.decided_at, command_id = excluded.command_id;
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
        'decided_at', case when p.decision_effective <> 'none' then d.decided_at end),
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
      command_id = excluded.command_id;

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
    create temporary table if not exists pg_temp.takeoff_review_restored (answer_id uuid primary key, item_id uuid,
      plan_logical_id uuid, whole boolean, previous jsonb) on commit drop;
    truncate pg_temp.takeoff_review_restored;
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
      command_id = this_command
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

do $$
declare
  routine text;
begin
  foreach routine in array array['private.takeoff_item_state(integer, integer, integer, integer, integer)',
    'private.takeoff_item_line_decision(integer, integer, integer, integer, boolean)',
    'private.takeoff_item_table_pairs(uuid, uuid, uuid)', 'private.takeoff_item_table_lines(uuid, uuid, uuid)',
    'private.takeoff_item_decision_document(public.takeoff_item_answer_decisions)',
    'private.takeoff_unit_token(text)', 'private.takeoff_text_blank(text)',
    'private.takeoff_item_row_anomalies(text, text, boolean, boolean, boolean, jsonb, numeric, numeric, text, integer, jsonb, text, text, text)',
    'private.takeoff_quantity_requires_review(numeric, numeric)', 'private.takeoff_item_total(numeric[])',
    'private.takeoff_item_review_row_state(public.takeoff_items)',
    'private.takeoff_item_entry_document(public.takeoff_item_entries)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', routine);
  end loop;
  foreach routine in array array['public.read_takeoff_item_table(uuid, uuid, uuid, text[], text[], text[], text[], uuid[], uuid, integer, integer)',
    'public.count_takeoff_item_table(uuid, uuid, uuid)', 'public.review_takeoff_items(uuid, uuid, jsonb)']
  loop
    execute format('revoke all on function %s from public, anon, service_role', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

commit;
