-- Sale packagings of an article, written by two sessions at once (migration 20261122092341_product_packagings.sql).
-- Isolation justified: the failures need two sessions whose writes interleave, which no journey does
-- deterministically. Both cases were written before the code that makes them pass.
-- 1. Two members mark two different packagings usual. Without a lock, the second move clears the usual packaging it
--    can see (the former one, as last committed), then collides with the first move's uncommitted mark on the
--    unique index and fails once the first commits: one move is lost with an error the office did not cause. With
--    the article lock, the second move waits for the first, then sees its mark, takes it, and the article ends with
--    exactly one usual packaging: the last one chosen.
-- 2. A member adds the first packaging of an article while another one changes its unit. Reading the unit before
--    locking the article, the packaging took the former unit and failed on the foreign key once the change
--    committed. Locking first, it waits for the change, then takes the new unit.
-- Remote statements do not raise (fail_on_error false): a red step is reported and the committed fixtures are still
-- removed at the end.
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

-- A fictional admin of their own tenant. Article 301 in ml with three packagings, « Barre » usual; article 302 in ml
-- without any.
select is(extensions.dblink_exec('usual_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'a7c0a6e1-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'usual-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.products (id, tenant_id, designation, unit, unit_price_cents)
select article.id, m.tenant_id, article.designation, 'ml', 1000
from public.tenant_memberships m
cross join (values ('a7c0a6e1-0000-4000-8000-000000000301'::uuid, 'Tube de la course (fictif)'),
  ('a7c0a6e1-0000-4000-8000-000000000302'::uuid, 'Fil de la course (fictif)')) as article(id, designation)
where m.user_id = 'a7c0a6e1-0000-4000-8000-000000000001' and m.is_default and m.role = 'admin';
insert into public.product_packagings (id, product_id, label, quantity, is_usual) values
  ('a7c0a6e1-0000-4000-8000-000000000401', 'a7c0a6e1-0000-4000-8000-000000000301', 'Barre', 6, true),
  ('a7c0a6e1-0000-4000-8000-000000000402', 'a7c0a6e1-0000-4000-8000-000000000301', 'Touret', 100, false),
  ('a7c0a6e1-0000-4000-8000-000000000403', 'a7c0a6e1-0000-4000-8000-000000000301', 'Couronne', 50, false);
commit;
$setup$, false), 'COMMIT', 'fixture articles and packagings committed');
select is((select count(*)::integer from public.product_packagings where product_id = 'a7c0a6e1-0000-4000-8000-000000000301'), 3,
  'the fixture article has three packagings');

-- Both sessions act as the admin, through the policies.
select is(extensions.dblink_exec(session, $claims$
set role authenticated;
set request.jwt.claim.sub = 'a7c0a6e1-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"a7c0a6e1-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$, false), 'SET', format('%s session signed in as the admin', session))
from unnest(array['usual_first', 'usual_second']) as session;

-- ---------------------------------------------------------------------------
-- 1. Two usual moves.
-- ---------------------------------------------------------------------------
select is(extensions.dblink_exec('usual_first', $first$
begin;
update public.product_packagings set is_usual = true where id = 'a7c0a6e1-0000-4000-8000-000000000402';
$first$, false), 'UPDATE 1', 'the first move is made, not committed yet');
select is(extensions.dblink_send_query('usual_second',
  $$update public.product_packagings set is_usual = true where id = 'a7c0a6e1-0000-4000-8000-000000000403'$$), 1,
  'the second move starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('usual_second'), 1, 'the second move waits for the first, on the article');
select is(extensions.dblink_exec('usual_first', 'commit', false), 'COMMIT', 'the first move commits');
-- dblink_get_result waits for the second move to finish.
select is((select string_agg(status, ',') from extensions.dblink_get_result('usual_second', false) as x(status text)), 'UPDATE 1',
  'the second move updated its packaging');
select is(extensions.dblink_error_message('usual_second'), 'OK', 'the second move succeeds');
select is((select count(*)::integer from extensions.dblink_get_result('usual_second', false) as x(status text)), 0,
  'the second move has nothing more to answer');
select is(
  (select array_agg(label order by position) from public.product_packagings
   where product_id = 'a7c0a6e1-0000-4000-8000-000000000301' and is_usual),
  array['Couronne'],
  'the article ends with one usual packaging: the last one chosen'
);

-- ---------------------------------------------------------------------------
-- 2. The first packaging of an article whose unit is changing.
-- ---------------------------------------------------------------------------
select is(extensions.dblink_exec('usual_first', $first$
begin;
update public.products set unit = 'kg' where id = 'a7c0a6e1-0000-4000-8000-000000000302';
$first$, false), 'UPDATE 1', 'the unit change is made, not committed yet');
select is(extensions.dblink_send_query('usual_second',
  $$insert into public.product_packagings (product_id, label, quantity) values ('a7c0a6e1-0000-4000-8000-000000000302', 'Bobine', 25)$$), 1,
  'the first packaging is being added');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('usual_second'), 1, 'the packaging waits for the unit change, on the article');
select is(extensions.dblink_exec('usual_first', 'commit', false), 'COMMIT', 'the unit change commits');
select is((select string_agg(status, ',') from extensions.dblink_get_result('usual_second', false) as x(status text)), 'INSERT 0 1',
  'the packaging is added');
select is(extensions.dblink_error_message('usual_second'), 'OK', 'the packaging is not refused by the foreign key');
select is((select count(*)::integer from extensions.dblink_get_result('usual_second', false) as x(status text)), 0,
  'the insert has nothing more to answer');
select is(
  (select array_agg(row(label, unit)::text) from public.product_packagings where product_id = 'a7c0a6e1-0000-4000-8000-000000000302'),
  array[row('Bobine', 'kg')::text],
  'the packaging is in the article''s new unit'
);

-- A red step may leave a session inside a transaction that holds locks: end them before cleaning.
select extensions.dblink_exec(session, 'rollback', false) from unnest(array['usual_first', 'usual_second']) as session;

-- Clean the committed synthetic fixtures: the articles (their packagings go with them), the personal tenant, the
-- profile and the user.
select is(extensions.dblink_exec('usual_setup', $cleanup$
begin;
delete from public.products where id in ('a7c0a6e1-0000-4000-8000-000000000301', 'a7c0a6e1-0000-4000-8000-000000000302');
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
$cleanup$, false), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.products where id::text like 'a7c0a6e1-%'), 0, 'no fixture article is left');
select is(extensions.dblink_disconnect('usual_setup'), 'OK', 'fixture session disconnected');
select is(extensions.dblink_disconnect('usual_first'), 'OK', 'first session disconnected');
select is(extensions.dblink_disconnect('usual_second'), 'OK', 'second session disconnected');
select * from finish();
rollback;
