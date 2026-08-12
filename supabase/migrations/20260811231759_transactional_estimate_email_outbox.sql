-- Transactional outbox for the initial estimate email only.
--
-- `acceptance_confirmation` rows and the director-approval notification keep
-- their existing best-effort delivery paths in this sub-lot. Legacy rows have
-- request_id = null and are deliberately accepted by the compatibility guards
-- below; only request-scoped `initial` rows use the transactional contract.

alter table public.estimate_emails
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists request_id uuid,
  add column if not exists payload_hash text,
  add column if not exists provider_payload_hash text,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists version_content_revision bigint,
  add column if not exists from_address text,
  add column if not exists html_body text,
  add column if not exists text_body text,
  add column if not exists document_path text,
  add column if not exists document_sha256 text,
  add column if not exists attachment_filename text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists first_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;

alter table public.estimate_emails
  alter column sent_at drop default;

alter table public.estimate_emails
  drop constraint if exists estimate_emails_status_check;
alter table public.estimate_emails
  add constraint estimate_emails_status_check
  check (
    status in (
      'preparing',
      'queued',
      'processing',
      'sent',
      'failed',
      'unknown',
      'delivered',
      'bounced'
    )
  );

alter table public.estimate_emails
  drop constraint if exists estimate_emails_transactional_request_check;
alter table public.estimate_emails
  add constraint estimate_emails_transactional_request_check
  check (
    request_id is null
    or (
      type = 'initial'
      and payload_hash ~ '^[0-9a-f]{64}$'
      and idempotency_key is not null
      and length(trim(idempotency_key)) between 1 and 256
      and version_content_revision is not null
      and version_content_revision > 0
      and from_address is not null
      and length(trim(from_address)) > 0
    )
  );

alter table public.estimate_emails
  drop constraint if exists estimate_emails_document_sha256_check;
alter table public.estimate_emails
  add constraint estimate_emails_document_sha256_check
  check (
    document_sha256 is null
    or document_sha256 ~ '^[0-9a-f]{64}$'
  );

alter table public.estimate_emails
  drop constraint if exists estimate_emails_provider_payload_hash_check;
alter table public.estimate_emails
  add constraint estimate_emails_provider_payload_hash_check
  check (
    provider_payload_hash is null
    or provider_payload_hash ~ '^[0-9a-f]{64}$'
  );

alter table public.estimate_emails
  drop constraint if exists estimate_emails_attempt_count_check;
alter table public.estimate_emails
  add constraint estimate_emails_attempt_count_check
  check (attempt_count >= 0);

create unique index if not exists estimate_emails_tenant_request_uidx
  on public.estimate_emails (tenant_id, request_id)
  where request_id is not null;

create unique index if not exists estimate_emails_tenant_provider_idempotency_uidx
  on public.estimate_emails (tenant_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists estimate_emails_one_active_initial_uidx
  on public.estimate_emails (tenant_id, version_id, type)
  where type = 'initial'
    and status in ('preparing', 'queued', 'processing', 'unknown');

create index if not exists estimate_emails_dispatch_ready_idx
  on public.estimate_emails (status, next_attempt_at, created_at)
  where request_id is not null
    and status in ('queued', 'processing');

drop trigger if exists set_estimate_emails_updated_at
  on public.estimate_emails;
create trigger set_estimate_emails_updated_at
  before update on public.estimate_emails
  for each row execute function public.set_updated_at();

create table if not exists public.estimate_email_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  dispatch_id uuid not null references public.estimate_emails(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'reserved',
      'prepared',
      'claimed',
      'retry_scheduled',
      'sent',
      'failed',
      'unknown',
      'reconciled_sent',
      'reconciled_failed'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists estimate_email_dispatch_events_dispatch_idx
  on public.estimate_email_dispatch_events (dispatch_id, created_at, id);
create index if not exists estimate_email_dispatch_events_tenant_idx
  on public.estimate_email_dispatch_events (tenant_id, created_at desc);

create or replace function public.guard_estimate_email_dispatch_events_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only nested referential actions may alter the append-only journal.
  -- Direct service-role UPDATE/DELETE remains forbidden.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;

    if tg_op = 'UPDATE'
      and old.created_by is not null
      and new.created_by is null
      and (to_jsonb(new) - 'created_by') is not distinct from
        (to_jsonb(old) - 'created_by')
    then
      return new;
    end if;
  end if;

  raise exception
    using
      errcode = '42501',
      message = 'ESTIMATE_EMAIL_DISPATCH_EVENTS_APPEND_ONLY';
end;
$$;

revoke execute on function public.guard_estimate_email_dispatch_events_append_only()
  from public, anon, authenticated;

drop trigger if exists guard_estimate_email_dispatch_events_append_only
  on public.estimate_email_dispatch_events;
create trigger guard_estimate_email_dispatch_events_append_only
  before update or delete on public.estimate_email_dispatch_events
  for each row execute function public.guard_estimate_email_dispatch_events_append_only();

alter table public.estimate_email_dispatch_events enable row level security;
alter table public.estimate_email_dispatch_events force row level security;

drop policy if exists "Tenant members can view estimate email dispatch events"
  on public.estimate_email_dispatch_events;
create policy "Tenant members can view estimate email dispatch events"
  on public.estimate_email_dispatch_events
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

revoke all on table public.estimate_email_dispatch_events
  from public, anon, authenticated;
grant select on table public.estimate_email_dispatch_events to authenticated;
-- Preserve the repository-wide service-role relation contract. UPDATE/DELETE
-- still fail closed through the append-only trigger above.
grant select, insert, update, delete
  on table public.estimate_email_dispatch_events
  to service_role;

drop policy if exists "Tenant members can insert estimate emails"
  on public.estimate_emails;
drop policy if exists "Tenant members can update estimate emails"
  on public.estimate_emails;
revoke insert, update, delete on table public.estimate_emails
  from public, anon, authenticated;
grant select on table public.estimate_emails to authenticated;
grant select, insert, update on table public.estimate_emails to service_role;
alter table public.estimate_emails force row level security;

create or replace function public.guard_estimate_email_dispatch_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Compatibility path for acceptance_confirmation and all historical rows.
  if old.request_id is null and new.request_id is null then
    return new;
  end if;

  if old.request_id is null or new.request_id is null then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_REQUEST_ID_IMMUTABLE';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.version_id is distinct from old.version_id
    or new.request_id is distinct from old.request_id
    or new.payload_hash is distinct from old.payload_hash
    or new.idempotency_key is distinct from old.idempotency_key
    or new.version_content_revision is distinct from old.version_content_revision
    or new.from_address is distinct from old.from_address
    or new.recipient is distinct from old.recipient
    or new.cc is distinct from old.cc
    or new.subject is distinct from old.subject
    or new.body is distinct from old.body
    or new.type is distinct from old.type
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_ENVELOPE_IMMUTABLE';
  end if;

  if (
    new.provider_payload_hash is distinct from old.provider_payload_hash
    or new.html_body is distinct from old.html_body
    or new.text_body is distinct from old.text_body
    or new.document_path is distinct from old.document_path
    or new.document_sha256 is distinct from old.document_sha256
    or new.attachment_filename is distinct from old.attachment_filename
  ) and not (old.status = 'preparing' and new.status = 'queued') then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_PAYLOAD_IMMUTABLE';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'preparing' and new.status in ('queued', 'failed'))
    or (old.status = 'queued' and new.status in ('processing', 'failed', 'unknown'))
    or (old.status = 'processing' and new.status in ('queued', 'sent', 'failed', 'unknown'))
    or (old.status = 'unknown' and new.status in ('sent', 'failed'))
    or (old.status = 'failed' and new.status = 'preparing')
    or (old.status = 'sent' and new.status in ('delivered', 'bounced'))
  ) then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_STATUS_TRANSITION_INVALID';
  end if;

  if new.attempt_count < old.attempt_count then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_ATTEMPT_COUNT_DECREASED';
  end if;

  if old.provider_id is not null and new.provider_id is distinct from old.provider_id then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_PROVIDER_ID_IMMUTABLE';
  end if;

  if new.request_id is not null and new.status in ('sent', 'delivered', 'bounced')
    and (new.provider_id is null or new.sent_at is null)
  then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_SENT_PROOF_REQUIRED';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_estimate_email_dispatch_mutation()
  from public, anon, authenticated;

drop trigger if exists guard_estimate_email_dispatch_mutation
  on public.estimate_emails;
create trigger guard_estimate_email_dispatch_mutation
  before update on public.estimate_emails
  for each row execute function public.guard_estimate_email_dispatch_mutation();

-- Allow the outbox to freeze a draft before PDF rendering, then either seal
-- and send it or explicitly release it back to draft when no provider side
-- effect occurred.
create or replace function public.validate_estimate_version_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status in ('sending', 'sent'))
      or (old.status = 'sending' and new.status in ('draft', 'sent'))
      or (old.status = 'sent' and new.status in ('accepted', 'archived'))
      or (old.status = 'accepted' and new.status = 'archived')
    ) then
      raise exception 'Invalid estimate status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if old.status = 'draft' and new.status = 'sending' then
    if new.seal_hash is not null then
      raise exception 'seal_hash must be null when moving draft -> sending';
    end if;
  elsif old.status = 'sending' and new.status = 'sending' then
    if old.seal_hash is not null
      or new.seal_hash is null
      or new.seal_hash !~ '^[0-9a-fA-F]{64}$'
    then
      raise exception 'seal_hash can only be set once while preparing an email';
    end if;
  elsif old.status = 'sending' and new.status = 'sent' then
    if old.seal_hash is null
      or old.seal_hash !~ '^[0-9a-fA-F]{64}$'
      or new.seal_hash is distinct from old.seal_hash
    then
      raise exception 'a stable seal_hash is required when moving sending -> sent';
    end if;
  elsif old.status = 'sending' and new.status = 'draft' then
    if new.seal_hash is not null then
      raise exception 'seal_hash must be cleared when moving sending -> draft';
    end if;
  elsif old.status = 'draft' and new.status = 'sent' then
    if new.seal_hash is null or new.seal_hash !~ '^[0-9a-fA-F]{64}$' then
      raise exception 'seal_hash must be a 64-character hex string when moving draft -> sent';
    end if;
  elsif new.seal_hash is distinct from old.seal_hash then
    raise exception 'seal_hash is immutable outside estimate send transitions';
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if (
      to_jsonb(new) - array['status', 'seal_hash', 'updated_at']
    ) is distinct from (
      to_jsonb(old) - array['status', 'seal_hash', 'updated_at']
    ) then
      raise exception 'Estimate version is read-only';
    end if;

    if old.status = 'sending' then
      if new.status = old.status and not (
        old.seal_hash is null
        and new.seal_hash is not null
        and new.seal_hash ~ '^[0-9a-fA-F]{64}$'
      ) then
        raise exception 'Estimate version is read-only';
      end if;
    else
      if new.status = old.status or new.seal_hash is distinct from old.seal_hash then
        raise exception 'Estimate version is read-only';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.assert_estimate_email_dispatch_actor(
  p_tenant_id uuid,
  p_version_id uuid,
  p_actor_user_id uuid,
  p_admin_only boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_actor_user_id is null or not exists (
    select 1
    from public.estimate_versions version
    join public.estimate_projects project
      on project.id = version.project_id
     and project.tenant_id = version.tenant_id
    join public.tenants tenant
      on tenant.id = version.tenant_id
     and tenant.is_active
    join public.tenant_memberships membership
      on membership.tenant_id = version.tenant_id
     and membership.user_id = p_actor_user_id
    where version.id = p_version_id
      and version.tenant_id = p_tenant_id
      and (
        (p_admin_only and membership.role = 'admin'::public.tenant_role)
        or (
          not p_admin_only
          and membership.role in (
            'admin'::public.tenant_role,
            'engineer'::public.tenant_role
          )
          and (
            project.user_id = p_actor_user_id
            or membership.role = 'admin'::public.tenant_role
          )
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN';
  end if;
end;
$$;

revoke execute on function public.assert_estimate_email_dispatch_actor(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.assert_estimate_email_dispatch_actor(uuid, uuid, uuid, boolean)
  to service_role;

create or replace function public.reserve_estimate_email_dispatch(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_payload_hash text,
  p_recipient text,
  p_cc text[],
  p_subject text,
  p_body text,
  p_from_address text
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  existing_dispatch public.estimate_emails%rowtype;
  reserved_dispatch public.estimate_emails%rowtype;
  dispatch_id uuid := gen_random_uuid();
  existing_payload_is_frozen boolean := false;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_request_id is null
    or p_payload_hash is null
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or length(trim(coalesce(p_recipient, ''))) = 0
    or length(trim(coalesce(p_subject, ''))) = 0
    or length(trim(coalesce(p_body, ''))) = 0
    or length(trim(coalesce(p_from_address, ''))) = 0
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_DISPATCH_INPUT_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  join public.tenants tenant
    on tenant.id = version.tenant_id
   and tenant.is_active
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  perform public.assert_estimate_email_dispatch_actor(
    p_tenant_id,
    p_version_id,
    p_actor_user_id,
    false
  );

  if target_version.status in (
    'sending'::public.estimate_status,
    'sent'::public.estimate_status
  ) then
    select dispatch.*
      into existing_dispatch
    from public.estimate_emails dispatch
    where dispatch.tenant_id = p_tenant_id
      and dispatch.version_id = p_version_id
      and dispatch.type = 'initial'
      and dispatch.status in ('preparing', 'queued', 'processing', 'unknown')
    for update;

    if existing_dispatch.id is not null then
      if existing_dispatch.payload_hash is distinct from p_payload_hash
        or existing_dispatch.created_by is distinct from p_actor_user_id
      then
        raise exception using errcode = '23505', message = 'ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT';
      end if;

      -- The active database envelope is authoritative after a reload. A fresh
      -- HTTP request/key may resume it only when the immutable payload is the
      -- same; no field or provider idempotency key is replaced here.
      return existing_dispatch;
    end if;
  end if;

  select dispatch.*
    into existing_dispatch
  from public.estimate_emails dispatch
  where dispatch.tenant_id = p_tenant_id
    and dispatch.request_id = p_request_id
  for update;

  if existing_dispatch.id is not null then
    if existing_dispatch.version_id is distinct from p_version_id
      or existing_dispatch.payload_hash is distinct from p_payload_hash
      or existing_dispatch.created_by is distinct from p_actor_user_id
    then
      raise exception using errcode = '23505', message = 'ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT';
    end if;

    if existing_dispatch.status <> 'failed' then
      return existing_dispatch;
    end if;

    existing_payload_is_frozen :=
      existing_dispatch.provider_payload_hash is not null
      and existing_dispatch.provider_payload_hash ~ '^[0-9a-f]{64}$'
      and length(coalesce(existing_dispatch.html_body, '')) > 0
      and length(coalesce(existing_dispatch.text_body, '')) > 0
      and length(trim(coalesce(existing_dispatch.document_path, ''))) > 0
      and existing_dispatch.document_sha256 is not null
      and existing_dispatch.document_sha256 ~ '^[0-9a-f]{64}$'
      and length(trim(coalesce(existing_dispatch.attachment_filename, ''))) > 0;

    if existing_payload_is_frozen then
      raise exception using
        errcode = '23505',
        message = 'ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST';
    end if;

    if target_version.status not in (
      'draft'::public.estimate_status,
      'sent'::public.estimate_status
    ) then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RETRY_STATE_CONFLICT';
    end if;

    if target_version.updated_at is distinct from p_expected_updated_at
      or target_version.content_revision is distinct from existing_dispatch.version_content_revision
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_VERSION_CONFLICT';
    end if;

    if target_version.status = 'draft'::public.estimate_status then
      if not exists (
        select 1
        from public.draft_locks lock
        where lock.version_id = target_version.id
          and lock.tenant_id = target_version.tenant_id
          and lock.user_id = p_actor_user_id
          and lock.expires_at > now()
      ) then
        raise exception using errcode = '40001', message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
      end if;

      update public.estimate_versions version
      set status = 'sending'::public.estimate_status
      where version.id = target_version.id
        and version.tenant_id = target_version.tenant_id;
    elsif target_version.seal_hash is null
      or target_version.seal_hash !~ '^[0-9a-fA-F]{64}$'
    then
      raise exception using errcode = '23514', message = 'ESTIMATE_SEAL_INVALID';
    end if;

    update public.estimate_emails dispatch
    set
      status = 'preparing',
      last_error_code = null,
      last_error_message = null,
      next_attempt_at = null,
      lease_token = null,
      lease_expires_at = null
    where dispatch.id = existing_dispatch.id
    returning dispatch.* into reserved_dispatch;

    insert into public.estimate_email_dispatch_events (
      tenant_id,
      version_id,
      dispatch_id,
      event_type,
      metadata,
      created_by
    ) values (
      reserved_dispatch.tenant_id,
      reserved_dispatch.version_id,
      reserved_dispatch.id,
      'reserved',
      jsonb_build_object('retry', true),
      p_actor_user_id
    );

    return reserved_dispatch;
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status not in (
    'draft'::public.estimate_status,
    'sent'::public.estimate_status
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_STATUS_FORBIDDEN';
  end if;

  if target_version.status = 'draft'::public.estimate_status then
    if not exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id = p_actor_user_id
        and lock.expires_at > now()
    ) then
      raise exception using errcode = '40001', message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
    end if;

    update public.estimate_versions version
    set status = 'sending'::public.estimate_status
    where version.id = target_version.id
      and version.tenant_id = target_version.tenant_id;
  elsif target_version.seal_hash is null
    or target_version.seal_hash !~ '^[0-9a-fA-F]{64}$'
  then
    raise exception using errcode = '23514', message = 'ESTIMATE_SEAL_INVALID';
  end if;

  insert into public.estimate_emails (
    id,
    tenant_id,
    version_id,
    recipient,
    cc,
    subject,
    body,
    type,
    status,
    sent_at,
    request_id,
    payload_hash,
    idempotency_key,
    created_by,
    version_content_revision,
    from_address
  ) values (
    dispatch_id,
    p_tenant_id,
    p_version_id,
    trim(p_recipient),
    p_cc,
    trim(p_subject),
    p_body,
    'initial',
    'preparing',
    null,
    p_request_id,
    p_payload_hash,
    'estimate-email/' || dispatch_id::text,
    p_actor_user_id,
    target_version.content_revision,
    trim(p_from_address)
  )
  returning * into reserved_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    reserved_dispatch.tenant_id,
    reserved_dispatch.version_id,
    reserved_dispatch.id,
    'reserved',
    jsonb_build_object(
      'request_id', p_request_id,
      'version_status', target_version.status
    ),
    p_actor_user_id
  );

  return reserved_dispatch;
end;
$$;

revoke execute on function public.reserve_estimate_email_dispatch(
  uuid,
  uuid,
  timestamptz,
  uuid,
  uuid,
  text,
  text,
  text[],
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.reserve_estimate_email_dispatch(
  uuid,
  uuid,
  timestamptz,
  uuid,
  uuid,
  text,
  text,
  text[],
  text,
  text,
  text
) to service_role;

create or replace function public.prepare_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_seal_hash text,
  p_provider_payload_hash text,
  p_html_body text,
  p_text_body text,
  p_document_path text,
  p_document_sha256 text,
  p_attachment_filename text
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  target_version public.estimate_versions%rowtype;
  prepared_dispatch public.estimate_emails%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_seal_hash is null or p_seal_hash !~ '^[0-9a-f]{64}$'
    or p_provider_payload_hash is null or p_provider_payload_hash !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_html_body, '')) = 0
    or length(coalesce(p_text_body, '')) = 0
    or length(trim(coalesce(p_document_path, ''))) = 0
    or p_document_sha256 is null or p_document_sha256 !~ '^[0-9a-f]{64}$'
    or length(trim(coalesce(p_attachment_filename, ''))) = 0
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_PREPARED_PAYLOAD_INVALID';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  perform public.assert_estimate_email_dispatch_actor(
    target_dispatch.tenant_id,
    target_dispatch.version_id,
    p_actor_user_id,
    false
  );

  if target_dispatch.status <> 'preparing' then
    if target_dispatch.status in ('queued', 'processing', 'sent')
      and target_dispatch.provider_payload_hash is not distinct from p_provider_payload_hash
      and target_dispatch.document_sha256 is not distinct from p_document_sha256
    then
      return target_dispatch;
    end if;
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_PREPARE_STATE_CONFLICT';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = target_dispatch.version_id
    and version.tenant_id = target_dispatch.tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  if target_version.status = 'sending'::public.estimate_status then
    if target_version.seal_hash is not null
      and lower(target_version.seal_hash) <> p_seal_hash
    then
      raise exception using errcode = '23514', message = 'ESTIMATE_SEAL_MISMATCH';
    end if;

    if target_version.seal_hash is null then
      update public.estimate_versions version
      set seal_hash = p_seal_hash
      where version.id = target_version.id
        and version.tenant_id = target_version.tenant_id;
    end if;
  elsif target_version.status in (
    'sent'::public.estimate_status,
    'accepted'::public.estimate_status,
    'archived'::public.estimate_status
  ) then
    if lower(coalesce(target_version.seal_hash, '')) <> p_seal_hash then
      raise exception using errcode = '23514', message = 'ESTIMATE_SEAL_MISMATCH';
    end if;
  else
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_PREPARE_VERSION_STATE_CONFLICT';
  end if;

  update public.estimate_emails dispatch
  set
    status = 'queued',
    provider_payload_hash = p_provider_payload_hash,
    html_body = p_html_body,
    text_body = p_text_body,
    document_path = trim(p_document_path),
    document_sha256 = p_document_sha256,
    attachment_filename = trim(p_attachment_filename),
    next_attempt_at = now(),
    last_error_code = null,
    last_error_message = null
  where dispatch.id = target_dispatch.id
  returning dispatch.* into prepared_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    prepared_dispatch.tenant_id,
    prepared_dispatch.version_id,
    prepared_dispatch.id,
    'prepared',
    jsonb_build_object(
      'document_path', prepared_dispatch.document_path,
      'document_sha256', prepared_dispatch.document_sha256,
      'provider_payload_hash', prepared_dispatch.provider_payload_hash
    ),
    p_actor_user_id
  );

  return prepared_dispatch;
end;
$$;

revoke execute on function public.prepare_estimate_email_dispatch(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.prepare_estimate_email_dispatch(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;

create or replace function public.claim_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  claimed_dispatch public.estimate_emails%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_lease_token is null or p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_LEASE_INVALID';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  perform public.assert_estimate_email_dispatch_actor(
    target_dispatch.tenant_id,
    target_dispatch.version_id,
    p_actor_user_id,
    false
  );

  if target_dispatch.status in ('sent', 'delivered', 'bounced', 'unknown') then
    return target_dispatch;
  end if;

  if target_dispatch.first_attempt_at is not null
    and target_dispatch.first_attempt_at <= now() - interval '23 hours'
  then
    update public.estimate_emails dispatch
    set
      status = 'unknown',
      lease_token = null,
      lease_expires_at = null,
      next_attempt_at = null,
      last_error_code = 'IDEMPOTENCY_WINDOW_EXPIRED',
      last_error_message = 'Automatic resend blocked after the 23-hour safety cutoff.'
    where dispatch.id = target_dispatch.id
    returning dispatch.* into claimed_dispatch;

    insert into public.estimate_email_dispatch_events (
      tenant_id,
      version_id,
      dispatch_id,
      event_type,
      metadata,
      created_by
    ) values (
      claimed_dispatch.tenant_id,
      claimed_dispatch.version_id,
      claimed_dispatch.id,
      'unknown',
      jsonb_build_object('reason', 'idempotency_window_expired'),
      p_actor_user_id
    );

    return claimed_dispatch;
  end if;

  if target_dispatch.status = 'processing'
    and target_dispatch.lease_expires_at > now()
  then
    if target_dispatch.lease_token = p_lease_token then
      return target_dispatch;
    end if;
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_DISPATCH_LEASED';
  end if;

  if target_dispatch.status not in ('queued', 'processing') then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_CLAIM_STATE_CONFLICT';
  end if;

  if target_dispatch.provider_payload_hash is null
    or target_dispatch.html_body is null
    or target_dispatch.text_body is null
    or target_dispatch.document_path is null
    or target_dispatch.document_sha256 is null
    or target_dispatch.attachment_filename is null
  then
    raise exception using errcode = '23514', message = 'ESTIMATE_EMAIL_PAYLOAD_NOT_PREPARED';
  end if;

  update public.estimate_emails dispatch
  set
    status = 'processing',
    attempt_count = dispatch.attempt_count + 1,
    first_attempt_at = coalesce(dispatch.first_attempt_at, now()),
    last_attempt_at = now(),
    next_attempt_at = null,
    lease_token = p_lease_token,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    last_error_message = null
  where dispatch.id = target_dispatch.id
  returning dispatch.* into claimed_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    claimed_dispatch.tenant_id,
    claimed_dispatch.version_id,
    claimed_dispatch.id,
    'claimed',
    jsonb_build_object(
      'attempt_count', claimed_dispatch.attempt_count,
      'lease_expires_at', claimed_dispatch.lease_expires_at
    ),
    p_actor_user_id
  );

  return claimed_dispatch;
end;
$$;

revoke execute on function public.claim_estimate_email_dispatch(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_estimate_email_dispatch(uuid, uuid, uuid, uuid, integer)
  to service_role;

create or replace function public.complete_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_provider_id text,
  p_sent_at timestamptz default now()
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  target_version public.estimate_versions%rowtype;
  completed_dispatch public.estimate_emails%rowtype;
  previous_version_status public.estimate_status;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if length(trim(coalesce(p_provider_id, ''))) = 0 then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_PROVIDER_ID_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  if target_dispatch.status in ('sent', 'delivered', 'bounced') then
    if target_dispatch.provider_id is distinct from trim(p_provider_id) then
      raise exception using errcode = '23505', message = 'ESTIMATE_EMAIL_PROVIDER_ID_CONFLICT';
    end if;
    return target_dispatch;
  end if;

  if target_dispatch.status <> 'processing'
    or target_dispatch.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_COMPLETION_LEASE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = target_dispatch.version_id
    and version.tenant_id = target_dispatch.tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  previous_version_status := target_version.status;
  if target_version.status = 'sending'::public.estimate_status then
    update public.estimate_versions version
    set status = 'sent'::public.estimate_status
    where version.id = target_version.id
      and version.tenant_id = target_version.tenant_id;
  elsif target_version.status not in (
    'sent'::public.estimate_status,
    'accepted'::public.estimate_status,
    'archived'::public.estimate_status
  ) then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_COMPLETION_VERSION_STATE_CONFLICT';
  end if;

  update public.estimate_emails dispatch
  set
    status = 'sent',
    provider_id = trim(p_provider_id),
    sent_at = coalesce(p_sent_at, now()),
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_code = null,
    last_error_message = null
  where dispatch.id = target_dispatch.id
  returning dispatch.* into completed_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    completed_dispatch.tenant_id,
    completed_dispatch.version_id,
    completed_dispatch.id,
    'sent',
    jsonb_build_object(
      'provider_id', completed_dispatch.provider_id,
      'attempt_count', completed_dispatch.attempt_count,
      'previous_version_status', previous_version_status
    ),
    target_dispatch.created_by
  );

  insert into public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    event_type,
    metadata,
    created_by,
    occurred_at
  ) values (
    completed_dispatch.tenant_id,
    completed_dispatch.version_id,
    'sent',
    jsonb_build_object(
      'dispatch_id', completed_dispatch.id,
      'provider_id', completed_dispatch.provider_id,
      'previous_status', previous_version_status,
      'next_status', case
        when previous_version_status = 'sending'::public.estimate_status then 'sent'
        else previous_version_status::text
      end,
      'resend', previous_version_status <> 'sending'::public.estimate_status
    ),
    target_dispatch.created_by,
    completed_dispatch.sent_at
  );

  return completed_dispatch;
end;
$$;

revoke execute on function public.complete_estimate_email_dispatch(uuid, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_estimate_email_dispatch(uuid, uuid, uuid, uuid, text, timestamptz)
  to service_role;

create or replace function public.fail_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  target_version public.estimate_versions%rowtype;
  failed_dispatch public.estimate_emails%rowtype;
  payload_is_frozen boolean := false;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  if target_dispatch.status = 'failed' then
    return target_dispatch;
  end if;

  if target_dispatch.status = 'preparing' then
    if p_lease_token is not null then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_FAILURE_STATE_CONFLICT';
    end if;

    perform public.assert_estimate_email_dispatch_actor(
      target_dispatch.tenant_id,
      target_dispatch.version_id,
      p_actor_user_id,
      false
    );
  elsif target_dispatch.status = 'processing' then
    if p_lease_token is null
      or target_dispatch.lease_token is distinct from p_lease_token
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_FAILURE_STATE_CONFLICT';
    end if;
  else
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_FAILURE_STATE_CONFLICT';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = target_dispatch.version_id
    and version.tenant_id = target_dispatch.tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  payload_is_frozen :=
    target_dispatch.provider_payload_hash is not null
    and target_dispatch.provider_payload_hash ~ '^[0-9a-f]{64}$'
    and length(coalesce(target_dispatch.html_body, '')) > 0
    and length(coalesce(target_dispatch.text_body, '')) > 0
    and length(trim(coalesce(target_dispatch.document_path, ''))) > 0
    and target_dispatch.document_sha256 is not null
    and target_dispatch.document_sha256 ~ '^[0-9a-f]{64}$'
    and length(trim(coalesce(target_dispatch.attachment_filename, ''))) > 0;

  if target_version.status = 'sending'::public.estimate_status then
    update public.estimate_versions version
    set
      status = 'draft'::public.estimate_status,
      seal_hash = null
    where version.id = target_version.id
      and version.tenant_id = target_version.tenant_id;
  elsif target_version.status not in (
    'sent'::public.estimate_status,
    'accepted'::public.estimate_status,
    'archived'::public.estimate_status
  ) then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_FAILURE_VERSION_STATE_CONFLICT';
  end if;

  update public.estimate_emails dispatch
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_code = left(coalesce(p_error_code, 'EMAIL_DISPATCH_FAILED'), 200),
    last_error_message = left(coalesce(p_error_message, 'Email dispatch failed.'), 2000)
  where dispatch.id = target_dispatch.id
  returning dispatch.* into failed_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    failed_dispatch.tenant_id,
    failed_dispatch.version_id,
    failed_dispatch.id,
    'failed',
    jsonb_build_object(
      'error_code', failed_dispatch.last_error_code,
      'attempt_count', failed_dispatch.attempt_count,
      'version_released_to_draft',
        target_version.status = 'sending'::public.estimate_status,
      'payload_frozen', payload_is_frozen
    ),
    target_dispatch.created_by
  );

  return failed_dispatch;
end;
$$;

revoke execute on function public.fail_estimate_email_dispatch(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_estimate_email_dispatch(uuid, uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.defer_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  deferred_dispatch public.estimate_emails%rowtype;
  cutoff_reached boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  if target_dispatch.status <> 'processing'
    or target_dispatch.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_DEFER_LEASE_INVALID';
  end if;

  cutoff_reached := target_dispatch.first_attempt_at is not null
    and target_dispatch.first_attempt_at <= now() - interval '23 hours';

  update public.estimate_emails dispatch
  set
    status = case when cutoff_reached then 'unknown' else 'queued' end,
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = case when cutoff_reached then null else now() end,
    last_error_code = left(coalesce(p_error_code, 'EMAIL_PROVIDER_UNAVAILABLE'), 200),
    last_error_message = left(coalesce(p_error_message, 'Email provider outcome is not confirmed.'), 2000)
  where dispatch.id = target_dispatch.id
  returning dispatch.* into deferred_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    deferred_dispatch.tenant_id,
    deferred_dispatch.version_id,
    deferred_dispatch.id,
    case when cutoff_reached then 'unknown' else 'retry_scheduled' end,
    jsonb_build_object(
      'error_code', deferred_dispatch.last_error_code,
      'attempt_count', deferred_dispatch.attempt_count,
      'cutoff_reached', cutoff_reached
    ),
    target_dispatch.created_by
  );

  return deferred_dispatch;
end;
$$;

revoke execute on function public.defer_estimate_email_dispatch(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.defer_estimate_email_dispatch(uuid, uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.mark_estimate_email_dispatch_unknown(
  p_dispatch_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  unknown_dispatch public.estimate_emails%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.tenant_id = p_tenant_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  if target_dispatch.status = 'unknown' then
    return target_dispatch;
  end if;

  if target_dispatch.status <> 'processing'
    or target_dispatch.lease_token is distinct from p_lease_token
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_UNKNOWN_STATE_CONFLICT';
  end if;

  update public.estimate_emails dispatch
  set
    status = 'unknown',
    lease_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    last_error_code = left(coalesce(p_error_code, 'EMAIL_DELIVERY_UNKNOWN'), 200),
    last_error_message = left(coalesce(p_error_message, 'Email provider outcome requires reconciliation.'), 2000)
  where dispatch.id = target_dispatch.id
  returning dispatch.* into unknown_dispatch;

  insert into public.estimate_email_dispatch_events (
    tenant_id,
    version_id,
    dispatch_id,
    event_type,
    metadata,
    created_by
  ) values (
    unknown_dispatch.tenant_id,
    unknown_dispatch.version_id,
    unknown_dispatch.id,
    'unknown',
    jsonb_build_object(
      'error_code', unknown_dispatch.last_error_code,
      'attempt_count', unknown_dispatch.attempt_count
    ),
    target_dispatch.created_by
  );

  return unknown_dispatch;
end;
$$;

revoke execute on function public.mark_estimate_email_dispatch_unknown(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_estimate_email_dispatch_unknown(uuid, uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.reconcile_estimate_email_dispatch(
  p_dispatch_id uuid,
  p_resolution text,
  p_actor_user_id uuid,
  p_provider_id text default null,
  p_note text default null
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_dispatch public.estimate_emails%rowtype;
  target_version public.estimate_versions%rowtype;
  reconciled_dispatch public.estimate_emails%rowtype;
  normalized_resolution text := lower(trim(coalesce(p_resolution, '')));
  reconciliation_time timestamptz := now();
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if normalized_resolution not in ('sent', 'failed') then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_RECONCILIATION_INVALID';
  end if;

  if normalized_resolution = 'sent'
    and length(trim(coalesce(p_provider_id, ''))) = 0
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_PROVIDER_ID_REQUIRED';
  end if;

  select dispatch.*
    into target_dispatch
  from public.estimate_emails dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.request_id is not null
  for update;

  if target_dispatch.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DISPATCH_NOT_FOUND';
  end if;

  perform public.assert_estimate_email_dispatch_actor(
    target_dispatch.tenant_id,
    target_dispatch.version_id,
    p_actor_user_id,
    true
  );

  if target_dispatch.status <> 'unknown' then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RECONCILIATION_STATE_CONFLICT';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = target_dispatch.version_id
    and version.tenant_id = target_dispatch.tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  if normalized_resolution = 'sent' then
    if target_version.status = 'sending'::public.estimate_status then
      update public.estimate_versions version
      set status = 'sent'::public.estimate_status
      where version.id = target_version.id
        and version.tenant_id = target_version.tenant_id;
    elsif target_version.status not in (
      'sent'::public.estimate_status,
      'accepted'::public.estimate_status,
      'archived'::public.estimate_status
    ) then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RECONCILIATION_VERSION_STATE_CONFLICT';
    end if;

    update public.estimate_emails dispatch
    set
      status = 'sent',
      provider_id = trim(p_provider_id),
      sent_at = reconciliation_time,
      last_error_code = null,
      last_error_message = null
    where dispatch.id = target_dispatch.id
    returning dispatch.* into reconciled_dispatch;

    insert into public.estimate_email_dispatch_events (
      tenant_id,
      version_id,
      dispatch_id,
      event_type,
      metadata,
      created_by
    ) values (
      reconciled_dispatch.tenant_id,
      reconciled_dispatch.version_id,
      reconciled_dispatch.id,
      'reconciled_sent',
      jsonb_build_object(
        'provider_id', reconciled_dispatch.provider_id,
        'note', p_note,
        'previous_version_status', target_version.status
      ),
      p_actor_user_id
    );

    perform public.log_estimate_version_event(
      reconciled_dispatch.version_id,
      'sent',
      p_actor_user_id,
      jsonb_build_object(
        'dispatch_id', reconciled_dispatch.id,
        'provider_id', reconciled_dispatch.provider_id,
        'reconciled', true,
        'previous_status', target_version.status,
        'next_status', case
          when target_version.status = 'sending'::public.estimate_status then 'sent'
          else target_version.status::text
        end
      ),
      reconciliation_time
    );
  else
    if target_version.status = 'sending'::public.estimate_status then
      update public.estimate_versions version
      set
        status = 'draft'::public.estimate_status,
        seal_hash = null
      where version.id = target_version.id
        and version.tenant_id = target_version.tenant_id;
    elsif target_version.status not in (
      'sent'::public.estimate_status,
      'accepted'::public.estimate_status,
      'archived'::public.estimate_status
    ) then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_RECONCILIATION_VERSION_STATE_CONFLICT';
    end if;

    update public.estimate_emails dispatch
    set
      status = 'failed',
      last_error_code = 'RECONCILED_FAILED',
      last_error_message = left(coalesce(p_note, 'Provider delivery was not confirmed.'), 2000)
    where dispatch.id = target_dispatch.id
    returning dispatch.* into reconciled_dispatch;

    insert into public.estimate_email_dispatch_events (
      tenant_id,
      version_id,
      dispatch_id,
      event_type,
      metadata,
      created_by
    ) values (
      reconciled_dispatch.tenant_id,
      reconciled_dispatch.version_id,
      reconciled_dispatch.id,
      'reconciled_failed',
      jsonb_build_object(
        'note', p_note,
        'version_released_to_draft', target_version.status = 'sending'::public.estimate_status
      ),
      p_actor_user_id
    );
  end if;

  return reconciled_dispatch;
end;
$$;

revoke execute on function public.reconcile_estimate_email_dispatch(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_estimate_email_dispatch(uuid, text, uuid, text, text)
  to service_role;

comment on function public.reconcile_estimate_email_dispatch(uuid, text, uuid, text, text)
  is 'Service-role-only manual resolution of an unknown initial estimate email dispatch. Operations UI is intentionally outside this sub-lot.';
