-- The historical estimate schema declares authenticated RLS policies but a
-- clean reset does not recreate the matching relation privileges. Without
-- them PostgreSQL rejects Data API requests before RLS can evaluate the row.
-- Keep this list explicit: other public tables include intentionally
-- server-only relations whose authenticated grants must remain revoked.

revoke all privileges
  on table
    public.estimate_projects,
    public.estimate_versions,
    public.estimate_items,
    public.estimate_categories,
    public.labor_roles,
    public.estimate_suggestion_rules,
    public.audit_logs,
    public.plan_sets,
    public.plan_files,
    public.takeoff_jobs,
    public.takeoff_items,
    public.takeoff_results
  from anon, authenticated, PUBLIC;

grant select, insert, update, delete
  on table
    public.estimate_projects,
    public.estimate_versions,
    public.estimate_items,
    public.estimate_categories,
    public.labor_roles,
    public.estimate_suggestion_rules,
    public.plan_sets,
    public.plan_files
  to authenticated;

-- Historical owner policies intentionally preserve read access when a project
-- owner is later downgraded. Keep that SELECT behavior, but require an active
-- writer role for every mutation restored by the relation grants above.
do $operator_policies$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'estimate_projects',
    'estimate_versions',
    'estimate_categories',
    'labor_roles',
    'estimate_suggestion_rules'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'Operators can insert estimate rows',
      relation_name
    );
    execute format(
      $policy$
        create policy %I
          on public.%I
          as restrictive
          for insert
          to authenticated
          with check (
            (select public.has_tenant_role(
              tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            ))
          )
      $policy$,
      'Operators can insert estimate rows',
      relation_name
    );

    execute format(
      'drop policy if exists %I on public.%I',
      'Operators can update estimate rows',
      relation_name
    );
    execute format(
      $policy$
        create policy %I
          on public.%I
          as restrictive
          for update
          to authenticated
          using (
            (select public.has_tenant_role(
              tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            ))
          )
          with check (
            (select public.has_tenant_role(
              tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            ))
          )
      $policy$,
      'Operators can update estimate rows',
      relation_name
    );
  end loop;

  foreach relation_name in array array[
    'estimate_versions',
    'estimate_categories',
    'labor_roles',
    'estimate_suggestion_rules'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'Operators can delete estimate rows',
      relation_name
    );
    execute format(
      $policy$
        create policy %I
          on public.%I
          as restrictive
          for delete
          to authenticated
          using (
            (select public.has_tenant_role(
              tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            ))
          )
      $policy$,
      'Operators can delete estimate rows',
      relation_name
    );
  end loop;
end;
$operator_policies$;

-- The SECURITY INVOKER bulk-delete RPC, the DELETE route and creation
-- rollbacks all require the relation-level DELETE privilege. Add the missing
-- role/archive invariants as a restrictive policy so they also govern direct
-- Data API deletes without breaking those legitimate paths. The existing
-- estimate_versions_delete_draft_only_guard trigger rejects a cascade as soon
-- as it encounters a non-draft version, avoiding recursive project/version
-- RLS policy evaluation.
drop policy if exists "Governed estimate project deletes"
  on public.estimate_projects;
create policy "Governed estimate project deletes"
  on public.estimate_projects
  as restrictive
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and not is_archived
  );

-- Audit rows are append-only for authenticated users. Their SELECT policy is
-- admin-only and their INSERT policy validates the supported audit payloads.
grant select, insert
  on table public.audit_logs
  to authenticated;

-- Authenticated takeoff orchestration creates/retries/cancels jobs and edits
-- extracted items. Result persistence stays worker/service-role only.
grant select, insert, update, delete
  on table public.takeoff_jobs
  to authenticated;

grant select, update
  on table public.takeoff_items
  to authenticated;

grant select
  on table public.takeoff_results
  to authenticated;

-- A project owner can later be downgraded to viewer. The historical permissive
-- job policies still recognize ownership, so restrictive policies preserve
-- read access while limiting job mutations to active operators.
drop policy if exists "Operators can insert takeoff jobs"
  on public.takeoff_jobs;
create policy "Operators can insert takeoff jobs"
  on public.takeoff_jobs
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and status = 'pending'
    and created_by = (select auth.uid())
    and retry_count = 0
    and started_at is null
    and completed_at is null
    and token_count is null
    and cost_cents is null
    and duration_ms is null
    and error_code is null
    and error_message is null
    and next_retry_at is null
    and last_error_at is null
    and model is null
    and thinking_level is null
    and media_resolution is null
    and provider_batch_id is null
    and provider_batch_state is null
    and provider_batch_updated_at is null
    and provider_reconcile_due_at is null
    and provider_reconcile_attempt_count = 0
    and provider_reconcile_lease_token is null
    and provider_reconcile_lease_expires_at is null
  );

drop policy if exists "Operators can update takeoff jobs"
  on public.takeoff_jobs;
create policy "Operators can update takeoff jobs"
  on public.takeoff_jobs
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can delete takeoff jobs"
  on public.takeoff_jobs;
create policy "Operators can delete takeoff jobs"
  on public.takeoff_jobs
  as restrictive
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and status = 'pending'
    and created_by = (select auth.uid())
  );

-- Worker/provider fields are populated by service-role processors. Authenticated
-- writes are limited to the exact cancel, retry, reconcile and atomic-apply
-- transitions used by the server workflows.
create or replace function public.enforce_authenticated_takeoff_job_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_tenant_id uuid;
  parent_version_status text;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select estimate_version.tenant_id, estimate_version.status::text
      into parent_tenant_id, parent_version_status
    from public.estimate_versions as estimate_version
    where estimate_version.id = new.estimate_version_id;

    if parent_tenant_id is null
      or new.tenant_id is distinct from parent_tenant_id
      or parent_version_status is distinct from 'draft'
    then
      raise exception 'TAKEOFF_JOB_VERSION_SCOPE_INVALID' using errcode = '42501';
    end if;

    if new.status <> 'pending'
      or new.created_by is distinct from (select auth.uid())
      or new.retry_count <> 0
      or new.started_at is not null
      or new.completed_at is not null
      or new.token_count is not null
      or new.cost_cents is not null
      or new.duration_ms is not null
      or new.error_code is not null
      or new.error_message is not null
      or new.next_retry_at is not null
      or new.last_error_at is not null
      or new.model is not null
      or new.thinking_level is not null
      or new.media_resolution is not null
      or new.provider_batch_id is not null
      or new.provider_batch_state is not null
      or new.provider_batch_updated_at is not null
      or new.provider_reconcile_due_at is not null
      or new.provider_reconcile_attempt_count <> 0
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
    then
      raise exception 'TAKEOFF_JOB_INITIAL_STATE_INVALID' using errcode = '42501';
    end if;

    if new.plan_set_id is not null
      and (
        new.level = 'A'
        or not exists (
          select 1
          from public.plan_sets as plan_set
          join public.estimate_versions as estimate_version
            on estimate_version.id = new.estimate_version_id
            and estimate_version.tenant_id = new.tenant_id
          where plan_set.id = new.plan_set_id
            and plan_set.tenant_id = new.tenant_id
            and plan_set.project_id = estimate_version.project_id
        )
      )
    then
      raise exception 'TAKEOFF_JOB_PLAN_SET_SCOPE_INVALID' using errcode = '42501';
    end if;

    if new.plan_set_id is null
      and (
        new.source_file_path is null
        or new.source_file_path not like
          new.tenant_id::text || '/' || new.id::text || '/%'
      )
    then
      raise exception 'TAKEOFF_JOB_SOURCE_PATH_INVALID' using errcode = '42501';
    end if;

    return new;
  end if;

  if old.status in ('pending', 'processing') and new.status = 'canceled' then
    if new.next_retry_at is not null
      or new.error_code is not null
      or new.error_message is not null
      or (to_jsonb(new) - array[
      'status', 'completed_at', 'next_retry_at', 'error_code',
      'error_message', 'updated_at'
    ]) is distinct from (to_jsonb(old) - array[
      'status', 'completed_at', 'next_retry_at', 'error_code',
      'error_message', 'updated_at'
    ]) then
      raise exception 'TAKEOFF_JOB_CANCEL_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status in ('failed', 'canceled') and new.status = 'pending' then
    if old.retry_count not between 0 and 2
      or (
        old.status = 'failed'
        and old.completed_at is not null
        and statement_timestamp() < old.completed_at + case old.retry_count
          when 0 then interval '5 seconds'
          when 1 then interval '15 seconds'
          else interval '45 seconds'
        end
      )
      or (
        old.provider_batch_id is not null
        and (
          old.processing_strategy <> 'batch'
          or old.provider_batch_state is null
          or old.provider_batch_state::text not in ('failed', 'cancelled', 'expired')
        )
      )
      or new.retry_count <> old.retry_count + 1
      or new.started_at is not null
      or new.completed_at is not null
      or new.token_count is not null
      or new.cost_cents is not null
      or new.duration_ms is not null
      or new.error_code is not null
      or new.error_message is not null
      or new.next_retry_at is not null
      or new.last_error_at is not null
      or new.provider_batch_id is not null
      or new.provider_batch_state is not null
      or new.provider_batch_updated_at is not null
      or new.provider_reconcile_due_at is not null
      or new.provider_reconcile_attempt_count <> 0
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or (to_jsonb(new) - array[
        'status', 'retry_count', 'started_at', 'completed_at', 'token_count',
        'cost_cents', 'duration_ms', 'error_code', 'error_message',
        'next_retry_at', 'last_error_at', 'provider_batch_id',
        'provider_batch_state', 'provider_batch_updated_at',
        'provider_reconcile_due_at', 'provider_reconcile_attempt_count',
        'provider_reconcile_lease_token', 'provider_reconcile_lease_expires_at',
        'updated_at'
      ]) is distinct from (to_jsonb(old) - array[
        'status', 'retry_count', 'started_at', 'completed_at', 'token_count',
        'cost_cents', 'duration_ms', 'error_code', 'error_message',
        'next_retry_at', 'last_error_at', 'provider_batch_id',
        'provider_batch_state', 'provider_batch_updated_at',
        'provider_reconcile_due_at', 'provider_reconcile_attempt_count',
        'provider_reconcile_lease_token', 'provider_reconcile_lease_expires_at',
        'updated_at'
      ])
    then
      raise exception 'TAKEOFF_JOB_RETRY_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'failed' and new.status = 'processing' then
    if new.processing_strategy <> 'batch'
      or new.provider_batch_id is null
      or old.provider_batch_state is null
      or old.provider_batch_state::text not in (
        'submitted', 'pending', 'running', 'unknown', 'succeeded'
      )
      or (
        old.provider_reconcile_lease_expires_at is not null
        and old.provider_reconcile_lease_expires_at > statement_timestamp()
      )
      or new.retry_count is distinct from old.retry_count
      or new.completed_at is not null
      or new.next_retry_at is not null
      or new.last_error_at is not null
      or new.error_code is not null
      or new.error_message is not null
      or new.provider_reconcile_attempt_count <> 0
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or not coalesce(
        new.provider_reconcile_due_at between
          statement_timestamp() - interval '5 minutes'
          and statement_timestamp() + interval '5 minutes',
        false
      )
      or (to_jsonb(new) - array[
        'status', 'completed_at', 'next_retry_at', 'last_error_at', 'error_code',
        'error_message', 'provider_reconcile_due_at',
        'provider_reconcile_attempt_count', 'provider_reconcile_lease_token',
        'provider_reconcile_lease_expires_at', 'updated_at'
      ]) is distinct from (to_jsonb(old) - array[
        'status', 'completed_at', 'next_retry_at', 'last_error_at', 'error_code',
        'error_message', 'provider_reconcile_due_at',
        'provider_reconcile_attempt_count', 'provider_reconcile_lease_token',
        'provider_reconcile_lease_expires_at', 'updated_at'
      ])
    then
      raise exception 'TAKEOFF_JOB_RECONCILE_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'processing' and new.status = 'processing' then
    if new.processing_strategy <> 'batch'
      or new.provider_batch_id is null
      or old.provider_batch_state is null
      or (
        old.provider_reconcile_lease_expires_at is not null
        and old.provider_reconcile_lease_expires_at > statement_timestamp()
      )
      or new.provider_reconcile_attempt_count is distinct from old.provider_reconcile_attempt_count
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or not coalesce(
        new.provider_reconcile_due_at between
          statement_timestamp() - interval '5 minutes'
          and statement_timestamp() + interval '5 minutes',
        false
      )
      or (to_jsonb(new) - array[
        'provider_reconcile_due_at', 'provider_reconcile_lease_token',
        'provider_reconcile_lease_expires_at', 'updated_at'
      ]) is distinct from (to_jsonb(old) - array[
        'provider_reconcile_due_at', 'provider_reconcile_lease_token',
        'provider_reconcile_lease_expires_at', 'updated_at'
      ])
    then
      raise exception 'TAKEOFF_JOB_RECONCILE_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'completed' and new.status = 'applied' then
    if not coalesce(current_setting('app.takeoff_apply_job', true) = 'on', false)
      or (to_jsonb(new) - array['status', 'completed_at', 'updated_at'])
        is distinct from
        (to_jsonb(old) - array['status', 'completed_at', 'updated_at'])
    then
      raise exception 'TAKEOFF_JOB_APPLY_RPC_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'TAKEOFF_JOB_OPERATOR_UPDATE_DENIED' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_job_fields()
  from public;

drop trigger if exists aac_enforce_authenticated_takeoff_job_fields
  on public.takeoff_jobs;
create trigger aac_enforce_authenticated_takeoff_job_fields
  before insert or update on public.takeoff_jobs
  for each row execute function public.enforce_authenticated_takeoff_job_fields();

-- The historical RPC is owned by the role that created the legacy migration,
-- so later migrations cannot alter its function settings. Keep it invoker-safe
-- and wrap it instead: PostgREST clients cannot set this transaction-local GUC
-- without entering the guarded RPC, while a direct call to the legacy RPC is
-- rolled back by the status trigger at its final applied transition.
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
begin
  select job.tenant_id
    into job_tenant_id
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

create or replace function public.enforce_authenticated_takeoff_item_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_status public.takeoff_job_status;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  select job.status
    into parent_status
  from public.takeoff_jobs as job
  where job.id = new.job_id
    and job.tenant_id = new.tenant_id;

  if parent_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_COMPLETED_JOB_REQUIRED' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'updated_at'
  ]) then
    raise exception 'TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE' using errcode = '42501';
  end if;

  -- A content edit invalidates an earlier human verification unless the caller
  -- explicitly re-attests the new value in the same statement.
  if old.is_verified
    and (
      new.designation is distinct from old.designation
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.evidence is distinct from old.evidence
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

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_item_fields()
  from public;

drop trigger if exists aac_enforce_authenticated_takeoff_item_fields
  on public.takeoff_items;
create trigger aac_enforce_authenticated_takeoff_item_fields
  before update on public.takeoff_items
  for each row execute function public.enforce_authenticated_takeoff_item_fields();
