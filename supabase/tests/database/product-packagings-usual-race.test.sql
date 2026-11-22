-- Sale packagings of an article: two members mark two different packagings usual at the same time (migration
-- 20261122092341_product_packagings.sql). Isolation justified: the failure needs two sessions whose writes
-- interleave, which no journey does deterministically. Written before the article lock.
-- Without a lock, the second move clears the usual packaging it can see (the former one, as last committed), then
-- collides with the first move's uncommitted mark on the unique index and fails once the first commits: one move
-- is lost with an error the office did not cause. With the lock, the second move waits for the first, then sees its
-- mark, takes it, and the article ends with exactly one usual packaging: the last one chosen.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Every session connects to the same disposable local PostgreSQL socket; the fixtures are committed because
-- independent sessions must see them, and removed at the end.
create temp table usual_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect('usual_setup', (select connection from usual_race_connection)), 'OK', 'fixture session connected');
select is(extensions.dblink_connect('usual_first', (select connection from usual_race_connection)), 'OK', 'first session connected');
select is(extensions.dblink_connect('usual_second', (select connection from usual_race_connection)), 'OK', 'second session connected');

-- A fictional admin of their own tenant; an article in ml with three packagings, « Barre » usual.
select is(extensions.dblink_exec('usual_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'a7c0a6e1-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'usual-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.products (id, tenant_id, designation, unit, unit_price_cents)
select 'a7c0a6e1-0000-4000-8000-000000000301', m.tenant_id, 'Tube de la course (fictif)', 'ml', 1000
from public.tenant_memberships m where m.user_id = 'a7c0a6e1-0000-4000-8000-000000000001' and m.is_default and m.role = 'admin';
insert into public.product_packagings (id, product_id, label, quantity, is_usual) values
  ('a7c0a6e1-0000-4000-8000-000000000401', 'a7c0a6e1-0000-4000-8000-000000000301', 'Barre', 6, true),
  ('a7c0a6e1-0000-4000-8000-000000000402', 'a7c0a6e1-0000-4000-8000-000000000301', 'Touret', 100, false),
  ('a7c0a6e1-0000-4000-8000-000000000403', 'a7c0a6e1-0000-4000-8000-000000000301', 'Couronne', 50, false);
commit;
$setup$), 'COMMIT', 'fixture article and packagings committed');
select is((select count(*)::integer from public.product_packagings where product_id = 'a7c0a6e1-0000-4000-8000-000000000301'), 3,
  'the fixture article has three packagings');

-- Both sessions act as the admin, through the policies.
select is(extensions.dblink_exec(session, $claims$
set role authenticated;
set request.jwt.claim.sub = 'a7c0a6e1-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"a7c0a6e1-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$), 'SET', format('%s session signed in as the admin', session))
from unnest(array['usual_first', 'usual_second']) as session;

-- The first session marks « Touret » usual and holds its transaction open.
select is(extensions.dblink_exec('usual_first', $first$
begin;
update public.product_packagings set is_usual = true where id = 'a7c0a6e1-0000-4000-8000-000000000402';
$first$), 'UPDATE 1', 'the first move is made, not committed yet');
-- The second session marks « Couronne » usual meanwhile.
select is(extensions.dblink_send_query('usual_second',
  $$update public.product_packagings set is_usual = true where id = 'a7c0a6e1-0000-4000-8000-000000000403'$$), 1,
  'the second move starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('usual_second'), 1, 'the second move waits for the first, on the article');
select is(extensions.dblink_exec('usual_first', 'commit'), 'COMMIT', 'the first move commits');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('usual_second'), 0, 'the second move is done');
select is(extensions.dblink_error_message('usual_second'), 'OK', 'the second move succeeds');
select is((select status from extensions.dblink_get_result('usual_second', false) as x(status text)), 'UPDATE 1',
  'the second move updated its packaging');
select is((select count(*)::integer from extensions.dblink_get_result('usual_second', false) as x(status text)), 0,
  'the second move has nothing more to answer');
select is(
  (select array_agg(label order by position) from public.product_packagings
   where product_id = 'a7c0a6e1-0000-4000-8000-000000000301' and is_usual),
  array['Couronne'],
  'the article ends with one usual packaging: the last one chosen'
);

-- Clean the committed synthetic fixtures: the article (its packagings go with it), the personal tenant, the profile
-- and the user.
select is(extensions.dblink_exec('usual_setup', $cleanup$
begin;
delete from public.products where id = 'a7c0a6e1-0000-4000-8000-000000000301';
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'a7c0a6e1-0000-4000-8000-000000000001' and is_default);
  entry record;
begin
  for entry in
    select columns.table_schema, columns.table_name
    from information_schema.columns as columns
    join information_schema.tables as tables
      on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
    where columns.table_schema in ('public', 'private') and columns.column_name = 'tenant_id'
      and tables.table_type = 'BASE TABLE' and not (columns.table_schema = 'public' and columns.table_name = 'tenants')
  loop
    execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
  end loop;
  delete from public.tenants where id = target;
end
$clean$;
delete from public.profiles where id = 'a7c0a6e1-0000-4000-8000-000000000001';
delete from auth.users where id = 'a7c0a6e1-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.product_packagings where product_id = 'a7c0a6e1-0000-4000-8000-000000000301'), 0,
  'no fixture packaging is left');
select is(extensions.dblink_disconnect('usual_setup'), 'OK', 'fixture session disconnected');
select is(extensions.dblink_disconnect('usual_first'), 'OK', 'first session disconnected');
select is(extensions.dblink_disconnect('usual_second'), 'OK', 'second session disconnected');
select * from finish();
rollback;
