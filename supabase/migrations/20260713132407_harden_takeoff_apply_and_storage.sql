-- Close direct apply RPC and takeoff Storage authorization bypasses.

create table if not exists public.takeoff_apply_override_consumptions (
  audit_log_id uuid primary key
    references public.audit_logs(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete restrict,
  estimate_version_id uuid not null
    references public.estimate_versions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  consumed_at timestamptz not null default statement_timestamp()
);

alter table public.takeoff_apply_override_consumptions enable row level security;
alter table public.takeoff_apply_override_consumptions force row level security;
revoke all on table public.takeoff_apply_override_consumptions
  from public, anon, authenticated;

create or replace function public.enforce_takeoff_item_mutation_before_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_job_id uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  parent_tenant_id uuid;
  parent_status public.takeoff_job_status;
begin
  if tg_op = 'UPDATE' and new.job_id is distinct from old.job_id then
    raise exception 'TAKEOFF_ITEM_JOB_IMMUTABLE' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('takeoff-job:' || target_job_id::text, 0)
  );

  select tj.tenant_id, tj.status
    into parent_tenant_id, parent_status
  from public.takeoff_jobs tj
  where tj.id = target_job_id;

  if parent_tenant_id is null and tg_op = 'DELETE' then
    return old;
  end if;

  if parent_tenant_id is null then
    raise exception 'TAKEOFF_ITEM_JOB_NOT_FOUND' using errcode = '23503';
  end if;

  if parent_status = 'applied' then
    raise exception 'TAKEOFF_ITEM_APPLIED_JOB_IMMUTABLE' using errcode = '42501';
  end if;

  if tg_op <> 'DELETE' then
    new.tenant_id := parent_tenant_id;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function public.enforce_takeoff_item_mutation_before_apply()
  from public;

drop trigger if exists enforce_takeoff_item_mutation_before_apply
  on public.takeoff_items;
create trigger enforce_takeoff_item_mutation_before_apply
  before insert or update or delete on public.takeoff_items
  for each row execute function public.enforce_takeoff_item_mutation_before_apply();

create or replace function public.enforce_takeoff_job_identity_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
    or new.estimate_version_id is distinct from old.estimate_version_id
    or new.level is distinct from old.level
    or new.source_file_name is distinct from old.source_file_name
    or new.source_file_path is distinct from old.source_file_path
    or new.source_file_type is distinct from old.source_file_type
    or new.source_file_size_bytes is distinct from old.source_file_size_bytes
    or new.schema_version is distinct from old.schema_version
    or new.created_by is distinct from old.created_by
    or new.plan_set_id is distinct from old.plan_set_id
  then
    raise exception 'TAKEOFF_JOB_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_takeoff_job_identity_immutable()
  from public;

drop trigger if exists aaa_enforce_takeoff_job_identity_immutable
  on public.takeoff_jobs;
create trigger aaa_enforce_takeoff_job_identity_immutable
  before update of
    tenant_id,
    estimate_version_id,
    level,
    source_file_name,
    source_file_path,
    source_file_type,
    source_file_size_bytes,
    schema_version,
    created_by,
    plan_set_id
  on public.takeoff_jobs
  for each row execute function public.enforce_takeoff_job_identity_immutable();

create or replace function public.enforce_takeoff_job_retry_state()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  is_retry_transition boolean :=
    (old.status = 'failed' and new.status in ('pending', 'processing'))
    or (old.status = 'canceled' and new.status = 'pending');
  is_terminal_transition boolean :=
    old.status in ('pending', 'processing')
    and new.status in ('completed', 'failed', 'canceled');
begin
  -- Worker mutations use service_role. Authenticated operator mutations must
  -- remain inside the public state machine so Data API writes cannot rewind
  -- retry counters or backdate failures before invoking a legitimate retry.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.retry_count < old.retry_count then
    raise exception 'TAKEOFF_RETRY_COUNT_REWIND_DENIED' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'pending' and new.status in ('processing', 'canceled'))
      or (old.status = 'processing' and new.status in ('completed', 'failed', 'canceled'))
      or is_retry_transition
      or (old.status = 'completed' and new.status = 'applied')
    )
  then
    raise exception 'TAKEOFF_JOB_STATUS_TRANSITION_DENIED' using errcode = '42501';
  end if;

  if is_retry_transition then
    if new.status = 'pending' and new.retry_count <> old.retry_count + 1 then
      raise exception 'TAKEOFF_RETRY_INCREMENT_REQUIRED' using errcode = '42501';
    end if;

    if new.status = 'processing'
      and new.retry_count not in (old.retry_count, old.retry_count + 1)
    then
      raise exception 'TAKEOFF_RETRY_INCREMENT_INVALID' using errcode = '42501';
    end if;

    new.completed_at := null;
    new.next_retry_at := null;
  elsif new.retry_count is distinct from old.retry_count then
    raise exception 'TAKEOFF_RETRY_COUNT_MUTATION_DENIED' using errcode = '42501';
  end if;

  if is_terminal_transition then
    new.completed_at := statement_timestamp();
    new.next_retry_at := null;
  elsif new.status = old.status then
    if new.completed_at is distinct from old.completed_at then
      raise exception 'TAKEOFF_COMPLETED_AT_MUTATION_DENIED' using errcode = '42501';
    end if;

    if new.next_retry_at is distinct from old.next_retry_at then
      raise exception 'TAKEOFF_NEXT_RETRY_AT_MUTATION_DENIED' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_takeoff_job_retry_state()
  from public;

drop trigger if exists aab_enforce_takeoff_job_retry_state
  on public.takeoff_jobs;
create trigger aab_enforce_takeoff_job_retry_state
  before update of status, retry_count, completed_at, next_retry_at
  on public.takeoff_jobs
  for each row execute function public.enforce_takeoff_job_retry_state();

create or replace function public.enforce_takeoff_apply_security()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  configured_threshold text;
  low_confidence_threshold numeric := 0.5;
  blocked_items_count integer := 0;
  has_valid_override boolean := false;
  override_audit_id uuid;
begin
  if new.status = 'applied' and old.status is distinct from new.status then
    if caller_id is null then
      raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('takeoff-job:' || new.id::text, 0)
    );

    if not exists (
      select 1
      from public.draft_locks dl
      where dl.version_id = new.estimate_version_id
        and dl.tenant_id = new.tenant_id
        and dl.user_id = (select auth.uid())
        and dl.expires_at > statement_timestamp()
    ) then
      raise exception 'TAKEOFF_APPLY_LOCK_REQUIRED' using errcode = 'P0001';
    end if;

    if new.level = 'C' then
      select btrim(ff.value)
        into configured_threshold
      from public.feature_flags ff
      where ff.tenant_id = new.tenant_id
        and ff.flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD'
        and ff.enabled = true
      limit 1;

      if configured_threshold ~
        '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      then
        begin
          low_confidence_threshold := configured_threshold::numeric;
          if low_confidence_threshold < 0 or low_confidence_threshold > 1 then
            low_confidence_threshold := 0.5;
          end if;
        exception
          when invalid_text_representation or numeric_value_out_of_range then
            low_confidence_threshold := 0.5;
        end;
      end if;

      select count(*)::integer
        into blocked_items_count
      from public.takeoff_items ti
      where ti.job_id = new.id
        and ti.tenant_id = new.tenant_id
        and ti.is_excluded = false
        and ti.is_verified = false
        and (
          ti.confidence is null
          or ti.confidence < low_confidence_threshold
        );

      if blocked_items_count > 0 then
        if (select public.has_tenant_role(
          new.tenant_id,
          array['admin'::public.tenant_role]
        )) then
          select al.id
            into override_audit_id
            from public.audit_logs al
            where al.action = 'takeoff.apply.override'
              and al.table_name = 'takeoff_jobs'
              and al.record_id = new.id
              and al.estimate_version_id = new.estimate_version_id
              and al.tenant_id = new.tenant_id
              and al.user_id = (select auth.uid())
              and al.created_at >= statement_timestamp() - interval '15 minutes'
              and al.created_at <= statement_timestamp() + interval '5 seconds'
              and al.after_data ->> 'action' = 'takeoff.apply.override'
              and al.after_data ->> 'job_id' = new.id::text
              and al.after_data ->> 'tenant_id' = new.tenant_id::text
              and al.after_data ->> 'user_id' = caller_id::text
              and jsonb_typeof(
                al.after_data -> 'metadata' -> 'blocked_item_ids'
              ) = 'array'
              and jsonb_array_length(
                al.after_data -> 'metadata' -> 'blocked_item_ids'
              ) = (
                al.after_data -> 'metadata' ->> 'blocked_items_count'
              )::integer
              and coalesce(
                al.after_data -> 'metadata' ->> 'blocked_items_count',
                ''
              ) ~ '^[0-9]+$'
              and (
                al.after_data -> 'metadata' ->> 'blocked_items_count'
              )::integer = blocked_items_count
              and coalesce(
                al.after_data -> 'metadata' ->> 'threshold',
                ''
              ) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
              and (
                al.after_data -> 'metadata' ->> 'threshold'
              )::numeric = low_confidence_threshold
              and char_length(
                btrim(coalesce(
                  al.after_data -> 'metadata' ->> 'justification',
                  ''
                ))
              ) between 10 and 500
              and not exists (
                select 1
                from public.takeoff_items ti
                where ti.job_id = new.id
                  and ti.tenant_id = new.tenant_id
                  and ti.is_excluded = false
                  and ti.is_verified = false
                  and (
                    ti.confidence is null
                    or ti.confidence < low_confidence_threshold
                  )
                  and not (
                    al.after_data -> 'metadata' -> 'blocked_item_ids'
                  ) ? ti.id::text
              )
              and not exists (
                select 1
                from public.takeoff_apply_override_consumptions consumed
                where consumed.audit_log_id = al.id
              )
            order by al.created_at desc, al.id desc
            limit 1;

          has_valid_override := override_audit_id is not null;
        end if;

        if not has_valid_override then
          raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
        end if;

        insert into public.takeoff_apply_override_consumptions (
          audit_log_id,
          tenant_id,
          job_id,
          estimate_version_id,
          user_id
        )
        values (
          override_audit_id,
          new.tenant_id,
          new.id,
          new.estimate_version_id,
          caller_id
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_takeoff_apply_security on public.takeoff_jobs;
create trigger enforce_takeoff_apply_security
  before update of status on public.takeoff_jobs
  for each row
  when (new.status = 'applied' and old.status is distinct from new.status)
  execute function public.enforce_takeoff_apply_security();

revoke all on function public.enforce_takeoff_apply_security() from public;

drop policy if exists "Tenant members can view takeoff files storage" on storage.objects;
drop policy if exists "Authorized users can view takeoff files storage" on storage.objects;

create policy "Authorized users can view takeoff files storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'takeoff-files'
    and coalesce(
      (storage.foldername(objects.name))[1],
      ''
    ) = (select public.current_tenant_id()::text)
    and coalesce(
      (storage.foldername(objects.name))[2],
      ''
    ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = case
          when coalesce(
            (storage.foldername(objects.name))[2],
            ''
          ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (storage.foldername(objects.name))[2]::uuid
          else null
        end
        and tj.tenant_id = (select public.current_tenant_id())
        and tj.source_file_path = objects.name
        and (select public.can_access_takeoff_estimate_version(
          tj.estimate_version_id,
          tj.tenant_id
        ))
    )
  );
