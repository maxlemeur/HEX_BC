-- EST-E13 phase 0: lifecycle client DB foundations (portal tokens, estimate emails, negotiations).

create table if not exists public.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  email text not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  accepted_at timestamptz,
  accepted_ip inet,
  signature_url text,
  reject_reason text
);

alter table public.portal_tokens
  alter column tenant_id set default public.current_tenant_id();

create unique index if not exists portal_tokens_token_idx
  on public.portal_tokens (token);
create index if not exists portal_tokens_version_idx
  on public.portal_tokens (version_id);

create or replace function public.assign_portal_tokens_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_portal_tokens_tenant_id
  on public.portal_tokens;
create trigger set_portal_tokens_tenant_id
  before insert or update on public.portal_tokens
  for each row execute procedure public.assign_portal_tokens_tenant_id();

alter table public.portal_tokens enable row level security;

drop policy if exists "Tenant members can view portal tokens"
  on public.portal_tokens;
drop policy if exists "Tenant members can insert portal tokens"
  on public.portal_tokens;
drop policy if exists "Tenant members can update portal tokens"
  on public.portal_tokens;

create policy "Tenant members can view portal tokens"
  on public.portal_tokens
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can insert portal tokens"
  on public.portal_tokens
  for insert
  to authenticated
  with check ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can update portal tokens"
  on public.portal_tokens
  for update
  to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

create table if not exists public.estimate_emails (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  recipient text not null,
  cc text[],
  subject text not null,
  body text,
  type text not null default 'initial' check (
    type in ('initial', 'reminder_1', 'reminder_2', 'reminder_3', 'acceptance_confirmation')
  ),
  status text not null default 'sent' check (
    status in ('sent', 'failed', 'delivered', 'bounced')
  ),
  provider_id text,
  sent_at timestamptz default now()
);

alter table public.estimate_emails
  alter column tenant_id set default public.current_tenant_id();

create index if not exists estimate_emails_version_idx
  on public.estimate_emails (version_id);
create index if not exists estimate_emails_version_type_idx
  on public.estimate_emails (version_id, type);

create or replace function public.assign_estimate_emails_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_emails_tenant_id
  on public.estimate_emails;
create trigger set_estimate_emails_tenant_id
  before insert or update on public.estimate_emails
  for each row execute procedure public.assign_estimate_emails_tenant_id();

alter table public.estimate_emails enable row level security;

drop policy if exists "Tenant members can view estimate emails"
  on public.estimate_emails;
drop policy if exists "Tenant members can insert estimate emails"
  on public.estimate_emails;
drop policy if exists "Tenant members can update estimate emails"
  on public.estimate_emails;

create policy "Tenant members can view estimate emails"
  on public.estimate_emails
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can insert estimate emails"
  on public.estimate_emails
  for insert
  to authenticated
  with check ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can update estimate emails"
  on public.estimate_emails
  for update
  to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

create table if not exists public.estimate_negotiations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  author_type text not null check (author_type in ('client', 'engineer')),
  author_name text,
  message text not null,
  line_adjustments jsonb,
  portal_token_id uuid references public.portal_tokens(id)
);

alter table public.estimate_negotiations
  alter column tenant_id set default public.current_tenant_id();

create index if not exists estimate_negotiations_version_idx
  on public.estimate_negotiations (version_id);

create or replace function public.assign_estimate_negotiations_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  version_tenant_id uuid;
  token_tenant_id uuid;
  token_version_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into version_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if new.portal_token_id is not null then
    select pt.tenant_id, pt.version_id
      into token_tenant_id, token_version_id
    from public.portal_tokens pt
    where pt.id = new.portal_token_id;
  end if;

  if token_version_id is not null and new.version_id is distinct from token_version_id then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_NEGOTIATION_SCOPE_MISMATCH',
        detail = format(
          'portal_token_id=%s belongs to version_id=%s, got version_id=%s',
          new.portal_token_id,
          token_version_id,
          new.version_id
        );
  end if;

  if version_tenant_id is not null then
    new.tenant_id := version_tenant_id;
  elsif token_tenant_id is not null then
    new.tenant_id := token_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_negotiations_tenant_id
  on public.estimate_negotiations;
create trigger set_estimate_negotiations_tenant_id
  before insert or update on public.estimate_negotiations
  for each row execute procedure public.assign_estimate_negotiations_tenant_id();

alter table public.estimate_negotiations enable row level security;

drop policy if exists "Tenant members can view estimate negotiations"
  on public.estimate_negotiations;
drop policy if exists "Tenant members can insert estimate negotiations"
  on public.estimate_negotiations;
drop policy if exists "Tenant members can update estimate negotiations"
  on public.estimate_negotiations;

create policy "Tenant members can view estimate negotiations"
  on public.estimate_negotiations
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can insert estimate negotiations"
  on public.estimate_negotiations
  for insert
  to authenticated
  with check ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can update estimate negotiations"
  on public.estimate_negotiations
  for update
  to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

alter table public.estimate_version_events
  drop constraint if exists estimate_version_events_event_type_check;

alter table public.estimate_version_events
  add constraint estimate_version_events_event_type_check
  check (
    event_type in (
      'sent',
      'accepted',
      'archived',
      'rejected',
      'seal_verified',
      'reminder_sent'
    )
  );

create or replace function public.log_estimate_version_event(
  p_estimate_version_id uuid,
  p_event_type text,
  p_created_by uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns public.estimate_version_events
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant_id uuid;
  normalized_event_type text := lower(trim(coalesce(p_event_type, '')));
  inserted_row public.estimate_version_events;
begin
  if normalized_event_type = '' then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = 'event_type is required.';
  end if;

  if normalized_event_type not in (
    'sent',
    'accepted',
    'archived',
    'rejected',
    'seal_verified',
    'reminder_sent'
  ) then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = format('Unsupported event_type: %s', normalized_event_type);
  end if;

  select ev.tenant_id
    into target_tenant_id
  from public.estimate_versions ev
  where ev.id = p_estimate_version_id;

  if target_tenant_id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_VERSION_NOT_FOUND',
        detail = format('estimate_version_id=%s', p_estimate_version_id);
  end if;

  if p_created_by is not null
    and not exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = target_tenant_id
        and tm.user_id = p_created_by
    )
    and not exists (
      select 1
      from public.profiles profile
      where profile.id = p_created_by
        and profile.role = 'admin'
    ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_EVENT_ACTOR_NOT_ALLOWED',
        detail = format('created_by=%s is not allowed for tenant_id=%s', p_created_by, target_tenant_id);
  end if;

  insert into public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    event_type,
    metadata,
    created_by,
    occurred_at
  )
  values (
    target_tenant_id,
    p_estimate_version_id,
    normalized_event_type,
    coalesce(p_metadata, '{}'::jsonb),
    p_created_by,
    coalesce(p_occurred_at, now())
  )
  returning *
  into inserted_row;

  return inserted_row;
end;
$$;
