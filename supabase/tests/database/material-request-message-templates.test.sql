-- TI-691: the supplier consultation message follows the member's own template, else the company's general one,
-- else today's message. Each member keeps their own template in their active tenant, which nobody else reads or
-- changes; the company's is read by its members and written by its admins only.
--
-- Covers the migration 20261122093228_material_request_message_templates.sql. Failure modes:
--   T1 a member cannot add, read, change or delete their own template;
--   T2 the member or the tenant of a row is chosen by the caller at insert, or changed by an update;
--   T3 another member of the same tenant (an admin included) reads, changes or deletes it;
--   T4 a member of another tenant reads, changes or deletes it;
--   T5 a member of two tenants reads in one the template written in the other, or writes into the inactive one;
--      a suspended tenant's template is still read;
--   T6 a template longer than its bound, empty or blank, is stored;
--   T7 anon touches the table, a signed-in user without an active tenant gets a row, or a writer without a user
--      session (service role) writes one;
--   T8 the upsert the API uses fails or leaves two rows;
--   T9 a revoked membership keeps its template, or a member who joins again finds the old one.
--   G1 a member cannot read the company's template, or reads another company's, an inactive tenant's, or its author;
--   G2 it is written directly, by anon, by a member who is not an admin, by a global admin without a local admin
--      role, by an admin of another tenant, or by an admin of two tenants into the inactive one;
--   G3 its tenant, author or date is chosen by the caller; a save leaves two rows; a reset fails when repeated;
--   G4 it is longer than its bound, empty or blank;
--   G5 it outlives its tenant, or a write reaches the other tenant's row or a personal template.
-- Every statement goes through pg_temp.mt_run (role and JWT subject switched in a sub-block), so a red assertion
-- fails on its own reason and the suite runs to the end. Fixtures rolled back at the end.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Identities: ...8000-00000000000N. 1 admin owner of tenant A, 2 and 3 engineers of tenant A (3 also a viewer of
-- tenant B, not their default), 4 admin owner of tenant B, 5 without any tenant.
-- Tenant C, created here, has admin 4 as its only member (default), to be deleted.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated', fixture.email,
  crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (
  values
    ('7e691000-0000-4000-8000-000000000001'::uuid, 'message-template-admin-a@example.test'),
    ('7e691000-0000-4000-8000-000000000002'::uuid, 'message-template-engineer-a1@example.test'),
    ('7e691000-0000-4000-8000-000000000003'::uuid, 'message-template-engineer-a2@example.test'),
    ('7e691000-0000-4000-8000-000000000004'::uuid, 'message-template-admin-b@example.test'),
    ('7e691000-0000-4000-8000-000000000005'::uuid, 'message-template-no-tenant@example.test')
) as fixture(id, email);

create temporary table mt_fx (key text primary key, id uuid not null) on commit drop;
grant select on mt_fx to authenticated;

insert into mt_fx (key, id)
select case membership.user_id
    when '7e691000-0000-4000-8000-000000000001' then 'tenant_a'
    else 'tenant_b'
  end,
  membership.tenant_id
from public.tenant_memberships membership
where membership.user_id in ('7e691000-0000-4000-8000-000000000001', '7e691000-0000-4000-8000-000000000004')
  and membership.is_default
  and membership.role = 'admin';

insert into mt_fx (key, id) values
  ('admin_a', '7e691000-0000-4000-8000-000000000001'),
  ('engineer_1', '7e691000-0000-4000-8000-000000000002'),
  ('engineer_2', '7e691000-0000-4000-8000-000000000003'),
  ('admin_b', '7e691000-0000-4000-8000-000000000004'),
  ('nobody', '7e691000-0000-4000-8000-000000000005');

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from mt_fx where key = p_key
$$;

select is(
  (select count(*)::integer from mt_fx where key in ('tenant_a', 'tenant_b')),
  2,
  'fixture: owners 1 and 4 each administer their own personal tenant'
);

delete from public.tenant_memberships
where user_id in (pg_temp.fx('engineer_1'), pg_temp.fx('engineer_2'), pg_temp.fx('nobody'));

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select fixture.id, pg_temp.fx(fixture.tenant_key), pg_temp.fx(fixture.user_key), fixture.role, fixture.is_default
from (
  values
    ('7e691000-0000-4000-8000-000000000021'::uuid, 'tenant_a', 'engineer_1', 'engineer'::public.tenant_role, true),
    ('7e691000-0000-4000-8000-000000000031'::uuid, 'tenant_a', 'engineer_2', 'engineer'::public.tenant_role, true),
    ('7e691000-0000-4000-8000-000000000032'::uuid, 'tenant_b', 'engineer_2', 'viewer'::public.tenant_role, false)
) as fixture(id, tenant_key, user_key, role, is_default);

-- Makes a tenant the member's active one (their default membership), in two steps for the single-default index.
create function pg_temp.mt_activate(p_user_key text, p_tenant_key text)
returns void
language sql
as $$
  update public.tenant_memberships set is_default = false where user_id = pg_temp.fx(p_user_key);
  update public.tenant_memberships set is_default = true
  where user_id = pg_temp.fx(p_user_key) and tenant_id = coalesce(pg_temp.fx(p_tenant_key), p_tenant_key::uuid);
$$;

-- Runs one statement as a signed-in member (or anon). Returns « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.mt_run(p_user_key text, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text;
  affected bigint;
  user_id uuid := pg_temp.fx(p_user_key);
begin
  begin
    if p_user_key = 'anon' then
      execute 'set local role anon';
    elsif p_user_key = 'global_admin' then
      -- A platform admin (app_metadata.role = admin) holding only a viewer membership in tenant A.
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', pg_temp.fx('global_admin')::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fx('global_admin'), 'role', 'authenticated',
        'app_metadata', jsonb_build_object('role', 'admin'))::text, true);
    else
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', user_id::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql;
    get diagnostics affected = row_count;
    run_result := 'ok ' || affected;
  exception when others then
    run_result := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- What a member sees of the table: « tenant:member:message » of each row, in order.
create function pg_temp.mt_seen(p_user_key text)
returns text
language plpgsql
as $seen$
declare
  seen text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', pg_temp.fx(p_user_key)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fx(p_user_key), 'role', 'authenticated')::text, true);
  select coalesce(string_agg(
      format('%s:%s:%s',
        (select key from mt_fx where id = template.tenant_id and key like 'tenant_%'),
        (select key from mt_fx where id = template.user_id and key not like 'tenant_%'),
        template.message_template),
      ' | ' order by (select key from mt_fx where id = template.tenant_id and key like 'tenant_%'),
        (select key from mt_fx where id = template.user_id and key not like 'tenant_%')), '')
    into seen
  from public.material_request_message_templates template;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return seen;
end;
$seen$;

-- What the table holds, read as its owner.
create function pg_temp.mt_rows()
returns text
language sql
as $$
  select coalesce(string_agg(
      format('%s:%s:%s',
        (select key from mt_fx where id = template.tenant_id and key like 'tenant_%'),
        (select key from mt_fx where id = template.user_id and key not like 'tenant_%'),
        template.message_template),
      ' | ' order by (select key from mt_fx where id = template.tenant_id and key like 'tenant_%'),
        (select key from mt_fx where id = template.user_id and key not like 'tenant_%')), '')
  from public.material_request_message_templates template
  where template.user_id in (select id from mt_fx)
$$;

-- ---------------------------------------------------------------------------
-- Contract.
-- ---------------------------------------------------------------------------
select has_table('public', 'material_request_message_templates', 'the personal template table exists');
select has_table('public', 'tenant_consultation_message_templates', 'the company template table exists');
select is(
  (select array_agg(format('%s:%s:%s', class.relname, class.relrowsecurity, class.relforcerowsecurity) order by class.relname)
   from pg_class class
   where class.oid in ('public.material_request_message_templates'::regclass, 'public.tenant_consultation_message_templates'::regclass)),
  array['material_request_message_templates:t:t', 'tenant_consultation_message_templates:t:t'],
  'row level security is enabled and forced on both tables'
);
select is(
  (select array_agg(format('%s:%s', policy.tablename, policy.cmd) order by policy.tablename, policy.cmd) from pg_policies policy
   where policy.schemaname = 'public'
     and policy.tablename in ('material_request_message_templates', 'tenant_consultation_message_templates')),
  array[
    'material_request_message_templates:DELETE', 'material_request_message_templates:INSERT',
    'material_request_message_templates:SELECT', 'material_request_message_templates:UPDATE',
    'tenant_consultation_message_templates:SELECT'
  ],
  'one policy per command on the personal table; the company table is only read directly'
);
select is(
  (select format('%s -> %s %s', constraint_.conkey, constraint_.confrelid::regclass, constraint_.confdeltype)
   from pg_constraint constraint_
   where constraint_.conrelid = 'public.material_request_message_templates'::regclass and constraint_.contype = 'f'),
  '{1,2} -> tenant_memberships c',
  'T9 a personal template belongs to a membership and goes with it'
);
select ok(
  not has_table_privilege('anon', 'public.material_request_message_templates', 'SELECT')
    and not has_table_privilege('anon', 'public.material_request_message_templates', 'INSERT')
    and not has_table_privilege('anon', 'public.tenant_consultation_message_templates', 'SELECT')
    and not has_table_privilege('anon', 'public.tenant_consultation_message_templates', 'INSERT'),
  'T7 anon holds no privilege on either table'
);
select matches(
  pg_temp.mt_run('anon', 'select * from public.material_request_message_templates'),
  '^42501 ',
  'T7 anon cannot read the personal templates'
);
select matches(
  pg_temp.mt_run('anon', 'select * from public.tenant_consultation_message_templates'),
  '^42501 ',
  'T7 anon cannot read the company templates'
);

-- ---------------------------------------------------------------------------
-- T1, T2: a member adds their own; member and tenant are the database's.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.mt_run('engineer_1', $$insert into public.material_request_message_templates (message_template, line_template)
    values ('Bonjour {fournisseur}\n{lignes}', '- {désignation}')$$),
  'ok 1',
  'T1 a member adds their template without naming themself or the tenant'
);
select is(
  pg_temp.mt_run('engineer_2', format(
    'insert into public.material_request_message_templates (tenant_id, user_id, message_template, line_template)
     values (%L, %L, %L, %L)',
    pg_temp.fx('tenant_b'), pg_temp.fx('admin_a'), 'Modèle 2 {lignes}', '{désignation}')),
  'ok 1',
  'T2 an insert that names another member and another tenant goes through'
);
select is(
  pg_temp.mt_rows(),
  'tenant_a:engineer_1:Bonjour {fournisseur}\n{lignes} | tenant_a:engineer_2:Modèle 2 {lignes}',
  'T2 and lands under the caller in their active tenant, whatever was sent'
);
select is(
  pg_temp.mt_seen('engineer_1'),
  'tenant_a:engineer_1:Bonjour {fournisseur}\n{lignes}',
  'T1 a member reads their own template only'
);
select throws_ok(
  $$insert into public.material_request_message_templates (tenant_id, user_id, message_template, line_template)
    values ('$$ || pg_temp.fx('tenant_a') || $$', '$$ || pg_temp.fx('admin_a') || $$', '{lignes}', '{désignation}')$$,
  '42501', 'MATERIAL_REQUEST_MESSAGE_TEMPLATE_USER_ONLY',
  'T7 a writer without a user session (service role) writes no personal template'
);

-- ---------------------------------------------------------------------------
-- T3, T4: nobody else reads or writes it.
-- ---------------------------------------------------------------------------
select is(pg_temp.mt_seen('admin_a'), '', 'T3 the tenant admin sees no member''s template');
select is(pg_temp.mt_seen('admin_b'), '', 'T4 a member of another tenant sees none');
select is(
  pg_temp.mt_run('admin_a', format(
    $$update public.material_request_message_templates set message_template = 'Piraté {lignes}' where user_id = %L$$,
    pg_temp.fx('engineer_1'))),
  'ok 0',
  'T3 the tenant admin changes nothing'
);
select is(
  pg_temp.mt_run('engineer_2', format(
    'delete from public.material_request_message_templates where user_id = %L', pg_temp.fx('engineer_1'))),
  'ok 0',
  'T3 a colleague of the same tenant deletes nothing'
);
select is(
  pg_temp.mt_run('engineer_2', format(
    $$update public.material_request_message_templates set line_template = 'x {désignation}' where user_id = %L$$,
    pg_temp.fx('engineer_1'))),
  'ok 0',
  'T3 nor changes it'
);
select is(
  pg_temp.mt_run('admin_b', 'delete from public.material_request_message_templates'),
  'ok 0',
  'T4 a member of another tenant deletes nothing'
);
select is(
  pg_temp.mt_rows(),
  'tenant_a:engineer_1:Bonjour {fournisseur}\n{lignes} | tenant_a:engineer_2:Modèle 2 {lignes}',
  'T3, T4 both templates are as their members left them'
);

-- ---------------------------------------------------------------------------
-- T2, T8: changing; the keys never move; the API's upsert keeps one row.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.mt_run('engineer_1', format(
    $$update public.material_request_message_templates set message_template = 'Rebonjour {lignes}', user_id = %L$$,
    pg_temp.fx('engineer_2'))),
  '^(42501 MATERIAL_REQUEST_MESSAGE_TEMPLATE_KEY_IMMUTABLE|42501 new row violates)',
  'T2 an update cannot hand the template to another member'
);
select matches(
  pg_temp.mt_run('engineer_2', format(
    $$update public.material_request_message_templates set tenant_id = %L$$, pg_temp.fx('tenant_b'))),
  '^42501 MATERIAL_REQUEST_MESSAGE_TEMPLATE_KEY_IMMUTABLE',
  'T2 nor move it to another of the member''s tenants'
);
select is(
  pg_temp.mt_run('engineer_1', $$update public.material_request_message_templates set message_template = 'Rebonjour {lignes}'$$),
  'ok 1',
  'T1 a member changes their own template'
);
select is(
  pg_temp.mt_run('engineer_1', $$insert into public.material_request_message_templates (message_template, line_template)
    values ('Upsert {lignes}', '* {désignation}')
    on conflict (tenant_id, user_id) do update
      set message_template = excluded.message_template, line_template = excluded.line_template$$),
  'ok 1',
  'T8 the upsert of the API replaces the member''s template'
);
select is(
  pg_temp.mt_seen('engineer_1'),
  'tenant_a:engineer_1:Upsert {lignes}',
  'T8 and leaves one row'
);
select ok(
  (select template.updated_at >= template.created_at from public.material_request_message_templates template
   where template.user_id = pg_temp.fx('engineer_1')),
  'the dates are the database''s'
);

-- ---------------------------------------------------------------------------
-- T5: a member of two tenants keeps a template per tenant, and only reads the active one's.
-- ---------------------------------------------------------------------------
select pg_temp.mt_activate('engineer_2', 'tenant_b');
select is(pg_temp.mt_seen('engineer_2'), '', 'T5 with tenant B active, the template of tenant A is not read');
select is(
  pg_temp.mt_run('engineer_2', $$update public.material_request_message_templates set message_template = 'Ailleurs {lignes}'$$),
  'ok 0',
  'T5 nor changed'
);
select is(
  pg_temp.mt_run('engineer_2', $$insert into public.material_request_message_templates (message_template, line_template)
    values ('Chez B {lignes}', '{désignation}')$$),
  'ok 1',
  'T5 a template is added for tenant B'
);
select is(pg_temp.mt_seen('engineer_2'), 'tenant_b:engineer_2:Chez B {lignes}', 'T5 only the active tenant''s is read');
update public.tenants set is_active = false where id = pg_temp.fx('tenant_b');
select is(
  pg_temp.mt_seen('engineer_2'),
  'tenant_a:engineer_2:Modèle 2 {lignes}',
  'T5 tenant B suspended, the member works in tenant A and reads its template only'
);
update public.tenants set is_active = true where id = pg_temp.fx('tenant_b');
select pg_temp.mt_activate('engineer_2', 'tenant_a');
select is(pg_temp.mt_seen('engineer_2'), 'tenant_a:engineer_2:Modèle 2 {lignes}', 'T5 back in tenant A, its template is read again');

-- ---------------------------------------------------------------------------
-- T6: bounds.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.mt_run('engineer_2', format(
    'update public.material_request_message_templates set message_template = %L, line_template = %L',
    repeat('m', 1992) || '{lignes}', repeat('l', 287) || '{désignation}')),
  'ok 1',
  'T6 a message of 2000 characters and a line of 300 are kept'
);
select matches(
  pg_temp.mt_run('engineer_2', format(
    'update public.material_request_message_templates set message_template = %L', repeat('m', 1993) || '{lignes}')),
  '^23514 ',
  'T6 a message template of 2001 characters is refused'
);
select matches(
  pg_temp.mt_run('engineer_2', format(
    'update public.material_request_message_templates set line_template = %L', repeat('l', 288) || '{désignation}')),
  '^23514 ',
  'T6 a line template of 301 characters is refused'
);
select matches(
  pg_temp.mt_run('engineer_2', $$update public.material_request_message_templates set message_template = ''$$),
  '^23514 ',
  'T6 an empty message template is refused'
);
select matches(
  pg_temp.mt_run('engineer_2', format(
    'update public.material_request_message_templates set line_template = %L', E' \n\t ')),
  '^23514 ',
  'T6 a blank line template is refused'
);

-- ---------------------------------------------------------------------------
-- T7: no active tenant, no row.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.mt_run('nobody', $$insert into public.material_request_message_templates (message_template, line_template)
    values ('{lignes}', '{désignation}')$$),
  '^42501 MATERIAL_REQUEST_MESSAGE_TEMPLATE_NO_TENANT',
  'T7 a user without an active tenant keeps no template'
);

-- ---------------------------------------------------------------------------
-- T1, T9: a member deletes their own (back to the default message); a revoked membership takes it away, and a
-- member who joins again starts from the default.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.mt_run('engineer_1', 'delete from public.material_request_message_templates'),
  'ok 1',
  'T1 a member deletes their own template, and only it'
);
select is(
  pg_temp.mt_rows(),
  'tenant_a:engineer_2:' || repeat('m', 1992) || '{lignes} | tenant_b:engineer_2:Chez B {lignes}',
  'T1 the other member''s templates stay'
);
delete from public.tenant_memberships where user_id = pg_temp.fx('engineer_2') and tenant_id = pg_temp.fx('tenant_b');
select is(
  pg_temp.mt_rows(),
  'tenant_a:engineer_2:' || repeat('m', 1992) || '{lignes}',
  'T9 the membership of tenant B revoked, its template is gone; tenant A''s stays'
);
insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
values ('7e691000-0000-4000-8000-000000000033', pg_temp.fx('tenant_b'), pg_temp.fx('engineer_2'), 'viewer', false);
select pg_temp.mt_activate('engineer_2', 'tenant_b');
select is(pg_temp.mt_seen('engineer_2'), '', 'T9 joining tenant B again, the member starts from the default');
select pg_temp.mt_activate('engineer_2', 'tenant_a');

-- ---------------------------------------------------------------------------
-- G: the company's general template, written by the admins of the active tenant through two functions.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', '7e691000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
  'message-template-global-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
insert into mt_fx (key, id) values ('global_admin', '7e691000-0000-4000-8000-000000000006');
-- The personal templates left by T: only the one added below is watched.
delete from public.material_request_message_templates where user_id in (select id from mt_fx);
delete from public.tenant_memberships where user_id = pg_temp.fx('global_admin');
insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default) values
  ('7e691000-0000-4000-8000-000000000061', pg_temp.fx('tenant_a'), pg_temp.fx('global_admin'), 'viewer', true),
  -- Admin 1 also administers tenant B, which is not their active tenant.
  ('7e691000-0000-4000-8000-000000000012', pg_temp.fx('tenant_b'), pg_temp.fx('admin_a'), 'admin', false);

-- What a member reads of the company table: « tenant:message » of each row.
create function pg_temp.mt_company(p_user_key text)
returns text
language plpgsql
as $company$
declare
  seen text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', pg_temp.fx(p_user_key)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fx(p_user_key), 'role', 'authenticated')::text, true);
  select coalesce(string_agg(
      format('%s:%s', (select key from mt_fx where id = template.tenant_id and key like 'tenant_%'), template.message_template),
      ' | ' order by (select key from mt_fx where id = template.tenant_id and key like 'tenant_%')), '')
    into seen
  from (select company.tenant_id, company.message_template from public.tenant_consultation_message_templates company) template;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return seen;
end;
$company$;

-- Everything the company table and the personal one hold, read as their owner: what no write may touch.
create function pg_temp.mt_all()
returns text
language sql
as $$
  select coalesce((select string_agg(
      format('%s:%s:%s:%s', (select key from mt_fx where id = company.tenant_id), company.message_template,
        company.line_template, (select key from mt_fx where id = company.updated_by)),
      ' | ' order by (select key from mt_fx where id = company.tenant_id))
    from public.tenant_consultation_message_templates company
    where company.tenant_id in (select id from mt_fx)), '') || ' || ' || pg_temp.mt_rows()
$$;

select has_function('public', 'save_tenant_consultation_message_template', array['text', 'text'],
  'G the company template is saved by public.save_tenant_consultation_message_template(text, text)');
select has_function('public', 'reset_tenant_consultation_message_template', array[]::text[],
  'G and reset by public.reset_tenant_consultation_message_template()');
select ok(
  not has_table_privilege('authenticated', 'public.tenant_consultation_message_templates', 'INSERT')
    and not has_table_privilege('authenticated', 'public.tenant_consultation_message_templates', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.tenant_consultation_message_templates', 'DELETE'),
  'G2 members never write the company table directly'
);
select ok(
  has_column_privilege('authenticated', 'public.tenant_consultation_message_templates', 'message_template', 'SELECT')
    and has_column_privilege('authenticated', 'public.tenant_consultation_message_templates', 'line_template', 'SELECT')
    and has_column_privilege('authenticated', 'public.tenant_consultation_message_templates', 'tenant_id', 'SELECT')
    and not has_column_privilege('authenticated', 'public.tenant_consultation_message_templates', 'updated_by', 'SELECT')
    and not has_column_privilege('authenticated', 'public.tenant_consultation_message_templates', 'updated_at', 'SELECT'),
  'G1 members read the tenant and the two texts, never the author'
);
select ok(
  not has_function_privilege('anon', 'public.save_tenant_consultation_message_template(text, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.reset_tenant_consultation_message_template()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.save_tenant_consultation_message_template(text, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.reset_tenant_consultation_message_template()', 'EXECUTE'),
  'G2 anon cannot call the writers; signed-in members can (and are checked inside)'
);
select is(
  (select format('%s:%s', procedure.prosecdef, 'search_path=""' = any(procedure.proconfig)) from pg_proc procedure
   where procedure.oid = 'public.save_tenant_consultation_message_template(text, text)'::regprocedure),
  't:t',
  'G the writer runs as definer with an empty search path'
);
select is(
  (select format('%s -> %s %s', constraint_.conkey, constraint_.confrelid::regclass, constraint_.confdeltype)
   from pg_constraint constraint_
   where constraint_.conrelid = 'public.tenant_consultation_message_templates'::regclass and constraint_.contype = 'f'
   order by constraint_.confrelid::regclass::text desc limit 1),
  '{1} -> tenants c',
  'G5 the company template belongs to its tenant'
);
select is(
  (select format('%s -> %s %s', constraint_.conkey, constraint_.confrelid::regclass, constraint_.confdeltype)
   from pg_constraint constraint_
   where constraint_.conrelid = 'public.tenant_consultation_message_templates'::regclass and constraint_.contype = 'f'
     and constraint_.confrelid = 'public.profiles'::regclass),
  '{4} -> profiles n',
  'G3 its author is a profile, forgotten when the profile goes'
);

-- A personal template that no company write may touch.
select is(
  pg_temp.mt_run('engineer_1', $$insert into public.material_request_message_templates (message_template, line_template)
    values ('Perso 1 {lignes}', '- {désignation}')$$),
  'ok 1',
  'fixture: engineer 1 keeps a personal template'
);

select matches(
  pg_temp.mt_run('engineer_1', $$insert into public.tenant_consultation_message_templates (message_template, line_template)
    values ('Société {lignes}', '{désignation}')$$),
  '^42501 ',
  'G2 a direct insert is refused'
);
select matches(
  pg_temp.mt_run('anon', $$select public.save_tenant_consultation_message_template('Société {lignes}', '{désignation}')$$),
  '^42501 ',
  'G2 anon cannot save a company template'
);
select matches(
  pg_temp.mt_run('engineer_1', $$select public.save_tenant_consultation_message_template('Société {lignes}', '{désignation}')$$),
  '^42501 TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY',
  'G2 a member who is not an admin cannot save it'
);
select matches(
  pg_temp.mt_run('global_admin', $$select public.save_tenant_consultation_message_template('Société {lignes}', '{désignation}')$$),
  '^42501 TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY',
  'G2 a global admin without an admin role in the tenant cannot save it'
);
select matches(
  pg_temp.mt_run('engineer_1', 'select public.reset_tenant_consultation_message_template()'),
  '^42501 TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY',
  'G2 nor reset it'
);
select is(pg_temp.mt_all(), ' || tenant_a:engineer_1:Perso 1 {lignes}', 'G5 the refusals wrote nothing');

select is(
  pg_temp.mt_run('admin_b', $$select public.save_tenant_consultation_message_template('Société B {lignes}', '{désignation}')$$),
  'ok 1',
  'G the admin of tenant B saves the template of tenant B'
);
select is(
  pg_temp.mt_run('admin_a', $$select public.save_tenant_consultation_message_template('Société A {lignes}', '- {désignation}')$$),
  'ok 1',
  'G3 the admin of tenant A saves the template of their active tenant'
);
select is(
  pg_temp.mt_all(),
  'tenant_a:Société A {lignes}:- {désignation}:admin_a | tenant_b:Société B {lignes}:{désignation}:admin_b || tenant_a:engineer_1:Perso 1 {lignes}',
  'G3, G5 each in its own tenant under its admin''s name; tenant B''s and the personal template untouched'
);
select ok(
  (select company.updated_at > now() - interval '1 minute' from public.tenant_consultation_message_templates company
   where company.tenant_id = pg_temp.fx('tenant_a')),
  'G3 dated by the database'
);
select is(
  pg_get_function_result('public.save_tenant_consultation_message_template(text, text)'::regprocedure),
  'TABLE(tenant_id uuid, message_template text, line_template text)',
  'G1 the writer answers the tenant and the two texts, never the author'
);
select is(
  pg_temp.mt_run('admin_a', $$select public.save_tenant_consultation_message_template('Société A2 {lignes}', '* {désignation}')$$),
  'ok 1',
  'G3 a second save replaces the template'
);
select is(
  pg_temp.mt_all(),
  'tenant_a:Société A2 {lignes}:* {désignation}:admin_a | tenant_b:Société B {lignes}:{désignation}:admin_b || tenant_a:engineer_1:Perso 1 {lignes}',
  'G3, G5 one row per tenant; tenant B''s and the personal template untouched'
);

select is(pg_temp.mt_company('engineer_1'), 'tenant_a:Société A2 {lignes}', 'G1 a member reads their tenant''s template');
select is(pg_temp.mt_company('admin_b'), 'tenant_b:Société B {lignes}', 'G1 and only it');
select matches(
  pg_temp.mt_run('engineer_1', 'select updated_by from public.tenant_consultation_message_templates'),
  '^42501 ',
  'G1 a member cannot read who wrote it'
);
select matches(
  pg_temp.mt_run('engineer_1', 'select * from public.tenant_consultation_message_templates'),
  '^42501 ',
  'G1 nor read it all with *'
);
select matches(
  pg_temp.mt_run('engineer_1', $$update public.tenant_consultation_message_templates set message_template = 'Piraté {lignes}'$$),
  '^42501 ',
  'G2 a direct update is refused'
);
select matches(
  pg_temp.mt_run('admin_a', 'delete from public.tenant_consultation_message_templates'),
  '^42501 ',
  'G2 a direct delete is refused, even to an admin'
);
select pg_temp.mt_activate('engineer_2', 'tenant_b');
select is(pg_temp.mt_company('engineer_2'), 'tenant_b:Société B {lignes}', 'G1 a member of two tenants reads the active one''s');
update public.tenants set is_active = false where id = pg_temp.fx('tenant_b');
select is(pg_temp.mt_company('engineer_2'), 'tenant_a:Société A2 {lignes}', 'G1 a suspended tenant''s template is not read');
update public.tenants set is_active = true where id = pg_temp.fx('tenant_b');
select pg_temp.mt_activate('engineer_2', 'tenant_a');

-- G4: bounds, through the writer.
select matches(
  pg_temp.mt_run('admin_a', format('select public.save_tenant_consultation_message_template(%L, %L)', repeat('m', 1993) || '{lignes}', '{désignation}')),
  '^23514 ',
  'G4 a company message template of 2001 characters is refused'
);
select matches(
  pg_temp.mt_run('admin_a', format('select public.save_tenant_consultation_message_template(%L, %L)', '{lignes}', repeat('l', 288) || '{désignation}')),
  '^23514 ',
  'G4 a company line template of 301 characters is refused'
);
select matches(
  pg_temp.mt_run('admin_a', format('select public.save_tenant_consultation_message_template(%L, %L)', E' \t\n ', '{désignation}')),
  '^23514 ',
  'G4 a blank company message template is refused'
);
select matches(
  pg_temp.mt_run('admin_a', 'select public.save_tenant_consultation_message_template(null, null)'),
  '^23502 ',
  'G4 a missing text is refused'
);
select is(
  pg_temp.mt_run('admin_a', format('select public.save_tenant_consultation_message_template(%L, %L)', repeat('m', 1992) || '{lignes}', repeat('l', 287) || '{désignation}')),
  'ok 1',
  'G4 the bounds themselves are kept'
);

-- G2: an admin of two tenants writes only into the active one.
select is(
  pg_temp.mt_all(),
  format('tenant_a:%s:%s:admin_a | tenant_b:Société B {lignes}:{désignation}:admin_b || tenant_a:engineer_1:Perso 1 {lignes}',
    repeat('m', 1992) || '{lignes}', repeat('l', 287) || '{désignation}'),
  'G2 admin 1, also an admin of tenant B, never wrote into tenant B'
);

-- G3: « Rétablir le message d’origine » deletes the row, and can be repeated.
select is(
  pg_temp.mt_run('admin_a', 'select public.reset_tenant_consultation_message_template()'),
  'ok 1',
  'G3 the admin resets the company template'
);
select is(
  pg_temp.mt_run('admin_a', 'select public.reset_tenant_consultation_message_template()'),
  'ok 1',
  'G3 a second reset is harmless'
);
select is(
  pg_temp.mt_all(),
  'tenant_b:Société B {lignes}:{désignation}:admin_b || tenant_a:engineer_1:Perso 1 {lignes}',
  'G3, G5 tenant A has no company template any more; tenant B''s and the personal template untouched'
);
select is(pg_temp.mt_company('engineer_1'), '', 'G1 and its members read none');

-- G5, T9: a deleted tenant takes its company template and its members' templates with it.
insert into public.tenants (id, name, slug) values ('7e691000-0000-4000-8000-0000000000c0', 'TI691 Société C', 'ti691-societe-c');
insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
values ('7e691000-0000-4000-8000-000000000041', '7e691000-0000-4000-8000-0000000000c0', pg_temp.fx('admin_b'), 'admin', false);
select pg_temp.mt_activate('admin_b', '7e691000-0000-4000-8000-0000000000c0');
select is(
  pg_temp.mt_run('admin_b', $$select public.save_tenant_consultation_message_template('Société C {lignes}', '{désignation}')$$) || ' / ' ||
  pg_temp.mt_run('admin_b', $$insert into public.material_request_message_templates (message_template, line_template)
    values ('Admin C {lignes}', '{désignation}')$$),
  'ok 1 / ok 1',
  'G5 tenant C holds a company template and a member''s'
);
-- Rows the tenant's creation bootstrapped elsewhere (feature flags, estimate rules...) do not cascade: removed
-- first, from every table whose key to the tenant restricts its deletion.
do $bootstrap$
declare
  reference record;
begin
  for reference in
    select constraint_.conrelid::regclass as owner, attribute.attname as column_name
    from pg_constraint constraint_
    join pg_attribute attribute
      on attribute.attrelid = constraint_.conrelid and attribute.attnum = constraint_.conkey[1]
    where constraint_.contype = 'f'
      and constraint_.confrelid = 'public.tenants'::regclass
      and constraint_.confdeltype in ('a', 'r')
      and array_length(constraint_.conkey, 1) = 1
  loop
    execute format('delete from %s where %I = %L', reference.owner, reference.column_name,
      '7e691000-0000-4000-8000-0000000000c0');
  end loop;
end;
$bootstrap$;
delete from public.tenants where id = '7e691000-0000-4000-8000-0000000000c0';
select is(
  (select count(*)::integer from public.tenant_consultation_message_templates
   where tenant_id = '7e691000-0000-4000-8000-0000000000c0')
  + (select count(*)::integer from public.material_request_message_templates
     where tenant_id = '7e691000-0000-4000-8000-0000000000c0'),
  0,
  'G5 deleting the tenant deletes both'
);

select * from finish();
rollback;
