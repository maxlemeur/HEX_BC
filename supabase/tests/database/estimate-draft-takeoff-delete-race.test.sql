-- The source version's tuple lock serializes duplication and deletion. Exercise both commit
-- orders on engine 2, where the original FK used to clear provenance without an error.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select dblink_connect(name, format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()))
from (values ('draft_copy'), ('draft_delete')) as sessions(name);
select dblink_exec('draft_copy', $setup$
begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('dd730000-0000-4000-8000-000000000001','draft-copy@example.test','{}');
insert into public.estimate_projects(id,tenant_id,user_id,name)
select 'dd730000-0000-4000-8000-000000000010',tenant_id,user_id,'Draft copy'
from public.tenant_memberships where user_id='dd730000-0000-4000-8000-000000000001' and is_default;
insert into public.estimate_versions(id,tenant_id,project_id,version_number,status,calc_engine_version,margin_multiplier,tax_rate_bp)
select ('dd730000-0000-4000-8000-00000000001'||n)::uuid, tenant_id,id,n,'draft',2,1,0
from public.estimate_projects cross join generate_series(1,2) n where id='dd730000-0000-4000-8000-000000000010';
insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by)
select ('dd730000-0000-4000-8000-00000000002'||version_number)::uuid,tenant_id,id,'A','dd730000-0000-4000-8000-000000000001'
from public.estimate_versions where project_id='dd730000-0000-4000-8000-000000000010';
insert into public.estimate_items(tenant_id,version_id,item_type,position,title)
select tenant_id,id,'section',0,'Sanitaires' from public.estimate_versions
where project_id='dd730000-0000-4000-8000-000000000010';
insert into public.estimate_items(tenant_id,version_id,parent_id,item_type,position,title,source_provider,source_job_id,quantity,
  unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
select j.tenant_id,j.estimate_version_id,s.id,'line',1,'Lavabo','takeoff',j.id,3,0,0,1,0,1,0,0,0,0
from public.takeoff_jobs j join public.estimate_items s on s.version_id=j.estimate_version_id and s.item_type='section'
where j.project_id='dd730000-0000-4000-8000-000000000010';
commit;
$setup$);
select dblink_exec(name, $auth$
  set statement_timeout = '15s';
  set request.jwt.claim.sub = 'dd730000-0000-4000-8000-000000000001';
  set role authenticated;
$auth$) from (values ('draft_copy'), ('draft_delete')) as sessions(name);
create temp table pids as select name, backend.pid from (values ('draft_copy'), ('draft_delete')) as sessions(name)
cross join lateral dblink(name, 'select pg_backend_pid()') as backend(pid int);

create function pg_temp.blocked(waiter text, holder text) returns boolean language plpgsql as $$
declare
  waiting int := (select pid from pids where name = waiter);
  holding int := (select pid from pids where name = holder);
begin
  for n in 1..200 loop
    if holding = any(pg_blocking_pids(waiting)) then return true; end if;
    if dblink_is_busy(waiter) = 0 then return false; end if;
    perform pg_sleep(0.025);
  end loop;
  return false;
end;
$$;

select dblink_exec('draft_copy','begin');
create temp table new_copy as select id from dblink('draft_copy',
  $$select public.duplicate_estimate_version('dd730000-0000-4000-8000-000000000011',false)$$) as c(id uuid);
select dblink_send_query('draft_delete',
  $$delete from public.estimate_versions where id='dd730000-0000-4000-8000-000000000011' returning id$$);
select ok(pg_temp.blocked('draft_delete','draft_copy'),'deletion waits for the uncommitted copy');
select dblink_exec('draft_copy','commit');
select count(*) from dblink_get_result('draft_delete',false) as d(id uuid);
select matches(dblink_error_message('draft_delete'),'ESTIMATE_DRAFT_TAKEOFF_IN_USE', 'the committed copy prevents deletion');
select count(*) from dblink_get_result('draft_delete',false) as d(id uuid);
select results_eq($$select source_job_id,quantity from public.estimate_items where version_id=(select id from new_copy) and item_type='line'$$,
  $$values ('dd730000-0000-4000-8000-000000000021'::uuid,3::numeric)$$,'the copied line keeps its job and quantity');

select dblink_exec('draft_delete','begin');
select is(dblink_exec('draft_delete',$$delete from public.estimate_versions where id='dd730000-0000-4000-8000-000000000012'$$),
  'DELETE 1','unreferenced source is deleted');
select dblink_send_query('draft_copy',
  $$select public.duplicate_estimate_version('dd730000-0000-4000-8000-000000000012',false)$$);
select ok(pg_temp.blocked('draft_copy','draft_delete'),'copy waits for the uncommitted deletion');
select dblink_exec('draft_delete','commit');
select count(*) from dblink_get_result('draft_copy',false) as d(id uuid);
select matches(dblink_error_message('draft_copy'),'Estimate version not found or access denied', 'a committed deletion prevents duplication');
select count(*) from dblink_get_result('draft_copy',false) as d(id uuid);
select is((select count(*) from public.estimate_versions where project_id='dd730000-0000-4000-8000-000000000010'),
  2::bigint,'only the first source and its copy survive');

-- Capture the same PGRST envelope that the Data API receives. Other SQL errors fail the assertion.
select dblink_exec('draft_delete',$remote$
  create function pg_temp.delete_draft(draft uuid) returns jsonb language plpgsql as $body$
  declare
    http text;
  begin
    delete from public.estimate_versions where id=draft;
    return null;
  exception when sqlstate 'PGRST' then
    get stacked diagnostics http = pg_exception_detail;
    return sqlerrm::jsonb || http::jsonb;
  end;
  $body$;
$remote$);
create function pg_temp.delete_reply(draft uuid) returns jsonb language sql as $$
  select reply from dblink('draft_delete',format('select pg_temp.delete_draft(%L)',draft),false) as d(reply jsonb)
$$;

-- A owns the analysis. B already holds it. Pause B's real duplication just before its link insert.
-- Only the copy and the DELETE take part once the test connection opens the gate.
insert into pids values ('gate', pg_backend_pid());
select format('select public.duplicate_estimate_version(%L,false)',id) as duplicate_b from new_copy \gset
savepoint before_link;
lock table public.takeoff_version_links in share mode;
select dblink_send_query('draft_copy', :'duplicate_b');
select pg_temp.blocked('draft_copy','gate') as copy_at_link \gset
select dblink_send_query('draft_delete',$$select pg_temp.delete_draft('dd730000-0000-4000-8000-000000000011')$$);
select pg_temp.blocked('draft_delete','draft_copy') as waited_on_job \gset
rollback to before_link;
select ok(:'copy_at_link'::boolean,'grandchild reached its inherited link');
select ok(not :'waited_on_job'::boolean,'ancestor deletion never waits on the grandchild job');
select is((select reply->>'code' from dblink_get_result('draft_delete',false) as d(reply jsonb)),
  'ESTIMATE_DRAFT_BUSY','grandchild first: deleting the ancestor reports busy');
select count(*) from dblink_get_result('draft_delete',false) as d(reply jsonb);

create function pg_temp.check_grandchild(schedule text) returns setof text language plpgsql as $$
declare
  child uuid;
  refusal jsonb;
begin
  select id into child from dblink_get_result('draft_copy',false) as c(id uuid);
  perform id from dblink_get_result('draft_copy',false) as c(id uuid);
  return next ok(exists(select 1 from public.takeoff_version_links where target_version_id=child
    and source_version_id='dd730000-0000-4000-8000-000000000011'),schedule || ': grandchild and inherited link committed');
  refusal := pg_temp.delete_reply('dd730000-0000-4000-8000-000000000011');
  return next ok(refusal->>'code'='ESTIMATE_DRAFT_TAKEOFF_IN_USE' and
    (refusal->>'details')::jsonb->'versions' @> jsonb_build_array(jsonb_build_object('id',child)),
    schedule || ': retry names the committed grandchild');
end;
$$;
select * from pg_temp.check_grandchild('grandchild first');

-- Hold A's tuple as DELETE does before its row trigger. The grandchild now waits on A's FK.
select dblink_exec('draft_delete','begin');
select id from dblink('draft_delete',$$select id from public.estimate_versions
  where id='dd730000-0000-4000-8000-000000000011' for update$$) as locked(id uuid);
select dblink_send_query('draft_copy', :'duplicate_b');
select ok(pg_temp.blocked('draft_copy','draft_delete'),'ancestor first: the grandchild waits for its provenance FK');
select is(pg_temp.delete_reply('dd730000-0000-4000-8000-000000000011')->>'code','ESTIMATE_DRAFT_BUSY',
  'ancestor first: deletion returns busy while holding the version');
select dblink_exec('draft_delete','commit');
select * from pg_temp.check_grandchild('ancestor first');

-- Each writer has its own source and an empty target in this affaire, in both commit orders.
\ir ../fixtures/estimate-section-copy-payload.sql
create function pg_temp.rid(n integer) returns uuid language sql immutable as $$
  select ('dd730000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
select dblink_exec('draft_copy','reset role; reset request.jwt.claim.sub; begin');
select dblink_exec('draft_copy',format($fixture$
  insert into public.estimate_versions(id,tenant_id,project_id,version_number,status,calc_engine_version,margin_multiplier,tax_rate_bp)
  select %1$L,p.tenant_id,p.id,%2$s,'draft',2,1,0 from public.estimate_projects p where p.id=%3$L;
  insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
  select %4$L,tenant_id,id,'section',1,'Sanitaires' from public.estimate_versions where id=%1$L;
  insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
  select v.id,%5$L,v.tenant_id,now()+interval '30 minutes',%6$L from public.estimate_versions v where v.id=%1$L;
$fixture$,pg_temp.rid(n),n,pg_temp.rid(10),pg_temp.rid(n+300),pg_temp.rid(1),pg_temp.rid(55)))
from generate_series(101,117) n;

select dblink_exec('draft_copy',format($fixture$
  insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by,status)
  select %1$L,tenant_id,id,'A',%2$L,'completed' from public.estimate_versions where id=%3$L;
  insert into public.takeoff_items(id,tenant_id,job_id,designation,quantity,unit,confidence)
  select %4$L,tenant_id,id,'Lavabo',%5$s,'u',1 from public.takeoff_jobs where id=%1$L;
  insert into public.estimate_items(tenant_id,version_id,parent_id,item_type,position,title,source_provider,source_job_id,
    quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
  select tenant_id,estimate_version_id,%6$L,'line',1,'Lavabo','takeoff',id,%5$s,0,0,1,0,1,0,0,0,0
  from public.takeoff_jobs where id=%1$L;
$fixture$,pg_temp.rid(n+100),pg_temp.rid(1),pg_temp.rid(n),pg_temp.rid(n+500),
  case when n=111 then 2 else 3 end,pg_temp.rid(n+300)))
from generate_series(101,117,2) n;

select dblink_exec('draft_copy',format($fixture$
  insert into public.takeoff_version_links(tenant_id,takeoff_job_id,source_version_id,target_version_id,linked_by)
  select tenant_id,id,estimate_version_id,%L,%L from public.takeoff_jobs where id=%L;
$fixture$,pg_temp.rid(n+1),pg_temp.rid(1),pg_temp.rid(n+100))) from (values (103),(107),(115)) batch(n);

-- The same persisted A+B line that takeoff-send-outcome obtains with two real confirmations.
select dblink_exec('draft_copy',format($fixture$
  update public.estimate_items set quantity=5,source_job_id=%1$L,
    source_metadata=jsonb_build_object('takeoff_contributions',jsonb_build_object(
      'job_id',%1$L::uuid,'item_ids',jsonb_build_array(%2$L::uuid,%3$L::uuid)))
  where version_id=%4$L and item_type='line';
$fixture$,pg_temp.rid(211),pg_temp.rid(609),pg_temp.rid(611),pg_temp.rid(109)));
-- Model an already claimed job. The heartbeat below goes through the worker's lease RPC.
select dblink_exec('draft_copy',format($fixture$
  set local session_replication_role=replica;
  update public.takeoff_jobs set status='processing', started_at=now(), processing_lease_token=%L,
    processing_lease_expires_at=now()+interval '10 minutes', analysis_outcome=null, analysis_finished_at=null where id=%L;
  set local session_replication_role=origin;
$fixture$,pg_temp.rid(900),pg_temp.rid(217)));
select dblink_exec('draft_copy',$auth$commit; set request.jwt.claim.sub='dd730000-0000-4000-8000-000000000001';
  set role authenticated;$auth$);

create function pg_temp.section_command(n integer) returns text language sql volatile as $$
  select format('select public.copy_estimate_items_atomic(%L,%L,%L::jsonb)',pg_temp.rid(n+1),pg_temp.rid(55),
    pg_temp.cp29_copy(pg_temp.rid(n+300),pg_temp.rid(n+1),2))
$$;
create function pg_temp.batch_command(n integer) returns text language sql as $$
  select format($batch$
    select public.commit_estimate_batch(v.id,gen_random_uuid(),v.updated_at,%1$L,
      jsonb_build_array(jsonb_build_object('op','create','data',jsonb_build_object('item_type','line','parent_id',%2$L::uuid,
        'title','Lavabo','quantity',3,'source_provider','takeoff','source_job_id',%3$L::uuid))),
      jsonb_build_array(jsonb_build_object('index',0,'id',%4$L::uuid)),
      jsonb_build_array(jsonb_build_object('id',%4$L::uuid,'pu_ht_cents',0,'line_total_ht_cents',0,
        'line_tax_cents',0,'line_total_ttc_cents',0)),
      '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}',
      '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}',null)
    from public.estimate_versions v where v.id=%5$L
  $batch$,pg_temp.rid(55),pg_temp.rid(n+301),pg_temp.rid(n+100),pg_temp.rid(n+700),pg_temp.rid(n+1))
$$;
create function pg_temp.delete_command(n integer) returns text language sql as $$
  select format('delete from public.estimate_versions where id=%L',pg_temp.rid(n))
$$;

-- Bound a regression that waits for an open writer. A statement timeout is never a domain refusal.
select dblink_exec('draft_delete',$$set statement_timeout='2s'; set lock_timeout=0$$);
create function pg_temp.writer_first(n integer, writer text, command text, commit_write boolean) returns setof text language plpgsql as $$
declare
  receipt jsonb;
begin
  perform dblink_exec('draft_copy','begin');
  select result into receipt from dblink('draft_copy',command) as written(result jsonb);
  return next ok(coalesce((receipt->>'committed')::boolean,(receipt->>'item_count')::int=2,false),writer || ' writes the line');
  return next is(pg_temp.delete_reply(pg_temp.rid(n))->>'code','ESTIMATE_DRAFT_BUSY',writer || ' in progress: deletion is busy');
  if not commit_write then
    perform dblink_exec('draft_copy','rollback');
    return next is(dblink_exec('draft_delete',pg_temp.delete_command(n)),'DELETE 1',writer || ' rolled back: deletion succeeds');
    return;
  end if;
  perform dblink_exec('draft_copy','commit');
  return next is(pg_temp.delete_reply(pg_temp.rid(n))->>'code','ESTIMATE_DRAFT_TAKEOFF_IN_USE',writer || ' committed: retry is refused');
  return next results_eq(format('select source_job_id,quantity from public.estimate_items where version_id=%L and item_type=''line''',
    pg_temp.rid(n+1)),format('values (%L::uuid,3::numeric)',pg_temp.rid(n+100)),writer || ' retains its analysis and quantity');
end
$$;
select * from pg_temp.writer_first(101,'section copy',pg_temp.section_command(101),true);
select * from pg_temp.writer_first(103,'editor batch',pg_temp.batch_command(103),true);
select * from pg_temp.writer_first(113,'section copy',pg_temp.section_command(113),false);
select * from pg_temp.writer_first(115,'editor batch',pg_temp.batch_command(115),false);

select dblink_exec('draft_copy','begin; set local role service_role');
select id from dblink('draft_copy',format('select id from public.takeoff_version_links where takeoff_job_id=%L for share',
  pg_temp.rid(207))) as locked(id uuid);
select is(pg_temp.delete_reply(pg_temp.rid(107))->>'code','ESTIMATE_DRAFT_BUSY','a lock on the link alone causes immediate refusal');
select dblink_exec('draft_copy','commit');

-- Both writers prepared their payload before the deletion.
create temp table pending_section as select pg_temp.section_command(105) as command;
select dblink_exec('draft_delete','begin');
select is(dblink_exec('draft_delete',pg_temp.delete_command(105)),'DELETE 1','delete first, before the section copy');
select dblink_send_query('draft_copy',(select command from pending_section));
select ok(pg_temp.blocked('draft_copy','draft_delete'),'the section FK waits for the deletion');
select dblink_exec('draft_delete','commit');
select count(*) from dblink_get_result('draft_copy',false) as written(receipt jsonb);
select matches(dblink_error_message('draft_copy'),'estimate_items_source_job_id_fkey','committed deletion rejects the section copy');
select count(*) from dblink_get_result('draft_copy',false) as written(receipt jsonb);

select dblink_exec('draft_delete','begin');
select is(dblink_exec('draft_delete',pg_temp.delete_command(107)),'DELETE 1','delete first, before the editor save');
select is((select receipt #>> '{results,0,code}' from dblink('draft_copy',pg_temp.batch_command(107)) as written(receipt jsonb)),
  'ESTIMATE_BATCH_STALE','the editor reports its NOWAIT conflict while the deletion is open');
select dblink_exec('draft_delete','commit');
select results_eq($q$select receipt->>'committed',receipt #>> '{results,0,code}'
  from dblink('draft_copy',pg_temp.batch_command(107)) as written(receipt jsonb)$q$,
  $$values ('false'::text,'ESTIMATE_BATCH_INVALID_INPUT'::text)$$,'after deletion the editor rejects the missing analysis');
select is((select count(*) from public.estimate_items where version_id in(pg_temp.rid(106),pg_temp.rid(108)) and item_type='line'),
  0::bigint,'neither losing writer leaves a measured line');

-- Known limit until analyses outlive their drafts: the section FK locks B; A occurs only in JSON.
select dblink_exec('draft_copy','begin');
select is((select (receipt->>'item_count')::int from dblink('draft_copy',pg_temp.section_command(109)) as written(receipt jsonb)),
  2,'copy the source section with the A+B line while A still exists');
select is(dblink_exec('draft_delete',pg_temp.delete_command(109)),'DELETE 1','known limit: metadata alone does not lock A');
select dblink_exec('draft_copy','commit');
select results_eq($q$select i.quantity,i.source_job_id,cardinality(s.ids),
    (select count(*) from public.takeoff_items ti where ti.id=any(s.ids)),
    exists(select 1 from public.takeoff_jobs j where j.id=pg_temp.rid(209))
  from public.estimate_items i cross join lateral(select private.takeoff_estimate_line_item_ids(i.source_metadata,i.source_job_id) as ids) s
  where i.version_id=pg_temp.rid(110) and i.item_type='line'$q$,
  $$select 5::numeric,pg_temp.rid(211),2,1::bigint,false$$,
  'known limit: five units survive the concurrent copy with only B resolvable');

select dblink_exec('draft_copy','begin; set local role service_role');
select ok(renewed,'the worker renews its processing lease') from dblink('draft_copy',format($q$
  select public.renew_takeoff_processing_lease(id,tenant_id,%L,now(),now()+interval '20 minutes')
  from public.takeoff_jobs where id=%L$q$,pg_temp.rid(900),pg_temp.rid(217))) as worker(renewed boolean);
select is(pg_temp.delete_reply(pg_temp.rid(117)),jsonb_build_object('code','ESTIMATE_DRAFT_BUSY','status',409,
  'headers','{}'::jsonb,'message','Ce brouillon est utilisé par une opération en cours. Réessayez dans un instant.'),
  'a concurrent heartbeat returns the retryable French HTTP 409');
select dblink_exec('draft_copy','commit');
select is(dblink_exec('draft_delete',pg_temp.delete_command(117)),'DELETE 1','retry after the heartbeat deletes the draft');

-- The affaire cascade may wait to delete a job. It must never return the single-version busy refusal.
select dblink_exec('draft_copy','begin; set local role service_role');
select id from dblink('draft_copy',format('select id from public.takeoff_jobs where id=%L for update',
  pg_temp.rid(201))) as locked(id uuid);
select dblink_send_query('draft_delete',format($q$select outcome from public.estimate_projects p
  cross join lateral public.bulk_delete_draft_affaires(p.tenant_id,array[p.id]) where p.id=%L$q$,pg_temp.rid(10)));
select ok(pg_temp.blocked('draft_delete','draft_copy'),'whole-affaire deletion waits for its job cascade');
select dblink_exec('draft_copy','commit');
select is((select outcome from dblink_get_result('draft_delete',false) as project(outcome text)),
  'deleted','whole-affaire deletion completes with the copied drafts');
select count(*) from dblink_get_result('draft_delete',false) as project(outcome text);

select dblink_exec('draft_copy','reset role');
select dblink_exec('draft_copy',$cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'dd730000-0000-4000-8000-000000000001' and is_default);
  entry record;
begin
  for entry in
    select columns.table_schema, columns.table_name
    from information_schema.columns as columns
    join information_schema.tables as tables
      on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
    where columns.table_schema in ('public', 'private') and columns.column_name = 'tenant_id'
      and tables.table_type = 'BASE TABLE' and not (columns.table_schema = 'public' and columns.table_name = 'tenants')
      and not (columns.table_schema = 'public' and columns.table_name = 'audit_logs')
  loop
    execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
  end loop;
  delete from public.audit_logs where tenant_id = target;
  delete from public.tenants where id = target;
end
$clean$;
delete from public.profiles where id = 'dd730000-0000-4000-8000-000000000001';
delete from auth.users where id = 'dd730000-0000-4000-8000-000000000001';
commit;
$cleanup$);
select dblink_disconnect(name) from (values ('draft_copy'), ('draft_delete')) as sessions(name);
select * from finish();
rollback;
