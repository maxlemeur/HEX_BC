-- A single-page reading may be compared with a wider predecessor without replacing it.
-- Existing answers retain their review and send eligibility.
set lock_timeout = '5s';
alter table public.takeoff_item_answers add column comparison_only boolean not null default false;

create or replace function private.takeoff_item_remeasure_confirmation_valid(p_confirmation jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_confirmation) = 'object'
    and coalesce(p_confirmation ->> 'preview_digest', '') ~ '^[0-9a-f]{64}$'
    and case when p_confirmation ? 'page' then
      (p_confirmation - array['preview_digest', 'setting', 'page', 'shown_sha256']) = '{}'::jsonb
      and coalesce(p_confirmation ->> 'shown_sha256', '') ~ '^[0-9a-f]{64}$'
      and (p_confirmation -> 'page' = 'null'::jsonb or private.takeoff_item_answer_is_number(p_confirmation -> 'page', 1, 100000, true))
      and pg_catalog.jsonb_typeof(p_confirmation -> 'setting') = 'object'
      and ((p_confirmation -> 'setting') - array['model','reasoning_effort']) = '{}'::jsonb
      and pg_catalog.jsonb_typeof(p_confirmation #> '{setting,model}') = 'string'
      and pg_catalog.char_length(p_confirmation #>> '{setting,model}') between 1 and 200
      and (p_confirmation #> '{setting,reasoning_effort}' = 'null'::jsonb
        or p_confirmation #>> '{setting,reasoning_effort}' in ('none','low','medium','high','xhigh','max'))
    else (p_confirmation - array['preview_digest', 'setting']) = '{}'::jsonb
      and (coalesce(p_confirmation -> 'setting', 'null'::jsonb) = 'null'::jsonb
        or (pg_catalog.jsonb_typeof(p_confirmation -> 'setting') = 'object'
          and ((p_confirmation -> 'setting') - 'reasoning_effort') = '{}'::jsonb
          and pg_catalog.jsonb_typeof(p_confirmation #> '{setting,reasoning_effort}') in ('string', 'null'))) end, false)
$$;

create or replace function public.launch_takeoff_item_remeasure(
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
  one_item boolean := p_confirmation ? 'page';
  requested_page integer;
  digest text;
  answer record;
  launched record;
  stale_items uuid[];
begin
  -- The whole command, before anything is read or recorded: format 2 on the plans it names (each once, each with its
  -- identity), whose order seals the items it asks (at least one, at most 1,000, each once, in the canonical order),
  -- exactly those of its targets; each target names its current answers as the member saw them, each once.
  if p_manifest -> 'format_version' is distinct from '2'::jsonb or p_intent_key is null or p_actor is null
    or (p_predecessor_job_id is null and not one_item) or p_plan_set_id is null or p_preparation_revision is null
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
    or (one_item and (pg_catalog.jsonb_array_length(asked) <> 1 or pg_catalog.cardinality(p_plan_file_ids) <> 1))
    or p_snapshot ?| array['remeasure_setting', 'remeasure_page', 'remeasure_marks_revision', 'remeasure_item', 'remeasure_plan', 'remeasure_previous_answer']
    or not private.takeoff_item_remeasure_targets_valid(p_targets)
    or asked is distinct from (select pg_catalog.jsonb_agg(((t.value ->> 'item_id')::uuid)::text order by (t.value ->> 'item_id')::uuid)
      from pg_catalog.jsonb_array_elements(p_targets) t(value))
    or not private.takeoff_item_remeasure_confirmation_valid(p_confirmation) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  requested_page := (p_confirmation ->> 'page')::integer;
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
            and (case when requested_page is null then c.value -> 'pages' is not distinct from s.value -> 'pages'
              else s.value -> 'pages' = pg_catalog.jsonb_build_array(requested_page)
                and ((c.value -> 'pages') @> (s.value -> 'pages') or (c.value -> 'pages' = '[]'::jsonb
                  and requested_page <= coalesce((c.value ->> 'page_count')::integer,(p_manifest #>> '{plans,0,page_count}')::integer)))
              end)
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
  if one_item then
    -- Build the worker-only setting from the confirmation covered by the receipt. The
    -- execution_selection remains the attested subscription, including its connection.
    p_snapshot := p_snapshot || pg_catalog.jsonb_build_object(
      'remeasure_item', asked -> 0,
      'remeasure_plan', p_manifest #> '{plans,0,logical_id}',
      'remeasure_previous_answer', p_targets #> '{0,answers,0}',
      'remeasure_setting', pg_catalog.jsonb_build_object('model', p_confirmation #>> '{setting,model}',
        'reasoningEffort', p_confirmation #> '{setting,reasoning_effort}'),
      'remeasure_page', requested_page,
      'remeasure_marks_revision', private.takeoff_count_marks_revision((p_targets #>> '{0,answers,0}')::uuid));
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
    from private.launch_manual_takeoff_command(p_tenant_id, p_project_id, p_actor, p_intent_key,
      case when p_predecessor_job_id is null then 'initial' else 'reread_plans' end,
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
  return query select new_result, false, written;
end;
$$;

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
      and not exists (select 1 from public.takeoff_item_answers comparison
        where comparison.job_id = j.id and comparison.comparison_only)
    order by e.item_id, p.logical_id, j.created_at desc, j.id desc
  )
  select a.item_id, a.logical_id, a.plan_file_id, a.name, a.generation, a.job_id, a.unit_state,
    case when a.unit_state in ('queued', 'running') then 'in_flight' when head.id is not null then 'answered' else 'ended' end,
    head.id, head.outcome
  from asked a
  left join lateral (select h.id, h.outcome from public.takeoff_item_answers h
    where h.tenant_id = p_tenant_id and h.project_id = p_project_id and h.item_id = a.item_id
      and h.plan_logical_id = a.logical_id and not h.comparison_only
    order by h.reading_revision desc limit 1) head on true
$$;

create or replace function private.takeoff_count_answer_is_current(p_answer public.takeoff_item_answers)
returns boolean language sql stable security definer set search_path = '' as $$
  select not p_answer.comparison_only and not exists (select 1 from public.takeoff_item_answers n
    where n.tenant_id = p_answer.tenant_id and n.project_id = p_answer.project_id and n.item_id = p_answer.item_id
      and n.plan_logical_id = p_answer.plan_logical_id and not n.comparison_only and n.reading_revision > p_answer.reading_revision)
$$;

create or replace function public.read_takeoff_item_answers(p_tenant_id uuid, p_project_id uuid, p_job_id uuid default null,
  p_current_only boolean default false, p_after_item_id uuid default null, p_after_plan_logical_id uuid default null,
  p_after_reading_revision integer default null, p_limit integer default 200, p_answer_id uuid default null,
  p_takeoff_item_id uuid default null)
returns table (answer_id uuid, item_id uuid, plan_logical_id uuid, reading_revision integer, is_current boolean, answer jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.item_id, a.plan_logical_id, a.reading_revision, current_answer.is_current,
    private.takeoff_item_answer_document(a)
  from public.takeoff_item_answers a
  cross join lateral (select private.takeoff_count_answer_is_current(a) as is_current) current_answer
  where (select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false))
    and a.tenant_id = p_tenant_id and a.project_id = p_project_id
    and (p_job_id is null or a.job_id = p_job_id)
    and (p_answer_id is null or a.id = p_answer_id)
    and (p_takeoff_item_id is null or exists (select 1 from public.takeoff_item_answer_observations o
      where o.answer_id = a.id and o.takeoff_item_id = p_takeoff_item_id))
    and (not coalesce(p_current_only, false) or current_answer.is_current)
    and (p_after_item_id is null
      or (a.item_id, a.plan_logical_id, a.reading_revision) > (p_after_item_id, p_after_plan_logical_id, p_after_reading_revision))
  order by a.item_id, a.plan_logical_id, a.reading_revision
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- A comparison leaves the current answer in the existing dependency stamp.
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
          and h.plan_logical_id = a.plan_logical_id and not h.comparison_only
        order by h.reading_revision desc limit 1) head
      where a.job_id = j.id and a.tenant_id = j.tenant_id
      having count(*) > 0), '[]'::jsonb))::text)
  from public.takeoff_jobs j
  where j.id = p_job_id and j.project_id = p_project_id and j.tenant_id = p_tenant_id
    and j.estimate_version_id is null
$$;

-- A page kept for comparison is never a peer of the plan being sent.
create or replace function private.takeoff_send_context(p_tenant uuid, p_project uuid, p_job uuid, p_version uuid)
returns jsonb language sql stable set search_path = '' as $$
  with readings as (
    select candidate.id, candidate.status, candidate.estimate_version_id, candidate.created_at, plan.file_id,
      coalesce(recorded.source_kind, 'plan_file') as source_kind, coalesce(recorded.source_id, plan.file_id) as source_id
    from public.takeoff_jobs as candidate
    join public.takeoff_launch_requests as request on request.id = candidate.launch_request_id
      and request.tenant_id = candidate.tenant_id and request.manifest -> 'format_version' = '2'::jsonb
    cross join lateral (
      select private.takeoff_uuid_or_null(source.value -> 'document_id') as file_id
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(candidate.preparation_snapshot #> '{preparation,sources}')
          = 'array' then candidate.preparation_snapshot #> '{preparation,sources}' else '[]'::jsonb end) as source(value)
      where source.value ->> 'kind' = 'plan' and source.value -> 'active' = 'true'::jsonb
      limit 1) as plan
    left join public.takeoff_plan_location_sources as recorded on recorded.plan_file_id = plan.file_id
      and recorded.tenant_id = candidate.tenant_id
    where candidate.tenant_id = p_tenant and candidate.project_id = p_project and plan.file_id is not null
      and not exists (select 1 from public.takeoff_item_answers comparison
        where comparison.job_id = candidate.id and comparison.comparison_only)
  ), own as (
    select readings.* from readings where readings.id = p_job
  ), latest as (
    select distinct on (other.source_kind, other.source_id) other.id, other.estimate_version_id, other.file_id
    from readings as other cross join own
    where other.id <> own.id
      and other.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
      and (other.source_kind, other.source_id) is distinct from (own.source_kind, own.source_id)
    order by other.source_kind, other.source_id, other.created_at desc, other.id desc
  ), peers as (
    -- A plan whose latest reading was sent has no peer here: an earlier reading it replaced is never compared. Nor does a
    -- plan whose latest reading read a copy that is no longer the dossier's current copy of its source (a plan replaced,
    -- or set aside, since), as the dossier holds it now (not a preparation, which an automatic request may not have and an
    -- edit clears).
    select latest.id from latest where latest.estimate_version_id is null
      and exists (select 1 from private.resolve_takeoff_plan_location_source(p_tenant, p_project, latest.file_id) as resolved
        where resolved.current_copy)
  ), evaluated as (
    select p_job as id
    union select peers.id from peers
    union select attached.id from public.takeoff_jobs as attached
      where p_version is not null and attached.tenant_id = p_tenant and attached.estimate_version_id = p_version
        and attached.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
    union select link.takeoff_job_id from public.takeoff_version_links as link
      where p_version is not null and link.tenant_id = p_tenant and link.target_version_id = p_version
  ), revisions as (
    select distinct evaluated.id as job_id, private.takeoff_uuid_or_null(source.value -> 'document_id') as file_id,
      source.value ->> 'content_hash' as content_hash
    from evaluated
    join public.takeoff_jobs as job on job.id = evaluated.id and job.tenant_id = p_tenant
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(job.preparation_snapshot #> '{preparation,sources}')
        = 'array' then job.preparation_snapshot #> '{preparation,sources}' else '[]'::jsonb end) as source(value)
    where source.value ->> 'kind' = 'plan' and source.value -> 'active' = 'true'::jsonb
      and coalesce(source.value ->> 'content_hash', '') ~ '^[0-9a-f]{64}$'
  )
  select pg_catalog.jsonb_build_object(
    'peers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', peers.id,
        'stamp', public.takeoff_rule_job_stamp(p_tenant, p_project, peers.id)) order by peers.id) from peers), '[]'::jsonb),
    'plans', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', revision.job_id,
        'plan_file_id', revision.file_id, 'content_hash', revision.content_hash)
        || private.takeoff_send_revision_state(p_tenant, p_project, revision.file_id, revision.content_hash)
      order by revision.job_id, revision.file_id, revision.content_hash) from revisions as revision), '[]'::jsonb))
$$;
