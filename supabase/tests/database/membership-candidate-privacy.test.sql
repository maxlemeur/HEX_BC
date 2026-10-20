begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Authorization, account identity and response minimization are DB boundaries;
-- HTTP-only assertions cannot establish the EXECUTE ACL or invoker semantics.
select has_function('public', 'find_membership_candidate_by_email', array['uuid', 'text']);
select ok(not has_function_privilege('anon', 'public.find_membership_candidate_by_email(uuid,text)', 'execute'), 'anon cannot forge an actor');
select ok(not has_function_privilege('authenticated', 'public.find_membership_candidate_by_email(uuid,text)', 'execute'), 'authenticated cannot forge an actor');
select ok(has_function_privilege('service_role', 'public.find_membership_candidate_by_email(uuid,text)', 'execute'), 'the server can perform the lookup');
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.find_membership_candidate_by_email(uuid,text)'::regprocedure), 'bounded Auth lookup pins its definer search path');
select ok(not has_table_privilege('service_role','auth.users','select'), 'Auth users remain inaccessible as a general directory');

insert into auth.users(id,email,raw_user_meta_data) values
('f1000000-0000-4000-8000-000000000001','army-auth-admin@example.test','{}'),
('f1000000-0000-4000-8000-000000000002','army-auth-target@example.test','{}');
update public.profiles set full_name='Private foreign name', work_email='spoofed@example.test'
where id='f1000000-0000-4000-8000-000000000002';

set local role service_role;
select is((select count(*) from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001','example.test')),0::bigint,'partial email cannot enumerate');
select is((select count(*) from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001','%')),0::bigint,'wildcards cannot enumerate');
select is((select count(*) from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001','spoofed@example.test')),0::bigint,'editable profile email is not account identity');
select is((select id from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001',' ARMY-AUTH-TARGET@EXAMPLE.TEST ')), 'f1000000-0000-4000-8000-000000000002'::uuid,'exact Auth email resolves case insensitively');
select is((select count(*) from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001','army-auth-admin@example.test')),0::bigint,'existing members are excluded');
reset role;
update public.tenant_memberships set role='viewer' where user_id='f1000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select * from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001','army-auth-target@example.test')$$,'42501','MEMBERSHIP_CANDIDATE_ADMIN_REQUIRED','non-admin actor is refused');
reset role;
update public.tenant_memberships set role='admin' where user_id='f1000000-0000-4000-8000-000000000001';
update public.tenants set is_active=false where created_by='f1000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select * from public.find_membership_candidate_by_email('f1000000-0000-4000-8000-000000000001','army-auth-target@example.test')$$,'42501','MEMBERSHIP_CANDIDATE_ADMIN_REQUIRED','suspended tenant is refused');
reset role;
select * from finish();
rollback;
