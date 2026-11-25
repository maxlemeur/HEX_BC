begin;

-- A change to classified_at alone rotates the generation in a BEFORE trigger.
-- UPDATE OF plan_copy_generation does not fire for that implicit write. The
-- filename and provider also participate in the current-copy predicate.
create trigger zz_mark_takeoff_launch_copy_source_change
  after update of classified_at, file_name, source_provider on public.affaire_intake_documents
  for each row when ((old.classified_at, old.file_name, old.source_provider)
    is distinct from (new.classified_at, new.file_name, new.source_provider))
  execute function private.mark_takeoff_launch_dossier('document');

create or replace function private.launch_manual_takeoff_command(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_plan_set_id uuid,
  p_preparation_revision integer, p_module_default boolean, p_digest text, p_named_plans boolean
) returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  running record;
  answer record;
  predecessor_request uuid;
  admitted_jobs uuid[];
  violated text;
  running_unrequested uuid;
  decided_mark bigint;
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
  -- The affaire, shared, first (20261122030312): a send holds the affaire before its job and its request's row; this
  -- command's rows (its record, its request, its jobs) lock the affaire too. Taken first, the command waits for such a send
  -- holding nothing it needs. A Mac's claim of a retry takes nothing of the affaire (its job, then the affaire's key and
  -- its automatic request, 20261121193413): it never waits for this lock.
  perform 1 from public.estimate_projects as project_row
  where project_row.id = p_project_id and project_row.tenant_id = p_tenant_id for share;
  -- The analysis it replaces, before the affaire's key and its automatic request, when it was launched outside any request
  -- (its Mac's claim of a retry holds that row and then waits for the key: the restart guard of 20261121193413) or when it
  -- has ended (completed, sent or canceled: no worker holds it). A send or a preview of it holds that row, then a key share
  -- of its request's row; this command's request names it (a key share), and it holds the affaire's automatic request
  -- (FOR UPDATE), which that request may be: taken here, the key share waits for such a send or preview holding nothing it
  -- needs (20261122030312). A running analysis is not locked early: its worker holds its row, and a refused relaunch never
  -- waits for it (20261121193413).
  if p_predecessor_job_id is not null then
    perform 1 from public.takeoff_jobs j where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id
      and j.project_id = p_project_id
      and (j.launch_request_id is null
        or j.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status,
          'canceled'::public.takeoff_job_status))
    for key share;
  end if;
  -- Commands and reservations of one affaire are serialized on its key: the replay and the one-running rule read
  -- committed rows, and the automatic request a confirmation reserved is always found.
  perform private.lock_takeoff_launch_commands(p_project_id);
  for answer in select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key, p_digest) loop
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
  -- An automatic start that can still begin without a new dossier change (its eligible payer's Mac, or a gesture this
  -- member may make) is taken on from the affaire's takeoff zone: refused, nothing is recorded. One that waits for a
  -- dossier change or for nobody is set aside below by this explicit analysis.
  decided_mark := private.takeoff_launch_mark_position(p_tenant_id, p_project_id);
  if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
      and private.takeoff_automatic_request_can_start(r, p_actor)) then
    raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
  end if;
  -- The first analysis only on an affaire that has none, whatever launched it: any other command names the analysis it
  -- replaces or extends.
  if p_intent = 'initial' and exists (select 1 from public.takeoff_jobs j
      where j.tenant_id = p_tenant_id and j.project_id = p_project_id) then
    raise exception 'TAKEOFF_LAUNCH_ANALYSIS_EXISTS' using errcode = '22023';
  end if;
  select r.id, private.takeoff_launch_first_job(r.id) as job
  into running from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
  if found then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end if;
  -- An analysis launched outside any request (the dialogue's launch on a version, before the activation) that has not
  -- ended runs too: the command is recorded with it, as with a running request, and no request is created.
  running_unrequested := private.takeoff_unrequested_analysis_running(p_tenant_id, p_project_id);
  if running_unrequested is not null then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', null, running_unrequested, p_actor);
    return query select 'already_running'::text, null::uuid, running_unrequested;
    return;
  end if;
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  if p_manifest -> 'format_version' = '2'::jsonb then
    perform private.assert_takeoff_command_plans(p_tenant_id, p_project_id, p_preparation_revision, p_snapshot, p_named_plans);
  end if;
  begin
    insert into public.takeoff_launch_requests (tenant_id, project_id, origin, intent, intent_key, command_digest,
      predecessor_request_id, predecessor_job_id, state, payer_id, mandate_kind, mandated_at,
      execution_host_id, mandate_selection, mandate_revision)
    values (p_tenant_id, p_project_id, 'manual', p_intent, p_intent_key, p_digest, predecessor_request, p_predecessor_job_id,
      'evaluating', p_actor, 'command', pg_catalog.clock_timestamp(), p_host, p_selection, 1)
    returning * into request;
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot,
      private.takeoff_launch_mark_position(p_tenant_id, p_project_id));
    admitted_jobs := private.insert_takeoff_launch_jobs(request, p_job);
    perform private.record_takeoff_launch_audit(request, p_actor, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', to_jsonb(admitted_jobs), 'manifest_digest', request.manifest_digest, 'intent', p_intent,
      'predecessor_job_id', p_predecessor_job_id, 'execution_host_id', p_host, 'mandate_kind', 'command')
      || case when request.manifest -> 'format_version' = '2'::jsonb then jsonb_build_object('format_version', 2) else '{}'::jsonb end);
    -- Before setting an automatic start aside: the dossier key exclusively, last of everything this command locks, as the
    -- automatic admission takes it. A dossier change committed since the decision above is counted, and a start it lets
    -- begin again is decided again, under the same lock: refused, nothing is recorded.
    perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(p_project_id));
    if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
        and r.origin = 'automatic' and private.takeoff_launch_request_open(r)) then
      if private.takeoff_launch_mark_position(p_tenant_id, p_project_id) <> decided_mark and exists (
          select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
            and private.takeoff_automatic_request_can_start(r, p_actor)) then
        raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
      end if;
    end if;
    -- The final dossier lock also serializes manual admission with a change of
    -- the selected copy or its piece, even on an affaire without an automatic
    -- request. Check the actual sealed plans for both command identities.
    if exists (
      select 1 from jsonb_array_elements(request.manifest -> 'plans') plan
      where not exists (
        select 1 from private.resolve_takeoff_plan_location_source(
          p_tenant_id, p_project_id, (plan ->> 'plan_file_id')::uuid
        ) source where source.current_copy
      )
    ) then
      raise exception 'TAKEOFF_LAUNCH_PLAN_COPY_STALE' using errcode = '40001';
    end if;
    -- An automatic start that had not begun is set aside by this explicit analysis, for good: it never spends later.
    update public.takeoff_launch_requests r set state = 'superseded', reason_code = null,
      reason_details = jsonb_build_object('request_id', request.id), evaluation_lease_token = null, evaluation_lease_expires_at = null,
      mandate_revision = r.mandate_revision + 1
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic'
      and r.state in ('evaluating', 'not_eligible', 'blocked');
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'admitted', request.id, admitted_jobs[1], p_actor);
  exception when unique_violation then
    -- Another request of the affaire was admitted meanwhile (an automatic admission that did not wait): the command's
    -- receipt records that one.
    get stacked diagnostics violated = constraint_name;
    if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
    select r.id, private.takeoff_launch_first_job(r.id) as job
    into running from public.takeoff_launch_requests r
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end;
  return query select 'admitted'::text, request.id, admitted_jobs[1];
end;
$$;

commit;
