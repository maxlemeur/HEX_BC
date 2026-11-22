-- Lot 4, PR 4b: a request may ask part of the list, and a member may measure a selection of items again.
--
-- 1. The rule of « asked ». A sealed order of the item list may now name the items it asks: one more key in its list,
--    asked_item_ids (a JSON array of entries of the sealed revision, never empty, each once, in their canonical order,
--    at most 1,000). Without it, every entry of the revision is asked: every request stored today, and every launch but a
--    new measure of a selection, which alone writes the key. item_count stays the revision's count. One function says
--    what a request asks, private.takeoff_request_asked_items; every reader of « the items of the request » goes through
--    it:
--    - private.takeoff_item_reading_pairs (20261122080845_takeoff_item_answers.sql, its only body): a pair (item, plan)
--      exists only where a request asked that item on that plan, and its latest job is the latest of those that asked
--      it. While a new measure of a selection runs, only its items read « in flight » on its plans; an item it does not
--      ask keeps its pair, its current answer and its decision; an item no request asked on a plan has no pair there.
--      The current reading of an item on a plan stays the greatest reading_revision. B2's readers
--      (private.takeoff_item_table_pairs, private.takeoff_item_table_lines, private.takeoff_item_reading_states) count
--      and decide from these pairs and the latest revision's entries: they have no notion of « asked » of their own.
--    - private.takeoff_item_answers_refusal (20261122080845, its only body): a publication answers exactly what its
--      request asked, one answer per asked item; an answer for an item not asked is refused as an unknown one
--      (TAKEOFF_ANSWERS_ITEM_FOREIGN), a missing one as before (TAKEOFF_ANSWERS_ITEM_MISSING); nothing is written.
--      public.publish_takeoff_item_answers (20261122113611) only calls it and is not replaced.
--    - private.assert_takeoff_launch_order (20261122113611_takeoff_item_answers_before_activation.sql, its latest body):
--      the seal admits the key in the shape above wherever it appears and refuses any other.
-- 2. The admission of a new measure of a selection, beside the launch commands (which it calls and does not replace):
--    public.launch_takeoff_item_remeasure, for the server only. The member who confirms pays on their own subscription;
--    the request reads the affaire's current confirmed preparation, plan by plan, the selected items only. It is
--    refused unless one analysis per plan and the item-list order are both active (both activation tables are empty).
--    Under its locks it compares the selection with what is stored now: the list's latest revision and, for each item,
--    its current answers on the request's plans; a selection made on a reading since replaced is stale, nothing is
--    admitted and the items are named. Then private.launch_manual_takeoff_command (20261122030312_takeoff_partial_send.sql)
--    admits it as a re-reading of the plans it names, with its own command digest (the payer, the plans, the items and
--    the sealed setting): the same confirmation answers what it answered, another under its key is a conflict, a
--    running analysis of the affaire answers already_running (#451's rule, unchanged).
--    Locks, in the order of every takeoff function: the affaire's row (for share, as a launch takes it), the affaire's
--    review key takeoff-item-review:<affaire> (where the selection is compared, as the review command takes it), then
--    those of the launch command (the job it replaces, for key share; the affaire's launch key; its automatic request;
--    the dossier key; the list key at the seal; the rows it writes).
--
-- What the previous application version sees: nothing changes. No request it writes carries asked_item_ids, so every
-- request asks every entry of its revision as before (the pairs, the refusal and the seal give the same answers); the new
-- function is called by no released application. No table, column, index, trigger or policy changes.
--
-- Locks while applying: replacing and creating functions takes no table lock; lock_timeout bounds the catalog writes.
-- Nothing needs to be drained.
begin;

set local lock_timeout = '5s';
-- Bodies are validated when they first run (the database tests run every one), as the migrations before this one do.
set local check_function_bodies = off;

-- 1. What a request asks: the items its sealed order names, else every entry of its revision. A request without a list
--    asks nothing.
create function private.takeoff_request_asked_items(p_request public.takeoff_launch_requests)
returns table (item_id uuid) language sql stable set search_path = '' as $$
  select e.item_id from public.takeoff_list_revision_entries e
  where e.revision_id = p_request.item_list_revision_id
    and (not coalesce(p_request.manifest #> '{order,list}' ? 'asked_item_ids', false)
      or e.item_id in (select (a.value #>> '{}')::uuid
        from pg_catalog.jsonb_array_elements(p_request.manifest #> '{order,list,asked_item_ids}') a(value)))
$$;
revoke all on function private.takeoff_request_asked_items(public.takeoff_launch_requests) from public, anon, authenticated, service_role;

-- From 20261122080845_takeoff_item_answers.sql (its only body): the pairs of the items each request asked
-- (private.takeoff_request_asked_items), no longer every entry of its revision.
create or replace function private.takeoff_item_reading_pairs(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
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
    cross join lateral private.takeoff_request_asked_items(r) e
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

-- From 20261122080845_takeoff_item_answers.sql (its only body): the coverage of a publication is what its request asked.
create or replace function private.takeoff_item_answers_refusal(p_request public.takeoff_launch_requests, p_unit jsonb, p_pages integer[],
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
  -- Coverage: two answers for one item, an answer for an item the request did not ask, an asked item without its answer.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a group by a.item_id having count(*) > 1) then
    return 'TAKEOFF_ANSWERS_ITEM_DUPLICATE';
  end if;
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      where not exists (select 1 from private.takeoff_request_asked_items(p_request) e where e.item_id = a.item_id)) then
    return 'TAKEOFF_ANSWERS_ITEM_FOREIGN';
  end if;
  if (select count(*) from private.takeoff_request_asked_items(p_request)) <> pg_catalog.jsonb_array_length(p_answers) then
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
  -- Observations: a contribution belongs to a measured answer, has its quantity and unit and names its row of the
  -- result (the row the existing readers count); only a contribution names one; a vector observation is never a contribution, has the vector method and names a vector row of this
  -- publication on its page; a model observation names none.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
      where (o.value ->> 'role' = 'contribution' and (a.outcome <> 'measured' or o.value -> 'quantity' is null
          or o.value -> 'quantity' = 'null'::jsonb or o.value -> 'unit' is null or o.value -> 'unit' = 'null'::jsonb
          or o.value ->> 'takeoff_item_id' is null))
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
  -- Every row the result writes is the takeoff_items row of exactly one contribution, with its quantity and page (its
  -- unit is the worker's normalized code of the contribution's; the row keeps the quantity to the thousandth, the
  -- observation as read).
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
        or (item.value ->> 'source_page')::numeric::integer <> (o.value ->> 'page')::numeric::integer)) then
    return 'TAKEOFF_ANSWERS_OBSERVATION_INVALID';
  end if;
  return null;
end;
$$;

-- From 20261122113611_takeoff_item_answers_before_activation.sql (its latest body): the items asked, when named.
create or replace function private.assert_takeoff_launch_order(p_request public.takeoff_launch_requests, p_manifest jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  sealed public.takeoff_list_revisions%rowtype;
  list jsonb := p_manifest #> '{order,list}';
begin
  if p_manifest #>> '{order,kind}' = 'free_extraction' and p_manifest #> '{order,version}' = '1'::jsonb
    and coalesce(list, 'null'::jsonb) = 'null'::jsonb then
    return null;
  end if;
  if p_manifest #>> '{order,kind}' is distinct from 'item_list' or p_manifest #> '{order,version}' is distinct from '2'::jsonb
    or not private.takeoff_item_list_order_active() or jsonb_typeof(list) is distinct from 'object'
    or (list - array['revision_id', 'revision', 'content_sha256', 'item_count', 'asked_item_ids']) <> '{}'::jsonb
    or coalesce(list ->> 'revision_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    -- A list is read plan by plan (format 2): a grouped job (format 1) could never publish its answers.
    or p_manifest -> 'format_version' is distinct from '2'::jsonb
    or jsonb_typeof(p_manifest -> 'units') is distinct from 'array' then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  -- Each unit's one plan with its identity, its digest and the pages it reads (those retained, else its page count), as
  -- the publication of its answers reads them (private.takeoff_item_answer_plans): known before anything is paid.
  if exists (select 1 from jsonb_array_elements(p_manifest -> 'units') u(value)
      where (select count(*) from private.takeoff_item_answer_plans(p_manifest, u.value) p
          where p.plan_file_id is not null and p.logical_id is not null and p.content_sha256 is not null
            and p.pages is not null) <> 1
        or (select count(*) from private.takeoff_item_answer_plans(p_manifest, u.value)) <> 1) then
    raise exception 'TAKEOFF_LAUNCH_PLAN_PAGES_UNKNOWN' using errcode = '22023';
  end if;
  select * into sealed from public.takeoff_list_revisions r
  where r.id = (list ->> 'revision_id')::uuid and r.tenant_id = p_request.tenant_id and r.project_id = p_request.project_id;
  if not found or list -> 'revision' is distinct from pg_catalog.to_jsonb(sealed.revision)
    or list ->> 'content_sha256' is distinct from sealed.content_sha256
    or list -> 'item_count' is distinct from pg_catalog.to_jsonb(sealed.item_count) then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  -- The items asked, when the order names some (a new measure of a selection): at least one and at most 1,000 entries
  -- of the sealed revision, each once, in their canonical order (by identifier, as lower-case text). Absent, every entry
  -- of the revision is asked.
  if list ? 'asked_item_ids' and (jsonb_typeof(list -> 'asked_item_ids') is distinct from 'array'
      or jsonb_array_length(list -> 'asked_item_ids') not between 1 and 1000
      or exists (select 1 from jsonb_array_elements(list -> 'asked_item_ids') a(value)
        where jsonb_typeof(a.value) is distinct from 'string'
          or a.value #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or list -> 'asked_item_ids' is distinct from (select jsonb_agg(d.id::text order by d.id)
        from (select distinct (a.value #>> '{}')::uuid as id from jsonb_array_elements(list -> 'asked_item_ids') a(value)) d)
      or exists (select 1 from jsonb_array_elements(list -> 'asked_item_ids') a(value)
        where not exists (select 1 from public.takeoff_list_revision_entries e
          where e.revision_id = sealed.id and e.item_id = (a.value #>> '{}')::uuid))) then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  perform private.lock_takeoff_item_list(p_request.project_id);
  if exists (select 1 from public.takeoff_list_revisions r where r.tenant_id = p_request.tenant_id
      and r.project_id = p_request.project_id and r.revision > sealed.revision) then
    raise exception 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' using errcode = '40001';
  end if;
  return sealed.id;
end;
$$;

-- 2. A new measure of a selection. The server builds the manifest (format 2, the plans named, its order sealing the
--    items asked), the jobs and the targets (each selected item with its current answers on the request's plans, as the
--    member saw them); p_predecessor_job_id is the analysis it re-reads (a job of the affaire). Answers admitted,
--    replayed or already_running as a launch does, or stale with the items whose reading changed (nothing written).
--    Refuses: TAKEOFF_ITEM_REMEASURE_INVALID (a malformed command), TAKEOFF_ITEM_REMEASURE_INACTIVE (one analysis per
--    plan or the item-list order not active), TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE (the member may not launch on this
--    affaire), and what a launch refuses (its seal, its plans, its payer, its automatic start).
create function private.takeoff_item_remeasure_digest(p_actor uuid, p_predecessor_job_id uuid, p_plan_set_id uuid,
  p_preparation_revision integer, p_plan_file_ids uuid[], p_asked jsonb, p_selection jsonb)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array('takeoff-item-remeasure', 1,
    p_actor, p_predecessor_job_id, p_plan_set_id, p_preparation_revision,
    (select coalesce(pg_catalog.jsonb_agg(distinct p order by p), '[]'::jsonb) from pg_catalog.unnest(p_plan_file_ids) p),
    p_asked, p_selection)::text, 'UTF8')), 'hex')
$$;
revoke all on function private.takeoff_item_remeasure_digest(uuid, uuid, uuid, integer, uuid[], jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.launch_takeoff_item_remeasure(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_predecessor_job_id uuid, p_host text,
  p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_jobs jsonb, p_plan_set_id uuid, p_preparation_revision integer,
  p_plan_file_ids uuid[], p_targets jsonb, p_module_default boolean default false
) returns table (outcome text, request_id uuid, job_id uuid, stale uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  asked jsonb := p_manifest #> '{order,list,asked_item_ids}';
  uuid_text constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  digest text;
  answer record;
  plans uuid[];
  stale_items uuid[];
begin
  -- A command of format 2 on the plans it names, each with its logical identity, whose order seals the items it asks:
  -- exactly those of its targets, in the canonical order; each target names its current answers as the member saw them.
  if p_manifest -> 'format_version' is distinct from '2'::jsonb or p_intent_key is null or p_actor is null
    or p_predecessor_job_id is null or p_plan_file_ids is null or coalesce(pg_catalog.array_length(p_plan_file_ids, 1), 0) = 0
    or (select pg_catalog.array_agg(p::text order by p::text) from pg_catalog.unnest(p_plan_file_ids) p)
      is distinct from (select pg_catalog.array_agg(e.value ->> 'entry_key' order by e.value ->> 'entry_key')
        from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value)
      where coalesce(e.value ->> 'logical_id', '') !~ uuid_text)
    or coalesce(p_manifest #>> '{order,list,revision_id}', '') !~ uuid_text
    or pg_catalog.jsonb_typeof(asked) is distinct from 'array' or pg_catalog.jsonb_typeof(p_targets) is distinct from 'array'
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_targets) t(value)
      where pg_catalog.jsonb_typeof(t.value) is distinct from 'object'
        or not private.takeoff_item_answer_is_uuid(t.value -> 'item_id')
        or pg_catalog.jsonb_typeof(t.value -> 'answers') is distinct from 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value)
          where not private.takeoff_item_answer_is_uuid(a.value)))
    or asked is distinct from (select pg_catalog.jsonb_agg(((t.value ->> 'item_id')::uuid)::text order by (t.value ->> 'item_id')::uuid)
      from pg_catalog.jsonb_array_elements(p_targets) t(value)) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  if not (private.takeoff_plan_dispatch_active() and private.takeoff_item_list_order_active()) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INACTIVE' using errcode = '55000';
  end if;
  -- The affaire's row, shared, first, as a launch takes it; then the affaire's review key, where the selection is
  -- compared (a bulk review of the same items passes before or after, never in between).
  perform 1 from public.estimate_projects as project_row
  where project_row.id = p_project_id and project_row.tenant_id = p_tenant_id for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-review:' || p_project_id::text, 0));
  digest := private.takeoff_item_remeasure_digest(p_actor, p_predecessor_job_id, p_plan_set_id, p_preparation_revision,
    p_plan_file_ids, asked, p_selection);
  -- The same confirmation answers what it answered, whatever changed since; another under its key is a conflict.
  for answer in select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key, digest) loop
    return query select answer.outcome, answer.request_id, answer.job_id, null::uuid[];
    return;
  end loop;
  if not coalesce(private.takeoff_item_list_writer(p_tenant_id, p_project_id, p_actor), false) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  -- Compare-and-set, under the locks: the list's latest revision is the one sealed, and each item's current answers on
  -- the request's plans are those the member saw. A reading published since makes the selection stale.
  plans := array(select (e.value ->> 'logical_id')::uuid from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value));
  if (select r.id from public.takeoff_list_revisions r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
      order by r.revision desc limit 1) is distinct from (p_manifest #>> '{order,list,revision_id}')::uuid then
    stale_items := array(select (t.value ->> 'item_id')::uuid as id from pg_catalog.jsonb_array_elements(p_targets) t(value)
      order by 1);
  else
    with seen as (
      select (t.value ->> 'item_id')::uuid as item_id,
        coalesce((select pg_catalog.array_agg((a.value #>> '{}')::uuid order by (a.value #>> '{}')::uuid)
          from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value)), '{}'::uuid[]) as answers
      from pg_catalog.jsonb_array_elements(p_targets) t(value)
    ), current_answers as (
      select p.item_id, pg_catalog.array_agg(p.answer_id order by p.answer_id) as answers
      from private.takeoff_item_reading_pairs(p_tenant_id, p_project_id, null) p
      where p.plan_logical_id = any (plans) and p.answer_id is not null and p.item_id in (select s.item_id from seen s)
      group by p.item_id
    )
    select pg_catalog.array_agg(s.item_id order by s.item_id) into stale_items
    from seen s left join current_answers c on c.item_id = s.item_id
    where coalesce(c.answers, '{}'::uuid[]) is distinct from s.answers;
  end if;
  if coalesce(pg_catalog.cardinality(stale_items), 0) > 0 then
    return query select 'stale'::text, null::uuid, null::uuid, stale_items;
    return;
  end if;
  return query select launched.outcome, launched.request_id, launched.job_id, null::uuid[]
  from private.launch_manual_takeoff_command(p_tenant_id, p_project_id, p_actor, p_intent_key, 'reread_plans',
    p_predecessor_job_id, p_host, p_selection, p_manifest, p_snapshot, p_jobs, p_plan_set_id, p_preparation_revision,
    p_module_default, digest, true) as launched;
end;
$$;
revoke all on function public.launch_takeoff_item_remeasure(uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid,
  integer, uuid[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.launch_takeoff_item_remeasure(uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid,
  integer, uuid[], jsonb, boolean) to service_role;

commit;
