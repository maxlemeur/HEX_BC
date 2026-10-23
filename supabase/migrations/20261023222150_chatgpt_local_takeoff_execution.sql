-- Provider ownership is fixed at admission, before a shared worker can see a job.
alter table public.takeoff_jobs
  add column execution_provider text not null default 'gemini',
  add column execution_host_id text,
  add constraint takeoff_jobs_execution_owner_check check (
    (execution_provider = 'gemini' and execution_host_id is null)
    or (execution_provider = 'chatgpt_local'
      and execution_host_id ~ '^urn:uuid:[0-9a-f-]{36}$'
      and execution_host_id is not null
      and processing_strategy = 'sync')
  );

create function public.enforce_takeoff_execution_owner()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (
    new.execution_provider is distinct from old.execution_provider
    or new.execution_host_id is distinct from old.execution_host_id
  ) then
    raise exception 'TAKEOFF_EXECUTION_OWNER_IMMUTABLE' using errcode = '42501';
  end if;
  if new.execution_provider = 'chatgpt_local' then
    if tg_op = 'INSERT' then
      if new.status <> 'pending' then
        raise exception 'TAKEOFF_LOCAL_JOB_MUST_START_PENDING' using errcode = '42501';
      end if;
    elsif new.status = 'processing' and old.status <> 'processing' then
      -- Also guards old deployed workers using service_role. Only the local
      -- claim RPC can enter processing; authenticated clients cannot call it.
      if current_setting('app.local_takeoff_claim_job', true) is distinct from new.id::text
        or current_setting('app.local_takeoff_claim_host', true) is distinct from new.execution_host_id
      then
        raise exception 'TAKEOFF_LOCAL_CLAIM_REQUIRED' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_takeoff_execution_owner() from public;
create trigger aaa_enforce_takeoff_execution_owner
  before insert or update on public.takeoff_jobs
  for each row execute function public.enforce_takeoff_execution_owner();

create function public.claim_local_takeoff_job(
  p_job_id uuid,
  p_tenant_id uuid,
  p_host_id text,
  p_started_at timestamptz,
  p_lease_token uuid,
  p_lease_expires_at timestamptz,
  p_model text,
  p_prompt_version text
)
returns setof public.takeoff_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_host_id is null or p_lease_token is null
    or p_started_at is null or p_lease_expires_at <= p_started_at
    or p_lease_expires_at is null or nullif(trim(p_model), '') is null
  then
    raise exception 'TAKEOFF_LOCAL_CLAIM_INVALID' using errcode = '22023';
  end if;
  perform set_config('app.local_takeoff_claim_job', p_job_id::text, true);
  perform set_config('app.local_takeoff_claim_host', p_host_id, true);
  return query
  update public.takeoff_jobs j set
    status = 'processing', started_at = p_started_at, completed_at = null,
    error_code = null, error_message = null, next_retry_at = null,
    last_error_at = null, provider_batch_id = null, provider_batch_state = null,
    provider_batch_updated_at = null, provider_reconcile_due_at = null,
    provider_reconcile_attempt_count = 0, provider_reconcile_lease_token = null,
    provider_reconcile_lease_expires_at = null,
    processing_lease_token = p_lease_token,
    processing_lease_expires_at = p_lease_expires_at,
    model = p_model, thinking_level = null, prompt_version = p_prompt_version,
    processing_strategy = 'sync',
    retry_count = j.retry_count + case when j.status = 'failed' then 1 else 0 end
  where j.id = p_job_id and j.tenant_id = p_tenant_id
    and j.execution_provider = 'chatgpt_local' and j.execution_host_id = p_host_id
    and j.status in ('pending', 'failed')
    and exists (select 1 from public.tenants t where t.id = j.tenant_id and t.is_active)
  returning j.*;
  perform set_config('app.local_takeoff_claim_job', '', true);
  perform set_config('app.local_takeoff_claim_host', '', true);
end;
$$;
revoke all on function public.claim_local_takeoff_job(uuid, uuid, text, timestamptz, uuid, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_local_takeoff_job(uuid, uuid, text, timestamptz, uuid, timestamptz, text, text)
  to service_role;

-- Existing deployed recovery callers keep the same signature and cannot queue
-- a local plan job. Intake recovery and Gemini jobs retain their behavior.
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
    where job_row.execution_provider = 'gemini' and (
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
