-- Lot 2, PR 6 (the affaire's takeoff zone), fix round: the rules of the takeoff's launches hold in the database, not only
-- in the affaire's dialogue. Functions are replaced; no table, index, policy or row changes.
--
-- 1. A manual launch request (public.launch_manual_takeoff_request) is refused while the affaire's automatic start can
--    still begin (it is taken on from its zone), and a first analysis (intent initial) is refused on an affaire that has
--    any analysis (a relaunch names the one it replaces).
-- 2. An analysis of the affaire launched outside any request that has not ended counts as running: a command is answered
--    with it (« already_running ») and an automatic admission waits (ANOTHER_ANALYSIS_RUNNING, retried by its Mac).
-- 3. Once the automatic start is active, a member registers no new job outside a request (the admission RPC of jobs on a
--    version or without one, and direct inserts): every new analysis is a launch request, with its exclusion, its mandate
--    and its budget. An insert of a job that already exists still reaches its unique key, as a replay did.
-- 4. The send's refusal of a second analysis of one preparation revision to one draft (private.takeoff_send_execute) only
--    compares jobs without a request, as the historical receipt index does since 20261121170448.
--
-- What the previous application version sees while this is applied and until the owner sets both cut-offs: nothing
-- changes. Points 1 and 2 are reached only after the activation check of the functions they change; point 3 only once
-- both cut-offs are set; point 4 compares exactly the same jobs while no request exists (every job is without one).
begin;

-- Every statement takes a short lock: give up instead of queueing the job and send writers.
set local lock_timeout = '5s';

-- The analysis of an affaire launched outside any request that has not ended: waiting, read now, or failed with a
-- technical retry due. The most recent one.
create function private.takeoff_unrequested_analysis_running(p_tenant_id uuid, p_project_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select j.id from public.takeoff_jobs j
  where j.tenant_id = p_tenant_id and j.project_id = p_project_id and j.launch_request_id is null
    and (j.status in ('pending', 'processing')
      or (j.status = 'failed' and j.next_retry_at is not null and j.analysis_outcome is null))
  order by j.created_at desc, j.id desc
  limit 1
$$;
revoke all on function private.takeoff_unrequested_analysis_running(uuid, uuid) from public, anon, authenticated, service_role;

-- 1, 2. The command of a manual launch request, as 20261121170448 wrote it, with the refusals of the automatic start that
-- can still begin and of a second first analysis, and the running analysis outside any request.
create or replace function public.launch_manual_takeoff_request(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_plan_set_id uuid,
  p_preparation_revision integer, p_module_default boolean default false
) returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  digest text := private.takeoff_launch_command_digest(p_actor, p_intent, p_predecessor_job_id, p_plan_set_id, p_preparation_revision);
  request public.takeoff_launch_requests%rowtype;
  running record;
  answer record;
  predecessor_request uuid;
  admitted_job uuid;
  violated text;
  running_unrequested uuid;
begin
  if p_intent not in ('initial', 'reread_plans') or p_intent_key is null or p_actor is null or p_plan_set_id is null
    or p_preparation_revision is null then
    raise exception 'TAKEOFF_LAUNCH_COMMAND_INVALID' using errcode = '22023';
  end if;
  if p_intent <> 'initial' and p_predecessor_job_id is null then
    raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED' using errcode = '22023';
  end if;
  if p_intent = 'initial' and p_predecessor_job_id is not null then
    raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
  end if;
  perform private.assert_takeoff_launch_selection(p_host, p_selection);
  if not private.takeoff_launch_active() then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  if not private.takeoff_module_enabled(p_tenant_id, p_module_default) then
    raise exception 'TAKEOFF_LAUNCH_MODULE_DISABLED' using errcode = '55000';
  end if;
  -- Commands and reservations of one affaire are serialized on its key: the replay and the one-running rule read
  -- committed rows, and the automatic request a confirmation reserved is always found.
  perform private.lock_takeoff_launch_commands(p_project_id);
  for answer in select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key, digest) loop
    return query select answer.outcome, answer.request_id, answer.job_id;
    return;
  end loop;
  if p_predecessor_job_id is not null then
    select j.launch_request_id into predecessor_request from public.takeoff_jobs j
    where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id and j.project_id = p_project_id;
    if not found then
      raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
    end if;
  end if;
  -- The affaire's automatic request is held before the one-running rule is read: its own admission either committed
  -- (it runs, the command is refused) or waits for this command, which then sets it aside.
  perform 1 from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic' for update;
  -- An automatic start that can still begin (its dossier, its Mac or a gesture is awaited) is taken on from the affaire's
  -- takeoff zone, on its own receipt: a command never sets it aside. Refused, nothing is recorded.
  if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
      and r.origin = 'automatic' and private.takeoff_launch_request_open(r)) then
    raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
  end if;
  -- The first analysis only on an affaire that has none, whatever launched it: any other command names the analysis it
  -- replaces.
  if p_intent = 'initial' and exists (select 1 from public.takeoff_jobs j
      where j.tenant_id = p_tenant_id and j.project_id = p_project_id) then
    raise exception 'TAKEOFF_LAUNCH_ANALYSIS_EXISTS' using errcode = '22023';
  end if;
  select r.id, (select j.id from public.takeoff_jobs j where j.launch_request_id = r.id order by j.launch_unit_key limit 1) as job
  into running from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
  if found then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end if;
  -- An analysis launched outside any request (the dialogue's launch on a version, before the activation) that has not
  -- ended runs too: the command is recorded with it, as with a running request, and no request is created.
  running_unrequested := private.takeoff_unrequested_analysis_running(p_tenant_id, p_project_id);
  if running_unrequested is not null then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, digest, 'already_running', null, running_unrequested, p_actor);
    return query select 'already_running'::text, null::uuid, running_unrequested;
    return;
  end if;
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  begin
    insert into public.takeoff_launch_requests (tenant_id, project_id, origin, intent, intent_key, command_digest,
      predecessor_request_id, predecessor_job_id, state, payer_id, mandate_kind, mandated_at,
      execution_host_id, mandate_selection, mandate_revision)
    values (p_tenant_id, p_project_id, 'manual', p_intent, p_intent_key, digest, predecessor_request, p_predecessor_job_id,
      'evaluating', p_actor, 'command', pg_catalog.clock_timestamp(), p_host, p_selection, 1)
    returning * into request;
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot,
      private.takeoff_launch_mark_position(p_tenant_id, p_project_id));
    admitted_job := private.insert_takeoff_launch_job(request,
      p_job || jsonb_build_object('launch_unit_key', p_manifest #>> '{units,0,key}'));
    perform private.record_takeoff_launch_audit(request, p_actor, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', jsonb_build_array(admitted_job), 'manifest_digest', request.manifest_digest, 'intent', p_intent,
      'predecessor_job_id', p_predecessor_job_id, 'execution_host_id', p_host, 'mandate_kind', 'command'));
    -- An automatic start that had not begun is set aside by this explicit analysis, for good: it never spends later.
    update public.takeoff_launch_requests r set state = 'superseded', reason_code = null,
      reason_details = jsonb_build_object('request_id', request.id), evaluation_lease_token = null, evaluation_lease_expires_at = null,
      mandate_revision = r.mandate_revision + 1
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic'
      and r.state in ('evaluating', 'not_eligible', 'blocked');
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, digest, 'admitted', request.id, admitted_job, p_actor);
  exception when unique_violation then
    -- Another request of the affaire was admitted meanwhile (an automatic admission that did not wait): the command's
    -- receipt records that one.
    get stacked diagnostics violated = constraint_name;
    if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
    select r.id, (select j.id from public.takeoff_jobs j where j.launch_request_id = r.id order by j.launch_unit_key limit 1) as job
    into running from public.takeoff_launch_requests r
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end;
  return query select 'admitted'::text, request.id, admitted_job;
end;
$$;


-- 2. The admission of a request, as 20261121170448 wrote it: an analysis outside any request that runs makes it wait.
create or replace function public.admit_takeoff_launch_request(
  p_request_id uuid, p_token uuid, p_mark bigint, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_module_default boolean default false
) returns table (outcome text, job_id uuid, reason_code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  brief public.affaire_briefs%rowtype;
  admitted_job uuid;
  failure text;
  violated text;
begin
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request.state in ('admitted', 'closed') then
    return query select 'replayed'::text, (select j.id from public.takeoff_jobs j where j.launch_request_id = request.id
      order by j.launch_unit_key limit 1), null::text;
    return;
  end if;
  -- The token alone: a lease that expired was claimed again under another token by then, or is still this evaluation's.
  if request.evaluation_lease_token is distinct from p_token then
    return query select 'lost'::text, null::uuid, null::text;
    return;
  end if;
  -- The previous application version neither records an end nor reads a request: nothing is admitted before both cut-offs.
  if not private.takeoff_launch_active() then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
    perform private.release_takeoff_launch_evaluation(request.id, 'evaluating', null, null, null);
    return query select 'stale'::text, null::uuid, null::text;
    return;
  end if;
  select * into brief from public.affaire_briefs b where b.tenant_id = request.tenant_id and b.project_id = request.project_id;
  failure := case
    when not private.takeoff_module_enabled(request.tenant_id, p_module_default) then 'TAKEOFF_DISABLED'
    when request.payer_id is null or request.execution_host_id is null then 'MANDATE_REQUIRED'
    when request.origin = 'automatic' and brief.status is distinct from 'confirme' then 'BRIEF_NOT_CONFIRMED'
    when not private.takeoff_launch_payer_eligible(request.tenant_id, request.project_id, request.payer_id) then 'PAYER_NOT_ELIGIBLE'
    when exists (select 1 from public.takeoff_launch_requests other where other.tenant_id = request.tenant_id
      and other.project_id = request.project_id and other.state = 'admitted' and other.id <> request.id)
      or private.takeoff_unrequested_analysis_running(request.tenant_id, request.project_id) is not null then 'ANOTHER_ANALYSIS_RUNNING'
  end;
  if failure is not null then
    perform private.release_takeoff_launch_evaluation(request.id,
      case when failure = 'BRIEF_NOT_CONFIRMED' then 'not_eligible' else 'blocked' end, failure, null, p_mark);
    return query select 'blocked'::text, null::uuid, failure;
    return;
  end if;

  begin
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot, p_mark);
    admitted_job := private.insert_takeoff_launch_job(request,
      p_job || jsonb_build_object('launch_unit_key', p_manifest #>> '{units,0,key}'));
    perform private.record_takeoff_launch_audit(request, request.payer_id, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', jsonb_build_array(admitted_job), 'manifest_digest', request.manifest_digest,
      'execution_host_id', request.execution_host_id, 'mandate_kind', request.mandate_kind));
    -- The final comparison, last of everything this admission locks: the dossier key exclusively, which each transaction
    -- that marks a change of the dossier holds shared until it commits. A change committed after the count above (an
    -- annex back to classification, a saved restriction) is counted here, and the admission rolls back with it.
    perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(request.project_id));
    if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
      raise exception 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' using errcode = '40001';
    end if;
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'evaluating', null, null, null);
      return query select 'stale'::text, null::uuid, null::text;
      return;
    when unique_violation then
      -- Another request of the affaire was admitted between the check above and this one: it runs, this one waits.
      get stacked diagnostics violated = constraint_name;
      if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'blocked', 'ANOTHER_ANALYSIS_RUNNING', null, p_mark);
      return query select 'blocked'::text, null::uuid, 'ANOTHER_ANALYSIS_RUNNING'::text;
      return;
    when sqlstate '23514' then
      if sqlerrm <> 'TAKEOFF_JOB_ADMISSION_LIMIT' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'blocked', 'ADMISSION_LIMIT', null, p_mark);
      return query select 'blocked'::text, null::uuid, 'ADMISSION_LIMIT'::text;
      return;
    when sqlstate '42501' then
      -- A source that moved since the evaluation: evaluate the dossier again, nothing was admitted.
      if sqlerrm not in ('TAKEOFF_PREPARATION_SOURCE_STALE', 'TAKEOFF_PREPARATION_SOURCE_MISMATCH', 'TAKEOFF_PREPARATION_REQUIRED') then
        raise;
      end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'evaluating', null, null, null);
      return query select 'stale'::text, null::uuid, null::text;
      return;
  end;
  return query select 'admitted'::text, admitted_job, null::text;
end;
$$;


-- 3. Once both cut-offs are set, a member's job is a request's job. A trigger of the table, so that every path a member
-- inserts by (the admission RPC public.admit_prepared_takeoff_job, an older direct insert) is closed alike; the service
-- role and the request's own admission are not concerned. A job that already exists reaches its unique key unchanged.
create function private.guard_takeoff_job_outside_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.launch_request_id is null and current_setting('role', true) = 'authenticated' and private.takeoff_launch_active()
    and not exists (select 1 from public.takeoff_jobs j where j.id = new.id) then
    raise exception 'TAKEOFF_JOB_REQUEST_REQUIRED' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_job_outside_request() from public, anon, authenticated, service_role;
create trigger aac_guard_takeoff_job_outside_request before insert on public.takeoff_jobs
  for each row when (new.launch_request_id is null) execute function private.guard_takeoff_job_outside_request();

-- 4. The send of a reviewed takeoff, as 20261121085058 wrote it, with the receipt's comparison between jobs without a
-- request only.
create or replace function private.takeoff_send_execute(p_actor uuid, p_tenant uuid, p_role public.tenant_role, p_request uuid,
  p_command jsonb, p_dry_run boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  kind text := p_command #>> '{destination,kind}';
  target_job_id uuid := (p_command ->> 'job_id')::uuid;
  job public.takeoff_jobs%rowtype;
  project public.estimate_projects%rowtype;
  existing public.takeoff_send_receipts%rowtype;
  target_version uuid;
  source_version uuid;
  target_engine smallint;
  version_created boolean := false;
  created_lock uuid;
  section_id uuid;
  section_created boolean := false;
  section_position integer;
  current_versions jsonb;
  stale_reason text;
  created jsonb;
  applied record;
  links jsonb;
  created_ids uuid[];
  accumulated uuid[] := '{}'::uuid[];
  removed uuid[] := '{}'::uuid[];
  entry record;
  rules_written integer;
  previous_writer text;
  outcome jsonb;
  result jsonb;
  plan jsonb;
  mapped jsonb;
begin
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id;
  if not found or job.tenant_id is distinct from p_tenant then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant::text, 0));
  if p_dry_run and kind = 'existing_draft' then
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = p_tenant
    for share;
  else
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = p_tenant
    for no key update;
  end if;
  if project.id is null or project.is_archived
    or (p_role <> 'admin'::public.tenant_role and project.user_id is distinct from p_actor) then
    raise exception 'TAKEOFF_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501';
  end if;
  -- The affaire held, a command of this request that committed meanwhile is visible now (two sends of one affaire wait
  -- for each other on its row).
  if not p_dry_run then
    select * into existing from public.takeoff_send_receipts as stored
    where stored.tenant_id = p_tenant and stored.request_id = p_request;
    if found then
      return pg_catalog.jsonb_build_object('replay', existing.id);
    end if;
  end if;
  -- The affaire's versions, compared as soon as its row is held and before any other wait: a command read before a version
  -- was created or changed status (a first draft on an affaire that has one) is refused at once, and holds the affaire no
  -- longer than that, so that the saves of that version's editor are not refused meanwhile. Their dates are compared again
  -- once every lock is held, below.
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status)
        order by version.id::text), '[]'::jsonb)
      from public.estimate_versions as version where version.project_id = job.project_id and version.tenant_id = p_tenant)
    is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', expected.value -> 'id',
        'status', expected.value -> 'status') order by expected.value ->> 'id'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(p_command #> '{expected,versions}') as expected(value)) then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
  end if;
  if kind = 'existing_draft' then
    target_version := (p_command #>> '{destination,version_id}')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || target_version::text, 0));
    -- The editor's lock, in the editor's order: its lease acquisition takes this key, then the version's row through the
    -- lease's foreign key (public.assign_draft_lock_tenant_id).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_version::text, 0));
    if p_dry_run then
      -- As the editor's acquisition does first, expired leases go (here with the preview's rollback). A member who
      -- edits the draft refuses the preview before it takes anything their saves need.
      delete from public.draft_locks as expired
      where expired.version_id = target_version and expired.tenant_id = p_tenant
        and expired.expires_at <= pg_catalog.statement_timestamp();
      if exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
        and lock_row.user_id <> p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
        raise exception 'TAKEOFF_SEND_DRAFT_LOCKED' using errcode = '55P03';
      end if;
    end if;
    select version.calc_engine_version into target_engine from public.estimate_versions as version
    where version.id = target_version and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status = 'draft'::public.estimate_status
    for no key update;
    if not found then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || target_job_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0));
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id for update;
  if job.estimate_version_id is not null or job.status is distinct from 'completed'::public.takeoff_job_status then
    if exists (select 1 from public.takeoff_send_receipts as stored
      where stored.job_id = target_job_id and stored.command_kind = 'send') then
      raise exception 'TAKEOFF_SEND_ALREADY_SENT' using errcode = '40001';
    end if;
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;
  -- The mapping rules the preview's plan comes from stay as they are until this transaction ends.
  perform 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = p_tenant for share;

  -- What the preview evaluated, read again under the locks.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status,
      'updated_at', version.updated_at) order by version.id), '[]'::jsonb)
    into current_versions
  from public.estimate_versions as version
  where version.project_id = job.project_id and version.tenant_id = p_tenant;
  stale_reason := case
    when current_versions is distinct from p_command #> '{expected,versions}' then 'destination_changed'
    when kind = 'first_draft' and current_versions <> '[]'::jsonb then 'destination_changed'
    when public.takeoff_rule_job_stamp(p_tenant, job.project_id, target_job_id) is distinct from p_command #>> '{expected,job_stamp}'
      then 'takeoff_changed'
    when public.takeoff_mapping_rules_stamp(p_tenant) is distinct from p_command #>> '{expected,mapping_stamp}' then 'mapping_changed'
    when kind = 'existing_draft' and public.takeoff_send_peers_stamp(p_tenant, target_version)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
    -- A copy is compared with the takeoffs of the version it copies (they become the copy's peers).
    when kind = 'version_copy' and public.takeoff_send_peers_stamp(p_tenant, (p_command #>> '{destination,source_version_id}')::uuid)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
  end;
  if stale_reason is not null then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', stale_reason)::text;
  end if;

  if kind = 'first_draft' then
    section_id := (p_command #>> '{section,id}')::uuid;
    created := public.persist_estimate_creation_atomic(p_tenant, p_actor, job.project_id, null,
      p_command #> '{destination,version_payload}',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'parent_id', null, 'item_type', 'section',
        'position', 1, 'title', btrim(p_command #>> '{section,title}'))),
      null);
    target_version := (created #>> '{version,id}')::uuid;
    version_created := true;
    section_created := true;
  elsif kind = 'version_copy' then
    source_version := (p_command #>> '{destination,source_version_id}')::uuid;
    if not exists (select 1 from public.estimate_versions as version where version.id = source_version
      and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status <> 'draft'::public.estimate_status) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
    target_version := public.duplicate_estimate_version(source_version, false);
    version_created := true;
  end if;
  select version.calc_engine_version into target_engine from public.estimate_versions as version
  where version.id = target_version and version.tenant_id = p_tenant;

  -- A version that holds a DPGF line is sent through its reconciliation, which needs the job on the version first:
  -- refused before anything is attached (the preview names this blocker first and offers no confirmation).
  if exists (select 1 from public.estimate_items as item where item.version_id = target_version and item.tenant_id = p_tenant
    and item.item_type = 'line'::public.estimate_item_type and item.source_provider = 'dpgf') then
    raise exception 'TAKEOFF_SEND_DPGF_RECONCILIATION_REQUIRED' using errcode = '22023';
  end if;

  -- The section that receives the lines: created here for a new version or on request, else one of the draft's.
  if not section_created then
    section_id := (p_command #>> '{section,id}')::uuid;
    if (p_command #>> '{section,kind}') = 'new' then
      select coalesce(max(item.position), 0) + 1 into section_position from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = p_tenant and item.parent_id is null;
      previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
      if target_engine = 3 then
        perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
      end if;
      insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
      values (section_id, p_tenant, target_version, null, 'section'::public.estimate_item_type, section_position,
        btrim(p_command #>> '{section,title}'));
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
      section_created := true;
    elsif not exists (select 1 from public.estimate_items as item where item.id = section_id
      and item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'section'::public.estimate_item_type) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'estimate_changed')::text;
    end if;
  end if;

  -- What the destination holds before the send, and a reference of each item that does not depend on this run: its id in
  -- an existing draft, the id of the item it copies in a copy (copies map by position, as duplicate_estimate_version
  -- maps them), « new » for the section this command creates. The outcome compares the dry run with the send by them.
  drop table if exists pg_temp._takeoff_send_refs;
  create temporary table _takeoff_send_refs (id uuid primary key, ref text not null) on commit drop;
  if kind = 'existing_draft' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    select item.id, 'item:' || item.id::text from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = p_tenant;
  elsif kind = 'version_copy' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    with recursive source_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = source_version and item.parent_id is null
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join source_tree as parent on parent.id = child.parent_id where child.version_id = source_version
    ), copy_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = target_version and item.parent_id is null and item.id <> section_id
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join copy_tree as parent on parent.id = child.parent_id where child.version_id = target_version
    )
    select copied.id, 'copy:' || original.id::text from copy_tree as copied join source_tree as original on original.path = copied.path;
  end if;
  if section_created then
    insert into pg_temp._takeoff_send_refs (id, ref) values (section_id, 'new') on conflict (id) do update set ref = 'new';
  end if;
  drop table if exists pg_temp._takeoff_send_before;
  create temporary table _takeoff_send_before on commit drop as
  select item.id, item.parent_id, item.title,
    private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) as unit,
    case when private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) is null
      then item.pricing_status::text end as unitless_status,
    item.quantity, item.unit_price_ht_cents, item.source_job_id, item.updated_at,
    pg_catalog.jsonb_build_object('file', item.source_file_name, 'page', item.source_page,
      'takeoff_item_id', coalesce(item.source_metadata ->> 'takeoff_item_id',
        item.source_metadata #>> '{takeoff_length_rounding,representative_item_id}')) as source
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;

  -- The application checks the actor's draft lock. A version created here has no other holder: its lock lives only in
  -- this transaction. An existing draft is locked by the actor before the send, as for any application; its dry run
  -- uses the actor's lease as it is, or, when the draft has none (another member's refused the preview above, expired
  -- ones went), takes one for its rolled-back run. No lease is ever changed.
  if version_created then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    returning id into created_lock;
  elsif p_dry_run and not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
    and lock_row.user_id = p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid());
  end if;

  -- The historical receipt of a launch on a version (takeoff_jobs_prepared_plan_receipt_uidx) holds one job per version,
  -- plan set, preparation revision, level and provider, among the jobs without a launch request (20261121170448). A
  -- versionless job of that same launch is refused by name here, between jobs without a request only: two requests may
  -- read one preparation revision, and each of their jobs may be sent to one draft.
  if job.launch_request_id is null and exists (select 1 from public.takeoff_jobs as other
    where other.tenant_id = p_tenant and other.launch_request_id is null
      and other.estimate_version_id = target_version and other.id <> target_job_id
      and other.plan_set_id = job.plan_set_id and other.level = job.level
      and other.execution_provider is not distinct from job.execution_provider
      and other.preparation_snapshot is not null
      and other.preparation_snapshot ->> 'preparation_revision' = job.preparation_snapshot ->> 'preparation_revision') then
    raise exception 'TAKEOFF_SEND_PREPARATION_ALREADY_SENT' using errcode = '22023';
  end if;

  -- The door: the job's version goes from NULL to this draft of its affaire, once, by this command's permit.
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  values (target_job_id, p_tenant, job.project_id, target_version);
  update public.takeoff_jobs as attached set estimate_version_id = target_version where attached.id = target_job_id;
  if exists (select 1 from private.takeoff_job_attachment_permits as permit where permit.job_id = target_job_id) then
    raise exception 'TAKEOFF_SEND_PERMIT_NOT_CONSUMED' using errcode = 'P0001';
  end if;

  -- The controls that compare with other takeoffs and with the DPGF, evaluated for this destination by the preview from
  -- the state checked above: every line with rule inputs receives them, or nothing is sent.
  select pg_catalog.count(*) into rules_written
  from takeoff_internal.persist_rule_results(p_tenant, target_version, array[target_job_id], p_command -> 'rule_results',
    p_command -> 'rule_transforms');
  if rules_written <> pg_catalog.jsonb_array_length(p_command -> 'rule_results')
    or exists (select 1 from public.takeoff_items as item
      cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(item.rule_results) = 'array'
        then item.rule_results else '[]'::jsonb end) as rule_result(value)
      where item.job_id = target_job_id and item.tenant_id = p_tenant
        and rule_result.value #>> '{details,cross_job_comparison}' = 'deferred') then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'rules_changed')::text;
  end if;

  -- An administrator's override, bound to this destination, checked again by the application's trigger.
  if pg_catalog.jsonb_typeof(p_command -> 'override') = 'object' then
    if p_role <> 'admin'::public.tenant_role then
      raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
    end if;
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.override',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor,
        'metadata', (p_command -> 'override') || pg_catalog.jsonb_build_object('estimate_version_id', target_version)));
  end if;

  -- The lines a mapping rule changes (renamed, classified or set aside), read before the writer applies the plan: what
  -- the application's audit names for a command of format 2.
  mapped := (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', source.id,
      'rule_id', private.takeoff_uuid_or_null(plan_entry.value -> 'rule_id'), 'action', plan_entry.value ->> 'action')
      order by plan_entry.ordinality), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(p_command -> 'mapping_plan') with ordinality as plan_entry(value, ordinality)
    join public.takeoff_items as source on source.id = private.takeoff_uuid_or_null(plan_entry.value -> 'item_id')
      and source.job_id = target_job_id and source.tenant_id = p_tenant
    where plan_entry.value ->> 'action' is distinct from 'none' and not source.is_excluded);

  select result_row.* into applied from public.apply_takeoff_job_with_page_decisions(target_job_id, 'append', section_id,
    p_command -> 'mapping_plan', p_command -> 'page_decisions', null) as result_row;
  links := coalesce(applied.item_links, '[]'::jsonb);
  created_ids := coalesce(applied.created_ids, '{}'::uuid[]);

  -- An engine 2 line names no takeoff line of its own. Each line this send creates there names the ones it sums, as a
  -- DPGF line names the measures it keeps (takeoff_quantity_policy): a later send can add to it (plan A then plan B)
  -- and a page re-read finds it.
  if target_engine is distinct from 3 then
    update public.estimate_items as line set source_metadata = coalesce(line.source_metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('takeoff_contributions', pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
        'item_ids', sources.ids, 'parts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id,
          'request_id', p_request, 'takeoff_item_ids', sources.ids, 'quantity', pg_catalog.trim_scale(line.quantity)))))
    from (select (output.value ->> 'estimate_item_id')::uuid as estimate_item_id,
        pg_catalog.jsonb_agg(output.value -> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id') as ids
      from pg_catalog.jsonb_array_elements(links) as output(value) group by 1) as sources
    where line.id = sources.estimate_item_id and line.id = any(created_ids) and line.version_id = target_version
      and line.tenant_id = p_tenant and line.source_provider = 'takeoff'
      and pg_catalog.cardinality(private.takeoff_estimate_line_item_ids(line.source_metadata, line.source_job_id)) = 0;
  end if;

  -- Earlier takeoff lines of the same item (plan A sent 3, plan B adds 2: one line of 5). The preview proposed each part,
  -- with the line as it read it; the line must still be that line, measured by its takeoff lines only (never a quantity
  -- typed by hand), in the section, of the same title and unit, with no hypothesis nor rounded length on either side.
  -- On both engines: engine 3 completes the line as its writer does, engine 2 recalculates the version (as the DPGF
  -- composition does); the price, unit, hours and supplier stay the line's.
  for entry in
    select part.takeoff_item_id, part.estimate_item_id, part.expected_updated_at, part.expected_quantity, link.created_id
    from pg_catalog.jsonb_to_recordset(p_command -> 'accumulations')
      as part(takeoff_item_id uuid, estimate_item_id uuid, expected_updated_at timestamptz, expected_quantity numeric)
    left join lateral (select (output.value ->> 'estimate_item_id')::uuid as created_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'takeoff_item_id')::uuid = part.takeoff_item_id) as link on true
    order by part.estimate_item_id, part.takeoff_item_id
  loop
    if entry.created_id is null or not entry.created_id = any(created_ids)
      or entry.estimate_item_id = any(created_ids) or entry.estimate_item_id = any(removed) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;
    perform 1 from public.estimate_items as earlier where earlier.id = entry.estimate_item_id for update;
    if not exists (
      select 1
      from public.estimate_items as earlier
      join public.estimate_items as added on added.id = entry.created_id and added.version_id = earlier.version_id
      join public.takeoff_items as source on source.id = entry.takeoff_item_id and source.job_id = target_job_id
      cross join lateral (select private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) as ids) as sources
      cross join lateral (select pg_catalog.sum(own.quantity) as raw, pg_catalog.count(*) as readable
        from public.takeoff_items as own where own.id = any(sources.ids) and own.tenant_id = p_tenant) as measured
      where earlier.id = entry.estimate_item_id and earlier.version_id = target_version and earlier.tenant_id = p_tenant
        and earlier.item_type = 'line'::public.estimate_item_type and earlier.parent_id = section_id
        and earlier.source_provider = 'takeoff'
        -- The line as the preview read it, before this send (the engine 2 writer recalculates and dates anew every line of
        -- the version); a second part for the same line finds it as the first part left it.
        and (entry.estimate_item_id = any(accumulated)
          or exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = entry.estimate_item_id
            and before_line.updated_at = entry.expected_updated_at and before_line.quantity = entry.expected_quantity
            and earlier.quantity = before_line.quantity))
        and pg_catalog.cardinality(sources.ids) > 0 and measured.readable = pg_catalog.cardinality(sources.ids)
        and measured.raw = earlier.quantity
        and not (earlier.source_metadata ? 'takeoff_length_rounding') and not (earlier.source_metadata ? 'takeoff_provision')
        and not (added.source_metadata ? 'takeoff_length_rounding') and not (added.source_metadata ? 'takeoff_provision')
        and public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is null
        and added.parent_id = earlier.parent_id
        and lower(regexp_replace(btrim(added.title), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(earlier.title), '\s+', ' ', 'g'))
        -- The same unit as the outcome shows (on engine 2 the description, where the unit is kept); lines without one by
        -- their pricing status.
        and (private.takeoff_send_line_unit(target_engine, added.unit_code, added.description),
            case when private.takeoff_send_line_unit(target_engine, added.unit_code, added.description) is null
              then added.pricing_status end)
          is not distinct from (private.takeoff_send_line_unit(target_engine, earlier.unit_code, earlier.description),
            case when private.takeoff_send_line_unit(target_engine, earlier.unit_code, earlier.description) is null
              then earlier.pricing_status end)
    ) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;

    previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    if target_engine = 3 then
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
    end if;
    -- Only the quantity and the provenance move: price, unit, hours, supplier and status stay the line's. Its parts are
    -- those of its active sources (never a part a page replacement took out), then this send's.
    update public.estimate_items as earlier set
      quantity = earlier.quantity + added.quantity,
      source_job_id = target_job_id,
      source_metadata = coalesce(earlier.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_contributions',
        pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
          'item_ids', (select pg_catalog.jsonb_agg(source_id order by ordinal) from pg_catalog.unnest(
              private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) || entry.takeoff_item_id)
              with ordinality as listed(source_id, ordinal)),
          'parts', private.takeoff_line_parts(private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id),
              earlier.source_metadata #> '{takeoff_contributions,parts}', p_tenant)
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id, 'request_id', p_request,
              'takeoff_item_ids', pg_catalog.jsonb_build_array(entry.takeoff_item_id),
              'quantity', pg_catalog.trim_scale(added.quantity))))),
      updated_at = pg_catalog.statement_timestamp()
    from public.estimate_items as added
    where earlier.id = entry.estimate_item_id and added.id = entry.created_id;
    delete from public.estimate_items as added where added.id = entry.created_id and added.version_id = target_version;
    if target_engine = 3 then
      perform public.estimate_v3_complete_entry_for_writer(target_version, array[entry.estimate_item_id]);
    end if;
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
    removed := removed || entry.created_id;
    accumulated := accumulated || entry.estimate_item_id;
    links := (select pg_catalog.jsonb_agg(case when (output.value ->> 'takeoff_item_id')::uuid = entry.takeoff_item_id
        then pg_catalog.jsonb_build_object('takeoff_item_id', entry.takeoff_item_id, 'estimate_item_id', entry.estimate_item_id)
        else output.value end order by output.ordinality)
      from pg_catalog.jsonb_array_elements(links) with ordinality as output(value, ordinality));
  end loop;
  if target_engine is distinct from 3 and pg_catalog.cardinality(accumulated) > 0 then
    perform public.recalculate_takeoff_estimate_version(target_version, p_tenant);
  end if;

  if created_lock is not null then
    delete from public.draft_locks as lock_row where lock_row.id = created_lock;
  end if;

  -- What the send leaves, against what the destination held: the lines created, changed and removed, each in its
  -- section, and where each takeoff line went. The dry run of the preview computes it the same way, from the same state.
  drop table if exists pg_temp._takeoff_send_after;
  create temporary table _takeoff_send_after on commit drop as
  select item.id, item.parent_id, item.title,
    private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) as unit,
    case when private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) is null
      then item.pricing_status::text end as unitless_status,
    item.quantity, item.unit_price_ht_cents, item.source_job_id,
    (select pg_catalog.jsonb_agg(output.value ->> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id')
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'estimate_item_id')::uuid = item.id) as takeoff_item_ids,
    -- The line's own source: for a line that groups equal lengths, the measure that represents it.
    pg_catalog.jsonb_build_object('file', item.source_file_name, 'page', item.source_page,
      'takeoff_item_id', coalesce(item.source_metadata ->> 'takeoff_item_id',
        item.source_metadata #>> '{takeoff_length_rounding,representative_item_id}')) as source
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;
  with changes as (
    select 'created' as change, null::text as ref, refs.ref as section, after_line.title, after_line.unit,
      after_line.unitless_status, after_line.quantity,
      null::numeric as quantity_before, after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb) as takeoff_item_ids,
      after_line.source
    from pg_temp._takeoff_send_after as after_line
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)
    union all
    select 'changed', line_ref.ref, refs.ref, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
      before_line.quantity,
      after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb), after_line.source
    from pg_temp._takeoff_send_after as after_line
    join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = after_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
        after_line.unit_price_ht_cents, after_line.source_job_id)
      is distinct from (before_line.parent_id, before_line.title, before_line.unit, before_line.unitless_status,
        before_line.quantity, before_line.unit_price_ht_cents, before_line.source_job_id)
    union all
    select 'removed', line_ref.ref, refs.ref, before_line.title, before_line.unit, before_line.unitless_status,
      before_line.quantity, before_line.quantity,
      before_line.unit_price_ht_cents, '[]'::jsonb, before_line.source
    from pg_temp._takeoff_send_before as before_line
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = before_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = before_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)
  )
  select pg_catalog.jsonb_build_object('format_version', 1, 'engine', target_engine,
    -- A version this send creates, with the settings it is stored with — the ones the payload names and the ones the
    -- creation takes from the tenant's policy (the sale coefficients of engine 3): a policy changed since the preview
    -- changes the outcome. Not its identifier nor its date (the day it is created).
    'version', case when version_created then (select pg_catalog.jsonb_build_object('title', created_version.title,
        'validite_jours', created_version.validite_jours, 'margin_multiplier', created_version.margin_multiplier,
        'margin_mode', created_version.margin_mode, 'currency', created_version.currency, 'margin_bp', created_version.margin_bp,
        'discount_bp', created_version.discount_bp, 'discount_amount_cents', created_version.discount_amount_cents,
        'discount_mode', created_version.discount_mode, 'discount_steps', created_version.discount_steps,
        'global_coefficient', created_version.global_coefficient, 'tax_rate_bp', created_version.tax_rate_bp,
        'rounding_mode', created_version.rounding_mode, 'rounding_step_cents', created_version.rounding_step_cents,
        'max_section_depth', created_version.max_section_depth, 'calc_engine_version', created_version.calc_engine_version,
        'contractor_role', created_version.contractor_role, 'sale_coefficient_fo', created_version.sale_coefficient_fo,
        'sale_coefficient_mo', created_version.sale_coefficient_mo)
      from public.estimate_versions as created_version where created_version.id = target_version) end,
    'sections_created', case when section_created
      then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('title', btrim(p_command #>> '{section,title}')))
      else '[]'::jsonb end,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('change', change.change, 'ref', change.ref,
        'section', change.section, 'title', change.title, 'unit', change.unit, 'unitless_status', change.unitless_status,
        'quantity', pg_catalog.trim_scale(change.quantity),
        'quantity_before', pg_catalog.trim_scale(change.quantity_before), 'unit_price_ht_cents', change.unit_price_ht_cents,
        'takeoff_item_ids', change.takeoff_item_ids, 'source', change.source)
      order by change.change, change.section collate "C", change.title collate "C", change.unit collate "C",
        change.unitless_status collate "C", change.quantity,
        change.ref collate "C", change.takeoff_item_ids::text collate "C") from changes as change), '[]'::jsonb),
    'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', output.value ->> 'takeoff_item_id',
        'target', case when exists (select 1 from pg_temp._takeoff_send_before as before_line
          where before_line.id = (output.value ->> 'estimate_item_id')::uuid) then 'existing_line' else 'new_line' end,
        'line', (select refs.ref from pg_temp._takeoff_send_refs as refs where refs.id = (output.value ->> 'estimate_item_id')::uuid),
        'section', (select refs.ref from pg_temp._takeoff_send_after as after_line
          join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
          where after_line.id = (output.value ->> 'estimate_item_id')::uuid))
      order by output.value ->> 'takeoff_item_id') from pg_catalog.jsonb_array_elements(links) as output(value)), '[]'::jsonb))
  into outcome;

  -- What the member confirmed is what is written: any other line, quantity, unit, section or target refuses everything.
  if not p_dry_run and outcome is distinct from p_command -> 'expected_outcome' then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'outcome_changed')::text;
  end if;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('outcome', outcome);
  end if;

  -- The parts as stored: each one names its takeoff line, its real target (the line it entered, new or earlier, and the
  -- section that line is in), the page, the plan's attested content, the source of its quantity and the revision of its
  -- evidence, read here from the rows the application wrote from.
  plan := pg_catalog.jsonb_build_object('format_version', 1,
    'destination', pg_catalog.jsonb_build_object('kind', kind, 'version_id', target_version, 'source_version_id', source_version,
      'version_created', version_created),
    'price_rules_ignored', coalesce(p_command -> 'price_rules_ignored', '[]'::jsonb),
    'sections', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'created', section_created,
      'title', (select item.title from public.estimate_items as item where item.id = section_id))),
    'parts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id, 'designation', source.designation,
          'estimate_item_id', target_line.id, 'section_id', target_line.parent_id,
          'target', case when before_line.id is not null
            then pg_catalog.jsonb_build_object('kind', 'existing_line', 'estimate_item_id', before_line.id,
              'quantity_before', pg_catalog.trim_scale(before_line.quantity))
            else pg_catalog.jsonb_build_object('kind', 'new_line') end,
          'quantity', pg_catalog.trim_scale(source.quantity), 'unit', source.unit,
          'source', pg_catalog.jsonb_build_object('job_id', target_job_id, 'answer_id', null, 'observation_id', source.id,
            'plan_file_id', source.metadata #>> '{source_document,plan_file_id}', 'source_file_name', source.source_file_name,
            'source_page', source.source_page,
            'quantity_source', case
              when public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is not null
                then 'hypothesis:' || public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category)
              when source.quantity_entry_category is not null then 'entered' else 'measured' end,
            -- The plan's bytes as the takeoff attested them (its preparation), never the plan centre's current file.
            'plan_content_hash', (select attested.value ->> 'content_hash'
              from pg_catalog.jsonb_array_elements(job.preparation_snapshot #> '{preparation,sources}') as attested(value)
              where attested.value ->> 'document_id' = source.metadata #>> '{source_document,plan_file_id}' limit 1),
            'evidence_revision', pg_catalog.md5(pg_catalog.jsonb_build_array(source.updated_at, source.evidence,
              source.source_file_name, source.source_page, source.metadata,
              (select pg_catalog.jsonb_agg(geometry.geometry - 'transform' order by geometry.vector_page_id)
                from public.takeoff_item_geometries as geometry where geometry.takeoff_item_id = source.id))::text)))
        order by source.id)
      from pg_catalog.jsonb_array_elements(links) as output(value)
      join public.takeoff_items as source on source.id = (output.value ->> 'takeoff_item_id')::uuid
        and source.job_id = target_job_id and source.tenant_id = p_tenant
      join pg_temp._takeoff_send_after as target_line on target_line.id = (output.value ->> 'estimate_item_id')::uuid
      left join pg_temp._takeoff_send_before as before_line on before_line.id = target_line.id), '[]'::jsonb));

  result := pg_catalog.jsonb_build_object(
    'format_version', 1,
    'version_id', target_version,
    'version_created', version_created,
    'source_version_id', source_version,
    'outcome', outcome,
    'sections_created', case when section_created then pg_catalog.jsonb_build_array(section_id) else '[]'::jsonb end,
    'sections_changed', coalesce((select pg_catalog.jsonb_agg(distinct touched.section_id) from (
        select after_line.parent_id as section_id from pg_temp._takeoff_send_after as after_line
        left join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
        where after_line.parent_id is not null and (before_line.id is null
          or (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
            after_line.unit_price_ht_cents, after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title,
            before_line.unit, before_line.unitless_status, before_line.quantity, before_line.unit_price_ht_cents,
            before_line.source_job_id))
        union
        select before_line.parent_id from pg_temp._takeoff_send_before as before_line
        left join pg_temp._takeoff_send_after as after_line on after_line.id = before_line.id
        where before_line.parent_id is not null and (after_line.id is null or after_line.parent_id is distinct from before_line.parent_id)
      ) as touched), '[]'::jsonb),
    'lines_created', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id) from pg_temp._takeoff_send_after as after_line
      where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)), '[]'::jsonb),
    'lines_changed', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id)
      from pg_temp._takeoff_send_after as after_line join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
      where (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
          after_line.unit_price_ht_cents, after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title,
          before_line.unit, before_line.unitless_status, before_line.quantity, before_line.unit_price_ht_cents,
          before_line.source_job_id)), '[]'::jsonb),
    'lines_removed', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', before_line.id,
        'section_id', before_line.parent_id, 'title', before_line.title, 'quantity', pg_catalog.trim_scale(before_line.quantity),
        'unit', before_line.unit) order by before_line.id)
      from pg_temp._takeoff_send_before as before_line
      where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)), '[]'::jsonb),
    'item_links', links,
    'ignored_count', applied.ignored_count,
    'scope', applied.scope);
  result := result || pg_catalog.jsonb_build_object(
    'created_count', pg_catalog.jsonb_array_length(result -> 'lines_created'),
    'updated_count', pg_catalog.jsonb_array_length(result -> 'lines_changed'),
    'removed_count', pg_catalog.jsonb_array_length(result -> 'lines_removed'),
    'sent_count', pg_catalog.jsonb_array_length(links),
    'accumulated_count', pg_catalog.cardinality(accumulated));

  -- A command of format 2: the application's audit rows, written here once, in the transaction of the send (a replay
  -- returns the receipt and writes nothing) — the application completed, and each mapping action applied to the line
  -- that remains: a line set aside by a rule, or a line this send created. An action the page writer suppressed (a line
  -- paired with an earlier line keeps that line's title and category) or that an addition dropped (the line it created
  -- was merged into an earlier line) applied to nothing that remains. A command of format 1 comes from the previous
  -- application, whose server still writes them itself.
  if p_command -> 'format_version' = '2'::jsonb then
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.completed',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.completed', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor, 'metadata', pg_catalog.jsonb_build_object('estimate_version_id', target_version,
          'applied_items_count', (result ->> 'created_count')::integer + (result ->> 'updated_count')::integer,
          'excluded_items_count', coalesce((result ->> 'ignored_count')::integer, 0))));
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    select p_tenant, p_actor, 'takeoff_items', target_job_id, target_version, 'takeoff.mapping.applied',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.mapping.applied', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor, 'metadata', pg_catalog.jsonb_build_object('job_id', target_job_id,
          'item_id', mapped_line.value -> 'item_id', 'rule_id', mapped_line.value -> 'rule_id',
          'action', mapped_line.value -> 'action', 'estimate_item_id', written.estimate_item_id))
    from pg_catalog.jsonb_array_elements(mapped) with ordinality as mapped_line(value, ordinality)
    -- The line each one entered (none for a line a rule set aside), read once from the final links.
    left join (select distinct on (output.value ->> 'takeoff_item_id') output.value ->> 'takeoff_item_id' as takeoff_item_id,
        output.value -> 'estimate_item_id' as estimate_item_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      order by output.value ->> 'takeoff_item_id') as written on written.takeoff_item_id = mapped_line.value ->> 'item_id'
    where mapped_line.value ->> 'action' = 'skip'
      or exists (select 1 from pg_temp._takeoff_send_after as after_line
        where after_line.id = private.takeoff_uuid_or_null(written.estimate_item_id)
          and not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id))
    order by mapped_line.ordinality;
  end if;
  return pg_catalog.jsonb_build_object('version_id', target_version, 'project_id', job.project_id, 'owner_id', project.user_id,
    'plan', plan, 'result', result);
end;
$$;


commit;
