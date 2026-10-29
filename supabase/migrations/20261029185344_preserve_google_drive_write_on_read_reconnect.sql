-- A new read grant updates only the read token. The independently granted write
-- token survives a read reconnection; an explicit disable still removes it.
create or replace function public.save_google_drive_single_connection(p_tenant_id uuid,p_user_id uuid,p_google_account_id text,p_email text,p_display_name text,p_refresh_token_ciphertext text,p_purpose text,p_generation uuid) returns uuid
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
    status='active',grant_version=pg_catalog.gen_random_uuid(),updated_at=now()
   returning a.* into c;
  insert into private.google_drive_connection_secrets(connection_id,refresh_token_ciphertext)
   values(c.id,p_refresh_token_ciphertext) on conflict(connection_id) do update
   set refresh_token_ciphertext=excluded.refresh_token_ciphertext,updated_at=now();
 end if;
 update private.google_drive_authorization_generations set generation=pg_catalog.gen_random_uuid() where membership_id=m_id;
 return c.id;
end $$;
