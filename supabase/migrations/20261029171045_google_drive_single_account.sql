-- Refuse an ambiguous upgrade instead of deleting an existing user's connections.
do $$ begin
 if exists(select 1 from public.google_drive_connections group by tenant_id,user_id having count(*)>1) then
  raise exception 'GOOGLE_DRIVE_EXISTING_MULTIPLE_ACCOUNTS: choose the account to retain before applying this migration';
 end if;
end $$;
alter table public.google_drive_connections
 add column write_enabled boolean not null default false,
 add column grant_version uuid not null default gen_random_uuid(),
 add constraint google_drive_single_member_key unique(tenant_id,user_id);
alter table private.google_drive_connection_secrets add column write_refresh_token_ciphertext text;
alter table private.google_drive_connection_secrets add constraint google_drive_write_secret_format check(
 write_refresh_token_ciphertext is null or (length(write_refresh_token_ciphertext)<=8192 and write_refresh_token_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'));

create table private.google_drive_authorization_generations(
 membership_id uuid primary key references public.tenant_memberships(id) on delete cascade,
 generation uuid not null default gen_random_uuid()
);
alter table private.google_drive_authorization_generations enable row level security;
alter table private.google_drive_authorization_generations force row level security;
revoke all on private.google_drive_authorization_generations from public,anon,authenticated,service_role;

create function public.begin_google_drive_authorization(p_tenant_id uuid,p_user_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare m_id uuid; g uuid;
begin
 select id into m_id from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_user_id for key share;
 if not found then raise exception using errcode='42501',message='GOOGLE_DRIVE_CONNECTION_DENIED'; end if;
 insert into private.google_drive_authorization_generations(membership_id) values(m_id) on conflict do nothing;
 select generation into g from private.google_drive_authorization_generations where membership_id=m_id;
 return g;
end $$;
revoke all on function public.begin_google_drive_authorization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_google_drive_authorization(uuid,uuid) to service_role;

create function public.save_google_drive_single_connection(p_tenant_id uuid,p_user_id uuid,p_google_account_id text,p_email text,p_display_name text,p_refresh_token_ciphertext text,p_purpose text,p_generation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare m_id uuid; g uuid; c public.google_drive_connections%rowtype;
begin
 select id into m_id from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_user_id for key share;
 if not found then raise exception using errcode='42501',message='GOOGLE_DRIVE_CONNECTION_DENIED'; end if;
 select generation into g from private.google_drive_authorization_generations where membership_id=m_id for update;
 if not found or p_generation is null or g<>p_generation then raise exception 'GOOGLE_DRIVE_AUTHORIZATION_EXPIRED'; end if;
 if p_purpose is null or p_purpose not in ('read','write') then raise exception using errcode='23514',message='GOOGLE_DRIVE_PURPOSE_INVALID'; end if;
 if p_refresh_token_ciphertext is null or length(p_refresh_token_ciphertext)>8192 or p_refresh_token_ciphertext !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception using errcode='23514',message='GOOGLE_DRIVE_SECRET_INVALID'; end if;
 select * into c from public.google_drive_connections where tenant_id=p_tenant_id and user_id=p_user_id for update;
 if found and c.google_account_id<>p_google_account_id then raise exception 'GOOGLE_DRIVE_SINGLE_ACCOUNT'; end if;
 if p_purpose='write' then
  if c.id is null or c.status<>'active' then raise exception 'GOOGLE_DRIVE_READ_CONNECTION_REQUIRED'; end if;
  update public.google_drive_connections set write_enabled=true,grant_version=pg_catalog.gen_random_uuid(),updated_at=now() where id=c.id;
  update private.google_drive_connection_secrets set write_refresh_token_ciphertext=p_refresh_token_ciphertext,updated_at=now() where connection_id=c.id;
  if not found then raise exception 'GOOGLE_DRIVE_READ_CONNECTION_REQUIRED'; end if;
 else
  insert into public.google_drive_connections as a(tenant_id,user_id,google_account_id,email,display_name)
   values(p_tenant_id,p_user_id,p_google_account_id,p_email,p_display_name)
   on conflict(tenant_id,user_id) do update set email=excluded.email,display_name=excluded.display_name,
    write_enabled=false,status='active',grant_version=pg_catalog.gen_random_uuid(),updated_at=now()
   returning a.* into c;
  insert into private.google_drive_connection_secrets(connection_id,refresh_token_ciphertext)
   values(c.id,p_refresh_token_ciphertext) on conflict(connection_id) do update
   set refresh_token_ciphertext=excluded.refresh_token_ciphertext,write_refresh_token_ciphertext=null,updated_at=now();
 end if;
 update private.google_drive_authorization_generations set generation=pg_catalog.gen_random_uuid() where membership_id=m_id;
 return c.id;
end $$;
revoke all on function public.save_google_drive_single_connection(uuid,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_google_drive_single_connection(uuid,uuid,text,text,text,text,text,uuid) to service_role;

-- Legacy callers keep read-only behavior during rollout; drain them before opening the new UI.
create or replace function public.save_google_drive_connection(p_tenant_id uuid,p_user_id uuid,p_google_account_id text,p_email text,p_display_name text,p_refresh_token_ciphertext text) returns uuid
language sql security definer set search_path='' as $$
 select public.save_google_drive_single_connection(p_tenant_id,p_user_id,p_google_account_id,p_email,p_display_name,p_refresh_token_ciphertext,'read',public.begin_google_drive_authorization(p_tenant_id,p_user_id));
$$;

create function public.google_drive_single_secret(p_connection_id uuid)
returns table(tenant_id uuid,user_id uuid,google_account_id text,status text,updated_at timestamptz,shared_grant boolean,refresh_token_ciphertext text,write_refresh_token_ciphertext text,write_enabled boolean,grant_version uuid)
language sql stable security definer set search_path='' as $$
 select c.tenant_id,c.user_id,c.google_account_id,c.status,c.updated_at,
 exists(select 1 from public.google_drive_connections o where o.google_account_id=c.google_account_id and o.id<>c.id),
 s.refresh_token_ciphertext,s.write_refresh_token_ciphertext,c.write_enabled,c.grant_version
 from public.google_drive_connections c join private.google_drive_connection_secrets s on s.connection_id=c.id
 join public.tenant_memberships m on m.tenant_id=c.tenant_id and m.user_id=c.user_id where c.id=p_connection_id;
$$;
revoke all on function public.google_drive_single_secret(uuid) from public,anon,authenticated;
grant execute on function public.google_drive_single_secret(uuid) to service_role;

create function private.invalidate_single_drive_authorizations() returns trigger
language plpgsql security definer set search_path='' as $$
declare m_id uuid;
begin
 select id into m_id from public.tenant_memberships where tenant_id=old.tenant_id and user_id=old.user_id for key share;
 if found then
  insert into private.google_drive_authorization_generations(membership_id,generation) values(m_id,pg_catalog.gen_random_uuid())
   on conflict(membership_id) do update set generation=pg_catalog.gen_random_uuid();
 end if;
 return old;
end $$;
revoke all on function private.invalidate_single_drive_authorizations() from public,anon,authenticated,service_role;
create trigger invalidate_single_drive_authorizations before delete on public.google_drive_connections for each row execute function private.invalidate_single_drive_authorizations();

create function public.set_google_drive_read_only(p_tenant_id uuid,p_user_id uuid,p_connection_id uuid,p_grant_version uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m_id uuid;
begin
 perform public.begin_google_drive_authorization(p_tenant_id,p_user_id);
 select id into m_id from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_user_id;
 perform 1 from private.google_drive_authorization_generations where membership_id=m_id for update;
 update public.google_drive_connections set write_enabled=false,grant_version=pg_catalog.gen_random_uuid(),updated_at=now()
  where tenant_id=p_tenant_id and user_id=p_user_id and id=p_connection_id and grant_version=p_grant_version;
 if not found then return false; end if;
 update private.google_drive_connection_secrets set write_refresh_token_ciphertext=null,updated_at=now() where connection_id=p_connection_id;
 update private.google_drive_authorization_generations set generation=pg_catalog.gen_random_uuid() where membership_id=m_id;
 return true;
end $$;
revoke all on function public.set_google_drive_read_only(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_google_drive_read_only(uuid,uuid,uuid,uuid) to service_role;

create function public.remove_google_drive_single_connection(p_tenant_id uuid,p_user_id uuid,p_connection_id uuid,p_grant_version uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m_id uuid;
begin
 perform public.begin_google_drive_authorization(p_tenant_id,p_user_id);
 select id into m_id from public.tenant_memberships where tenant_id=p_tenant_id and user_id=p_user_id;
 perform 1 from private.google_drive_authorization_generations where membership_id=m_id for update;
 delete from public.google_drive_connections where tenant_id=p_tenant_id and user_id=p_user_id and id=p_connection_id and grant_version=p_grant_version;
 return found;
end $$;
revoke all on function public.remove_google_drive_single_connection(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_google_drive_single_connection(uuid,uuid,uuid,uuid) to service_role;
