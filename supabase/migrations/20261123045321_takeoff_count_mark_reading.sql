-- The optional readers share the detail command's payer, seal and call ledger.
set lock_timeout = '5s';

create function private.takeoff_count_mark_schedule_valid(schedule jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  sheet jsonb;
  previous_page integer := 0;
  calls integer := 0;
begin
  if jsonb_typeof(schedule) is distinct from 'object'
    or schedule - array['pages','tile_calls','other_calls','total_calls'] <> '{}'::jsonb
    or jsonb_typeof(schedule -> 'pages') is distinct from 'array'
    or jsonb_array_length(schedule -> 'pages') not between 1 and 6
    or not private.takeoff_item_answer_is_number(schedule -> 'tile_calls',4,24,true)
    or not private.takeoff_item_answer_is_number(schedule -> 'other_calls',1,80,true)
    or not private.takeoff_item_answer_is_number(schedule -> 'total_calls',5,104,true) then
    return false;
  end if;
  for sheet in select value from jsonb_array_elements(schedule -> 'pages') loop
    if jsonb_typeof(sheet) is distinct from 'object' or sheet - array['page','width_points'] <> '{}'::jsonb
      or not private.takeoff_item_answer_is_number(sheet -> 'page',previous_page + 1,100000,true)
      or not private.takeoff_item_answer_is_number(sheet -> 'width_points',0,10000000,false,true) then
      return false;
    end if;
    previous_page := (sheet ->> 'page')::numeric::integer;
    calls := calls + case when (sheet ->> 'width_points')::numeric > 700 then 6 else 4 end;
  end loop;
  return calls = (schedule ->> 'tile_calls')::numeric
    and calls + (schedule ->> 'other_calls')::numeric = (schedule ->> 'total_calls')::numeric;
end;
$$;
revoke all on function private.takeoff_count_mark_schedule_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function private.takeoff_item_remeasure_confirmation_valid(p_confirmation jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_confirmation) = 'object'
    and coalesce(p_confirmation ->> 'preview_digest', '') ~ '^[0-9a-f]{64}$'
    and case when p_confirmation ? 'page' then
      (p_confirmation - array['preview_digest', 'setting', 'page', 'shown_sha256', 'count_marks']) = '{}'::jsonb
      and (not p_confirmation ? 'count_marks' or private.takeoff_count_mark_schedule_valid(p_confirmation -> 'count_marks'))
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
  schedule jsonb := p_confirmation -> 'count_marks';
  schedule_pages jsonb;
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
    or p_snapshot ?| array['remeasure_count_marks', 'remeasure_setting', 'remeasure_page', 'remeasure_marks_revision', 'remeasure_item', 'remeasure_plan', 'remeasure_previous_answer']
    or not private.takeoff_item_remeasure_targets_valid(p_targets)
    or asked is distinct from (select pg_catalog.jsonb_agg(((t.value ->> 'item_id')::uuid)::text order by (t.value ->> 'item_id')::uuid)
      from pg_catalog.jsonb_array_elements(p_targets) t(value))
    or not private.takeoff_item_remeasure_confirmation_valid(p_confirmation) then
    raise exception 'TAKEOFF_ITEM_REMEASURE_INVALID' using errcode = '22023';
  end if;
  requested_page := (p_confirmation ->> 'page')::integer;
  if schedule is not null then
    select jsonb_agg(s -> 'page' order by (s ->> 'page')::numeric) into schedule_pages
    from jsonb_array_elements(schedule -> 'pages') s;
    if (case when p_manifest #> '{plans,0,pages}' = '[]'::jsonb then
      jsonb_array_length(schedule_pages) is distinct from (p_manifest #>> '{plans,0,page_count}')::integer
      or (schedule_pages ->> -1)::numeric <> jsonb_array_length(schedule_pages)
    else not (schedule_pages @> (p_manifest #> '{plans,0,pages}')
      and (p_manifest #> '{plans,0,pages}') @> schedule_pages) end) then
      raise exception 'TAKEOFF_MARKS_SCOPE_INVALID' using errcode = '22023';
    end if;
    p_snapshot := p_snapshot || jsonb_build_object('remeasure_count_marks',schedule);
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

  schedule := job.preparation_snapshot -> 'remeasure_count_marks';
  if schedule is not null then
    if jsonb_typeof(generation) is distinct from 'object'
      or generation - array['pages','marks'] <> '{}'::jsonb
      or jsonb_typeof(generation -> 'marks') is distinct from 'array'
      or jsonb_typeof(generation -> 'pages') is distinct from 'array'
      or jsonb_array_length(generation -> 'pages') > 6
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

create or replace function public.reserve_takeoff_launch_call(p_job_id uuid, p_lease_token uuid, p_call_key text, p_branch text,
  p_estimate_tokens bigint, p_module_default boolean default false)
returns table (outcome text, reason text, reserved_tokens bigint, remaining_tokens bigint, remaining_cost_cents bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  job public.takeoff_jobs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  existing private.takeoff_launch_usage%rowtype;
  balance record;
  refusal text;
  bound bigint;
begin
  if p_call_key is null or length(p_call_key) not between 1 and 120 or p_branch not in ('pdf', 'vector_group', 'other')
    or p_estimate_tokens is null or p_estimate_tokens < 1 then
    raise exception 'TAKEOFF_LAUNCH_CALL_INVALID' using errcode = '22023';
  end if;
  job := private.lock_takeoff_paying_job(p_job_id, p_lease_token);
  -- A plan of one analysis per plan pays only while it holds the Mac (its slot, under this very lease); another job of
  -- the Mac, from the activation on or while such a plan is at work on the Mac, only while no other job holds it.
  if job.launch_unit_key like 'plan:%' then
    if not exists (select 1 from private.takeoff_host_slots s where s.host_id = job.execution_host_id and s.job_id = job.id
        and s.holder_token = p_lease_token and s.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
    end if;
  elsif job.execution_host_id is not null
    and (private.takeoff_plan_dispatch_active() or private.takeoff_host_plan_work(job.execution_host_id))
    and private.takeoff_host_slot_busy(job.execution_host_id, job.id) then
    raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
  end if;
  refusal := private.takeoff_job_payment_refusal(job, p_module_default);
  if refusal is not null then
    return query select 'refused'::text, refusal, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  if p_call_key like 'tile:%' and not coalesce(job.preparation_snapshot ? 'remeasure_count_marks',false) then
    return query select 'refused'::text, 'TILE_OUTSIDE_SCOPE'::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  if job.launch_request_id is null then
    return query select 'unbudgeted'::text, null::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  -- The job's row, then the request's: the order of every writer of both.
  select * into request from public.takeoff_launch_requests r where r.id = job.launch_request_id for update;
  -- Before the owner's activation of one analysis per plan, a call of a grouped analysis is checked as M4 checked it (its
  -- request's balance) and reserves nothing: its usage is recorded once answered, as before; nothing new is written.
  if not private.takeoff_plan_dispatch_active() and request.manifest -> 'format_version' is distinct from '2'::jsonb then
    select * into balance from private.takeoff_launch_job_balance(job, request);
    return query select case when balance.tokens_left > 0 and balance.cost_left > 0 then 'unreserved' else 'refused' end,
      case when balance.tokens_left > 0 and balance.cost_left > 0 then null else 'BUDGET_EXHAUSTED' end,
      null::bigint, balance.tokens_left, balance.cost_left;
    return;
  end if;
  -- A call of the request whose outcome is unknown freezes every further paid call of the request: it may have consumed
  -- what is left (a call still reserved by an attempt whose lease ended counts, before any recovery). A member's relaunch
  -- starts a new request.
  if private.takeoff_launch_usage_frozen(request.id) then
    return query select 'refused'::text, 'USAGE_UNKNOWN'::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  -- For the optional readers the confirmation buys one attempt per named tile, across
  -- all leases. Replaying a reservation must never authorize a second physical call.
  if job.preparation_snapshot ? 'remeasure_count_marks' then
    if p_branch = 'other' or p_call_key like 'tile:%' then
      if p_branch is distinct from 'other' or not exists (
        select 1 from jsonb_array_elements(job.preparation_snapshot #> '{remeasure_count_marks,pages}') s
        cross join lateral generate_series(1,case when (s ->> 'width_points')::numeric > 700 then 6 else 4 end) t(i)
        where p_call_key = 'tile:' || ((s ->> 'page')::numeric::integer)::text || ':' || t.i::text) then
        refusal := 'TILE_OUTSIDE_SCOPE';
      elsif exists (select 1 from private.takeoff_launch_usage l where l.request_id = request.id and l.call_key = p_call_key) then
        refusal := 'TILE_ALREADY_ATTEMPTED';
      elsif exists (select 1 from private.takeoff_launch_usage l where l.request_id = request.id and l.state = 'reserved') then
        refusal := 'TILE_IN_FLIGHT';
      end if;
    elsif exists (select 1 from private.takeoff_launch_usage l where l.request_id = request.id
        and l.branch = 'other' and l.state = 'reserved') then
      refusal := 'TILE_IN_FLIGHT';
    elsif (select count(*) from private.takeoff_launch_usage l where l.request_id = request.id and l.branch <> 'other'
        and (l.lease_token,l.call_key) <> (p_lease_token,p_call_key))
        >= (job.preparation_snapshot #>> '{remeasure_count_marks,other_calls}')::integer then
      refusal := 'BUDGET_EXHAUSTED';
    end if;
    if refusal is not null then
      return query select 'refused'::text, refusal, null::bigint, null::bigint, null::bigint;
      return;
    end if;
  end if;
  select * into existing from private.takeoff_launch_usage l
  where l.job_id = job.id and l.lease_token = p_lease_token and l.call_key = p_call_key;
  select * into balance from private.takeoff_launch_job_balance(job, request);
  if existing.job_id is not null then
    return query select case when existing.state = 'reserved' then 'reserved' else 'refused' end,
      case when existing.state = 'reserved' then null else 'CALL_ALREADY_SETTLED' end,
      existing.reserved_tokens, balance.tokens_left, balance.cost_left;
    return;
  end if;
  if balance.tokens_left > 0 and balance.cost_left > 0 then
    select greatest(p_estimate_tokens, coalesce(max(l.tokens), 0)) into bound from private.takeoff_launch_usage l
    where l.request_id = request.id and l.branch = p_branch and l.state = 'observed';
    insert into private.takeoff_launch_usage (job_id, lease_token, call_key, request_id, tokens, cost_cents, state, branch,
      reserved_tokens, reserved_at)
    values (job.id, p_lease_token, p_call_key, request.id, 0, 0, 'reserved', p_branch, bound, pg_catalog.clock_timestamp());
    return query select 'reserved'::text, null::text, bound, balance.tokens_left - bound, balance.cost_left;
    return;
  end if;
  if exists (select 1 from private.takeoff_launch_usage l where l.job_id = job.id and l.lease_token = p_lease_token
      and l.state = 'reserved') then
    return query select 'wait'::text, null::text, null::bigint, balance.tokens_left, balance.cost_left;
    return;
  end if;
  return query select 'refused'::text, 'BUDGET_EXHAUSTED'::text, null::bigint, balance.tokens_left, balance.cost_left;
end;
$$;
reset lock_timeout;
