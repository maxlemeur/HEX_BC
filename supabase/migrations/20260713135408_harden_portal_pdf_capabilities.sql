-- Bind portal capabilities and PDF metadata to their authoritative parent rows.

create or replace function public.assign_portal_tokens_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_op = 'UPDATE'
    and (
      new.version_id is distinct from old.version_id
      or new.tenant_id is distinct from old.tenant_id
    ) then
    raise exception using
      errcode = '42501',
      message = 'portal capability parent is immutable';
  end if;

  select ev.tenant_id
    into parent_tenant_id
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if parent_tenant_id is null then
    raise exception using
      errcode = '23503',
      message = 'portal token estimate version is missing';
  end if;

  new.tenant_id := parent_tenant_id;
  return new;
end;
$$;

revoke all on function public.assign_portal_tokens_tenant_id() from public;

drop trigger if exists set_portal_tokens_tenant_id on public.portal_tokens;
create trigger set_portal_tokens_tenant_id
  before insert or update on public.portal_tokens
  for each row execute procedure public.assign_portal_tokens_tenant_id();

create or replace function public.claim_portal_estimate_decision(
  p_portal_token_id uuid,
  p_decision text,
  p_client_ip inet default null,
  p_reject_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  portal_row public.portal_tokens%rowtype;
  version_status public.estimate_status;
  decided_at timestamptz := clock_timestamp();
  event_metadata jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_decision not in ('accepted', 'rejected') then
    raise exception using
      errcode = '22023',
      message = 'invalid portal decision';
  end if;

  select pt.*
    into portal_row
  from public.portal_tokens pt
  where pt.id = p_portal_token_id;

  if portal_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'portal capability is no longer claimable';
  end if;

  select ev.status
    into version_status
  from public.estimate_versions ev
  where ev.id = portal_row.version_id
    and ev.tenant_id = portal_row.tenant_id
  for update;

  if version_status is null or version_status <> 'sent' then
    raise exception using
      errcode = 'P0001',
      message = 'estimate version is no longer claimable';
  end if;

  select pt.*
    into portal_row
  from public.portal_tokens pt
  where pt.id = p_portal_token_id
    and pt.version_id = portal_row.version_id
    and pt.tenant_id = portal_row.tenant_id
  for update;

  if portal_row.id is null
    or portal_row.status <> 'pending'
    or portal_row.expires_at <= decided_at then
    raise exception using
      errcode = 'P0001',
      message = 'portal capability is no longer claimable';
  end if;

  update public.portal_tokens
  set status = p_decision,
      accepted_at = case when p_decision = 'accepted' then decided_at else null end,
      accepted_ip = case when p_decision = 'accepted' then p_client_ip else null end,
      reject_reason = case
        when p_decision = 'rejected' then nullif(left(btrim(p_reject_reason), 1000), '')
        else null
      end
  where id = portal_row.id;

  update public.estimate_versions
  set status = case
    when p_decision = 'accepted' then 'accepted'::public.estimate_status
    else 'archived'::public.estimate_status
  end
  where id = portal_row.version_id
    and tenant_id = portal_row.tenant_id
    and status = 'sent';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'estimate version decision lost its concurrency claim';
  end if;

  update public.portal_tokens
  set status = 'expired'
  where version_id = portal_row.version_id
    and tenant_id = portal_row.tenant_id
    and id <> portal_row.id
    and status = 'pending';

  event_metadata := jsonb_build_object(
    'portal_token_id', portal_row.id,
    case when p_decision = 'accepted' then 'accepted_via' else 'rejected_via' end,
    'portal'
  );

  if p_decision = 'accepted' then
    event_metadata := event_metadata || jsonb_build_object(
      'client_ip', p_client_ip
    );
  elsif nullif(left(btrim(p_reject_reason), 1000), '') is not null then
    event_metadata := event_metadata || jsonb_build_object(
      'reason', left(btrim(p_reject_reason), 1000)
    );
  end if;

  perform public.log_estimate_version_event(
    portal_row.version_id,
    p_decision,
    null,
    event_metadata,
    decided_at
  );
end;
$$;

revoke all on function public.claim_portal_estimate_decision(uuid, text, inet, text)
  from public, anon, authenticated;
grant execute on function public.claim_portal_estimate_decision(uuid, text, inet, text)
  to service_role;

create or replace function public.enforce_estimate_document_canonical_path()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_tenant_id uuid;
  parent_project_id uuid;
begin
  select ev.tenant_id, ev.project_id
    into parent_tenant_id, parent_project_id
  from public.estimate_versions ev
  join public.estimate_projects ep
    on ep.id = ev.project_id
   and ep.tenant_id = ev.tenant_id
  where ev.id = new.version_id;

  if parent_tenant_id is null or parent_project_id is null then
    raise exception using
      errcode = '23503',
      message = 'estimate document parent is missing';
  end if;

  new.tenant_id := parent_tenant_id;
  new.file_path := concat(
    parent_tenant_id::text,
    '/',
    parent_project_id::text,
    '/',
    new.version_id::text,
    '.pdf'
  );
  return new;
end;
$$;

revoke all on function public.enforce_estimate_document_canonical_path() from public;

drop trigger if exists set_estimate_documents_tenant_id
  on public.estimate_documents;
drop trigger if exists enforce_estimate_document_canonical_path
  on public.estimate_documents;
create trigger enforce_estimate_document_canonical_path
  before insert or update on public.estimate_documents
  for each row execute procedure public.enforce_estimate_document_canonical_path();
