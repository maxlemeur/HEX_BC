-- Lot 5, A: the counted marks of an item on a page, stored, and their commands.
--
-- A mark names one physical object on an original page of a document revision: the page of evidence is the plan as the
-- request sealed it in a stored answer (lot 4, B1: 20261122080845_takeoff_item_answers.sql), its logical identity, its
-- generation and the digest of its bytes, the original page (1-based) and a versioned descriptor of its geometry
-- (visible box, intrinsic rotation, UserUnit, width and height at scale 1). The mark has an opaque identity, a finite
-- centre normalised in [0, 1] in the visible page after its intrinsic rotation (top-left origin) and an optional
-- non-degenerate box. A corrective move keeps its identity; its earlier coordinates stay in the journal (and a machine
-- mark's first ones in its source proposal). Another object is another mark. No PDF byte, base64 or address is stored.
--
-- Around a mark: its source proposals (immutable, bounded: method and version, the answer, the job and observation,
-- centre and box as the reader gave them, subtype and diameter read or unknown, confidence), its attribution to the
-- answer of an item of a sealed list on that plan (proposed, to attribute, retained explicitly, removed with a reason;
-- at most one retained attribution of a mark among competing items), and, per answer, a marks revision, the state of
-- each page of its scope (changed at, verified at) and a journal: one event per gesture, chained to the answer's
-- previous event, with its command (intention key, digest of its content, actor, instant, revisions before and after).
--
-- Commands:
--   - public.publish_takeoff_count_marks: the worker's publication of one machine generation of the job's marks, by the
--     attempt that published the job's answers (the digest of its lease token, B1), replay-safe by answer, generation and
--     source key. An answer no gesture has touched yet takes the generation as its proposals; an answer already reviewed
--     keeps its marks, and the generation waits there, unattributed, for a member to retain its marks one by one.
--   - public.edit_takeoff_count_marks: an operator's edit of up to 500 gestures at once (add, move, remove with a reason,
--     restore, retain, reattribute, verify the pages inspected), under the expected marks revision of every answer it
--     changes, replayed by its intention key.
--   - The server-side count: private.takeoff_count_mark_summary, given by public.read_takeoff_count_mark_summaries and
--     by every command's answer.
-- The derivation, by answer then by page: the distinct marks retained for the answer. Three numbers stay apart: the
-- marks proposed (undecided), the marks reread (retained on the pages whose verification is current) and the quantity
-- retained, which exists only once every page of the answer's scope is verified at its current state with nothing
-- undecided, and is never 0: a verified scope without a retained mark is « Aucun repère retenu », a SQL NULL. Machine
-- marks alone never give a quantity. A grouped page total of lot 4 is a figure of the answer, never added to these.
--
-- For the review decisions (lot 4, B2, not on main when this was written): private.takeoff_count_marks_revision gives an
-- answer's marks revision (0 before any), private.lock_takeoff_count_marks_revision gives it under a share lock of its
-- row (for a command that must compare it with the revision its acceptance recorded), and
-- public.takeoff_count_marks_changed_since tells a member whether the marks of an answer changed since a revision.
--
-- What the previous application version sees while this is applied and after: nothing changes in its writes or answers.
--   - Every new relation is written only by the functions above (as their owner) and read by the readers of the affaire;
--     no column, constraint, index, trigger, policy or function of an existing table changes or is replaced.
--   - The new foreign keys reference estimate_projects, takeoff_item_answers and takeoff_item_answer_observations:
--     deleting a row of those probes the new indexes on it (empty for every row a released writer deletes: no mark can
--     exist before the second measuring order is activated, as no answer can).
--
-- Locks of the commands, in the takeoff order (never the reverse): the affaire's row for key share (rank 2); for the
-- publication, the job's row for no key update (rank 5); then, as rows (rank 8), the answers for key share in
-- identifier order, the answers' marks states for update in identifier order, then the marks the gestures name for
-- update in identifier order. None of lot 2 to 4's advisory keys, no request, no takeoff_items row.
--
-- Locks of this migration: every lock it needs is taken first, in one statement, without waiting (nowait): a busy table
-- refuses the migration at once, nothing applied, and it never waits while holding a lock. Held for the DDL only (a few
-- milliseconds). Nothing is copied or backfilled: an old « 3 u » gets no invented positions.
begin;

set local lock_timeout = '5s';
-- The bodies are validated when they first run (the database tests run every one), as #447 and #461 do.
set local check_function_bodies = off;

lock table public.estimate_projects, public.takeoff_item_answers, public.takeoff_item_answer_observations
  in share row exclusive mode nowait;

-- 1. Direct writes. Only the functions of this file (as the owner) write these relations; the service role keeps its
--    table rights, as on every public table, but its direct write is refused; a cascade runs as the owner. The facts
--    (pages, proposals, events, commands) are never updated.
create function private.refuse_takeoff_count_mark_direct_write()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user = 'service_role' then
    raise exception 'TAKEOFF_MARKS_WRITER_REQUIRED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.refuse_takeoff_count_mark_direct_write() from public, anon, authenticated, service_role;

create function private.refuse_takeoff_count_mark_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'TAKEOFF_MARKS_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.refuse_takeoff_count_mark_update() from public, anon, authenticated, service_role;

-- 2. The page of evidence: one per original page of a plan's bytes in the affaire. Its key is the plan's logical
--    identity and the digest of its bytes (a new generation with other bytes is another page; the same bytes are the same
--    page); it keeps the copy and the generation that first named it, and the geometry descriptor the first command gave
--    (every later one must give the same). Version 1: the visible box in PDF units [x0, y0, x1, y1], the intrinsic
--    rotation, UserUnit, and the visible page's width and height at scale 1 after that rotation.
create table public.takeoff_count_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  plan_logical_id uuid not null,
  plan_file_id uuid not null,
  plan_generation text check (pg_catalog.char_length(plan_generation) between 1 and 200),
  plan_content_sha256 text not null check (plan_content_sha256 ~ '^[0-9a-f]{64}$'),
  page integer not null check (page between 1 and 100000),
  geometry_version integer not null check (geometry_version = 1),
  view_box numeric[] not null,
  rotation integer not null check (rotation in (0, 90, 180, 270)),
  user_unit numeric not null check (user_unit > 0 and user_unit <= 1000),
  width numeric not null check (width > 0 and width <= 10000000),
  height numeric not null check (height > 0 and height <= 10000000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_count_pages_view_box_check check (pg_catalog.cardinality(view_box) = 4
    and pg_catalog.array_position(view_box, null) is null
    and view_box[1] >= -10000000 and view_box[2] >= -10000000 and view_box[3] <= 10000000 and view_box[4] <= 10000000
    and view_box[3] > view_box[1] and view_box[4] > view_box[2]),
  -- The visible page has the box's proportions, turned by the rotation (to a millionth).
  constraint takeoff_count_pages_proportions_check check (pg_catalog.abs(width * case when rotation in (0, 180)
      then view_box[4] - view_box[2] else view_box[3] - view_box[1] end
    - height * case when rotation in (0, 180) then view_box[3] - view_box[1] else view_box[4] - view_box[2] end)
    <= 0.000001 * width * case when rotation in (0, 180) then view_box[4] - view_box[2] else view_box[3] - view_box[1] end),
  constraint takeoff_count_pages_affaire_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade,
  constraint takeoff_count_pages_page_key unique (tenant_id, project_id, plan_logical_id, plan_content_sha256, page),
  constraint takeoff_count_pages_scope_key unique (id, tenant_id, project_id)
);

-- 3. The mark: one physical object on one page. Its position is the current one (a move keeps the identity and counts
--    in position_revision; the journal keeps the earlier one). A manual mark names its author, a machine mark its job.
create table public.takeoff_count_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  page_id uuid not null,
  origin text not null check (origin in ('machine', 'manual')),
  x numeric not null check (x >= 0 and x <= 1),
  y numeric not null check (y >= 0 and y <= 1),
  box numeric[],
  position_revision integer not null check (position_revision between 1 and 100000),
  created_by uuid,
  created_job_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  moved_by uuid,
  moved_at timestamptz,
  constraint takeoff_count_marks_box_check check (box is null or (pg_catalog.cardinality(box) = 4
    and pg_catalog.array_position(box, null) is null and box[1] >= 0 and box[2] >= 0 and box[3] <= 1 and box[4] <= 1
    and box[3] > box[1] and box[4] > box[2])),
  constraint takeoff_count_marks_origin_rule_check check ((origin = 'manual') = (created_by is not null)
    and (origin = 'machine') = (created_job_id is not null) and (moved_by is null) = (moved_at is null)
    and (position_revision = 1) = (moved_at is null)),
  constraint takeoff_count_marks_page_fkey foreign key (page_id, tenant_id, project_id)
    references public.takeoff_count_pages (id, tenant_id, project_id) on delete cascade,
  constraint takeoff_count_marks_scope_key unique (id, tenant_id, project_id, page_id)
);
create index takeoff_count_marks_page_idx on public.takeoff_count_marks (page_id);

-- 4. The marks state of an answer: its marks revision (0 before any event, one more per accepted command that changes
--    it), whether a member changed it, and its journal's last event. One row per answer that has one; deleted with it.
create table public.takeoff_count_answer_states (
  answer_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  revision integer not null check (revision between 0 and 1000000),
  member_edited boolean not null,
  last_event_id uuid,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_count_answer_states_answer_fkey foreign key (answer_id, tenant_id, project_id)
    references public.takeoff_item_answers (id, tenant_id, project_id) on delete cascade,
  constraint takeoff_count_answer_states_scope_key unique (answer_id, tenant_id, project_id)
);

-- Each page of an answer's scope that changed or was verified: the revision of its last change for this answer, and the
-- revision of its last verification (by whom, when). A page is verified while that verification is not older than its
-- last change.
create table public.takeoff_count_answer_pages (
  answer_id uuid not null,
  page integer not null check (page between 1 and 100000),
  tenant_id uuid not null,
  project_id uuid not null,
  changed_revision integer not null check (changed_revision between 0 and 1000000),
  verified_revision integer check (verified_revision between 1 and 1000000),
  verified_by uuid,
  verified_at timestamptz,
  primary key (answer_id, page),
  constraint takeoff_count_answer_pages_verification_check check ((verified_revision is null) = (verified_by is null)
    and (verified_by is null) = (verified_at is null)),
  constraint takeoff_count_answer_pages_state_fkey foreign key (answer_id, tenant_id, project_id)
    references public.takeoff_count_answer_states (answer_id, tenant_id, project_id) on delete cascade
);

-- 5. The attribution of a mark to an answer: proposed (by a machine reading, undecided), to attribute (a machine reading
--    that could not tell the item: an ambiguous diameter, a tee), retained (a member kept it or added it), removed (by a
--    member, with a reason; restoring returns it to the state it had). At most one retained attribution per mark: one
--    effective item for one object among competing items.
create table public.takeoff_count_mark_attributions (
  mark_id uuid not null,
  answer_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  page_id uuid not null,
  state text not null check (state in ('proposed', 'to_attribute', 'retained', 'removed')),
  prior_state text check (prior_state in ('proposed', 'to_attribute', 'retained')),
  reason_code text check (reason_code in ('duplicate', 'not_this_item', 'legend_or_detail', 'not_installed',
    'outside_scope', 'other', 'reattributed')),
  reason_text text check (reason_text = pg_catalog.btrim(reason_text) and pg_catalog.char_length(reason_text) between 1 and 500),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (mark_id, answer_id),
  constraint takeoff_count_mark_attributions_state_rule_check check ((state = 'removed') = (prior_state is not null)
    and (state = 'removed') = (reason_code is not null) and (reason_text is null or state = 'removed')
    and (reason_code is distinct from 'other' or reason_text is not null)
    and (decided_by is null) = (decided_at is null) and (state not in ('retained', 'removed') or decided_by is not null)),
  constraint takeoff_count_mark_attributions_mark_fkey foreign key (mark_id, tenant_id, project_id, page_id)
    references public.takeoff_count_marks (id, tenant_id, project_id, page_id) on delete cascade,
  constraint takeoff_count_mark_attributions_answer_fkey foreign key (answer_id, tenant_id, project_id)
    references public.takeoff_item_answers (id, tenant_id, project_id) on delete cascade
);
create unique index takeoff_count_mark_attributions_retained_uidx on public.takeoff_count_mark_attributions (mark_id)
  where state = 'retained';
create index takeoff_count_mark_attributions_answer_idx on public.takeoff_count_mark_attributions (answer_id, page_id, mark_id);

-- 6. The source proposals of a mark: what one machine reading gave for one answer, immutable. Unique by answer, machine
--    generation and the reader's source key (a replay writes nothing twice). The centre and box normalised as the mark's;
--    the raw ones in the reader's own frame (a tile, a call); subtype and diameter as read, or unknown (null).
create table public.takeoff_count_mark_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  mark_id uuid not null,
  page_id uuid not null,
  answer_id uuid not null,
  job_id uuid not null,
  observation_id uuid references public.takeoff_item_answer_observations (id) on delete cascade,
  generation integer not null check (generation between 1 and 1000),
  source_key text not null check (source_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$'),
  method text not null check (method ~ '^[a-z][a-z0-9_]{0,47}$'),
  method_version text not null check (method_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  proposed_state text not null check (proposed_state in ('proposed', 'to_attribute')),
  x numeric not null check (x >= 0 and x <= 1),
  y numeric not null check (y >= 0 and y <= 1),
  box numeric[],
  raw_centre numeric[],
  raw_box numeric[],
  raw_frame text check (raw_frame ~ '^[a-z][a-z0-9_:-]{0,63}$'),
  source_ref text check (pg_catalog.char_length(source_ref) between 1 and 200 and source_ref !~ '://'
    and source_ref !~* '^data:'),
  subtype text check (pg_catalog.char_length(pg_catalog.btrim(subtype)) between 1 and 120),
  diameter_mm numeric check (diameter_mm > 0 and diameter_mm <= 10000),
  diameter_source text check (diameter_source in ('label', 'callout', 'connection', 'legend', 'model')),
  confidence numeric check (confidence between 0 and 1),
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_count_mark_proposals_box_check check (box is null or (pg_catalog.cardinality(box) = 4
    and pg_catalog.array_position(box, null) is null and box[1] >= 0 and box[2] >= 0 and box[3] <= 1 and box[4] <= 1
    and box[3] > box[1] and box[4] > box[2])),
  constraint takeoff_count_mark_proposals_raw_check check (
    (raw_centre is null or (pg_catalog.cardinality(raw_centre) = 2 and pg_catalog.array_position(raw_centre, null) is null
      and raw_centre[1] between -10000000 and 10000000 and raw_centre[2] between -10000000 and 10000000))
    and (raw_box is null or (pg_catalog.cardinality(raw_box) = 4 and pg_catalog.array_position(raw_box, null) is null
      and raw_box[1] >= -10000000 and raw_box[2] >= -10000000 and raw_box[3] <= 10000000 and raw_box[4] <= 10000000
      and raw_box[3] > raw_box[1] and raw_box[4] > raw_box[2]))),
  constraint takeoff_count_mark_proposals_diameter_check check ((diameter_mm is null) = (diameter_source is null)),
  constraint takeoff_count_mark_proposals_mark_fkey foreign key (mark_id, tenant_id, project_id, page_id)
    references public.takeoff_count_marks (id, tenant_id, project_id, page_id) on delete cascade,
  constraint takeoff_count_mark_proposals_answer_fkey foreign key (answer_id, tenant_id, project_id, job_id)
    references public.takeoff_item_answers (id, tenant_id, project_id, job_id) on delete cascade,
  constraint takeoff_count_mark_proposals_source_key unique (answer_id, generation, source_key)
);
create index takeoff_count_mark_proposals_mark_idx on public.takeoff_count_mark_proposals (mark_id);
create index takeoff_count_mark_proposals_observation_idx on public.takeoff_count_mark_proposals (observation_id)
  where observation_id is not null;

-- 7. The commands accepted: a publication (its job and generation, the digest of the attempt's lease token) or an edit
--    (its intention key and its member), the digest of their content, the revisions before and after of each answer
--    they changed, and their answer for a replay. Never read by members (the intention keys and the attempt digests).
create table public.takeoff_count_mark_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  kind text not null check (kind in ('publication', 'edit')),
  intent_key uuid,
  actor_id uuid,
  job_id uuid,
  generation integer check (generation between 1 and 1000),
  attempt_sha256 text check (attempt_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  revisions jsonb not null check (pg_catalog.jsonb_typeof(revisions) = 'object'),
  result jsonb not null check (pg_catalog.jsonb_typeof(result) = 'object' and pg_catalog.octet_length(result::text) <= 1048576),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_count_mark_commands_kind_rule_check check (
    (kind = 'edit') = (intent_key is not null and actor_id is not null)
    and (kind = 'publication') = (job_id is not null and generation is not null and attempt_sha256 is not null)),
  constraint takeoff_count_mark_commands_affaire_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade
);
create unique index takeoff_count_mark_commands_intent_uidx on public.takeoff_count_mark_commands (tenant_id, intent_key)
  where kind = 'edit';
create unique index takeoff_count_mark_commands_generation_uidx on public.takeoff_count_mark_commands (job_id, generation)
  where kind = 'publication';
create index takeoff_count_mark_commands_affaire_idx on public.takeoff_count_mark_commands (project_id, tenant_id);

-- 8. The journal of an answer's marks: one event per gesture (one per page for a publication), in order, each naming the
--    answer's revision it produced and the answer's previous event. It stays when the answer's job is deleted (no key
--    to the answer: the trace of what was decided outlives the reading), and goes only with its affaire.
create table public.takeoff_count_mark_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  answer_id uuid not null,
  revision integer not null check (revision between 1 and 1000000),
  ordinal integer not null check (ordinal between 1 and 100000),
  -- Checked at the commit: the command's row is written after its effects.
  command_id uuid not null references public.takeoff_count_mark_commands (id) on delete cascade
    deferrable initially deferred,
  gesture text not null check (gesture in ('proposed', 'add', 'move', 'remove', 'restore', 'retain', 'reattribute_out',
    'reattribute_in', 'verify')),
  mark_id uuid,
  page integer not null check (page between 1 and 100000),
  before jsonb check (before is null or (pg_catalog.jsonb_typeof(before) = 'object'
    and pg_catalog.octet_length(before::text) <= 4000)),
  after jsonb check (after is null or (pg_catalog.jsonb_typeof(after) = 'object'
    and pg_catalog.octet_length(after::text) <= 4000)),
  reason_code text check (reason_code in ('duplicate', 'not_this_item', 'legend_or_detail', 'not_installed',
    'outside_scope', 'other', 'reattributed')),
  reason_text text check (pg_catalog.char_length(reason_text) between 1 and 500),
  previous_event_id uuid,
  actor_kind text not null check (actor_kind in ('member', 'worker')),
  actor_id uuid,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_count_mark_events_actor_check check ((actor_kind = 'member') = (actor_id is not null)),
  constraint takeoff_count_mark_events_affaire_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade,
  constraint takeoff_count_mark_events_order_key unique (answer_id, revision, ordinal)
);
create index takeoff_count_mark_events_affaire_idx on public.takeoff_count_mark_events (project_id, tenant_id);
create index takeoff_count_mark_events_command_idx on public.takeoff_count_mark_events (command_id);
create index takeoff_count_mark_events_mark_idx on public.takeoff_count_mark_events (mark_id) where mark_id is not null;

do $$
declare
  relation text;
begin
  foreach relation in array array['takeoff_count_pages', 'takeoff_count_marks', 'takeoff_count_answer_states',
    'takeoff_count_answer_pages', 'takeoff_count_mark_attributions', 'takeoff_count_mark_proposals',
    'takeoff_count_mark_commands', 'takeoff_count_mark_events']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function '
      || 'private.refuse_takeoff_count_mark_direct_write()', relation || '_writer', relation);
    if relation in ('takeoff_count_pages', 'takeoff_count_mark_proposals', 'takeoff_count_mark_commands',
      'takeoff_count_mark_events') then
      execute format('create trigger %I before update on public.%I for each row execute function '
        || 'private.refuse_takeoff_count_mark_update()', relation || '_immutable', relation);
    end if;
    -- The readers of the affaire, in the tenant the member works in now (the rule of the affaire's answers and jobs).
    if relation <> 'takeoff_count_mark_commands' then
      execute format('create policy %I on public.%I for select to authenticated using '
        || '((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)))', relation || '_reader_select',
        relation);
      execute format('grant select on public.%I to authenticated', relation);
    end if;
  end loop;
end;
$$;


-- 9. Checks of a command's input, before anything is read under a lock. B1's checks of a JSON value are reused
--    (private.takeoff_item_answer_is_uuid, _is_text, _is_number, _pages_valid).

-- A JSON array of p_count numbers, each within [p_min, p_max], typed; null when it is not one.
create function private.takeoff_count_mark_numbers(p_value jsonb, p_count integer, p_min numeric, p_max numeric)
returns numeric[] language plpgsql immutable set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'array' or pg_catalog.jsonb_array_length(p_value) <> p_count
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_value) v(value)
      where not private.takeoff_item_answer_is_number(v.value, p_min, p_max, false)) then
    return null;
  end if;
  return array(select (v.value #>> '{}')::numeric from pg_catalog.jsonb_array_elements(p_value) with ordinality v(value, n)
    order by v.n);
end;
$$;

-- A box normalised in the visible page, [x0, y0, x1, y1] in [0, 1] and not degenerate, typed; null otherwise.
create function private.takeoff_count_mark_box(p_value jsonb)
returns numeric[] language plpgsql immutable set search_path = '' as $$
declare
  box numeric[] := private.takeoff_count_mark_numbers(p_value, 4, 0, 1);
begin
  if box is null or box[3] <= box[1] or box[4] <= box[2] then
    return null;
  end if;
  return box;
end;
$$;

-- A page's geometry descriptor, version 1 (section 2), typed; no row when it is not one.
create function private.takeoff_count_page_geometry(p_value jsonb)
returns table (view_box numeric[], rotation integer, user_unit numeric, width numeric, height numeric)
language plpgsql immutable set search_path = '' as $$
declare
  box numeric[];
  turned boolean;
  visible_width numeric;
  visible_height numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'object'
    or (p_value - array['version', 'view_box', 'rotation', 'user_unit', 'width', 'height']) <> '{}'::jsonb
    or p_value -> 'version' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_value -> 'rotation') is distinct from 'number'
    or (p_value ->> 'rotation') not in ('0', '90', '180', '270')
    or not private.takeoff_item_answer_is_number(p_value -> 'user_unit', 0, 1000, false, true)
    or not private.takeoff_item_answer_is_number(p_value -> 'width', 0, 10000000, false, true)
    or not private.takeoff_item_answer_is_number(p_value -> 'height', 0, 10000000, false, true) then
    return;
  end if;
  box := private.takeoff_count_mark_numbers(p_value -> 'view_box', 4, -10000000, 10000000);
  if box is null or box[3] <= box[1] or box[4] <= box[2] then
    return;
  end if;
  -- The visible page has the box's proportions, turned by the rotation (to a millionth), as the table checks.
  turned := (p_value ->> 'rotation') in ('90', '270');
  visible_width := case when turned then box[4] - box[2] else box[3] - box[1] end;
  visible_height := case when turned then box[3] - box[1] else box[4] - box[2] end;
  if pg_catalog.abs((p_value ->> 'width')::numeric * visible_height - (p_value ->> 'height')::numeric * visible_width)
    > 0.000001 * (p_value ->> 'width')::numeric * visible_height then
    return;
  end if;
  return query select box, (p_value ->> 'rotation')::integer, (p_value ->> 'user_unit')::numeric,
    (p_value ->> 'width')::numeric, (p_value ->> 'height')::numeric;
end;
$$;

-- The pages of an answer's scope: those it searched and those it could not read, in order.
create function private.takeoff_count_answer_scope(p_answer public.takeoff_item_answers)
returns integer[] language sql immutable set search_path = '' as $$
  select array(select distinct p from pg_catalog.unnest(p_answer.searched_pages || p_answer.unreadable_pages) p order by 1)
$$;

-- Whether an answer is the current reading of its item on its plan (no later reading replaced it).
create function private.takeoff_count_answer_is_current(p_answer public.takeoff_item_answers)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.takeoff_item_answers n
    where n.tenant_id = p_answer.tenant_id and n.project_id = p_answer.project_id and n.item_id = p_answer.item_id
      and n.plan_logical_id = p_answer.plan_logical_id and n.reading_revision > p_answer.reading_revision)
$$;

-- The page of evidence of a page of an answer's plan: the existing one, or a new one with the geometry given. Refuses a
-- page outside the answer's scope (TAKEOFF_MARKS_PAGE_OUTSIDE), a new page without its geometry
-- (TAKEOFF_MARKS_PAGE_GEOMETRY_REQUIRED) and a geometry that is not the page's (TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT).
create function private.takeoff_count_page_for(p_answer public.takeoff_item_answers, p_page integer, p_geometry jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  existing public.takeoff_count_pages%rowtype;
  given_box numeric[];
  given_rotation integer;
  given_user_unit numeric;
  given_width numeric;
  given_height numeric;
begin
  if p_page is null or not (p_page = any (private.takeoff_count_answer_scope(p_answer))) then
    raise exception 'TAKEOFF_MARKS_PAGE_OUTSIDE' using errcode = '22023';
  end if;
  if p_geometry is not null then
    select g.view_box, g.rotation, g.user_unit, g.width, g.height
    into given_box, given_rotation, given_user_unit, given_width, given_height
    from private.takeoff_count_page_geometry(p_geometry) g;
    if given_box is null then
      raise exception 'TAKEOFF_MARKS_INVALID' using errcode = '22023';
    end if;
  end if;
  select g.* into existing from public.takeoff_count_pages g
  where g.tenant_id = p_answer.tenant_id and g.project_id = p_answer.project_id
    and g.plan_logical_id = p_answer.plan_logical_id and g.plan_content_sha256 = p_answer.plan_content_sha256
    and g.page = p_page;
  if not found then
    if p_geometry is null then
      raise exception 'TAKEOFF_MARKS_PAGE_GEOMETRY_REQUIRED' using errcode = '22023';
    end if;
    insert into public.takeoff_count_pages (tenant_id, project_id, plan_logical_id, plan_file_id, plan_generation,
      plan_content_sha256, page, geometry_version, view_box, rotation, user_unit, width, height)
    values (p_answer.tenant_id, p_answer.project_id, p_answer.plan_logical_id, p_answer.plan_file_id,
      p_answer.plan_generation, p_answer.plan_content_sha256, p_page, 1, given_box, given_rotation, given_user_unit,
      given_width, given_height)
    on conflict on constraint takeoff_count_pages_page_key do nothing;
    -- Another command named this page first: its row stands, and the geometry given must be its.
    select g.* into existing from public.takeoff_count_pages g
    where g.tenant_id = p_answer.tenant_id and g.project_id = p_answer.project_id
      and g.plan_logical_id = p_answer.plan_logical_id and g.plan_content_sha256 = p_answer.plan_content_sha256
      and g.page = p_page;
  end if;
  if p_geometry is not null and (existing.view_box is distinct from given_box or existing.rotation is distinct from given_rotation
      or existing.user_unit is distinct from given_user_unit or existing.width is distinct from given_width
      or existing.height is distinct from given_height) then
    raise exception 'TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT' using errcode = '22023';
  end if;
  return existing.id;
end;
$$;

-- One event of an answer's journal in a command: the next ordinal of that answer in the command, chained to its
-- previous event (in the command, else the answer's last one).
create function private.takeoff_count_mark_event(p_command uuid, p_tenant_id uuid, p_project_id uuid, p_answer_id uuid,
  p_revision integer, p_gesture text, p_mark_id uuid, p_page integer, p_before jsonb, p_after jsonb, p_reason text,
  p_note text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  previous uuid;
  last_ordinal integer;
  written uuid;
begin
  select e.id, e.ordinal into previous, last_ordinal from public.takeoff_count_mark_events e
  where e.command_id = p_command and e.answer_id = p_answer_id order by e.ordinal desc limit 1;
  if previous is null then
    select s.last_event_id into previous from public.takeoff_count_answer_states s where s.answer_id = p_answer_id;
    last_ordinal := 0;
  end if;
  insert into public.takeoff_count_mark_events (tenant_id, project_id, answer_id, revision, ordinal, command_id, gesture,
    mark_id, page, before, after, reason_code, reason_text, previous_event_id, actor_kind, actor_id)
  values (p_tenant_id, p_project_id, p_answer_id, p_revision, last_ordinal + 1, p_command, p_gesture, p_mark_id, p_page,
    p_before, p_after, p_reason, p_note, previous, 'member', p_actor)
  returning id into written;
  return written;
end;
$$;

-- 10. The derivation (the server-side count) of an answer, by page then in total, from its attributions, its pages'
--     changes and verifications and its revision. A page is verified when its last verification is not older than its
--     last change and nothing on it is undecided (proposed or to attribute) for the answer. On a page: proposed, to
--     attribute, retained, removed (distinct marks), pending (marks of a machine generation that came after a change, not
--     attributed), reread (the marks retained, on a verified page; 0 otherwise) and its state. In total: the same sums;
--     the quantity is the marks retained when every page of the scope is verified and one at least is retained, else
--     null (never 0). States: verified (« Comptage vérifié »), no_mark_retained (every page verified, none retained:
--     « Aucun repère retenu »), to_verify_again (a verification older than a later change: « À vérifier à nouveau »),
--     to_check (marks or decisions without a verified scope: « Repères proposés à vérifier »), none (no mark, no
--     decision, no verification). A grouped page total of lot 4 (the answer's quantity) is never added to these.
create function private.takeoff_count_mark_summary(p_answer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with answer as (
    select a.* from public.takeoff_item_answers a where a.id = p_answer_id
  ), scope as (
    select s.page from answer cross join lateral pg_catalog.unnest(private.takeoff_count_answer_scope(answer)) s(page)
  ), attributed as (
    select g.page, (count(*) filter (where t.state = 'proposed'))::integer as proposed,
      (count(*) filter (where t.state = 'to_attribute'))::integer as to_attribute,
      (count(*) filter (where t.state = 'retained'))::integer as retained,
      (count(*) filter (where t.state = 'removed'))::integer as removed
    from public.takeoff_count_mark_attributions t
    join public.takeoff_count_pages g on g.id = t.page_id
    where t.answer_id = p_answer_id
    group by g.page
  ), pending as (
    select g.page, count(distinct p.mark_id)::integer as marks
    from public.takeoff_count_mark_proposals p
    join public.takeoff_count_pages g on g.id = p.page_id
    where p.answer_id = p_answer_id
      and not exists (select 1 from public.takeoff_count_mark_attributions t
        where t.mark_id = p.mark_id and t.answer_id = p_answer_id)
    group by g.page
  ), judged as (
    select s.page, coalesce(m.proposed, 0) as proposed, coalesce(m.to_attribute, 0) as to_attribute,
      coalesce(m.retained, 0) as retained, coalesce(m.removed, 0) as removed, coalesce(n.marks, 0) as pending,
      coalesce(ap.changed_revision, 0) as changed_revision, ap.verified_revision, ap.verified_by, ap.verified_at,
      (ap.verified_revision is not null and ap.verified_revision >= ap.changed_revision
        and coalesce(m.proposed, 0) = 0 and coalesce(m.to_attribute, 0) = 0) as verified,
      (ap.verified_revision is not null and ap.verified_revision < ap.changed_revision) as stale
    from scope s
    left join attributed m on m.page = s.page
    left join pending n on n.page = s.page
    left join public.takeoff_count_answer_pages ap on ap.answer_id = p_answer_id and ap.page = s.page
  ), totals as (
    select coalesce(sum(j.proposed), 0)::integer as proposed, coalesce(sum(j.to_attribute), 0)::integer as to_attribute,
      coalesce(sum(j.retained), 0)::integer as retained, coalesce(sum(j.removed), 0)::integer as removed,
      coalesce(sum(j.pending), 0)::integer as pending,
      coalesce(sum(j.retained) filter (where j.verified), 0)::integer as reread,
      count(*)::integer as scope_pages, (count(*) filter (where j.verified))::integer as verified_pages,
      coalesce(bool_or(j.stale), false) as stale,
      coalesce(bool_or(j.verified_revision is not null), false) as any_verification
    from judged j
  )
  select pg_catalog.jsonb_build_object('answer_id', p_answer_id,
    'revision', private.takeoff_count_marks_revision(p_answer_id),
    'proposed', t.proposed, 'to_attribute', t.to_attribute, 'retained', t.retained, 'removed', t.removed,
    'pending', t.pending, 'reread', t.reread, 'scope_pages', t.scope_pages, 'verified_pages', t.verified_pages,
    'quantity', case when t.scope_pages > 0 and t.verified_pages = t.scope_pages and t.retained > 0 then t.retained end,
    'state', case
      when t.scope_pages > 0 and t.verified_pages = t.scope_pages then
        case when t.retained > 0 then 'verified' else 'no_mark_retained' end
      when t.stale then 'to_verify_again'
      when t.proposed + t.to_attribute + t.retained + t.removed > 0 or t.any_verification then 'to_check'
      else 'none' end,
    'pages', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', j.page, 'proposed', j.proposed,
        'to_attribute', j.to_attribute, 'retained', j.retained, 'removed', j.removed, 'pending', j.pending,
        'reread', case when j.verified then j.retained else 0 end,
        'changed_revision', j.changed_revision, 'verified_revision', j.verified_revision,
        'verified_by', j.verified_by, 'verified_at', j.verified_at,
        'state', case when j.verified then case when j.retained > 0 then 'verified' else 'no_mark_retained' end
          when j.stale then 'to_verify_again'
          when j.proposed + j.to_attribute + j.retained + j.removed > 0 or j.verified_revision is not null then 'to_check'
          else 'none' end) order by j.page) from judged j), '[]'::jsonb))
  from totals t
  where exists (select 1 from answer)
$$;

-- 11. The revision for the review decisions (lot 4, B2) and the next pull requests: an answer's marks revision, 0
--     before any event. The locking form ensures its row and takes it for share, for a command that compares it, under its
--     own locks, with the revision its acceptance recorded: an edit or a publication of these marks (which take the row
--     for update) waits for that command, or that command for them, never both.
create function private.takeoff_count_marks_revision(p_answer_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select s.revision from public.takeoff_count_answer_states s where s.answer_id = p_answer_id), 0)
$$;

create function private.lock_takeoff_count_marks_revision(p_answer_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  found_revision integer;
begin
  insert into public.takeoff_count_answer_states (answer_id, tenant_id, project_id, revision, member_edited)
  select a.id, a.tenant_id, a.project_id, 0, false from public.takeoff_item_answers a where a.id = p_answer_id
  on conflict (answer_id) do nothing;
  select s.revision into found_revision from public.takeoff_count_answer_states s where s.answer_id = p_answer_id for share;
  return found_revision;
end;
$$;

-- Whether the marks of an answer changed since the revision given, for a reader of its affaire (no row otherwise).
create function public.takeoff_count_marks_changed_since(p_tenant_id uuid, p_project_id uuid, p_answer_id uuid,
  p_revision integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_count_marks_revision(a.id) is distinct from p_revision
  from public.takeoff_item_answers a
  where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
    and a.id = p_answer_id and a.tenant_id = p_tenant_id and a.project_id = p_project_id
$$;

-- 12. The worker's publication of one machine generation of a job's marks.
--     p_pages: [{page, geometry}] for each page its marks name that has no page of evidence yet (or to confirm one).
--     p_marks: [{page, x, y, box?, proposals: [{item_id, state: proposed | to_attribute, method, method_version,
--     source_key, observation_ordinal?, x?, y?, box?, raw_centre?, raw_box?, raw_frame?, source_ref?, subtype?,
--     diameter_mm?, diameter_source?, confidence?}]}], 1 to 20,000 marks of 1 to 8 proposals, one source key per item. A
--     proposal names its item: the job's answer for that item, on the job's plan; the mark's page must be in that answer's
--     scope; its observation, by its ordinal, is one of that answer's. Every mark is new (a later generation does not
--     reuse an earlier one's marks). By the attempt that published the job's answers: the digest of its lease token is
--     the answers' publication's (B1), whether this is called in that transaction or after it.
--     Answers {replayed, command_id, answers: [{answer_id, item_id, effective, revision}], marks, proposals}; the same
--     publication again answers the same, replayed, writing nothing. Refuses, with nothing written: an attempt that did
--     not publish the job's answers (TAKEOFF_MARKS_LEASE_INVALID), another content for the same generation
--     (TAKEOFF_MARKS_ALREADY_PUBLISHED), an item without an answer in the job (TAKEOFF_MARKS_ITEM_FOREIGN), an
--     observation that is not its answer's (TAKEOFF_MARKS_OBSERVATION_FOREIGN), a page outside the answer
--     (TAKEOFF_MARKS_PAGE_OUTSIDE), a page without or against its geometry (TAKEOFF_MARKS_PAGE_GEOMETRY_REQUIRED, _CONFLICT),
--     anything else malformed (TAKEOFF_MARKS_INVALID).
--     An answer whose marks revision is still 0 takes the generation: one attribution per mark (proposed, or to attribute
--     when every proposal of the mark for that answer says so), revision 1, one event per page. Any other answer (changed
--     by an earlier generation or by a member) keeps its marks as they are: the generation's marks and proposals are
--     stored unattributed (pending), and a member retains them one by one (gesture retain).
create function private.takeoff_count_mark_publication_well_formed(p_pages jsonb, p_marks jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  mark jsonb;
  proposal jsonb;
begin
  if pg_catalog.jsonb_typeof(p_pages) is distinct from 'array' or pg_catalog.jsonb_array_length(p_pages) > 2000
    or pg_catalog.jsonb_typeof(p_marks) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_marks) not between 1 and 20000
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_pages) g(value)
      where pg_catalog.jsonb_typeof(g.value) is distinct from 'object' or (g.value - array['page', 'geometry']) <> '{}'::jsonb
        or not private.takeoff_item_answer_is_number(g.value -> 'page', 1, 100000, true)
        or not exists (select 1 from private.takeoff_count_page_geometry(g.value -> 'geometry')))
    or (select count(distinct (g.value ->> 'page')::numeric) from pg_catalog.jsonb_array_elements(p_pages) g(value))
      <> pg_catalog.jsonb_array_length(p_pages) then
    return false;
  end if;
  for mark in select m.value from pg_catalog.jsonb_array_elements(p_marks) m(value) loop
    if pg_catalog.jsonb_typeof(mark) is distinct from 'object'
      or (pg_catalog.jsonb_strip_nulls(mark) - array['page', 'x', 'y', 'box', 'proposals']) <> '{}'::jsonb
      or not private.takeoff_item_answer_is_number(mark -> 'page', 1, 100000, true)
      or not private.takeoff_item_answer_is_number(mark -> 'x', 0, 1, false)
      or not private.takeoff_item_answer_is_number(mark -> 'y', 0, 1, false)
      or (mark -> 'box' is not null and mark -> 'box' <> 'null'::jsonb and private.takeoff_count_mark_box(mark -> 'box') is null)
      or pg_catalog.jsonb_typeof(mark -> 'proposals') is distinct from 'array'
      or pg_catalog.jsonb_array_length(mark -> 'proposals') not between 1 and 8 then
      return false;
    end if;
    for proposal in select pg_catalog.jsonb_strip_nulls(p.value) from pg_catalog.jsonb_array_elements(mark -> 'proposals') p(value)
    loop
      if pg_catalog.jsonb_typeof(proposal) is distinct from 'object'
        or (proposal - array['item_id', 'state', 'method', 'method_version', 'source_key', 'observation_ordinal', 'x', 'y',
          'box', 'raw_centre', 'raw_box', 'raw_frame', 'source_ref', 'subtype', 'diameter_mm', 'diameter_source',
          'confidence']) <> '{}'::jsonb
        or not private.takeoff_item_answer_is_uuid(proposal -> 'item_id')
        or coalesce(proposal ->> 'state', '') not in ('proposed', 'to_attribute')
        or not private.takeoff_item_answer_is_text(proposal -> 'method', '^[a-z][a-z0-9_]{0,47}$', 48)
        or not private.takeoff_item_answer_is_text(proposal -> 'method_version', '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$', 32)
        or not private.takeoff_item_answer_is_text(proposal -> 'source_key', '^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$', 128)
        or (proposal ? 'observation_ordinal'
          and not private.takeoff_item_answer_is_number(proposal -> 'observation_ordinal', 1, 500, true))
        or (proposal ? 'x') <> (proposal ? 'y')
        or (proposal ? 'x' and not private.takeoff_item_answer_is_number(proposal -> 'x', 0, 1, false))
        or (proposal ? 'y' and not private.takeoff_item_answer_is_number(proposal -> 'y', 0, 1, false))
        or (proposal ? 'box' and private.takeoff_count_mark_box(proposal -> 'box') is null)
        or (proposal ? 'raw_centre'
          and private.takeoff_count_mark_numbers(proposal -> 'raw_centre', 2, -10000000, 10000000) is null)
        or (proposal ? 'raw_box' and (private.takeoff_count_mark_numbers(proposal -> 'raw_box', 4, -10000000, 10000000) is null
          or (proposal #>> '{raw_box,2}')::numeric <= (proposal #>> '{raw_box,0}')::numeric
          or (proposal #>> '{raw_box,3}')::numeric <= (proposal #>> '{raw_box,1}')::numeric))
        or (proposal ? 'raw_frame'
          and not private.takeoff_item_answer_is_text(proposal -> 'raw_frame', '^[a-z][a-z0-9_:-]{0,63}$', 64))
        or (proposal ? 'source_ref' and (not private.takeoff_item_answer_is_text(proposal -> 'source_ref', null, 200)
          or (proposal ->> 'source_ref') ~ '://' or (proposal ->> 'source_ref') ~* '^data:'))
        or (proposal ? 'subtype' and not private.takeoff_item_answer_is_text(proposal -> 'subtype', null, 120))
        or (proposal ? 'diameter_mm'
          and not private.takeoff_item_answer_is_number(proposal -> 'diameter_mm', 0, 10000, false, true))
        or (proposal ? 'diameter_mm') <> (proposal ? 'diameter_source')
        or (proposal ? 'diameter_source'
          and (proposal ->> 'diameter_source') not in ('label', 'callout', 'connection', 'legend', 'model'))
        or (proposal ? 'confidence' and not private.takeoff_item_answer_is_number(proposal -> 'confidence', 0, 1, false)) then
        return false;
      end if;
    end loop;
  end loop;
  -- One source key per item: what a replay of the same generation compares.
  return not exists (select 1 from pg_catalog.jsonb_array_elements(p_marks) m(value)
      cross join lateral pg_catalog.jsonb_array_elements(m.value -> 'proposals') p(value)
    group by lower(p.value ->> 'item_id'), p.value ->> 'source_key' having count(*) > 1);
end;
$$;

create function public.publish_takeoff_count_marks(p_job_id uuid, p_lease_token uuid, p_generation integer,
  p_pages jsonb, p_marks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job record;
  digest text;
  attempt text;
  published public.takeoff_count_mark_commands%rowtype;
  this_command uuid := pg_catalog.gen_random_uuid();
  by_item jsonb;
  named uuid[];
  this_answer public.takeoff_item_answers%rowtype;
  answer_state public.takeoff_count_answer_states%rowtype;
  effective uuid[] := '{}';
  page_ids jsonb := '{}'::jsonb;
  page_number integer;
  locked integer;
  marks_written integer;
  proposals_written integer;
  answer_body jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_generation is null or p_generation not between 1 and 1000
    or pg_catalog.octet_length(coalesce(p_marks, 'null'::jsonb)::text) > 16777216
    or not coalesce(private.takeoff_count_mark_publication_well_formed(p_pages, p_marks), false) then
    raise exception 'TAKEOFF_MARKS_INVALID' using errcode = '22023';
  end if;
  digest := private.takeoff_sha256(pg_catalog.jsonb_build_object('generation', p_generation, 'pages', p_pages,
    'marks', p_marks));
  attempt := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_lease_token::text, 'UTF8')), 'hex');

  -- The job's affaire never moves (its identity is guarded): read it, then lock in the takeoff order.
  select j.id, j.tenant_id, j.project_id into job from public.takeoff_jobs j where j.id = p_job_id;
  if not found or job.project_id is null then
    raise exception 'TAKEOFF_MARKS_LEASE_INVALID' using errcode = '55000';
  end if;
  perform 1 from public.estimate_projects p where p.id = job.project_id and p.tenant_id = job.tenant_id for key share;
  perform 1 from public.takeoff_jobs j where j.id = p_job_id for no key update;
  if not exists (select 1 from public.takeoff_item_answer_publications p where p.job_id = p_job_id
      and p.attempt_sha256 = attempt) then
    raise exception 'TAKEOFF_MARKS_LEASE_INVALID' using errcode = '55000';
  end if;
  select c.* into published from public.takeoff_count_mark_commands c
  where c.kind = 'publication' and c.job_id = p_job_id and c.generation = p_generation;
  if found then
    if published.content_sha256 is distinct from digest then
      raise exception 'TAKEOFF_MARKS_ALREADY_PUBLISHED' using errcode = '23505';
    end if;
    return published.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  -- The job's answers by item: every proposal names one, the mark's page is in its scope, its observation is its own.
  by_item := coalesce((select pg_catalog.jsonb_object_agg(lower(a.item_id::text), a.id) from public.takeoff_item_answers a
    where a.job_id = p_job_id and a.tenant_id = job.tenant_id and a.project_id = job.project_id), '{}'::jsonb);
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_marks) m(value)
      cross join lateral pg_catalog.jsonb_array_elements(m.value -> 'proposals') p(value)
      where not by_item ? lower(p.value ->> 'item_id')) then
    raise exception 'TAKEOFF_MARKS_ITEM_FOREIGN' using errcode = '22023';
  end if;
  named := array(select distinct (by_item ->> lower(p.value ->> 'item_id'))::uuid
    from pg_catalog.jsonb_array_elements(p_marks) m(value)
    cross join lateral pg_catalog.jsonb_array_elements(m.value -> 'proposals') p(value) order by 1);
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_marks) m(value)
      cross join lateral pg_catalog.jsonb_array_elements(m.value -> 'proposals') p(value)
      join public.takeoff_item_answers a on a.id = (by_item ->> lower(p.value ->> 'item_id'))::uuid
      where not ((m.value ->> 'page')::numeric::integer = any (private.takeoff_count_answer_scope(a)))) then
    raise exception 'TAKEOFF_MARKS_PAGE_OUTSIDE' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_marks) m(value)
      cross join lateral pg_catalog.jsonb_array_elements(m.value -> 'proposals') p(value)
      where pg_catalog.jsonb_typeof(p.value -> 'observation_ordinal') = 'number'
        and not exists (select 1 from public.takeoff_item_answer_observations o
          where o.answer_id = (by_item ->> lower(p.value ->> 'item_id'))::uuid
            and o.ordinal = (p.value ->> 'observation_ordinal')::numeric::integer)) then
    raise exception 'TAKEOFF_MARKS_OBSERVATION_FOREIGN' using errcode = '22023';
  end if;

  -- The answers named, for key share, then their marks states for update, each in identifier order.
  select count(*) into locked from (select a.id from public.takeoff_item_answers a where a.id = any (named)
    order by a.id for key share) s;
  for this_answer in select a.* from public.takeoff_item_answers a where a.id = any (named) order by a.id loop
    insert into public.takeoff_count_answer_states (answer_id, tenant_id, project_id, revision, member_edited)
    values (this_answer.id, this_answer.tenant_id, this_answer.project_id, 0, false) on conflict (answer_id) do nothing;
    select s.* into answer_state from public.takeoff_count_answer_states s where s.answer_id = this_answer.id for update;
    if answer_state.revision = 0 then
      effective := pg_catalog.array_append(effective, this_answer.id);
    end if;
  end loop;

  -- The pages of evidence: the job reads one plan (one unit), so any of its answers names the page's bytes.
  for page_number in select distinct (m.value ->> 'page')::numeric::integer from pg_catalog.jsonb_array_elements(p_marks) m(value)
    order by 1
  loop
    select a.* into this_answer from public.takeoff_item_answers a
    where a.id = (select (by_item ->> lower(p.value ->> 'item_id'))::uuid from pg_catalog.jsonb_array_elements(p_marks) m(value)
      cross join lateral pg_catalog.jsonb_array_elements(m.value -> 'proposals') p(value)
      where (m.value ->> 'page')::numeric::integer = page_number limit 1);
    page_ids := page_ids || pg_catalog.jsonb_build_object(page_number::text,
      private.takeoff_count_page_for(this_answer, page_number, (select g.value -> 'geometry'
        from pg_catalog.jsonb_array_elements(p_pages) g(value) where (g.value ->> 'page')::numeric::integer = page_number)));
  end loop;

  with given as materialized (
    select m.position, pg_catalog.gen_random_uuid() as mark_id,
      (page_ids ->> ((m.value ->> 'page')::numeric::integer)::text)::uuid as page_id,
      (m.value ->> 'x')::numeric as x, (m.value ->> 'y')::numeric as y,
      case when pg_catalog.jsonb_typeof(m.value -> 'box') = 'array' then private.takeoff_count_mark_box(m.value -> 'box') end
        as box,
      m.value -> 'proposals' as proposals
    from pg_catalog.jsonb_array_elements(p_marks) with ordinality m(value, position)
  ), marks_inserted as (
    insert into public.takeoff_count_marks (id, tenant_id, project_id, page_id, origin, x, y, box, position_revision,
      created_job_id)
    select g.mark_id, job.tenant_id, job.project_id, g.page_id, 'machine', g.x, g.y, g.box, 1, p_job_id
    from given g order by g.position
    returning id
  ), proposed as materialized (
    select g.mark_id, g.page_id, (by_item ->> lower(p.value ->> 'item_id'))::uuid as answer_id,
      pg_catalog.jsonb_strip_nulls(p.value) as proposal,
      coalesce((p.value ->> 'x')::numeric, g.x) as x, coalesce((p.value ->> 'y')::numeric, g.y) as y,
      case when pg_catalog.jsonb_typeof(p.value -> 'box') = 'array' then private.takeoff_count_mark_box(p.value -> 'box')
        else g.box end as box
    from given g cross join lateral pg_catalog.jsonb_array_elements(g.proposals) p(value)
  ), proposals_inserted as (
    insert into public.takeoff_count_mark_proposals (tenant_id, project_id, mark_id, page_id, answer_id, job_id,
      observation_id, generation, source_key, method, method_version, proposed_state, x, y, box, raw_centre, raw_box,
      raw_frame, source_ref, subtype, diameter_mm, diameter_source, confidence)
    select job.tenant_id, job.project_id, r.mark_id, r.page_id, r.answer_id, p_job_id,
      (select o.id from public.takeoff_item_answer_observations o where o.answer_id = r.answer_id
        and o.ordinal = (r.proposal ->> 'observation_ordinal')::numeric::integer),
      p_generation, r.proposal ->> 'source_key', r.proposal ->> 'method', r.proposal ->> 'method_version',
      r.proposal ->> 'state', r.x, r.y, r.box,
      case when r.proposal ? 'raw_centre'
        then private.takeoff_count_mark_numbers(r.proposal -> 'raw_centre', 2, -10000000, 10000000) end,
      case when r.proposal ? 'raw_box'
        then private.takeoff_count_mark_numbers(r.proposal -> 'raw_box', 4, -10000000, 10000000) end,
      r.proposal ->> 'raw_frame', r.proposal ->> 'source_ref', r.proposal ->> 'subtype',
      (r.proposal ->> 'diameter_mm')::numeric, r.proposal ->> 'diameter_source', (r.proposal ->> 'confidence')::numeric
    from proposed r
    returning id
  ), attributions_inserted as (
    insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state)
    select r.mark_id, r.answer_id, job.tenant_id, job.project_id, r.page_id,
      case when bool_or(r.proposal ->> 'state' = 'proposed') then 'proposed' else 'to_attribute' end
    from proposed r where r.answer_id = any (effective)
    group by r.mark_id, r.answer_id, r.page_id
    returning answer_id as attributed_answer, page_id as attributed_page, state as attributed_state
  ), per_page as (
    select t.attributed_answer as answer_id, g.page,
      (count(*) filter (where t.attributed_state = 'proposed'))::integer as proposed_marks,
      (count(*) filter (where t.attributed_state = 'to_attribute'))::integer as undecided_marks
    from attributions_inserted t join public.takeoff_count_pages g on g.id = t.attributed_page
    group by t.attributed_answer, g.page
  ), numbered as materialized (
    select e.*, pg_catalog.gen_random_uuid() as event_id from per_page e
  ), chained as materialized (
    select n.*, (pg_catalog.row_number() over w)::integer as event_ordinal, pg_catalog.lag(n.event_id) over w as previous_id
    from numbered n window w as (partition by n.answer_id order by n.page)
  ), events_inserted as (
    insert into public.takeoff_count_mark_events (id, tenant_id, project_id, answer_id, revision, ordinal, command_id,
      gesture, page, after, previous_event_id, actor_kind)
    select c.event_id, job.tenant_id, job.project_id, c.answer_id, 1, c.event_ordinal, this_command, 'proposed', c.page,
      pg_catalog.jsonb_build_object('generation', p_generation, 'proposed', c.proposed_marks,
        'to_attribute', c.undecided_marks), c.previous_id, 'worker'
    from chained c
    returning answer_id as event_answer, page as event_page
  ), pages_changed as (
    insert into public.takeoff_count_answer_pages (answer_id, page, tenant_id, project_id, changed_revision)
    select e.event_answer, e.event_page, job.tenant_id, job.project_id, 1 from events_inserted e
    returning 1
  )
  select (select count(*) from marks_inserted), (select count(*) from proposals_inserted), (select count(*) from pages_changed)
  into marks_written, proposals_written, locked;

  -- Each answer that took the generation is at revision 1, its last event its journal's head.
  update public.takeoff_count_answer_states s set revision = 1, updated_at = pg_catalog.clock_timestamp(),
    last_event_id = (select e.id from public.takeoff_count_mark_events e where e.command_id = this_command
      and e.answer_id = s.answer_id order by e.ordinal desc limit 1)
  where s.answer_id = any (effective)
    and exists (select 1 from public.takeoff_count_mark_events e where e.command_id = this_command and e.answer_id = s.answer_id);

  answer_body := pg_catalog.jsonb_build_object('command_id', this_command, 'marks', marks_written, 'proposals', proposals_written,
    'answers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('answer_id', a.id, 'item_id', a.item_id,
        'effective', a.id = any (effective), 'revision', private.takeoff_count_marks_revision(a.id)) order by a.id)
      from public.takeoff_item_answers a where a.id = any (named)), '[]'::jsonb));
  insert into public.takeoff_count_mark_commands (id, tenant_id, project_id, kind, job_id, generation, attempt_sha256,
    content_sha256, revisions, result)
  values (this_command, job.tenant_id, job.project_id, 'publication', p_job_id, p_generation, attempt, digest,
    coalesce((select pg_catalog.jsonb_object_agg(a::text, pg_catalog.jsonb_build_object('expected', 0, 'new', 1))
      from pg_catalog.unnest(effective) a), '{}'::jsonb), answer_body);
  return answer_body || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

-- 13. An operator's edit, with the member's session.
--     p_revisions: {"<answer_id>": expected marks revision} for every answer the edit changes; an answer it would change
--     without being named there is a conflict. p_gestures, 1 to 500, in order, every verify after every other gesture:
--       {op: add, answer_id, key, page, x, y, box?, geometry?}: a new mark on that page of the answer's plan, retained
--         for the answer (key: the caller's identifier for it, answered with the mark's own);
--       {op: move, mark_id, x, y, box?}: the same mark elsewhere on its page; every answer it is attributed to changes;
--       {op: remove, answer_id, mark_id, reason, note?}: out of the answer's view, with its reason (a note for other);
--       {op: restore, answer_id, mark_id}: back to the state it had before its removal;
--       {op: retain, answer_id, mark_id}: kept for the answer (one proposed, one to attribute, or one of a pending
--         generation of that answer);
--       {op: reattribute, answer_id, mark_id, to_answer_id}: from one item to another on the same plan's bytes, the
--         page in the other answer's scope, the same expected unit: removed from the first (reattributed), retained for
--         the second;
--       {op: verify, answer_id, pages}: the member inspected these pages of the answer's scope for this item; nothing on
--         them may stay undecided (proposed or to attribute) for it.
--     The right: an operator of the affaire (its admin, or the engineer who owns it), checked again after every wait. The
--     answers: current readings of the affaire (a replaced reading's marks are history).
--     Answers {replayed, command_id, revisions: {"<answer_id>": new revision}, added: [{key, mark_id}],
--     summaries: {"<answer_id>": summary}}; the same intention key with the same content answers the same, replayed,
--     writing nothing. Refuses, with nothing written: TAKEOFF_MARKS_INVALID, _FORBIDDEN, _ANSWER_NOT_FOUND,
--     _ANSWER_REPLACED, _REVISION_CONFLICT, _INTENT_CONFLICT, _PAGE_OUTSIDE, _PAGE_GEOMETRY_REQUIRED, _PAGE_GEOMETRY_CONFLICT,
--     _MARK_NOT_FOUND, _STATE_INVALID, _ATTRIBUTION_TAKEN, _TARGET_INCOMPATIBLE, _UNDECIDED, _LIMIT_EXCEEDED.
create function private.takeoff_count_mark_edit_well_formed(p_revisions jsonb, p_gestures jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  gesture jsonb;
  op text;
  verifying boolean := false;
begin
  if pg_catalog.jsonb_typeof(p_revisions) is distinct from 'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_revisions)) not between 1 and 50
    or exists (select 1 from pg_catalog.jsonb_each(p_revisions) r(key, value)
      where not private.takeoff_item_answer_is_uuid(pg_catalog.to_jsonb(r.key)) or r.key <> lower(r.key)
        or not private.takeoff_item_answer_is_number(r.value, 0, 1000000, true))
    or pg_catalog.jsonb_typeof(p_gestures) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_gestures) not between 1 and 500
    or pg_catalog.octet_length(p_gestures::text) > 1048576 then
    return false;
  end if;
  for gesture in select pg_catalog.jsonb_strip_nulls(g.value) from pg_catalog.jsonb_array_elements(p_gestures) g(value) loop
    if pg_catalog.jsonb_typeof(gesture) is distinct from 'object' then
      return false;
    end if;
    op := gesture ->> 'op';
    if op is null or op not in ('add', 'move', 'remove', 'restore', 'retain', 'reattribute', 'verify')
      or (verifying and op <> 'verify')
      or (op <> 'move' and not (private.takeoff_item_answer_is_uuid(gesture -> 'answer_id')
        and p_revisions ? lower(gesture ->> 'answer_id')))
      or (op not in ('add', 'verify') and not private.takeoff_item_answer_is_uuid(gesture -> 'mark_id')) then
      return false;
    end if;
    verifying := op = 'verify';
    if (op = 'add' and ((gesture - array['op', 'answer_id', 'key', 'page', 'x', 'y', 'box', 'geometry']) <> '{}'::jsonb
        or not private.takeoff_item_answer_is_uuid(gesture -> 'key')
        or not private.takeoff_item_answer_is_number(gesture -> 'page', 1, 100000, true)
        or not private.takeoff_item_answer_is_number(gesture -> 'x', 0, 1, false)
        or not private.takeoff_item_answer_is_number(gesture -> 'y', 0, 1, false)
        or (gesture ? 'box' and private.takeoff_count_mark_box(gesture -> 'box') is null)
        or (gesture ? 'geometry' and not exists (select 1 from private.takeoff_count_page_geometry(gesture -> 'geometry')))))
      or (op = 'move' and ((gesture - array['op', 'mark_id', 'x', 'y', 'box']) <> '{}'::jsonb
        or not private.takeoff_item_answer_is_number(gesture -> 'x', 0, 1, false)
        or not private.takeoff_item_answer_is_number(gesture -> 'y', 0, 1, false)
        or (gesture ? 'box' and private.takeoff_count_mark_box(gesture -> 'box') is null)))
      or (op = 'remove' and ((gesture - array['op', 'answer_id', 'mark_id', 'reason', 'note']) <> '{}'::jsonb
        or coalesce(gesture ->> 'reason', '') not in ('duplicate', 'not_this_item', 'legend_or_detail', 'not_installed',
          'outside_scope', 'other')
        or (gesture ? 'note' and (not private.takeoff_item_answer_is_text(gesture -> 'note', null, 500)
          or (gesture ->> 'note') <> pg_catalog.btrim(gesture ->> 'note')))
        or (gesture ->> 'reason' = 'other' and not gesture ? 'note')))
      or (op in ('restore', 'retain') and (gesture - array['op', 'answer_id', 'mark_id']) <> '{}'::jsonb)
      or (op = 'reattribute' and ((gesture - array['op', 'answer_id', 'mark_id', 'to_answer_id']) <> '{}'::jsonb
        or not private.takeoff_item_answer_is_uuid(gesture -> 'to_answer_id')
        or not p_revisions ? lower(gesture ->> 'to_answer_id')))
      or (op = 'verify' and ((gesture - array['op', 'answer_id', 'pages']) <> '{}'::jsonb
        or not private.takeoff_item_answer_pages_valid(gesture -> 'pages')
        or pg_catalog.jsonb_array_length(gesture -> 'pages') = 0)) then
      return false;
    end if;
  end loop;
  -- One key per added mark.
  return (select count(distinct lower(g.value ->> 'key')) from pg_catalog.jsonb_array_elements(p_gestures) g(value)
      where g.value ->> 'op' = 'add')
    = (select count(*) from pg_catalog.jsonb_array_elements(p_gestures) g(value) where g.value ->> 'op' = 'add');
end;
$$;

create function public.edit_takeoff_count_marks(p_tenant_id uuid, p_project_id uuid, p_intent_key uuid,
  p_revisions jsonb, p_gestures jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  expected jsonb;
  digest text;
  existing public.takeoff_count_mark_commands%rowtype;
  this_command uuid := pg_catalog.gen_random_uuid();
  named uuid[];
  locked integer;
  this_answer public.takeoff_item_answers%rowtype;
  target_answer public.takeoff_item_answers%rowtype;
  answer_state public.takeoff_count_answer_states%rowtype;
  held jsonb := '{}'::jsonb;
  changed jsonb := '{}'::jsonb;
  added jsonb := '[]'::jsonb;
  this_gesture jsonb;
  op text;
  this_mark public.takeoff_count_marks%rowtype;
  this_attribution public.takeoff_count_mark_attributions%rowtype;
  other_attribution public.takeoff_count_mark_attributions%rowtype;
  this_page uuid;
  page_number integer;
  new_mark uuid;
  new_box numeric[];
  touched uuid;
  next_revision integer;
  answers_revisions jsonb;
begin
  -- The answers' identifiers as the database writes them (a client may send capitals).
  expected := case when pg_catalog.jsonb_typeof(p_revisions) = 'object' then (select pg_catalog.jsonb_object_agg(lower(r.key),
    r.value) from pg_catalog.jsonb_each(p_revisions) r(key, value)) end;
  if actor is null or p_tenant_id is null or p_project_id is null or p_intent_key is null or expected is null
    or (select count(*) from pg_catalog.jsonb_object_keys(expected)) <> (select count(*) from pg_catalog.jsonb_object_keys(p_revisions))
    or not coalesce(private.takeoff_count_mark_edit_well_formed(expected, p_gestures), false) then
    raise exception 'TAKEOFF_MARKS_INVALID' using errcode = '22023';
  end if;
  if not private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, true) then
    raise exception 'TAKEOFF_MARKS_FORBIDDEN' using errcode = '42501';
  end if;
  digest := private.takeoff_sha256(pg_catalog.jsonb_build_object('project_id', p_project_id, 'revisions', expected,
    'gestures', p_gestures));
  named := array(select k::uuid from pg_catalog.jsonb_object_keys(expected) k order by 1);

  -- Locks, in the takeoff order: the affaire (key share), the answers (key share), their marks states (for update), then
  -- the marks the gestures name (for update), each set in identifier order.
  perform 1 from public.estimate_projects p where p.id = p_project_id and p.tenant_id = p_tenant_id for key share;
  if not found then
    raise exception 'TAKEOFF_MARKS_ANSWER_NOT_FOUND' using errcode = 'P0002';
  end if;
  select count(*) into locked from (select a.id from public.takeoff_item_answers a
    where a.id = any (named) and a.tenant_id = p_tenant_id and a.project_id = p_project_id order by a.id for key share) s;
  if locked <> pg_catalog.cardinality(named) then
    raise exception 'TAKEOFF_MARKS_ANSWER_NOT_FOUND' using errcode = 'P0002';
  end if;
  for this_answer in select a.* from public.takeoff_item_answers a where a.id = any (named) order by a.id loop
    insert into public.takeoff_count_answer_states (answer_id, tenant_id, project_id, revision, member_edited)
    values (this_answer.id, this_answer.tenant_id, this_answer.project_id, 0, false) on conflict (answer_id) do nothing;
    select s.* into answer_state from public.takeoff_count_answer_states s where s.answer_id = this_answer.id for update;
    held := held || pg_catalog.jsonb_build_object(this_answer.id::text, answer_state.revision);
  end loop;
  select count(*) into locked from (select m.id from public.takeoff_count_marks m
    where m.tenant_id = p_tenant_id and m.project_id = p_project_id
      and m.id in (select (g.value ->> 'mark_id')::uuid from pg_catalog.jsonb_array_elements(p_gestures) g(value)
        where pg_catalog.jsonb_typeof(g.value -> 'mark_id') = 'string')
    order by m.id for update) s;

  -- The same intention again: its answer, once its own command (which held these rows) has committed.
  select c.* into existing from public.takeoff_count_mark_commands c
  where c.tenant_id = p_tenant_id and c.kind = 'edit' and c.intent_key = p_intent_key;
  if found then
    if existing.actor_id is distinct from actor or existing.project_id is distinct from p_project_id
      or existing.content_sha256 is distinct from digest then
      raise exception 'TAKEOFF_MARKS_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return existing.result || pg_catalog.jsonb_build_object('replayed', true,
      'summaries', coalesce((select pg_catalog.jsonb_object_agg(k, private.takeoff_count_mark_summary(k::uuid))
        from pg_catalog.jsonb_object_keys(existing.result -> 'revisions') k), '{}'::jsonb));
  end if;

  -- The right once more, after the last wait and before the first write; the answers current; the revisions expected.
  if not private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, true) then
    raise exception 'TAKEOFF_MARKS_FORBIDDEN' using errcode = '42501';
  end if;
  for this_answer in select a.* from public.takeoff_item_answers a where a.id = any (named) order by a.id loop
    if not private.takeoff_count_answer_is_current(this_answer) then
      raise exception 'TAKEOFF_MARKS_ANSWER_REPLACED' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from pg_catalog.jsonb_each(expected) r(key, value)
      where (held ->> r.key)::integer is distinct from (r.value #>> '{}')::numeric::integer) then
    raise exception 'TAKEOFF_MARKS_REVISION_CONFLICT' using errcode = '40001';
  end if;

  for this_gesture in select pg_catalog.jsonb_strip_nulls(g.value) from pg_catalog.jsonb_array_elements(p_gestures)
    with ordinality g(value, n) order by g.n
  loop
    op := this_gesture ->> 'op';
    if this_gesture ? 'answer_id' then
      select a.* into this_answer from public.takeoff_item_answers a where a.id = (this_gesture ->> 'answer_id')::uuid;
    end if;
    if this_gesture ? 'mark_id' then
      select m.* into this_mark from public.takeoff_count_marks m
      where m.id = (this_gesture ->> 'mark_id')::uuid and m.tenant_id = p_tenant_id and m.project_id = p_project_id;
      if not found then
        raise exception 'TAKEOFF_MARKS_MARK_NOT_FOUND' using errcode = 'P0002';
      end if;
      select g.page into page_number from public.takeoff_count_pages g where g.id = this_mark.page_id;
    end if;
    if op in ('remove', 'restore', 'retain', 'reattribute') then
      select t.* into this_attribution from public.takeoff_count_mark_attributions t
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      -- A mark of a pending generation of this answer is only retained.
      if not found and (op <> 'retain' or not exists (select 1 from public.takeoff_count_mark_proposals p
          where p.mark_id = this_mark.id and p.answer_id = this_answer.id)) then
        raise exception 'TAKEOFF_MARKS_MARK_NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
    next_revision := (held ->> this_answer.id::text)::integer + 1;

    if op = 'add' then
      page_number := (this_gesture ->> 'page')::numeric::integer;
      this_page := private.takeoff_count_page_for(this_answer, page_number, this_gesture -> 'geometry');
      new_mark := pg_catalog.gen_random_uuid();
      new_box := private.takeoff_count_mark_box(this_gesture -> 'box');
      insert into public.takeoff_count_marks (id, tenant_id, project_id, page_id, origin, x, y, box, position_revision,
        created_by)
      values (new_mark, p_tenant_id, p_project_id, this_page, 'manual', (this_gesture ->> 'x')::numeric,
        (this_gesture ->> 'y')::numeric, new_box, 1, actor);
      insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state,
        decided_by, decided_at)
      values (new_mark, this_answer.id, p_tenant_id, p_project_id, this_page, 'retained', actor, pg_catalog.clock_timestamp());
      added := added || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key', lower(this_gesture ->> 'key'),
        'mark_id', new_mark));
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision, 'add',
        new_mark, page_number, null, pg_catalog.jsonb_build_object('state', 'retained', 'x', (this_gesture ->> 'x')::numeric,
          'y', (this_gesture ->> 'y')::numeric, 'box', pg_catalog.to_jsonb(new_box)), null, null, actor);
    elsif op = 'move' then
      new_box := private.takeoff_count_mark_box(this_gesture -> 'box');
      -- Every answer the mark is attributed to changes: each must be named (and is then current). A mark no answer holds
      -- (a pending generation's) is retained before it is moved.
      if not exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id) then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
          and not expected ? t.answer_id::text) then
        raise exception 'TAKEOFF_MARKS_REVISION_CONFLICT' using errcode = '40001';
      end if;
      update public.takeoff_count_marks m set x = (this_gesture ->> 'x')::numeric, y = (this_gesture ->> 'y')::numeric,
        box = new_box, position_revision = m.position_revision + 1, moved_by = actor, moved_at = pg_catalog.clock_timestamp()
      where m.id = this_mark.id;
      for touched in select t.answer_id from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
        order by t.answer_id
      loop
        changed := changed || pg_catalog.jsonb_build_object(touched::text, true);
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, touched,
          (held ->> touched::text)::integer + 1, 'move', this_mark.id, page_number,
          pg_catalog.jsonb_build_object('x', this_mark.x, 'y', this_mark.y, 'box', pg_catalog.to_jsonb(this_mark.box)),
          pg_catalog.jsonb_build_object('x', (this_gesture ->> 'x')::numeric, 'y', (this_gesture ->> 'y')::numeric,
            'box', pg_catalog.to_jsonb(new_box)), null, null, actor);
      end loop;
    elsif op = 'remove' then
      if this_attribution.state not in ('proposed', 'to_attribute', 'retained') then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      update public.takeoff_count_mark_attributions t set state = 'removed', prior_state = this_attribution.state,
        reason_code = this_gesture ->> 'reason', reason_text = this_gesture ->> 'note', decided_by = actor,
        decided_at = pg_catalog.clock_timestamp()
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
        'remove', this_mark.id, page_number, pg_catalog.jsonb_build_object('state', this_attribution.state),
        pg_catalog.jsonb_build_object('state', 'removed'), this_gesture ->> 'reason', this_gesture ->> 'note', actor);
    elsif op = 'restore' then
      if this_attribution.state <> 'removed' then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if this_attribution.prior_state = 'retained' and exists (select 1 from public.takeoff_count_mark_attributions t
          where t.mark_id = this_mark.id and t.answer_id <> this_answer.id and t.state = 'retained') then
        raise exception 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN' using errcode = '23505';
      end if;
      update public.takeoff_count_mark_attributions t set state = this_attribution.prior_state, prior_state = null,
        reason_code = null, reason_text = null, decided_by = actor, decided_at = pg_catalog.clock_timestamp()
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
        'restore', this_mark.id, page_number,
        pg_catalog.jsonb_build_object('state', 'removed', 'reason', this_attribution.reason_code),
        pg_catalog.jsonb_build_object('state', this_attribution.prior_state), null, null, actor);
    elsif op = 'retain' then
      if this_attribution.mark_id is not null and this_attribution.state not in ('proposed', 'to_attribute') then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if exists (select 1 from public.takeoff_count_mark_attributions t
          where t.mark_id = this_mark.id and t.answer_id <> this_answer.id and t.state = 'retained') then
        raise exception 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN' using errcode = '23505';
      end if;
      insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state,
        decided_by, decided_at)
      values (this_mark.id, this_answer.id, p_tenant_id, p_project_id, this_mark.page_id, 'retained', actor,
        pg_catalog.clock_timestamp())
      on conflict (mark_id, answer_id) do update set state = 'retained', decided_by = excluded.decided_by,
        decided_at = excluded.decided_at;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
        'retain', this_mark.id, page_number,
        pg_catalog.jsonb_build_object('state', coalesce(this_attribution.state, 'pending')),
        pg_catalog.jsonb_build_object('state', 'retained'), null, null, actor);
    elsif op = 'reattribute' then
      select a.* into target_answer from public.takeoff_item_answers a where a.id = (this_gesture ->> 'to_answer_id')::uuid;
      if this_attribution.state not in ('proposed', 'to_attribute', 'retained') then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if target_answer.id = this_answer.id or target_answer.plan_logical_id <> this_answer.plan_logical_id
        or target_answer.plan_content_sha256 <> this_answer.plan_content_sha256
        or not (page_number = any (private.takeoff_count_answer_scope(target_answer)))
        or (select e.expected_unit from public.takeoff_list_revision_entries e
            where e.revision_id = target_answer.list_revision_id and e.item_id = target_answer.item_id)
          is distinct from (select e.expected_unit from public.takeoff_list_revision_entries e
            where e.revision_id = this_answer.list_revision_id and e.item_id = this_answer.item_id) then
        raise exception 'TAKEOFF_MARKS_TARGET_INCOMPATIBLE' using errcode = '22023';
      end if;
      select t.* into other_attribution from public.takeoff_count_mark_attributions t
      where t.mark_id = this_mark.id and t.answer_id = target_answer.id;
      if other_attribution.state = 'retained' then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
          and t.answer_id not in (this_answer.id, target_answer.id) and t.state = 'retained') then
        raise exception 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN' using errcode = '23505';
      end if;
      update public.takeoff_count_mark_attributions t set state = 'removed', prior_state = this_attribution.state,
        reason_code = 'reattributed', reason_text = null, decided_by = actor, decided_at = pg_catalog.clock_timestamp()
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state,
        decided_by, decided_at)
      values (this_mark.id, target_answer.id, p_tenant_id, p_project_id, this_mark.page_id, 'retained', actor,
        pg_catalog.clock_timestamp())
      on conflict (mark_id, answer_id) do update set state = 'retained', prior_state = null, reason_code = null,
        reason_text = null, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true, target_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
        'reattribute_out', this_mark.id, page_number, pg_catalog.jsonb_build_object('state', this_attribution.state),
        pg_catalog.jsonb_build_object('state', 'removed', 'to_answer_id', target_answer.id), 'reattributed', null, actor);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, target_answer.id,
        (held ->> target_answer.id::text)::integer + 1, 'reattribute_in', this_mark.id, page_number,
        pg_catalog.jsonb_build_object('state', coalesce(other_attribution.state, 'none'), 'from_answer_id', this_answer.id),
        pg_catalog.jsonb_build_object('state', 'retained'), null, null, actor);
    elsif op = 'verify' then
      for page_number in select (p.value #>> '{}')::numeric::integer from pg_catalog.jsonb_array_elements(this_gesture -> 'pages') p(value)
        order by 1
      loop
        if not (page_number = any (private.takeoff_count_answer_scope(this_answer))) then
          raise exception 'TAKEOFF_MARKS_PAGE_OUTSIDE' using errcode = '22023';
        end if;
        if exists (select 1 from public.takeoff_count_mark_attributions t join public.takeoff_count_pages g on g.id = t.page_id
            where t.answer_id = this_answer.id and g.page = page_number and t.state in ('proposed', 'to_attribute')) then
          raise exception 'TAKEOFF_MARKS_UNDECIDED' using errcode = '22023';
        end if;
        insert into public.takeoff_count_answer_pages (answer_id, page, tenant_id, project_id, changed_revision,
          verified_revision, verified_by, verified_at)
        values (this_answer.id, page_number, p_tenant_id, p_project_id, 0, next_revision, actor, pg_catalog.clock_timestamp())
        on conflict (answer_id, page) do update set verified_revision = excluded.verified_revision,
          verified_by = excluded.verified_by, verified_at = excluded.verified_at;
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
          'verify', null, page_number, null, pg_catalog.jsonb_build_object('retained',
            (select count(*) from public.takeoff_count_mark_attributions t join public.takeoff_count_pages g on g.id = t.page_id
             where t.answer_id = this_answer.id and g.page = page_number and t.state = 'retained')), null, null, actor);
      end loop;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
    end if;
    this_attribution := null;
    other_attribution := null;
  end loop;

  -- The pages each change reached, for each answer it reached: changed at the answer's new revision (a verification of
  -- this command, after every change, stays current; an earlier one is now older than the change).
  insert into public.takeoff_count_answer_pages (answer_id, page, tenant_id, project_id, changed_revision)
  select distinct e.answer_id, e.page, p_tenant_id, p_project_id, e.revision from public.takeoff_count_mark_events e
  where e.command_id = this_command and e.gesture <> 'verify'
  on conflict (answer_id, page) do update set changed_revision = excluded.changed_revision;
  -- Bounded: at most 20,000 marks on an answer.
  if exists (select 1 from public.takeoff_count_mark_attributions t
      where t.answer_id in (select k::uuid from pg_catalog.jsonb_object_keys(changed) k)
      group by t.answer_id having count(*) > 20000) then
    raise exception 'TAKEOFF_MARKS_LIMIT_EXCEEDED' using errcode = '22023';
  end if;
  -- Each changed answer: one revision more, a member's change, its journal's head.
  update public.takeoff_count_answer_states s set revision = s.revision + 1, member_edited = true,
    last_event_id = (select e.id from public.takeoff_count_mark_events e where e.command_id = this_command
      and e.answer_id = s.answer_id order by e.ordinal desc limit 1),
    updated_at = pg_catalog.clock_timestamp()
  where s.answer_id in (select k::uuid from pg_catalog.jsonb_object_keys(changed) k);

  answers_revisions := coalesce((select pg_catalog.jsonb_object_agg(k, (held ->> k)::integer + 1)
    from pg_catalog.jsonb_object_keys(changed) k), '{}'::jsonb);
  begin
    insert into public.takeoff_count_mark_commands (id, tenant_id, project_id, kind, intent_key, actor_id, content_sha256,
      revisions, result)
    values (this_command, p_tenant_id, p_project_id, 'edit', p_intent_key, actor, digest,
      coalesce((select pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_object('expected', (held ->> k)::integer,
          'new', (held ->> k)::integer + 1)) from pg_catalog.jsonb_object_keys(changed) k), '{}'::jsonb),
      pg_catalog.jsonb_build_object('command_id', this_command, 'revisions', answers_revisions, 'added', added));
  exception when unique_violation then
    -- The same intention key, sent with another content over other answers, committed first.
    raise exception 'TAKEOFF_MARKS_INTENT_CONFLICT' using errcode = '23505';
  end;
  return pg_catalog.jsonb_build_object('replayed', false, 'command_id', this_command, 'revisions', answers_revisions,
    'added', added, 'summaries', coalesce((select pg_catalog.jsonb_object_agg(k, private.takeoff_count_mark_summary(k::uuid))
      from pg_catalog.jsonb_object_keys(changed) k), '{}'::jsonb));
end;
$$;

-- 14. The readers, for the readers of the affaire: called with the member's session, each checks the affaire's read rule
--     once for its statement; nothing for any other caller.
--
-- A mark as the readers give it: its position and origin, its attribution to the answer read (or pending), its other
-- attributions (competing items), and its source proposals.
create function private.takeoff_count_mark_document(p_mark public.takeoff_count_marks, p_answer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('mark_id', p_mark.id, 'x', p_mark.x, 'y', p_mark.y, 'box', pg_catalog.to_jsonb(p_mark.box),
    'origin', p_mark.origin, 'position_revision', p_mark.position_revision, 'created_by', p_mark.created_by,
    'created_job_id', p_mark.created_job_id, 'created_at', p_mark.created_at, 'moved_by', p_mark.moved_by,
    'moved_at', p_mark.moved_at,
    'state', coalesce(t.state, 'pending'), 'prior_state', t.prior_state, 'reason_code', t.reason_code,
    'reason_text', t.reason_text, 'decided_by', t.decided_by, 'decided_at', t.decided_at,
    'others', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('answer_id', o.answer_id,
        'item_id', a.item_id, 'state', o.state, 'revision', private.takeoff_count_marks_revision(o.answer_id))
        order by o.answer_id)
      from public.takeoff_count_mark_attributions o join public.takeoff_item_answers a on a.id = o.answer_id
      where o.mark_id = p_mark.id and o.answer_id <> p_answer_id), '[]'::jsonb),
    'proposals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('proposal_id', p.id,
        'answer_id', p.answer_id, 'job_id', p.job_id, 'observation_id', p.observation_id, 'generation', p.generation,
        'source_key', p.source_key, 'method', p.method, 'method_version', p.method_version, 'state', p.proposed_state,
        'x', p.x, 'y', p.y, 'box', pg_catalog.to_jsonb(p.box), 'raw_centre', pg_catalog.to_jsonb(p.raw_centre),
        'raw_box', pg_catalog.to_jsonb(p.raw_box), 'raw_frame', p.raw_frame, 'source_ref', p.source_ref,
        'subtype', p.subtype, 'diameter_mm', p.diameter_mm, 'diameter_source', p.diameter_source,
        'confidence', p.confidence, 'published_at', p.published_at) order by p.generation, p.answer_id, p.source_key)
      from public.takeoff_count_mark_proposals p where p.mark_id = p_mark.id), '[]'::jsonb))
  from (select 1) one
  left join public.takeoff_count_mark_attributions t on t.mark_id = p_mark.id and t.answer_id = p_answer_id
$$;

-- The marks of an answer on one page of its scope, in a stable order (their identifier) after the one given, in the
-- states asked (proposed, to attribute and retained by default; removed and pending on demand), with the page's
-- geometry, the answer's marks revision and the server's total of the marks in those states, apart from the number
-- loaded (at most 1000). Null for an answer the caller may not read.
create function public.read_takeoff_count_marks(p_tenant_id uuid, p_project_id uuid, p_answer_id uuid, p_page integer,
  p_states text[] default null, p_after_mark_id uuid default null, p_limit integer default 500)
returns jsonb language sql stable security definer set search_path = '' as $$
  with answer as (
    select a.* from public.takeoff_item_answers a
    where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
      and a.id = p_answer_id and a.tenant_id = p_tenant_id and a.project_id = p_project_id
  ), page as (
    select g.* from public.takeoff_count_pages g join answer a on g.tenant_id = a.tenant_id and g.project_id = a.project_id
      and g.plan_logical_id = a.plan_logical_id and g.plan_content_sha256 = a.plan_content_sha256 and g.page = p_page
  ), asked as (
    select coalesce(p_states, array['proposed', 'to_attribute', 'retained']) as states
  ), listed as materialized (
    select t.mark_id from public.takeoff_count_mark_attributions t, page g, asked
    where t.answer_id = p_answer_id and t.page_id = g.id and t.state = any (asked.states)
    union
    select p.mark_id from public.takeoff_count_mark_proposals p, page g, asked
    where 'pending' = any (asked.states) and p.answer_id = p_answer_id and p.page_id = g.id
      and not exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = p.mark_id
        and t.answer_id = p_answer_id)
  ), window_ as materialized (
    select l.mark_id from listed l where p_after_mark_id is null or l.mark_id > p_after_mark_id
    order by l.mark_id limit least(greatest(coalesce(p_limit, 500), 1), 1000) + 1
  ), loaded as materialized (
    select w.mark_id from window_ w order by w.mark_id limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  )
  select pg_catalog.jsonb_build_object('answer_id', a.id, 'page', p_page,
    'revision', private.takeoff_count_marks_revision(a.id),
    'geometry', (select pg_catalog.jsonb_build_object('version', g.geometry_version, 'view_box', pg_catalog.to_jsonb(g.view_box),
        'rotation', g.rotation, 'user_unit', g.user_unit, 'width', g.width, 'height', g.height, 'plan_file_id', g.plan_file_id,
        'plan_generation', g.plan_generation) from page g),
    'total', (select count(*) from listed)::integer, 'loaded', (select count(*) from loaded)::integer,
    'next_after', case when (select count(*) from window_) > (select count(*) from loaded)
      then (select l.mark_id from loaded l order by l.mark_id desc limit 1) end,
    'marks', coalesce((select pg_catalog.jsonb_agg(private.takeoff_count_mark_document(m, a.id) order by m.id)
      from public.takeoff_count_marks m join loaded l on l.mark_id = m.id), '[]'::jsonb))
  from answer a
  where p_page = any (private.takeoff_count_answer_scope(a))
$$;

-- The server-side count of the answers given (at most 500) of the affaire, for its readers.
create function public.read_takeoff_count_mark_summaries(p_tenant_id uuid, p_project_id uuid, p_answer_ids uuid[])
returns table (answer_id uuid, summary jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, private.takeoff_count_mark_summary(a.id)
  from public.takeoff_item_answers a
  where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
    and a.tenant_id = p_tenant_id and a.project_id = p_project_id
    and a.id = any (p_answer_ids[1:500])
  order by a.id
$$;

-- The journal of an answer's marks, in order (revision, then the gesture's order), after the position given: who did
-- what, when, before and after, with what reason. It stays readable after the answer's job is deleted.
create function public.read_takeoff_count_mark_events(p_tenant_id uuid, p_project_id uuid, p_answer_id uuid,
  p_after_revision integer default 0, p_after_ordinal integer default 0, p_limit integer default 200)
returns table (event_id uuid, revision integer, ordinal integer, gesture text, mark_id uuid, page integer, before jsonb,
  after jsonb, reason_code text, reason_text text, actor_kind text, actor_id uuid, occurred_at timestamptz,
  previous_event_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id, e.revision, e.ordinal, e.gesture, e.mark_id, e.page, e.before, e.after, e.reason_code, e.reason_text,
    e.actor_kind, e.actor_id, e.occurred_at, e.previous_event_id
  from public.takeoff_count_mark_events e
  where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
    and e.tenant_id = p_tenant_id and e.project_id = p_project_id and e.answer_id = p_answer_id
    and (e.revision, e.ordinal) > (coalesce(p_after_revision, 0), coalesce(p_after_ordinal, 0))
  order by e.revision, e.ordinal
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

do $$
declare
  routine text;
begin
  foreach routine in array array['private.takeoff_count_mark_numbers(jsonb, integer, numeric, numeric)',
    'private.takeoff_count_mark_box(jsonb)', 'private.takeoff_count_page_geometry(jsonb)',
    'private.takeoff_count_answer_scope(public.takeoff_item_answers)',
    'private.takeoff_count_answer_is_current(public.takeoff_item_answers)',
    'private.takeoff_count_page_for(public.takeoff_item_answers, integer, jsonb)',
    'private.takeoff_count_mark_event(uuid, uuid, uuid, uuid, integer, text, uuid, integer, jsonb, jsonb, text, text, uuid)',
    'private.takeoff_count_mark_summary(uuid)', 'private.takeoff_count_marks_revision(uuid)',
    'private.lock_takeoff_count_marks_revision(uuid)',
    'private.takeoff_count_mark_publication_well_formed(jsonb, jsonb)',
    'private.takeoff_count_mark_edit_well_formed(jsonb, jsonb)',
    'private.takeoff_count_mark_document(public.takeoff_count_marks, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', routine);
  end loop;
  execute 'revoke all on function public.publish_takeoff_count_marks(uuid, uuid, integer, jsonb, jsonb) '
    || 'from public, anon, authenticated';
  execute 'grant execute on function public.publish_takeoff_count_marks(uuid, uuid, integer, jsonb, jsonb) to service_role';
  foreach routine in array array['public.edit_takeoff_count_marks(uuid, uuid, uuid, jsonb, jsonb)',
    'public.read_takeoff_count_marks(uuid, uuid, uuid, integer, text[], uuid, integer)',
    'public.read_takeoff_count_mark_summaries(uuid, uuid, uuid[])',
    'public.read_takeoff_count_mark_events(uuid, uuid, uuid, integer, integer, integer)',
    'public.takeoff_count_marks_changed_since(uuid, uuid, uuid, integer)']
  loop
    execute format('revoke all on function %s from public, anon, service_role', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

commit;
