-- Lot 4, B1's follow-up before the second measuring order can be activated (20261122080845_takeoff_item_answers.sql).
--
-- 1. A contribution's row must be countable: a publication whose contribution's row is stored excluded (as given, as its
--    typed column reads it, or as an insert trigger such as the hypothesis rule makes it) is refused with
--    TAKEOFF_ANSWERS_OBSERVATION_INVALID, as a measured answer nobody counts. The rows are read as the first order's end
--    stored them, in the publication's transaction, so nothing is left written. Rebuilt on the only body of
--    public.publish_takeoff_item_answers (20261122080845_takeoff_item_answers.sql); nothing else of it changes.
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
-- the second order is activated (private.takeoff_item_list_order_activation, empty). The publication is called by no
-- released application. No table, column, index, policy, grant
-- or trigger changes; creating the two functions takes no table lock (their bodies are validated at their first call).
begin;

set local lock_timeout = '5s';
set local check_function_bodies = off;

-- 1. The worker's publication (20261122080845_takeoff_item_answers.sql), with the countable row of each contribution.
create or replace function public.publish_takeoff_item_answers(
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
  -- A contribution is counted only if its row is: read as that end stored it (its typed columns, its insert triggers,
  -- the hypothesis rule among them), never as the worker sent it. A row stored excluded is a measure nobody counts.
  if exists (select 1 from private.takeoff_item_answers_parsed(p_answers) a
      cross join lateral pg_catalog.jsonb_array_elements(a.observations) o(value)
      where o.value ->> 'role' = 'contribution' and not exists (select 1 from public.takeoff_items i
        where i.id = (o.value ->> 'takeoff_item_id')::uuid and i.job_id = p_job_id and i.result_id = new_result
          and not i.is_excluded)) then
    raise exception 'TAKEOFF_ANSWERS_OBSERVATION_INVALID' using errcode = '22023';
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

revoke all on function public.publish_takeoff_item_answers(uuid, uuid, timestamptz, text, text, jsonb, integer[], jsonb, jsonb, jsonb,
  jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_takeoff_item_answers(uuid, uuid, timestamptz, text, text, jsonb, integer[], jsonb, jsonb,
  jsonb, jsonb, jsonb) to service_role;
revoke all on function private.assert_takeoff_launch_order(public.takeoff_launch_requests, jsonb)
  from public, anon, authenticated, service_role;

commit;
