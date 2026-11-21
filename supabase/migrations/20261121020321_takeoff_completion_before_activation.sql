-- Follow-up of 20261121011212_takeoff_analysis_completion.sql, to apply before the cutoff in
-- private.takeoff_completion_activation is set. While that table stays empty, one write of the previous application
-- changes, deliberately: a member who did not launch a job can no longer send it back to pending (42501). Otherwise
-- the requester and queue time of an accepted relaunch go to M3's own columns and the Mac's work to a private table,
-- which no previous writer reads, and everything else starts with activation. This migration takes no lock on
-- takeoff_jobs.
begin;

-- Every statement below takes its lock on a small table or a function. Give up instead of queueing the job
-- writers, whose trigger reads the activation row, behind a long transaction.
set local lock_timeout = '5s';

-- The owner sets the waiting rule with the cutoff. The defaults are stated in the pull request.
alter table private.takeoff_completion_activation
  add column pickup_grace interval not null default interval '15 minutes',
  add column wait_ceiling interval not null default interval '24 hours',
  add constraint takeoff_completion_activation_wait_check check (
    pickup_grace >= interval '10 minutes' and wait_ceiling >= interval '1 hour' and pickup_grace <= wait_ceiling
  );

-- The codes of an end that have a public French reason (FAILURE_REASON_LABELS in src/lib/takeoff/visible-status.ts,
-- TAKEOFF_PUBLIC_FAILURE_CODES in src/lib/takeoff/completion-outcome.ts). Only these reach a reader who cannot read
-- the job; any other code is shown as the generic reason.
create function private.takeoff_public_failure_codes()
returns text[] language sql immutable set search_path = pg_catalog as $$
  select array['AI_PROVIDER', 'AI_SAFETY', 'AI_SCHEMA', 'AI_TIMEOUT', 'FORBIDDEN', 'TAKEOFF_FILE_TOO_LARGE',
    'TAKEOFF_FILE_TYPE_INVALID', 'TAKEOFF_LEVEL_C_BUDGET_EXCEEDED', 'TAKEOFF_LEVEL_C_INVALID_SCHEMA',
    'TAKEOFF_LEVEL_C_TIMEOUT', 'TAKEOFF_PDF_CORRUPTED', 'TAKEOFF_PDF_NOT_INTERPRETABLE', 'TAKEOFF_WORKER_HOST_SILENT',
    'TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_OUTCOME_UNKNOWN', 'TAKEOFF_WORKER_QUEUE_EXPIRED']::text[];
$$;
revoke all on function private.takeoff_public_failure_codes() from public, anon, authenticated;
-- The check below runs it as the writer: the mailer, as the service role, updates the delivery of a notice.
grant execute on function private.takeoff_public_failure_codes() to service_role;

-- A failure notice keeps the code of its end, so the inbox and the affaire's readers show its reason without
-- reading the job, whose own rule may hide it from them.
alter table public.takeoff_completion_notifications
  add column reason_code text,
  add constraint takeoff_completion_reason_code_check check (
    reason_code is null or (outcome = 'failure' and reason_code = any (private.takeoff_public_failure_codes()))
  );
grant select (reason_code) on public.takeoff_completion_notifications to authenticated;

-- What each authorised Mac last did, in database time: its poller's sign of life every minute, on a timer of its
-- own, and its worker's claims, lease renewals and ends (worked_at), stamped by the trigger below.
create table private.takeoff_local_host_activity (
  host_id text primary key check (host_id ~ '^urn:uuid:[0-9a-f-]{36}$'),
  live_since timestamptz not null,
  seen_at timestamptz not null,
  worked_at timestamptz,
  constraint takeoff_local_host_activity_order_check check (live_since <= seen_at)
);
revoke all on private.takeoff_local_host_activity from public, anon, authenticated, service_role;

-- A host is live while its last sign is this recent; five missed beats of the poller's one-minute timer.
create function private.takeoff_local_host_live_window()
returns interval language sql immutable set search_path = pg_catalog as $$
  select interval '5 minutes';
$$;
revoke all on function private.takeoff_local_host_live_window() from public, anon, authenticated, service_role;

-- A gap longer than the live window starts a new live period: a laptop that wakes up is not yet known to poll.
create function private.note_local_takeoff_host_activity(p_host_id text, p_worked boolean)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  seen timestamptz := clock_timestamp();
begin
  insert into private.takeoff_local_host_activity as a (host_id, live_since, seen_at, worked_at)
  values (p_host_id, seen, seen, case when p_worked then seen end)
  on conflict (host_id) do update set
    live_since = case when a.seen_at < seen - private.takeoff_local_host_live_window() then seen else a.live_since end,
    seen_at = greatest(a.seen_at, seen),
    worked_at = case when p_worked then greatest(coalesce(a.worked_at, seen), seen) else a.worked_at end;
end;
$$;
revoke all on function private.note_local_takeoff_host_activity(text, boolean) from public, anon, authenticated, service_role;

create function public.record_local_takeoff_host_activity(p_host_id text)
returns void
language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  if p_host_id is null or p_host_id !~ '^urn:uuid:[0-9a-f-]{36}$' then
    raise exception 'TAKEOFF_HOST_ACTIVITY_INVALID' using errcode = '22023';
  end if;
  perform private.note_local_takeoff_host_activity(p_host_id, false);
end;
$$;
revoke all on function public.record_local_takeoff_host_activity(text) from public, anon, authenticated;
grant execute on function public.record_local_takeoff_host_activity(text) to service_role;

-- The decision of the recovery and the claims of one Mac are serialized by this key.
create function private.takeoff_local_host_lock_key(p_host_id text)
returns bigint language sql immutable set search_path = pg_catalog as $$
  select hashtextextended('takeoff-local-host:' || p_host_id, 0);
$$;
revoke all on function private.takeoff_local_host_lock_key(text) from public, anon, authenticated, service_role;

-- M3's trigger, with three changes. An authenticated member sends a failed or canceled job back to pending only if
-- they launched it. The requester and the queue time of an accepted relaunch are recorded whichever side of the
-- cutoff it falls on. And the worker's own claims, renewals and ends stamp the Mac's work in database time. Before
-- activation nothing else differs: no previous writer reads either column or the private table.
create or replace function private.set_takeoff_analysis_outcome()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  finished_at timestamptz := clock_timestamp();
  writer_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  worker_write boolean := writer_role in ('service_role', 'postgres');
  activated boolean := exists (select 1 from private.takeoff_completion_activation a where a.active_from <= finished_at);
  host_work boolean;
begin
  if tg_op = 'INSERT' then
    if new.analysis_outcome is not null or new.analysis_finished_at is not null
      or new.analysis_completion_event_id is not null or new.analysis_requested_by is not null
      or new.analysis_queued_at is not null then
      raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.analysis_requested_by is distinct from old.analysis_requested_by then
    raise exception 'TAKEOFF_ANALYSIS_REQUESTER_RESERVED' using errcode = '42501';
  end if;
  new.analysis_queued_at := old.analysis_queued_at;
  -- The Mac's own work: a claim, a lease renewal, or an end it wrote (not a closure by the recovery).
  host_work := new.execution_provider = 'chatgpt_local' and worker_write and (
    (old.status is distinct from 'processing' and new.status = 'processing')
    or (old.status = 'processing' and new.status = 'processing'
      and new.processing_lease_expires_at is distinct from old.processing_lease_expires_at)
    or (old.status = 'processing' and new.status in ('completed', 'failed')
      and new.error_code is distinct from 'TAKEOFF_WORKER_OUTCOME_UNKNOWN'));

  if old.status in ('failed', 'canceled') and new.status = 'pending' then
    -- Only the member who launched a job sends it back to pending: its analysis runs on the launcher's own
    -- subscription. A deliberate change, effective before activation too. The worker's retries (failed to
    -- processing) and the service role are not concerned.
    if writer_role = 'authenticated' and old.created_by is distinct from (select auth.uid()) then
      raise exception 'TAKEOFF_RELAUNCH_LAUNCHER_ONLY' using errcode = '42501';
    end if;
    new.analysis_queued_at := finished_at;
    -- This trigger runs after the existing authenticated reset allowlist.
    -- Attribute the accepted reset from its own session, not its payload.
    if writer_role = 'authenticated' then
      new.analysis_requested_by := (select auth.uid());
    end if;
  end if;

  -- The deployed pre-M3 writers retain their behavior before activation.
  if not activated and old.analysis_outcome is null then
    new.analysis_outcome := null;
    new.analysis_finished_at := old.analysis_finished_at;
    new.analysis_completion_event_id := old.analysis_completion_event_id;
    if host_work then
      perform private.note_local_takeoff_host_activity(new.execution_host_id, true);
    end if;
    return new;
  end if;

  if old.execution_provider = 'chatgpt_local' and old.status = 'failed'
    and old.next_retry_at is not null and new.status = 'pending'
  then
    raise exception 'TAKEOFF_ANALYSIS_RETRY_SCHEDULED' using errcode = '23514';
  end if;
  if old.execution_provider = 'chatgpt_local' and old.status = 'failed' and new.status = 'processing'
    and (old.analysis_outcome is not null or old.next_retry_at > finished_at
      or old.retry_count >= 3)
  then
    return null;
  end if;
  if new.analysis_finished_at is distinct from old.analysis_finished_at
    or new.analysis_completion_event_id is distinct from old.analysis_completion_event_id
    or (new.analysis_outcome is distinct from old.analysis_outcome and (
      not worker_write or old.analysis_outcome is not null or new.analysis_outcome is distinct from 'failure'
      or new.status <> 'failed' or (
        old.status not in ('pending', 'processing') and not (
          -- The recovery closes a due retry that nobody took, that waited past the ceiling, or whose Mac was silent.
          old.status = 'failed' and old.next_retry_at is not null and new.next_retry_at is null
          and new.error_code in ('TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_QUEUE_EXPIRED', 'TAKEOFF_WORKER_HOST_SILENT')
        )
      )
    ))
  then
    raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
  end if;

  if old.status in ('pending', 'processing') and new.status = 'canceled' then
    new.analysis_outcome := 'canceled';
  elsif old.execution_provider = 'chatgpt_local' and old.status = 'processing'
    and new.status in ('completed', 'failed') then
    if not worker_write then
      raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
    end if;
    if new.status = 'failed' and new.analysis_outcome = 'failure'
      and new.error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN' then
      -- Recovery has already verified staleness in its UPDATE predicate.
      null;
    elsif old.processing_lease_token is null or old.processing_lease_expires_at <= finished_at then
      raise exception 'TAKEOFF_ANALYSIS_LEASE_EXPIRED' using errcode = '23514';
    end if;
    if new.status = 'completed' then
      new.analysis_outcome := 'success';
    end if;
  end if;

  if new.analysis_outcome is distinct from old.analysis_outcome then
    new.analysis_finished_at := finished_at;
    -- M4 supplies the parent FK. Child jobs still record an outcome, and the
    -- request finalizer will allocate its own event after all children settle.
    if to_jsonb(new) ->> 'launch_request_id' is null then
      new.analysis_completion_event_id := gen_random_uuid();
    end if;
  end if;
  if host_work then
    perform private.note_local_takeoff_host_activity(new.execution_host_id, true);
  end if;
  return new;
end;
$$;

-- This application's claim, M3's, now serialized with the recovery's decision for the same Mac: a Mac that starts
-- a job while the recovery decides is seen as busy by it. The deployed claim_local_takeoff_job is unchanged.
create or replace function public.claim_observed_local_takeoff_job(
  p_job_id uuid, p_tenant_id uuid, p_host_id text, p_started_at timestamptz, p_lease_token uuid,
  p_lease_expires_at timestamptz, p_model text, p_prompt_version text,
  p_observed_status text, p_observed_retry_count integer
)
returns setof public.takeoff_jobs language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_observed_status is null or p_observed_status not in ('pending', 'failed') or p_observed_retry_count is null then
    raise exception 'TAKEOFF_LOCAL_CLAIM_INVALID' using errcode = '22023';
  end if;
  if p_host_id is not null then
    perform pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  end if;
  perform 1 from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id
    and j.status::text = p_observed_status and j.retry_count = p_observed_retry_count
  for update;
  if not found then return; end if;
  -- Planned per call: a session keeps working after a column joins the job row.
  return query execute 'select * from public.claim_local_takeoff_job($1, $2, $3, $4, $5, $6, $7, $8)'
    using p_job_id, p_tenant_id, p_host_id, p_started_at, p_lease_token, p_lease_expires_at, p_model, p_prompt_version;
end;
$$;
revoke all on function public.claim_observed_local_takeoff_job(uuid, uuid, text, timestamptz, uuid, timestamptz, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_observed_local_takeoff_job(uuid, uuid, text, timestamptz, uuid, timestamptz, text, text, text, integer)
  to service_role;

-- Whether a claim of this job would pass the admission limits now: the limits enforce_takeoff_processing_admission
-- applies (20261022075204_bound_takeoff_job_admission.sql), on the database clock, as the claim is. A job these limits
-- would refuse is waiting its turn, not left untaken.
create function private.local_takeoff_claim_admissible(p_tenant_id uuid, p_created_by uuid, p_from_failed boolean)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select (select count(*) from public.takeoff_processing_admissions a
      where a.tenant_id = p_tenant_id and a.admitted_at > clock_timestamp() - interval '24 hours') < 80
    and (select count(*) from public.takeoff_processing_admissions a
      where a.tenant_id = p_tenant_id and a.created_by = p_created_by
        and a.admitted_at > clock_timestamp() - interval '24 hours') < 20
    -- A failed job that becomes active again counts itself among the active jobs.
    and (not p_from_failed or (
      (select count(*) from public.takeoff_jobs j
        where j.tenant_id = p_tenant_id and j.status in ('pending', 'processing')) < 15
      and (select count(*) from public.takeoff_jobs j
        where j.tenant_id = p_tenant_id and j.created_by = p_created_by and j.status in ('pending', 'processing')) < 6));
$$;
revoke all on function private.local_takeoff_claim_admissible(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- The hosted recovery, every five minutes. Before activation it answers exactly as before M3. After it, a job that
-- waits for its Mac is closed only by the rule below, whose grace and ceiling the activation row carries.
create or replace function public.recover_stale_local_takeoff_jobs(
  p_now timestamptz,
  p_stale_after interval default interval '10 minutes'
)
returns table (job_id uuid, error_code text)
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  activation private.takeoff_completion_activation;
  recovery_at timestamptz := least(p_now, clock_timestamp());
  live_window constant interval := private.takeoff_local_host_live_window();
  waiting_host text;
begin
  if p_now is null or p_stale_after < interval '1 minute' then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  select * into activation from private.takeoff_completion_activation;
  if activation.active_from is null or clock_timestamp() < activation.active_from then
    -- The statement of the function before M3, unchanged.
    return query
    with recovered as (
      update public.takeoff_jobs as job_row
      set status = 'failed', completed_at = p_now, next_retry_at = null,
        last_error_at = p_now, error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN',
        error_message = 'Le worker a expire pendant un appel dont le resultat fournisseur est inconnu. Une reprise manuelle est requise.',
        processing_lease_token = null, processing_lease_expires_at = null,
        provider_reconcile_due_at = null, provider_reconcile_lease_token = null,
        provider_reconcile_lease_expires_at = null
      where job_row.execution_provider = 'chatgpt_local'
        and job_row.status = 'processing' and job_row.provider_batch_id is null
        and (job_row.processing_lease_expires_at <= p_now or
          (job_row.processing_lease_expires_at is null and coalesce(job_row.started_at, job_row.updated_at) <= p_now - p_stale_after))
      returning job_row.id, job_row.error_code
    ) select recovered.id, recovered.error_code from recovered;
    return;
  end if;
  if p_stale_after is null then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  -- Decide for each Mac while none of its claims is in flight: this application's claim takes the same lock, so a
  -- claim committed before the decision is read below and one that starts after it waits for this transaction.
  for waiting_host in
    select distinct j.execution_host_id from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.status in ('pending', 'failed')
    order by 1
  loop
    perform pg_advisory_xact_lock(private.takeoff_local_host_lock_key(waiting_host));
  end loop;

  -- A processing job whose lease expired is closed as before. A job that waits for its Mac (pending, or a due
  -- retry) is never closed for its age alone: only when its live Mac could take it and, idle with nothing claimed,
  -- renewed or ended for the pickup grace, leaves it untaken, or when it has waited longer than the ceiling.
  -- Liveness, live period and work are database time; so is the queue time of a pending job.
  return query
  with waiting as (
    select j.id, j.tenant_id, j.created_by, j.execution_host_id as host_id, j.status, j.retry_count, j.next_retry_at,
      coalesce(j.analysis_queued_at, j.created_at) as queued_at,
      greatest(activation.active_from,
        case when j.status = 'pending' then coalesce(j.analysis_queued_at, j.created_at) else j.next_retry_at end
      ) as waiting_since,
      t.is_active as tenant_active
    from public.takeoff_jobs j
    join public.tenants t on t.id = j.tenant_id
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and (j.status = 'pending'
        or (j.status = 'failed' and j.retry_count < 3 and j.next_retry_at <= recovery_at))
  ),
  host_busy as (
    select k.execution_host_id as host_id, true as busy
    from public.takeoff_jobs k
    where k.execution_provider = 'chatgpt_local' and k.execution_host_id in (select w.host_id from waiting w)
      and k.status = 'processing' and k.processing_lease_expires_at > recovery_at
    group by k.execution_host_id
  ),
  judged as (
    select w.*,
      coalesce(a.seen_at >= recovery_at - live_window and a.seen_at >= clock_timestamp() - live_window, false) as live,
      a.live_since,
      -- What is ahead of it: a job under lease, recent work of the Mac, or the tenant's limits refusing its claim.
      coalesce(hb.busy, false) or coalesce(a.worked_at > recovery_at - activation.pickup_grace, false)
        or not private.local_takeoff_claim_admissible(w.tenant_id, w.created_by, w.status = 'failed') as waiting_turn
    from waiting w
    left join private.takeoff_local_host_activity a on a.host_id = w.host_id
    left join host_busy hb on hb.host_id = w.host_id
  ),
  closing as (
    select j.id, j.status, j.retry_count, j.next_retry_at, null::timestamptz as queued_at,
      'TAKEOFF_WORKER_OUTCOME_UNKNOWN'::text as code,
      'Le traitement a été interrompu. Son résultat est inconnu et nécessite une vérification manuelle.'::text as message
    from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.status = 'processing' and (j.processing_lease_expires_at <= recovery_at or
        (j.processing_lease_expires_at is null and coalesce(j.started_at, j.updated_at) <= recovery_at - p_stale_after))
    union all
    select g.id, g.status, g.retry_count, g.next_retry_at, g.queued_at,
      case
        when g.waiting_since > recovery_at - activation.wait_ceiling then 'TAKEOFF_WORKER_NOT_STARTED'
        when not g.live then 'TAKEOFF_WORKER_HOST_SILENT'
        when g.waiting_turn then 'TAKEOFF_WORKER_QUEUE_EXPIRED'
        else 'TAKEOFF_WORKER_NOT_STARTED'
      end,
      case
        when g.waiting_since > recovery_at - activation.wait_ceiling then
          'L’analyse n’a pas démarré : le poste autorisé était disponible mais ne l’a pas prise en charge. Vérifiez le poste autorisé avant de préparer une nouvelle analyse.'
        when not g.live then
          'L’analyse n’a pas démarré : le poste autorisé ne s’est pas manifesté avant la fin du délai d’attente maximal. Vérifiez qu’il est allumé, connecté et que l’application y est ouverte avant de préparer une nouvelle analyse.'
        when g.waiting_turn then
          'L’analyse attendait encore son tour sur le poste autorisé quand le délai d’attente maximal a expiré. Elle n’a pas démarré : préparez une nouvelle analyse.'
        else
          'L’analyse n’a pas démarré : le poste autorisé ne l’a pas prise en charge pendant le délai d’attente maximal. Vérifiez le poste autorisé avant de préparer une nouvelle analyse.'
      end
    from judged g
    where g.waiting_since <= recovery_at - activation.wait_ceiling
      or (g.tenant_active and g.live and not g.waiting_turn
        and g.live_since <= recovery_at - activation.pickup_grace
        and g.waiting_since <= recovery_at - activation.pickup_grace)
  )
  update public.takeoff_jobs as job_row
  set status = 'failed', completed_at = recovery_at, next_retry_at = null,
    last_error_at = recovery_at, error_code = closing.code, error_message = closing.message,
    analysis_outcome = 'failure',
    processing_lease_token = null, processing_lease_expires_at = null,
    provider_reconcile_due_at = null, provider_reconcile_lease_token = null,
    provider_reconcile_lease_expires_at = null
  from closing
  -- Rechecked on the locked row: a claim, a renewal or a relaunch that commits first keeps the job.
  where job_row.id = closing.id
    and job_row.execution_provider = 'chatgpt_local' and job_row.provider_batch_id is null
    and job_row.analysis_outcome is null and job_row.status = closing.status
    and job_row.retry_count = closing.retry_count
    and case job_row.status::text
      when 'processing' then job_row.processing_lease_expires_at <= recovery_at
        or (job_row.processing_lease_expires_at is null
          and coalesce(job_row.started_at, job_row.updated_at) <= recovery_at - p_stale_after)
      when 'pending' then coalesce(job_row.analysis_queued_at, job_row.created_at) = closing.queued_at
      else job_row.next_retry_at = closing.next_retry_at
    end
  returning job_row.id, job_row.error_code;
end;
$$;
revoke all on function public.recover_stale_local_takeoff_jobs(timestamptz, interval) from public, anon, authenticated;
grant execute on function public.recover_stale_local_takeoff_jobs(timestamptz, interval) to service_role;

-- The code of the end joins the identity the mailer cannot rewrite.
create or replace function private.guard_takeoff_completion_notification_identity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'service_role' then
      raise exception 'TAKEOFF_COMPLETION_WRITER_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.id, new.tenant_id, new.project_id, new.subject_kind, new.job_id, new.request_id,
        new.recipient_user_id, new.outcome, new.finished_at, new.recipient_email, new.provider_key,
        new.plans_read_count, new.plans_failed_count, new.plans_not_started_count, new.reason_code)
    is distinct from (old.id, old.tenant_id, old.project_id, old.subject_kind, old.job_id, old.request_id,
        old.recipient_user_id, old.outcome, old.finished_at, old.recipient_email, old.provider_key,
        old.plans_read_count, old.plans_failed_count, old.plans_not_started_count, old.reason_code)
    or (current_user = 'service_role' and new.read_at is distinct from old.read_at)
  then
    raise exception 'TAKEOFF_COMPLETION_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- M3's publication, which now records the public code of a failure and never sends an end to a member who did not
-- ask for it: a relaunch accepted before this migration recorded no requester, and when an audit names another
-- member than the launcher as the last to relaunch, the end is kept as unavailable.
create or replace function private.publish_takeoff_analysis_completion()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  -- M1 (applied first) froze the job's own affaire on every job, versionless ones included.
  affaire_id uuid := new.project_id;
  requester_id uuid := new.analysis_requested_by;
  last_relauncher uuid;
  logical_email text;
  initial_state text := 'unavailable';
  unavailable_code text := 'RECIPIENT_UNAVAILABLE';
begin
  if not exists (
    select 1 from private.takeoff_completion_activation a where new.analysis_finished_at >= a.active_from
  ) then
    return null;
  end if;

  if affaire_id is null then
    raise exception 'TAKEOFF_COMPLETION_PROJECT_MISSING' using errcode = '23514';
  end if;

  if requester_id is null then
    select a.user_id into last_relauncher from public.audit_logs a
    where a.tenant_id = new.tenant_id and a.table_name = 'takeoff_jobs' and a.record_id = new.id
      and a.action in ('takeoff.job.resubmitted', 'takeoff.job.retried') and a.user_id is not null
      and a.created_at >= new.created_at
    order by a.created_at desc limit 1;
    if last_relauncher is null or last_relauncher = new.created_by then
      requester_id := new.created_by;
    else
      unavailable_code := 'REQUESTER_UNKNOWN';
    end if;
  end if;

  if new.analysis_outcome = 'canceled' then
    initial_state := 'suppressed';
  elsif requester_id is not null
    and private.takeoff_completion_recipient_can_read(new.tenant_id, affaire_id, requester_id) then
    select nullif(trim(u.email), '') into logical_email from auth.users u
      where u.id = requester_id and u.email_confirmed_at is not null and u.deleted_at is null;
    if logical_email is not null then
      initial_state := 'pending';
    end if;
  end if;

  insert into public.takeoff_completion_notifications (
    id, tenant_id, project_id, subject_kind, job_id, recipient_user_id, outcome, finished_at,
    recipient_email, delivery_state, provider_key, next_attempt_at, last_delivery_code, reason_code
  ) values (
    new.analysis_completion_event_id, new.tenant_id, affaire_id, 'job', new.id, requester_id,
    new.analysis_outcome, new.analysis_finished_at, logical_email, initial_state,
    'takeoff-completion/' || new.tenant_id::text || '/job/' || new.id::text || '/'
      || coalesce(requester_id::text, 'unavailable'),
    case when initial_state = 'pending' then new.analysis_finished_at end,
    case when initial_state = 'unavailable' then unavailable_code end,
    -- Only a code with a public French reason is kept: any other is shown as the generic reason.
    case when new.analysis_outcome = 'failure' and new.error_code = any (private.takeoff_public_failure_codes())
      then new.error_code end
  );
  return null;
end;
$$;

-- The shared end of the affaire's analyses: one job's end, or a page of them, with the public code of a failure.
-- The 3-argument calls of M3's version resolve to this one; they receive the fourth column, reason_code, as well.
drop function public.list_affaire_takeoff_completions(uuid, integer, integer);
create function public.list_affaire_takeoff_completions(
  p_project_id uuid, p_limit integer default 20, p_offset integer default 0, p_job_id uuid default null
)
returns table (event_id uuid, outcome text, finished_at timestamptz, reason_code text)
language sql stable security definer set search_path = pg_catalog as $$
  select n.id, n.outcome, n.finished_at,
    case when n.reason_code = any (private.takeoff_public_failure_codes()) then n.reason_code end
  from public.takeoff_completion_notifications n
  where n.project_id = p_project_id
    and (p_job_id is null or n.job_id = p_job_id)
    and private.takeoff_completion_visible(n.tenant_id, n.project_id)
  order by n.finished_at desc, n.id desc
  -- One row beyond the largest page tells the reader that an older page exists.
  limit greatest(1, least(coalesce(p_limit, 20), 101))
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.list_affaire_takeoff_completions(uuid, integer, integer, uuid) from public, anon, service_role;
grant execute on function public.list_affaire_takeoff_completions(uuid, integer, integer, uuid) to authenticated;

-- Called at the moment of sending, after prepare. It checks again, as prepare does, who may receive and where: the
-- recipient's confirmed address and read access to the affaire; a change ends the delivery as unavailable. Then
-- that the sender still holds its lease and that the provider still keeps the first attempt's key. It returns how
-- many milliseconds remain for the call to start, or null; a key the provider no longer keeps leaves the delivery
-- to verify, without a second send.
create function public.confirm_takeoff_completion_email_dispatch(p_id uuid, p_lease_token uuid)
returns integer
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  n public.takeoff_completion_notifications;
  checked_at timestamptz := clock_timestamp();
  current_email text;
begin
  select * into n from public.takeoff_completion_notifications
    where id = p_id and delivery_state = 'sending' and lease_token = p_lease_token
    for update;
  if not found or n.first_send_at is null or n.lease_expires_at <= checked_at then
    return null;
  end if;
  select nullif(trim(u.email), '') into current_email from auth.users u
    where u.id = n.recipient_user_id and u.email_confirmed_at is not null and u.deleted_at is null;
  if current_email is null or current_email is distinct from n.recipient_email
    or not private.takeoff_completion_recipient_can_read(n.tenant_id, n.project_id, n.recipient_user_id)
  then
    update public.takeoff_completion_notifications
    set delivery_state = 'unavailable', last_delivery_code = 'RECIPIENT_UNAVAILABLE',
      lease_token = null, lease_expires_at = null
    where id = n.id;
    return null;
  end if;
  if n.first_send_at <= checked_at - interval '23 hours' then
    update public.takeoff_completion_notifications
    set delivery_state = 'unknown', last_delivery_code = 'IDEMPOTENCY_WINDOW_EXPIRED',
      lease_token = null, lease_expires_at = null
    where id = n.id;
    return null;
  end if;
  return floor(extract(epoch from least(n.lease_expires_at, n.first_send_at + interval '23 hours') - checked_at) * 1000)::integer;
end;
$$;
revoke all on function public.confirm_takeoff_completion_email_dispatch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_takeoff_completion_email_dispatch(uuid, uuid) to service_role;

commit;
