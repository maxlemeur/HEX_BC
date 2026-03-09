create or replace function public.persist_takeoff_provider_batch_snapshot(
  p_job_id uuid,
  p_tenant_id uuid,
  p_estimate_version_id uuid,
  p_provider text,
  p_processing_strategy public.takeoff_processing_strategy,
  p_provider_batch_id text default null,
  p_provider_batch_state public.takeoff_provider_batch_state default null,
  p_provider_batch_updated_at timestamptz default null,
  p_provider_state_raw text default null,
  p_message text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_should_update_snapshot boolean default true,
  p_should_insert_event boolean default true
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_job_id is null then
    raise exception 'p_job_id is required';
  end if;

  if p_tenant_id is null then
    raise exception 'p_tenant_id is required';
  end if;

  if p_estimate_version_id is null then
    raise exception 'p_estimate_version_id is required';
  end if;

  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'p_provider is required';
  end if;

  if p_should_update_snapshot then
    update public.takeoff_jobs
    set
      processing_strategy = p_processing_strategy,
      provider_batch_id = p_provider_batch_id,
      provider_batch_state = p_provider_batch_state,
      provider_batch_updated_at = p_provider_batch_updated_at
    where id = p_job_id
      and tenant_id = p_tenant_id
      and estimate_version_id = p_estimate_version_id;

    if not found then
      raise exception 'takeoff job not found';
    end if;
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
    )
    values (
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
end;
$$;

revoke all on function public.persist_takeoff_provider_batch_snapshot(
  uuid,
  uuid,
  uuid,
  text,
  public.takeoff_processing_strategy,
  text,
  public.takeoff_provider_batch_state,
  timestamptz,
  text,
  text,
  jsonb,
  boolean,
  boolean
) from public;
revoke all on function public.persist_takeoff_provider_batch_snapshot(
  uuid,
  uuid,
  uuid,
  text,
  public.takeoff_processing_strategy,
  text,
  public.takeoff_provider_batch_state,
  timestamptz,
  text,
  text,
  jsonb,
  boolean,
  boolean
) from authenticated;
grant execute on function public.persist_takeoff_provider_batch_snapshot(
  uuid,
  uuid,
  uuid,
  text,
  public.takeoff_processing_strategy,
  text,
  public.takeoff_provider_batch_state,
  timestamptz,
  text,
  text,
  jsonb,
  boolean,
  boolean
) to authenticated;
