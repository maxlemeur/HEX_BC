-- Lot 4, PR 4b: a request may ask part of the list, and a member may measure a selection of items again.
--
-- 1. The rule of « asked ». A sealed order of the item list may now name the items it asks: one more key in its list,
--    asked_item_ids (a JSON array of entries of the sealed revision, never empty, each once, in their canonical order,
--    at most 1,000). Without it, every entry of the revision is asked: every request stored today, and every launch but a
--    new measure of a selection, which alone may seal the key. item_count stays the revision's count. One function says
--    what a request asks, private.takeoff_request_asked_items; the readers below call it for a request that names its
--    items, and read the revision's entries directly, as before, for one that does not (the cost of every request
--    stored today is unchanged):
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
--      the seal admits the key in the shape above, and only inside the admission of a new measure of a selection (the
--      marker mergeone.takeoff_item_remeasure that this admission alone sets, to the request's intention key, around its
--      launch); any other seal that carries it is refused, whichever admission it is (manual or automatic). The marker is
--      a custom setting: no member can set it (no grant reaches the launch, the seal or this admission, and no setter is
--      exposed), but another function running in the same transaction could; that is its boundary, as for the marker
--      that guards the insert of a request's jobs (mergeone.takeoff_request_admission).
-- 2. The admission of a new measure of a selection, beside the launch commands (which it calls and does not replace):
--    public.launch_takeoff_item_remeasure, for the server only. The member who confirms pays on their own subscription;
--    the request reads the affaire's current confirmed preparation, plan by plan, the selected items only. It is
--    refused unless one analysis per plan and the item-list order are both active (both activation tables are empty).
--    In this order:
--    - the whole command is checked before anything is read or recorded (its plans, the items asked, each an entry of
--      the revision sealed, the targets: each item once, at most 1,000, each target's answers once, the confirmation);
--    - its locks, in the order of every takeoff function: the affaire's row (for share, waited for, as a launch takes it;
--      an affaire deleted meanwhile is answered as such), then the affaire's preparation row (for share, never waited
--      for: a preparation being modified is refused, nothing written, to be confirmed again; held from there, an edit or
--      the deletion of the draft affaire that arrives after waits for the admission, holding nothing it needs), the
--      affaire's review key takeoff-item-review:<affaire> (where the selection is compared, as the review command takes
--      it), then those of the launch command: the job it replaces (for key share), the affaire's launch key, its
--      automatic request, the list key at the seal, the rows it writes, and last the dossier key when an automatic start
--      is open;
--    - the member's right to launch on the affaire, before any answer, a replayed one included;
--    - each plan's logical identity is the one this database recorded for its file (takeoff_plan_location_sources: its
--      dossier piece, else the file itself), never the caller's;
--    - the command digest: what the member confirmed — the payer, the plans, the list revision sealed, each item with
--      the answers the member saw, the sealed setting, and the confirmation (the preview's digest, the setting chosen).
--      The same confirmation answers what it answered; another under its key is a conflict. The server's first step
--      replays a confirmation by these values alone (public.replay_takeoff_item_remeasure), before it plans anything;
--    - the preparation: stored, confirmed at the revision the command names, and each plan the command reads is a plan
--      it confirmed, with the same file, name, pages, page count and digest of its bytes; a plan read whole is counted
--      the pages stored for it, when they are;
--    - compare-and-set: the list's latest revision is the one sealed, and each item's current answers on the request's
--      plans are those the member saw; a selection made on a reading since replaced is stale, nothing is admitted and
--      the items are named;
--    - private.launch_manual_takeoff_command (20261122030312_takeoff_partial_send.sql) admits it as a re-reading of the
--      plans it names: a running analysis of the affaire answers already_running (#451's rule, unchanged). Once it
--      admitted, the same comparison again: a reading still running at the first comparison that published and ended
--      before the launch looked for a running analysis is seen there. A list revision recorded while the admission
--      waited at the seal is seen as the seal's refusal. Either way the admission is undone (nothing of it kept, no
--      receipt) and it answers stale with the items, as a confirmation started after them would.
--
-- What the previous application version sees: nothing changes. No request it writes carries asked_item_ids, so every
-- request asks every entry of its revision as before (the pairs, the refusal and the seal give the same answers, through
-- the same statements); the new functions are called by no released application. No table, column, index, trigger or
-- policy changes.
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
-- (private.takeoff_request_asked_items when its order names them), no longer every entry of its revision. A request that
-- names none reads its revision's entries as before, the function never called for it.
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
    cross join lateral (
      select every.item_id from public.takeoff_list_revision_entries every
      where every.revision_id = r.item_list_revision_id
        and not coalesce(r.manifest #> '{order,list}' ? 'asked_item_ids', false)
      union all
      select named.item_id from private.takeoff_request_asked_items(r) named
      where coalesce(r.manifest #> '{order,list}' ? 'asked_item_ids', false)) e
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

-- From 20261122080845_takeoff_item_answers.sql (its only body): the coverage of a publication is what its request asked
-- (the items its order names, read once; a request that names none, every entry of its revision, as before).
create or replace function private.takeoff_item_answers_refusal(p_request public.takeoff_launch_requests, p_unit jsonb, p_pages integer[],
  p_items jsonb, p_answers jsonb, p_findings jsonb, p_vector jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  plan record;
  plan_count integer;
  asked uuid[];
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
  if coalesce(p_request.manifest #> '{order,list}' ? 'asked_item_ids', false) then
    asked := array(select e.item_id from private.takeoff_request_asked_items(p_request) e);
    if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a where not (a.item_id = any (asked))) then
      return 'TAKEOFF_ANSWERS_ITEM_FOREIGN';
    end if;
    if pg_catalog.cardinality(asked) <> pg_catalog.jsonb_array_length(p_answers) then
      return 'TAKEOFF_ANSWERS_ITEM_MISSING';
    end if;
  else
    if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
        where not exists (select 1 from public.takeoff_list_revision_entries e
          where e.revision_id = p_request.item_list_revision_id and e.item_id = a.item_id)) then
      return 'TAKEOFF_ANSWERS_ITEM_FOREIGN';
    end if;
    if (select count(*) from public.takeoff_list_revision_entries e where e.revision_id = p_request.item_list_revision_id)
        <> pg_catalog.jsonb_array_length(p_answers) then
      return 'TAKEOFF_ANSWERS_ITEM_MISSING';
    end if;
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
  -- The items asked, when the order names some: only inside the admission of a new measure of a selection (its marker,
  -- set by public.launch_takeoff_item_remeasure alone, names this request's intention key), at least one and at most
  -- 1,000 entries of the sealed revision, each once, in their canonical order (by identifier, as lower-case text).
  -- Absent, every entry of the revision is asked.
  if list ? 'asked_item_ids' and (
      nullif(pg_catalog.current_setting('mergeone.takeoff_item_remeasure', true), '') is distinct from p_request.intent_key::text
      or jsonb_typeof(list -> 'asked_item_ids') is distinct from 'array'
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
--    items asked), the snapshot (the confirmed preparation reading those plans), the jobs and the targets (each selected
--    item with its current answers on the request's plans, as the member saw them); p_predecessor_job_id is the analysis
--    it re-reads (a job of the affaire). Answers admitted, replayed or already_running as a launch does, or stale with
--    the items whose reading changed (nothing written).
--    Refuses: TAKEOFF_ITEM_REMEASURE_INVALID (a malformed command, or a plan named with another identity than its
--    file's), TAKEOFF_ITEM_REMEASURE_INACTIVE (one analysis per plan or the item-list order not active),
--    TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE (the member may not launch on this affaire, whatever was answered before),
--    TAKEOFF_LAUNCH_SEAL_INVALID (a preparation other than the one confirmed now), TAKEOFF_LAUNCH_INTENT_CONFLICT
--    (another confirmation under the same key), and what a launch refuses (its seal, its plans, its payer, its
--    automatic start).
-- The targets of a confirmation, as the member saw them: 1 to 1,000 items, each once, each naming its current answers
-- on the request's plans (at most one per plan, each once).
create function private.takeoff_item_remeasure_targets_valid(p_targets jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_targets) = 'array' and pg_catalog.jsonb_array_length(p_targets) between 1 and 1000
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_targets) t(value)
      where pg_catalog.jsonb_typeof(t.value) is distinct from 'object'
        or not private.takeoff_item_answer_is_uuid(t.value -> 'item_id')
        or pg_catalog.jsonb_typeof(t.value -> 'answers') is distinct from 'array'
        or pg_catalog.jsonb_array_length(t.value -> 'answers') > 20
        or exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value)
          where not private.takeoff_item_answer_is_uuid(a.value))
        or (select count(distinct (a.value #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value))
          <> pg_catalog.jsonb_array_length(t.value -> 'answers'))
    and (select count(distinct (t.value ->> 'item_id')::uuid) from pg_catalog.jsonb_array_elements(p_targets) t(value))
      = pg_catalog.jsonb_array_length(p_targets), false)
$$;
revoke all on function private.takeoff_item_remeasure_targets_valid(jsonb) from public, anon, authenticated, service_role;

-- What the member confirmed besides the readings: the digest of the preview confirmed (the server's, of the payer and the
-- setting, the plans, the items and their readings, the calls and the budget) and the setting chosen for this request
-- alone (null: the profile's).
create function private.takeoff_item_remeasure_confirmation_valid(p_confirmation jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_confirmation) = 'object'
    and (p_confirmation - array['preview_digest', 'setting']) = '{}'::jsonb
    and coalesce(p_confirmation ->> 'preview_digest', '') ~ '^[0-9a-f]{64}$'
    and (coalesce(p_confirmation -> 'setting', 'null'::jsonb) = 'null'::jsonb
      or (pg_catalog.jsonb_typeof(p_confirmation -> 'setting') = 'object'
        and ((p_confirmation -> 'setting') - 'reasoning_effort') = '{}'::jsonb
        and pg_catalog.jsonb_typeof(p_confirmation #> '{setting,reasoning_effort}') in ('string', 'null'))), false)
$$;
revoke all on function private.takeoff_item_remeasure_confirmation_valid(jsonb) from public, anon, authenticated, service_role;

-- The command digest: everything the member confirmed, in canonical values — the payer, the plans (their keys), the list
-- revision sealed, each item with the answers the member saw (the targets in their order, each item's answers in theirs),
-- the sealed setting, and the confirmation (the preview's digest and the setting chosen). What the server derives (the
-- analysis re-read, the plan set, the preparation's revision) is checked under the locks, never part of the identity: a
-- lost answer sent again is the same confirmation whatever the server read since.
create function private.takeoff_item_remeasure_digest(p_actor uuid, p_plan_keys uuid[], p_list_revision_id uuid, p_targets jsonb,
  p_selection jsonb, p_confirmation jsonb)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array('takeoff-item-remeasure', 3,
    p_actor,
    (select coalesce(pg_catalog.jsonb_agg(distinct p order by p), '[]'::jsonb) from pg_catalog.unnest(p_plan_keys) p),
    p_list_revision_id,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.item_id, t.answers) order by t.item_id), '[]'::jsonb)
      from (select (target.value ->> 'item_id')::uuid as item_id,
          (select coalesce(pg_catalog.jsonb_agg(answer.id order by answer.id), '[]'::jsonb)
            from (select distinct (a.value #>> '{}')::uuid as id
              from pg_catalog.jsonb_array_elements(target.value -> 'answers') a(value)) answer) as answers
        from pg_catalog.jsonb_array_elements(p_targets) target(value)) t),
    p_selection, p_confirmation)::text, 'UTF8')), 'hex')
$$;
revoke all on function private.takeoff_item_remeasure_digest(uuid, uuid[], uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- The items of a selection whose reading is no longer the one the member saw: every item when the list's latest
-- revision is not the one sealed; else each item whose current answers on the request's plans are not those given.
create function private.takeoff_item_remeasure_stale(p_tenant_id uuid, p_project_id uuid, p_manifest jsonb, p_targets jsonb)
returns uuid[] language sql stable set search_path = '' as $$
  with seen as (
    select (t.value ->> 'item_id')::uuid as item_id,
      coalesce((select pg_catalog.array_agg((a.value #>> '{}')::uuid order by (a.value #>> '{}')::uuid)
        from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value)), '{}'::uuid[]) as answers
    from pg_catalog.jsonb_array_elements(p_targets) t(value)
  ), plans as (
    select (e.value ->> 'logical_id')::uuid as logical_id from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value)
  ), current_answers as (
    select p.item_id, pg_catalog.array_agg(p.answer_id order by p.answer_id) as answers
    from private.takeoff_item_reading_pairs(p_tenant_id, p_project_id, null) p
    where p.plan_logical_id in (select plans.logical_id from plans) and p.answer_id is not null
      and p.item_id in (select seen.item_id from seen)
    group by p.item_id
  )
  select case
    when (select r.id from public.takeoff_list_revisions r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
        order by r.revision desc limit 1) is distinct from (p_manifest #>> '{order,list,revision_id}')::uuid
      then (select pg_catalog.array_agg(s.item_id order by s.item_id) from seen s)
    else (select pg_catalog.array_agg(s.item_id order by s.item_id) from seen s left join current_answers c on c.item_id = s.item_id
      where coalesce(c.answers, '{}'::uuid[]) is distinct from s.answers) end
$$;
revoke all on function private.takeoff_item_remeasure_stale(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;

create function public.launch_takeoff_item_remeasure(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_predecessor_job_id uuid, p_host text,
  p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_jobs jsonb, p_plan_set_id uuid, p_preparation_revision integer,
  p_plan_file_ids uuid[], p_targets jsonb, p_confirmation jsonb, p_module_default boolean default false
) returns table (outcome text, request_id uuid, job_id uuid, stale uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  asked jsonb := p_manifest #> '{order,list,asked_item_ids}';
  uuid_text constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  prepared public.takeoff_preparations%rowtype;
  digest text;
  answer record;
  launched record;
  stale_items uuid[];
begin
  -- The whole command, before anything is read or recorded: format 2 on the plans it names (each once, each with its
  -- identity), whose order seals the items it asks (at least one, at most 1,000, each once, in the canonical order),
  -- exactly those of its targets; each target names its current answers as the member saw them, each once.
  if p_manifest -> 'format_version' is distinct from '2'::jsonb or p_intent_key is null or p_actor is null
    or p_predecessor_job_id is null or p_plan_set_id is null or p_preparation_revision is null
    or coalesce(pg_catalog.cardinality(p_plan_file_ids), 0) = 0 or pg_catalog.array_position(p_plan_file_ids, null) is not null
    or (select count(distinct p) from pg_catalog.unnest(p_plan_file_ids) p) <> pg_catalog.cardinality(p_plan_file_ids)
    or pg_catalog.jsonb_typeof(p_manifest -> 'plans') is distinct from 'array'
    or (select pg_catalog.array_agg(p::text order by p::text) from pg_catalog.unnest(p_plan_file_ids) p)
      is distinct from (select pg_catalog.array_agg(pg_catalog.lower(e.value ->> 'entry_key') order by pg_catalog.lower(e.value ->> 'entry_key'))
        from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value)
      where coalesce(e.value ->> 'logical_id', '') !~* uuid_text
        or pg_catalog.lower(e.value ->> 'plan_file_id') is distinct from pg_catalog.lower(e.value ->> 'entry_key'))
    or coalesce(p_manifest #>> '{order,list,revision_id}', '') !~ uuid_text
    or pg_catalog.jsonb_typeof(asked) is distinct from 'array' or pg_catalog.jsonb_array_length(asked) not between 1 and 1000
    or exists (select 1 from pg_catalog.jsonb_array_elements(asked) a(value)
      where pg_catalog.jsonb_typeof(a.value) is distinct from 'string' or a.value #>> '{}' !~ uuid_text)
    or asked is distinct from (select pg_catalog.jsonb_agg(d.id::text order by d.id)
      from (select distinct (a.value #>> '{}')::uuid as id from pg_catalog.jsonb_array_elements(asked) a(value)) d)
    or not private.takeoff_item_remeasure_targets_valid(p_targets)
    or asked is distinct from (select pg_catalog.jsonb_agg(((t.value ->> 'item_id')::uuid)::text order by (t.value ->> 'item_id')::uuid)
      from pg_catalog.jsonb_array_elements(p_targets) t(value))
    or not private.takeoff_item_remeasure_confirmation_valid(p_confirmation) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  -- Each item asked is an entry of the revision the order seals, a revision of this affaire (revisions never change).
  if not exists (select 1 from public.takeoff_list_revisions r where r.id = (p_manifest #>> '{order,list,revision_id}')::uuid
        and r.tenant_id = p_tenant_id and r.project_id = p_project_id)
    or exists (select 1 from pg_catalog.jsonb_array_elements(asked) a(value)
      where not exists (select 1 from public.takeoff_list_revision_entries e
        where e.revision_id = (p_manifest #>> '{order,list,revision_id}')::uuid and e.item_id = (a.value #>> '{}')::uuid)) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  if not (private.takeoff_plan_dispatch_active() and private.takeoff_item_list_order_active()) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INACTIVE' using errcode = '55000';
  end if;
  -- The affaire's row first, shared, waited for, as every launch takes it (rank 2): an affaire deleted meanwhile is gone.
  -- Then the affaire's preparation, shared, without waiting (its edit holds its row, then the affaire's; the deletion of a
  -- draft affaire holds the affaire's, then its cascade needs the preparation's): a preparation being modified is
  -- refused, nothing written, to be confirmed again. Held from here, it is still the one stored when the jobs are
  -- inserted: an edit or a deletion that arrives after waits for this admission, holding nothing it needs. Then the
  -- affaire's review key, where the selection is compared (a bulk review of the same items passes before or after).
  perform 1 from public.estimate_projects as project_row
  where project_row.id = p_project_id and project_row.tenant_id = p_tenant_id for share;
  if not found then
    raise exception 'TAKEOFF_ITEM_REMEASURE_AFFAIRE_NOT_FOUND' using errcode = 'P0002';
  end if;
  begin
    select * into prepared from public.takeoff_preparations as preparation
    where preparation.tenant_id = p_tenant_id and preparation.project_id = p_project_id for share nowait;
  exception when lock_not_available then
    raise exception 'TAKEOFF_ITEM_REMEASURE_PREPARATION_BUSY' using errcode = '55P03';
  end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-review:' || p_project_id::text, 0));
  -- The member's right to launch on the affaire now, before anything is answered: a replay included.
  if not coalesce(private.takeoff_item_list_writer(p_tenant_id, p_project_id, p_actor), false) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  -- Each plan's logical identity is the one recorded for its file in the affaire's plan set (its dossier piece, else the
  -- file itself), never the caller's: an answer published for it replaces that plan's reading and no other.
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value)
      left join public.takeoff_plan_location_sources as recorded
        on recorded.plan_file_id = (e.value ->> 'plan_file_id')::uuid and recorded.tenant_id = p_tenant_id
          and recorded.project_id = p_project_id and recorded.plan_set_id = p_plan_set_id
      where recorded.plan_file_id is null or (e.value ->> 'logical_id')::uuid is distinct from recorded.source_id
        or private.takeoff_uuid_or_null(e.value -> 'intake_document_id')
          is distinct from case when recorded.source_kind = 'intake_document' then recorded.source_id end) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  digest := private.takeoff_item_remeasure_digest(p_actor,
    array(select (e.value ->> 'logical_id')::uuid from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') e(value)),
    (p_manifest #>> '{order,list,revision_id}')::uuid, p_targets, p_selection, p_confirmation);
  -- The same confirmation answers what it answered, whatever changed since; another under its key is a conflict.
  for answer in select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key, digest) loop
    return query select answer.outcome, answer.request_id, answer.job_id, null::uuid[];
    return;
  end loop;
  -- The preparation the command reads is the affaire's, as confirmed now: at the revision it names, each plan it reads
  -- a plan the preparation confirmed, with the same file, name, pages, page count and digest of its bytes (the seal binds
  -- the manifest, its units and the jobs to the command's snapshot; this binds the snapshot to the stored preparation).
  if prepared.project_id is null or prepared.confirmed_snapshot is null or prepared.revision is distinct from p_preparation_revision
    or prepared.confirmed_snapshot -> 'preparation_revision' is distinct from pg_catalog.to_jsonb(p_preparation_revision)
    or pg_catalog.jsonb_typeof(p_snapshot #> '{preparation,sources}') is distinct from 'array'
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_snapshot #> '{preparation,sources}') s(value)
      where s.value ->> 'kind' = 'plan' and s.value -> 'active' = 'true'::jsonb
        and not exists (select 1 from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(prepared.confirmed_snapshot #> '{preparation,sources}') = 'array'
              then prepared.confirmed_snapshot #> '{preparation,sources}' else '[]'::jsonb end) c(value)
          where c.value ->> 'kind' = 'plan' and c.value -> 'active' = 'true'::jsonb
            and c.value ->> 'document_id' = s.value ->> 'document_id'
            and c.value ->> 'plan_set_id' is not distinct from s.value ->> 'plan_set_id'
            and c.value ->> 'file_path' is not distinct from s.value ->> 'file_path'
            and c.value ->> 'document_name' is not distinct from s.value ->> 'document_name'
            and c.value -> 'pages' is not distinct from s.value -> 'pages'
            and c.value -> 'page_count' is not distinct from s.value -> 'page_count'
            and nullif(c.value ->> 'content_hash', '') = s.value ->> 'content_hash'))
    -- A plan read whole: its page count is its coverage; the manifest's is the stored one when one is stored (else the
    -- server counted the PDF, and the worker reads the pages it has).
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_manifest -> 'plans') m(value)
      cross join lateral (select c.value from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(prepared.confirmed_snapshot #> '{preparation,sources}') = 'array'
            then prepared.confirmed_snapshot #> '{preparation,sources}' else '[]'::jsonb end) c(value)
        where c.value ->> 'kind' = 'plan' and c.value ->> 'document_id' = m.value ->> 'entry_key' limit 1) stored
      where coalesce(pg_catalog.jsonb_array_length(m.value -> 'pages'), 0) = 0
        and pg_catalog.jsonb_typeof(stored.value -> 'page_count') = 'number'
        and m.value -> 'page_count' is distinct from stored.value -> 'page_count') then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  -- Compare-and-set, under the locks: the list's latest revision is the one sealed, and each item's current answers on
  -- the request's plans are those the member saw. A reading published since makes the selection stale.
  stale_items := private.takeoff_item_remeasure_stale(p_tenant_id, p_project_id, p_manifest, p_targets);
  if coalesce(pg_catalog.cardinality(stale_items), 0) > 0 then
    return query select 'stale'::text, null::uuid, null::uuid, stale_items;
    return;
  end if;
  -- The launch, under this admission's marker (the only seal that accepts the items asked), then the same comparison
  -- once its locks are held: a reading of the affaire still running when it was compared may have published and ended
  -- before the launch looked for a running analysis (a publication takes its job and its request, not the review key);
  -- a reading that publishes after that was running when the launch looked, and the answer was already_running. A list
  -- revision recorded while the launch waited for the list key at the seal is its refusal (40001), which names the same
  -- items as the comparison now. Either way the admission is undone, its receipt included, and it answers stale.
  begin
    perform pg_catalog.set_config('mergeone.takeoff_item_remeasure', p_intent_key::text, true);
    select l.outcome, l.request_id, l.job_id into launched
    from private.launch_manual_takeoff_command(p_tenant_id, p_project_id, p_actor, p_intent_key, 'reread_plans',
      p_predecessor_job_id, p_host, p_selection, p_manifest, p_snapshot, p_jobs, p_plan_set_id, p_preparation_revision,
      p_module_default, digest, true) as l;
    perform pg_catalog.set_config('mergeone.takeoff_item_remeasure', '', true);
    if launched.outcome = 'admitted' then
      stale_items := private.takeoff_item_remeasure_stale(p_tenant_id, p_project_id, p_manifest, p_targets);
      if coalesce(pg_catalog.cardinality(stale_items), 0) > 0 then
        raise exception 'TAKEOFF_ITEM_REMEASURE_STALE' using errcode = 'TKRMS';
      end if;
    end if;
  exception
    when sqlstate 'TKRMS' then
      return query select 'stale'::text, null::uuid, null::uuid, stale_items;
      return;
    when serialization_failure then
      if sqlerrm is distinct from 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' then
        raise;
      end if;
      stale_items := private.takeoff_item_remeasure_stale(p_tenant_id, p_project_id, p_manifest, p_targets);
      if coalesce(pg_catalog.cardinality(stale_items), 0) = 0 then
        raise;
      end if;
      return query select 'stale'::text, null::uuid, null::uuid, stale_items;
      return;
  end;
  return query select launched.outcome, launched.request_id, launched.job_id, null::uuid[];
end;
$$;
revoke all on function public.launch_takeoff_item_remeasure(uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid,
  integer, uuid[], jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.launch_takeoff_item_remeasure(uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid,
  integer, uuid[], jsonb, jsonb, boolean) to service_role;

-- The replay of a confirmation by what the member confirmed alone, for the server's first step (before it plans anything:
-- a request admitted reads « En lecture » since, and its own reading may have replaced the answers it targets): the
-- member's right now, then the receipt of exactly that confirmation (the same digest as the admission's), or nothing when
-- the key answered nothing yet; another confirmation under the key is TAKEOFF_LAUNCH_INTENT_CONFLICT. Takes no lock:
-- receipts are written once, and a confirmation not yet recorded goes on to the admission, which serializes.
create function public.replay_takeoff_item_remeasure(p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid,
  p_plan_keys uuid[], p_list_revision_id uuid, p_targets jsonb, p_selection jsonb, p_confirmation jsonb)
returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_intent_key is null or p_actor is null or p_list_revision_id is null
    or coalesce(pg_catalog.cardinality(p_plan_keys), 0) = 0 or pg_catalog.array_position(p_plan_keys, null) is not null
    or not private.takeoff_item_remeasure_targets_valid(p_targets)
    or not private.takeoff_item_remeasure_confirmation_valid(p_confirmation)
    or pg_catalog.jsonb_typeof(p_selection) is distinct from 'object' then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  if not coalesce(private.takeoff_item_list_writer(p_tenant_id, p_project_id, p_actor), false) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  return query select r.outcome, r.request_id, r.job_id from private.replay_takeoff_launch_command(p_tenant_id, p_project_id,
    p_intent_key, private.takeoff_item_remeasure_digest(p_actor, p_plan_keys, p_list_revision_id, p_targets, p_selection,
      p_confirmation)) as r;
end;
$$;
revoke all on function public.replay_takeoff_item_remeasure(uuid, uuid, uuid, uuid, uuid[], uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replay_takeoff_item_remeasure(uuid, uuid, uuid, uuid, uuid[], uuid, jsonb, jsonb, jsonb)
  to service_role;

commit;
