-- Hold a metadata edit open while another connection saves the draft. Check the
-- commit itself, and distinguish a changed inheritance key from a changed timestamp.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select dblink_connect(name, format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()))
from (values ('analysis_editor'), ('analysis_links')) as sessions(name);
select dblink_exec(name, $sql$
  create function pg_temp.aid(n integer) returns uuid language sql immutable as $id$
    select ('d5080000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
  $id$;
  set lock_timeout = '2s';
$sql$) from (values ('analysis_editor'), ('analysis_links')) as sessions(name);

select dblink_exec('analysis_links', $setup$
do $fixtures$
declare tenant uuid;
begin
  insert into auth.users (instance_id,id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values ('00000000-0000-0000-0000-000000000000',pg_temp.aid(1),'authenticated','authenticated',
    'analysis-save-race@example.test','{}','{}',now(),now());
  update public.tenant_memberships set role='engineer' where user_id=pg_temp.aid(1) and is_default returning tenant_id into tenant;
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(pg_temp.aid(10),tenant,pg_temp.aid(1),'Devis fictif');
  insert into public.estimate_versions(id,tenant_id,project_id,version_number,status,calc_engine_version,margin_multiplier,tax_rate_bp)
  select pg_temp.aid(20+n),tenant,pg_temp.aid(10),n,'draft',2,1,0 from generate_series(1,2) n;
  insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,status,source_file_name,created_by)
  select pg_temp.aid(n),tenant,pg_temp.aid(21),'B','completed','plan.pdf',pg_temp.aid(1) from generate_series(31,32) n;
  insert into public.takeoff_version_links(tenant_id,takeoff_job_id,source_version_id,target_version_id)
  select tenant,pg_temp.aid(n),pg_temp.aid(21),pg_temp.aid(22) from generate_series(31,32) n;
  insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
  values(pg_temp.aid(40),tenant,pg_temp.aid(22),'section',1,'Lot');
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,quantity,unit_price_ht_cents,
    tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_job_id)
  values(pg_temp.aid(41),tenant,pg_temp.aid(22),pg_temp.aid(40),'line',1,'Ligne',1,0,0,1,0,1,0,0,0,0,pg_temp.aid(31));
  insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
  values(pg_temp.aid(22),pg_temp.aid(1),tenant,now()+interval '30 minutes',pg_temp.aid(50));
end
$fixtures$;
$setup$);

select dblink_exec('analysis_editor', $writer$
  set track_functions = 'all';
  create temp view draft_write as
    select v.id, v.updated_at,
      jsonb_build_array(jsonb_build_object('id',i.id,'pu_ht_cents',i.pu_ht_cents,'line_total_ht_cents',i.line_total_ht_cents,
        'line_tax_cents',i.line_tax_cents,'line_total_ttc_cents',i.line_total_ttc_cents)) projection,
      jsonb_build_object('total_ht_cents',v.total_ht_cents,
        'total_tax_cents',v.total_tax_cents,'total_ttc_cents',v.total_ttc_cents) totals
    from public.estimate_versions v join public.estimate_items i on i.version_id=v.id
    where v.id=pg_temp.aid(22) and i.id=pg_temp.aid(41);
  grant select on draft_write to authenticated;
  create function pg_temp.save_description(value text) returns boolean language sql as $batch$
    select (public.commit_estimate_batch(d.id,gen_random_uuid(),d.updated_at,pg_temp.aid(50),
      jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.aid(41),'data',jsonb_build_object('description',value))),
      '[]',d.projection,d.totals,'{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}',null)->>'committed')::boolean
    from draft_write d
  $batch$;
  create function pg_temp.create_section(item integer, job integer) returns uuid language sql as $unit$
    select (public.atomic_create_estimate_item(d.id,
      jsonb_build_object('id',pg_temp.aid(item),'item_type','section','position',item,'title','Autre lot','source_job_id',pg_temp.aid(job)),
      d.projection,d.totals,d.updated_at,pg_temp.aid(50),'{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}')#>>'{item,id}')::uuid
    from draft_write d
  $unit$;
$writer$);
select dblink_exec(name, $claims$
  set request.jwt.claim.sub = 'd5080000-0000-4000-8000-000000000001';
  set request.jwt.claims = '{"sub":"d5080000-0000-4000-8000-000000000001","role":"authenticated"}';
  set role authenticated
$claims$) from (values ('analysis_editor'), ('analysis_links')) as sessions(name);

select dblink_exec('analysis_editor','begin');
select is(saved,true,'the attributed line can be edited') from dblink('analysis_editor',
  $$select pg_temp.save_description('Quantité conservée')$$) as t(saved boolean);
select dblink_exec('analysis_editor','reset role');
select is(calls,0::bigint,'an edit retaining its reference calls neither the scope predicate nor its lock helper')
from dblink('analysis_editor',$q$select coalesce(sum(calls),0)::bigint from pg_stat_xact_user_functions
  where funcname in ('lock_estimate_analysis_scope','estimate_version_holds_analysis')$q$) as t(calls bigint);
select dblink_exec('analysis_editor','set role authenticated; commit');

select is(dblink_exec('analysis_links',$q$begin; update public.takeoff_version_links set linked_at=clock_timestamp()
  where target_version_id=pg_temp.aid(22) and takeoff_job_id=pg_temp.aid(31)$q$),'UPDATE 1','the link timestamp is being refreshed');
select is(saved,true,'a timestamp refresh permits a concurrent editor save') from dblink('analysis_editor',
  $$select pg_temp.save_description('Texte enregistré')$$) as t(saved boolean);
select is((select description from public.estimate_items where id='d5080000-0000-4000-8000-000000000041'),
  'Texte enregistré','the edit is visible after commit');

select dblink_exec('analysis_editor','begin');
select is(created,'d5080000-0000-4000-8000-000000000042'::uuid,'the unit writer returns the section ID')
from dblink('analysis_editor','select pg_temp.create_section(42,31)') as t(created uuid);
select is(dblink_exec('analysis_editor','commit',false),'COMMIT','unit creation commits during the timestamp refresh');
select is((select count(*) from public.estimate_items where id='d5080000-0000-4000-8000-000000000042'),1::bigint,
  'the new inherited section is persisted');
select dblink_exec('analysis_links','commit');

select is(dblink_exec('analysis_editor',$q$begin; update public.estimate_items set source_job_id=source_job_id
  where id=pg_temp.aid(41)$q$),'UPDATE 1','the assignment reaches the inherited line');
select is(dblink_exec('analysis_links',$q$begin; update public.estimate_versions set title='Nouveau titre'
  where id=pg_temp.aid(22)$q$),'UPDATE 1','the other session changes the draft title');
select is(dblink_exec('analysis_editor','commit',false),'COMMIT','a same-value assignment commits during a title edit');
select dblink_exec('analysis_links','commit');

-- The second link starts with no dependent line. The unit writer has returned
-- inside its transaction when the other session actually removes the link.
select dblink_exec('analysis_editor','begin');
select is(created,'d5080000-0000-4000-8000-000000000043'::uuid,'the contested creation is staged')
from dblink('analysis_editor','select pg_temp.create_section(43,32)') as t(created uuid);
select is(dblink_exec('analysis_links',$q$begin; delete from public.takeoff_version_links
  where target_version_id=pg_temp.aid(22) and takeoff_job_id=pg_temp.aid(32)$q$),'DELETE 1','the other session removes the link');
select throws_ok($$select extensions.dblink_exec('analysis_editor','commit')$$,'M0A01',
  'Cette version du devis ne détient pas cette analyse.','removal in progress surfaces the domain refusal at commit');
select is(dblink_exec('analysis_links','commit'),'COMMIT','the genuine removal commits');
select is((select count(*) from public.estimate_items where id='d5080000-0000-4000-8000-000000000043'),0::bigint,
  'the refused unit creation leaves no row');

-- With only the copied empty section attributed, the source may go. Let its
-- FK cleanup wait for the edited section row. The draft's NOWAIT guard must
-- have passed the source job and link before that ordinary row wait.
select is(dblink_exec('analysis_editor',$q$update public.estimate_items set source_job_id=null
  where id=pg_temp.aid(41)$q$),'UPDATE 1','only the empty section still names the job');
select is(dblink_exec('analysis_editor',$q$begin; update public.estimate_items set source_job_id=source_job_id
  where id=pg_temp.aid(42)$q$),'UPDATE 1','the editor retains the empty section reference');
select dblink_exec('analysis_editor','set constraints all immediate');
create temp table analysis_pids as select name, pid from (values ('analysis_editor'),('analysis_links')) sessions(name)
  cross join lateral dblink(name,'select pg_backend_pid()') as backend(pid integer);
create function pg_temp.deletion_waits_for_section() returns boolean language plpgsql as $$
declare
  deleting integer := (select pid from analysis_pids where name='analysis_links');
  editing integer := (select pid from analysis_pids where name='analysis_editor');
begin
  for attempt in 1..100 loop
    if editing = any(pg_blocking_pids(deleting)) then return true; end if;
    if dblink_is_busy('analysis_links')=0 then return false; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end
$$;
select dblink_send_query('analysis_links',$q$delete from public.estimate_versions where id=pg_temp.aid(21) returning id$q$);
select ok(pg_temp.deletion_waits_for_section(),'deletion waits for the section row held by the editor');
select is(dblink_exec('analysis_editor','commit'),'COMMIT','the ordinary save commits during source removal');
select results_eq($$select id from dblink_get_result('analysis_links',false) as removed(id uuid)$$,
  $$values ('d5080000-0000-4000-8000-000000000021'::uuid)$$,'the source draft is deleted after the save');
select * from dblink_get_result('analysis_links',false) as drained(id uuid);
select results_eq($$select title,source_job_id from public.estimate_items
  where id='d5080000-0000-4000-8000-000000000042'$$,$$values ('Autre lot'::text,null::uuid)$$,
  'the empty section survives with its analysis cleared');

select dblink_exec('analysis_links','reset role');
select dblink_exec('analysis_links', $clean$
do $fixtures$
declare tenant uuid := (select tenant_id from public.tenant_memberships where user_id=pg_temp.aid(1) and is_default);
begin
  delete from public.estimate_projects where id=pg_temp.aid(10);
  delete from auth.users where id=pg_temp.aid(1);
  delete from public.feature_flags where tenant_id=tenant;
  delete from public.estimate_rules where tenant_id=tenant;
  delete from public.audit_logs where tenant_id=tenant;
  delete from public.tenants where id=tenant;
end
$fixtures$;
$clean$);
select dblink_disconnect(name) from (values ('analysis_editor'), ('analysis_links')) as sessions(name);
select * from finish();
rollback;
