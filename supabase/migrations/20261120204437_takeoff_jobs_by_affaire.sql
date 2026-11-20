begin;

set local lock_timeout = '5s';
lock table public.estimate_projects, public.estimate_versions, public.plan_sets in share mode;
alter table public.takeoff_jobs add column project_id uuid;

-- A plan set may be shared by several versions of its affaire. Only the
-- tenant and affaire must match. Uploads without a plan set are historical.
do $$
declare
  invalid_jobs bigint;
begin
  select count(*) into invalid_jobs
  from public.takeoff_jobs j
  left join public.estimate_versions v on v.id = j.estimate_version_id
  left join public.estimate_projects p on p.id = v.project_id
  left join public.plan_sets s on s.id = j.plan_set_id
  where v.id is null
    or v.tenant_id is distinct from j.tenant_id
    or p.id is null
    or p.tenant_id is distinct from j.tenant_id
    or (j.plan_set_id is not null and (
      s.id is null or s.tenant_id is distinct from j.tenant_id
      or s.project_id is distinct from p.id
    ));
  if invalid_jobs > 0 then
    raise exception 'TAKEOFF_JOB_AFFAIRE_BACKFILL_REFUSED: % inconsistent jobs', invalid_jobs;
  end if;
end;
$$;

-- Keep the historical timestamps, including applied jobs.
alter table public.takeoff_jobs disable trigger set_takeoff_jobs_updated_at;
update public.takeoff_jobs j set project_id = v.project_id
from public.estimate_versions v
where v.id = j.estimate_version_id and v.tenant_id = j.tenant_id;
alter table public.takeoff_jobs enable trigger set_takeoff_jobs_updated_at;

-- Keep the plan set's affaire and tenant tied to the job even when an
-- admission and a move race under different transaction snapshots.
alter table public.plan_sets add constraint plan_sets_id_project_tenant_key unique (id, project_id, tenant_id);
alter table public.takeoff_jobs
  alter column project_id set not null,
  alter column estimate_version_id drop not null,
  drop constraint takeoff_jobs_plan_set_id_fkey,
  add constraint takeoff_jobs_plan_set_id_fkey foreign key (plan_set_id, project_id, tenant_id)
    references public.plan_sets(id, project_id, tenant_id) on delete set null (plan_set_id),
  add constraint takeoff_jobs_project_tenant_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade;

create index takeoff_jobs_tenant_project_created_id_idx
  on public.takeoff_jobs(tenant_id, project_id, created_at, id);

create or replace function public.assign_takeoff_jobs_tenant_id()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_tenant uuid;
  parent_project uuid;
begin
  if new.estimate_version_id is not null then
    select v.tenant_id, v.project_id into parent_tenant, parent_project
    from public.estimate_versions v where v.id = new.estimate_version_id;
  else
    select p.tenant_id, p.id into parent_tenant, parent_project
    from public.estimate_projects p where p.id = new.project_id;
  end if;
  if parent_project is null or (new.project_id is not null and new.project_id <> parent_project)
    or (new.tenant_id is not null and new.tenant_id <> parent_tenant) then
    raise exception 'TAKEOFF_JOB_VERSION_SCOPE_INVALID' using errcode = '42501';
  end if;
  new.project_id := parent_project;
  new.tenant_id := parent_tenant;
  if (new.estimate_version_id is null and new.plan_set_id is null)
    or (new.plan_set_id is not null and not exists (
      select 1 from public.plan_sets s where s.id = new.plan_set_id
        and s.tenant_id = new.tenant_id and s.project_id = new.project_id
        and (new.estimate_version_id is not null or s.estimate_version_id is null)
    )) then
    raise exception 'TAKEOFF_JOB_PLAN_SET_SCOPE_INVALID' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Scope is derived on insert before the preparation and authenticated guards.
-- Every later reassignment, including by the worker, is guarded separately.
drop trigger set_takeoff_jobs_tenant_id on public.takeoff_jobs;
create trigger aac_assign_takeoff_job_scope before insert on public.takeoff_jobs
  for each row execute function public.assign_takeoff_jobs_tenant_id();

drop trigger aaa_enforce_takeoff_job_identity_immutable on public.takeoff_jobs;
create trigger aaa_enforce_takeoff_job_identity_immutable
  before update of project_id, tenant_id, estimate_version_id, level,
    source_file_name, source_file_path, source_file_type, source_file_size_bytes,
    schema_version, created_by, plan_set_id
  on public.takeoff_jobs for each row execute function public.enforce_takeoff_job_identity_immutable();

-- A future guarded writer can extend this permit check. No writer is
-- authorized by M1, including a direct service-role UPDATE.
create function private.has_takeoff_job_version_attachment_permit(
  p_tenant_id uuid, p_project_id uuid, p_job_id uuid, p_version_id uuid
) returns boolean
language sql stable set search_path = '' as $$ select false $$;
revoke all on function private.has_takeoff_job_version_attachment_permit(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_takeoff_job_identity_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.project_id is distinct from old.project_id
    or new.tenant_id is distinct from old.tenant_id
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

  if new.estimate_version_id is distinct from old.estimate_version_id then
    if old.estimate_version_id is null and new.estimate_version_id is not null
      and current_user not in ('anon', 'authenticated', 'service_role') then
      perform 1 from public.estimate_versions version
      where version.id = new.estimate_version_id and version.tenant_id = old.tenant_id
        and version.project_id = old.project_id and version.status = 'draft' for share;
      if found and private.has_takeoff_job_version_attachment_permit(
        old.tenant_id, old.project_id, old.id, new.estimate_version_id
      ) is true then
        return new;
      end if;
    end if;
    raise exception 'TAKEOFF_JOB_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_authenticated_takeoff_job_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_tenant_id uuid;
  parent_version_status text;
  dispatch_fields text[] := array[
    'dispatch_status',
    'dispatch_outcome',
    'dispatch_trigger',
    'dispatch_correlation_id',
    'dispatch_status_code',
    'dispatch_updated_at'
  ];
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.estimate_version_id is not null then
      select v.tenant_id, v.status::text into parent_tenant_id, parent_version_status
      from public.estimate_versions v
      where v.id = new.estimate_version_id and v.project_id = new.project_id;
      if new.tenant_id is distinct from parent_tenant_id or parent_version_status is distinct from 'draft' then
        raise exception 'TAKEOFF_JOB_VERSION_SCOPE_INVALID' using errcode = '42501';
      end if;
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
      or new.processing_lease_token is not null
      or new.processing_lease_expires_at is not null
      or new.dispatch_status is not null
      or new.dispatch_outcome is not null
      or new.dispatch_trigger is not null
      or new.dispatch_correlation_id is not null
      or new.dispatch_status_code is not null
      or new.dispatch_updated_at is not null
    then
      raise exception 'TAKEOFF_JOB_INITIAL_STATE_INVALID' using errcode = '42501';
    end if;

    if new.plan_set_id is not null and new.level = 'A' then
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

  if new.dispatch_status is distinct from old.dispatch_status
    or new.dispatch_outcome is distinct from old.dispatch_outcome
    or new.dispatch_trigger is distinct from old.dispatch_trigger
    or new.dispatch_correlation_id is distinct from old.dispatch_correlation_id
    or new.dispatch_status_code is distinct from old.dispatch_status_code
    or new.dispatch_updated_at is distinct from old.dispatch_updated_at
  then
    raise exception 'TAKEOFF_JOB_DISPATCH_FIELDS_IMMUTABLE'
      using errcode = '42501';
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
      ])
    then
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
      or (to_jsonb(new) - (
        array[
          'status', 'retry_count', 'started_at', 'completed_at', 'token_count',
          'cost_cents', 'duration_ms', 'error_code', 'error_message',
          'next_retry_at', 'last_error_at', 'provider_batch_id',
          'provider_batch_state', 'provider_batch_updated_at',
          'provider_reconcile_due_at', 'provider_reconcile_attempt_count',
          'provider_reconcile_lease_token', 'provider_reconcile_lease_expires_at',
          'updated_at'
        ] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array[
          'status', 'retry_count', 'started_at', 'completed_at', 'token_count',
          'cost_cents', 'duration_ms', 'error_code', 'error_message',
          'next_retry_at', 'last_error_at', 'provider_batch_id',
          'provider_batch_state', 'provider_batch_updated_at',
          'provider_reconcile_due_at', 'provider_reconcile_attempt_count',
          'provider_reconcile_lease_token', 'provider_reconcile_lease_expires_at',
          'updated_at'
        ] || dispatch_fields
      ))
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
      or (to_jsonb(new) - (
        array[
          'status', 'completed_at', 'next_retry_at', 'last_error_at', 'error_code',
          'error_message', 'provider_reconcile_due_at',
          'provider_reconcile_attempt_count', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array[
          'status', 'completed_at', 'next_retry_at', 'last_error_at', 'error_code',
          'error_message', 'provider_reconcile_due_at',
          'provider_reconcile_attempt_count', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      ))
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
      or (to_jsonb(new) - (
        array[
          'provider_reconcile_due_at', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array[
          'provider_reconcile_due_at', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      ))
    then
      raise exception 'TAKEOFF_JOB_RECONCILE_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'completed' and new.status = 'applied' then
    if not coalesce(current_setting('app.takeoff_apply_job', true) = 'on', false)
      or (to_jsonb(new) - (
        array['status', 'completed_at', 'updated_at'] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array['status', 'completed_at', 'updated_at'] || dispatch_fields
      ))
    then
      raise exception 'TAKEOFF_JOB_APPLY_RPC_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'TAKEOFF_JOB_OPERATOR_UPDATE_DENIED' using errcode = '42501';
end;
$$;

-- Standalone jobs use the current confirmed preparation. A sealed request can
-- later attest a unit snapshot here and opt out of whole-set completeness.
create function private.attest_takeoff_job_snapshot(p_job public.takeoff_jobs)
returns table (snapshot jsonb, require_complete_plan_set boolean)
language plpgsql set search_path = '' as $$
declare prep public.takeoff_preparations%rowtype;
begin
  -- Take the preparation lock before membership, tenant and project locks,
  -- in the same order as a concurrent edit or confirmation.
  select * into prep from public.takeoff_preparations
  where tenant_id = p_job.tenant_id and project_id = p_job.project_id for share;
  if prep.confirmed_snapshot is null
    or prep.confirmed_snapshot -> 'preparation_revision' is distinct from to_jsonb(prep.revision)
    or prep.confirmed_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
  end if;
  return query select prep.confirmed_snapshot, true;
end;
$$;
revoke all on function private.attest_takeoff_job_snapshot(public.takeoff_jobs) from public, anon, authenticated;

create or replace function private.enforce_takeoff_job_preparation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  authenticated_insert boolean := current_setting('role', true) = 'authenticated';
  project_id_value uuid := new.project_id;
  locked_project_id uuid;
  project_owner uuid;
  project_archived boolean;
  actor_role public.tenant_role;
  attested_snapshot jsonb;
  require_full_set boolean;
  selected_source jsonb;
  plan public.plan_files%rowtype;
  intake public.affaire_intake_documents%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.preparation_snapshot is distinct from old.preparation_snapshot then
      raise exception using errcode = '42501', message = 'TAKEOFF_JOB_PREPARATION_IMMUTABLE';
    end if;
    return new;
  end if;
  if not authenticated_insert and new.estimate_version_id is not null and new.preparation_snapshot is null then
    return new; -- Existing service/SQL fixtures and historical jobs stay compatible.
  end if;
  select attested.snapshot, attested.require_complete_plan_set into attested_snapshot, require_full_set
  from private.attest_takeoff_job_snapshot(new) attested;
  if attested_snapshot is null or attested_snapshot is distinct from new.preparation_snapshot or require_full_set is null then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
  end if;
  if new.estimate_version_id is null then
    if new.created_by is null or new.level <> 'C' or new.execution_provider <> 'chatgpt_local'
      or new.execution_host_id is null or new.source_file_path is not null
      or new.processing_lease_token is not null or new.processing_lease_expires_at is not null
      or attested_snapshot #>> '{preparation,destination,kind}' is distinct from 'analysis_only'
      or attested_snapshot #>> '{preparation,destination,estimate_version_id}' is not null
      or exists (
        select 1 from jsonb_array_elements(attested_snapshot #> '{preparation,sources}') source
        where source -> 'active' = 'true'::jsonb and source ->> 'document_id' like 'upload:%'
      )
    then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
    end if;
    if not authenticated_insert then actor := new.created_by; end if;
  end if;
  if authenticated_insert or new.estimate_version_id is null then
    perform 1 from public.tenant_memberships where user_id = actor order by id for share;
    perform 1 from public.tenants where id in (
      select tenant_id from public.tenant_memberships where user_id = actor
    ) order by id for share;
    if actor is null or (authenticated_insert and new.tenant_id is distinct from public.current_tenant_id()) then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
    end if;
    select membership.role into actor_role from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id and tenant.is_active
    where membership.user_id = actor and membership.tenant_id = new.tenant_id
    for share of membership, tenant;
    if actor_role is null or actor_role not in ('admin', 'engineer') then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
    end if;
  end if;
  select project.id, project.user_id, project.is_archived into locked_project_id, project_owner, project_archived
  from public.estimate_projects project
  where project.id = project_id_value and project.tenant_id = new.tenant_id
  for share;
  if new.estimate_version_id is not null then
    perform 1 from public.estimate_versions version
    where version.id = new.estimate_version_id and version.tenant_id = new.tenant_id
      and version.project_id = project_id_value for share;
    if not found then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
    end if;
  end if;
  if locked_project_id is distinct from project_id_value or project_archived
    or ((authenticated_insert or new.estimate_version_id is null)
      and actor_role <> 'admin' and project_owner is distinct from actor) then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
  end if;
  if attested_snapshot #>> '{preparation,destination,kind}' = 'estimate_review'
    and attested_snapshot #>> '{preparation,destination,estimate_version_id}' is distinct from new.estimate_version_id::text
    and not exists (
      select 1 from public.audit_logs receipt
      where receipt.action = 'takeoff.preparation.version_created'
        and receipt.table_name = 'estimate_versions'
        and receipt.tenant_id = new.tenant_id
        and receipt.record_id = new.estimate_version_id
        and receipt.estimate_version_id = new.estimate_version_id
        and receipt.user_id is not null
        and receipt.after_data -> 'schema_version' = '1'::jsonb
        and receipt.after_data ->> 'project_id' = project_id_value::text
        and receipt.after_data ->> 'source_version_id' = attested_snapshot #>> '{preparation,destination,estimate_version_id}'
        and receipt.after_data ->> 'target_version_id' = new.estimate_version_id::text
        and receipt.after_data -> 'preparation_revision' = attested_snapshot -> 'preparation_revision'
    ) then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_DESTINATION_MISMATCH';
  end if;
  if (new.plan_set_id is not null and not exists (
      select 1 from jsonb_array_elements(attested_snapshot #> '{preparation,sources}') source
      where source -> 'active' = 'true'::jsonb and source ->> 'kind' = 'plan'
    )) or exists (
      select 1 from jsonb_array_elements(attested_snapshot #> '{preparation,sources}') source
      where source -> 'active' = 'true'::jsonb and source ->> 'kind' = 'plan'
        and source ->> 'plan_set_id' is distinct from new.plan_set_id::text
    ) then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_SOURCE_MISMATCH';
  end if;
  for selected_source in select value from jsonb_array_elements(attested_snapshot #> '{preparation,sources}')
    where value -> 'active' = 'true'::jsonb and value ->> 'document_id' not like 'upload:%'
  loop
    if selected_source ->> 'plan_set_id' is not null then
      -- Lock the set against concurrent new FK children as well as existing file
      -- changes. A new page/file in a selected set needs a fresh review too.
      perform 1 from public.plan_sets where id::text = selected_source ->> 'plan_set_id'
        and tenant_id = new.tenant_id and project_id = project_id_value
        and (new.estimate_version_id is not null or estimate_version_id is null) for update;
      if not found then
        raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_SOURCE_STALE';
      end if;
      select file.* into plan from public.plan_files file
      where file.id::text = selected_source ->> 'document_id' and file.tenant_id = new.tenant_id for share;
      if not found or plan.plan_set_id::text is distinct from selected_source ->> 'plan_set_id'
        or plan.file_path is distinct from selected_source ->> 'file_path'
        or plan.page_count is distinct from (selected_source ->> 'page_count')::integer
        or plan.updated_at is distinct from (selected_source ->> 'source_updated_at')::timestamptz
        or (require_full_set and exists (
          select 1 from public.plan_files file where file.plan_set_id = plan.plan_set_id
          and not exists (
            select 1 from jsonb_array_elements(attested_snapshot #> '{preparation,sources}') known
            where known ->> 'document_id' = file.id::text
          )
        )) then
        raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_SOURCE_STALE';
      end if;
    else
      select * into intake from public.affaire_intake_documents
      where id::text = selected_source ->> 'document_id' and tenant_id = new.tenant_id
        and project_id = project_id_value and upload_status = 'uploaded'
        and deleted_at is null and deletion_token is null for share;
      if not found or intake.storage_path is distinct from selected_source ->> 'file_path'
        or intake.updated_at is distinct from (selected_source ->> 'source_updated_at')::timestamptz
        or (case when intake.document_kind in ('dpgf', 'cctp') then intake.document_kind else 'other' end)
          is distinct from selected_source ->> 'kind' then
        raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_SOURCE_STALE';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

-- Give ordinary callers a domain error on attempted moves. The foreign key
-- enforces the invariant even when two transactions race.
create function private.guard_referenced_takeoff_plan_set_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.takeoff_jobs j where j.plan_set_id = old.id
  ) then
    raise exception 'TAKEOFF_PLAN_SET_IN_USE' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_referenced_takeoff_plan_set_scope() from public, anon, authenticated;
create trigger zz_guard_referenced_takeoff_plan_set_scope before update on public.plan_sets
  for each row when (old.project_id is distinct from new.project_id or old.tenant_id is distinct from new.tenant_id)
  execute function private.guard_referenced_takeoff_plan_set_scope();

create index audit_logs_takeoff_job_creation_receipt_idx on public.audit_logs (tenant_id, record_id)
  where table_name = 'takeoff_jobs' and action = 'takeoff.job.created';

-- The new admission RPC stays an invoker so existing authenticated RLS and
-- INSERT guards still run. This trigger grants only the fixed creation event
-- for the job just inserted by that RPC. Older direct INSERTs keep their
-- original audit protocol while the application is being deployed.
create function private.record_prepared_takeoff_job_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  guidance jsonb;
  metadata jsonb;
begin
  if nullif(current_setting('mergeone.takeoff_admission_job', true), '') is distinct from new.id::text
    or current_setting('role', true) <> 'authenticated'
    or auth.uid() is null or new.created_by is distinct from auth.uid()
    or new.plan_set_id is null or new.status <> 'pending' then
    return new;
  end if;
  guidance := current_setting('mergeone.takeoff_admission_guidance')::jsonb;
  metadata := jsonb_build_object(
    'level', new.level, 'estimate_version_id', new.estimate_version_id, 'source_file_name', new.source_file_name,
    'idempotency_key', null, 'plan_set_id', new.plan_set_id,
    'classification', guidance->'classification', 'selection', guidance->'selection'
  );
  if new.estimate_version_id is null then
    metadata := metadata || jsonb_build_object('project_id', new.project_id);
  end if;

  begin
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (new.tenant_id, new.created_by, 'takeoff_jobs', new.id, new.estimate_version_id, 'takeoff.job.created',
      jsonb_build_object('schema_version', 1, 'action', 'takeoff.job.created', 'job_id', new.id,
        'tenant_id', new.tenant_id, 'user_id', new.created_by, 'metadata', metadata));
  exception when others then
    raise exception 'TAKEOFF_JOB_CREATION_AUDIT_FAILED' using errcode = 'P0001';
  end;
  return new;
end;
$$;
revoke all on function private.record_prepared_takeoff_job_creation() from public, anon, authenticated;
create trigger record_prepared_takeoff_job_creation after insert on public.takeoff_jobs
  for each row execute function private.record_prepared_takeoff_job_creation();

create function public.admit_prepared_takeoff_job(p_job jsonb, p_guidance jsonb)
returns setof public.takeoff_jobs
language plpgsql security invoker set search_path = '' as $$
declare
  requested public.takeoff_jobs := jsonb_populate_record(null::public.takeoff_jobs, p_job);
begin
  if current_user <> 'authenticated' or auth.uid() is null or requested.id is null or requested.plan_set_id is null
    or jsonb_typeof(p_guidance) is distinct from 'object'
    or octet_length(p_guidance::text) > 16384 then
    raise exception 'TAKEOFF_JOB_ADMISSION_INVALID' using errcode = '22023';
  end if;
  perform set_config('mergeone.takeoff_admission_job', requested.id::text, true);
  perform set_config('mergeone.takeoff_admission_guidance', p_guidance::text, true);
  return query
    insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, plan_set_id, level, status,
      processing_strategy, source_file_name, source_file_path, source_file_type, source_file_size_bytes, prompt_version,
      created_by, preparation_snapshot, execution_provider, execution_host_id)
    values (requested.id, requested.tenant_id, requested.project_id, requested.estimate_version_id, requested.plan_set_id,
      requested.level, 'pending', 'sync', requested.source_file_name, requested.source_file_path, requested.source_file_type,
      requested.source_file_size_bytes, requested.prompt_version, auth.uid(), requested.preparation_snapshot,
      requested.execution_provider, requested.execution_host_id)
    returning *;
  perform set_config('mergeone.takeoff_admission_job', '', true);
  perform set_config('mergeone.takeoff_admission_guidance', '', true);
end;
$$;
revoke all on function public.admit_prepared_takeoff_job(jsonb, jsonb) from public, anon, service_role;
grant execute on function public.admit_prepared_takeoff_job(jsonb, jsonb) to authenticated;

-- Row scope for RLS on the jobs themselves. Preserve the historical version
-- access check; versionless jobs follow the affaire's reader/operator rules.
create function private.can_access_takeoff_scope(
  p_tenant_id uuid, p_project_id uuid, p_version_id uuid, p_write boolean
) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_tenant_id = (select public.current_tenant_id())
    and case
      when p_version_id is not null then
        public.can_access_takeoff_estimate_version(p_version_id, p_tenant_id)
        and exists (select 1 from public.estimate_versions v
          where v.id = p_version_id and v.tenant_id = p_tenant_id and v.project_id = p_project_id)
        and (not p_write or public.has_tenant_role(p_tenant_id, array['admin', 'engineer']::public.tenant_role[]))
      else exists (
        select 1
        from public.estimate_projects p
        join public.tenant_memberships m on m.tenant_id = p.tenant_id and m.user_id = (select auth.uid())
        where p.id = p_project_id and p.tenant_id = p_tenant_id and not p.is_archived
          and case when p_write then
            m.role = 'admin' or (m.role = 'engineer' and p.user_id = m.user_id)
          else public.can_read_affaire_intake_project(p_project_id, p_tenant_id)
          end
      )
    end
$$;
revoke all on function private.can_access_takeoff_scope(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_takeoff_scope(uuid, uuid, uuid, boolean) to authenticated;

create function private.can_access_takeoff_child(
  p_tenant_id uuid, p_job_id uuid, p_result_id uuid, p_write boolean
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.takeoff_jobs j
    where j.id = p_job_id and j.tenant_id = p_tenant_id
      and private.can_access_takeoff_scope(j.tenant_id, j.project_id, j.estimate_version_id, p_write)
      and (p_result_id is null or exists (
        select 1 from public.takeoff_results r
        where r.id = p_result_id and r.job_id = j.id and r.tenant_id = j.tenant_id
      ))
  )
$$;
revoke all on function private.can_access_takeoff_child(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_takeoff_child(uuid, uuid, uuid, boolean) to authenticated;

alter policy "Current tenant can select takeoff jobs" on public.takeoff_jobs
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, estimate_version_id, false)));
alter policy "Current tenant can insert takeoff jobs" on public.takeoff_jobs
  with check ((select private.can_access_takeoff_scope(tenant_id, project_id, estimate_version_id, true)));
alter policy "Current tenant can update takeoff jobs" on public.takeoff_jobs
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, estimate_version_id, true)))
  with check ((select private.can_access_takeoff_scope(tenant_id, project_id, estimate_version_id, true)));
alter policy "Current tenant can delete takeoff jobs" on public.takeoff_jobs
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, estimate_version_id, true)));

-- Retain the grants and the restrictive policies. In particular, the vector
-- tables have only SELECT policies, and no authenticated write privileges.
do $$
declare
  relation record;
  op text;
  read_scope text;
  write_scope text;
begin
  for relation in select * from (values
    ('takeoff_results', 'results', 'null'),
    ('takeoff_items', 'items', 'result_id'),
    ('takeoff_run_metrics', 'run metrics', 'result_id'),
    ('takeoff_vector_pages', 'vector pages', 'result_id'),
    ('takeoff_item_geometries', 'item geometries', 'null')
  ) as relations(table_name, policy_suffix, result_key)
  loop
    read_scope := format('(select private.can_access_takeoff_child(tenant_id, job_id, %s, false))', relation.result_key);
    write_scope := format('(select private.can_access_takeoff_child(tenant_id, job_id, %s, true))', relation.result_key);
    execute format('alter policy %I on public.%I using (%s)',
      'Current tenant can select takeoff ' || relation.policy_suffix, relation.table_name, read_scope);
    if relation.table_name in ('takeoff_results', 'takeoff_items', 'takeoff_run_metrics') then
      foreach op in array array['insert', 'update', 'delete'] loop
        execute format('alter policy %I on public.%I %s %s',
          'Current tenant can ' || op || ' takeoff ' || relation.policy_suffix, relation.table_name,
          case when op <> 'insert' then 'using (' || write_scope || ')' else '' end,
          case when op <> 'delete' then 'with check (' || write_scope || ')' else '' end);
      end loop;
    end if;
  end loop;
end;
$$;

create function private.can_access_takeoff_storage(p_path text, p_write boolean)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.takeoff_jobs j
    where j.id = case
      when (storage.foldername(p_path))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (storage.foldername(p_path))[2]::uuid end
      and j.tenant_id::text = (storage.foldername(p_path))[1]
      and j.source_file_path = p_path
      and private.can_access_takeoff_scope(j.tenant_id, j.project_id, j.estimate_version_id, p_write)
  )
$$;
revoke all on function private.can_access_takeoff_storage(text, boolean) from public, anon;
grant execute on function private.can_access_takeoff_storage(text, boolean) to authenticated;

alter policy "Authorized users can view takeoff files storage" on storage.objects
  using (bucket_id = 'takeoff-files' and (select private.can_access_takeoff_storage(name, false)));
alter policy "Authorized operators can update takeoff storage" on storage.objects
  using (bucket_id <> 'takeoff-files' or (select private.can_access_takeoff_storage(name, true)))
  with check (bucket_id <> 'takeoff-files' or (select private.can_access_takeoff_storage(name, true)));
alter policy "Authorized operators can delete takeoff storage" on storage.objects
  using (bucket_id <> 'takeoff-files' or (select private.can_access_takeoff_storage(name, true)));

-- Permit reading the plan metadata of an attested job. Original PDF bytes
-- are served only after the application checks the job and the content digest.
create function private.can_read_takeoff_plan_evidence(
  p_tenant_id uuid, p_plan_set_id uuid, p_file_id uuid, p_path text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.plan_sets s
    join public.takeoff_jobs j on j.plan_set_id = s.id and j.tenant_id = s.tenant_id and j.project_id = s.project_id
    where s.id = p_plan_set_id and s.tenant_id = p_tenant_id
      and j.estimate_version_id is null
      and private.can_access_takeoff_scope(j.tenant_id, j.project_id, null, false)
      and (p_file_id is null or j.preparation_snapshot #> '{preparation,sources}' @> jsonb_build_array(
        jsonb_build_object('document_id', p_file_id, 'plan_set_id', s.id, 'file_path', p_path,
          'kind', 'plan', 'active', true, 'confirmed', true)))
  )
$$;
revoke all on function private.can_read_takeoff_plan_evidence(uuid, uuid, uuid, text) from public, anon;
grant execute on function private.can_read_takeoff_plan_evidence(uuid, uuid, uuid, text) to authenticated;

create policy "Readers can select takeoff plan evidence sets" on public.plan_sets
  for select to authenticated
  using ((select private.can_read_takeoff_plan_evidence(tenant_id, id, null, null)));
create policy "Readers can select takeoff plan evidence files" on public.plan_files
  for select to authenticated
  using ((select private.can_read_takeoff_plan_evidence(tenant_id, plan_set_id, id, file_path)));
create or replace function public.enforce_takeoff_item_mutation_before_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_job_id uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  job_lock bigint := pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0);
  parent_tenant_id uuid;
  parent_status public.takeoff_job_status;
begin
  if tg_op = 'UPDATE' and new.job_id is distinct from old.job_id then
    raise exception 'TAKEOFF_ITEM_JOB_IMMUTABLE' using errcode = '42501';
  end if;

  if exists (select 1 from public.takeoff_jobs j where j.id = target_job_id and j.estimate_version_id is null) then
    -- A direct UPDATE may already hold a peer's row when it reaches this trigger.
    if not pg_catalog.pg_try_advisory_xact_lock(job_lock) then
      raise exception 'TAKEOFF_ITEM_JOB_BUSY' using errcode = '55P03';
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(job_lock);
  end if;

  select j.tenant_id, j.status into parent_tenant_id, parent_status
  from public.takeoff_jobs j where j.id = target_job_id;
  if parent_tenant_id is null then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'TAKEOFF_ITEM_JOB_NOT_FOUND' using errcode = '23503';
  end if;
  if parent_status = 'applied' then
    raise exception 'TAKEOFF_ITEM_APPLIED_JOB_IMMUTABLE' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.tenant_id := parent_tenant_id;
  return new;
end;
$$;

create or replace function public.update_takeoff_item_for_review(
  p_tenant_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb
)
returns setof public.takeoff_items
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  version_id uuid;
  assignments text;
begin
  if pg_catalog.jsonb_typeof(p_fields) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_fields) as field(name)
      where field.name <> all (array[
        'designation', 'quantity', 'unit', 'source_page', 'is_excluded', 'exclusion_reason', 'is_verified',
        'verified_at', 'verified_by', 'verification_justification', 'evidence', 'quantity_entered_at', 'quantity_entered_by',
        'quantity_entry_category', 'quantity_entry_note', 'updated_at'
      ])
    )
  then
    raise exception 'TAKEOFF_ITEM_PATCH_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.string_agg(pg_catalog.format('%I = patch.%I', field.name, field.name), ', ' order by field.name)
    into assignments
  from pg_catalog.jsonb_object_keys(p_fields) as field(name);
  if assignments is null then
    return;
  end if;

  select job.estimate_version_id
    into version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id
    and job.tenant_id = p_tenant_id;
  if not found then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(case when version_id is null then 'takeoff-job-rules:' || p_job_id::text
      else 'takeoff-rules:' || version_id::text end, 0));
  if version_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || p_job_id::text, 0));
  end if;

  return query execute pg_catalog.format(
    'update public.takeoff_items as item set %s
     from pg_catalog.jsonb_populate_record(null::public.takeoff_items, $1) as patch
     where item.id = $2 and item.job_id = $3 and item.tenant_id = $4 and item.updated_at = $5
     returning item.*',
    assignments
  ) using p_fields, p_item_id, p_job_id, p_tenant_id, p_expected_updated_at;
end;
$$;

create or replace function public.update_takeoff_item_for_review(
  p_tenant_id uuid, p_job_id uuid, p_item_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_expected_rules_evaluated_at timestamptz
)
returns setof public.takeoff_items
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare version_id uuid;
begin
  select j.estimate_version_id into version_id from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id;
  if not found or p_expected_rules_evaluated_at is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(case when version_id is null then 'takeoff-job-rules:' || p_job_id::text
      else 'takeoff-rules:' || version_id::text end, 0));
  if version_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || p_job_id::text, 0));
  end if;
  if not exists (
    select 1 from public.takeoff_items i
    where i.id = p_item_id and i.job_id = p_job_id and i.tenant_id = p_tenant_id
      and not i.rules_stale and i.rules_evaluated_at = p_expected_rules_evaluated_at
  ) then return; end if;
  return query select * from public.update_takeoff_item_for_review(
    p_tenant_id, p_job_id, p_item_id, p_expected_updated_at, p_fields
  );
end;
$$;

create or replace function public.stale_takeoff_rule_peers()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  versions uuid[];
  version_id uuid;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select pg_catalog.array_agg(distinct changed_job.estimate_version_id order by changed_job.estimate_version_id)
      into versions
    from new_rows as changed
    join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
    where changed.rules_stale and changed_job.estimate_version_id is not null;
  else
    select pg_catalog.array_agg(distinct changed_job.estimate_version_id order by changed_job.estimate_version_id)
      into versions
    from new_rows as changed
    join old_rows as previous on previous.id = changed.id
    join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
    where changed.rules_stale and changed.rules_stale_at is distinct from previous.rules_stale_at
      and changed_job.estimate_version_id is not null;
  end if;
  if tg_op = 'INSERT' then
    update public.takeoff_items item
    set rules_stale = true, rules_stale_at = clock_timestamp()
    from public.takeoff_jobs job
    where job.id = item.job_id and job.tenant_id = item.tenant_id
      and job.estimate_version_id is null and job.status = 'completed'
      and (item.rules_evaluated_at is not null or item.rules_stale)
      and exists (select 1 from new_rows changed
        where changed.job_id = job.id and changed.tenant_id = job.tenant_id and changed.rules_stale);
  else
    update public.takeoff_items item
    set rules_stale = true, rules_stale_at = clock_timestamp()
    from public.takeoff_jobs job
    where job.id = item.job_id and job.tenant_id = item.tenant_id
      and job.estimate_version_id is null and job.status = 'completed'
      and (item.rules_evaluated_at is not null or item.rules_stale)
      and exists (select 1 from new_rows changed join old_rows previous on previous.id = changed.id
        where changed.job_id = job.id and changed.tenant_id = job.tenant_id
          and changed.rules_stale and changed.rules_stale_at is distinct from previous.rules_stale_at);
  end if;
  if versions is null then
    return null;
  end if;

  foreach version_id in array versions loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || version_id::text, 0));
  end loop;

  if tg_op = 'INSERT' then
    update public.takeoff_items as item
    set rules_stale = true, rules_stale_at = pg_catalog.clock_timestamp()
    from public.takeoff_jobs as job
    where job.status = 'completed'::public.takeoff_job_status
      and item.job_id = job.id
      and item.tenant_id = job.tenant_id
      -- Every line the rules read: evaluated, or awaiting its first evaluation (stale since the worker wrote it).
      and (item.rules_evaluated_at is not null or item.rules_stale)
      and (job.tenant_id, job.estimate_version_id) in (
        select changed_job.tenant_id, changed_job.estimate_version_id
        from new_rows as changed
        join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
        where changed.rules_stale
      );
  else
    update public.takeoff_items as item
    set rules_stale = true, rules_stale_at = pg_catalog.clock_timestamp()
    from public.takeoff_jobs as job
    where job.status = 'completed'::public.takeoff_job_status
      and item.job_id = job.id
      and item.tenant_id = job.tenant_id
      -- Every line the rules read: evaluated, or awaiting its first evaluation (stale since the worker wrote it).
      and (item.rules_evaluated_at is not null or item.rules_stale)
      and (job.tenant_id, job.estimate_version_id) in (
        select changed_job.tenant_id, changed_job.estimate_version_id
        from new_rows as changed
        join old_rows as previous on previous.id = changed.id
        join public.takeoff_jobs as changed_job on changed_job.id = changed.job_id and changed_job.tenant_id = changed.tenant_id
        where changed.rules_stale and changed.rules_stale_at is distinct from previous.rules_stale_at
      );
  end if;
  return null;
end;
$$;

create function takeoff_internal.persist_rule_results(
  p_tenant_id uuid, p_estimate_version_id uuid, writable uuid[],
  p_items jsonb, p_transforms jsonb
)
returns table (item_id uuid, reopened boolean, failures_grew boolean)
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare
  grew boolean;
  reopened_ids uuid[];
  written uuid[];
begin
  update public.takeoff_item_geometries as stored
  set geometry = pg_catalog.jsonb_set(stored.geometry, '{transform}', coalesce(entry.transform, 'null'::jsonb))
  from pg_catalog.jsonb_to_recordset(coalesce(p_transforms, '[]'::jsonb)) as entry(item_id uuid, transform jsonb)
  where stored.takeoff_item_id = entry.item_id
    and stored.tenant_id = p_tenant_id
    and stored.job_id = any(writable)
    and (
      entry.transform is null
      or entry.transform = 'null'::jsonb
      or (pg_catalog.jsonb_typeof(entry.transform) = 'array' and pg_catalog.jsonb_array_length(entry.transform) = 6)
    );

  -- Lock only current rows of writable jobs, then decide and persist once from those exact rows.
  with locked as materialized (
    select item.id, item.job_id, item.is_verified, item.verified_at, item.verified_by, item.rule_results,
      entry.results, entry.complete_failure_keys
    from public.takeoff_items item join jsonb_to_recordset(p_items) entry(id uuid, results jsonb,
      expected_updated_at timestamptz, expected_stale_at timestamptz, complete_failure_keys jsonb) on item.id=entry.id
    where item.tenant_id=p_tenant_id and item.job_id=any(writable) and item.updated_at=entry.expected_updated_at
      and item.rules_stale_at is not distinct from entry.expected_stale_at
    for update of item
  ), identities as materialized (
    select line.*, coalesce(proof.failure_keys,public.takeoff_rule_failure_keys(line.rule_results)) as previous_keys,
      takeoff_internal.complete_keys(line.results,line.complete_failure_keys) as next_keys
    from locked line left join takeoff_internal.rule_failure_proofs proof on proof.item_id=line.id
  ), mark_unproved as (
    update public.takeoff_items item set rules_stale=true,rules_stale_at=statement_timestamp()
    from identities line where item.id=line.id and not item.rules_stale and line.next_keys is null
  ), decisions as materialized (
    select line.*, fresh.codes
    from identities line cross join lateral (
      select string_agg(distinct split_part(key,'|',2), ', ' order by split_part(key,'|',2)) as codes
      from (select value as key from jsonb_array_elements_text(line.next_keys)
        except select value from jsonb_array_elements_text(line.previous_keys)) as added
    ) fresh where line.next_keys is not null
  ), saved as (
    update public.takeoff_items item set
      rule_results=d.results, rules_evaluated_at=statement_timestamp(), rules_stale=false,
      is_verified=case when d.codes is null then item.is_verified else false end,
      verified_at=case when d.codes is null or not d.is_verified then item.verified_at else null end,
      verified_by=case when d.codes is null or not d.is_verified then item.verified_by else null end,
      updated_at=case when d.codes is null then item.updated_at else now() end
    from decisions d where item.id=d.id
    returning item.id, item.job_id, d.is_verified as was_verified, d.verified_at, d.verified_by,
      d.rule_results as previous, d.codes, d.complete_failure_keys
  ), keep_proofs as (
    insert into takeoff_internal.rule_failure_proofs as p (item_id,failure_keys)
    select id,complete_failure_keys from saved where complete_failure_keys is not null
    on conflict on constraint rule_failure_proofs_pkey do update set failure_keys=excluded.failure_keys
    where p.failure_keys is distinct from excluded.failure_keys
  ), clear_proofs as (
    delete from takeoff_internal.rule_failure_proofs p using saved
    where p.item_id=saved.id and saved.complete_failure_keys is null
  ), journal as (
    insert into public.audit_logs (tenant_id,user_id,table_name,record_id,estimate_version_id,action,before_data,after_data)
    select p_tenant_id,null,'takeoff_items',s.job_id,p_estimate_version_id,'takeoff.item.modified',
      jsonb_build_object('is_verified',true,'verified_at',s.verified_at,'verified_by',s.verified_by,
        'rule_failures',public.takeoff_rule_failure_keys(s.previous)),
      jsonb_build_object('schema_version',1,'action','takeoff.item.modified','job_id',s.job_id,
        'tenant_id',p_tenant_id,'user_id',null,'metadata',jsonb_build_object('item_id',s.id,'field','is_verified',
        'previous_value',true,'next_value',false,'reason',left('Règles recalculées : nouvel échec à vérifier (' || s.codes || ').',500)))
    from saved s where s.was_verified and s.codes is not null
  )
  select coalesce(array_agg(id),'{}'::uuid[]),coalesce(array_agg(id) filter (where codes is not null and was_verified),'{}'::uuid[]),
         coalesce(bool_or(codes is not null),false)
    into written,reopened_ids,grew from saved;
  return query select id, id = any(reopened_ids), grew from unnest(written) as w(id);
end;
$$;
revoke all on function takeoff_internal.persist_rule_results(uuid, uuid, uuid[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function takeoff_internal.persist_rule_results(uuid, uuid, uuid[], jsonb, jsonb) to service_role;

create or replace function public.write_takeoff_rule_results(
  p_tenant_id uuid,
  p_estimate_version_id uuid,
  p_items jsonb,
  p_transforms jsonb default '[]'::jsonb,
  p_stamp text default null
)
returns table (item_id uuid, version_stamp text, reopened boolean)
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  writable uuid[];
  grew boolean;
  reopened_ids uuid[];
  written uuid[];
  stamp_after text := p_stamp;
begin
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_transforms, '[]'::jsonb)) is distinct from 'array'
  then
    raise exception 'TAKEOFF_RULE_RESULTS_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('takeoff-rules:' || p_estimate_version_id::text, 0)
  );
  if p_stamp is not null and p_stamp is distinct from public.takeoff_rule_version_stamp(p_tenant_id, p_estimate_version_id) then
    return;
  end if;

  -- Completed jobs no application holds; holding them keeps an application from starting meanwhile.
  select coalesce(pg_catalog.array_agg(job.id), '{}'::uuid[])
    into writable
  from (
    select candidate.id
    from public.takeoff_jobs as candidate
    where candidate.tenant_id = p_tenant_id
      and candidate.estimate_version_id = p_estimate_version_id
      and candidate.status = 'completed'::public.takeoff_job_status
    for share skip locked
  ) as job;

  select coalesce(array_agg(saved.item_id), '{}'::uuid[]),
         coalesce(array_agg(saved.item_id) filter (where saved.reopened), '{}'::uuid[]),
         coalesce(bool_or(saved.failures_grew), false)
    into written, reopened_ids, grew
  from takeoff_internal.persist_rule_results(p_tenant_id, p_estimate_version_id, writable, p_items, p_transforms) saved;
  if grew then stamp_after:=public.takeoff_rule_version_stamp(p_tenant_id,p_estimate_version_id); end if;
  return query select id,stamp_after,id=any(reopened_ids) from unnest(written) as w(id);
end;
$$;

create function public.takeoff_rule_job_stamp(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select md5(jsonb_build_array(j.id, j.status, j.preparation_snapshot,
    (select jsonb_agg(jsonb_build_array(i.id, i.updated_at, i.rules_stale_at, i.designation, i.quantity, i.unit,
        i.metadata, i.source_file_name, i.source_page, i.is_excluded, i.is_verified, i.quantity_entry_category) order by i.id)
      from public.takeoff_items i where i.job_id = j.id and i.tenant_id = j.tenant_id),
    (select jsonb_agg(jsonb_build_array(p.id, p.plan_file_id, p.source_file_name, p.source_page, p.reading, p.rule_anchors) order by p.id)
      from public.takeoff_vector_pages p where p.job_id = j.id and p.tenant_id = j.tenant_id),
    (select jsonb_agg(jsonb_build_array(g.takeoff_item_id, g.vector_page_id, g.geometry - 'transform') order by g.takeoff_item_id)
      from public.takeoff_item_geometries g where g.job_id = j.id and g.tenant_id = j.tenant_id)
  )::text)
  from public.takeoff_jobs j
  where j.id = p_job_id and j.project_id = p_project_id and j.tenant_id = p_tenant_id
    and j.estimate_version_id is null
$$;
revoke all on function public.takeoff_rule_job_stamp(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.takeoff_rule_job_stamp(uuid, uuid, uuid) to service_role;

create function public.write_takeoff_job_rule_results(
  p_tenant_id uuid, p_project_id uuid, p_job_id uuid, p_items jsonb, p_transforms jsonb, p_stamp text
)
returns table (item_id uuid, version_stamp text, reopened boolean)
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare
  written uuid[];
  reopened_ids uuid[];
  grew boolean;
  stamp_after text := p_stamp;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_transforms) is distinct from 'array'
    or jsonb_array_length(p_items) > 250 or jsonb_array_length(p_transforms) > 250 or p_stamp is null then
    raise exception 'TAKEOFF_RULE_RESULTS_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-job-rules:' || p_job_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('takeoff-job:' || p_job_id::text, 0));
  perform 1 from public.takeoff_jobs j
    where j.id = p_job_id and j.project_id = p_project_id and j.tenant_id = p_tenant_id
      and j.estimate_version_id is null and j.status = 'completed' for update;
  if not found then return; end if;

  -- A direct PostgREST edit already holds its line when the statement
  -- trigger invalidates peers. Leave the computation stale if the writer
  -- cannot take every input lock immediately.
  begin
    perform 1 from public.takeoff_items i where i.job_id = p_job_id and i.tenant_id = p_tenant_id
      order by i.id for update nowait;
    perform 1 from public.takeoff_vector_pages p where p.job_id = p_job_id and p.tenant_id = p_tenant_id
      order by p.id for share nowait;
    perform 1 from public.takeoff_item_geometries g where g.job_id = p_job_id and g.tenant_id = p_tenant_id
      order by g.takeoff_item_id for update nowait;
  exception when lock_not_available then
    return;
  end;
  if p_stamp is distinct from public.takeoff_rule_job_stamp(p_tenant_id, p_project_id, p_job_id) then
    return;
  end if;
  select coalesce(array_agg(saved.item_id), '{}'::uuid[]),
         coalesce(array_agg(saved.item_id) filter (where saved.reopened), '{}'::uuid[]),
         coalesce(bool_or(saved.failures_grew), false)
    into written, reopened_ids, grew
  from takeoff_internal.persist_rule_results(p_tenant_id, null, array[p_job_id], p_items, p_transforms) saved;
  if grew then stamp_after := public.takeoff_rule_job_stamp(p_tenant_id, p_project_id, p_job_id); end if;
  return query select id, stamp_after, id = any(reopened_ids) from unnest(written) as w(id);
end;
$$;
revoke all on function public.write_takeoff_job_rule_results(uuid, uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_takeoff_job_rule_results(uuid, uuid, uuid, jsonb, jsonb, text) to service_role;

commit;
