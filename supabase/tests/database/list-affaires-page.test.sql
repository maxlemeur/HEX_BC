begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', md5('page-owner-' || n)::uuid,
  'authenticated', 'authenticated', 'page-owner-' || n || '@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from generate_series(1, 2) n;

insert into public.estimate_projects (id, tenant_id, user_id, name, client_name, updated_at, is_archived)
select fixture.id::uuid, membership.tenant_id, membership.user_id, name, client,
  '2026-02-01 00:00Z'::timestamptz + recency * interval '1 day', archived
from (values
  ('f1020000-0000-4000-8000-000000000001', 1, 'Alpha', 'Un', 1, false),
  ('f1020000-0000-4000-8000-000000000002', 1, 'ALPHA', 'Deux', 5, false),
  ('f1020000-0000-4000-8000-000000000003', 1, 'Bravo', 'Trois', 1, false),
  ('f1020000-0000-4000-8000-000000000004', 1, 'Charlie', 'Cible', 2, false),
  ('f1020000-0000-4000-8000-000000000005', 1, 'AAA archivee', 'Cible', 9, true),
  ('f1020000-0000-4000-8000-000000000006', 2, 'AAA autre tenant', 'Cible', 9, false)
) fixture(id, actor, name, client, recency, archived)
join public.tenant_memberships membership on membership.user_id = md5('page-owner-' || actor)::uuid;

insert into public.estimate_versions (id, project_id, version_number, status, updated_at, calc_engine_version)
select md5('page-version-' || project_number || '-' || version_number)::uuid,
  ('f1020000-0000-4000-8000-' || lpad(project_number::text,12,'0'))::uuid, version_number,
  status::public.estimate_status, '2026-02-01 00:00Z'::timestamptz + recency * interval '1 day', 2
from (values
  (1, 1, 'accepted', 0), (1, 5, 'accepted', 1), (1, 9, 'draft', 1),
  (3, 7, 'accepted', 2), (4, 2, 'draft', 2)
) fixture(project_number, version_number, status, recency);

insert into public.user_favorite_projects (tenant_id,user_id,project_id)
select tenant_id,user_id,id from public.estimate_projects where id='f1020000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.sub',md5('page-owner-1')::uuid::text,true);

select results_eq(
  $$select project_name from public.list_affaires_page(public.current_tenant_id(), null, 1, p_sort_by => 'name', p_sort_dir => 'asc')$$,
  $$values ('Alpha'::text)$$, 'name order uses the project id to break case-insensitive ties');
select results_eq(
  $$select project_name from public.list_affaires_page(public.current_tenant_id(), null, 2, p_sort_by => 'name', p_sort_dir => 'asc',
    p_cursor_name => 'Alpha', p_cursor_project_id => 'f1020000-0000-4000-8000-000000000001')$$,
  $$values ('ALPHA'::text), ('Bravo')$$, 'name cursor includes the second tied project, including a project without a version');
select results_eq(
  $$select project_name from public.list_affaires_page(public.current_tenant_id(), null, 1, p_sort_by => 'name', p_sort_dir => 'desc',
    p_cursor_name => 'Bravo', p_cursor_project_id => 'f1020000-0000-4000-8000-000000000003')$$,
  $$values ('ALPHA'::text)$$, 'descending name cursor reverses the name and project id ordering');
select results_eq(
  $$select project_name from public.list_affaires_page(public.current_tenant_id(), null, 1, p_statuses => array['accepted']::public.estimate_status[],
    p_sort_by => 'name', p_sort_dir => 'asc')$$,
  $$values ('Bravo'::text)$$, 'status selection examines the latest version before limiting the name page');
select results_eq(
  $$select project_name from public.list_affaires_page(public.current_tenant_id(), null, 1, p_search => 'cible', p_statuses => '{}'::public.estimate_status[],
    p_sort_by => 'name', p_sort_dir => 'asc', p_favorites_only => true)$$,
  $$values ('Charlie'::text)$$, 'search, favorites and archive scope precede the first name page');
select results_eq(
  $$select project_name, version_count, current_version_number, accepted_version_number, accepted_version_id
      from public.list_affaires_page(public.current_tenant_id(), null, 10, p_sort_by => 'name', p_sort_dir => 'asc')$$,
  $$values
    ('Alpha'::text, 3, 9, 5, md5('page-version-1-5')::uuid),
    ('ALPHA', 0, null, null, null),
    ('Bravo', 1, 7, 7, md5('page-version-3-7')::uuid),
    ('Charlie', 1, 2, null, null)$$, 'counts and latest accepted identities handle gapped version numbers, empty projects and current acceptances');
select results_eq(
  $$select project_name from public.list_affaires_page(public.current_tenant_id(), null, 1)$$,
  $$values ('ALPHA'::text)$$, 'the default read ranks a recent versionless project by the project date');

select * from finish();
rollback;
