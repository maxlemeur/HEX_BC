-- Use the sealed payer's ledger when validating the worker's tile coverage.
begin;
set local lock_timeout = '5s';

create function private.takeoff_count_mark_tile_attempts(job public.takeoff_jobs, token uuid)
returns table (call_key text, state text)
language sql stable set search_path = '' as $$
  select u.call_key, u.state from private.takeoff_launch_usage u
  where job.preparation_snapshot->'execution_selection'->>'source' is distinct from 'personal_api_key'
    and u.job_id = job.id and u.lease_token = token and u.branch = 'count_tile'
  union all
  select c.tile_key, case when c.lease_token <> token then 'previous'
    when c.settled_at is not null and c.actual_nano_usd is not null and c.actual_tokens is not null then 'observed'
    else 'unknown' end
  from private.takeoff_api_calls c
  where job.preparation_snapshot->'execution_selection'->>'source' = 'personal_api_key'
    and c.mandate_id::text = job.preparation_snapshot->'execution_selection'->>'authorizationId'
    and c.scope_id = job.launch_request_id and c.job_id = job.id and c.branch = 'count_tile'
$$;
revoke all on function private.takeoff_count_mark_tile_attempts(public.takeoff_jobs, uuid) from public, anon, authenticated, service_role;

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
  kept public.takeoff_item_answers%rowtype;
  beside boolean := false;
  generation jsonb := p_result -> 'count_mark_generation';
  coverage jsonb := p_result #> '{provider_meta,count_marks}';
  schedule jsonb;
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
  -- The marks publisher locks the affaire before the job. Take that same lock first when
  -- the two publications share a transaction. A legacy completion takes no extra lock.
  if generation is not null then
    perform 1 from public.estimate_projects p join public.takeoff_jobs j
      on j.project_id = p.id and j.tenant_id = p.tenant_id where j.id = p_job_id for key share of p;
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

  schedule := private.takeoff_confirmed_count_mark_schedule(job);
  if schedule is not null then
    if jsonb_typeof(generation) is distinct from 'object'
      or generation - array['pages','marks'] <> '{}'::jsonb
      or jsonb_typeof(generation -> 'marks') is distinct from 'array'
      or jsonb_typeof(generation -> 'pages') is distinct from 'array'
      or jsonb_array_length(generation -> 'pages') > 6
      or exists (select 1 from jsonb_array_elements(generation -> 'pages') f
        where not coalesce((job.preparation_snapshot -> 'remeasure_count_mark_frames') @> jsonb_build_array(f),false))
      or jsonb_array_length(generation -> 'marks') > 20000
      or octet_length(generation::text) > 16777216
      or exists (select 1 from jsonb_array_elements(generation -> 'marks') m group by m -> 'page' having count(*) > 5000)
      or jsonb_typeof(coverage) is distinct from 'array'
      or jsonb_array_length(coverage) <> jsonb_array_length(schedule -> 'pages')
      or exists (select 1 from jsonb_array_elements(coverage) with ordinality c(sheet,n)
        join jsonb_array_elements(schedule -> 'pages') with ordinality s(sheet,n) using (n)
        where jsonb_typeof(c.sheet) is distinct from 'object'
          or c.sheet - array['page','vector_state','tiles','limited'] <> '{}'::jsonb
          or c.sheet -> 'page' is distinct from s.sheet -> 'page'
          or coalesce(c.sheet ->> 'vector_state','') not in ('read','no_layer','failed','not_read')
          or jsonb_typeof(c.sheet -> 'limited') is distinct from 'boolean'
          or case when jsonb_typeof(c.sheet -> 'tiles') = 'array' then
            jsonb_array_length(c.sheet -> 'tiles') <> case when (s.sheet ->> 'width_points')::numeric > 700 then 6 else 4 end
            or exists (select 1 from jsonb_array_elements_text(c.sheet -> 'tiles') t(status)
              where coalesce(t.status,'') not in ('read','truncated','failed','not_read','unknown'))
          else true end) then
      raise exception 'TAKEOFF_MARKS_COVERAGE_INVALID' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coverage) c(sheet)
      cross join lateral jsonb_array_elements_text(c.sheet -> 'tiles') with ordinality t(status,ordinal)
      left join private.takeoff_count_mark_tile_attempts(job, p_lease_token) u
        on u.call_key = 'tile:' || (c.sheet ->> 'page') || ':' || t.ordinal::text
      where t.status is distinct from private.takeoff_count_mark_tile_status(u.state,t.status)
        -- A recovery can stop before reaching an earlier tile, but cannot publish it as newly read.
        and not (u.state is not distinct from 'previous' and t.status = 'not_read')
    ) or exists (
      select 1 from jsonb_array_elements(generation -> 'marks') m(mark)
      cross join lateral jsonb_array_elements(m.mark -> 'proposals') p(source)
      where p.source ->> 'method' = 'tile' and not exists (
        select 1 from jsonb_array_elements(coverage) c(sheet)
        cross join lateral jsonb_array_elements_text(c.sheet -> 'tiles') with ordinality t(status,ordinal)
        where c.sheet -> 'page' = m.mark -> 'page' and t.status = 'read'
          and p.source ->> 'source_ref' = 'tile:' || t.ordinal::text)
    ) then
      raise exception 'TAKEOFF_MARKS_COVERAGE_INVALID' using errcode = '22023';
    end if;
  elsif generation is not null or coverage is not null then
    raise exception 'TAKEOFF_MARKS_NOT_REQUESTED' using errcode = '22023';
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
  if job.preparation_snapshot ? 'remeasure_page' then
    -- Once the job, request and settlement locks are held, lock the earlier
    -- answer’s marks revision. An edit that committed while the worker read is kept.
    select a.* into kept from public.takeoff_item_answers a
      where a.tenant_id = job.tenant_id and a.project_id = job.project_id and a.item_id = (p_answers #>> '{0,item_id}')::uuid
        and a.plan_logical_id = (request.manifest #>> '{plans,0,logical_id}')::uuid and not a.comparison_only
      order by a.reading_revision desc limit 1;
    if found then
      beside := private.lock_takeoff_count_marks_revision(kept.id) is distinct from
          (job.preparation_snapshot ->> 'remeasure_marks_revision')::integer
        or (job.preparation_snapshot ->> 'remeasure_page' is not null and
          (private.takeoff_count_answer_scope(kept) is distinct from p_unit_pages
            or kept.plan_content_sha256 is distinct from request.manifest #>> '{plans,0,content_sha256}'));
    end if;
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
    select a.*, case when beside then null when previous.comparison_only then
        (select h.id from public.takeoff_item_answers h where h.tenant_id = job.tenant_id and h.project_id = job.project_id
          and h.item_id = a.item_id and h.plan_logical_id = plan.logical_id and not h.comparison_only
          order by h.reading_revision desc limit 1) else previous.id end as replaces_answer_id, coalesce(previous.reading_revision, 0) + 1 as reading_revision,
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
    left join lateral (select h.id, h.reading_revision, h.comparison_only from public.takeoff_item_answers h
      where h.tenant_id = job.tenant_id and h.project_id = job.project_id and h.item_id = a.item_id
        and h.plan_logical_id = plan.logical_id
      order by h.reading_revision desc limit 1) previous on true
  ), inserted as (
    insert into public.takeoff_item_answers (id, tenant_id, project_id, job_id, list_revision_id, item_id, plan_file_id,
      plan_logical_id, plan_generation, plan_content_sha256, outcome, quantity, unit, candidate_quantity, candidate_unit,
      searched_pages, unreadable_pages, reasons, reason_code, observation_count, contribution_count, replaces_answer_id,
      reading_revision, comparison_only, content_sha256)
    select a.answer_id, job.tenant_id, job.project_id, job.id, request.item_list_revision_id, a.item_id, plan.plan_file_id,
      plan.logical_id, plan.generation, plan.content_sha256, a.outcome, a.quantity, a.unit, a.candidate_quantity,
      a.candidate_unit, a.searched_pages, a.unreadable_pages, a.reasons, a.reasons #>> '{0,code}', a.observation_count,
      a.contribution_count, a.replaces_answer_id, a.reading_revision, beside,
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
  if generation is not null and jsonb_array_length(generation -> 'marks') > 0 then
    perform public.publish_takeoff_count_marks(p_job_id,p_lease_token,1,generation -> 'pages',generation -> 'marks');
  end if;
  return query select new_result, false, written;
end;
$$;

commit;
