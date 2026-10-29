-- New names deliberately fail closed on an older shared schema: the old RPCs
-- also mutate/requeue Gemini jobs, and must not be called by the local runtime.
create function public.recover_stale_local_takeoff_jobs(
  p_now timestamptz,
  p_stale_after interval default interval '10 minutes'
)
returns table (job_id uuid, error_code text)
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
end;
$$;

create function public.list_due_affaire_intake_workflows(p_now timestamptz, p_limit integer default 20)
returns table (workflow_kind text, work_id uuid, trigger_kind text, due_at timestamptz)
language sql stable
set search_path = pg_catalog
as $$
  select 'affaire_intake'::text, upload_row.id, 'process'::text,
    case when upload_row.status = 'queued' then coalesce(upload_row.next_retry_at, upload_row.created_at)
      else coalesce(upload_row.processing_lease_expires_at, upload_row.updated_at) end as due_at
  from public.affaire_intake_uploads as upload_row
  join public.tenants as tenant_row on tenant_row.id = upload_row.tenant_id and tenant_row.is_active
  where (upload_row.status = 'queued' and coalesce(upload_row.next_retry_at, p_now) <= p_now)
    or (upload_row.status = 'processing' and (upload_row.processing_lease_expires_at <= p_now or
      (upload_row.processing_lease_expires_at is null and upload_row.updated_at <= p_now - interval '10 minutes')))
  order by due_at asc, upload_row.id asc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.recover_stale_local_takeoff_jobs(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.list_due_affaire_intake_workflows(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_local_takeoff_jobs(timestamptz, interval) to service_role;
grant execute on function public.list_due_affaire_intake_workflows(timestamptz, integer) to service_role;
