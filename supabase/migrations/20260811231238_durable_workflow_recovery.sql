-- Durable recovery for takeoff and affaire-intake background work.
--
-- The business tables remain the queue of record. Request-time triggers are
-- only latency optimisations; leases and due timestamps make work reclaimable
-- after a terminated function invocation.

alter table public.takeoff_jobs
  add column if not exists processing_lease_token uuid,
  add column if not exists processing_lease_expires_at timestamptz;

alter table public.affaire_intake_uploads
  add column if not exists processing_lease_token uuid,
  add column if not exists processing_lease_expires_at timestamptz;

alter table public.takeoff_jobs
  drop constraint if exists takeoff_jobs_processing_lease_pair_check;
alter table public.takeoff_jobs
  add constraint takeoff_jobs_processing_lease_pair_check
  check (
    (processing_lease_token is null and processing_lease_expires_at is null)
    or
    (processing_lease_token is not null and processing_lease_expires_at is not null)
  );

alter table public.affaire_intake_uploads
  drop constraint if exists affaire_intake_uploads_processing_lease_pair_check;
alter table public.affaire_intake_uploads
  add constraint affaire_intake_uploads_processing_lease_pair_check
  check (
    (processing_lease_token is null and processing_lease_expires_at is null)
    or
    (processing_lease_token is not null and processing_lease_expires_at is not null)
  );

create index if not exists takeoff_jobs_durable_recovery_due_idx
  on public.takeoff_jobs (status, next_retry_at, created_at)
  where status in ('pending', 'failed');

create index if not exists takeoff_jobs_processing_lease_due_idx
  on public.takeoff_jobs (processing_lease_expires_at, started_at)
  where status = 'processing';

create index if not exists affaire_intake_uploads_durable_recovery_due_idx
  on public.affaire_intake_uploads (status, next_retry_at, processing_lease_expires_at, created_at)
  where status in ('queued', 'processing');

create or replace function public.claim_affaire_intake_upload(
  p_upload_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_expires_at timestamptz,
  p_max_attempts integer default 3
)
returns table (
  claimed boolean,
  reason text,
  tenant_id uuid,
  project_id uuid,
  upload_status text,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_upload public.affaire_intake_uploads%rowtype;
  v_tenant_active boolean := false;
  v_is_due boolean := false;
  v_is_stale boolean := false;
begin
  if p_upload_id is null
    or p_lease_token is null
    or p_now is null
    or p_lease_expires_at is null
    or p_lease_expires_at <= p_now
    or p_max_attempts < 1
  then
    raise exception 'AFFAIRE_INTAKE_CLAIM_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select upload_row.*
    into v_upload
  from public.affaire_intake_uploads as upload_row
  where upload_row.id = p_upload_id
  for update;

  if not found then
    return query
    select false, 'not_found', null::uuid, null::uuid, null::text, 0, null::timestamptz;
    return;
  end if;

  select tenant_row.is_active
    into v_tenant_active
  from public.tenants as tenant_row
  where tenant_row.id = v_upload.tenant_id;

  if not coalesce(v_tenant_active, false) then
    return query
    select false, 'tenant_inactive', v_upload.tenant_id, v_upload.project_id,
      v_upload.status, v_upload.attempt_count, v_upload.processing_lease_expires_at;
    return;
  end if;

  v_is_due := v_upload.status = 'queued'
    and coalesce(v_upload.next_retry_at, p_now) <= p_now;
  v_is_stale := v_upload.status = 'processing'
    and (
      v_upload.processing_lease_expires_at <= p_now
      or (
        v_upload.processing_lease_expires_at is null
        and v_upload.updated_at <= p_now - interval '10 minutes'
      )
    );

  if not v_is_due and not v_is_stale then
    return query
    select false, 'not_due', v_upload.tenant_id, v_upload.project_id,
      v_upload.status, v_upload.attempt_count, v_upload.processing_lease_expires_at;
    return;
  end if;

  update public.affaire_intake_documents as document_row
  set
    classification_status = 'failed',
    issues = case
      when 'Traitement interrompu avant finalisation.' = any(document_row.issues)
        then document_row.issues
      else array_append(document_row.issues, 'Traitement interrompu avant finalisation.')
    end
  where document_row.upload_id = v_upload.id
    and document_row.classification_status = 'processing';

  if v_upload.attempt_count >= p_max_attempts then
    update public.affaire_intake_uploads as upload_row
    set
      status = 'failed',
      next_retry_at = null,
      last_error = 'Le traitement automatique a epuise son budget de reprise.',
      completed_at = p_now,
      processing_lease_token = null,
      processing_lease_expires_at = null
    where upload_row.id = v_upload.id;

    return query
    select false, 'attempts_exhausted', v_upload.tenant_id, v_upload.project_id,
      'failed'::text, v_upload.attempt_count, null::timestamptz;
    return;
  end if;

  update public.affaire_intake_uploads as upload_row
  set
    status = 'processing',
    attempt_count = upload_row.attempt_count + 1,
    next_retry_at = null,
    last_error = null,
    completed_at = null,
    processing_lease_token = p_lease_token,
    processing_lease_expires_at = p_lease_expires_at
  where upload_row.id = v_upload.id
  returning upload_row.* into v_upload;

  return query
  select true, case when v_is_stale then 'reclaimed' else 'claimed' end,
    v_upload.tenant_id, v_upload.project_id, v_upload.status,
    v_upload.attempt_count, v_upload.processing_lease_expires_at;
end;
$$;

create or replace function public.renew_affaire_intake_upload_lease(
  p_upload_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_renewed boolean := false;
begin
  if p_upload_id is null
    or p_lease_token is null
    or p_now is null
    or p_lease_expires_at is null
    or p_lease_expires_at <= p_now
  then
    raise exception 'AFFAIRE_INTAKE_RENEW_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.affaire_intake_uploads as upload_row
  set processing_lease_expires_at = p_lease_expires_at
  from public.tenants as tenant_row
  where upload_row.id = p_upload_id
    and upload_row.tenant_id = tenant_row.id
    and tenant_row.is_active
    and upload_row.status = 'processing'
    and upload_row.processing_lease_token = p_lease_token
    and upload_row.processing_lease_expires_at > p_now
  returning true into v_renewed;

  return coalesce(v_renewed, false);
end;
$$;

create or replace function public.finish_affaire_intake_upload_attempt(
  p_upload_id uuid,
  p_lease_token uuid,
  p_status text,
  p_now timestamptz,
  p_next_retry_at timestamptz default null,
  p_last_error text default null
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_finished boolean := false;
begin
  if p_upload_id is null
    or p_lease_token is null
    or p_now is null
    or p_status not in ('queued', 'ready', 'partial_failure', 'failed')
    or (p_status = 'queued' and p_next_retry_at is null)
    or (p_status <> 'queued' and p_next_retry_at is not null)
  then
    raise exception 'AFFAIRE_INTAKE_FINISH_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.affaire_intake_uploads as upload_row
  set
    status = p_status,
    next_retry_at = p_next_retry_at,
    last_error = p_last_error,
    completed_at = case when p_status = 'queued' then null else p_now end,
    processing_lease_token = null,
    processing_lease_expires_at = null
  from public.tenants as tenant_row
  where upload_row.id = p_upload_id
    and upload_row.tenant_id = tenant_row.id
    and tenant_row.is_active
    and upload_row.status = 'processing'
    and upload_row.processing_lease_token = p_lease_token
    and upload_row.processing_lease_expires_at > p_now
  returning true into v_finished;

  return coalesce(v_finished, false);
end;
$$;

create or replace function public.recover_stale_takeoff_jobs(
  p_now timestamptz,
  p_stale_after interval default interval '10 minutes'
)
returns table (
  job_id uuid,
  error_code text
)
language plpgsql
set search_path = pg_catalog
as $$
begin
  if p_now is null or p_stale_after < interval '1 minute' then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  return query
  with recovered as (
    update public.takeoff_jobs as job_row
    set
      status = 'failed',
      completed_at = p_now,
      next_retry_at = null,
      last_error_at = p_now,
      error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN',
      error_message = 'Le worker a expire pendant un appel dont le resultat fournisseur est inconnu. Une reprise manuelle est requise.',
      processing_lease_token = null,
      processing_lease_expires_at = null,
      provider_reconcile_due_at = null,
      provider_reconcile_lease_token = null,
      provider_reconcile_lease_expires_at = null
    where job_row.status = 'processing'
      and job_row.provider_batch_id is null
      and (
        job_row.processing_lease_expires_at <= p_now
        or (
          job_row.processing_lease_expires_at is null
          and coalesce(job_row.started_at, job_row.updated_at) <= p_now - p_stale_after
        )
      )
    returning job_row.id, job_row.error_code
  )
  select recovered.id, recovered.error_code
  from recovered;
end;
$$;

create or replace function public.renew_takeoff_processing_lease(
  p_job_id uuid,
  p_tenant_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_renewed boolean := false;
begin
  if p_job_id is null
    or p_tenant_id is null
    or p_lease_token is null
    or p_now is null
    or p_lease_expires_at <= p_now
  then
    raise exception 'TAKEOFF_PROCESSING_LEASE_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.takeoff_jobs as job_row
  set processing_lease_expires_at = p_lease_expires_at
  from public.tenants as tenant_row
  where job_row.id = p_job_id
    and job_row.tenant_id = p_tenant_id
    and tenant_row.id = job_row.tenant_id
    and tenant_row.is_active
    and job_row.status = 'processing'
    and job_row.processing_lease_token = p_lease_token
    and job_row.processing_lease_expires_at > p_now
  returning true into v_renewed;

  return coalesce(v_renewed, false);
end;
$$;

create or replace function public.renew_takeoff_batch_reconcile_lease(
  p_job_id uuid,
  p_tenant_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_renewed boolean := false;
begin
  if p_job_id is null
    or p_tenant_id is null
    or p_lease_token is null
    or p_now is null
    or p_lease_expires_at <= p_now
  then
    raise exception 'TAKEOFF_RECONCILE_LEASE_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.takeoff_jobs as job_row
  set provider_reconcile_lease_expires_at = p_lease_expires_at
  from public.tenants as tenant_row
  where job_row.id = p_job_id
    and job_row.tenant_id = p_tenant_id
    and tenant_row.id = job_row.tenant_id
    and tenant_row.is_active
    and job_row.status = 'processing'
    and job_row.processing_strategy = 'batch'
    and job_row.provider_reconcile_lease_token = p_lease_token
    and job_row.provider_reconcile_lease_expires_at > p_now
  returning true into v_renewed;

  return coalesce(v_renewed, false);
end;
$$;

create or replace function public.persist_takeoff_provider_batch_snapshot_fenced(
  p_job_id uuid,
  p_tenant_id uuid,
  p_estimate_version_id uuid,
  p_provider text,
  p_processing_strategy public.takeoff_processing_strategy,
  p_provider_batch_id text,
  p_provider_batch_state public.takeoff_provider_batch_state,
  p_provider_batch_updated_at timestamptz,
  p_provider_state_raw text,
  p_message text,
  p_metadata jsonb,
  p_should_update_snapshot boolean,
  p_should_insert_event boolean,
  p_processing_lease_token uuid,
  p_provider_reconcile_lease_token uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_job_found boolean := false;
begin
  if p_job_id is null
    or p_tenant_id is null
    or p_estimate_version_id is null
    or p_now is null
    or p_provider is null
    or btrim(p_provider) = ''
    or (p_processing_lease_token is null) = (p_provider_reconcile_lease_token is null)
  then
    raise exception 'TAKEOFF_PROVIDER_SNAPSHOT_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select true into v_job_found
  from public.takeoff_jobs as job_row
  join public.tenants as tenant_row
    on tenant_row.id = job_row.tenant_id
   and tenant_row.is_active
  where job_row.id = p_job_id
    and job_row.tenant_id = p_tenant_id
    and job_row.estimate_version_id = p_estimate_version_id
    and job_row.status = 'processing'
    and (
      (
        p_processing_lease_token is not null
        and job_row.processing_lease_token = p_processing_lease_token
        and job_row.processing_lease_expires_at > p_now
      )
      or (
        p_provider_reconcile_lease_token is not null
        and job_row.provider_reconcile_lease_token = p_provider_reconcile_lease_token
        and job_row.provider_reconcile_lease_expires_at > p_now
      )
    )
  for update of job_row;

  if not coalesce(v_job_found, false) then
    return false;
  end if;

  if p_should_update_snapshot then
    update public.takeoff_jobs
    set
      processing_strategy = p_processing_strategy,
      provider_batch_id = p_provider_batch_id,
      provider_batch_state = p_provider_batch_state,
      provider_batch_updated_at = p_provider_batch_updated_at
    where id = p_job_id;
  end if;

  if p_should_insert_event then
    insert into public.takeoff_job_provider_events (
      tenant_id,
      takeoff_job_id,
      estimate_version_id,
      provider,
      processing_strategy,
      provider_batch_id,
      provider_batch_state,
      provider_state_raw,
      message,
      metadata
    ) values (
      p_tenant_id,
      p_job_id,
      p_estimate_version_id,
      p_provider,
      p_processing_strategy,
      p_provider_batch_id,
      p_provider_batch_state,
      p_provider_state_raw,
      p_message,
      coalesce(p_metadata, '{}'::jsonb)
    );
  end if;

  return true;
end;
$$;

create or replace function public.list_due_durable_workflows(
  p_now timestamptz,
  p_limit integer default 20
)
returns table (
  workflow_kind text,
  work_id uuid,
  trigger_kind text,
  due_at timestamptz
)
language sql
stable
set search_path = pg_catalog
as $$
  select candidate.workflow_kind, candidate.work_id,
    candidate.trigger_kind, candidate.due_at
  from (
    select
      'takeoff'::text as workflow_kind,
      job_row.id as work_id,
      case
        when job_row.status = 'failed' then 'retry'
        when job_row.status = 'processing' then 'reconcile'
        else 'create'
      end as trigger_kind,
      case
        when job_row.status = 'failed' then job_row.next_retry_at
        when job_row.status = 'processing' then job_row.provider_reconcile_due_at
        else job_row.created_at
      end as due_at
    from public.takeoff_jobs as job_row
    join public.tenants as tenant_row
      on tenant_row.id = job_row.tenant_id
     and tenant_row.is_active
    where
      job_row.status = 'pending'
      or (
        job_row.status = 'failed'
        and job_row.retry_count < 3
        and job_row.next_retry_at <= p_now
      )
      or (
        job_row.status = 'processing'
        and job_row.processing_strategy = 'batch'
        and job_row.provider_batch_id is not null
        and coalesce(job_row.provider_reconcile_due_at, p_now) <= p_now
        and coalesce(job_row.provider_reconcile_lease_expires_at, p_now) <= p_now
      )

    union all

    select
      'affaire_intake'::text,
      upload_row.id,
      'process'::text,
      case
        when upload_row.status = 'queued'
          then coalesce(upload_row.next_retry_at, upload_row.created_at)
        else coalesce(upload_row.processing_lease_expires_at, upload_row.updated_at)
      end
    from public.affaire_intake_uploads as upload_row
    join public.tenants as tenant_row
      on tenant_row.id = upload_row.tenant_id
     and tenant_row.is_active
    where (
      upload_row.status = 'queued'
      and coalesce(upload_row.next_retry_at, p_now) <= p_now
    ) or (
      upload_row.status = 'processing'
      and (
        upload_row.processing_lease_expires_at <= p_now
        or (
          upload_row.processing_lease_expires_at is null
          and upload_row.updated_at <= p_now - interval '10 minutes'
        )
      )
    )
  ) as candidate
  order by candidate.due_at asc, candidate.work_id asc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

create or replace function public.acquire_takeoff_batch_reconcile_lease(
  p_job_id uuid,
  p_tenant_id uuid,
  p_now timestamptz,
  p_lease_token uuid,
  p_lease_expires_at timestamptz
)
returns table (
  claimed boolean,
  provider_reconcile_attempt_count integer
)
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_attempt_count integer;
begin
  if p_job_id is null
    or p_tenant_id is null
    or p_now is null
    or p_lease_token is null
    or p_lease_expires_at is null
    or p_lease_expires_at <= p_now
  then
    raise exception 'TAKEOFF_RECONCILE_LEASE_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.takeoff_jobs as job_row
  set
    provider_reconcile_lease_token = p_lease_token,
    provider_reconcile_lease_expires_at = p_lease_expires_at,
    provider_reconcile_attempt_count = coalesce(job_row.provider_reconcile_attempt_count, 0) + 1
  from public.tenants as tenant_row
  where job_row.id = p_job_id
    and job_row.tenant_id = p_tenant_id
    and tenant_row.id = job_row.tenant_id
    and tenant_row.is_active
    and job_row.status = 'processing'
    and job_row.processing_strategy = 'batch'
    and job_row.provider_batch_id is not null
    and (
      job_row.provider_batch_state is null
      or job_row.provider_batch_state not in (
        'succeeded'::public.takeoff_provider_batch_state,
        'failed'::public.takeoff_provider_batch_state,
        'cancelled'::public.takeoff_provider_batch_state,
        'expired'::public.takeoff_provider_batch_state
      )
    )
    and coalesce(job_row.provider_reconcile_due_at, p_now) <= p_now
    and coalesce(job_row.provider_reconcile_lease_expires_at, p_now) <= p_now
  returning job_row.provider_reconcile_attempt_count
    into v_attempt_count;

  if found then
    return query select true, v_attempt_count;
    return;
  end if;

  return query select false, null::integer;
end;
$$;

revoke all on function public.claim_affaire_intake_upload(
  uuid, uuid, timestamptz, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.renew_affaire_intake_upload_lease(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.finish_affaire_intake_upload_attempt(
  uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.recover_stale_takeoff_jobs(
  timestamptz, interval
) from public, anon, authenticated;
revoke all on function public.list_due_durable_workflows(
  timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.acquire_takeoff_batch_reconcile_lease(
  uuid, uuid, timestamptz, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.renew_takeoff_processing_lease(
  uuid, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.renew_takeoff_batch_reconcile_lease(
  uuid, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.persist_takeoff_provider_batch_snapshot_fenced(
  uuid, uuid, uuid, text, public.takeoff_processing_strategy, text,
  public.takeoff_provider_batch_state, timestamptz, text, text, jsonb,
  boolean, boolean, uuid, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.claim_affaire_intake_upload(
  uuid, uuid, timestamptz, timestamptz, integer
) to service_role;
grant execute on function public.renew_affaire_intake_upload_lease(
  uuid, uuid, timestamptz, timestamptz
) to service_role;
grant execute on function public.finish_affaire_intake_upload_attempt(
  uuid, uuid, text, timestamptz, timestamptz, text
) to service_role;
grant execute on function public.recover_stale_takeoff_jobs(
  timestamptz, interval
) to service_role;
grant execute on function public.list_due_durable_workflows(
  timestamptz, integer
) to service_role;
grant execute on function public.acquire_takeoff_batch_reconcile_lease(
  uuid, uuid, timestamptz, uuid, timestamptz
) to service_role;
grant execute on function public.renew_takeoff_processing_lease(
  uuid, uuid, uuid, timestamptz, timestamptz
) to service_role;
grant execute on function public.renew_takeoff_batch_reconcile_lease(
  uuid, uuid, uuid, timestamptz, timestamptz
) to service_role;
grant execute on function public.persist_takeoff_provider_batch_snapshot_fenced(
  uuid, uuid, uuid, text, public.takeoff_processing_strategy, text,
  public.takeoff_provider_batch_state, timestamptz, text, text, jsonb,
  boolean, boolean, uuid, uuid, timestamptz
) to service_role;
