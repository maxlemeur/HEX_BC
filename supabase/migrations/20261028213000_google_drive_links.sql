-- Google Drive: the Google accounts a member adds stay connected, and Drive pieces are
-- referenced by link instead of being copied into the affaire-intake bucket.
-- The refresh token is encrypted by the application before it reaches the database
-- and only the service role can read it back; the browser never receives it.

create table public.google_drive_connections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_account_id text not null,
  email text not null,
  display_name text not null,
  status text not null default 'active',
  constraint google_drive_connections_account_key unique (tenant_id, user_id, google_account_id),
  constraint google_drive_connections_account_id_check check (google_account_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  constraint google_drive_connections_email_check check (length(email) between 3 and 320),
  constraint google_drive_connections_display_name_check check (length(btrim(display_name)) between 1 and 255),
  constraint google_drive_connections_status_check check (status in ('active', 'reconnect_required'))
);
create index google_drive_connections_user_idx on public.google_drive_connections (user_id, tenant_id);

alter table public.google_drive_connections enable row level security;
alter table public.google_drive_connections force row level security;
-- A connection belongs to the member who added it, in the active tenant. Writes go through
-- save_google_drive_connection so that the encrypted token is stored with its row.
create policy "Members read their own Google Drive connections"
  on public.google_drive_connections for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));
create policy "Members remove their own Google Drive connections"
  on public.google_drive_connections for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

create table private.google_drive_connection_secrets (
  connection_id uuid primary key references public.google_drive_connections(id) on delete cascade,
  refresh_token_ciphertext text not null,
  updated_at timestamptz not null default now(),
  constraint google_drive_connection_secrets_format_check
    check (length(refresh_token_ciphertext) <= 8192
      and refresh_token_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
alter table private.google_drive_connection_secrets enable row level security;
alter table private.google_drive_connection_secrets force row level security;
revoke all on private.google_drive_connection_secrets from public, anon, authenticated, service_role;

create or replace function public.save_google_drive_connection(
  p_google_account_id text,
  p_email text,
  p_display_name text,
  p_refresh_token_ciphertext text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_tenant uuid := (select public.current_tenant_id());
  v_id uuid;
begin
  if v_user is null or v_tenant is null then
    raise exception using errcode = '42501', message = 'GOOGLE_DRIVE_CONNECTION_DENIED';
  end if;
  insert into public.google_drive_connections as c (tenant_id, user_id, google_account_id, email, display_name)
  values (v_tenant, v_user, p_google_account_id, p_email, p_display_name)
  on conflict (tenant_id, user_id, google_account_id) do update
    set email = excluded.email, display_name = excluded.display_name, status = 'active', updated_at = now()
  returning c.id into v_id;
  insert into private.google_drive_connection_secrets (connection_id, refresh_token_ciphertext)
  values (v_id, p_refresh_token_ciphertext)
  on conflict (connection_id) do update
    set refresh_token_ciphertext = excluded.refresh_token_ciphertext, updated_at = now();
  return v_id;
end;
$$;
revoke all on function public.save_google_drive_connection(text, text, text, text) from public, anon;
grant execute on function public.save_google_drive_connection(text, text, text, text) to authenticated;

-- The server reads a token only after checking who may use the connection: the member
-- for browsing, or the intake worker for a piece that member linked. A connection whose
-- member left the tenant is never returned. shared_grant tells whether revoking the grant
-- at Google would also cut another connection to the same Google account.
create or replace function public.google_drive_connection_secret(p_connection_id uuid)
returns table (tenant_id uuid, user_id uuid, google_account_id text, status text, updated_at timestamptz,
  shared_grant boolean, refresh_token_ciphertext text)
language sql stable security definer set search_path = '' as $$
  select c.tenant_id, c.user_id, c.google_account_id, c.status, c.updated_at,
    exists (select 1 from public.google_drive_connections o where o.google_account_id = c.google_account_id and o.id <> c.id),
    s.refresh_token_ciphertext
  from public.google_drive_connections c
  join private.google_drive_connection_secrets s on s.connection_id = c.id
  join public.tenant_memberships m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
  where c.id = p_connection_id;
$$;
revoke all on function public.google_drive_connection_secret(uuid) from public, anon, authenticated;
grant execute on function public.google_drive_connection_secret(uuid) to service_role;

-- A member who leaves a tenant takes the Google accounts they added there with them.
create or replace function private.remove_google_drive_connections_of_former_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.google_drive_connections where tenant_id = old.tenant_id and user_id = old.user_id;
  return old;
end;
$$;
revoke all on function private.remove_google_drive_connections_of_former_member() from public, anon, authenticated;
create trigger remove_google_drive_connections_of_former_member
  after delete on public.tenant_memberships
  for each row execute function private.remove_google_drive_connections_of_former_member();

-- The Drive folder of an affaire, opened directly when the Drive panel opens again.
create table public.affaire_google_drive_folders (
  project_id uuid primary key references public.estimate_projects(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_by uuid references public.profiles(id) on delete set null,
  connection_id uuid references public.google_drive_connections(id) on delete set null,
  folder_id text not null,
  folder_name text not null,
  shared_drive_id text,
  constraint affaire_google_drive_folders_folder_id_check check (folder_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  constraint affaire_google_drive_folders_folder_name_check check (length(btrim(folder_name)) between 1 and 255),
  constraint affaire_google_drive_folders_shared_drive_id_check
    check (shared_drive_id is null or shared_drive_id ~ '^[A-Za-z0-9_-]{1,200}$')
);
create index affaire_google_drive_folders_connection_idx on public.affaire_google_drive_folders (connection_id)
  where connection_id is not null;

alter table public.affaire_google_drive_folders enable row level security;
alter table public.affaire_google_drive_folders force row level security;
create policy "Affaire readers read the linked Drive folder"
  on public.affaire_google_drive_folders for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id)));
create policy "Affaire writers link a Drive folder"
  on public.affaire_google_drive_folders for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and linked_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id)));
create policy "Affaire writers change the linked Drive folder"
  on public.affaire_google_drive_folders for update to authenticated
  using (tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id)))
  with check (tenant_id = (select public.current_tenant_id()) and linked_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id)));
create policy "Affaire writers unlink the Drive folder"
  on public.affaire_google_drive_folders for delete to authenticated
  using (tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id)));

-- A Drive piece is a link: no stored bytes, read from Drive when the classifier needs them.
alter table public.affaire_intake_documents
  add column source_provider text,
  add column drive_connection_id uuid references public.google_drive_connections(id) on delete set null,
  add column drive_file_id text,
  add column drive_folder_id text,
  add column drive_folder_name text,
  add column drive_shared_drive_id text,
  add column drive_revision text,
  add column drive_modified_time timestamptz,
  add constraint affaire_intake_documents_source_provider_check
    check (source_provider is null or source_provider = 'google_drive'),
  add constraint affaire_intake_documents_drive_link_check check (
    (source_provider is null and drive_file_id is null and drive_connection_id is null and drive_folder_id is null)
    or (source_provider = 'google_drive' and storage_path is null
      and drive_file_id ~ '^[A-Za-z0-9_-]{1,200}$'
      and (drive_folder_id is null or drive_folder_id ~ '^[A-Za-z0-9_-]{1,200}$')
      and (drive_shared_drive_id is null or drive_shared_drive_id ~ '^[A-Za-z0-9_-]{1,200}$')
      and (drive_folder_name is null or length(drive_folder_name) <= 255)
      and (drive_revision is null or drive_revision ~ '^[0-9]{1,20}$')));
create unique index affaire_intake_documents_active_drive_link_idx
  on public.affaire_intake_documents (project_id, drive_file_id)
  where drive_file_id is not null and deleted_at is null;
create index affaire_intake_documents_drive_connection_idx
  on public.affaire_intake_documents (drive_connection_id)
  where drive_connection_id is not null;

-- A member can only point a link at a connection of their own. Otherwise a writer of the
-- affaire could make the worker read another member's Drive. The service role (worker)
-- has no auth.uid() and only refreshes the analysed revision.
create or replace function private.guard_google_drive_connection_reference() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_connection uuid;
  v_changed boolean;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_table_name = 'affaire_google_drive_folders' then
    v_connection := new.connection_id;
    v_changed := tg_op = 'INSERT' or new.connection_id is distinct from old.connection_id
      or new.folder_id is distinct from old.folder_id;
  else
    v_connection := new.drive_connection_id;
    v_changed := tg_op = 'INSERT' or new.drive_connection_id is distinct from old.drive_connection_id
      or new.drive_file_id is distinct from old.drive_file_id;
  end if;
  if v_connection is not null and v_changed and not exists (
    select 1 from public.google_drive_connections c
    where c.id = v_connection and c.user_id = (select auth.uid()) and c.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '42501', message = 'GOOGLE_DRIVE_CONNECTION_NOT_OWNED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_google_drive_connection_reference() from public, anon;

-- Named to fire after set_affaire_intake_document_scope (alphabetical order), once tenant_id is known.
create trigger zzz_guard_google_drive_connection_reference
  before insert or update on public.affaire_intake_documents
  for each row execute function private.guard_google_drive_connection_reference();
create trigger zzz_guard_google_drive_connection_reference
  before insert or update on public.affaire_google_drive_folders
  for each row execute function private.guard_google_drive_connection_reference();

-- Removing a Google account clears its id on the pieces it linked (on delete set null),
-- tombstones and pieces being deleted included. Any other change stays refused.
create or replace function public.guard_intake_document_deletion() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_ignored text[] := case when new.drive_connection_id is null
    then array['updated_at', 'drive_connection_id'] else array['updated_at'] end;
begin
  if old.deletion_token is not null and new.deletion_token is not distinct from old.deletion_token
     and (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    raise exception 'INTAKE_DOCUMENT_DELETION_IN_PROGRESS';
  end if;
  if old.deleted_at is not null and new.deleted_at is not null
     and (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    raise exception 'INTAKE_DOCUMENT_DELETED';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_intake_document_deletion() from public, anon, authenticated;

-- Drive pieces are no longer copied, so no pending Drive copy needs to be verified in Storage.
drop policy if exists "Project writers can verify pending Drive copies" on storage.objects;
