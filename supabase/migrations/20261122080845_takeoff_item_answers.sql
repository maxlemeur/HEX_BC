-- Lot 4, B1: the stored answer of each item of a sealed list on a plan, and its publication.
--
-- A job that reads its plan against the list its request sealed (the second measuring order, behind
-- private.takeoff_item_list_order_activation, empty) gives one answer per item of that list: measured, uncertain or not
-- found, with the pages it searched and those it could not read, its ordered reasons, its quantity (measured) or its
-- candidate value (uncertain), its observations, and the reading of the same item on the same plan it replaces. An
-- answer exists without any quantity: « not found » stores a SQL NULL, never 0. Each observation has its own identity and
-- role: a contribution (counted), a candidate or an alternative (never counted). Only a contribution may be one of the
-- job's takeoff_items rows, the rows the existing readers sum (their quantity stays positive and not null; none of their
-- constraints changes); candidates and alternatives have none. The raw reading is immutable; the state of its review is
-- another relation (lot 4, B2), which references these answers.
--
-- The worker publishes a unit once, under its valid lease, with public.publish_takeoff_item_answers, beside the first
-- order's end (public.finalize_local_takeoff_result, called, not replaced): the result, its rows, the answers and the
-- job's end share one transaction, and a publication whose coverage is not exact is refused before anything is written.
-- A job of a request that sealed a list cannot end as a success any other way (a deferred check on its end). The readers
-- give the items each job was asked about from its sealed order (before any answer exists), the current answer of each
-- item on each plan, the items' states paged in SQL with their counts, and every answer.
--
-- What the previous application version sees while this is applied and after: nothing changes in its writes or answers.
--   - Every new relation is written only by the function above (as its owner) and read by the readers of the affaire.
--   - No column, constraint, index or policy of an existing table changes; no existing function is replaced but one.
--   - One trigger on takeoff_jobs, deferred, queued only when a job of a launch request becomes completed: at the commit
--     it reads that request's row by its key, and refuses only a job whose request sealed a list (none can exist before
--     the second order is activated: its seal refuses a list until then). A job outside any request, a heartbeat, a
--     claim, a renewal or a failure queue nothing.
--   - public.takeoff_rule_job_stamp (20261120204437_takeoff_jobs_by_affaire.sql, its only body) gives the same text for
--     a job without answers; with answers it also tells each answer and the current reading of its item on its plan.
--   - The new foreign keys reference takeoff_jobs, takeoff_results, takeoff_items, takeoff_launch_requests and the list
--     relations: deleting a row of those probes the new indexes on it (two for a takeoff_items row), empty for every row
--     a released writer can delete; the keys without a cascade are checked at the commit of that deletion.
--
-- Locks: every lock this migration needs is taken first, in one statement, without waiting (nowait): a busy table
-- refuses the migration at once, nothing applied, and the migration never waits while it holds a lock. They are held for
-- the DDL only (a few milliseconds), until the commit. Nothing is copied or backfilled.
begin;

set local lock_timeout = '5s';
-- The bodies are validated when they first run (the database tests run every one), as #447 does: validating a SQL
-- function's body here would read and lock the tables it names.
set local check_function_bodies = off;

-- The referenced tables of the new foreign keys, and takeoff_jobs for its deferred trigger.
lock table public.takeoff_launch_requests, public.takeoff_jobs, public.takeoff_results, public.takeoff_items,
  public.takeoff_list_items, public.takeoff_list_revisions, public.takeoff_list_revision_entries
  in share row exclusive mode nowait;

-- 1. Facts that never change once written; their only writer is section 6's function (as the owner). The service role
--    keeps its table rights, as on every public table, but its direct write is refused; a cascade runs as the owner.
create function private.refuse_takeoff_item_answer_direct_write()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user = 'service_role' then
    raise exception 'TAKEOFF_ANSWERS_WRITER_REQUIRED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.refuse_takeoff_item_answer_direct_write() from public, anon, authenticated, service_role;

-- An answer's link to the reading it replaced is cleared when that reading's job is deleted (its foreign key); nothing
-- else of a fact is ever updated.
create function private.refuse_takeoff_item_answer_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_table_name = 'takeoff_item_answers' then
    if to_jsonb(old) ->> 'replaces_answer_id' is not null and to_jsonb(new) ->> 'replaces_answer_id' is null
      and (to_jsonb(new) - 'replaces_answer_id') = (to_jsonb(old) - 'replaces_answer_id') then
      return new;
    end if;
  end if;
  raise exception 'TAKEOFF_ANSWERS_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.refuse_takeoff_item_answer_update() from public, anon, authenticated, service_role;

-- 2. The publication of a unit: one row per job, written with its answers and its end. It names the job, its request,
--    the list revision that request sealed, the result written with it and the versions of the exchange; it keeps the
--    unit's pages it read, what it saw outside the list, and what a replay compares.
create table public.takeoff_item_answer_publications (
  job_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  launch_request_id uuid not null,
  launch_unit_key text not null,
  list_revision_id uuid not null,
  -- The keys without a cascade wait for the commit: deleting a job, an affaire or a tenant deletes these rows through a
  -- longer cascade than the rows they reference, so they are checked once every cascade has run.
  result_id uuid not null references public.takeoff_results (id) deferrable initially deferred,
  -- The versions of the reading: the exchange's schema and the prompt (also the evidence's version).
  exchange_version text not null check (exchange_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  prompt_version text not null check (pg_catalog.char_length(prompt_version) between 1 and 64),
  -- The unit's original pages, 1-based, as its request sealed them and the worker read them.
  pages integer[] not null check (pg_catalog.cardinality(pages) between 1 and 2000 and 0 < all (pages)),
  answer_count integer not null check (answer_count between 0 and 20000),
  -- What the reading saw outside the list: [{page, designation, evidence, chunk_id}], never an item or an answer (the
  -- result's warnings tell them too, code POSTE_HORS_LISTE).
  unlisted_findings jsonb not null check (pg_catalog.jsonb_typeof(unlisted_findings) = 'array'
    and pg_catalog.jsonb_array_length(unlisted_findings) <= 2000),
  -- The digest of the publication as the database received it (computed here only): the same content replays.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- The digest of the attempt's lease token: only the attempt that published replays. Never granted to members.
  attempt_sha256 text not null check (attempt_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_item_answer_publications_job_fkey foreign key (job_id, tenant_id)
    references public.takeoff_jobs (id, tenant_id) on delete cascade,
  constraint takeoff_item_answer_publications_request_fkey foreign key (launch_request_id, tenant_id, project_id)
    references public.takeoff_launch_requests (id, tenant_id, project_id) deferrable initially deferred,
  constraint takeoff_item_answer_publications_revision_fkey foreign key (list_revision_id, tenant_id, project_id)
    references public.takeoff_list_revisions (id, tenant_id, project_id) deferrable initially deferred,
  constraint takeoff_item_answer_publications_scope_key unique (job_id, tenant_id, project_id, list_revision_id)
);
create index takeoff_item_answer_publications_result_idx on public.takeoff_item_answer_publications (result_id);
create index takeoff_item_answer_publications_request_idx on public.takeoff_item_answer_publications (launch_request_id);
create index takeoff_item_answer_publications_revision_idx on public.takeoff_item_answer_publications (list_revision_id);

-- 3. One answer per item of the sealed list on the unit's plan. The plan is named as its request sealed it: the copy
--    read, its logical identity (its dossier piece, or the copy), its generation and the digest of its bytes. Pages are
--    the plan's original pages, 1-based: those searched and those that could not be read together are exactly the pages
--    the unit reads (a page tried and not read may be in both). A measured answer has its quantity, the sum of its contributions; an uncertain one may have a
--    candidate value, never a quantity; « not found » has neither (a SQL NULL, never 0) and no observation. Its reasons
--    are ordered, the first being the primary one. A reading of an item on a plan replaces the latest earlier reading of
--    that item on that plan (any job, any generation): reading_revision numbers them, the greatest is the current one.
create table public.takeoff_item_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  list_revision_id uuid not null,
  item_id uuid not null,
  plan_file_id uuid not null,
  plan_logical_id uuid not null,
  plan_generation text check (pg_catalog.char_length(plan_generation) between 1 and 200),
  plan_content_sha256 text not null check (plan_content_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('measured', 'uncertain', 'not_found')),
  quantity numeric check (quantity > 0),
  unit text check (pg_catalog.char_length(unit) between 1 and 32),
  candidate_quantity numeric check (candidate_quantity > 0),
  candidate_unit text check (pg_catalog.char_length(candidate_unit) between 1 and 32),
  searched_pages integer[] not null,
  unreadable_pages integer[] not null,
  -- [{code, by: model | worker, text, chunk_id}], in order; reason_code is the first one's.
  reasons jsonb not null check (pg_catalog.jsonb_typeof(reasons) = 'array' and pg_catalog.jsonb_array_length(reasons) <= 32),
  reason_code text check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  observation_count integer not null check (observation_count between 0 and 500),
  contribution_count integer not null check (contribution_count between 0 and 500),
  replaces_answer_id uuid,
  reading_revision integer not null check (reading_revision >= 1),
  -- The digest of what was read (this answer's facts and its observations, as stored), computed here only.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_item_answers_pages_check check (
    pg_catalog.cardinality(searched_pages) + pg_catalog.cardinality(unreadable_pages) between 1 and 4000
    and pg_catalog.array_position(searched_pages, null) is null and pg_catalog.array_position(unreadable_pages, null) is null
    and 0 < all (searched_pages) and 0 < all (unreadable_pages)),
  constraint takeoff_item_answers_values_check check ((quantity is null) = (unit is null)
    and (candidate_quantity is null) = (candidate_unit is null) and contribution_count <= observation_count
    and (reason_code is null) = (pg_catalog.jsonb_array_length(reasons) = 0)),
  constraint takeoff_item_answers_outcome_rule_check check (
    (outcome = 'measured' and quantity is not null and candidate_quantity is null and contribution_count >= 1
      and pg_catalog.cardinality(unreadable_pages) = 0)
    or (outcome = 'uncertain' and quantity is null and reason_code is not null)
    or (outcome = 'not_found' and quantity is null and candidate_quantity is null and observation_count = 0
      and pg_catalog.cardinality(unreadable_pages) = 0 and reason_code is not null)),
  constraint takeoff_item_answers_replaces_check check (replaces_answer_id is distinct from id),
  constraint takeoff_item_answers_publication_fkey foreign key (job_id, tenant_id, project_id, list_revision_id)
    references public.takeoff_item_answer_publications (job_id, tenant_id, project_id, list_revision_id) on delete cascade,
  -- Checked at the commit, as the publication's keys (section 2).
  constraint takeoff_item_answers_entry_fkey foreign key (list_revision_id, item_id)
    references public.takeoff_list_revision_entries (revision_id, item_id) deferrable initially deferred,
  constraint takeoff_item_answers_item_fkey foreign key (item_id, tenant_id, project_id)
    references public.takeoff_list_items (id, tenant_id, project_id) deferrable initially deferred,
  constraint takeoff_item_answers_job_item_key unique (job_id, item_id, plan_file_id),
  constraint takeoff_item_answers_reading_key unique (tenant_id, project_id, item_id, plan_logical_id, reading_revision),
  constraint takeoff_item_answers_chain_key unique (id, tenant_id, project_id, item_id, plan_logical_id),
  constraint takeoff_item_answers_scope_key unique (id, tenant_id, project_id, job_id),
  -- What a review decision references (lot 4, B2): the answer in its tenant and affaire.
  constraint takeoff_item_answers_affaire_key unique (id, tenant_id, project_id),
  -- The reading replaced is of the same item on the same plan; a deleted job's reading leaves the link empty.
  constraint takeoff_item_answers_replaces_fkey foreign key (replaces_answer_id, tenant_id, project_id, item_id, plan_logical_id)
    references public.takeoff_item_answers (id, tenant_id, project_id, item_id, plan_logical_id)
    on delete set null (replaces_answer_id)
);
create unique index takeoff_item_answers_replaces_uidx on public.takeoff_item_answers (replaces_answer_id)
  where replaces_answer_id is not null;
create index takeoff_item_answers_generation_idx on public.takeoff_item_answers
  (tenant_id, project_id, item_id, plan_logical_id, plan_generation);
create index takeoff_item_answers_entry_idx on public.takeoff_item_answers (list_revision_id, item_id);

-- 4. The observations of an answer, each with its own identity, in the order the reading gave them, with its role:
--    a contribution (a positive quantity of a measured answer, counted in its total), a candidate (an indication: a page,
--    a candidate value; every positive reading of an answer that is not measured), an alternative (another reading of an
--    object already read: an overlap page, the vector reading of what the model measured; kept, never added). Only a
--    contribution is one of the job's countable takeoff_items rows, the rows the existing readers sum (that row is what a
--    review then corrects; this one keeps the reading as it was); candidates and alternatives have none. A vector
--    observation is never a contribution (marks on a plan stay proposals until a bench qualifies them) and names the
--    vector reading's row written with it, which is excluded and never selected as a source, as today. How its
--    occurrences are covered: a total for its page today (lot 4); a relation of located occurrences, one row per
--    occurrence referencing this observation, comes with lot 5. Its version is its publication's.
create table public.takeoff_item_answer_observations (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 500),
  role text not null check (role in ('contribution', 'candidate', 'alternative')),
  source text not null check (source in ('model', 'vector')),
  page integer not null check (page >= 1),
  quantity numeric check (quantity > 0),
  unit text check (pg_catalog.char_length(unit) between 1 and 32),
  measurement_basis text check (pg_catalog.char_length(measurement_basis) between 1 and 300),
  evidence text not null check (pg_catalog.char_length(pg_catalog.btrim(evidence)) between 1 and 4000),
  confidence numeric not null check (confidence between 0 and 1),
  method text not null check (method ~ '^[a-z][a-z0-9_]{0,47}$'),
  -- The call it came from (a model observation).
  chunk_id text check (chunk_id ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  -- A vector observation: the vector reading's row written with it (an excluded takeoff_items row, never selected as a
  -- source, with its geometry and its page), as today's vector reading writes it.
  -- Both checked at the commit, as the publication's keys (section 2): a job's rows go before its observations.
  vector_item_id uuid references public.takeoff_items (id) deferrable initially deferred,
  takeoff_item_id uuid references public.takeoff_items (id) deferrable initially deferred,
  occurrence_coverage text not null check (occurrence_coverage in ('page_total')),
  constraint takeoff_item_answer_observations_role_rule_check check (
    (role <> 'contribution' or (quantity is not null and unit is not null))
    and (takeoff_item_id is null or role = 'contribution')
    and (source <> 'vector' or (vector_item_id is not null and method = 'vector_reading' and role <> 'contribution'
      and chunk_id is null))
    and (source <> 'model' or (vector_item_id is null and method <> 'vector_reading'))),
  constraint takeoff_item_answer_observations_answer_fkey foreign key (answer_id, tenant_id, project_id, job_id)
    references public.takeoff_item_answers (id, tenant_id, project_id, job_id) on delete cascade,
  constraint takeoff_item_answer_observations_ordinal_key unique (answer_id, ordinal)
);
create unique index takeoff_item_answer_observations_item_uidx on public.takeoff_item_answer_observations (takeoff_item_id)
  where takeoff_item_id is not null;
create index takeoff_item_answer_observations_vector_item_idx on public.takeoff_item_answer_observations (vector_item_id)
  where vector_item_id is not null;

do $$
declare
  relation text;
begin
  foreach relation in array array['takeoff_item_answer_publications', 'takeoff_item_answers',
    'takeoff_item_answer_observations']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format('create trigger %I before insert or delete on public.%I for each row execute function '
      || 'private.refuse_takeoff_item_answer_direct_write()', relation || '_writer', relation);
    execute format('create trigger %I before update on public.%I for each row execute function '
      || 'private.refuse_takeoff_item_answer_update()', relation || '_immutable', relation);
    -- The readers of the affaire, in the tenant the member works in now (the rule of the affaire's list and jobs).
    execute format('create policy %I on public.%I for select to authenticated using '
      || '((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)))', relation || '_reader_select',
      relation);
  end loop;
end;
$$;
grant select on public.takeoff_item_answers, public.takeoff_item_answer_observations to authenticated;
grant select (job_id, tenant_id, project_id, launch_request_id, launch_unit_key, list_revision_id, result_id, exchange_version,
  prompt_version, pages, answer_count, unlisted_findings, content_sha256, published_at)
  on public.takeoff_item_answer_publications to authenticated;

-- 5. The checks of a publication, before anything is read under a lock or written. Each check only reads values whose
--    type an earlier check established.
create function private.takeoff_item_answer_is_uuid(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- A non-blank string of at most p_max characters, matching p_pattern when given.
create function private.takeoff_item_answer_is_text(p_value jsonb, p_pattern text, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value) = 'string'
    and pg_catalog.char_length(pg_catalog.btrim(p_value #>> '{}')) between 1 and p_max
    and pg_catalog.char_length(p_value #>> '{}') <= p_max
    and (p_pattern is null or (p_value #>> '{}') ~ p_pattern), false)
$$;

-- A JSON number within bounds (an integer when asked; the lower bound excluded when asked).
create function private.takeoff_item_answer_is_number(p_value jsonb, p_min numeric, p_max numeric, p_integer boolean,
  p_min_exclusive boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  value numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'number' then
    return false;
  end if;
  value := (p_value #>> '{}')::numeric;
  return value <= p_max and (value > p_min or (not p_min_exclusive and value = p_min))
    and (not p_integer or value = pg_catalog.trunc(value));
end;
$$;

-- Pages: original page numbers, 1-based, at most 2000, without repetition.
create function private.takeoff_item_answer_pages_valid(p_pages jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(p_pages) is distinct from 'array' or pg_catalog.jsonb_array_length(p_pages) > 2000 then
    return false;
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_pages) x(value)
      where not private.takeoff_item_answer_is_number(x.value, 1, 100000, true)) then
    return false;
  end if;
  return (select count(distinct (x.value #>> '{}')::numeric) from pg_catalog.jsonb_array_elements(p_pages) x(value))
    = pg_catalog.jsonb_array_length(p_pages);
end;
$$;

-- A quantity or a candidate value: {value, unit}, a positive number below a billion in a unit.
create function private.takeoff_item_answer_value_valid(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value) = 'object' and (p_value - array['value', 'unit']) = '{}'::jsonb
    and private.takeoff_item_answer_is_number(p_value -> 'value', 0, 999999999.999999, false, true)
    and private.takeoff_item_answer_is_text(p_value -> 'unit', null, 32), false)
$$;

-- The plans of a unit as its request sealed them (one for a unit of format 2), with the pages the unit reads: those
-- retained, else every page of the plan's count; null when neither is known.
create function private.takeoff_item_answer_plans(p_manifest jsonb, p_unit jsonb)
returns table (plan_file_id uuid, logical_id uuid, generation text, content_sha256 text, pages integer[], name text)
language plpgsql immutable set search_path = '' as $$
declare
  entry record;
  plan jsonb;
  pages integer[];
begin
  for entry in select k.value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_unit -> 'plans') = 'array'
      then p_unit -> 'plans' else '[]'::jsonb end) k(value)
  loop
    select p.value into plan from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_manifest -> 'plans') = 'array'
      then p_manifest -> 'plans' else '[]'::jsonb end) p(value) where p.value -> 'entry_key' = entry.value limit 1;
    pages := null;
    if pg_catalog.jsonb_typeof(plan -> 'pages') = 'array' and pg_catalog.jsonb_array_length(plan -> 'pages') > 0 then
      if private.takeoff_item_answer_pages_valid(plan -> 'pages') then
        pages := array(select (x.value #>> '{}')::numeric::integer from pg_catalog.jsonb_array_elements(plan -> 'pages') x(value)
          order by 1);
      end if;
    elsif private.takeoff_item_answer_is_number(plan -> 'page_count', 1, 2000, true) then
      pages := array(select pg_catalog.generate_series(1, (plan ->> 'page_count')::numeric::integer));
    end if;
    return query select
      case when private.takeoff_item_answer_is_uuid(plan -> 'plan_file_id') then (plan ->> 'plan_file_id')::uuid end,
      case when private.takeoff_item_answer_is_uuid(plan -> 'logical_id') then (plan ->> 'logical_id')::uuid end,
      case when private.takeoff_item_answer_is_text(plan -> 'generation', null, 200) then plan ->> 'generation' end,
      case when coalesce(plan ->> 'content_sha256', '') ~ '^[0-9a-f]{64}$' then plan ->> 'content_sha256' end,
      pages,
      case when private.takeoff_item_answer_is_text(plan -> 'name', null, 500) then plan ->> 'name' end;
  end loop;
end;
$$;

create function private.takeoff_item_answer_well_formed(p_answer jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  chunk_pattern constant text := '^[a-z0-9][a-z0-9-]{0,31}$';
  entry jsonb;
begin
  if pg_catalog.jsonb_typeof(p_answer) is distinct from 'object' then
    return false;
  end if;
  -- An optional field sent as null is absent.
  p_answer := pg_catalog.jsonb_strip_nulls(p_answer);
  if (p_answer - array['item_id', 'outcome', 'reasons', 'searched_pages', 'unreadable_pages', 'quantity', 'candidate',
      'observations']) <> '{}'::jsonb
    or not private.takeoff_item_answer_is_uuid(p_answer -> 'item_id')
    or coalesce(p_answer ->> 'outcome', '') not in ('measured', 'uncertain', 'not_found')
    or not private.takeoff_item_answer_pages_valid(p_answer -> 'searched_pages')
    or not private.takeoff_item_answer_pages_valid(p_answer -> 'unreadable_pages')
    or (p_answer ? 'quantity' and not private.takeoff_item_answer_value_valid(p_answer -> 'quantity'))
    or (p_answer ? 'candidate' and not private.takeoff_item_answer_value_valid(p_answer -> 'candidate'))
    or pg_catalog.jsonb_typeof(coalesce(p_answer -> 'reasons', '[]'::jsonb)) is distinct from 'array'
    or pg_catalog.jsonb_array_length(coalesce(p_answer -> 'reasons', '[]'::jsonb)) > 32
    or pg_catalog.jsonb_typeof(coalesce(p_answer -> 'observations', '[]'::jsonb)) is distinct from 'array'
    or pg_catalog.jsonb_array_length(coalesce(p_answer -> 'observations', '[]'::jsonb)) > 500 then
    return false;
  end if;
  for entry in select r.value from pg_catalog.jsonb_array_elements(coalesce(p_answer -> 'reasons', '[]'::jsonb)) r(value) loop
    if pg_catalog.jsonb_typeof(entry) is distinct from 'object'
      or (entry - array['code', 'by', 'text', 'chunk_id']) <> '{}'::jsonb
      or not private.takeoff_item_answer_is_text(entry -> 'code', '^[A-Z][A-Z0-9_]{0,63}$', 64)
      or coalesce(entry ->> 'by', '') not in ('model', 'worker')
      or (entry ? 'text' and not private.takeoff_item_answer_is_text(entry -> 'text', null, 500))
      or (entry ? 'chunk_id' and not private.takeoff_item_answer_is_text(entry -> 'chunk_id', chunk_pattern, 32)) then
      return false;
    end if;
  end loop;
  for entry in select o.value from pg_catalog.jsonb_array_elements(coalesce(p_answer -> 'observations', '[]'::jsonb)) o(value) loop
    if pg_catalog.jsonb_typeof(entry) is distinct from 'object'
      or (entry - array['page', 'evidence', 'method', 'confidence', 'quantity', 'unit', 'measurement_basis', 'role', 'source',
        'chunk_id', 'vector_key', 'takeoff_item_id']) <> '{}'::jsonb
      or not private.takeoff_item_answer_is_number(entry -> 'page', 1, 100000, true)
      or not private.takeoff_item_answer_is_text(entry -> 'evidence', null, 4000)
      or not private.takeoff_item_answer_is_text(entry -> 'method', '^[a-z][a-z0-9_]{0,47}$', 48)
      or not private.takeoff_item_answer_is_number(entry -> 'confidence', 0, 1, false)
      or (entry ? 'quantity' and not private.takeoff_item_answer_is_number(entry -> 'quantity', 0, 999999999.999999, false, true))
      or (entry ? 'unit' and not private.takeoff_item_answer_is_text(entry -> 'unit', null, 32))
      or (entry ? 'measurement_basis' and not private.takeoff_item_answer_is_text(entry -> 'measurement_basis', null, 300))
      or coalesce(entry ->> 'role', '') not in ('contribution', 'candidate', 'alternative')
      or coalesce(entry ->> 'source', '') not in ('model', 'vector')
      or (entry ? 'chunk_id' and not private.takeoff_item_answer_is_text(entry -> 'chunk_id', chunk_pattern, 32))
      or (entry ? 'vector_key' and not private.takeoff_item_answer_is_uuid(entry -> 'vector_key'))
      or (entry ? 'takeoff_item_id' and not private.takeoff_item_answer_is_uuid(entry -> 'takeoff_item_id')) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- What the reading saw outside the list: [{page, designation, evidence, chunk_id}].
create function private.takeoff_item_answer_findings_valid(p_findings jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  entry jsonb;
begin
  if pg_catalog.jsonb_typeof(p_findings) is distinct from 'array' or pg_catalog.jsonb_array_length(p_findings) > 2000 then
    return false;
  end if;
  for entry in select pg_catalog.jsonb_strip_nulls(f.value) from pg_catalog.jsonb_array_elements(p_findings) f(value) loop
    if pg_catalog.jsonb_typeof(entry) is distinct from 'object'
      or (entry - array['page', 'designation', 'evidence', 'chunk_id']) <> '{}'::jsonb
      or not private.takeoff_item_answer_is_number(entry -> 'page', 1, 100000, true)
      or not private.takeoff_item_answer_is_text(entry -> 'designation', null, 600)
      or not private.takeoff_item_answer_is_text(entry -> 'evidence', null, 4000)
      or (entry ? 'chunk_id' and not private.takeoff_item_answer_is_text(entry -> 'chunk_id', '^[a-z0-9][a-z0-9-]{0,31}$', 32)) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- The answers of a well-formed publication, typed; an optional field sent as null is absent.
create function private.takeoff_item_answers_parsed(p_answers jsonb)
returns table (ordinal integer, item_id uuid, outcome text, searched_pages integer[], unreadable_pages integer[],
  quantity numeric, unit text, candidate_quantity numeric, candidate_unit text, reasons jsonb, observations jsonb)
language sql immutable set search_path = '' as $$
  select a.position::integer, (a.value ->> 'item_id')::uuid, a.value ->> 'outcome',
    array(select (x.value #>> '{}')::numeric::integer from pg_catalog.jsonb_array_elements(a.value -> 'searched_pages') x(value)
      order by 1),
    array(select (x.value #>> '{}')::numeric::integer from pg_catalog.jsonb_array_elements(a.value -> 'unreadable_pages') x(value)
      order by 1),
    (a.value #>> '{quantity,value}')::numeric, a.value #>> '{quantity,unit}',
    (a.value #>> '{candidate,value}')::numeric, a.value #>> '{candidate,unit}',
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('code', r.value ->> 'code', 'by', r.value ->> 'by',
        'text', r.value ->> 'text', 'chunk_id', r.value ->> 'chunk_id') order by r.position)
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(a.value -> 'reasons') = 'array'
        then a.value -> 'reasons' else '[]'::jsonb end) with ordinality r(value, position)), '[]'::jsonb),
    case when pg_catalog.jsonb_typeof(a.value -> 'observations') = 'array' then a.value -> 'observations' else '[]'::jsonb end
  from pg_catalog.jsonb_array_elements(p_answers) with ordinality as a(value, position)
$$;

-- Why a publication cannot be written, or null, with one code for each case: its shape; its unit (one plan of a request
-- that sealed a list, read on the pages it sealed); its coverage (one answer per item of the sealed list, and nothing
-- else); its pages (every page named is the unit's; each answer searched or could not read each of them); each
-- outcome's rule; the vector rows (never countable); its observations (the role of each, and every row the result writes
-- is a contribution's, with its quantity and page).
create function private.takeoff_item_answers_refusal(p_request public.takeoff_launch_requests, p_unit jsonb, p_pages integer[],
  p_items jsonb, p_answers jsonb, p_findings jsonb, p_vector jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  plan record;
  plan_count integer;
begin
  if pg_catalog.jsonb_array_length(p_answers) > 20000 or pg_catalog.jsonb_array_length(p_items) > 20000
    or coalesce(pg_catalog.cardinality(p_pages), 0) not between 1 and 2000 or pg_catalog.array_position(p_pages, null) is not null
    or not private.takeoff_item_answer_findings_valid(p_findings)
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_answers) a(value)
      where not private.takeoff_item_answer_well_formed(a.value)) then
    return 'TAKEOFF_ANSWERS_INVALID';
  end if;
  -- The unit: one plan, its identity and its pages as sealed; the pages the worker read are those.
  select count(*) into plan_count from private.takeoff_item_answer_plans(p_request.manifest, p_unit);
  if plan_count <> 1 then
    return 'TAKEOFF_ANSWERS_ORDER_INVALID';
  end if;
  select * into plan from private.takeoff_item_answer_plans(p_request.manifest, p_unit);
  if plan.plan_file_id is null or plan.logical_id is null or plan.content_sha256 is null or plan.pages is null then
    return 'TAKEOFF_ANSWERS_SCOPE_UNKNOWN';
  end if;
  if array(select distinct p from pg_catalog.unnest(p_pages) p order by 1) is distinct from plan.pages
    or pg_catalog.cardinality(p_pages) <> pg_catalog.cardinality(plan.pages) then
    return 'TAKEOFF_ANSWERS_UNIT_PAGES_MISMATCH';
  end if;
  -- Coverage: two answers for one item, an answer for an item outside the sealed list, an item without its answer.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a group by a.item_id having count(*) > 1) then
    return 'TAKEOFF_ANSWERS_ITEM_DUPLICATE';
  end if;
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where not exists (select 1 from public.takeoff_list_revision_entries e
        where e.revision_id = p_request.item_list_revision_id and e.item_id = a.item_id)) then
    return 'TAKEOFF_ANSWERS_ITEM_FOREIGN';
  end if;
  if (select count(*) from public.takeoff_list_revision_entries e where e.revision_id = p_request.item_list_revision_id)
      <> pg_catalog.jsonb_array_length(p_answers) then
    return 'TAKEOFF_ANSWERS_ITEM_MISSING';
  end if;
  -- Pages: every page an answer, an observation or a finding names is the unit's; each answer accounts for each page.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where not (a.searched_pages <@ plan.pages) or not (a.unreadable_pages <@ plan.pages)
        or exists (select 1 from pg_catalog.jsonb_array_elements(a.observations) o(value)
          where not ((o.value ->> 'page')::numeric::integer = any (plan.pages))))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_findings) f(value)
      where not ((f.value ->> 'page')::numeric::integer = any (plan.pages))) then
    return 'TAKEOFF_ANSWERS_PAGE_OUTSIDE';
  end if;
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where not (plan.pages <@ (a.searched_pages || a.unreadable_pages))) then
    return 'TAKEOFF_ANSWERS_COVERAGE_INCOMPLETE';
  end if;
  -- Each outcome's rule. Measured: its quantity is the sum of its contributions (at least one), no unreadable page, no
  -- candidate value. Not found: no observation, no quantity nor candidate value, no unreadable page, a reason. Uncertain:
  -- a reason, no quantity.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where a.outcome = 'measured' and (a.quantity is null or a.candidate_quantity is not null
        or pg_catalog.cardinality(a.unreadable_pages) > 0
        or not exists (select 1 from pg_catalog.jsonb_array_elements(a.observations) o(value) where o.value ->> 'role' = 'contribution')
        or pg_catalog.round((select sum((o.value ->> 'quantity')::numeric) from pg_catalog.jsonb_array_elements(a.observations) o(value)
          where o.value ->> 'role' = 'contribution'), 6) is distinct from pg_catalog.round(a.quantity, 6))) then
    return 'TAKEOFF_ANSWERS_MEASURED_INVALID';
  end if;
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where a.outcome = 'not_found' and (pg_catalog.jsonb_array_length(a.observations) > 0 or a.quantity is not null
        or a.candidate_quantity is not null or pg_catalog.cardinality(a.unreadable_pages) > 0
        or pg_catalog.jsonb_array_length(a.reasons) = 0)) then
    return 'TAKEOFF_ANSWERS_NOT_FOUND_INVALID';
  end if;
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where a.outcome = 'uncertain' and (pg_catalog.jsonb_array_length(a.reasons) = 0 or a.quantity is not null)) then
    return 'TAKEOFF_ANSWERS_UNCERTAIN_INVALID';
  end if;
  -- The vector reading's rows, as today's vector reading writes them, but never countable: each excluded, none selected as
  -- a source (no choice), none a row of the result.
  if p_vector is not null and (
      exists (select 1 from pg_catalog.unnest(array['pages', 'items', 'geometries', 'choices']) k(key)
        where p_vector ? k.key and pg_catalog.jsonb_typeof(p_vector -> k.key) not in ('array', 'null'))
      or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(p_vector -> 'choices') = 'array'
        then p_vector -> 'choices' else '[]'::jsonb end) > 0
      or exists (select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_vector -> 'items') = 'array'
          then p_vector -> 'items' else '[]'::jsonb end) v(value)
        where pg_catalog.jsonb_typeof(v.value) is distinct from 'object' or not private.takeoff_item_answer_is_uuid(v.value -> 'id')
          or v.value -> 'is_excluded' is distinct from 'true'::jsonb
          or not private.takeoff_item_answer_is_number(v.value -> 'source_page', 1, 100000, true)
          or exists (select 1 from pg_catalog.jsonb_array_elements(p_items) i(value) where lower(i.value ->> 'id') = lower(v.value ->> 'id')))) then
    return 'TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID';
  end if;
  -- Observations: a contribution belongs to a measured answer and has its quantity and unit; only a contribution names a
  -- row of the result; a vector observation is never a contribution, has the vector method and names a vector row of this
  -- publication on its page; a model observation names none.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
      where (o.value ->> 'role' = 'contribution' and (a.outcome <> 'measured' or o.value -> 'quantity' is null
          or o.value -> 'quantity' = 'null'::jsonb or o.value -> 'unit' is null or o.value -> 'unit' = 'null'::jsonb))
        or (o.value ->> 'takeoff_item_id' is not null and o.value ->> 'role' <> 'contribution')
        or (o.value ->> 'source' = 'vector' and (o.value ->> 'role' = 'contribution' or o.value ->> 'method' <> 'vector_reading'
          or o.value ->> 'chunk_id' is not null or o.value ->> 'vector_key' is null
          or not exists (select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_vector -> 'items') = 'array'
              then p_vector -> 'items' else '[]'::jsonb end) v(value)
            where lower(v.value ->> 'id') = lower(o.value ->> 'vector_key')
              and (v.value ->> 'source_page')::numeric::integer = (o.value ->> 'page')::numeric::integer)))
        or (o.value ->> 'source' = 'model' and (o.value ->> 'vector_key' is not null or o.value ->> 'method' = 'vector_reading'))) then
    return 'TAKEOFF_ANSWERS_OBSERVATION_INVALID';
  end if;
  -- Every row the result writes is the takeoff_items row of exactly one contribution, with its quantity (to the
  -- thousandth, which the row keeps) and page (its unit is the worker's normalized code of the contribution's).
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_items) i(value)
      where pg_catalog.jsonb_typeof(i.value) is distinct from 'object' or not private.takeoff_item_answer_is_uuid(i.value -> 'id')
        or not private.takeoff_item_answer_is_number(i.value -> 'quantity', 0, 999999999.999, false, true)
        or not private.takeoff_item_answer_is_text(i.value -> 'unit', null, 32)
        or not private.takeoff_item_answer_is_number(i.value -> 'source_page', 1, 100000, true))
    or (select count(distinct lower(i.value ->> 'id')) from pg_catalog.jsonb_array_elements(p_items) i(value))
      <> pg_catalog.jsonb_array_length(p_items) then
    return 'TAKEOFF_ANSWERS_OBSERVATION_INVALID';
  end if;
  if (select count(*) from private.takeoff_item_answers_parsed(p_answers) a
        cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
        where o.value ->> 'takeoff_item_id' is not null) <> pg_catalog.jsonb_array_length(p_items)
    or (select count(distinct (o.value ->> 'takeoff_item_id')::uuid) from private.takeoff_item_answers_parsed(p_answers) a
        cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
        where o.value ->> 'takeoff_item_id' is not null) <> pg_catalog.jsonb_array_length(p_items)
    or exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
      left join lateral (select i.value from pg_catalog.jsonb_array_elements(p_items) i(value)
        where (i.value ->> 'id')::uuid = (o.value ->> 'takeoff_item_id')::uuid) item on true
      where o.value ->> 'takeoff_item_id' is not null and (item.value is null
        or (item.value ->> 'quantity')::numeric <> (o.value ->> 'quantity')::numeric
        or (o.value ->> 'quantity')::numeric <> pg_catalog.round((o.value ->> 'quantity')::numeric, 3)
        or (item.value ->> 'source_page')::numeric::integer <> (o.value ->> 'page')::numeric::integer)) then
    return 'TAKEOFF_ANSWERS_OBSERVATION_INVALID';
  end if;
  return null;
end;
$$;

-- 6. The worker's publication of a unit of the second measuring order, under its valid lease: the result, its rows, its
--    vector reading, its answers with their observations and the job's end in one transaction. It stands beside the first
--    order's end, public.finalize_local_takeoff_result, which it calls for the result, the rows and the end and does not
--    replace; a vector row an observation names that this end could not write refuses the whole publication (that end
--    keeps a failed vector reading to itself; here it is never left behind an observation).
--    The job alone names the unit: the request, its unit, the plan and its pages and the list are those the request
--    sealed, never the worker's word. The worker gives the pages it read (they must be the unit's), the versions of the
--    exchange, the answers, what it saw outside the list (its result's warnings tell it too, as the worker writes them),
--    and what the first order's end takes.
--    Answers: the result, false, the number of answers; the same publication of the same attempt again answers the same,
--    replayed, writing nothing. Refuses, with its code and nothing written: a lease that is not this job's valid one, or
--    another attempt's publication (TAKEOFF_ANSWERS_LEASE_INVALID); another content for the same attempt
--    (TAKEOFF_ANSWERS_ALREADY_PUBLISHED); a job that is not a unit of a request that sealed a list
--    (TAKEOFF_ANSWERS_ORDER_INVALID); and every case of private.takeoff_item_answers_refusal.
--    Locks, in the takeoff order: the job's row (rank 5, for update), then, once the publication is known to be exact, its
--    request's row (rank 6, for update, as the job's end takes it anyway), then what that function and the job's end take
--    (its result and rows, rank 8; the triggers of the end: the Mac's slot and the ledger, rank 7, as today's end takes
--    them); the foreign keys take a key share of rows held, just written or immutable. None of lot 4's advisory keys.
create function public.publish_takeoff_item_answers(
  p_job_id uuid, p_lease_token uuid, p_completed_at timestamptz, p_model text, p_prompt_version text, p_exchange jsonb,
  p_unit_pages integer[], p_answers jsonb, p_findings jsonb, p_result jsonb, p_items jsonb, p_vector jsonb default null
)
returns table (result_id uuid, replayed boolean, answer_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  job public.takeoff_jobs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  published public.takeoff_item_answer_publications%rowtype;
  plan record;
  unit jsonb;
  digest text;
  attempt text;
  refusal text;
  new_result uuid;
  written integer;
  linked integer;
begin
  if p_job_id is null or p_lease_token is null or p_completed_at is null
    or pg_catalog.jsonb_typeof(p_exchange) is distinct from 'object'
    or (p_exchange - array['schema_version', 'prompt_version']) <> '{}'::jsonb
    or coalesce(p_exchange ->> 'schema_version', '') !~ '^[a-z0-9][a-z0-9._-]{0,31}$'
    or coalesce(pg_catalog.char_length(p_prompt_version), 0) not between 1 and 64
    or p_exchange ->> 'prompt_version' is distinct from p_prompt_version
    or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array' or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_findings) is distinct from 'array' or pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
    or pg_catalog.jsonb_typeof(coalesce(p_result -> 'warnings', '[]'::jsonb)) is distinct from 'array'
    or (p_vector is not null and pg_catalog.jsonb_typeof(p_vector) is distinct from 'object')
    or pg_catalog.octet_length(p_answers::text) > 8388608 then
    raise exception 'TAKEOFF_ANSWERS_INVALID' using errcode = '22023';
  end if;
  -- Every argument, as the database received it (a replay sends the same values); the completion time as an instant.
  digest := private.takeoff_sha256(pg_catalog.jsonb_build_object('completed_at', extract(epoch from p_completed_at),
    'model', p_model, 'prompt_version', p_prompt_version, 'exchange', p_exchange, 'unit_pages', p_unit_pages,
    'answers', p_answers, 'findings', p_findings, 'result', p_result, 'items', p_items, 'vector', p_vector));
  attempt := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_lease_token::text, 'UTF8')), 'hex');

  select j.* into job from public.takeoff_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'TAKEOFF_ANSWERS_LEASE_INVALID' using errcode = '55000';
  end if;
  select p.* into published from public.takeoff_item_answer_publications p where p.job_id = p_job_id;
  if found then
    if published.attempt_sha256 is distinct from attempt then
      raise exception 'TAKEOFF_ANSWERS_LEASE_INVALID' using errcode = '55000';
    end if;
    if published.content_sha256 is distinct from digest then
      raise exception 'TAKEOFF_ANSWERS_ALREADY_PUBLISHED' using errcode = '23505';
    end if;
    return query select published.result_id, true, published.answer_count;
    return;
  end if;
  if job.status is distinct from 'processing' or job.execution_provider is distinct from 'chatgpt_local'
    or job.processing_lease_token is distinct from p_lease_token
    or not (job.processing_lease_expires_at > pg_catalog.clock_timestamp()) then
    raise exception 'TAKEOFF_ANSWERS_LEASE_INVALID' using errcode = '55000';
  end if;

  -- The request's manifest and sealed list are written once, at its admission: read without a lock for the checks, which
  -- then do not hold the request's row.
  select r.* into request from public.takeoff_launch_requests r
  where r.id = job.launch_request_id and r.tenant_id = job.tenant_id and r.project_id = job.project_id;
  unit := case when found then private.takeoff_launch_unit(request.manifest, job.launch_unit_key) end;
  if request.item_list_revision_id is null or unit is null then
    raise exception 'TAKEOFF_ANSWERS_ORDER_INVALID' using errcode = '22023';
  end if;
  refusal := private.takeoff_item_answers_refusal(request, unit, p_unit_pages, p_items, p_answers, p_findings, p_vector);
  if refusal is not null then
    raise exception '%', refusal using errcode = '22023';
  end if;
  -- The request's row, as the job's end takes it anyway (its settlement), before anything is written.
  perform 1 from public.takeoff_launch_requests r where r.id = request.id for update;
  select * into plan from private.takeoff_item_answer_plans(request.manifest, unit);

  new_result := public.finalize_local_takeoff_result(p_job_id, job.tenant_id, p_lease_token, p_completed_at, p_model,
    p_prompt_version, p_result, p_items, p_vector);
  if new_result is null then
    raise exception 'TAKEOFF_ANSWERS_LEASE_INVALID' using errcode = '55000';
  end if;
  -- That end keeps a failed vector reading to itself: an observation never names a row it did not write.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
      where o.value ->> 'source' = 'vector' and not exists (select 1 from public.takeoff_items i
        where i.id = (o.value ->> 'vector_key')::uuid and i.job_id = p_job_id and i.result_id = new_result and i.is_excluded)) then
    raise exception 'TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID' using errcode = '22023';
  end if;

  insert into public.takeoff_item_answer_publications (job_id, tenant_id, project_id, launch_request_id, launch_unit_key,
    list_revision_id, result_id, exchange_version, prompt_version, pages, answer_count, unlisted_findings, content_sha256,
    attempt_sha256)
  values (job.id, job.tenant_id, job.project_id, request.id, job.launch_unit_key, request.item_list_revision_id, new_result,
    p_exchange ->> 'schema_version', p_prompt_version, plan.pages, pg_catalog.jsonb_array_length(p_answers),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', (f.value ->> 'page')::numeric::integer,
        'designation', f.value ->> 'designation', 'evidence', f.value ->> 'evidence', 'chunk_id', f.value ->> 'chunk_id')
        order by f.position)
      from pg_catalog.jsonb_array_elements(p_findings) with ordinality f(value, position)), '[]'::jsonb),
    digest, attempt);

  -- Each answer with its observations as given (a contribution names the row the result just wrote, a vector one the
  -- vector reading's row), its digest, and the latest earlier reading of its item on its plan in the affaire, which it
  -- replaces.
  with parsed as materialized (
    select a.*, pg_catalog.gen_random_uuid() as answer_id from private.takeoff_item_answers_parsed(p_answers) a
  ), observations as materialized (
    select a.answer_id, o.position::integer as ordinal, o.value ->> 'role' as role, o.value ->> 'source' as source,
      (o.value ->> 'page')::numeric::integer as page, (o.value ->> 'quantity')::numeric as quantity, o.value ->> 'unit' as unit,
      o.value ->> 'measurement_basis' as measurement_basis, o.value ->> 'evidence' as evidence,
      (o.value ->> 'confidence')::numeric as confidence, o.value ->> 'method' as method, o.value ->> 'chunk_id' as chunk_id,
      (o.value ->> 'vector_key')::uuid as vector_item_id, (o.value ->> 'takeoff_item_id')::uuid as takeoff_item_id
    from parsed a
    cross join lateral pg_catalog.jsonb_array_elements(a.observations) with ordinality o(value, position)
  ), answers as materialized (
    select a.*, previous.id as replaces_answer_id, coalesce(previous.reading_revision, 0) + 1 as reading_revision,
      (select count(*) from observations o where o.answer_id = a.answer_id)::integer as observation_count,
      (select count(*) from observations o where o.answer_id = a.answer_id and o.role = 'contribution')::integer
        as contribution_count,
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ordinal', o.ordinal, 'role', o.role,
          'source', o.source, 'page', o.page, 'quantity', o.quantity, 'unit', o.unit, 'measurement_basis', o.measurement_basis,
          'evidence', o.evidence, 'confidence', o.confidence, 'method', o.method, 'chunk_id', o.chunk_id,
          'vector_item_id', o.vector_item_id, 'takeoff_item_id', o.takeoff_item_id, 'occurrence_coverage', 'page_total')
          order by o.ordinal)
        from observations o where o.answer_id = a.answer_id), '[]'::jsonb) as observation_document
    from parsed a
    left join lateral (select h.id, h.reading_revision from public.takeoff_item_answers h
      where h.tenant_id = job.tenant_id and h.project_id = job.project_id and h.item_id = a.item_id
        and h.plan_logical_id = plan.logical_id
      order by h.reading_revision desc limit 1) previous on true
  ), inserted as (
    insert into public.takeoff_item_answers (id, tenant_id, project_id, job_id, list_revision_id, item_id, plan_file_id,
      plan_logical_id, plan_generation, plan_content_sha256, outcome, quantity, unit, candidate_quantity, candidate_unit,
      searched_pages, unreadable_pages, reasons, reason_code, observation_count, contribution_count, replaces_answer_id,
      reading_revision, content_sha256)
    select a.answer_id, job.tenant_id, job.project_id, job.id, request.item_list_revision_id, a.item_id, plan.plan_file_id,
      plan.logical_id, plan.generation, plan.content_sha256, a.outcome, a.quantity, a.unit, a.candidate_quantity,
      a.candidate_unit, a.searched_pages, a.unreadable_pages, a.reasons, a.reasons #>> '{0,code}', a.observation_count,
      a.contribution_count, a.replaces_answer_id, a.reading_revision,
      private.takeoff_sha256(pg_catalog.jsonb_build_object('item_id', a.item_id, 'plan_file_id', plan.plan_file_id,
        'plan_logical_id', plan.logical_id, 'plan_generation', plan.generation, 'plan_content_sha256', plan.content_sha256,
        'outcome', a.outcome, 'quantity', a.quantity, 'unit', a.unit, 'candidate_quantity', a.candidate_quantity,
        'candidate_unit', a.candidate_unit, 'searched_pages', a.searched_pages, 'unreadable_pages', a.unreadable_pages,
        'reasons', a.reasons, 'observations', a.observation_document))
    from answers a
    order by a.ordinal
    returning 1
  ), observations_inserted as (
    insert into public.takeoff_item_answer_observations (answer_id, tenant_id, project_id, job_id, ordinal, role, source, page,
      quantity, unit, measurement_basis, evidence, confidence, method, chunk_id, vector_item_id, takeoff_item_id,
      occurrence_coverage)
    select o.answer_id, job.tenant_id, job.project_id, job.id, o.ordinal, o.role, o.source, o.page, o.quantity, o.unit,
      o.measurement_basis, o.evidence, o.confidence, o.method, o.chunk_id, o.vector_item_id, o.takeoff_item_id, 'page_total'
    from observations o
    returning takeoff_item_id
  )
  select (select count(*) from inserted), (select count(*) from observations_inserted where takeoff_item_id is not null)
  into written, linked;
  -- Each answer and each row of the result was written with its observation (the checks above proved it; this states it).
  if written <> pg_catalog.jsonb_array_length(p_answers) or linked <> pg_catalog.jsonb_array_length(p_items) then
    raise exception 'TAKEOFF_ANSWERS_OBSERVATION_INVALID' using errcode = '22023';
  end if;
  return query select new_result, false, written;
end;
$$;
revoke all on function public.publish_takeoff_item_answers(uuid, uuid, timestamptz, text, text, jsonb, integer[], jsonb, jsonb, jsonb,
  jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_takeoff_item_answers(uuid, uuid, timestamptz, text, text, jsonb, integer[], jsonb, jsonb,
  jsonb, jsonb, jsonb) to service_role;

do $$
declare
  routine text;
begin
  foreach routine in array array['private.takeoff_item_answer_plans(jsonb, jsonb)', 'private.takeoff_item_answer_is_uuid(jsonb)',
    'private.takeoff_item_answer_is_text(jsonb, text, integer)',
    'private.takeoff_item_answer_is_number(jsonb, numeric, numeric, boolean, boolean)',
    'private.takeoff_item_answer_pages_valid(jsonb)', 'private.takeoff_item_answer_value_valid(jsonb)',
    'private.takeoff_item_answer_well_formed(jsonb)', 'private.takeoff_item_answer_findings_valid(jsonb)',
    'private.takeoff_item_answers_parsed(jsonb)',
    'private.takeoff_item_answers_refusal(public.takeoff_launch_requests, jsonb, integer[], jsonb, jsonb, jsonb, jsonb)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', routine);
  end loop;
end;
$$;

-- 7. A job of a request that sealed a list ends as a success only with its publication: checked at the commit of its end,
--    once the publication of the same transaction is written. Queued only for a job of a launch request that becomes
--    completed; it reads that request's row by its key, and its publication by its key.
create function private.require_takeoff_item_answers_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.takeoff_launch_requests r
      where r.id = new.launch_request_id and r.item_list_revision_id is not null)
    and not exists (select 1 from public.takeoff_item_answer_publications p where p.job_id = new.id) then
    raise exception 'TAKEOFF_ANSWERS_REQUIRED' using errcode = '22023';
  end if;
  return null;
end;
$$;
revoke all on function private.require_takeoff_item_answers_publication() from public, anon, authenticated, service_role;
create constraint trigger zz_require_takeoff_item_answers after update of status on public.takeoff_jobs
  deferrable initially deferred
  for each row when (new.status = 'completed' and old.status is distinct from new.status and new.launch_request_id is not null)
  execute function private.require_takeoff_item_answers_publication();

-- 8. What a send compares of a peer (20261120204437_takeoff_jobs_by_affaire.sql, unchanged otherwise): with the answers
--    of the job, each with the current reading of its item on its plan, so that a reading of this job replaced by a later
--    one changes the stamp. A job without answers keeps the same text, so the same stamp, as before.
create or replace function public.takeoff_rule_job_stamp(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select md5((jsonb_build_array(j.id, j.status, j.preparation_snapshot,
    (select jsonb_agg(jsonb_build_array(i.id, i.updated_at, i.rules_stale_at, i.designation, i.quantity, i.unit,
        i.metadata, i.source_file_name, i.source_page, i.is_excluded, i.is_verified, i.quantity_entry_category) order by i.id)
      from public.takeoff_items i where i.job_id = j.id and i.tenant_id = j.tenant_id),
    (select jsonb_agg(jsonb_build_array(p.id, p.plan_file_id, p.source_file_name, p.source_page, p.reading, p.rule_anchors) order by p.id)
      from public.takeoff_vector_pages p where p.job_id = j.id and p.tenant_id = j.tenant_id),
    (select jsonb_agg(jsonb_build_array(g.takeoff_item_id, g.vector_page_id, g.geometry - 'transform') order by g.takeoff_item_id)
      from public.takeoff_item_geometries g where g.job_id = j.id and g.tenant_id = j.tenant_id)
  ) || coalesce((select jsonb_build_array(jsonb_agg(jsonb_build_array(a.id, a.content_sha256, head.id) order by a.id))
      from public.takeoff_item_answers a
      cross join lateral (select h.id from public.takeoff_item_answers h
        where h.tenant_id = a.tenant_id and h.project_id = a.project_id and h.item_id = a.item_id
          and h.plan_logical_id = a.plan_logical_id
        order by h.reading_revision desc limit 1) head
      where a.job_id = j.id and a.tenant_id = j.tenant_id
      having count(*) > 0), '[]'::jsonb))::text)
  from public.takeoff_jobs j
  where j.id = p_job_id and j.project_id = p_project_id and j.tenant_id = p_tenant_id
    and j.estimate_version_id is null
$$;
revoke all on function public.takeoff_rule_job_stamp(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.takeoff_rule_job_stamp(uuid, uuid, uuid) to service_role;

-- 9. The readers, for the readers of the affaire: called with the member's session, each checks the affaire's read rule
--    once for its statement (the select policy of these tables, private.can_access_takeoff_scope); no row for any other
--    caller (a service role session has no member).
--
-- An answer as the readers give it: its facts, its primary reason, its revision (the digest of the raw answer: it never
-- changes, a later reading is another answer) and its observations in order.
create function private.takeoff_item_answer_document(p_answer public.takeoff_item_answers)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('answer_id', p_answer.id, 'job_id', p_answer.job_id, 'item_id', p_answer.item_id,
    'list_revision_id', p_answer.list_revision_id, 'plan_file_id', p_answer.plan_file_id,
    'plan_logical_id', p_answer.plan_logical_id, 'plan_generation', p_answer.plan_generation, 'outcome', p_answer.outcome,
    'quantity', p_answer.quantity, 'unit', p_answer.unit, 'candidate_quantity', p_answer.candidate_quantity,
    'candidate_unit', p_answer.candidate_unit, 'searched_pages', p_answer.searched_pages,
    'unreadable_pages', p_answer.unreadable_pages, 'reasons', p_answer.reasons, 'reason_code', p_answer.reason_code,
    'reason_text', p_answer.reasons #>> '{0,text}', 'revision', p_answer.content_sha256,
    'reading_revision', p_answer.reading_revision, 'replaces_answer_id', p_answer.replaces_answer_id,
    'published_at', p_answer.published_at,
    'observations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('observation_id', o.id,
        'ordinal', o.ordinal, 'role', o.role, 'source', o.source, 'page', o.page, 'quantity', o.quantity, 'unit', o.unit,
        'measurement_basis', o.measurement_basis, 'evidence', o.evidence, 'confidence', o.confidence, 'method', o.method,
        'chunk_id', o.chunk_id, 'vector_item_id', o.vector_item_id, 'takeoff_item_id', o.takeoff_item_id,
        'occurrence_coverage', o.occurrence_coverage) order by o.ordinal)
      from public.takeoff_item_answer_observations o where o.answer_id = p_answer.id), '[]'::jsonb))
$$;

-- The (item, plan) pairs the affaire's jobs were asked about, from each request's sealed order (its list revision and
-- its unit's plan), before any answer exists: for each pair the latest job asked (its unit's state) and the current
-- answer of the item on that plan (the greatest reading_revision), whichever job gave it. A pair is answered when its
-- latest job is no longer queued or read and an answer exists; in flight while that job is queued or read; ended
-- otherwise (its job failed, was cancelled or never started, and no reading of the item on that plan exists).
create function private.takeoff_item_reading_pairs(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, plan_logical_id uuid, plan_file_id uuid, plan_name text, plan_generation text, job_id uuid,
  unit_state text, reading text, answer_id uuid, outcome text)
language sql stable security definer set search_path = '' as $$
  with asked as (
    select distinct on (e.item_id, p.logical_id) e.item_id, p.logical_id, p.plan_file_id, p.name, p.generation, j.id as job_id,
      private.takeoff_unit_state(j.status::text, j.analysis_outcome, j.error_code, j.started_at) as unit_state
    from public.takeoff_jobs j
    join public.takeoff_launch_requests r on r.id = j.launch_request_id and r.tenant_id = j.tenant_id
      and r.project_id = j.project_id
    cross join lateral private.takeoff_item_answer_plans(r.manifest, private.takeoff_launch_unit(r.manifest, j.launch_unit_key)) p
    join public.takeoff_list_revision_entries e on e.revision_id = r.item_list_revision_id
    where j.tenant_id = p_tenant_id and j.project_id = p_project_id and r.item_list_revision_id is not null
      and p.logical_id is not null and (p_plan_logical_id is null or p.logical_id = p_plan_logical_id)
    order by e.item_id, p.logical_id, j.created_at desc, j.id desc
  )
  select a.item_id, a.logical_id, a.plan_file_id, a.name, a.generation, a.job_id, a.unit_state,
    case when a.unit_state in ('queued', 'running') then 'in_flight' when head.id is not null then 'answered' else 'ended' end,
    head.id, head.outcome
  from asked a
  left join lateral (select h.id, h.outcome from public.takeoff_item_answers h
    where h.tenant_id = p_tenant_id and h.project_id = p_project_id and h.item_id = a.item_id
      and h.plan_logical_id = a.logical_id
    order by h.reading_revision desc limit 1) head on true
$$;

-- Each item of the affaire's latest list revision, in its order, with the state its readings make (lot 4, section 3.2 of
-- its specification): to_measure when no plan was asked about it; at full coverage, uncertain when one answer is,
-- measured when one answer is, not_found otherwise; reading while a plan is still queued or read; failed when no plan
-- answered; incomplete when some did. Optionally on one plan only.
create function private.takeoff_item_reading_states(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
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
    case when c.expected = 0 then 'to_measure'
      when c.answered = c.expected then case when c.uncertain > 0 then 'uncertain' when c.measured > 0 then 'measured'
        else 'not_found' end
      when c.in_flight > 0 then 'reading'
      when c.answered = 0 then 'failed'
      else 'incomplete' end,
    c.expected, c.answered, c.in_flight, c.ended
  from counts c
$$;

-- The table's page: the items of the latest list revision in their order, those in the states asked (all by default),
-- from an offset, each with its state, its coverage, the number of items that match, and its readings: one per plan
-- asked, with the plan's identity, name and generation, the latest job asked and its unit's state, and the current
-- answer (null while none exists).
create function public.read_takeoff_item_readings(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid default null,
  p_states text[] default null, p_offset integer default 0, p_limit integer default 100)
returns table (item_id uuid, item_position integer, state text, expected integer, answered integer, in_flight integer,
  ended integer, matching_items integer, readings jsonb)
language sql stable security definer set search_path = '' as $$
  with page as materialized (
    select s.*, (count(*) over ())::integer as matching_items
    from private.takeoff_item_reading_states(p_tenant_id, p_project_id, p_plan_logical_id) s
    where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
      and (p_states is null or s.state = any (p_states))
    order by s.item_position
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), pairs as materialized (
    select p.* from private.takeoff_item_reading_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p
    where exists (select 1 from page where page.item_id = p.item_id)
  )
  select page.item_id, page.item_position, page.state, page.expected, page.answered, page.in_flight, page.ended,
    page.matching_items,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('plan_logical_id', p.plan_logical_id,
        'plan_file_id', p.plan_file_id, 'plan_name', p.plan_name, 'plan_generation', p.plan_generation, 'job_id', p.job_id,
        'unit_state', p.unit_state, 'reading', p.reading,
        'answer', (select private.takeoff_item_answer_document(a) from public.takeoff_item_answers a where a.id = p.answer_id))
        order by p.plan_name, p.plan_logical_id)
      from pairs p where p.item_id = page.item_id), '[]'::jsonb)
  from page
  order by page.item_position
$$;

-- The number of items of the latest list revision in each state, for the table's filters (optionally on one plan).
create function public.count_takeoff_item_readings(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid default null)
returns table (state text, items integer)
language sql stable security definer set search_path = '' as $$
  select s.state, count(*)::integer
  from private.takeoff_item_reading_states(p_tenant_id, p_project_id, p_plan_logical_id) s
  where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
  group by s.state
  order by s.state
$$;

-- Every answer of an affaire, the replaced ones too, paged in a stable order (item, plan, reading) after the position
-- given; optionally one job's answers, the current readings only, one answer by its id (an old link shows that
-- reading's own evidence, replaced or not), or the answer a takeoff_items row contributes to (an old link to a row, or
-- to an estimate line through the row its provenance names, opens that item).
create function public.read_takeoff_item_answers(p_tenant_id uuid, p_project_id uuid, p_job_id uuid default null,
  p_current_only boolean default false, p_after_item_id uuid default null, p_after_plan_logical_id uuid default null,
  p_after_reading_revision integer default null, p_limit integer default 200, p_answer_id uuid default null,
  p_takeoff_item_id uuid default null)
returns table (answer_id uuid, item_id uuid, plan_logical_id uuid, reading_revision integer, is_current boolean, answer jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.item_id, a.plan_logical_id, a.reading_revision, not later.exists_later,
    private.takeoff_item_answer_document(a)
  from public.takeoff_item_answers a
  cross join lateral (select exists (select 1 from public.takeoff_item_answers n
      where n.tenant_id = a.tenant_id and n.project_id = a.project_id and n.item_id = a.item_id
        and n.plan_logical_id = a.plan_logical_id and n.reading_revision > a.reading_revision) as exists_later) later
  where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
    and a.tenant_id = p_tenant_id and a.project_id = p_project_id
    and (p_job_id is null or a.job_id = p_job_id)
    and (p_answer_id is null or a.id = p_answer_id)
    and (p_takeoff_item_id is null or exists (select 1 from public.takeoff_item_answer_observations o
      where o.answer_id = a.id and o.takeoff_item_id = p_takeoff_item_id))
    and (not coalesce(p_current_only, false) or not later.exists_later)
    and (p_after_item_id is null
      or (a.item_id, a.plan_logical_id, a.reading_revision) > (p_after_item_id, p_after_plan_logical_id, p_after_reading_revision))
  order by a.item_id, a.plan_logical_id, a.reading_revision
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

do $$
declare
  routine text;
begin
  foreach routine in array array['private.takeoff_item_answer_document(public.takeoff_item_answers)',
    'private.takeoff_item_reading_pairs(uuid, uuid, uuid)', 'private.takeoff_item_reading_states(uuid, uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', routine);
  end loop;
  foreach routine in array array['public.read_takeoff_item_readings(uuid, uuid, uuid, text[], integer, integer)',
    'public.count_takeoff_item_readings(uuid, uuid, uuid)',
    'public.read_takeoff_item_answers(uuid, uuid, uuid, boolean, uuid, uuid, integer, integer, uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, service_role', routine);
    execute format('grant execute on function %s to authenticated', routine);
  end loop;
end;
$$;

commit;
