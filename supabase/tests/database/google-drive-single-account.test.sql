begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(10);
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values('00000000-0000-0000-0000-000000000000','9a000000-0000-4000-8000-000000000001','authenticated','authenticated','single-drive@example.test',crypt('fixture-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
create temporary table drive_fixture on commit drop as select tenant_id,user_id,public.begin_google_drive_authorization(tenant_id,user_id) as generation
 from public.tenant_memberships where user_id='9a000000-0000-4000-8000-000000000001';
select ok(not has_function_privilege('authenticated','public.save_google_drive_single_connection(uuid,uuid,text,text,text,text,text,uuid)','execute'),'members cannot forge a Google identity');
select ok(not has_function_privilege('authenticated','public.google_drive_single_secret(uuid)','execute'),'members cannot read refresh tokens');
create temporary table connection_before on commit drop as select public.save_google_drive_single_connection(tenant_id,user_id,'google_demo','single@example.test','Fixture','v1.aaaa.bbbb.cccc','read',generation) as id from drive_fixture;
update drive_fixture set generation=public.begin_google_drive_authorization(tenant_id,user_id);
select is((select write_enabled from public.google_drive_connections where id=(select id from connection_before)),false,'new connections default to read');
select throws_ok($$select public.save_google_drive_single_connection(tenant_id,user_id,'other_google','other@example.test','Other','v1.aaaa.bbbb.cccc','read',generation) from drive_fixture$$,'P0001','GOOGLE_DRIVE_SINGLE_ACCOUNT','another Google account cannot replace this one');
select is((select count(*) from public.google_drive_connections where user_id='9a000000-0000-4000-8000-000000000001'),1::bigint,'one account remains');
select is((select public.save_google_drive_single_connection(tenant_id,user_id,'google_demo','single@example.test','Fixture','v1.dddd.eeee.ffff','write',generation) from drive_fixture),(select id from connection_before),'writing uses the existing account');
update drive_fixture set generation=public.begin_google_drive_authorization(tenant_id,user_id);
select is((select refresh_token_ciphertext from public.google_drive_single_secret((select id from connection_before))),'v1.aaaa.bbbb.cccc','write consent preserves the read token');
select ok(public.set_google_drive_read_only((select tenant_id from drive_fixture),(select user_id from drive_fixture),(select id from connection_before),(select grant_version from public.google_drive_connections where id=(select id from connection_before))),'writing can be disabled');
select is((select write_refresh_token_ciphertext from public.google_drive_single_secret((select id from connection_before))),null::text,'write token is deleted');
select throws_ok($$select public.save_google_drive_single_connection(tenant_id,user_id,'google_demo','single@example.test','Fixture','v1.dddd.eeee.ffff','write',generation) from drive_fixture$$,'P0001','GOOGLE_DRIVE_AUTHORIZATION_EXPIRED','old OAuth state cannot re-enable writing');
select * from finish();
rollback;
