-- Weekly purge of test drafts (20261025174800_test_tenant_draft_purge.sql): public.purge_test_tenant_drafts deletes
-- the affaires of private.test_data_tenants whose versions are all drafts untouched for the retention.
-- Failure modes:
--   T1 a caller other than service_role runs it, or reads or widens the lists;
--   T2 it reaches an unlisted tenant, a non-draft version, a recent edit or a retained affaire;
--   T3 a dry run deletes, the limit is ignored, or the cascade stops on the immutable intake journal;
--   T4 one failing delete stops the others or leaves the journal switch on;
--   T5 an edit committed after the candidate query started is purged anyway.
-- Identities: ...8000-0000000000NN; owner 1 of the listed tenant A, owner 2 of the unlisted tenant B.
-- Fixtures rolled back at the end.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated', fixture.email,
  crypt('fictional-local-test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (
  values
    ('e57d0000-0000-4000-8000-000000000001'::uuid, 'purge-listed-owner@example.test'),
    ('e57d0000-0000-4000-8000-000000000002'::uuid, 'purge-unlisted-owner@example.test')
) as fixture(id, email);

create temporary table purge_fx (key text primary key, id uuid not null) on commit drop;
insert into purge_fx (key, id)
select case membership.user_id when 'e57d0000-0000-4000-8000-000000000001' then 'tenant_a' else 'tenant_b' end,
  membership.tenant_id
from public.tenant_memberships as membership
where membership.user_id in ('e57d0000-0000-4000-8000-000000000001', 'e57d0000-0000-4000-8000-000000000002')
  and membership.is_default;

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from purge_fx where key = p_key
$$;

select is((select count(*)::integer from purge_fx), 2, 'fixture: each owner has a personal tenant');

insert into private.test_data_tenants (tenant_id, label) values (pg_temp.fx('tenant_a'), 'Fixture test tenant');

-- Affaires (project ...1N, its versions ...2N and ...3N): 11 old draft (oldest), 17 old draft, 18 old archived
-- draft, 12 retained, 13 old with a sent version, 14 new, 15 old with a version edited today, 16 old draft of the
-- unlisted tenant.
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived, created_at, updated_at)
select fixture.id, pg_temp.fx(fixture.tenant), fixture.user_id, fixture.name, fixture.id::text like '%18',
  fixture.at, fixture.at
from (
  values
    ('e57d0000-0000-4000-8000-000000000011'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge oldest draft', now() - interval '40 days'),
    ('e57d0000-0000-4000-8000-000000000017'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge old draft', now() - interval '30 days'),
    ('e57d0000-0000-4000-8000-000000000018'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge archived draft', now() - interval '25 days'),
    ('e57d0000-0000-4000-8000-000000000012'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge retained', now() - interval '40 days'),
    ('e57d0000-0000-4000-8000-000000000013'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge sent', now() - interval '40 days'),
    ('e57d0000-0000-4000-8000-000000000014'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge new', now() - interval '2 days'),
    ('e57d0000-0000-4000-8000-000000000015'::uuid, 'tenant_a', 'e57d0000-0000-4000-8000-000000000001'::uuid,
      'ARMY purge recently edited', now() - interval '40 days'),
    ('e57d0000-0000-4000-8000-000000000016'::uuid, 'tenant_b', 'e57d0000-0000-4000-8000-000000000002'::uuid,
      'Unlisted old draft', now() - interval '40 days')
) as fixture(id, tenant, user_id, name, at);

insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version,
  seal_hash, created_at, updated_at)
select fixture.id, project.tenant_id, project.id, fixture.version_number, fixture.status, fixture.engine,
  fixture.seal_hash, project.created_at, coalesce(fixture.updated_at, project.created_at)
from (
  values
    ('e57d0000-0000-4000-8000-000000000021'::uuid, 'e57d0000-0000-4000-8000-000000000011'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000027'::uuid, 'e57d0000-0000-4000-8000-000000000017'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000028'::uuid, 'e57d0000-0000-4000-8000-000000000018'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000022'::uuid, 'e57d0000-0000-4000-8000-000000000012'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000023'::uuid, 'e57d0000-0000-4000-8000-000000000013'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000033'::uuid, 'e57d0000-0000-4000-8000-000000000013'::uuid, 2,
      'sent'::public.estimate_status, 1::smallint, repeat('e', 64), null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000024'::uuid, 'e57d0000-0000-4000-8000-000000000014'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz),
    ('e57d0000-0000-4000-8000-000000000025'::uuid, 'e57d0000-0000-4000-8000-000000000015'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, now()),
    ('e57d0000-0000-4000-8000-000000000026'::uuid, 'e57d0000-0000-4000-8000-000000000016'::uuid, 1,
      'draft'::public.estimate_status, 2::smallint, null::text, null::timestamptz)
) as fixture(id, project_id, version_number, status, engine, seal_hash, updated_at)
join public.estimate_projects as project on project.id = fixture.project_id;

insert into private.test_data_retained_projects (project_id, reason)
values ('e57d0000-0000-4000-8000-000000000012', 'Fixture kept on purpose');

-- The oldest draft carries a section and an immutable intake journal, as the ARMY affaires do.
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select 'e57d0000-0000-4000-8000-000000000051', v.tenant_id, v.id, 'section'::public.estimate_item_type, 0,
  'Fixture section'
from public.estimate_versions as v
where v.id = 'e57d0000-0000-4000-8000-000000000021';
-- The item insert touches its version; restore the fixture's age past the timestamp triggers.
set local session_replication_role = replica;
update public.estimate_versions set updated_at = created_at where id = 'e57d0000-0000-4000-8000-000000000021';
update public.estimate_projects set updated_at = created_at where id = 'e57d0000-0000-4000-8000-000000000011';
set local session_replication_role = origin;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
values ('e57d0000-0000-4000-8000-000000000041', 'e57d0000-0000-4000-8000-000000000011',
  'e57d0000-0000-4000-8000-000000000001', 'failed');
insert into public.affaire_intake_documents (id, upload_id, created_by, file_name, upload_status, storage_path)
select 'e57d0000-0000-4000-8000-000000000042', 'e57d0000-0000-4000-8000-000000000041',
  'e57d0000-0000-4000-8000-000000000001', 'fictional.pdf', 'pending',
  p.tenant_id::text || '/' || p.id::text || '/e57d0000-0000-4000-8000-000000000041/e57d0000-0000-4000-8000-000000000042/fictional.pdf'
from public.estimate_projects as p
where p.id = 'e57d0000-0000-4000-8000-000000000011';
insert into public.affaire_intake_events (document_id, event_type, actor_user_id, after_payload)
values ('e57d0000-0000-4000-8000-000000000042', 'upload.created', 'e57d0000-0000-4000-8000-000000000001', '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- T1: service_role only; the lists stay out of every Data API role.
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.purge_test_tenant_drafts(boolean,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.purge_test_tenant_drafts(boolean,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.purge_test_tenant_drafts(boolean,integer)', 'EXECUTE'),
  'T1: only service_role can run the purge'
);

select ok(
  not has_function_privilege(role_name, 'private.test_data_project_is_stale(uuid,integer)', 'EXECUTE'),
  format('T1: %s cannot run the eligibility helper', role_name)
)
from unnest(array['anon', 'authenticated', 'service_role']) as role_name;

select ok(
  not has_table_privilege(role_name, list_name, privilege_name),
  format('T1: %s has no %s on %s', role_name, privilege_name, list_name)
)
from unnest(array['anon', 'authenticated', 'service_role']) as role_name
cross join unnest(array['private.test_data_tenants', 'private.test_data_retained_projects']) as list_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name;

select set_config('request.jwt.claims', '{"sub":"e57d0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  'select * from public.purge_test_tenant_drafts(false, 10)',
  '42501',
  null,
  'T1: an admin of the listed tenant cannot run it'
);
reset role;
select set_config('request.jwt.claims', '', true);

set local role service_role;
select throws_ok('select * from public.purge_test_tenant_drafts(true, 0)', '22023', 'INVALID_TEST_DATA_PURGE_INPUT',
  'T1: a limit below 1 is refused');
select throws_ok('select * from public.purge_test_tenant_drafts(true, 1001)', '22023', 'INVALID_TEST_DATA_PURGE_INPUT',
  'T1: a limit above 1000 is refused');
select throws_ok('select * from public.purge_test_tenant_drafts(null, 10)', '22023', 'INVALID_TEST_DATA_PURGE_INPUT',
  'T1: a missing dry-run flag is refused');

-- ---------------------------------------------------------------------------
-- T2/T3: a dry run lists only the old drafts of the listed tenant, archived included, oldest first, and deletes
-- nothing.
-- ---------------------------------------------------------------------------
create temporary table purge_dry_run on commit drop as
select * from public.purge_test_tenant_drafts();
reset role;
select results_eq(
  'select tenant_id, project_id, outcome from purge_dry_run',
  $$ values
    ((select id from purge_fx where key = 'tenant_a'), 'e57d0000-0000-4000-8000-000000000011'::uuid, 'eligible'::text),
    ((select id from purge_fx where key = 'tenant_a'), 'e57d0000-0000-4000-8000-000000000017'::uuid, 'eligible'::text),
    ((select id from purge_fx where key = 'tenant_a'), 'e57d0000-0000-4000-8000-000000000018'::uuid, 'eligible'::text) $$,
  'T2: the default call is a dry run over the old all-draft affaires of listed tenants'
);
set local role service_role;
select results_eq(
  'select project_id from public.purge_test_tenant_drafts(true, 1)',
  $$ values ('e57d0000-0000-4000-8000-000000000011'::uuid) $$,
  'T3: the limit keeps the oldest affaire'
);
reset role;
select is(
  (select count(*)::integer from public.estimate_projects where id::text like 'e57d0000-%'),
  8,
  'T3: a dry run deletes nothing'
);

set local role service_role;
select results_eq(
  'select project_id, outcome from public.purge_test_tenant_drafts(false, 1)',
  $$ values ('e57d0000-0000-4000-8000-000000000011'::uuid, 'deleted'::text) $$,
  'T3: a run deletes the oldest eligible affaire first'
);
reset role;
select ok(
  not exists (select 1 from public.estimate_projects where id = 'e57d0000-0000-4000-8000-000000000011')
    and not exists (select 1 from public.estimate_versions where id = 'e57d0000-0000-4000-8000-000000000021')
    and not exists (select 1 from public.estimate_items where id = 'e57d0000-0000-4000-8000-000000000051')
    and not exists (select 1 from public.affaire_intake_documents where id = 'e57d0000-0000-4000-8000-000000000042')
    and not exists (select 1 from public.affaire_intake_events where document_id = 'e57d0000-0000-4000-8000-000000000042'),
  'T3: the cascade removes the version, its items and the immutable intake journal'
);
select is(current_setting('app.bulk_delete_draft_affaires', true), 'off', 'T3: the journal switch is off again');

-- ---------------------------------------------------------------------------
-- T4: a delete that fails is reported, does not stop the next one and is picked again by the next run.
-- ---------------------------------------------------------------------------
-- A fixture reference blocks the delete (a temporary table cannot reference public.estimate_projects).
create schema purge_fixture;
create table purge_fixture.blocker (project_id uuid references public.estimate_projects (id));
insert into purge_fixture.blocker (project_id) values ('e57d0000-0000-4000-8000-000000000017');

set local role service_role;
select results_eq(
  'select project_id, outcome from public.purge_test_tenant_drafts(false, 200)',
  $$ values
    ('e57d0000-0000-4000-8000-000000000017'::uuid, 'failed'::text),
    ('e57d0000-0000-4000-8000-000000000018'::uuid, 'deleted'::text) $$,
  'T4: a blocked delete is reported and the archived draft after it is still deleted'
);
reset role;
select ok(
  exists (select 1 from public.estimate_projects where id = 'e57d0000-0000-4000-8000-000000000017')
    and exists (select 1 from public.estimate_versions where id = 'e57d0000-0000-4000-8000-000000000027')
    and not exists (select 1 from public.estimate_projects where id = 'e57d0000-0000-4000-8000-000000000018'),
  'T4: the blocked affaire keeps its versions'
);
select is(current_setting('app.bulk_delete_draft_affaires', true), 'off', 'T4: the journal switch is off after a failure');

set local role service_role;
select results_eq(
  'select project_id, outcome from public.purge_test_tenant_drafts(false, 200)',
  $$ values ('e57d0000-0000-4000-8000-000000000017'::uuid, 'failed'::text) $$,
  'T4: the next run picks the blocked affaire again'
);
reset role;
delete from purge_fixture.blocker;

set local role service_role;
select results_eq(
  'select project_id, outcome from public.purge_test_tenant_drafts(false, 200)',
  $$ values ('e57d0000-0000-4000-8000-000000000017'::uuid, 'deleted'::text) $$,
  'T4: once unblocked, the affaire is deleted'
);
select is_empty('select * from public.purge_test_tenant_drafts(false, 200)', 'T3: a last run has nothing left');
reset role;

-- ---------------------------------------------------------------------------
-- T5: the purge asks again before each delete. Deleting ...19 edits the version of ...1a, as a concurrent edit that
-- commits after the candidate query started would; ...1a was selected on its old age and must stay.
-- ---------------------------------------------------------------------------
insert into public.estimate_projects (id, tenant_id, user_id, name, created_at, updated_at)
select fixture.id, pg_temp.fx('tenant_a'), 'e57d0000-0000-4000-8000-000000000001', fixture.name, fixture.at, fixture.at
from (
  values
    ('e57d0000-0000-4000-8000-000000000019'::uuid, 'ARMY purge first of two', now() - interval '40 days'),
    ('e57d0000-0000-4000-8000-00000000001a'::uuid, 'ARMY purge edited meanwhile', now() - interval '35 days')
) as fixture(id, name, at);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version,
  created_at, updated_at)
select fixture.id, project.tenant_id, project.id, 1, 'draft', 2, project.created_at, project.created_at
from (
  values
    ('e57d0000-0000-4000-8000-000000000029'::uuid, 'e57d0000-0000-4000-8000-000000000019'::uuid),
    ('e57d0000-0000-4000-8000-00000000002a'::uuid, 'e57d0000-0000-4000-8000-00000000001a'::uuid)
) as fixture(id, project_id)
join public.estimate_projects as project on project.id = fixture.project_id;

create function purge_fixture.edit_next_affaire()
returns trigger
language plpgsql
as $$
begin
  update public.estimate_versions set updated_at = now() where id = 'e57d0000-0000-4000-8000-00000000002a';
  return old;
end;
$$;
create trigger purge_fixture_edit_next_affaire
after delete on public.estimate_projects
for each row
when (old.id = 'e57d0000-0000-4000-8000-000000000019')
execute function purge_fixture.edit_next_affaire();

set local role service_role;
select results_eq(
  'select project_id, outcome from public.purge_test_tenant_drafts(true, 200)',
  $$ values
    ('e57d0000-0000-4000-8000-000000000019'::uuid, 'eligible'::text),
    ('e57d0000-0000-4000-8000-00000000001a'::uuid, 'eligible'::text) $$,
  'T5: both old drafts are candidates'
);
select results_eq(
  'select project_id, outcome from public.purge_test_tenant_drafts(false, 200)',
  $$ values ('e57d0000-0000-4000-8000-000000000019'::uuid, 'deleted'::text) $$,
  'T5: the affaire edited after the candidate query is not deleted'
);
reset role;
select ok(
  exists (
    select 1 from public.estimate_projects
    where id = 'e57d0000-0000-4000-8000-00000000001a' and updated_at = created_at
  )
    and exists (
      select 1 from public.estimate_versions
      where id = 'e57d0000-0000-4000-8000-00000000002a' and updated_at > created_at
    ),
  'T5: only its version changed, so the candidate query still returned the affaire'
);
drop trigger purge_fixture_edit_next_affaire on public.estimate_projects;

select set_eq(
  $$ select id from public.estimate_projects where id::text like 'e57d0000-%' $$,
  $$ values
    ('e57d0000-0000-4000-8000-000000000012'::uuid),
    ('e57d0000-0000-4000-8000-000000000013'::uuid),
    ('e57d0000-0000-4000-8000-000000000014'::uuid),
    ('e57d0000-0000-4000-8000-000000000015'::uuid),
    ('e57d0000-0000-4000-8000-000000000016'::uuid),
    ('e57d0000-0000-4000-8000-00000000001a'::uuid) $$,
  'T2: retained, sent, new, recently edited and unlisted affaires all remain'
);

select * from finish();
rollback;
