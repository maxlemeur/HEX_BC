-- TI-711: exercise undo lock ordering and deployed supplier reference writes against concurrent commits.
begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table undo_race_connection as
select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as conn;
select is(extensions.dblink_connect(session.name, (select conn from undo_race_connection)), 'OK',
  format('%s connected', session.name))
from (values ('workbook_writer'), ('workbook_undo'), ('workbook_review')) as session(name);

-- Fixtures are committed so independent sessions see them. The first draft gains a usual name,
-- the second a pending reference. The last two hold the pending pairs that the deployed save and edit
-- will find and their respective reference-batch undos will remove.
select is(extensions.dblink_exec('workbook_writer', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated',
  fixture.email, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('a711ace0-0000-4000-8000-000000000001'::uuid, 'workbook-undo-race@example.test'),
  ('a711ace0-0000-4000-8000-000000000002'::uuid, 'workbook-undo-engineer@example.test'),
  ('a711ace0-0000-4000-8000-000000000003'::uuid, 'workbook-undo-viewer@example.test')
) as fixture(id, email);
select set_config('workbook_race.tenant_id', tenant_id::text, false)
from public.tenant_memberships where user_id = 'a711ace0-0000-4000-8000-000000000001' and is_default;
delete from public.tenant_memberships
where user_id in ('a711ace0-0000-4000-8000-000000000002', 'a711ace0-0000-4000-8000-000000000003');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
values
  (current_setting('workbook_race.tenant_id')::uuid, 'a711ace0-0000-4000-8000-000000000002', 'engineer', true),
  (current_setting('workbook_race.tenant_id')::uuid, 'a711ace0-0000-4000-8000-000000000003', 'viewer', true);
insert into public.catalogue_import_batches (id, tenant_id, kind, created_by)
select batch.id, current_setting('workbook_race.tenant_id')::uuid, batch.kind, 'a711ace0-0000-4000-8000-000000000001'
from (values ('a711ace0-0000-4000-8000-000000000010'::uuid, 'workbook_articles'),
  ('a711ace0-0000-4000-8000-000000000011'::uuid, 'workbook_supplier_references'),
  ('a711ace0-0000-4000-8000-000000000012'::uuid, 'workbook_supplier_references'),
  ('a711ace0-0000-4000-8000-000000000013'::uuid, 'workbook_articles'),
  ('a711ace0-0000-4000-8000-000000000014'::uuid, 'workbook_articles')) as batch(id, kind);
insert into public.catalogue_import_batches (id, tenant_id, kind, created_by)
values ('a711ace0-0000-4000-8000-000000000015', current_setting('workbook_race.tenant_id')::uuid,
  'workbook_articles', 'a711ace0-0000-4000-8000-000000000002');
insert into public.suppliers (id, tenant_id, name)
values ('a711ace0-0000-4000-8000-000000000020', current_setting('workbook_race.tenant_id')::uuid, 'Fournisseur fictif');
set local role authenticated;
set local request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000001';
insert into public.products (id, designation, unit, unit_price_cents, catalogue_status, import_batch_id) values
  ('a711ace0-0000-4000-8000-000000000031', 'Tube fictif', 'u', 0, 'draft', 'a711ace0-0000-4000-8000-000000000010'),
  ('a711ace0-0000-4000-8000-000000000032', 'Coude fictif', 'u', 0, 'draft', 'a711ace0-0000-4000-8000-000000000010'),
  ('a711ace0-0000-4000-8000-000000000033', 'Bride fictive', 'u', 0, 'draft', null),
  ('a711ace0-0000-4000-8000-000000000034', 'Manchon fictif', 'u', 0, 'draft', null),
  ('a711ace0-0000-4000-8000-000000000035', 'Vanne fictive', 'u', 0, 'draft', 'a711ace0-0000-4000-8000-000000000013'),
  ('a711ace0-0000-4000-8000-000000000036', 'Bouchon fictif', 'u', 0, 'draft', 'a711ace0-0000-4000-8000-000000000013');
reset role;
insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku,
  is_active, reference_needs_review, import_batch_id)
values
  ('a711ace0-0000-4000-8000-000000000040', current_setting('workbook_race.tenant_id')::uuid,
    'a711ace0-0000-4000-8000-000000000020', 'a711ace0-0000-4000-8000-000000000033', 'FICTIF-40',
    false, true, 'a711ace0-0000-4000-8000-000000000011'),
  ('a711ace0-0000-4000-8000-000000000041', current_setting('workbook_race.tenant_id')::uuid,
    'a711ace0-0000-4000-8000-000000000020', 'a711ace0-0000-4000-8000-000000000034', 'FICTIF-41',
    false, true, 'a711ace0-0000-4000-8000-000000000012'),
  ('a711ace0-0000-4000-8000-000000000042', current_setting('workbook_race.tenant_id')::uuid,
    'a711ace0-0000-4000-8000-000000000020', 'a711ace0-0000-4000-8000-000000000036', 'FICTIF-36',
    false, true, null);

-- Pause the deployed write after it has found the pair and before the UPDATE can lock it.
create function private.pause_workbook_undo_race_update() returns trigger language plpgsql as $pause$
begin
  if current_setting('workbook_race.pause_update', true) = 'on' then
    perform pg_catalog.pg_advisory_xact_lock(711, 186);
  end if;
  return null;
end;
$pause$;
create trigger pause_workbook_undo_race_update before update on public.supplier_catalog_items
for each statement execute function private.pause_workbook_undo_race_update();

-- The late-reference case must keep the draft before DELETE reaches the restrictive foreign key.
create function private.forbid_workbook_undo_race_product_delete() returns trigger language plpgsql as $guard$
begin
  if current_setting('workbook_race.forbid_product_delete', true) = 'on' then
    raise exception 'Undo attempted to delete a draft protected by an unlocked reference.';
  end if;
  return null;
end;
$guard$;
create trigger forbid_workbook_undo_race_product_delete before delete on public.products
for each statement execute function private.forbid_workbook_undo_race_product_delete();
commit;
$setup$), 'COMMIT', 'race fixtures committed');

select is(extensions.dblink_exec(session.name, $claims$
set role authenticated;
set request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000001';
set statement_timeout = '15s'
$claims$), 'SET', format('%s acts as the fixture administrator', session.name))
from (values ('workbook_writer'), ('workbook_undo'), ('workbook_review')) as session(name);

create temp table undo_race_pids as
select session.name, remote.pid
from (values ('workbook_writer'), ('workbook_undo'), ('workbook_review')) as session(name)
cross join lateral extensions.dblink(session.name, 'select pg_backend_pid()') as remote(pid integer);

create function pg_temp.workbook_undo_waits_for(blocker text default 'workbook_writer')
returns boolean language plpgsql as $$
declare
  blocking_pid integer := (select pid from undo_race_pids where name = blocker);
  undo_pid integer := (select pid from undo_race_pids where name = 'workbook_undo');
begin
  for attempt in 1..200 loop
    if blocking_pid = any(pg_catalog.pg_blocking_pids(undo_pid)) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;

-- Rejected calls must finish while a writer still holds the batch row.
select is(extensions.dblink_exec('workbook_writer', $lock$
begin;
reset role;
do $row$ begin
  perform 1 from public.catalogue_import_batches where id = 'a711ace0-0000-4000-8000-000000000014' for update;
end; $row$;
$lock$), 'DO', 'the writer holds the batch row');
select is(extensions.dblink_exec('workbook_undo', $settings$
set lock_timeout = '250ms';
set request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000003';
$settings$), 'SET', 'undo session acts as a viewer with a short lock timeout');
select throws_ok(
  $$select * from extensions.dblink('workbook_undo',
    'select public.undo_catalogue_import_batch(''a711ace0-0000-4000-8000-000000000014'')') as response(result jsonb)$$,
  '42501', 'CATALOGUE_IMPORT_UNDO_FORBIDDEN', 'a viewer is refused while the batch is locked'
);
select is(extensions.dblink_exec('workbook_undo',
  $$set request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000002'$$), 'SET', 'undo session acts as a different engineer');
select throws_ok(
  $$select * from extensions.dblink('workbook_undo',
    'select public.undo_catalogue_import_batch(''a711ace0-0000-4000-8000-000000000014'')') as response(result jsonb)$$,
  '42501', 'CATALOGUE_IMPORT_UNDO_FORBIDDEN', 'a non-author engineer is refused while the batch is locked'
);
select is(extensions.dblink_exec('workbook_undo',
  $$set request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000001'$$), 'SET', 'undo session acts as the administrator');
select throws_ok(
  $$select * from extensions.dblink('workbook_undo',
    'select public.undo_catalogue_import_batch(''a711ace0-0000-4000-8000-000000000014'', 0)') as response(result jsonb)$$,
  '22023', 'CATALOGUE_IMPORT_UNDO_INVALID', 'an invalid page size is refused while the batch is locked'
);
select is(extensions.dblink_exec('workbook_undo', 'reset lock_timeout'), 'RESET', 'restore the authorized caller lock timeout');
select is(extensions.dblink_send_query('workbook_undo',
  $$select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000014')$$), 1, 'authorized undo starts');
select ok(pg_temp.workbook_undo_waits_for(), 'authorized undo waits for the batch row');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the writer releases the batch row');
select is((select result from extensions.dblink_get_result('workbook_undo') as response(result jsonb)),
  '{"deleted": 0, "kept": 0, "done": true}'::jsonb, 'authorized undo proceeds after the batch row is released');
select count(*) from extensions.dblink_get_result('workbook_undo') as response(result jsonb);

-- Model the ON DELETE SET NULL on the author foreign key while the author can still see the old row.
select is(extensions.dblink_exec('workbook_writer', $clear_author$
begin;
update public.catalogue_import_batches set created_by = null where id = 'a711ace0-0000-4000-8000-000000000015';
$clear_author$), 'UPDATE 1', 'the writer clears the author without committing yet');
select is(extensions.dblink_exec('workbook_undo',
  $$set request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000002'$$), 'SET', 'undo session acts as the batch author');
select is(extensions.dblink_send_query('workbook_undo',
  $$select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000015')$$), 1, 'the apparent author starts undo');
select ok(pg_temp.workbook_undo_waits_for(), 'the apparent author reaches the batch lock');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the author change commits');
select throws_ok(
  $$select * from extensions.dblink_get_result('workbook_undo') as response(result jsonb)$$,
  '42501', 'CATALOGUE_IMPORT_UNDO_FORBIDDEN', 'the locked row no longer authorizes the engineer'
);
select count(*) from extensions.dblink_get_result('workbook_undo', false) as response(result jsonb);
select is(extensions.dblink_exec('workbook_undo',
  $$set request.jwt.claim.sub = 'a711ace0-0000-4000-8000-000000000001'$$), 'SET', 'restore the undo session administrator');
select is(extensions.dblink_exec('workbook_writer', 'set role authenticated'), 'SET', 'restore the writer session role');

select is(extensions.dblink_exec('workbook_writer', $alias$
begin;
do $lock$
begin
  perform 1 from public.products where id = 'a711ace0-0000-4000-8000-000000000031' for update;
end;
$lock$;
insert into public.product_aliases (product_id, alias, alias_key)
values ('a711ace0-0000-4000-8000-000000000031', 'Tube atelier', 'tube atelier');
$alias$), 'INSERT 0 1', 'the writer holds the draft and adds an uncommitted usual name');
select is(extensions.dblink_send_query('workbook_undo',
  $$select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000010', 1)$$), 1, 'undo page one starts');
select ok(pg_temp.workbook_undo_waits_for(), 'undo waits for the first article lock');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the usual name commits');
select is((select result from extensions.dblink_get_result('workbook_undo') as response(result jsonb)),
  '{"deleted": 0, "kept": 1, "done": false}'::jsonb, 'a fresh snapshot sees the usual name and keeps its draft');
select count(*) from extensions.dblink_get_result('workbook_undo') as response(result jsonb);
select is((select product_id from public.product_aliases where alias_key = 'tube atelier'
  and product_id = 'a711ace0-0000-4000-8000-000000000031'),
  'a711ace0-0000-4000-8000-000000000031'::uuid, 'the concurrent usual name survives');

select is(extensions.dblink_exec('workbook_writer', $reference$
begin;
do $lock$
begin
  perform 1 from public.products where id = 'a711ace0-0000-4000-8000-000000000032' for update;
end;
$lock$;
select public.import_workbook_supplier_references(current_setting('workbook_race.tenant_id')::uuid,
  jsonb_build_array(jsonb_build_object('product_id', product.id, 'product_reference', product.reference,
    'supplier_id', 'a711ace0-0000-4000-8000-000000000020', 'supplier_name', 'Fournisseur fictif', 'supplier_sku', 'FICTIF-32')))
from public.products product where product.id = 'a711ace0-0000-4000-8000-000000000032';
set local statement_timeout = '15s';
$reference$), 'SET', 'the writer holds the second draft and imports an uncommitted pending reference');
select is(extensions.dblink_exec('workbook_undo', 'set workbook_race.forbid_product_delete = on'), 'SET',
  'the second undo page must keep the draft before attempting a delete');
select is(extensions.dblink_send_query('workbook_undo',
  $$select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000010', 1)$$), 1, 'undo page two starts');
select ok(pg_temp.workbook_undo_waits_for(), 'undo waits for the second article lock');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the pending reference commits');
select is((select result from extensions.dblink_get_result('workbook_undo', false) as response(result jsonb)),
  '{"deleted": 0, "kept": 1, "done": true}'::jsonb, 'a reference absent from the locked ids keeps its draft without attempting a delete');
select count(*) from extensions.dblink_get_result('workbook_undo') as response(result jsonb);
select ok((select survives from extensions.dblink('workbook_writer', $check$
  select exists (select 1 from public.supplier_catalog_items
    where product_id = 'a711ace0-0000-4000-8000-000000000032' and supplier_sku = 'FICTIF-32' and reference_needs_review)
$check$) as response(survives boolean)),
  'the concurrent pending reference survives');

create function pg_temp.workbook_undo_race_result(connection_name text)
returns jsonb language plpgsql as $$
begin
  return (select result from extensions.dblink_get_result(connection_name) as response(result jsonb));
exception when deadlock_detected then
  return pg_catalog.jsonb_build_object('sqlstate', sqlstate);
end;
$$;

-- The review holds B's reference while undo takes A's article lock. The late reference forces
-- undo to keep A. Undo then waits on B's reference while the review tries to lock A's article.
select is(extensions.dblink_exec('workbook_review', $second_reference$
begin;
reset role;
do $lock$
begin
  perform 1 from public.supplier_catalog_items where id = 'a711ace0-0000-4000-8000-000000000042' for update;
end;
$lock$;
set role authenticated;
$second_reference$), 'SET', 'the reviewer holds the second article reference');
select is(extensions.dblink_exec('workbook_writer', $late_reference$
begin;
do $lock$
begin
  perform 1 from public.products where id = 'a711ace0-0000-4000-8000-000000000035' for update;
end;
$lock$;
select public.import_workbook_supplier_references(current_setting('workbook_race.tenant_id')::uuid,
  jsonb_build_array(jsonb_build_object('product_id', product.id, 'product_reference', product.reference,
    'supplier_id', 'a711ace0-0000-4000-8000-000000000020', 'supplier_name', 'Fournisseur fictif', 'supplier_sku', 'FICTIF-35')))
from public.products product where product.id = 'a711ace0-0000-4000-8000-000000000035';
set local statement_timeout = '15s';
$late_reference$), 'SET', 'the writer holds the first article and imports its late reference');
select is(extensions.dblink_send_query('workbook_undo',
  $$select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000013', 2)$$), 1,
  'undo starts a page spanning both articles');
select ok(pg_temp.workbook_undo_waits_for(), 'undo scanned before the late reference commit and waits for the first article');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the late reference commits');
select ok(pg_temp.workbook_undo_waits_for('workbook_review'), 'undo keeps the first article and waits for the second reference');

select is(extensions.dblink_send_query('workbook_review', $review$
  select public.review_supplier_references(array(
    select item.id from public.supplier_catalog_items item
    where item.product_id in ('a711ace0-0000-4000-8000-000000000035', 'a711ace0-0000-4000-8000-000000000036')
  ), true)
$review$), 1, 'bulk review starts with both pending references');
select is(pg_temp.workbook_undo_race_result('workbook_review'),
  '{"reviewed": 2, "skipped": 0}'::jsonb, 'bulk review completes without waiting on the kept article');
select count(*) from extensions.dblink_get_result('workbook_review', false) as response(result jsonb);
select is(extensions.dblink_exec('workbook_review', 'commit'), 'COMMIT', 'bulk review commits and releases the second reference');
select is(pg_temp.workbook_undo_race_result('workbook_undo'),
  '{"deleted": 0, "kept": 2, "done": true}'::jsonb, 'undo completes the two-article page without a deadlock');
select count(*) from extensions.dblink_get_result('workbook_undo', false) as response(result jsonb);
select is((select validated from extensions.dblink('workbook_writer', $check$
  select count(*)::integer from public.supplier_catalog_items
  where product_id in ('a711ace0-0000-4000-8000-000000000035', 'a711ace0-0000-4000-8000-000000000036')
    and is_active and not reference_needs_review
$check$) as response(validated integer)), 2, 'both validated references survive the undo');

select is(extensions.dblink_exec('workbook_undo', 'set workbook_race.pause_update = on'), 'SET', 'the update pause is armed');
select is(extensions.dblink_exec('workbook_writer', $barrier$
begin;
do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(711, 186); end; $lock$;
$barrier$), 'DO', 'the writer holds the save barrier');
select is(extensions.dblink_send_query('workbook_undo', $save$
  select public.save_supplier_catalog_item('a711ace0-0000-4000-8000-000000000033',
    'a711ace0-0000-4000-8000-000000000020', 'FICTIF-SAVED', null)
$save$), 1, 'the deployed save finds the existing pair and starts its update');
select ok(pg_temp.workbook_undo_waits_for(), 'the save pauses between the conflict and the row update');
select is((select result from extensions.dblink('workbook_writer', $undo$
  select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000011')
$undo$) as response(result jsonb)),
  '{"deleted": 1, "kept": 0, "done": true}'::jsonb, 'the undo deletes the pair while the save is paused');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the undo commits and releases the save');
create temp table undo_race_save_result as
select id from extensions.dblink_get_result('workbook_undo') as response(id uuid);
select count(*) from extensions.dblink_get_result('workbook_undo') as response(id uuid);
select results_eq(
  'select id from undo_race_save_result',
  $expected$select id from extensions.dblink('workbook_writer', $check$
    select item.id from public.supplier_catalog_items item
    where item.product_id = 'a711ace0-0000-4000-8000-000000000033'
      and item.id <> 'a711ace0-0000-4000-8000-000000000040'
      and item.supplier_sku = 'FICTIF-SAVED' and item.is_active and not item.reference_needs_review
  $check$) as response(id uuid)$expected$,
  'the save retries and returns the id of the replacement pair it saved'
);

select is(extensions.dblink_exec('workbook_writer', $barrier$
begin;
do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(711, 186); end; $lock$;
$barrier$), 'DO', 'the writer holds the barrier for the edit by id');
select is(extensions.dblink_send_query('workbook_undo', $edit$
  select public.update_supplier_catalog_item('a711ace0-0000-4000-8000-000000000041', 'FICTIF-EDIT', null)
$edit$), 1, 'the deployed edit starts with the existing id');
select ok(pg_temp.workbook_undo_waits_for(), 'the edit has read the row and pauses at its UPDATE');
select is((select result from extensions.dblink('workbook_writer', $undo$
  select public.undo_catalogue_import_batch('a711ace0-0000-4000-8000-000000000012')
$undo$) as response(result jsonb)),
  '{"deleted": 1, "kept": 0, "done": true}'::jsonb, 'the undo removes the row while the edit is paused');
select is(extensions.dblink_exec('workbook_writer', 'commit'), 'COMMIT', 'the undo commits before the edit can write');
select throws_ok(
  $$select * from extensions.dblink_get_result('workbook_undo') as response(result jsonb)$$,
  'P0002', 'Supplier catalogue item not found.', 'the edit by id reports the disappeared row'
);
select count(*) from extensions.dblink_get_result('workbook_undo', false) as response(result jsonb);
select is((select items from extensions.dblink('workbook_writer', $check$
  select count(*)::integer from public.supplier_catalog_items
  where product_id = 'a711ace0-0000-4000-8000-000000000034'
$check$) as response(items integer)), 0, 'the losing edit leaves no supplier reference behind');

select extensions.dblink_exec(session.name, 'rollback', false)
from (values ('workbook_writer'), ('workbook_undo'), ('workbook_review')) as session(name);
select is(extensions.dblink_exec('workbook_writer', $cleanup$
begin;
reset role;
reset request.jwt.claim.sub;
drop trigger pause_workbook_undo_race_update on public.supplier_catalog_items;
drop function private.pause_workbook_undo_race_update();
drop trigger forbid_workbook_undo_race_product_delete on public.products;
drop function private.forbid_workbook_undo_race_product_delete();
set local session_replication_role = replica;
do $clean$
declare
  targets uuid[] := array(
    select id from public.tenants
    where created_by in (
      'a711ace0-0000-4000-8000-000000000001', 'a711ace0-0000-4000-8000-000000000002', 'a711ace0-0000-4000-8000-000000000003')
  );
  entry record;
begin
  for entry in
    select table_schema, table_name
    from information_schema.columns
    join information_schema.tables using (table_schema, table_name)
    where column_name = 'tenant_id' and table_schema in ('public', 'private')
      and table_type = 'BASE TABLE' and not (table_schema = 'public' and table_name in ('tenants', 'audit_logs'))
  loop
    execute format('delete from %I.%I where tenant_id = any($1)', entry.table_schema, entry.table_name) using targets;
  end loop;
  delete from public.audit_logs where tenant_id = any(targets);
  delete from public.tenants where id = any(targets);
end;
$clean$;
delete from public.profiles where id in (
  'a711ace0-0000-4000-8000-000000000001', 'a711ace0-0000-4000-8000-000000000002', 'a711ace0-0000-4000-8000-000000000003');
delete from auth.users where id in (
  'a711ace0-0000-4000-8000-000000000001', 'a711ace0-0000-4000-8000-000000000002', 'a711ace0-0000-4000-8000-000000000003');
commit;
$cleanup$), 'COMMIT', 'committed fixtures and the test trigger are removed');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('workbook_writer'), ('workbook_undo'), ('workbook_review')) as session(name);

select * from finish();
rollback;
