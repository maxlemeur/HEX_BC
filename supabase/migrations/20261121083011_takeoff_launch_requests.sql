-- Lot 2, M4: the launch requests of a takeoff. A request is one execution on a sealed manifest; a job is the analysis of
-- one unit of that manifest (lot 2 seals one grouped unit holding the affaire's plans; lot 3 one unit per plan).
--
-- What the previous application version sees while this is applied and until the owner sets
-- private.takeoff_launch_activation: nothing changes in its writes. Its inserts of jobs carry no request; the dossier
-- triggers below write nothing before activation; the historical receipt index keeps refusing what it refused for every
-- job without a request; the two new audit actions only widen a check. The copy of a version (« Dupliquer ») takes the
-- affaire's row as FOR NO KEY UPDATE instead of FOR UPDATE: it still excludes every writer that locked that row before.
begin;

-- Every statement takes a short lock: give up instead of queueing the job, dossier and audit writers.
set local lock_timeout = '5s';

-- 1. Activation of the automatic start. Empty until the owner sets it, after the affaire page that shows requests is
-- deployed. Nothing below writes to another table before it.
create table private.takeoff_launch_activation (
  singleton boolean primary key default true check (singleton),
  active_from timestamptz not null
);
revoke all on private.takeoff_launch_activation from public, anon, authenticated, service_role;

create function private.takeoff_launch_active(p_at timestamptz default pg_catalog.clock_timestamp())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.takeoff_launch_activation a where a.active_from <= p_at)
$$;
revoke all on function private.takeoff_launch_active(timestamptz) from public, anon, authenticated, service_role;

-- The two cut-offs, for the server: an admission needs both, since a request closes only on the recorded end of its
-- jobs, which the end-of-analysis notices record from their own cut-off on.
create function public.takeoff_launch_activation_state()
returns table (launch_active_from timestamptz, completion_active_from timestamptz)
language sql stable security definer set search_path = '' as $$
  select (select a.active_from from private.takeoff_launch_activation a),
    (select c.active_from from private.takeoff_completion_activation c)
$$;
revoke all on function public.takeoff_launch_activation_state() from public, anon, authenticated;
grant execute on function public.takeoff_launch_activation_state() to service_role;

-- 2. The need to evaluate a dossier, recorded in the transaction that changes it: one insert-only row per change of the
-- brief, of a dossier piece or of a plan copy, from activation on. No foreign key and no update: a dossier writer never
-- waits on a request row, an admission or another writer because of this table. The position of an affaire is the
-- highest identifier of its marks; an admission compares it with the position its evaluation read.
create table private.takeoff_launch_marks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  cause text not null check (cause in ('brief', 'document', 'plan_file')),
  marked_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index takeoff_launch_marks_project_idx on private.takeoff_launch_marks (tenant_id, project_id, id desc);
revoke all on private.takeoff_launch_marks from public, anon, authenticated, service_role;

create function private.takeoff_launch_mark_position(p_tenant_id uuid, p_project_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(max(m.id), 0) from private.takeoff_launch_marks m
  where m.tenant_id = p_tenant_id and m.project_id = p_project_id
$$;
revoke all on function private.takeoff_launch_mark_position(uuid, uuid) from public, anon, authenticated, service_role;

create function private.mark_takeoff_launch_dossier()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  changed jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  previous jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  set_id uuid;
begin
  if not private.takeoff_launch_active() then
    return null;
  end if;
  if tg_table_name = 'plan_files' then
    -- A copy belongs to its affaire through its plan set; a file moved between sets marks both.
    foreach set_id in array array_remove(array[(changed ->> 'plan_set_id')::uuid,
      case when previous ->> 'plan_set_id' is distinct from changed ->> 'plan_set_id' then (previous ->> 'plan_set_id')::uuid end], null)
    loop
      insert into private.takeoff_launch_marks (tenant_id, project_id, cause)
      select s.tenant_id, s.project_id, tg_argv[0] from public.plan_sets s where s.id = set_id;
    end loop;
  else
    insert into private.takeoff_launch_marks (tenant_id, project_id, cause)
    values ((changed ->> 'tenant_id')::uuid, (changed ->> 'project_id')::uuid, tg_argv[0]);
  end if;
  return null;
end;
$$;
revoke all on function private.mark_takeoff_launch_dossier() from public, anon, authenticated, service_role;

create trigger zz_mark_takeoff_launch_brief
  after insert or delete or update of status, confirmed_by, confirmed_at on public.affaire_briefs
  for each row execute function private.mark_takeoff_launch_dossier('brief');
create trigger zz_mark_takeoff_launch_document
  after insert or delete or update of upload_status, classification_status, document_kind, deleted_at, deletion_token,
    storage_path, plan_copy_generation, issues, confidence, size_bytes, content_sha256, mime_type, drive_file_id
  on public.affaire_intake_documents
  for each row execute function private.mark_takeoff_launch_dossier('document');
create trigger zz_mark_takeoff_launch_plan_file
  after insert or delete or update of plan_set_id, file_path, file_size_bytes, file_hash, page_count, metadata
  on public.plan_files
  for each row execute function private.mark_takeoff_launch_dossier('plan_file');

-- 3. The requests.
create table public.takeoff_launch_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  -- automatic: the one start of an affaire, on its dossier's confirmation, for life. manual: one explicit command.
  origin text not null check (origin in ('automatic', 'manual')),
  -- initial: the first analysis; reread_plans: read these plans again; remeasure_items: measure these items again on these
  -- plans (lot 4). Lot 2 seals initial and reread_plans.
  intent text not null check (intent in ('initial', 'reread_plans', 'remeasure_items')),
  -- The identity of the command (a click, its double click, its replay): one request per key. Not what is measured.
  intent_key uuid not null,
  -- The digest of what a manual command asks: the same key with other content is a conflict.
  command_digest text check (command_digest ~ '^[0-9a-f]{64}$'),
  predecessor_request_id uuid,
  predecessor_job_id uuid,
  state text not null check (state in ('evaluating', 'not_eligible', 'blocked', 'admitted', 'closed')),
  reason_code text check (reason_code ~ '^[A-Z_]{1,64}$'),
  -- For a blocking that names pieces (a plan without its working copy): their identifiers and names, which every
  -- reader of the affaire already sees in its dossier. Never a path, a host or an account.
  reason_details jsonb not null default '{}'::jsonb check (jsonb_typeof(reason_details) = 'object'),
  -- The dossier position (private.takeoff_launch_marks) the last evaluation read.
  evaluated_mark bigint check (evaluated_mark >= 0),
  -- The member recorded as having confirmed the brief, for the automatic request.
  confirmed_by uuid,
  -- The member who pays: the confirmer (confirmation), the member who took the request on (take_over), the member who
  -- clicked (command). Never deduced from an upload, an administrator or a reader.
  payer_id uuid,
  mandate_kind text check (mandate_kind in ('confirmation', 'take_over', 'command')),
  -- The recipient of the request's end: its payer when it was taken on.
  requested_by uuid,
  -- The Mac of the mandate, and the profile selection that attests it (opaque profile identifier, model, effort, host).
  execution_host_id text,
  mandate_selection jsonb check (mandate_selection is null or jsonb_typeof(mandate_selection) = 'object'),
  -- The model and effort this command actually runs with. Lot 2: the mandate's. A one-off setting of a later command goes
  -- here, never into the member's preferences.
  execution_selection jsonb check (execution_selection is null or jsonb_typeof(execution_selection) = 'object'),
  mandated_at timestamptz,
  -- Sealed at admission: the manifest (format, measuring order, units, coverage, plans), its digest, and the preparation
  -- snapshot its jobs attest (the automatic one is isolated here, never written over a member's preparation).
  manifest jsonb check (manifest is null or jsonb_typeof(manifest) = 'object'),
  manifest_digest text check (manifest_digest ~ '^[0-9a-f]{64}$'),
  preparation_snapshot jsonb check (preparation_snapshot is null or jsonb_typeof(preparation_snapshot) = 'object'),
  units_expected integer check (units_expected >= 1),
  units_succeeded integer not null default 0 check (units_succeeded >= 0),
  units_failed integer not null default 0 check (units_failed >= 0),
  units_canceled integer not null default 0 check (units_canceled >= 0),
  -- What its jobs observed over every attempt: a retry does not start from zero.
  tokens_observed bigint not null default 0 check (tokens_observed >= 0),
  cost_cents_observed bigint not null default 0 check (cost_cents_observed >= 0),
  evaluation_lease_token uuid,
  evaluation_lease_expires_at timestamptz,
  outcome text check (outcome in ('success', 'failure', 'canceled', 'partial')),
  completion_event_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  evaluated_at timestamptz,
  admitted_at timestamptz,
  closed_at timestamptz,
  constraint takeoff_launch_requests_id_tenant_key unique (id, tenant_id),
  constraint takeoff_launch_requests_id_scope_key unique (id, tenant_id, project_id),
  constraint takeoff_launch_requests_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade,
  constraint takeoff_launch_requests_predecessor_fkey foreign key (predecessor_request_id, tenant_id, project_id)
    references public.takeoff_launch_requests (id, tenant_id, project_id),
  constraint takeoff_launch_requests_predecessor_job_fkey foreign key (predecessor_job_id, tenant_id)
    references public.takeoff_jobs (id, tenant_id) on delete set null (predecessor_job_id),
  constraint takeoff_launch_requests_origin_shape_check check (
    (origin = 'automatic' and intent = 'initial' and intent_key = id and predecessor_request_id is null
      and predecessor_job_id is null and command_digest is null)
    or (origin = 'manual' and command_digest is not null and mandate_kind is distinct from 'confirmation')
  ),
  constraint takeoff_launch_requests_reason_check check (
    (state in ('not_eligible', 'blocked')) = (reason_code is not null)
  ),
  constraint takeoff_launch_requests_mandate_check check (
    (payer_id is null) = (mandate_kind is null) and (payer_id is null) = (mandated_at is null)
    and (payer_id is not null or (execution_host_id is null and mandate_selection is null and execution_selection is null))
    and (execution_host_id is null) = (mandate_selection is null)
    and (mandate_selection is null) = (execution_selection is null)
    and (mandate_selection is null or mandate_selection ->> 'hostId' = execution_host_id)
  ),
  constraint takeoff_launch_requests_admission_check check (
    (state in ('admitted', 'closed')) = (admitted_at is not null)
    and (admitted_at is null or (manifest is not null and manifest_digest is not null and preparation_snapshot is not null
      and units_expected is not null and payer_id is not null and requested_by = payer_id
      and execution_host_id is not null))
  ),
  constraint takeoff_launch_requests_closure_check check (
    (state = 'closed') = (outcome is not null) and (outcome is null) = (closed_at is null)
    and (outcome is null) = (completion_event_id is null)
    and (units_expected is null or units_succeeded + units_failed + units_canceled <= units_expected)
  ),
  constraint takeoff_launch_requests_lease_check check (
    (evaluation_lease_token is null) = (evaluation_lease_expires_at is null)
    and (evaluation_lease_token is null or state in ('evaluating', 'not_eligible', 'blocked'))
  )
);

-- One automatic start per affaire, for life; one request per command key; one admitted request not closed per affaire
-- (an automatic start and a relaunch never run together). Nothing unique on a plan set, a version or a job.
create unique index takeoff_launch_requests_automatic_uidx on public.takeoff_launch_requests (tenant_id, project_id)
  where origin = 'automatic';
create unique index takeoff_launch_requests_command_uidx on public.takeoff_launch_requests (tenant_id, project_id, intent_key)
  where origin = 'manual';
create unique index takeoff_launch_requests_running_uidx on public.takeoff_launch_requests (tenant_id, project_id)
  where state = 'admitted';
create index takeoff_launch_requests_host_due_idx on public.takeoff_launch_requests (execution_host_id, updated_at)
  where state in ('evaluating', 'not_eligible', 'blocked');
create index takeoff_launch_requests_project_idx on public.takeoff_launch_requests (tenant_id, project_id, created_at desc, id);

create trigger set_takeoff_launch_requests_updated_at before update on public.takeoff_launch_requests
  for each row execute function public.set_updated_at();

-- Readers of the affaire see the state, its reason and who pays; never the host, the selection, the lease, the manifest
-- or the snapshot (the server projects what a reader may see from those). Only the functions below write.
alter table public.takeoff_launch_requests enable row level security;
revoke all on public.takeoff_launch_requests from public, anon, authenticated, service_role;
grant select (id, tenant_id, project_id, origin, intent, predecessor_request_id, predecessor_job_id, state, reason_code,
  reason_details, confirmed_by, payer_id, requested_by, units_expected, units_succeeded, units_failed, units_canceled,
  outcome, completion_event_id, created_at, updated_at, evaluated_at, mandated_at, admitted_at, closed_at)
  on public.takeoff_launch_requests to authenticated;
-- The service role keeps its table rights, as on every public table, but writes only through the functions below.
grant select, insert, update, delete on public.takeoff_launch_requests to service_role;
create function private.guard_takeoff_launch_request_writer()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user = 'service_role' then
    raise exception 'TAKEOFF_LAUNCH_WRITER_REQUIRED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_takeoff_launch_request_writer() from public, anon, authenticated, service_role;
create trigger takeoff_launch_request_writer before insert or update or delete on public.takeoff_launch_requests
  for each row execute function private.guard_takeoff_launch_request_writer();
create policy takeoff_launch_requests_reader_select on public.takeoff_launch_requests for select to authenticated
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)));

-- 4. A job's request and its unit of the manifest: both or neither, frozen at insert, unique together. A request may have
-- several jobs (lot 3, one per plan); lot 2 admits its grouped unit, key « grouped ».
alter table public.takeoff_jobs
  add column launch_request_id uuid,
  add column launch_unit_key text,
  add constraint takeoff_jobs_launch_unit_check check (
    (launch_request_id is null) = (launch_unit_key is null)
    and (launch_unit_key is null or launch_unit_key ~ '^[a-z0-9][a-z0-9:_-]{0,119}$')
  ),
  add constraint takeoff_jobs_launch_request_fkey foreign key (launch_request_id, tenant_id, project_id)
    references public.takeoff_launch_requests (id, tenant_id, project_id);
create unique index takeoff_jobs_launch_unit_uidx on public.takeoff_jobs (launch_request_id, launch_unit_key)
  where launch_request_id is not null;

-- The historical receipt of a launch on a version, for the jobs that have no request. A request's jobs are identified by
-- their request and unit; two requests may read the same plans with the same preparation revision.
create unique index takeoff_jobs_prepared_plan_receipt_unrequested_uidx
  on public.takeoff_jobs (
    tenant_id, estimate_version_id, plan_set_id,
    (preparation_snapshot ->> 'preparation_revision'), level, execution_provider
  )
  where preparation_snapshot is not null and plan_set_id is not null and launch_request_id is null;
drop index public.takeoff_jobs_prepared_plan_receipt_uidx;
alter index public.takeoff_jobs_prepared_plan_receipt_unrequested_uidx rename to takeoff_jobs_prepared_plan_receipt_uidx;

create function private.guard_takeoff_job_launch_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.launch_request_id is distinct from old.launch_request_id or new.launch_unit_key is distinct from old.launch_unit_key then
      raise exception 'TAKEOFF_JOB_IDENTITY_IMMUTABLE' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.launch_request_id is null then
    return new;
  end if;
  -- Only the admission of that request inserts its jobs, on a unit of its sealed manifest.
  if nullif(current_setting('mergeone.takeoff_request_admission', true), '') is distinct from new.launch_request_id::text
    or not exists (
      select 1 from public.takeoff_launch_requests r
      cross join lateral jsonb_array_elements(r.manifest -> 'units') as unit(value)
      where r.id = new.launch_request_id and r.tenant_id = new.tenant_id and r.project_id = new.project_id
        and r.state = 'admitted' and unit.value ->> 'key' = new.launch_unit_key
    ) then
    raise exception 'TAKEOFF_JOB_REQUEST_ADMISSION_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_job_launch_request() from public, anon, authenticated, service_role;
create trigger aab_guard_takeoff_job_launch_request before insert or update of launch_request_id, launch_unit_key on public.takeoff_jobs
  for each row execute function private.guard_takeoff_job_launch_request();

-- M1's attestation, with the request's branch it left room for: a request's job attests the snapshot sealed on its
-- admitted request, not the affaire's current preparation (which a member may be editing meanwhile).
create or replace function private.attest_takeoff_job_snapshot(p_job public.takeoff_jobs)
returns table (snapshot jsonb, require_complete_plan_set boolean)
language plpgsql set search_path = '' as $$
declare
  prep public.takeoff_preparations%rowtype;
  sealed jsonb;
begin
  if p_job.launch_request_id is not null then
    select r.preparation_snapshot into sealed from public.takeoff_launch_requests r
    where r.id = p_job.launch_request_id and r.tenant_id = p_job.tenant_id and r.project_id = p_job.project_id
      and r.state = 'admitted';
    if sealed is null or sealed #> '{readiness,can_launch}' is distinct from 'true'::jsonb then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
    end if;
    -- Lot 2's grouped unit covers its whole plan set: a file added since the seal makes the admission stale.
    return query select sealed, true;
    return;
  end if;
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

-- M1's creation record, with the request's door: the admission of a request records its job's creation in the same
-- commit, as the authenticated admission RPC does for a job without a request.
create or replace function private.record_prepared_takeoff_job_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.launch_request_id is not null then
    if nullif(current_setting('mergeone.takeoff_request_admission', true), '') is distinct from new.launch_request_id::text
      or new.created_by is null or new.plan_set_id is null or new.status <> 'pending' then
      raise exception 'TAKEOFF_JOB_REQUEST_ADMISSION_REQUIRED' using errcode = '42501';
    end if;
    begin
      insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
      values (new.tenant_id, new.created_by, 'takeoff_jobs', new.id, new.estimate_version_id, 'takeoff.job.created',
        jsonb_build_object('schema_version', 1, 'action', 'takeoff.job.created', 'job_id', new.id,
          'tenant_id', new.tenant_id, 'user_id', new.created_by, 'metadata', jsonb_build_object(
            'level', new.level, 'estimate_version_id', new.estimate_version_id, 'project_id', new.project_id,
            'plan_set_id', new.plan_set_id, 'preparation_revision', new.preparation_snapshot -> 'preparation_revision',
            'launch_request_id', new.launch_request_id, 'launch_unit_key', new.launch_unit_key)));
    exception when others then
      raise exception 'TAKEOFF_JOB_CREATION_AUDIT_FAILED' using errcode = 'P0001';
    end;
    return new;
  end if;

  if nullif(current_setting('mergeone.takeoff_admission_job', true), '') is distinct from new.id::text
    or current_setting('role', true) is distinct from 'authenticated'
    or auth.uid() is null or new.created_by is distinct from auth.uid()
    or new.plan_set_id is null or new.status <> 'pending' then
    if new.estimate_version_id is null then
      raise exception 'TAKEOFF_JOB_ADMISSION_RPC_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  begin
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (new.tenant_id, new.created_by, 'takeoff_jobs', new.id, new.estimate_version_id, 'takeoff.job.created',
      jsonb_build_object('schema_version', 1, 'action', 'takeoff.job.created', 'job_id', new.id,
        'tenant_id', new.tenant_id, 'user_id', new.created_by, 'metadata', jsonb_build_object(
          'level', new.level, 'estimate_version_id', new.estimate_version_id, 'project_id', new.project_id,
          'plan_set_id', new.plan_set_id, 'preparation_revision', new.preparation_snapshot -> 'preparation_revision')));
  exception when others then
    raise exception 'TAKEOFF_JOB_CREATION_AUDIT_FAILED' using errcode = 'P0001';
  end;
  return new;
end;
$$;
revoke all on function private.record_prepared_takeoff_job_creation() from public, anon, authenticated;

-- 5. The audit actions the application writes. « Soumettre à nouveau » writes takeoff.job.resubmitted, which the check
-- refused until now (who relaunched an analysis was lost); the requests add their mandate and admission records. The
-- check only widens: every existing row satisfied the narrower one, so it is added without rescanning audit_logs under
-- its exclusive lock, and it applies to every new row.
alter table public.audit_logs drop constraint audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (
  action in (
    'INSERT', 'UPDATE', 'DELETE', 'invariant_violation', 'seal',
    'takeoff.job.created', 'takeoff.job.processing', 'takeoff.job.completed',
    'takeoff.job.failed', 'takeoff.job.retried', 'takeoff.job.resubmitted', 'takeoff.job.canceled',
    'takeoff.item.excluded', 'takeoff.item.modified', 'takeoff.dpgf.review_decision',
    'takeoff.apply.started', 'takeoff.apply.override', 'takeoff.apply.completed',
    'takeoff.apply.failed', 'takeoff.mapping.applied',
    'takeoff.preparation.version_created',
    'takeoff.request.mandated', 'takeoff.request.admitted'
  )
) not valid;

-- 6. Who may pay for an analysis of an affaire: an administrator of the tenant, or the engineer who owns the affaire,
-- with an active membership of an active tenant, on an affaire that is not archived. The same rule as a job's admission.
create function private.takeoff_launch_payer_eligible(p_tenant_id uuid, p_project_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1 from public.estimate_projects p
    join public.tenants t on t.id = p.tenant_id and t.is_active
    join public.tenant_memberships m on m.tenant_id = p.tenant_id and m.user_id = p_user_id
    where p.id = p_project_id and p.tenant_id = p_tenant_id and not p.is_archived
      and (m.role = 'admin' or (m.role = 'engineer' and p.user_id = p_user_id))
  )
$$;
revoke all on function private.takeoff_launch_payer_eligible(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.takeoff_launch_payer_eligible(uuid, uuid, uuid) to service_role;

-- The blockings of a request that only the payer's gesture lifts, those a change of the dossier may lift, and those
-- that the Mac of the mandate tries again on its own.
create function private.takeoff_launch_mandate_reasons() returns text[] language sql immutable set search_path = '' as $$
  select array['OPERATOR_REQUIRED', 'MANDATE_REQUIRED', 'LOCAL_RUNTIME_REQUIRED', 'HOST_NOT_AUTHORISED',
    'CHATGPT_NOT_CONNECTED', 'CHATGPT_ACCESS_REVOKED', 'CHATGPT_MODEL_MISSING', 'CHATGPT_SELECTION_CHANGED',
    'PAYER_NOT_ELIGIBLE']
$$;
create function private.takeoff_launch_dossier_reasons() returns text[] language sql immutable set search_path = '' as $$
  select array['DOSSIER_EMPTY', 'DOSSIER_PROCESSING', 'DOSSIER_TO_REVIEW', 'BRIEF_NOT_CONFIRMED', 'NO_EXPLOITABLE_PLAN',
    'PLAN_COPY_MISSING', 'PREPARATION_NEEDS_REVIEW', 'REFERENCE_UNAVAILABLE', 'PLAN_SET_TOO_LARGE', 'TAKEOFF_DISABLED']
$$;
create function private.takeoff_launch_transient_reasons() returns text[] language sql immutable set search_path = '' as $$
  select array['ADMISSION_LIMIT', 'SOURCE_UNREADABLE', 'ANOTHER_ANALYSIS_RUNNING']
$$;
revoke all on function private.takeoff_launch_mandate_reasons() from public, anon, authenticated;
revoke all on function private.takeoff_launch_dossier_reasons() from public, anon, authenticated;
revoke all on function private.takeoff_launch_transient_reasons() from public, anon, authenticated;

create function private.assert_takeoff_launch_selection(p_host text, p_selection jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_host is null or p_host !~ '^urn:uuid:[0-9a-f-]{36}$' or p_selection is null or jsonb_typeof(p_selection) <> 'object'
    or p_selection ->> 'hostId' is distinct from p_host
    or coalesce(p_selection ->> 'profileId', '') = '' or coalesce(p_selection ->> 'model', '') = ''
    or not (p_selection ? 'reasoningEffort')
    or (p_selection - array['profileId', 'model', 'reasoningEffort', 'hostId']) <> '{}'::jsonb then
    raise exception 'TAKEOFF_LAUNCH_SELECTION_INVALID' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.assert_takeoff_launch_selection(text, jsonb) from public, anon, authenticated;

create function private.record_takeoff_launch_audit(p_request public.takeoff_launch_requests, p_actor uuid, p_action text,
  p_metadata jsonb) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, action, after_data)
  values (p_request.tenant_id, p_actor, 'takeoff_launch_requests', p_request.id, p_action,
    jsonb_build_object('schema_version', 1, 'action', p_action, 'request_id', p_request.id, 'tenant_id', p_request.tenant_id,
      'project_id', p_request.project_id, 'origin', p_request.origin, 'user_id', p_actor, 'metadata', p_metadata))
$$;
revoke all on function private.record_takeoff_launch_audit(public.takeoff_launch_requests, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- 7. The mandate. The server calls it once the member's gesture committed: the confirmation of the brief (the automatic
-- request of the affaire is reserved by its first call), or an explicit « prendre en charge » by an operator. The member
-- is the session's, checked by the server; the brief is read here, after the request's lock, so that the loser of the
-- brief's CAS never pays. Reading or opening anything never calls it.
create function public.record_takeoff_launch_mandate(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_mode text,
  p_host text default null, p_selection jsonb default null, p_blocked_reason text default null, p_request_id uuid default null
) returns table (request_id uuid, state text, reason_code text, payer_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  active_from timestamptz := (select a.active_from from private.takeoff_launch_activation a);
  brief public.affaire_briefs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  eligible boolean;
begin
  if p_mode not in ('confirmation', 'take_over') or p_actor is null
    or (p_blocked_reason is not null and not (p_blocked_reason = any (private.takeoff_launch_mandate_reasons())))
    or (p_mode = 'confirmation' and p_request_id is not null) then
    raise exception 'TAKEOFF_LAUNCH_MANDATE_INVALID' using errcode = '22023';
  end if;
  if p_blocked_reason is null or p_selection is not null then
    perform private.assert_takeoff_launch_selection(p_host, p_selection);
  elsif p_host is not null then
    raise exception 'TAKEOFF_LAUNCH_SELECTION_INVALID' using errcode = '22023';
  end if;
  if active_from is null or active_from > pg_catalog.clock_timestamp() then
    return;
  end if;

  if p_mode = 'confirmation' then
    -- A dossier confirmed before activation is not armed: it shows its last job or the options.
    select * into brief from public.affaire_briefs b where b.tenant_id = p_tenant_id and b.project_id = p_project_id;
    if brief.status is distinct from 'confirme' or brief.confirmed_by is distinct from p_actor
      or brief.confirmed_at < active_from then
      return;
    end if;
    insert into public.takeoff_launch_requests as r (id, tenant_id, project_id, origin, intent, intent_key, state, confirmed_by)
    select reserved.id, p_tenant_id, p_project_id, 'automatic', 'initial', reserved.id, 'evaluating', brief.confirmed_by
    from (select gen_random_uuid() as id) reserved
    on conflict (tenant_id, project_id) where origin = 'automatic' do nothing;
    select * into request from public.takeoff_launch_requests r
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic' for update;
    -- Read the brief again under the request's lock: a later confirmation wins, an earlier one never pays.
    select * into brief from public.affaire_briefs b where b.tenant_id = p_tenant_id and b.project_id = p_project_id;
    if brief.status is distinct from 'confirme' or brief.confirmed_by is distinct from p_actor then
      return query select request.id, request.state, request.reason_code, request.payer_id;
      return;
    end if;
  else
    select * into request from public.takeoff_launch_requests r
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id
      and (r.id = p_request_id or (p_request_id is null and r.origin = 'automatic')) for update;
    if not found then
      raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  -- A consumed request is never re-armed: its job, then its end, answer for it.
  if request.state in ('admitted', 'closed') then
    return query select request.id, request.state, request.reason_code, request.payer_id;
    return;
  end if;

  eligible := private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor);
  if not eligible and p_mode = 'take_over' then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  update public.takeoff_launch_requests r set
    confirmed_by = case when p_mode = 'confirmation' then brief.confirmed_by else r.confirmed_by end,
    payer_id = case when eligible then p_actor end,
    requested_by = case when eligible then p_actor end,
    mandate_kind = case when eligible then p_mode end,
    mandated_at = case when eligible then pg_catalog.clock_timestamp() end,
    execution_host_id = case when eligible then p_host end,
    mandate_selection = case when eligible then p_selection end,
    execution_selection = case when eligible then p_selection end,
    state = case when not eligible or p_blocked_reason is not null then 'blocked' else 'evaluating' end,
    reason_code = case when not eligible then 'OPERATOR_REQUIRED' else p_blocked_reason end,
    reason_details = '{}'::jsonb,
    evaluation_lease_token = null, evaluation_lease_expires_at = null
  where r.id = request.id
  returning * into request;
  if eligible then
    perform private.record_takeoff_launch_audit(request, p_actor, 'takeoff.request.mandated', jsonb_build_object(
      'mode', p_mode, 'execution_host_id', p_host, 'blocked_reason', p_blocked_reason));
  end if;
  return query select request.id, request.state, request.reason_code, request.payer_id;
end;
$$;
revoke all on function public.record_takeoff_launch_mandate(uuid, uuid, uuid, text, text, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_takeoff_launch_mandate(uuid, uuid, uuid, text, text, jsonb, text, uuid) to service_role;

-- 8. The Mac of a mandate claims the requests it has to evaluate: one that waits for its evaluation, one whose dossier
-- changed since it was found not eligible or blocked by its dossier, one blocked by a passing cause a while ago. A
-- blocking that only the payer's gesture lifts waits for that gesture. The lease keeps two processes of one Mac apart.
create function public.claim_takeoff_launch_evaluations(p_host_id text, p_token uuid, p_limit integer default 5)
returns table (request_id uuid, tenant_id uuid, project_id uuid, origin text, payer_id uuid, mark bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if p_host_id is null or p_token is null then
    raise exception 'TAKEOFF_LAUNCH_CLAIM_INVALID' using errcode = '22023';
  end if;
  if not private.takeoff_launch_active() then
    return;
  end if;
  return query
  with due as (
    select r.id from public.takeoff_launch_requests r
    where r.execution_host_id = p_host_id and r.state in ('evaluating', 'not_eligible', 'blocked') and r.payer_id is not null
      and (r.evaluation_lease_expires_at is null or r.evaluation_lease_expires_at <= pg_catalog.clock_timestamp())
      and (r.state = 'evaluating'
        or (not (r.reason_code = any (private.takeoff_launch_mandate_reasons()))
          and (r.evaluated_mark is null or private.takeoff_launch_mark_position(r.tenant_id, r.project_id) > r.evaluated_mark))
        or (r.reason_code = any (private.takeoff_launch_transient_reasons())
          and r.evaluated_at <= pg_catalog.clock_timestamp() - interval '2 minutes'))
    order by r.updated_at, r.id
    limit greatest(1, least(coalesce(p_limit, 5), 20))
    for update of r skip locked
  )
  update public.takeoff_launch_requests r set evaluation_lease_token = p_token,
    evaluation_lease_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes'
  from due where r.id = due.id
  returning r.id, r.tenant_id, r.project_id, r.origin, r.payer_id,
    private.takeoff_launch_mark_position(r.tenant_id, r.project_id);
end;
$$;
revoke all on function public.claim_takeoff_launch_evaluations(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_takeoff_launch_evaluations(text, uuid, integer) to service_role;

-- What an evaluation found when it does not admit: not eligible, blocked (with its reason), or nothing to decide (the
-- lease is given back). The position it read is recorded so that only a later change wakes it again.
create function public.record_takeoff_launch_evaluation(
  p_request_id uuid, p_token uuid, p_mark bigint, p_state text, p_reason text default null, p_details jsonb default '{}'::jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare
  request public.takeoff_launch_requests%rowtype;
begin
  if p_state not in ('not_eligible', 'blocked', 'evaluating') or p_mark is null or p_mark < 0
    or (p_state = 'evaluating') <> (p_reason is null)
    or (p_state = 'not_eligible' and not (p_reason = any (private.takeoff_launch_dossier_reasons())))
    or (p_state = 'blocked' and not (p_reason = any (private.takeoff_launch_mandate_reasons()
      || private.takeoff_launch_dossier_reasons() || private.takeoff_launch_transient_reasons())))
    or p_reason = 'OPERATOR_REQUIRED' or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'TAKEOFF_LAUNCH_EVALUATION_INVALID' using errcode = '22023';
  end if;
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if not found or request.evaluation_lease_token is distinct from p_token then
    return coalesce(request.state, 'lost');
  end if;
  update public.takeoff_launch_requests r set state = p_state, reason_code = p_reason,
    reason_details = coalesce(p_details, '{}'::jsonb),
    evaluated_mark = case when p_state = 'evaluating' then r.evaluated_mark else p_mark end,
    evaluated_at = pg_catalog.clock_timestamp(), evaluation_lease_token = null, evaluation_lease_expires_at = null
  where r.id = p_request_id;
  return p_state;
end;
$$;
revoke all on function public.record_takeoff_launch_evaluation(uuid, uuid, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_takeoff_launch_evaluation(uuid, uuid, bigint, text, text, jsonb) to service_role;

-- 9. The admission: the request is sealed, its job inserted and both creation records written in one commit. A changed
-- dossier, a lost lease, a payer no longer eligible or a source that moved since the evaluation aborts it and the request
-- waits for a new evaluation; nothing is spent before this commits.
create function private.insert_takeoff_launch_job(p_request public.takeoff_launch_requests, p_job jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  requested public.takeoff_jobs := jsonb_populate_record(null::public.takeoff_jobs, p_job);
  inserted uuid;
begin
  if requested.id is null or requested.plan_set_id is null or requested.launch_unit_key is null
    or requested.execution_host_id is distinct from p_request.execution_host_id then
    raise exception 'TAKEOFF_LAUNCH_JOB_INVALID' using errcode = '22023';
  end if;
  perform set_config('mergeone.takeoff_request_admission', p_request.id::text, true);
  insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, plan_set_id, level, status,
    processing_strategy, source_file_name, source_file_path, source_file_type, source_file_size_bytes, prompt_version,
    created_by, preparation_snapshot, execution_provider, execution_host_id, launch_request_id, launch_unit_key)
  values (requested.id, p_request.tenant_id, p_request.project_id, null, requested.plan_set_id, 'C', 'pending', 'sync',
    requested.source_file_name, null, requested.source_file_type, requested.source_file_size_bytes, requested.prompt_version,
    p_request.payer_id, p_request.preparation_snapshot, 'chatgpt_local', p_request.execution_host_id, p_request.id,
    requested.launch_unit_key)
  returning id into inserted;
  perform set_config('mergeone.takeoff_request_admission', '', true);
  return inserted;
end;
$$;
revoke all on function private.insert_takeoff_launch_job(public.takeoff_launch_requests, jsonb) from public, anon, authenticated, service_role;

create function private.assert_takeoff_launch_seal(p_request public.takeoff_launch_requests, p_manifest jsonb, p_snapshot jsonb)
returns void language plpgsql stable set search_path = '' as $$
begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest -> 'format_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_manifest -> 'units') is distinct from 'array' or jsonb_array_length(p_manifest -> 'units') <> 1
    or p_manifest #>> '{units,0,key}' is distinct from 'grouped'
    or p_manifest #>> '{order,kind}' is distinct from 'free_extraction'
    or jsonb_typeof(p_manifest -> 'plans') is distinct from 'array' or jsonb_array_length(p_manifest -> 'plans') = 0
    or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot -> 'schema_version' is distinct from '1'::jsonb
    or p_snapshot ->> 'confirmed_by' is distinct from p_request.payer_id::text
    or p_snapshot -> 'execution_selection' is distinct from p_request.mandate_selection
    or p_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb
    or p_snapshot #>> '{preparation,processing,level}' is distinct from 'C'
    or p_snapshot #>> '{preparation,processing,provider}' is distinct from 'chatgpt'
    or p_snapshot #>> '{preparation,destination,kind}' is distinct from 'analysis_only' then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.assert_takeoff_launch_seal(public.takeoff_launch_requests, jsonb, jsonb) from public, anon, authenticated, service_role;

create function public.admit_takeoff_launch_request(
  p_request_id uuid, p_token uuid, p_mark bigint, p_manifest jsonb, p_snapshot jsonb, p_job jsonb
) returns table (outcome text, job_id uuid, reason_code text)
language plpgsql security definer set search_path = '' as $$
declare
  request public.takeoff_launch_requests%rowtype;
  brief public.affaire_briefs%rowtype;
  launch_from timestamptz := (select a.active_from from private.takeoff_launch_activation a);
  admitted_job uuid;
  failure text;
  violated text;
begin
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request.state in ('admitted', 'closed') then
    return query select 'replayed', (select j.id from public.takeoff_jobs j where j.launch_request_id = request.id
      order by j.launch_unit_key limit 1), null::text;
    return;
  end if;
  if request.evaluation_lease_token is distinct from p_token or request.evaluation_lease_expires_at <= pg_catalog.clock_timestamp() then
    return query select 'lost', null::uuid, null::text;
    return;
  end if;
  -- The previous application version neither records an end nor reads a request: nothing is admitted before both cut-offs.
  if launch_from is null or launch_from > pg_catalog.clock_timestamp()
    or not exists (select 1 from private.takeoff_completion_activation c where c.active_from <= pg_catalog.clock_timestamp()) then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;

  if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
    update public.takeoff_launch_requests r set state = 'evaluating', reason_code = null, reason_details = '{}'::jsonb,
      evaluation_lease_token = null, evaluation_lease_expires_at = null where r.id = request.id;
    return query select 'stale', null::uuid, null::text;
    return;
  end if;
  select * into brief from public.affaire_briefs b where b.tenant_id = request.tenant_id and b.project_id = request.project_id;
  failure := case
    when request.payer_id is null or request.execution_host_id is null then 'MANDATE_REQUIRED'
    when request.origin = 'automatic' and (brief.status is distinct from 'confirme' or brief.confirmed_at < launch_from) then 'BRIEF_NOT_CONFIRMED'
    when request.mandate_kind = 'confirmation' and brief.confirmed_by is distinct from request.payer_id then 'MANDATE_REQUIRED'
    when not private.takeoff_launch_payer_eligible(request.tenant_id, request.project_id, request.payer_id) then 'PAYER_NOT_ELIGIBLE'
    when exists (select 1 from public.takeoff_launch_requests other where other.tenant_id = request.tenant_id
      and other.project_id = request.project_id and other.state = 'admitted' and other.id <> request.id) then 'ANOTHER_ANALYSIS_RUNNING'
  end;
  if failure is not null then
    update public.takeoff_launch_requests r set state = case when failure = 'BRIEF_NOT_CONFIRMED' then 'not_eligible' else 'blocked' end,
      reason_code = failure, reason_details = '{}'::jsonb, evaluated_mark = p_mark, evaluated_at = pg_catalog.clock_timestamp(),
      evaluation_lease_token = null, evaluation_lease_expires_at = null where r.id = request.id;
    return query select 'blocked', null::uuid, failure;
    return;
  end if;
  perform private.assert_takeoff_launch_seal(request, p_manifest, p_snapshot);

  begin
    update public.takeoff_launch_requests r set state = 'admitted', reason_code = null, reason_details = '{}'::jsonb,
      manifest = p_manifest, manifest_digest = encode(pg_catalog.sha256(convert_to(p_manifest::text, 'UTF8')), 'hex'),
      preparation_snapshot = p_snapshot, units_expected = jsonb_array_length(p_manifest -> 'units'),
      evaluated_mark = p_mark, evaluated_at = pg_catalog.clock_timestamp(), admitted_at = pg_catalog.clock_timestamp(),
      evaluation_lease_token = null, evaluation_lease_expires_at = null
    where r.id = request.id
    returning * into request;
    admitted_job := private.insert_takeoff_launch_job(request,
      p_job || jsonb_build_object('launch_unit_key', p_manifest #>> '{units,0,key}'));
    perform private.record_takeoff_launch_audit(request, request.payer_id, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', jsonb_build_array(admitted_job), 'manifest_digest', request.manifest_digest,
      'execution_host_id', request.execution_host_id, 'mandate_kind', request.mandate_kind));
  exception
    when unique_violation then
      -- Another request of the affaire was admitted between the check above and this one: it runs, this one waits.
      get stacked diagnostics violated = constraint_name;
      if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
      update public.takeoff_launch_requests r set state = 'blocked', reason_code = 'ANOTHER_ANALYSIS_RUNNING',
        evaluated_mark = p_mark, evaluated_at = pg_catalog.clock_timestamp(),
        evaluation_lease_token = null, evaluation_lease_expires_at = null where r.id = p_request_id;
      return query select 'blocked', null::uuid, 'ANOTHER_ANALYSIS_RUNNING'::text;
      return;
    when sqlstate '23514' then
      if sqlerrm <> 'TAKEOFF_JOB_ADMISSION_LIMIT' then raise; end if;
      update public.takeoff_launch_requests r set state = 'blocked', reason_code = 'ADMISSION_LIMIT',
        evaluated_mark = p_mark, evaluated_at = pg_catalog.clock_timestamp(),
        evaluation_lease_token = null, evaluation_lease_expires_at = null where r.id = p_request_id;
      return query select 'blocked', null::uuid, 'ADMISSION_LIMIT'::text;
      return;
    when sqlstate '42501' then
      -- A source that moved since the evaluation: evaluate the dossier again, nothing was admitted.
      if sqlerrm not in ('TAKEOFF_PREPARATION_SOURCE_STALE', 'TAKEOFF_PREPARATION_SOURCE_MISMATCH', 'TAKEOFF_PREPARATION_REQUIRED') then
        raise;
      end if;
      update public.takeoff_launch_requests r set state = 'evaluating', reason_code = null, reason_details = '{}'::jsonb,
        evaluation_lease_token = null, evaluation_lease_expires_at = null where r.id = p_request_id;
      return query select 'stale', null::uuid, null::text;
      return;
  end;
  return query select 'admitted', admitted_job, null::text;
end;
$$;
revoke all on function public.admit_takeoff_launch_request(uuid, uuid, bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.admit_takeoff_launch_request(uuid, uuid, bigint, jsonb, jsonb, jsonb) to service_role;

-- 10. An explicit command (a relaunch from the takeoff's options): a manual request created, sealed and admitted in one
-- commit, on the subscription of the member who clicks, who receives its end. Its key survives a double click, a timeout
-- and a replay: the same key with the same content returns the same request, with other content it is a conflict. While
-- another request of the affaire is admitted, the command returns that one and creates nothing.
create function public.launch_manual_takeoff_request(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_job jsonb
) returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  digest text := encode(pg_catalog.sha256(convert_to(jsonb_build_array(p_actor, p_intent, p_predecessor_job_id,
    p_job ->> 'plan_set_id', p_snapshot -> 'preparation_revision', p_snapshot -> 'confirmed_at')::text, 'UTF8')), 'hex');
  request public.takeoff_launch_requests%rowtype;
  running public.takeoff_launch_requests%rowtype;
  predecessor_request uuid;
  admitted_job uuid;
begin
  if p_intent not in ('initial', 'reread_plans') or p_intent_key is null or p_actor is null then
    raise exception 'TAKEOFF_LAUNCH_COMMAND_INVALID' using errcode = '22023';
  end if;
  perform private.assert_takeoff_launch_selection(p_host, p_selection);
  if not private.takeoff_launch_active()
    or not exists (select 1 from private.takeoff_completion_activation c where c.active_from <= pg_catalog.clock_timestamp()) then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  -- Commands of one affaire are serialized on its key: the replay check and the one-running rule read committed rows.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-launch:' || p_project_id::text, 0));
  select * into request from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'manual' and r.intent_key = p_intent_key;
  if found then
    if request.command_digest is distinct from digest then
      raise exception 'TAKEOFF_LAUNCH_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return query select 'replayed', request.id, (select j.id from public.takeoff_jobs j where j.launch_request_id = request.id
      order by j.launch_unit_key limit 1);
    return;
  end if;
  select * into running from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
  if found then
    return query select 'already_running', running.id, (select j.id from public.takeoff_jobs j where j.launch_request_id = running.id
      order by j.launch_unit_key limit 1);
    return;
  end if;
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  if p_predecessor_job_id is not null then
    select j.launch_request_id into predecessor_request from public.takeoff_jobs j
    where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id and j.project_id = p_project_id;
    if not found then
      raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
    end if;
  end if;
  insert into public.takeoff_launch_requests (tenant_id, project_id, origin, intent, intent_key, command_digest,
    predecessor_request_id, predecessor_job_id, state, payer_id, mandate_kind, requested_by, mandated_at,
    execution_host_id, mandate_selection, execution_selection)
  values (p_tenant_id, p_project_id, 'manual', p_intent, p_intent_key, digest, predecessor_request, p_predecessor_job_id,
    'evaluating', p_actor, 'command', p_actor, pg_catalog.clock_timestamp(), p_host, p_selection, p_selection)
  returning * into request;
  perform private.assert_takeoff_launch_seal(request, p_manifest, p_snapshot);
  update public.takeoff_launch_requests r set state = 'admitted',
    manifest = p_manifest, manifest_digest = encode(pg_catalog.sha256(convert_to(p_manifest::text, 'UTF8')), 'hex'),
    preparation_snapshot = p_snapshot, units_expected = jsonb_array_length(p_manifest -> 'units'),
    evaluated_mark = private.takeoff_launch_mark_position(p_tenant_id, p_project_id),
    evaluated_at = pg_catalog.clock_timestamp(), admitted_at = pg_catalog.clock_timestamp()
  where r.id = request.id
  returning * into request;
  admitted_job := private.insert_takeoff_launch_job(request,
    p_job || jsonb_build_object('launch_unit_key', p_manifest #>> '{units,0,key}'));
  perform private.record_takeoff_launch_audit(request, p_actor, 'takeoff.request.admitted', jsonb_build_object(
    'job_ids', jsonb_build_array(admitted_job), 'manifest_digest', request.manifest_digest, 'intent', p_intent,
    'predecessor_job_id', p_predecessor_job_id, 'execution_host_id', p_host, 'mandate_kind', 'command'));
  return query select 'admitted', request.id, admitted_job;
end;
$$;
revoke all on function public.launch_manual_takeoff_request(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.launch_manual_takeoff_request(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- 11. The end of a request: the recorded end of its last unit closes it and publishes its one notice, in the transaction
-- that records that end (the job's row, then the request's: the order of every writer of both). Its jobs never publish
-- their own (20261121011212 leaves their event empty). A success, a failure and a cancellation count per unit; lot 2 has
-- one unit, so the request ends as its job did.
alter table public.takeoff_completion_notifications
  drop constraint takeoff_completion_autonomous_only_check,
  add constraint takeoff_completion_request_fkey foreign key (request_id, tenant_id, project_id)
    references public.takeoff_launch_requests (id, tenant_id, project_id) on delete cascade;

create function private.settle_takeoff_launch_request()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  request public.takeoff_launch_requests%rowtype;
  ended integer;
  plans integer;
  recipient uuid;
  logical_email text;
  initial_state text := 'unavailable';
  not_started boolean := new.error_code in ('TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_QUEUE_EXPIRED', 'TAKEOFF_WORKER_HOST_SILENT');
begin
  select * into request from public.takeoff_launch_requests r where r.id = new.launch_request_id for update;
  if not found or request.state <> 'admitted' then
    return null;
  end if;
  update public.takeoff_launch_requests r set
    units_succeeded = r.units_succeeded + (new.analysis_outcome = 'success')::integer,
    units_failed = r.units_failed + (new.analysis_outcome = 'failure')::integer,
    units_canceled = r.units_canceled + (new.analysis_outcome = 'canceled')::integer
  where r.id = request.id
  returning * into request;
  ended := request.units_succeeded + request.units_failed + request.units_canceled;
  if ended < request.units_expected then
    return null;
  end if;
  update public.takeoff_launch_requests r set state = 'closed', closed_at = new.analysis_finished_at,
    completion_event_id = gen_random_uuid(),
    outcome = case
      when r.units_succeeded = r.units_expected then 'success'
      when r.units_failed = r.units_expected then 'failure'
      when r.units_canceled = r.units_expected then 'canceled'
      else 'partial' end
  where r.id = request.id
  returning * into request;

  -- From the notices' cut-off on, as for a job: one notice and one e-mail to the request's payer.
  if not exists (select 1 from private.takeoff_completion_activation a where request.closed_at >= a.active_from) then
    return null;
  end if;
  recipient := request.requested_by;
  plans := jsonb_array_length(request.manifest -> 'plans');
  if request.outcome = 'canceled' then
    initial_state := 'suppressed';
  elsif recipient is not null and private.takeoff_completion_recipient_can_read(request.tenant_id, request.project_id, recipient) then
    select nullif(trim(u.email), '') into logical_email from auth.users u
      where u.id = recipient and u.email_confirmed_at is not null and u.deleted_at is null;
    if logical_email is not null then
      initial_state := 'pending';
    end if;
  end if;
  insert into public.takeoff_completion_notifications (
    id, tenant_id, project_id, subject_kind, request_id, recipient_user_id, outcome, finished_at,
    plans_read_count, plans_failed_count, plans_not_started_count,
    recipient_email, delivery_state, provider_key, next_attempt_at, last_delivery_code, reason_code
  ) values (
    request.completion_event_id, request.tenant_id, request.project_id, 'request', request.id, recipient, request.outcome,
    request.closed_at,
    case when request.outcome = 'success' then plans else 0 end,
    case when request.outcome = 'failure' and not not_started then plans else 0 end,
    case when request.outcome = 'failure' and not_started then plans else 0 end,
    logical_email, initial_state,
    'takeoff-completion/' || request.tenant_id::text || '/request/' || request.id::text || '/'
      || coalesce(recipient::text, 'unavailable'),
    case when initial_state = 'pending' then request.closed_at end,
    case when initial_state = 'unavailable' then 'RECIPIENT_UNAVAILABLE' end,
    case when request.outcome = 'failure' and new.error_code = any (private.takeoff_public_failure_codes())
      then new.error_code end
  );
  return null;
end;
$$;
revoke all on function private.settle_takeoff_launch_request() from public, anon, authenticated;
create trigger takeoff_launch_request_settlement after update on public.takeoff_jobs
  for each row when (old.analysis_outcome is null and new.analysis_outcome is not null and new.launch_request_id is not null)
  execute function private.settle_takeoff_launch_request();

-- The consumption a request's jobs observed, attempt after attempt (a retry resets the job's own figures).
create function private.count_takeoff_launch_consumption()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  update public.takeoff_launch_requests r set
    tokens_observed = r.tokens_observed + greatest(coalesce(new.token_count, 0) - coalesce(old.token_count, 0), 0),
    cost_cents_observed = r.cost_cents_observed + greatest(coalesce(new.cost_cents, 0) - coalesce(old.cost_cents, 0), 0)
  where r.id = new.launch_request_id;
  return null;
end;
$$;
revoke all on function private.count_takeoff_launch_consumption() from public, anon, authenticated;
create trigger takeoff_launch_request_consumption after update of token_count, cost_cents on public.takeoff_jobs
  for each row when (new.launch_request_id is not null
    and (coalesce(new.token_count, 0) > coalesce(old.token_count, 0) or coalesce(new.cost_cents, 0) > coalesce(old.cost_cents, 0)))
  execute function private.count_takeoff_launch_consumption();

-- 12. The lock cycle « Dupliquer » against the end of a job, before the notices are activated. The copy held the affaire
-- FOR UPDATE and then each carried job FOR SHARE; a worker ending one of those jobs holds its row FOR UPDATE and its
-- notice's foreign key needs a key-share lock on the affaire: each waited for the other. The copy now holds the affaire
-- FOR NO KEY UPDATE (the strength of the send, 20261121050138), which still excludes every writer and copy that locks
-- that row, and no longer a foreign key check. The source version stays FOR UPDATE.
do $copy_lock$
declare
  definition text;
  original text := 'for update of p, v;';
begin
  select pg_get_functiondef('public.duplicate_estimate_version_without_product_id(uuid,boolean)'::regprocedure) into definition;
  if (length(definition) - length(replace(definition, original, ''))) / length(original) <> 1 then
    raise exception 'TAKEOFF_LAUNCH_COPY_LOCK_PATCH_UNEXPECTED';
  end if;
  execute replace(definition, original, 'for no key update of p for update of v;');
end;
$copy_lock$;

commit;
