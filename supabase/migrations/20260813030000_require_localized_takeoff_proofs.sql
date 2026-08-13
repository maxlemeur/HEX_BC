-- A Level C takeoff can only be human-verified and applied when every included
-- item remains traceable to a textual proof and a positive source page.

create or replace function public.enforce_authenticated_takeoff_item_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_status public.takeoff_job_status;
  parent_level public.takeoff_job_level;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  select job.status, job.level
    into parent_status, parent_level
  from public.takeoff_jobs as job
  where job.id = new.job_id
    and job.tenant_id = new.tenant_id;

  if parent_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_COMPLETED_JOB_REQUIRED' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'updated_at'
  ]) then
    raise exception 'TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE' using errcode = '42501';
  end if;

  -- Any content edit invalidates an earlier attestation unless the caller
  -- explicitly re-attests the new value in the same statement.
  if old.is_verified
    and (
      new.designation is distinct from old.designation
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.evidence is distinct from old.evidence
      or new.source_page is distinct from old.source_page
    )
    and new.is_verified is not distinct from old.is_verified
    and new.verified_at is not distinct from old.verified_at
    and new.verified_by is not distinct from old.verified_by
  then
    new.is_verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;

  if new.is_verified is distinct from old.is_verified
    or new.verified_at is distinct from old.verified_at
    or new.verified_by is distinct from old.verified_by
  then
    if new.is_verified then
      if new.verified_by is distinct from (select auth.uid())
        or new.verified_at is null
      then
        raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
      end if;
    elsif new.verified_by is not null or new.verified_at is not null then
      raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
    end if;
  end if;

  if parent_level = 'C'::public.takeoff_job_level
    and new.is_verified
    and (
      nullif(btrim(new.evidence), '') is null
      or new.source_page is null
      or new.source_page < 1
    )
  then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_PROOF_REQUIRED' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_item_fields()
  from public;

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
        and (
          (
            ti.is_verified = false
            and (
              ti.confidence is null
              or ti.confidence < low_confidence_threshold
            )
          )
          or nullif(btrim(ti.evidence), '') is null
          or ti.source_page is null
          or ti.source_page < 1
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
                and (
                  (
                    ti.is_verified = false
                    and (
                      ti.confidence is null
                      or ti.confidence < low_confidence_threshold
                    )
                  )
                  or nullif(btrim(ti.evidence), '') is null
                  or ti.source_page is null
                  or ti.source_page < 1
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

revoke all on function public.enforce_takeoff_apply_security()
  from public;

-- DPGF readiness is computed by the application because it includes the same
-- matching and evidence graph as the review UI. A short-lived, service-issued
-- authorization binds that completed review to the atomic RPC and prevents an
-- authenticated client from bypassing it by calling PostgREST directly.
create table if not exists public.takeoff_apply_authorizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_version_id uuid not null
    references public.estimate_versions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  authorization_token_hash text,
  review_summary jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint takeoff_apply_authorization_token_hash_length_check check (
    authorization_token_hash is null
      or char_length(authorization_token_hash) = 64
  ),
  constraint takeoff_apply_authorization_expiry_check check (
    expires_at > created_at
  )
);

create unique index if not exists takeoff_apply_authorizations_token_unique
  on public.takeoff_apply_authorizations (authorization_token_hash)
  where authorization_token_hash is not null;

create index if not exists takeoff_apply_authorizations_lookup_idx
  on public.takeoff_apply_authorizations (
    tenant_id,
    job_id,
    estimate_version_id,
    user_id,
    expires_at
  )
  where consumed_at is null;

alter table public.takeoff_apply_authorizations enable row level security;
alter table public.takeoff_apply_authorizations force row level security;
revoke all on table public.takeoff_apply_authorizations
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.takeoff_apply_authorizations
  to service_role;

create or replace function public.apply_takeoff_job_guarded(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid default null
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  job_tenant_id uuid;
  job_version_id uuid;
begin
  select job.tenant_id, job.estimate_version_id
    into job_tenant_id, job_version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(
      job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ), false)
  then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.estimate_items as item
    where item.tenant_id = job_tenant_id
      and item.version_id = job_version_id
      and item.item_type = 'line'
      and item.source_provider = 'dpgf'
  ) then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.takeoff_apply_job', 'on', true);
  return query
  select result.*
  from public.apply_takeoff_job(
    p_job_id,
    p_strategy,
    p_target_section_id
  ) as result;
end;
$$;

revoke all
  on function public.apply_takeoff_job_guarded(uuid, text, uuid)
  from public, anon;
grant execute
  on function public.apply_takeoff_job_guarded(uuid, text, uuid)
  to authenticated;

create or replace function public.apply_takeoff_job_guarded(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_dpgf_authorization_token text
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := (select auth.uid());
  job_tenant_id uuid;
  job_version_id uuid;
  authorization_id uuid;
begin
  if caller_id is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select job.tenant_id, job.estimate_version_id
    into job_tenant_id, job_version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(
      job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ), false)
  then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select permit.id
    into authorization_id
  from public.takeoff_apply_authorizations as permit
  where permit.authorization_token_hash = pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(p_dpgf_authorization_token, 'UTF8')
      ),
      'hex'
    )
    and permit.tenant_id = job_tenant_id
    and permit.job_id = p_job_id
    and permit.estimate_version_id = job_version_id
    and permit.user_id = caller_id
    and permit.consumed_at is null
    and permit.expires_at > statement_timestamp()
  for update;

  if authorization_id is null then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_INVALID'
      using errcode = '42501';
  end if;

  update public.takeoff_apply_authorizations as permit
  set
    authorization_token_hash = null,
    consumed_at = statement_timestamp()
  where permit.id = authorization_id;

  perform pg_catalog.set_config('app.takeoff_apply_job', 'on', true);
  return query
  select result.*
  from public.apply_takeoff_job(
    p_job_id,
    p_strategy,
    p_target_section_id
  ) as result;
end;
$$;

revoke all
  on function public.apply_takeoff_job_guarded(uuid, text, uuid, text)
  from public, anon;
grant execute
  on function public.apply_takeoff_job_guarded(uuid, text, uuid, text)
  to authenticated;
