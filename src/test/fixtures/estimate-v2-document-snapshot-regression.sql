-- PRECODE: observable failures and specialist gaps were defined first in
-- docs/testing/document-preview-snapshot-sql.md and the ignored preparation plan.
-- Local transaction only. This does not prove PDF bytes, real races or emission.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
set local idle_in_transaction_session_timeout = '120s';

do $preflight$
begin
  if current_user <> 'postgres' then raise exception 'missing-precondition: postgres specialist connection required'; end if;
  if to_regprocedure('public.freeze_estimate_v2_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)') is null then
    raise exception 'missing-precondition: dedicated document snapshot RPC absent';
  end if;
  if to_regprocedure('public.assert_estimate_offer_actor(uuid,uuid,uuid)') is null
    or to_regprocedure('public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.freeze_estimate_v2_snapshot_without_explicit_rounding(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)') is null then
    raise exception 'missing-precondition: installed actor/commercial snapshot contracts absent';
  end if;
  if exists(select 1 from auth.users where id::text like 'dfca0700-%')
    or exists(select 1 from public.tenants where id::text like 'dfca0700-%')
    or exists(select 1 from public.estimate_projects where id::text like 'dfca0700-%') then
    raise exception 'missing-precondition: document fixture prefix already exists';
  end if;
end;
$preflight$;

create function pg_temp.dp_id(n integer) returns uuid language sql immutable as $f$
  select ('dfca0700-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$f$;
create function pg_temp.dp_assert(ok boolean,detail text) returns void language plpgsql as $f$
begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
create function pg_temp.dp_actor(n integer default 1,db_role text default 'service_role') returns void language plpgsql as $f$
begin
  perform set_config('role','none',true);
  perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.dp_id(n)::text end,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.dp_id(n) end,'role',db_role)::text,true);
  perform set_config('role',db_role,true);
end $f$;

-- Real Auth/profile/bootstrap, dedicated transaction-only synthetic actors.
insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.dp_id(n),'army-document-sql-'||n||'@example.invalid',jsonb_build_object('full_name','ARMY document actor '||n)
from generate_series(1,6)n;
update public.tenant_memberships set is_default=false where user_id::text like 'dfca0700-%';
insert into public.tenants(id,name,slug) values
  (pg_temp.dp_id(101),'ARMY document snapshot T1','army-document-snapshot-t1'),
  (pg_temp.dp_id(102),'ARMY document snapshot T2','army-document-snapshot-t2');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
select pg_temp.dp_id(case when n=3 then 102 else 101 end),pg_temp.dp_id(n),
  (case n when 2 then 'admin' when 3 then 'admin' when 4 then 'viewer' when 5 then 'director' else 'engineer' end)::public.tenant_role,
  true,'2020-01-01' from generate_series(1,6)n;
insert into public.estimate_projects(id,tenant_id,user_id,name) values
  (pg_temp.dp_id(201),pg_temp.dp_id(101),pg_temp.dp_id(1),'ARMY document project'),
  (pg_temp.dp_id(202),pg_temp.dp_id(102),pg_temp.dp_id(3),'ARMY document foreign project');
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,max_section_depth,
  margin_mode,margin_multiplier,tax_rate_bp,rounding_mode,rounding_step_cents,total_ht_cents,total_tax_cents,total_ttc_cents)
values
  (pg_temp.dp_id(301),pg_temp.dp_id(201),1,'draft',2,4,'fixed',1,2000,'none',100,2000,400,2400),
  (pg_temp.dp_id(302),pg_temp.dp_id(201),2,'draft',1,4,'fixed',1,2000,'none',100,2000,400,2400),
  (pg_temp.dp_id(303),pg_temp.dp_id(202),1,'draft',2,4,'fixed',1,2000,'none',100,2000,400,2400);
insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values
  (pg_temp.dp_id(601),pg_temp.dp_id(101),pg_temp.dp_id(1),'ARMY zero-priced pose',0),
  (pg_temp.dp_id(602),pg_temp.dp_id(101),pg_temp.dp_id(2),'ARMY admin own rate',9999),
  (pg_temp.dp_id(603),pg_temp.dp_id(102),pg_temp.dp_id(3),'ARMY foreign rate',8000);
insert into public.estimate_items(id,version_id,item_type,position,title)
select pg_temp.dp_id(n+100),pg_temp.dp_id(n),'section',0,'ARMY document section' from generate_series(301,303)n;
insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,line_nature,
  unit_price_ht_cents,pu_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,k_fo,h_mo,k_mo,labor_role_id)
select pg_temp.dp_id(n+200),pg_temp.dp_id(n),pg_temp.dp_id(n+100),'line',0,'ARMY retained pose','u',2,'supply_and_labor',
  1000,1000,2000,2000,400,2400,1,0.5,1,pg_temp.dp_id(case when n=303 then 603 else 601 end)
from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
select pg_temp.dp_id(n),pg_temp.dp_id(case when n=303 then 3 else 1 end),pg_temp.dp_id(701),clock_timestamp()+interval '1 hour'
from generate_series(301,303)n;
delete from public.feature_flags where tenant_id in(pg_temp.dp_id(101),pg_temp.dp_id(102)) and flag_key='EST_031_LABOR_SPLIT';
delete from public.margin_tiers where tenant_id in(pg_temp.dp_id(101),pg_temp.dp_id(102));

create function pg_temp.dp_state() returns jsonb language plpgsql security definer set search_path='' as $f$
declare t record; rows_value jsonb; result jsonb:='{}';
begin
  for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in('public','private','auth','storage') order by n.nspname,c.relname loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%dfca0700-%%''',t.nspname,t.relname) into rows_value;
    if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
  end loop; return result;
end $f$;
create function pg_temp.dp_workflow() returns jsonb language plpgsql security definer set search_path='' as $f$
begin
  -- Capture full related rows, not production actor counts. Exclude only
  -- derived financial UPDATE audits; they remain covered by dp_state rollback.
  return (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(pg_temp.dp_state())
    where key not in('public.estimate_versions','public.estimate_items','public.audit_logs'));
end $f$;
create function pg_temp.dp_context() returns jsonb language sql immutable as $f$
  select jsonb_build_object('labor_split_enabled',false,'labor_roles',jsonb_build_array(jsonb_build_object('id',pg_temp.dp_id(601),'hourly_rate_cents',0)),
    'margin_tiers','[]'::jsonb,'effective_margin_multiplier',1)
$f$;
create function pg_temp.dp_projection(rounding boolean default false) returns jsonb language sql immutable as $f$
  select jsonb_build_array(jsonb_build_object('id',pg_temp.dp_id(501),'snapshot_pu_ht_cents',case when rounding then 2001 else 1000 end,
    'snapshot_fo_ht_cents',case when rounding then 2001 else 2000 end,'snapshot_mo_ht_cents',0,
    'snapshot_mo_atelier_ht_cents',0,'snapshot_mo_chantier_ht_cents',0,
    'line_total_ht_cents',case when rounding then 2001 else 2000 end,'line_tax_cents',case when rounding then 399 else 400 end,'line_total_ttc_cents',2400))
$f$;
create function pg_temp.dp_totals(rounding boolean default false) returns jsonb language sql immutable as $f$
  select jsonb_build_object('total_ht_cents',case when rounding then 2001 else 2000 end,'total_tax_cents',case when rounding then 399 else 400 end,
    'total_ttc_cents',2400,'rounding_adjustment_cents',case when rounding then -1 else 0 end)
$f$;
create function pg_temp.dp_call(actor integer default 1,session uuid default pg_temp.dp_id(701),
  token timestamptz default null,revision bigint default null,ctx jsonb default null,projection jsonb default null,totals jsonb default null,
  version_n integer default 301,tenant_n integer default 101) returns public.estimate_versions language plpgsql as $f$
begin
  return public.freeze_estimate_v2_document_snapshot(pg_temp.dp_id(version_n),pg_temp.dp_id(tenant_n),
    coalesce(token,nullif(current_setting('dp.token.v'||version_n,true),'')::timestamptz,(select updated_at from public.estimate_versions where id=pg_temp.dp_id(version_n))),
    coalesce(revision,nullif(current_setting('dp.revision.v'||version_n,true),'')::bigint,(select content_revision from public.estimate_versions where id=pg_temp.dp_id(version_n))),
    pg_temp.dp_id(actor),session,coalesce(ctx,pg_temp.dp_context()),coalesce(projection,pg_temp.dp_projection()),coalesce(totals,pg_temp.dp_totals()));
end $f$;
create function pg_temp.dp_refuse(command text,expected_states text[],expected_message text default null) returns void language plpgsql as $f$
declare before_state jsonb; actual_state text; actual_message text;
begin
  perform pg_temp.dp_actor(null,'none');
  -- Record authorized CAS before switching DB role. RLS-hidden NULL inputs
  -- must never substitute for actual authorization-denial probes.
  perform set_config('dp.token.v'||n,(select updated_at::text from public.estimate_versions where id=pg_temp.dp_id(n)),true) from generate_series(301,303)n;
  perform set_config('dp.revision.v'||n,(select content_revision::text from public.estimate_versions where id=pg_temp.dp_id(n)),true) from generate_series(301,303)n;
  before_state:=pg_temp.dp_state();
  perform pg_temp.dp_actor(coalesce(nullif(current_setting('dp.actor',true),'')::integer,1),coalesce(nullif(current_setting('dp.role',true),''),'service_role'));
  begin execute command; exception when others then get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text; end;
  perform pg_temp.dp_actor(null,'none');
  perform pg_temp.dp_assert(actual_state=any(expected_states) and (expected_message is null or actual_message=expected_message),
    format('Expected SQLSTATE %s / fixed message %s; actual SQLSTATE %s',expected_states,coalesce(expected_message,'unspecified'),coalesce(actual_state,'success')));
  perform pg_temp.dp_assert(before_state=pg_temp.dp_state(),'Refusal changed full fixture data/audit/workflow');
end $f$;

create temporary sequence dp_fault_hits;
create function pg_temp.dp_late_fault() returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if coalesce(current_setting('dp.fault',true),'')='enabled' and new.id=pg_temp.dp_id(301)
    and new.calc_snapshot_context is distinct from old.calc_snapshot_context then
    perform pg_temp.dp_assert((select snapshot_pu_ht_cents=1000 and snapshot_fo_ht_cents=2000 and snapshot_mo_ht_cents=0
      and snapshot_mo_atelier_ht_cents=0 and snapshot_mo_chantier_ht_cents=0 from public.estimate_items where id=pg_temp.dp_id(501)),
      'Late failpoint did not follow actual line materialization');
    perform nextval('pg_temp.dp_fault_hits');
    raise exception using errcode='P9001',message='DOCUMENT_SNAPSHOT_AFTER_LINES';
  end if;
  return new;
end $f$;
create trigger zzz_document_snapshot_late_probe before update of calc_snapshot_context on public.estimate_versions
  for each row execute function pg_temp.dp_late_fault();

create function pg_temp.dp_case(name text) returns void language plpgsql as $f$
declare r public.estimate_versions; before_state jsonb; business jsonb; workflow jsonb; ctx jsonb; projection jsonb;
  token timestamptz; revision bigint; p record; role_name text; command text; hits bigint; actor_n integer:=1;
begin
  perform pg_temp.dp_actor(null,'none');
  perform set_config('dp.actor','1',true); perform set_config('dp.role','service_role',true); perform set_config('dp.fault','',true);
  perform set_config('dp.token.v301','',true); perform set_config('dp.revision.v301','',true);
  if name in('owner-free-pose','admin-project-owner-rate','commercial-rounding','exact-replay','edit-refreeze') then
    if name='admin-project-owner-rate' then
      actor_n:=2; delete from public.draft_locks where version_id=pg_temp.dp_id(301);
      insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.dp_id(301),pg_temp.dp_id(2),pg_temp.dp_id(701),clock_timestamp()+interval '1 hour');
    elsif name='commercial-rounding' then
      update public.estimate_versions set rounding_mode='nearest',rounding_step_cents=100 where id=pg_temp.dp_id(301);
      update public.estimate_items set quantity=1,unit_price_ht_cents=2001 where id=pg_temp.dp_id(501);
    end if;
    perform pg_temp.dp_assert((select calc_snapshot_context is null and calc_snapshot_content_revision is null from public.estimate_versions where id=pg_temp.dp_id(301)),
      'Setup is already frozen; it no longer reproduces OF04');
    select to_jsonb(i)-array['snapshot_pu_ht_cents','snapshot_fo_ht_cents','snapshot_mo_ht_cents','snapshot_mo_atelier_ht_cents',
      'snapshot_mo_chantier_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','updated_at'] into business
      from public.estimate_items i where id=pg_temp.dp_id(501);
    workflow:=pg_temp.dp_workflow(); perform pg_temp.dp_actor(actor_n);
    r:=pg_temp.dp_call(actor=>actor_n,projection=>pg_temp.dp_projection(name='commercial-rounding'),totals=>pg_temp.dp_totals(name='commercial-rounding'));
    perform pg_temp.dp_assert(to_jsonb(r)=(select to_jsonb(v) from public.estimate_versions v where id=pg_temp.dp_id(301)), 'Returned fresh version differs from stored CAS/footer');
    perform pg_temp.dp_assert(r.status='draft' and r.calc_engine_version=2 and r.calc_snapshot_content_revision=r.content_revision
      and r.calc_snapshot_context=pg_temp.dp_context() and r.seal_hash is null and r.seal_payload_version is null,'Preview modified workflow or returned incomplete snapshot');
    perform pg_temp.dp_assert(jsonb_build_object('total_ht_cents',r.total_ht_cents,'total_tax_cents',r.total_tax_cents,'total_ttc_cents',r.total_ttc_cents,
      'rounding_adjustment_cents',r.rounding_adjustment_cents)=pg_temp.dp_totals(name='commercial-rounding'),'Commercial rounding/footer differs');
    perform pg_temp.dp_assert((select jsonb_build_object('id',i.id,'snapshot_pu_ht_cents',i.snapshot_pu_ht_cents,'snapshot_fo_ht_cents',i.snapshot_fo_ht_cents,
      'snapshot_mo_ht_cents',i.snapshot_mo_ht_cents,'snapshot_mo_atelier_ht_cents',i.snapshot_mo_atelier_ht_cents,'snapshot_mo_chantier_ht_cents',i.snapshot_mo_chantier_ht_cents,
      'line_total_ht_cents',i.line_total_ht_cents,'line_tax_cents',i.line_tax_cents,'line_total_ttc_cents',i.line_total_ttc_cents) from public.estimate_items i where id=pg_temp.dp_id(501))
      =pg_temp.dp_projection(name='commercial-rounding')->0,'Actual five snapshots/line reconciliation differs');
    perform pg_temp.dp_actor(null,'none');
    perform pg_temp.dp_assert(business=(select to_jsonb(i)-array['snapshot_pu_ht_cents','snapshot_fo_ht_cents','snapshot_mo_ht_cents','snapshot_mo_atelier_ht_cents',
      'snapshot_mo_chantier_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','updated_at'] from public.estimate_items i where id=pg_temp.dp_id(501)),
      'Preview lost zero-rate hours/role or changed commercial inputs');
    perform pg_temp.dp_assert(workflow=pg_temp.dp_workflow(),'Preview created/modified approval/email/token/event or lease');
    if name='exact-replay' then
      before_state:=pg_temp.dp_state(); perform pg_temp.dp_actor(); r:=pg_temp.dp_call(); perform pg_temp.dp_actor(null,'none');
      perform pg_temp.dp_assert(before_state=pg_temp.dp_state(),'Exact fresh-CAS replay changed derived fields/audits');
    elsif name='edit-refreeze' then
      update public.estimate_items set title='ARMY edited preview' where id=pg_temp.dp_id(501);
      perform pg_temp.dp_assert((select calc_snapshot_content_revision is null or calc_snapshot_content_revision<>content_revision from public.estimate_versions where id=pg_temp.dp_id(301)),
        'Business edit kept a current frozen revision');
      perform pg_temp.dp_actor(); r:=pg_temp.dp_call();
      perform pg_temp.dp_assert(r.calc_snapshot_content_revision=r.content_revision and r.status='draft','Edited preview could not refreeze under own bail');
    end if;
    return;
  end if;
  if name='catalog-all-overloads' then
    perform pg_temp.dp_assert((select count(*)=1 from pg_proc q join pg_namespace n on n.oid=q.pronamespace where n.nspname='public' and q.proname='freeze_estimate_v2_document_snapshot'),
      'Session-bypass overload exists');
    for p in select q.* from pg_proc q join pg_namespace n on n.oid=q.pronamespace where n.nspname='public' and q.proname='freeze_estimate_v2_document_snapshot' loop
      perform pg_temp.dp_assert(p.pronargs=9 and p.pronargdefaults=0 and not p.prosecdef and 'search_path=""'=any(coalesce(p.proconfig,array[]::text[])), 'Dedicated signature/invoker/path differs');
      perform pg_temp.dp_assert(not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE')
        and has_function_privilege('service_role',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'), 'Dedicated effective ACL differs');
      foreach role_name in array array['anon','authenticated'] loop
        command:=format('select %s(%s)',p.oid::regproc,(select string_agg('NULL::'||format_type(x.arg,null),',' order by x.ordinality) from unnest(p.proargtypes::oid[]) with ordinality x(arg,ordinality)));
        perform set_config('dp.role',role_name,true); perform pg_temp.dp_refuse(command,array['42501']);
      end loop;
    end loop; return;
  end if;
  case name
    when 'same-user-other-session' then perform pg_temp.dp_refuse(format('select pg_temp.dp_call(session=>%L)',pg_temp.dp_id(702)),array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'null-session' then perform pg_temp.dp_refuse('select pg_temp.dp_call(session=>NULL)',array['22023'],'ESTIMATE_V2_DOCUMENT_SNAPSHOT_INPUT_INVALID');
    when 'expired-session' then update public.draft_locks set expires_at=clock_timestamp()-interval '1 second' where version_id=pg_temp.dp_id(301); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'missing-session' then delete from public.draft_locks where version_id=pg_temp.dp_id(301); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'foreign-user-session' then
      delete from public.draft_locks where version_id=pg_temp.dp_id(301);
      insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.dp_id(301),pg_temp.dp_id(2),pg_temp.dp_id(701),clock_timestamp()+interval '1 hour');
      perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'stale-updated-at' then perform pg_temp.dp_refuse('select pg_temp.dp_call(token=>''2000-01-01''::timestamptz)',array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'stale-revision' then perform pg_temp.dp_refuse('select pg_temp.dp_call(revision=>0)',array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'edited-during-calculation' then
      select updated_at,content_revision into token,revision from public.estimate_versions where id=pg_temp.dp_id(301);
      update public.estimate_items set quantity=3 where id=pg_temp.dp_id(501);
      perform pg_temp.dp_refuse(format('select pg_temp.dp_call(token=>%L,revision=>%s)',token,revision),array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'viewer' then perform set_config('dp.actor','4',true); perform pg_temp.dp_refuse('select pg_temp.dp_call(actor=>4)',array['42501']);
    when 'director' then perform set_config('dp.actor','5',true); perform pg_temp.dp_refuse('select pg_temp.dp_call(actor=>5)',array['42501']);
    when 'engineer-other-owner' then perform set_config('dp.actor','6',true); perform pg_temp.dp_refuse('select pg_temp.dp_call(actor=>6)',array['42501']);
    when 'other-tenant-actor' then perform set_config('dp.actor','3',true); perform pg_temp.dp_refuse('select pg_temp.dp_call(actor=>3)',array['42501']);
    when 'other-tenant-version' then perform pg_temp.dp_refuse('select pg_temp.dp_call(version_n=>303)',array['42501']);
    when 'wrong-explicit-tenant' then perform pg_temp.dp_refuse('select pg_temp.dp_call(tenant_n=>102)',array['42501']);
    when 'inactive-tenant' then update public.tenants set is_active=false where id=pg_temp.dp_id(101); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['42501']);
    when 'membership-deleted' then delete from public.tenant_memberships where tenant_id=pg_temp.dp_id(101) and user_id=pg_temp.dp_id(1); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['42501']);
    when 'archived-project' then update public.estimate_projects set is_archived=true where id=pg_temp.dp_id(201); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['42501']);
    when 'engine-one' then perform pg_temp.dp_refuse('select pg_temp.dp_call(version_n=>302)',array['42501'],'ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT');
    when 'not-draft' then
      -- Enter the protected state through the real reservation RPC. A direct
      -- postgres status UPDATE is correctly denied by the workflow guard and
      -- would never exercise the document wrapper's non-draft refusal.
      update public.estimate_versions set date_devis='2030-10-15',validite_jours=30 where id=pg_temp.dp_id(301);
      perform pg_temp.dp_actor(1);
      -- The installed publication guard requires a fresh v2 financial image
      -- before draft -> sending. Use the OLD commercial freezer to establish
      -- that prerequisite independently of the new document wrapper.
      perform public.freeze_estimate_v2_snapshot(
        pg_temp.dp_id(301),pg_temp.dp_id(101),
        (select updated_at from public.estimate_versions where id=pg_temp.dp_id(301)),
        (select content_revision from public.estimate_versions where id=pg_temp.dp_id(301)),
        pg_temp.dp_id(1),'send',pg_temp.dp_context(),pg_temp.dp_projection(),pg_temp.dp_totals()
      );
      perform public.reserve_estimate_email_dispatch(
        pg_temp.dp_id(301),pg_temp.dp_id(101),
        (select updated_at from public.estimate_versions where id=pg_temp.dp_id(301)),
        pg_temp.dp_id(1),pg_temp.dp_id(901),repeat('1',64),'army-document@example.invalid',null::text[],
        'ARMY document reservation','Synthetic transaction-only prerequisite','army-from@example.invalid',
        'http://127.0.0.1:39901',
        '{"name":"ARMY COMPANY","tagline":"Synthetic test company","address":{"street":"ARMY street","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"ARMY office","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 03","mobile":"+33 6 00 00 00 04"},"legal":{"siret":"ARMY-FIXTURE","vat":"ARMY-VAT"}}'::jsonb
      );
      perform pg_temp.dp_assert((select status='sending' from public.estimate_versions where id=pg_temp.dp_id(301)),
        'Real reservation did not reach sending; wrapper was not exercised');
      perform pg_temp.dp_actor(null,'none');
      perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['42501'],'ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT');
    when 'rate-changed' then update public.labor_roles set hourly_rate_cents=1000 where id=pg_temp.dp_id(601); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['40001'],'ESTIMATE_V2_CALCULATION_CONTEXT_CONFLICT');
    when 'flag-changed' then insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.dp_id(101),'EST_031_LABOR_SPLIT',true); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['40001'],'ESTIMATE_V2_CALCULATION_CONTEXT_CONFLICT');
    when 'margin-changed' then update public.estimate_versions set margin_multiplier=1.2 where id=pg_temp.dp_id(301); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['40001'],'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT');
    when 'positive-hours-missing-role' then update public.estimate_items set labor_role_id=null where id=pg_temp.dp_id(501); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['23502'],'ESTIMATE_V2_LABOR_ROLE_REQUIRED');
    when 'context-foreign-role' then ctx:=jsonb_set(pg_temp.dp_context(),'{labor_roles}',jsonb_build_array(jsonb_build_object('id',pg_temp.dp_id(603),'hourly_rate_cents',8000))); perform pg_temp.dp_refuse(format('select pg_temp.dp_call(ctx=>%L::jsonb)',ctx),array['40001'],'ESTIMATE_V2_CALCULATION_CONTEXT_CONFLICT');
    when 'context-extra-key' then ctx:=pg_temp.dp_context()||'{"skip_authorization":true}'::jsonb; perform pg_temp.dp_refuse(format('select pg_temp.dp_call(ctx=>%L::jsonb)',ctx),array['22023'],'ESTIMATE_V2_CALCULATION_CONTEXT_INVALID');
    when 'projection-missing-line' then perform pg_temp.dp_refuse('select pg_temp.dp_call(projection=>''[]''::jsonb)',array['40001'],'ESTIMATE_V2_ITEM_SNAPSHOT_CONFLICT');
    when 'projection-duplicate-line' then projection:=pg_temp.dp_projection()||pg_temp.dp_projection(); perform pg_temp.dp_refuse(format('select pg_temp.dp_call(projection=>%L::jsonb)',projection),array['22023'],'ESTIMATE_V2_ITEM_SNAPSHOT_INVALID');
    when 'projection-foreign-line' then projection:=jsonb_set(pg_temp.dp_projection(),'{0,id}',to_jsonb(pg_temp.dp_id(503))); perform pg_temp.dp_refuse(format('select pg_temp.dp_call(projection=>%L::jsonb)',projection),array['40001'],'ESTIMATE_V2_ITEM_SNAPSHOT_CONFLICT');
    when 'projection-missing-snapshot' then projection:=jsonb_set(pg_temp.dp_projection(),'{0,snapshot_mo_ht_cents}','null'); perform pg_temp.dp_refuse(format('select pg_temp.dp_call(projection=>%L::jsonb)',projection),array['22023'],'ESTIMATE_V2_ITEM_SNAPSHOT_INVALID');
    when 'projection-fractional-cents' then projection:=jsonb_set(pg_temp.dp_projection(),'{0,snapshot_pu_ht_cents}','1.5'); perform pg_temp.dp_refuse(format('select pg_temp.dp_call(projection=>%L::jsonb)',projection),array['22P02']);
    when 'footer-does-not-reconcile' then perform pg_temp.dp_refuse('select pg_temp.dp_call(totals=>''{"total_ht_cents":1000,"total_tax_cents":200,"total_ttc_cents":1200,"rounding_adjustment_cents":0}''::jsonb)',array['22023'],'ESTIMATE_V2_SNAPSHOT_TOTALS_MISMATCH');
    when 'rounding-negative-calculated-tax' then perform pg_temp.dp_refuse('select pg_temp.dp_call(totals=>''{"total_ht_cents":2000,"total_tax_cents":400,"total_ttc_cents":2400,"rounding_adjustment_cents":401}''::jsonb)',array['22023'],'ESTIMATE_V2_ROUNDING_ADJUSTMENT_INVALID');
    when 'all-null-input' then perform pg_temp.dp_refuse('select public.freeze_estimate_v2_document_snapshot(null,null,null,null,null,null,null,null,null)',array['22023'],'ESTIMATE_V2_DOCUMENT_SNAPSHOT_INPUT_INVALID');
    when 'late-fault-after-lines' then
      select case when is_called then last_value else 0 end into hits from pg_temp.dp_fault_hits;
      perform set_config('dp.fault','enabled',true); perform pg_temp.dp_refuse('select pg_temp.dp_call()',array['P9001'],'DOCUMENT_SNAPSHOT_AFTER_LINES');
      perform pg_temp.dp_assert((select is_called and last_value=hits+1 from pg_temp.dp_fault_hits),'Exact late failpoint not reached');
    else raise exception 'Unknown document snapshot case';
  end case;
end $f$;

do $document_snapshot_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure_state text; failures integer;
begin
  perform pg_temp.dp_assert(not exists(select 1 from public.profiles where id::text like 'dfca0700-%' and role='admin'),'Synthetic actors became global admins');
  foreach case_name in array array[
    'catalog-all-overloads','owner-free-pose','admin-project-owner-rate','commercial-rounding','exact-replay','edit-refreeze',
    'same-user-other-session','null-session','expired-session','missing-session','foreign-user-session',
    'stale-updated-at','stale-revision','edited-during-calculation','viewer','director','engineer-other-owner',
    'other-tenant-actor','other-tenant-version','wrong-explicit-tenant','inactive-tenant','membership-deleted','archived-project',
    'engine-one','not-draft','rate-changed','flag-changed','margin-changed','positive-hours-missing-role',
    'context-foreign-role','context-extra-key','projection-missing-line','projection-duplicate-line','projection-foreign-line',
    'projection-missing-snapshot','projection-fractional-cents','footer-does-not-reconcile','rounding-negative-calculated-tax',
    'all-null-input','late-fault-after-lines'
  ] loop
    passed:=false; failure_state:=null;
    begin
      perform pg_temp.dp_case(case_name);
      raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true;
      when others then failure_state:=sqlstate;
    end;
    perform pg_temp.dp_actor(null,'none');
    -- Only names/SQLSTATE reach public evidence, never dynamic messages/PII.
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'errorSqlstate',failure_state));
  end loop;
  select count(*) into failures from jsonb_array_elements(results)x where not(x->>'passed')::boolean;
  raise exception using errcode='P9001',message='ESTIMATE_DOCUMENT_SNAPSHOT_PROOF:'||jsonb_build_object(
    'allPassed',failures=0,'fixturePrefix','dfca0700','caseCount',jsonb_array_length(results),'failedCount',failures,'financialEngine',2,
    'concurrencyExecuted',false,'transportExecuted',false,'pdfBytesVerified',false,'sealHashVerified',false,'genuineLegacyOfferVerified',false,'cases',results)::text;
end;
$document_snapshot_probe$;
-- Mandatory terminal P9001, never commit this specialist fixture.
rollback;
