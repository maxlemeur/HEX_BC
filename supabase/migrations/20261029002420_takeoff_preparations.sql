-- Preparation is tenant/project scoped. Confirmations are written by the server
-- after source attestation, never by authenticated Data API clients.
alter table public.estimate_projects
  add constraint estimate_projects_id_tenant_key unique (id, tenant_id);

create table public.takeoff_preparations (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  confirmed_snapshot jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, project_id),
  constraint takeoff_preparations_project_scope_fkey
    foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade,
  constraint takeoff_preparations_confirmation_check check (
    (confirmed_snapshot is null and confirmed_at is null and confirmed_by is null)
    or (confirmed_snapshot is not null and jsonb_typeof(confirmed_snapshot) = 'object'
      and confirmed_at is not null and confirmed_by is not null)
  )
);
create index takeoff_preparations_project_idx on public.takeoff_preparations(project_id);
create index takeoff_preparations_confirmed_by_idx on public.takeoff_preparations(confirmed_by);
create index takeoff_preparations_updated_by_idx on public.takeoff_preparations(updated_by);

create table public.takeoff_preparation_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  version integer not null default 1 check (version > 0),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index takeoff_preparation_profiles_tenant_idx on public.takeoff_preparation_profiles(tenant_id, name, id);
create index takeoff_preparation_profiles_created_by_idx on public.takeoff_preparation_profiles(created_by);
create index takeoff_preparation_profiles_updated_by_idx on public.takeoff_preparation_profiles(updated_by);

alter table public.takeoff_preparations enable row level security;
alter table public.takeoff_preparation_profiles enable row level security;
revoke all on public.takeoff_preparations, public.takeoff_preparation_profiles from public, anon, authenticated;
grant select on public.takeoff_preparations, public.takeoff_preparation_profiles to authenticated;
grant select, insert, update, delete on public.takeoff_preparations, public.takeoff_preparation_profiles to service_role;

create policy "Active project readers can read takeoff preparations"
  on public.takeoff_preparations for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.tenant_memberships membership
      join public.tenants tenant on tenant.id = membership.tenant_id and tenant.is_active
      join public.estimate_projects project on project.id = takeoff_preparations.project_id
        and project.tenant_id = membership.tenant_id
      where membership.user_id = (select auth.uid())
        and membership.tenant_id = takeoff_preparations.tenant_id
        and not project.is_archived
        and (membership.role in ('admin', 'director') or project.user_id = (select auth.uid()))
    )
  );
create policy "Active tenant members can read takeoff preparation profiles"
  on public.takeoff_preparation_profiles for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.tenant_memberships membership
      join public.tenants tenant on tenant.id = membership.tenant_id and tenant.is_active
      where membership.user_id = (select auth.uid())
        and membership.tenant_id = takeoff_preparation_profiles.tenant_id
    )
  );

-- The service role still has to name an active, authorized human. Holding these
-- rows also makes role revocation / archival serialize with a preparation save.
create function private.enforce_takeoff_preparation_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  active_tenant uuid;
  actor_role public.tenant_role;
  project_owner uuid;
  project_archived boolean;
begin
  perform 1 from public.tenant_memberships where user_id = new.updated_by order by id for share;
  perform 1 from public.tenants where id in (
    select tenant_id from public.tenant_memberships where user_id = new.updated_by
  ) order by id for share;
  select membership.tenant_id, membership.role into active_tenant, actor_role
  from public.tenant_memberships membership
  join public.tenants tenant on tenant.id = membership.tenant_id and tenant.is_active
  where membership.user_id = new.updated_by
  order by membership.is_default desc, membership.created_at asc limit 1;
  if active_tenant is distinct from new.tenant_id or actor_role is null
    or actor_role not in ('admin', 'engineer') then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_WRITE_FORBIDDEN';
  end if;
  if tg_table_name = 'takeoff_preparations' then
    select user_id, is_archived into project_owner, project_archived
    from public.estimate_projects where id = new.project_id and tenant_id = new.tenant_id for share;
    if project_owner is null or project_archived or (actor_role <> 'admin' and project_owner <> new.updated_by) then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_WRITE_FORBIDDEN';
    end if;
    if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id
      or new.project_id is distinct from old.project_id or new.created_at is distinct from old.created_at
      or new.revision <> old.revision + 1) then
      raise exception using errcode = '40001', message = 'TAKEOFF_PREPARATION_REVISION_CONFLICT';
    end if;
    if new.confirmed_snapshot is not null and (
      new.confirmed_snapshot -> 'schema_version' is distinct from '1'::jsonb
      or new.confirmed_snapshot -> 'preparation_revision' is distinct from to_jsonb(new.revision)
      or new.confirmed_snapshot -> 'preparation' is distinct from new.draft
      or new.confirmed_snapshot ->> 'confirmed_by' is distinct from new.confirmed_by::text
      or (new.confirmed_snapshot ->> 'confirmed_at')::timestamptz is distinct from new.confirmed_at
      or new.confirmed_by is distinct from new.updated_by
      or new.confirmed_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb
    ) then
      raise exception using errcode = '23514', message = 'TAKEOFF_PREPARATION_CONFIRMATION_INVALID';
    end if;
  else
    if (actor_role <> 'admin' and new.created_by <> new.updated_by)
      or (tg_op = 'UPDATE' and (new.id is distinct from old.id
        or new.tenant_id is distinct from old.tenant_id or new.created_by is distinct from old.created_by
        or new.created_at is distinct from old.created_at or new.version <> old.version + 1)) then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_PROFILE_WRITE_FORBIDDEN';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.enforce_takeoff_preparation_write() from public, anon, authenticated;
create trigger enforce_takeoff_preparation_write before insert or update on public.takeoff_preparations
  for each row execute function private.enforce_takeoff_preparation_write();
create trigger enforce_takeoff_preparation_profile_write before insert or update on public.takeoff_preparation_profiles
  for each row execute function private.enforce_takeoff_preparation_write();

alter table public.takeoff_jobs add column preparation_snapshot jsonb
  check (preparation_snapshot is null or jsonb_typeof(preparation_snapshot) = 'object');

-- A source-version launch can fork a target draft while a concurrent launch
-- already addresses that draft. Their request IDs differ, but their prepared
-- analysis receipt is the same. The stored provider is the resolved execution
-- owner (gemini or chatgpt_local), never the request's automatic preference.
create unique index takeoff_jobs_prepared_plan_receipt_uidx
  on public.takeoff_jobs (
    tenant_id, estimate_version_id, plan_set_id,
    (preparation_snapshot ->> 'preparation_revision'), level, execution_provider
  )
  where preparation_snapshot is not null and plan_set_id is not null;

-- A normal estimate copy deliberately has no variant parent. Its prepared
-- launch provenance is a server-written receipt, not an overloaded parent ID.
-- Existing audit RLS allows authenticated inserts only for invariant_violation.
alter table public.audit_logs drop constraint audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (
  action in (
    'INSERT', 'UPDATE', 'DELETE', 'invariant_violation', 'seal',
    'takeoff.job.created', 'takeoff.job.processing', 'takeoff.job.completed',
    'takeoff.job.failed', 'takeoff.job.retried', 'takeoff.job.canceled',
    'takeoff.item.excluded', 'takeoff.item.modified', 'takeoff.dpgf.review_decision',
    'takeoff.apply.started', 'takeoff.apply.override', 'takeoff.apply.completed',
    'takeoff.apply.failed', 'takeoff.mapping.applied',
    'takeoff.preparation.version_created'
  )
);
create index audit_logs_takeoff_preparation_version_receipt_idx
  on public.audit_logs (
    tenant_id, estimate_version_id,
    (after_data ->> 'source_version_id'), (after_data ->> 'preparation_revision')
  )
  where action = 'takeoff.preparation.version_created' and table_name = 'estimate_versions';

-- Authenticated clients can insert jobs directly through PostgREST. A private
-- definer is needed only to lock SELECT-only preparation rows and their sources;
-- it repeats the actual membership/ownership checks instead of a global-admin helper.
create function private.enforce_takeoff_job_preparation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  authenticated_insert boolean := current_setting('role', true) = 'authenticated';
  project_id_value uuid;
  locked_project_id uuid;
  project_owner uuid;
  project_archived boolean;
  actor_role public.tenant_role;
  prep public.takeoff_preparations%rowtype;
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
  if not authenticated_insert and new.preparation_snapshot is null then
    return new; -- Existing service/SQL fixtures and historical jobs stay compatible.
  end if;
  select project_id into project_id_value from public.estimate_versions
  where id = new.estimate_version_id and tenant_id = new.tenant_id;
  -- UPDATE locks the preparation tuple before its write trigger runs. Take that
  -- same lock first here, then membership/tenant/project, to avoid reversing the
  -- order against a concurrent save or confirmation.
  select * into prep from public.takeoff_preparations
  where tenant_id = new.tenant_id and project_id = project_id_value for share;
  if prep.confirmed_snapshot is null or new.preparation_snapshot is distinct from prep.confirmed_snapshot
    or prep.confirmed_snapshot -> 'preparation_revision' is distinct from to_jsonb(prep.revision)
    or prep.confirmed_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
  end if;
  if authenticated_insert then
    perform 1 from public.tenant_memberships where user_id = actor order by id for share;
    perform 1 from public.tenants where id in (
      select tenant_id from public.tenant_memberships where user_id = actor
    ) order by id for share;
    if actor is null or new.tenant_id is distinct from public.current_tenant_id() then
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
  select version.project_id, project.user_id, project.is_archived
    into locked_project_id, project_owner, project_archived
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id and project.tenant_id = version.tenant_id
  where version.id = new.estimate_version_id and version.tenant_id = new.tenant_id
  for share of project, version;
  if locked_project_id is distinct from project_id_value or project_archived
    or (authenticated_insert and actor_role <> 'admin' and project_owner is distinct from actor) then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
  end if;
  if prep.confirmed_snapshot #>> '{preparation,destination,kind}' = 'estimate_review'
    and prep.confirmed_snapshot #>> '{preparation,destination,estimate_version_id}' is distinct from new.estimate_version_id::text
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
        and receipt.after_data ->> 'source_version_id' = prep.confirmed_snapshot #>> '{preparation,destination,estimate_version_id}'
        and receipt.after_data ->> 'target_version_id' = new.estimate_version_id::text
        and receipt.after_data -> 'preparation_revision' = to_jsonb(prep.revision)
    ) then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_DESTINATION_MISMATCH';
  end if;
  if (new.plan_set_id is not null and not exists (
      select 1 from jsonb_array_elements(prep.confirmed_snapshot #> '{preparation,sources}') source
      where source -> 'active' = 'true'::jsonb and source ->> 'kind' = 'plan'
    )) or exists (
      select 1 from jsonb_array_elements(prep.confirmed_snapshot #> '{preparation,sources}') source
      where source -> 'active' = 'true'::jsonb and source ->> 'kind' = 'plan'
        and source ->> 'plan_set_id' is distinct from new.plan_set_id::text
    ) then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_SOURCE_MISMATCH';
  end if;
  for selected_source in select value from jsonb_array_elements(prep.confirmed_snapshot #> '{preparation,sources}')
    where value -> 'active' = 'true'::jsonb and value ->> 'document_id' not like 'upload:%'
  loop
    if selected_source ->> 'plan_set_id' is not null then
      -- Lock the set against concurrent new FK children as well as existing file
      -- changes. A new page/file in a selected set needs a fresh review too.
      perform 1 from public.plan_sets where id::text = selected_source ->> 'plan_set_id'
        and tenant_id = new.tenant_id and project_id = project_id_value for update;
      if not found then
        raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_SOURCE_STALE';
      end if;
      select file.* into plan from public.plan_files file
      where file.id::text = selected_source ->> 'document_id' and file.tenant_id = new.tenant_id for share;
      if not found or plan.plan_set_id::text is distinct from selected_source ->> 'plan_set_id'
        or plan.file_path is distinct from selected_source ->> 'file_path'
        or plan.page_count is distinct from (selected_source ->> 'page_count')::integer
        or plan.updated_at is distinct from (selected_source ->> 'source_updated_at')::timestamptz
        or exists (
          select 1 from public.plan_files file where file.plan_set_id = plan.plan_set_id
          and not exists (
            select 1 from jsonb_array_elements(prep.confirmed_snapshot #> '{preparation,sources}') known
            where known ->> 'document_id' = file.id::text
          )
        ) then
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
revoke all on function private.enforce_takeoff_job_preparation() from public, anon, authenticated;
create trigger aad_enforce_takeoff_job_preparation before insert or update on public.takeoff_jobs
  for each row execute function private.enforce_takeoff_job_preparation();
