begin;

-- The first statement takes ACCESS EXCLUSIVE on takeoff_jobs. Give up instead
-- of queueing every reader and writer of the table behind a long transaction.
set local lock_timeout = '5s';

alter table public.takeoff_jobs
  add column analysis_requested_by uuid,
  add column analysis_queued_at timestamptz,
  add column analysis_outcome text,
  add column analysis_finished_at timestamptz,
  add column analysis_completion_event_id uuid,
  add constraint takeoff_jobs_analysis_outcome_check check (
    (analysis_outcome is null and analysis_finished_at is null and analysis_completion_event_id is null)
    or (analysis_outcome is not null and analysis_finished_at is not null and (
      (analysis_outcome = 'success' and status in ('completed', 'applied'))
      or (analysis_outcome = 'failure' and status = 'failed' and next_retry_at is null)
      or (analysis_outcome = 'canceled' and status = 'canceled' and next_retry_at is null)
    ))
  ),
  add constraint takeoff_jobs_id_tenant_key unique (id, tenant_id);

-- This stays empty until the environment's owner sets a cutoff. Finalized rows
-- are never scanned or replayed when the cutoff is set or changed.
create table private.takeoff_completion_activation (
  singleton boolean primary key default true check (singleton),
  active_from timestamptz not null
);
revoke all on private.takeoff_completion_activation from public, anon, authenticated, service_role;


create table public.takeoff_completion_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  subject_kind text not null,
  job_id uuid,
  request_id uuid,
  recipient_user_id uuid,
  outcome text not null check (outcome in ('success', 'failure', 'canceled', 'partial')),
  finished_at timestamptz not null,
  plans_read_count integer check (plans_read_count >= 0),
  plans_failed_count integer check (plans_failed_count >= 0),
  plans_not_started_count integer check (plans_not_started_count >= 0),
  read_at timestamptz,
  recipient_email text,
  delivery_state text not null check (
    delivery_state in ('pending', 'sending', 'sent', 'failed', 'unknown', 'unavailable', 'suppressed')
  ),
  provider_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  first_send_at timestamptz,
  routing_mode text check (routing_mode in ('live', 'redirect')),
  effective_email text,
  payload_hash text,
  provider_id text,
  last_delivery_code text check (last_delivery_code ~ '^[A-Z_]{1,64}$'),
  constraint takeoff_completion_job_fkey foreign key (job_id, tenant_id)
    references public.takeoff_jobs (id, tenant_id) on delete cascade,
  constraint takeoff_completion_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade,
  constraint takeoff_completion_subject_check check (
    (subject_kind = 'job' and job_id is not null and request_id is null)
    or (subject_kind = 'request' and job_id is null and request_id is not null)
  ),
  -- Remove this gate only in the transaction that installs the request FK.
  constraint takeoff_completion_autonomous_only_check check (subject_kind = 'job'),
  constraint takeoff_completion_job_outcome_check check (
    subject_kind <> 'job' or (outcome <> 'partial' and plans_read_count is null
      and plans_failed_count is null and plans_not_started_count is null)
  ),
  constraint takeoff_completion_recipient_key
    unique nulls not distinct (tenant_id, subject_kind, job_id, request_id, recipient_user_id),
  constraint takeoff_completion_provider_key_check check (
    provider_key = 'takeoff-completion/' || tenant_id::text || '/' || subject_kind || '/' || coalesce(job_id, request_id)::text
      || '/' || coalesce(recipient_user_id::text, 'unavailable')
  ),
  constraint takeoff_completion_lease_check check (
    (delivery_state = 'sending') = (lease_token is not null)
    and (lease_token is null) = (lease_expires_at is null)
  ),
  constraint takeoff_completion_schedule_check check ((delivery_state = 'pending') = (next_attempt_at is not null)),
  constraint takeoff_completion_send_check check (
    (first_send_at is null) = (routing_mode is null)
    and (first_send_at is null) = (effective_email is null)
    and (first_send_at is null) = (payload_hash is null)
    and (first_send_at is null or recipient_email is not null)
    and (delivery_state = 'sent') = (provider_id is not null)
  ),
  constraint takeoff_completion_cancellation_check check ((outcome = 'canceled') = (delivery_state = 'suppressed'))
);

create index takeoff_completion_menu_idx
  on public.takeoff_completion_notifications (tenant_id, recipient_user_id, finished_at desc, id desc);
create index takeoff_completion_project_idx on public.takeoff_completion_notifications (project_id, tenant_id);
create index takeoff_completion_due_idx on public.takeoff_completion_notifications
  (coalesce(next_attempt_at, lease_expires_at), id) where delivery_state in ('pending', 'sending');

alter table public.takeoff_completion_notifications enable row level security;
revoke all on public.takeoff_completion_notifications from public, anon, authenticated, service_role;
grant select (id, tenant_id, project_id, subject_kind, job_id, request_id, outcome, finished_at,
  plans_read_count, plans_failed_count, plans_not_started_count, read_at, delivery_state)
  on public.takeoff_completion_notifications to authenticated;
grant select, insert, update, delete on public.takeoff_completion_notifications to service_role;

-- Keep the service-role table grants used by the repository's lifecycle writers.
-- The completion trigger alone creates the event and freezes its delivery identity.
create function private.guard_takeoff_completion_notification_identity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'service_role' then
      raise exception 'TAKEOFF_COMPLETION_WRITER_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.id, new.tenant_id, new.project_id, new.subject_kind, new.job_id, new.request_id,
        new.recipient_user_id, new.outcome, new.finished_at, new.recipient_email, new.provider_key,
        new.plans_read_count, new.plans_failed_count, new.plans_not_started_count)
    is distinct from (old.id, old.tenant_id, old.project_id, old.subject_kind, old.job_id, old.request_id,
        old.recipient_user_id, old.outcome, old.finished_at, old.recipient_email, old.provider_key,
        old.plans_read_count, old.plans_failed_count, old.plans_not_started_count)
    or (current_user = 'service_role' and new.read_at is distinct from old.read_at)
  then
    raise exception 'TAKEOFF_COMPLETION_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_completion_notification_identity() from public, anon, authenticated;
create trigger takeoff_completion_notification_identity before insert or update on public.takeoff_completion_notifications
for each row execute function private.guard_takeoff_completion_notification_identity();

-- Membership and effective affaire read access must agree with the dashboard.
create function private.takeoff_completion_recipient_can_read(
  p_tenant_id uuid, p_project_id uuid, p_recipient_id uuid
)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.estimate_projects p
    join public.tenants t on t.id = p.tenant_id and t.is_active
    join public.tenant_memberships m on m.tenant_id = p.tenant_id and m.user_id = p_recipient_id
    where p.id = p_project_id and p.tenant_id = p_tenant_id and not p.is_archived
      and (p.user_id = m.user_id or m.role in ('admin', 'director'))
      and p_tenant_id = (
        select active_membership.tenant_id
        from public.tenant_memberships active_membership
        join public.tenants active_tenant on active_tenant.id = active_membership.tenant_id and active_tenant.is_active
        where active_membership.user_id = p_recipient_id
        order by active_membership.is_default desc, active_membership.created_at asc
        limit 1
      )
  );
$$;
revoke all on function private.takeoff_completion_recipient_can_read(uuid, uuid, uuid) from public, anon, authenticated;

create function private.takeoff_completion_visible(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $$
  select private.takeoff_completion_recipient_can_read(p_tenant_id, p_project_id, (select auth.uid()));
$$;
revoke all on function private.takeoff_completion_visible(uuid, uuid) from public, anon, authenticated;
grant execute on function private.takeoff_completion_visible(uuid, uuid) to authenticated;

create policy takeoff_completion_recipient_read on public.takeoff_completion_notifications
for select to authenticated
using (
  recipient_user_id = (select auth.uid())
  and private.takeoff_completion_visible(tenant_id, project_id)
);

-- Affaire readers need the event independently of the job's operator-only
-- row policy. This projection contains no job or delivery fields.
create function public.list_affaire_takeoff_completions(p_project_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (event_id uuid, outcome text, finished_at timestamptz)
language sql stable security definer set search_path = pg_catalog as $$
  select n.id, n.outcome, n.finished_at
  from public.takeoff_completion_notifications n
  where n.project_id = p_project_id
    and private.takeoff_completion_visible(n.tenant_id, n.project_id)
  order by n.finished_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.list_affaire_takeoff_completions(uuid, integer, integer) from public, anon, service_role;
grant execute on function public.list_affaire_takeoff_completions(uuid, integer, integer) to authenticated;

create function public.mark_takeoff_completion_notification_read(p_id uuid)
returns boolean
language sql security definer
set search_path = pg_catalog
as $$
  with marked as (
    update public.takeoff_completion_notifications as n
    set read_at = coalesce(n.read_at, statement_timestamp())
    where n.id = p_id and n.recipient_user_id = (select auth.uid())
      and private.takeoff_completion_visible(n.tenant_id, n.project_id)
    returning 1
  ) select exists (select 1 from marked);
$$;
revoke all on function public.mark_takeoff_completion_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_takeoff_completion_notification_read(uuid) to authenticated;

-- The processor's CAS supplies the lease token. The row trigger additionally
-- checks the database clock after the UPDATE has acquired the job lock.
create function private.set_takeoff_analysis_outcome()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  finished_at timestamptz := clock_timestamp();
  writer_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  worker_write boolean := writer_role in ('service_role', 'postgres');
  activated boolean := exists (select 1 from private.takeoff_completion_activation a where a.active_from <= finished_at);
begin
  if tg_op = 'INSERT' then
    if new.analysis_outcome is not null or new.analysis_finished_at is not null
      or new.analysis_completion_event_id is not null or new.analysis_requested_by is not null
      or new.analysis_queued_at is not null then
      raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.analysis_requested_by is distinct from old.analysis_requested_by then
    raise exception 'TAKEOFF_ANALYSIS_REQUESTER_RESERVED' using errcode = '42501';
  end if;
  new.analysis_queued_at := old.analysis_queued_at;

  -- The deployed pre-M3 writers retain their behavior before activation.
  if not activated and old.analysis_outcome is null then
    new.analysis_outcome := null;
    new.analysis_finished_at := old.analysis_finished_at;
    new.analysis_completion_event_id := old.analysis_completion_event_id;
    return new;
  end if;

  if activated and old.status in ('failed', 'canceled') and new.status = 'pending' then
    new.analysis_queued_at := finished_at;
    -- This trigger runs after the existing authenticated reset allowlist.
    -- Attribute the accepted reset from its own session, not its payload.
    if writer_role = 'authenticated' then
      new.analysis_requested_by := (select auth.uid());
    end if;
  end if;

  if old.execution_provider = 'chatgpt_local' and old.status = 'failed'
    and old.next_retry_at is not null and new.status = 'pending'
  then
    raise exception 'TAKEOFF_ANALYSIS_RETRY_SCHEDULED' using errcode = '23514';
  end if;
  if old.execution_provider = 'chatgpt_local' and old.status = 'failed' and new.status = 'processing'
    and (old.analysis_outcome is not null or old.next_retry_at > finished_at
      or old.retry_count >= 3)
  then
    return null;
  end if;
  if new.analysis_finished_at is distinct from old.analysis_finished_at
    or new.analysis_completion_event_id is distinct from old.analysis_completion_event_id
    or (new.analysis_outcome is distinct from old.analysis_outcome and (
      not worker_write or old.analysis_outcome is not null or new.analysis_outcome is distinct from 'failure'
      or new.status <> 'failed' or (
        old.status not in ('pending', 'processing') and not (
          old.status = 'failed' and old.next_retry_at is not null and new.next_retry_at is null
          and new.error_code = 'TAKEOFF_WORKER_NOT_STARTED'
        )
      )
    ))
  then
    raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
  end if;

  if old.status in ('pending', 'processing') and new.status = 'canceled' then
    new.analysis_outcome := 'canceled';
  elsif old.execution_provider = 'chatgpt_local' and old.status = 'processing'
    and new.status in ('completed', 'failed') then
    if not worker_write then
      raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
    end if;
    if new.status = 'failed' and new.analysis_outcome = 'failure'
      and new.error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN' then
      -- Recovery has already verified staleness in its UPDATE predicate.
      null;
    elsif old.processing_lease_token is null or old.processing_lease_expires_at <= finished_at then
      raise exception 'TAKEOFF_ANALYSIS_LEASE_EXPIRED' using errcode = '23514';
    end if;
    if new.status = 'completed' then
      new.analysis_outcome := 'success';
    end if;
  end if;

  if new.analysis_outcome is distinct from old.analysis_outcome then
    new.analysis_finished_at := finished_at;
    -- M4 supplies the parent FK. Child jobs still record an outcome, and the
    -- request finalizer will allocate its own event after all children settle.
    if to_jsonb(new) ->> 'launch_request_id' is null then
      new.analysis_completion_event_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.set_takeoff_analysis_outcome() from public, anon, authenticated;
create trigger z_takeoff_analysis_outcome before insert or update on public.takeoff_jobs
for each row execute function private.set_takeoff_analysis_outcome();

create function private.publish_takeoff_analysis_completion()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  affaire_id uuid := (to_jsonb(new) ->> 'project_id')::uuid;
  requester_id uuid := coalesce(new.analysis_requested_by, new.created_by);
  logical_email text;
  initial_state text := 'unavailable';
begin
  if not exists (
    select 1 from private.takeoff_completion_activation a where new.analysis_finished_at >= a.active_from
  ) then
    return null;
  end if;

  -- A job admitted by affaire carries its frozen scope. Use the historical
  -- sources only when that field is absent so both migrations can land first.
  if affaire_id is null then
    select v.project_id into affaire_id from public.estimate_versions v
      where v.id = new.estimate_version_id and v.tenant_id = new.tenant_id;
  end if;
  if affaire_id is null then
    select s.project_id into affaire_id from public.plan_sets s
      where s.id = new.plan_set_id and s.tenant_id = new.tenant_id;
  end if;
  if affaire_id is null then
    raise exception 'TAKEOFF_COMPLETION_PROJECT_MISSING' using errcode = '23514';
  end if;

  if new.analysis_outcome = 'canceled' then
    initial_state := 'suppressed';
  elsif private.takeoff_completion_recipient_can_read(new.tenant_id, affaire_id, requester_id) then
    select nullif(trim(u.email), '') into logical_email from auth.users u
      where u.id = requester_id and u.email_confirmed_at is not null and u.deleted_at is null;
    if logical_email is not null then
      initial_state := 'pending';
    end if;
  end if;

  insert into public.takeoff_completion_notifications (
    id, tenant_id, project_id, subject_kind, job_id, recipient_user_id, outcome, finished_at,
    recipient_email, delivery_state, provider_key, next_attempt_at, last_delivery_code
  ) values (
    new.analysis_completion_event_id, new.tenant_id, affaire_id, 'job', new.id, requester_id,
    new.analysis_outcome, new.analysis_finished_at, logical_email, initial_state,
    'takeoff-completion/' || new.tenant_id::text || '/job/' || new.id::text || '/'
      || coalesce(requester_id::text, 'unavailable'),
    case when initial_state = 'pending' then new.analysis_finished_at end,
    case when initial_state = 'unavailable' then 'RECIPIENT_UNAVAILABLE' end
  );
  return null;
end;
$$;
revoke all on function private.publish_takeoff_analysis_completion() from public, anon, authenticated;
create trigger takeoff_analysis_completion after update on public.takeoff_jobs
for each row when (old.analysis_completion_event_id is null and new.analysis_completion_event_id is not null)
execute function private.publish_takeoff_analysis_completion();

create or replace function public.recover_stale_local_takeoff_jobs(
  p_now timestamptz,
  p_stale_after interval default interval '10 minutes'
)
returns table (job_id uuid, error_code text)
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  cutoff timestamptz := (select active_from from private.takeoff_completion_activation);
  recovery_at timestamptz := least(p_now, clock_timestamp());
begin
  if p_now is null or p_stale_after < interval '1 minute' then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  if cutoff is null or clock_timestamp() < cutoff then
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
    return;
  end if;
  if p_stale_after is null then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  return query
  update public.takeoff_jobs as job_row
  set status = 'failed', completed_at = recovery_at, next_retry_at = null,
    last_error_at = recovery_at,
    error_code = case when job_row.status = 'processing' then 'TAKEOFF_WORKER_OUTCOME_UNKNOWN'
      else 'TAKEOFF_WORKER_NOT_STARTED' end,
    error_message = case when job_row.status = 'processing'
      then 'Le traitement a été interrompu. Son résultat est inconnu et nécessite une vérification manuelle.'
      else 'L’analyse n’a pas pu démarrer. Vérifiez le poste autorisé avant de préparer une nouvelle analyse.' end,
    analysis_outcome = 'failure',
    processing_lease_token = null, processing_lease_expires_at = null,
    provider_reconcile_due_at = null, provider_reconcile_lease_token = null,
    provider_reconcile_lease_expires_at = null
  where job_row.execution_provider = 'chatgpt_local' and job_row.provider_batch_id is null
    and job_row.analysis_outcome is null
    and (
      (job_row.status = 'processing' and (
        job_row.processing_lease_expires_at <= recovery_at or
        (job_row.processing_lease_expires_at is null
          and coalesce(job_row.started_at, job_row.updated_at) <= recovery_at - p_stale_after)))
      or (job_row.status = 'pending' and
        greatest(cutoff, coalesce(job_row.analysis_queued_at, job_row.created_at)) <= recovery_at - p_stale_after)
      or (job_row.status = 'failed' and job_row.retry_count < 3 and job_row.next_retry_at is not null and
        greatest(cutoff, job_row.next_retry_at) <= recovery_at - p_stale_after)
    )
  returning job_row.id, job_row.error_code;
end;
$$;
revoke all on function public.recover_stale_local_takeoff_jobs(timestamptz, interval) from public, anon, authenticated;
grant execute on function public.recover_stale_local_takeoff_jobs(timestamptz, interval) to service_role;

create function private.insert_local_takeoff_result_items(p_tenant_id uuid, p_job_id uuid, p_result_id uuid, p_items jsonb)
returns void language sql set search_path = pg_catalog as $$
  insert into public.takeoff_items (
    id, tenant_id, job_id, result_id, designation, quantity, unit, confidence, evidence,
    source_file_name, source_page, metadata, is_excluded, exclusion_reason, rules_stale
  )
  select coalesce(item.id, gen_random_uuid()), p_tenant_id, p_job_id, p_result_id,
    item.designation, item.quantity, item.unit, item.confidence, item.evidence, item.source_file_name,
    item.source_page, coalesce(item.metadata, '{}'::jsonb), coalesce(item.is_excluded, false),
    item.exclusion_reason, coalesce(item.rules_stale, false)
  from jsonb_populate_recordset(null::public.takeoff_items, p_items) item;
$$;
revoke all on function private.insert_local_takeoff_result_items(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- The worker cannot leave a successful result visible without its terminal
-- job update. The row lock arbitrates with cancellation and stale recovery.
create function public.finalize_local_takeoff_result(
  p_job_id uuid, p_tenant_id uuid, p_lease_token uuid, p_completed_at timestamptz,
  p_model text, p_prompt_version text, p_result jsonb, p_items jsonb, p_vector jsonb default null
)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  result_row public.takeoff_results;
  new_result_id uuid;
begin
  perform 1 from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id and j.status = 'processing'
    and j.execution_provider = 'chatgpt_local' and j.processing_lease_token = p_lease_token
  for update;
  if not found then return null; end if;

  if not exists (select 1 from public.takeoff_jobs j where j.id = p_job_id
      and j.processing_lease_expires_at > clock_timestamp()) then
    return null;
  end if;

  result_row := jsonb_populate_record(null::public.takeoff_results, p_result);
  delete from public.takeoff_run_metrics where job_id = p_job_id and tenant_id = p_tenant_id;
  delete from public.takeoff_items where job_id = p_job_id and tenant_id = p_tenant_id;
  delete from public.takeoff_results where job_id = p_job_id and tenant_id = p_tenant_id;
  insert into public.takeoff_results (tenant_id, job_id, extracted_json, warnings, tables, provider_meta, raw_response,
    confidence, token_count, cost_cents, duration_ms)
  values (p_tenant_id, p_job_id, result_row.extracted_json, result_row.warnings, result_row.tables, result_row.provider_meta,
    result_row.raw_response, result_row.confidence, result_row.token_count, result_row.cost_cents, result_row.duration_ms)
  returning id into new_result_id;

  perform private.insert_local_takeoff_result_items(p_tenant_id, p_job_id, new_result_id, p_items);

  -- Optional vector measurements and source selection succeed together, or
  -- this subtransaction leaves the model reading intact. A lost RPC response
  -- cannot cause the worker to undo an already committed selection.
  if p_vector is not null then
    begin
      insert into public.takeoff_vector_pages (
        id, tenant_id, job_id, result_id, plan_file_id, source_file_name, source_page, reading, schema_version, rule_anchors
      )
      select p.id, p_tenant_id, p_job_id, new_result_id, p.plan_file_id, p.source_file_name, p.source_page,
        p.reading, p.schema_version, p.rule_anchors
      from jsonb_populate_recordset(null::public.takeoff_vector_pages, p_vector->'pages') p;

      perform private.insert_local_takeoff_result_items(p_tenant_id, p_job_id, new_result_id, p_vector->'items');

      insert into public.takeoff_item_geometries (takeoff_item_id, tenant_id, job_id, vector_page_id, geometry, schema_version)
      select g.takeoff_item_id, p_tenant_id, p_job_id, g.vector_page_id, g.geometry, g.schema_version
      from jsonb_populate_recordset(null::public.takeoff_item_geometries, p_vector->'geometries') g;

      if jsonb_array_length(p_vector->'choices') > 0 then
        perform public.select_takeoff_quantity_sources(p_job_id, p_tenant_id, p_vector->'choices');
      end if;
    exception when data_exception or integrity_constraint_violation then
      raise log 'takeoff.vector.persistence_failed job=% code=%', p_job_id, sqlstate;
    end;
  end if;

  if jsonb_array_length(p_result->'run_metrics') > 0 then
    begin
      insert into public.takeoff_run_metrics (
        tenant_id, job_id, result_id, level, provider, model, chunk_index, chunk_start_page, chunk_end_page,
        input_tokens, reasoning_tokens, output_tokens, total_tokens, cost_cents, duration_ms, timed_out,
        budget_exceeded, metadata
      )
      select p_tenant_id, p_job_id, new_result_id, m.level, m.provider, m.model, m.chunk_index,
        m.chunk_start_page, m.chunk_end_page, m.input_tokens, m.reasoning_tokens, m.output_tokens,
        m.total_tokens, m.cost_cents, m.duration_ms, m.timed_out, m.budget_exceeded, m.metadata
      from jsonb_populate_recordset(null::public.takeoff_run_metrics, p_result->'run_metrics') m;
    exception when data_exception or integrity_constraint_violation then
      raise log 'takeoff.level_c.metrics_persistence_failed job=% code=%', p_job_id, sqlstate;
    end;
  end if;

  update public.takeoff_jobs set
    status = 'completed', completed_at = p_completed_at, model = p_model, prompt_version = p_prompt_version,
    token_count = result_row.token_count, cost_cents = result_row.cost_cents,
    duration_ms = coalesce((p_result->>'job_duration_ms')::integer, result_row.duration_ms),
    error_code = null, error_message = null, next_retry_at = null,
    processing_lease_token = null, processing_lease_expires_at = null
  where id = p_job_id and tenant_id = p_tenant_id;
  return new_result_id;
end;
$$;
revoke all on function public.finalize_local_takeoff_result(uuid, uuid, uuid, timestamptz, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_local_takeoff_result(uuid, uuid, uuid, timestamptz, text, text, jsonb, jsonb, jsonb)
  to service_role;

-- Deployed workers keep claim_local_takeoff_job. This application's worker
-- claims only the status and attempt it decided on: a callback delayed between
-- its read and its claim can no longer start a provider call nobody asked for.
create function public.claim_observed_local_takeoff_job(
  p_job_id uuid, p_tenant_id uuid, p_host_id text, p_started_at timestamptz, p_lease_token uuid,
  p_lease_expires_at timestamptz, p_model text, p_prompt_version text,
  p_observed_status text, p_observed_retry_count integer
)
returns setof public.takeoff_jobs language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_observed_status is null or p_observed_status not in ('pending', 'failed') or p_observed_retry_count is null then
    raise exception 'TAKEOFF_LOCAL_CLAIM_INVALID' using errcode = '22023';
  end if;
  perform 1 from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id
    and j.status::text = p_observed_status and j.retry_count = p_observed_retry_count
  for update;
  if not found then return; end if;
  -- Planned per call: a session keeps working after a column joins the job row.
  return query execute 'select * from public.claim_local_takeoff_job($1, $2, $3, $4, $5, $6, $7, $8)'
    using p_job_id, p_tenant_id, p_host_id, p_started_at, p_lease_token, p_lease_expires_at, p_model, p_prompt_version;
end;
$$;
revoke all on function public.claim_observed_local_takeoff_job(uuid, uuid, text, timestamptz, uuid, timestamptz, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_observed_local_takeoff_job(uuid, uuid, text, timestamptz, uuid, timestamptz, text, text, text, integer)
  to service_role;

-- The failure, its retry decision and the replacement of the diagnostic share
-- the job lock and unexpired lease of finalize_local_takeoff_result: a worker
-- that resumes after recovery cannot erase the result of a later attempt.
create function public.record_local_takeoff_failure(
  p_job_id uuid, p_tenant_id uuid, p_lease_token uuid, p_failure jsonb,
  p_diagnostic jsonb default null, p_run_metrics jsonb default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  failure public.takeoff_jobs := jsonb_populate_record(null::public.takeoff_jobs, p_failure);
  diagnostic public.takeoff_results;
  diagnostic_id uuid;
  caller_lock_timeout text := current_setting('lock_timeout');
begin
  perform 1 from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id and j.status = 'processing'
    and j.execution_provider = 'chatgpt_local' and j.processing_lease_token = p_lease_token
  for update;
  if not found then return null; end if;

  if not exists (select 1 from public.takeoff_jobs j where j.id = p_job_id
      and j.processing_lease_expires_at > clock_timestamp()) then
    return null;
  end if;

  -- The diagnostic stays best effort, as it was: if it cannot be stored, the
  -- previous rows stay whole and the failure is still recorded. It never waits
  -- on a held row (lock_not_available) and a statement timeout inside it is
  -- trapped, so the retry-or-terminal decision below does not depend on it.
  perform set_config('lock_timeout', '2s', true);
  if p_diagnostic is not null then
    begin
      diagnostic := jsonb_populate_record(null::public.takeoff_results, p_diagnostic);
      delete from public.takeoff_run_metrics where job_id = p_job_id and tenant_id = p_tenant_id;
      delete from public.takeoff_items where job_id = p_job_id and tenant_id = p_tenant_id;
      delete from public.takeoff_results where job_id = p_job_id and tenant_id = p_tenant_id;
      insert into public.takeoff_results (tenant_id, job_id, extracted_json, warnings, tables, provider_meta, raw_response,
        token_count, cost_cents, duration_ms)
      values (p_tenant_id, p_job_id, diagnostic.extracted_json, diagnostic.warnings, diagnostic.tables, diagnostic.provider_meta,
        diagnostic.raw_response, diagnostic.token_count, diagnostic.cost_cents, diagnostic.duration_ms)
      returning id into diagnostic_id;
    exception when others or query_canceled then
      diagnostic_id := null;
      raise log 'takeoff.failure.diagnostic_persistence_failed job=% code=%', p_job_id, sqlstate;
    end;
  end if;

  if jsonb_typeof(p_run_metrics) = 'array' and jsonb_array_length(p_run_metrics) > 0 then
    begin
      insert into public.takeoff_run_metrics (
        tenant_id, job_id, result_id, level, provider, model, chunk_index, chunk_start_page, chunk_end_page,
        input_tokens, reasoning_tokens, output_tokens, total_tokens, cost_cents, duration_ms, timed_out,
        budget_exceeded, metadata
      )
      select p_tenant_id, p_job_id, diagnostic_id, m.level, m.provider, m.model, m.chunk_index,
        m.chunk_start_page, m.chunk_end_page, m.input_tokens, m.reasoning_tokens, m.output_tokens,
        m.total_tokens, m.cost_cents, m.duration_ms, m.timed_out, m.budget_exceeded, m.metadata
      from jsonb_populate_recordset(null::public.takeoff_run_metrics, p_run_metrics) m;
    exception when others or query_canceled then
      raise log 'takeoff.failure.metrics_persistence_failed job=% code=%', p_job_id, sqlstate;
    end;
  end if;
  perform set_config('lock_timeout', caller_lock_timeout, true);

  update public.takeoff_jobs set
    status = 'failed', completed_at = failure.completed_at, duration_ms = failure.duration_ms,
    error_code = failure.error_code, error_message = failure.error_message,
    analysis_outcome = failure.analysis_outcome, last_error_at = failure.last_error_at,
    next_retry_at = failure.next_retry_at,
    processing_lease_token = null, processing_lease_expires_at = null
  where id = p_job_id and tenant_id = p_tenant_id;
  return jsonb_build_object('diagnostic_id', diagnostic_id);
end;
$$;
revoke all on function public.record_local_takeoff_failure(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_local_takeoff_failure(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;

create function public.claim_takeoff_completion_email(p_id uuid default null)
returns setof public.takeoff_completion_notifications
language sql
set search_path = pg_catalog
as $$
  with due as (
    select id from public.takeoff_completion_notifications
    where delivery_state in ('pending', 'sending')
      and coalesce(next_attempt_at, lease_expires_at) <= statement_timestamp()
      and (p_id is null or id = p_id)
    order by coalesce(next_attempt_at, lease_expires_at), id
    limit 1 for update skip locked
  )
  update public.takeoff_completion_notifications n
  set delivery_state = 'sending', attempt_count = n.attempt_count + 1,
    next_attempt_at = null, lease_token = gen_random_uuid(),
    lease_expires_at = statement_timestamp() + interval '2 minutes'
  from due where n.id = due.id
  returning n.*;
$$;
revoke all on function public.claim_takeoff_completion_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_takeoff_completion_email(uuid) to service_role;

create function public.prepare_takeoff_completion_email(
  p_id uuid, p_lease_token uuid, p_routing_mode text, p_effective_email text, p_payload_hash text
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  n public.takeoff_completion_notifications;
  current_email text;
  blocked_code text;
  blocked_state text := 'unknown';
begin
  select * into n from public.takeoff_completion_notifications
    where id = p_id and delivery_state = 'sending' and lease_token = p_lease_token
      and lease_expires_at > clock_timestamp()
    for update;
  if not found or n.lease_expires_at <= clock_timestamp() then return false; end if;

  select nullif(trim(u.email), '') into current_email from auth.users u
    where u.id = n.recipient_user_id and u.email_confirmed_at is not null and u.deleted_at is null;
  if current_email is null or current_email is distinct from n.recipient_email
    or not private.takeoff_completion_recipient_can_read(n.tenant_id, n.project_id, n.recipient_user_id)
  then
    blocked_state := 'unavailable';
    blocked_code := 'RECIPIENT_UNAVAILABLE';
  elsif n.first_send_at <= clock_timestamp() - interval '23 hours' then
    blocked_code := 'IDEMPOTENCY_WINDOW_EXPIRED';
  elsif n.first_send_at is not null and (n.routing_mode, n.effective_email, n.payload_hash)
    is distinct from (p_routing_mode, p_effective_email, p_payload_hash)
  then
    blocked_code := 'DELIVERY_ROUTE_OR_PAYLOAD_CHANGED';
  end if;
  if blocked_code is not null then
    update public.takeoff_completion_notifications
    set delivery_state = blocked_state, last_delivery_code = blocked_code,
      lease_token = null, lease_expires_at = null
    where id = n.id;
    return false;
  end if;

  update public.takeoff_completion_notifications
  set first_send_at = coalesce(first_send_at, clock_timestamp()),
    routing_mode = p_routing_mode, effective_email = p_effective_email, payload_hash = p_payload_hash
  where id = n.id;
  return true;
end;
$$;
revoke all on function public.prepare_takeoff_completion_email(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_takeoff_completion_email(uuid, uuid, text, text, text) to service_role;

commit;
