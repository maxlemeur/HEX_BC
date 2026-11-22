-- Lot 4, B1's follow-up before the second measuring order can be activated (20261122080845_takeoff_item_answers.sql).
--
-- 1. A contribution's row must be countable: a publication whose contribution names a row that today's readers skip
--    (excluded as given, or as the insert's hypothesis rule would exclude it) is refused with
--    TAKEOFF_ANSWERS_OBSERVATION_INVALID, as a measured answer nobody counts. Rebuilt on the only body of
--    private.takeoff_item_answers_refusal (20261122080845_takeoff_item_answers.sql); nothing else of it changes.
-- 2. A grouped request (format 1) never seals a list: its job could never publish answers plan by plan. The application
--    already seals the free extraction for a grouped request; the database now refuses a list there too
--    (TAKEOFF_LAUNCH_SEAL_INVALID).
-- 3. Each plan's identity, digest and pages are known at the seal of a list: a unit whose plan has neither retained pages
--    nor a page count is refused at the seal, before any call is paid (TAKEOFF_LAUNCH_PLAN_PAGES_UNKNOWN), instead of at
--    its publication (TAKEOFF_ANSWERS_SCOPE_UNKNOWN), with the rule the publication applies.
--    Both in private.assert_takeoff_launch_order, rebuilt on its only body (20261121230719_takeoff_item_lists.sql), which
--    the seals of both formats call (private.assert_takeoff_launch_seal, 20261121231238_takeoff_plan_dispatcher.sql, is
--    not replaced).
--
-- What the previous application version and every first-format request see: nothing. The order check returns at its
-- first statement for the free extraction, as before; the new checks run only for a list, which the seal refuses until
-- the second order is activated (private.takeoff_item_list_order_activation, empty). The refusal function is called only
-- by public.publish_takeoff_item_answers, which no released application calls. No table, column, index, policy, grant
-- or trigger changes; creating the two functions takes no table lock (their bodies are validated at their first call).
begin;

set local lock_timeout = '5s';
set local check_function_bodies = off;

-- 1. The refusals of a publication (20261122080845_takeoff_item_answers.sql), with the countable row of a contribution.
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
  -- Every row the result writes is the countable takeoff_items row of exactly one contribution, with its quantity and
  -- page (its unit is the worker's normalized code of the contribution's; the row keeps the quantity to the thousandth,
  -- the observation as read).
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_items) i(value)
      where pg_catalog.jsonb_typeof(i.value) is distinct from 'object' or not private.takeoff_item_answer_is_uuid(i.value -> 'id')
        or not private.takeoff_item_answer_is_number(i.value -> 'quantity', 0, 999999999.999, false, true)
        or not private.takeoff_item_answer_is_text(i.value -> 'unit', null, 32)
        or not private.takeoff_item_answer_is_number(i.value -> 'source_page', 1, 100000, true)
        -- A row today's readers skip is no contribution: excluded as given, or as the insert's hypothesis rule
        -- (public.exclude_new_takeoff_hypothesis) would exclude it.
        or i.value -> 'is_excluded' = 'true'::jsonb
        or public.takeoff_item_hypothesis_cause(coalesce(i.value -> 'metadata', '{}'::jsonb),
          i.value ->> 'quantity_entry_category') in ('estimated', 'non_observable'))
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

-- 2 and 3. The measuring order of a seal (20261121230719_takeoff_item_lists.sql), a list only plan by plan, each plan's pages known.
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
    or (list - array['revision_id', 'revision', 'content_sha256', 'item_count']) <> '{}'::jsonb
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
  perform private.lock_takeoff_item_list(p_request.project_id);
  if exists (select 1 from public.takeoff_list_revisions r where r.tenant_id = p_request.tenant_id
      and r.project_id = p_request.project_id and r.revision > sealed.revision) then
    raise exception 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' using errcode = '40001';
  end if;
  return sealed.id;
end;
$$;

revoke all on function private.takeoff_item_answers_refusal(public.takeoff_launch_requests, jsonb, integer[], jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_takeoff_launch_order(public.takeoff_launch_requests, jsonb)
  from public, anon, authenticated, service_role;

commit;
