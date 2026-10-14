-- PRECODE: failure matrix/SQL isolation exception were frozen before this fixture.
-- Baseline calls old13 explicitly. Candidate/installed call ONLY new14.
-- This synthetic transaction does not qualify PDF bytes, seal math or transport.
begin;
set local lock_timeout='3s';
set local statement_timeout='90s';
set local idle_in_transaction_session_timeout='120s';
do $preflight$
begin
  if current_user<>'postgres' then raise exception 'missing-precondition: specialist postgres required'; end if;
  if to_regprocedure('public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb)') is null
    or to_regprocedure('public.freeze_estimate_v2_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.begin_estimate_pdf_generation(uuid,uuid,uuid,text,uuid)') is null
    or to_regprocedure('public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb)') is null then
    raise exception 'missing-precondition: installed prerequisite contracts absent';
  end if;
  if coalesce(current_setting('es.mode',true),'') not in('baseline','candidate','installed') then raise exception 'missing-precondition: explicit mode required'; end if;
  if current_setting('es.mode')<>'baseline' and to_regprocedure('public.reserve_estimate_email_dispatch_with_session(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb,uuid)') is null then
    raise exception 'missing-precondition: new14 absent; no fallback';
  end if;
  if exists(select 1 from auth.users where id::text like 'efca0900-%') or exists(select 1 from public.tenants where id::text like 'efca0900-%')
    or exists(select 1 from public.estimate_projects where id::text like 'efca0900-%') then raise exception 'missing-precondition: email fixture prefix occupied'; end if;
end;
$preflight$;
create function pg_temp.es_id(n integer) returns uuid language sql immutable as $f$
  select ('efca0900-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$f$;
create function pg_temp.es_assert(ok boolean,detail text) returns void language plpgsql as $f$
begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
create function pg_temp.es_actor(n integer default 2,db_role text default 'service_role')
returns void language plpgsql as $f$
begin
  perform set_config('role','none',true);
  perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.es_id(n)::text end,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.es_id(n) end,'role',db_role)::text,true);
  perform set_config('role',db_role,true);
end $f$;

-- Transaction-only Auth rows invoke the REAL profile/bootstrap triggers.
insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.es_id(n),'army-email-session-sql-'||n||'@example.invalid',
  jsonb_build_object('full_name',case n when 1 then 'ARMY project owner' when 2 then 'ARMY emitting admin' else 'ARMY other tenant actor' end)
from generate_series(1,3)n;
update public.profiles set full_name='ARMY emitting admin',job_title='Chargé d’affaires',
  phone='+33 1 00 00 00 02',work_email='army-issuer@example.invalid' where id=pg_temp.es_id(2);
update public.tenant_memberships set is_default=false where user_id::text like 'efca0900-%';
insert into public.tenants(id,name,slug) values
  (pg_temp.es_id(101),'ARMY offer contract T1','army-email-session-t1'),
  (pg_temp.es_id(102),'ARMY offer contract T2','army-email-session-t2');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values
  (pg_temp.es_id(101),pg_temp.es_id(1),'engineer',true,'2020-01-01'),
  (pg_temp.es_id(101),pg_temp.es_id(2),'admin',true,'2020-01-01'),
  (pg_temp.es_id(102),pg_temp.es_id(3),'admin',true,'2020-01-01');
insert into public.estimate_projects(id,tenant_id,user_id,name,reference,estimate_reference,client_name,site_address)
values (pg_temp.es_id(201),pg_temp.es_id(101),pg_temp.es_id(1),'ARMY captured project A',
  'ARMY-REF-A','ARMY-EST-A','ARMY client A','ARMY site A'),
  (pg_temp.es_id(202),pg_temp.es_id(102),pg_temp.es_id(3),'ARMY other tenant project',
  'ARMY-REF-T2','ARMY-EST-T2','ARMY client T2','ARMY site T2');
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,
  date_devis,validite_jours,margin_mode,margin_multiplier,tax_rate_bp,total_ht_cents,total_tax_cents,total_ttc_cents)
select pg_temp.es_id(n),pg_temp.es_id(201),n-300,'draft',1,'2030-02-01',365,'fixed',1,2000,10000,2000,12000
from generate_series(301,303)n;
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,date_devis,validite_jours)
values(pg_temp.es_id(304),pg_temp.es_id(202),1,'draft',1,'2030-02-01',365);
-- PREPARATION revision04: installed hierarchy requires a section parent for
-- every line. Actual root sections belong to the SAME version as their child.
insert into public.estimate_items(id,version_id,item_type,position,title)
select pg_temp.es_id(n+100),pg_temp.es_id(n),'section',0,'ARMY commercial section'
from generate_series(301,304)n;
insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,
  unit_price_ht_cents,pu_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,k_fo,h_mo,k_mo)
select pg_temp.es_id(n+200),pg_temp.es_id(n),pg_temp.es_id(n+100),'line',0,'ARMY commercial line','u',2,5000,5000,
  2000,10000,2000,12000,1,0,1 from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
select pg_temp.es_id(n),pg_temp.es_id(2),pg_temp.es_id(701),clock_timestamp()+interval '1 hour'
from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
values(pg_temp.es_id(304),pg_temp.es_id(3),pg_temp.es_id(701),clock_timestamp()+interval '1 hour');

create function pg_temp.es_state() returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t record; rows_value jsonb; result jsonb:='{}';
begin
  -- Related random dispatch/token/audit IDs still contain the dedicated parent
  -- UUID in their full row. Images stay internal; they are NEVER reported.
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in('public','private','auth')
    order by n.nspname,c.relname loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%efca0900-%%''',t.nspname,t.relname) into rows_value;
    if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
  end loop;
  return result;
end $f$;
create function pg_temp.es_company() returns jsonb language sql immutable as $f$
  select '{"name":"ARMY COMPANY A","tagline":"Synthetic test company","address":{"street":"ARMY street A","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"ARMY office A","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 03","mobile":"+33 6 00 00 00 04"},"legal":{"siret":"ARMY-FIXTURE-A","vat":"ARMY-VAT-A"}}'::jsonb
$f$;
create function pg_temp.es_layout() returns jsonb language sql immutable as $f$
  select '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":true}'::jsonb
$f$;
create function pg_temp.es_terms() returns jsonb language sql immutable as $f$
  select jsonb_build_object('templateId',pg_temp.es_id(801),'title','Synthetic CGV fixture',
    'body','TEST FIXTURE ONLY. Synthetic review metadata is not a genuine legal approval.',
    'version',1,'legalReviewedAt','2026-10-01T12:00:00.000Z','capturedAt','2026-10-13T12:00:00.000Z')
$f$;
create function pg_temp.es_snapshot(v integer default 301) returns jsonb language sql as $f$
  select jsonb_build_object('schemaVersion',1,
    'version',jsonb_build_object('id',e.id,'tenantId',e.tenant_id,'projectId',e.project_id,'number',e.version_number,
      'contentRevision',e.content_revision,'calcEngineVersion',e.calc_engine_version,'dateDevis',e.date_devis,
      'validiteJours',e.validite_jours,'currency',e.currency,'contractorRole',e.contractor_role,'taxRateBp',e.tax_rate_bp),
    'project',jsonb_build_object('name',p.name,'reference',p.reference,'estimateReference',
      case when e.version_number>1 then p.estimate_reference||'_V'||e.version_number else p.estimate_reference end,
      'clientName',p.client_name,'siteAddress',p.site_address),
    'issuer',jsonb_build_object('userId',pg_temp.es_id(2),'displayName','ARMY emitting admin','displayRole','Chargé d’affaires',
      'phone','+33 1 00 00 00 02','email','army-issuer@example.invalid'),
    'company',pg_temp.es_company(),
    'rows',jsonb_build_array(
      jsonb_build_object('kind','section','id',pg_temp.es_id(v+100),'parentId',null,'position',0,'depth',0,
        'number','1','title','ARMY commercial section','saleHtCents',e.total_ht_cents),
      jsonb_build_object('kind','line','id',pg_temp.es_id(v+200),'parentId',pg_temp.es_id(v+100),'position',0,'depth',1,
        'title','ARMY commercial line','quantity',2,'unit','u','unitSaleHtCents',e.total_ht_cents/2,'saleHtCents',e.total_ht_cents)),
    'totals',jsonb_build_object('saleHtCents',e.total_ht_cents,'taxCents',e.total_tax_cents,'calculatedTtcCents',e.total_ttc_cents,'payableTtcCents',e.total_ttc_cents,'roundingAdjustmentCents',0),
    'exclusions',e.exclusions)
  from public.estimate_versions e join public.estimate_projects p on p.id=e.project_id where e.id=pg_temp.es_id(v)
$f$;
create function pg_temp.es_proof(v integer default 301) returns jsonb language sql as $f$
  select jsonb_build_object('proofVersion',1,'documentId',d.id,'tenantId',d.tenant_id,'versionId',d.version_id,
    'projectId',e.project_id,'status',d.status,'filePath',d.file_path,'sha256Hash',d.sha256_hash,'fileSizeBytes',d.file_size_bytes,
    'generatedAt',case when d.generated_at is null then null else to_char(d.generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'generatedBy',d.generated_by,'publishedGenerationToken',d.published_generation_token,'publishedPurpose',d.published_purpose,
    'publishedDispatchId',d.published_dispatch_id,'publishedContentRevision',d.published_content_revision,
    'clientContractVersion',d.client_contract_version,'clientContractSnapshot',d.client_contract_snapshot,
    'layoutOptions',d.layout_options,'termsSnapshot',d.terms_snapshot)
  from public.estimate_documents d join public.estimate_versions e on e.id=d.version_id where d.version_id=pg_temp.es_id(v)
$f$;
create function pg_temp.es_publish(v integer default 301,purpose text default 'email',dispatch_id uuid default null)
returns public.estimate_documents language plpgsql as $f$
declare d public.estimate_documents; path_value text;
begin
  d:=public.begin_estimate_pdf_generation(pg_temp.es_id(v),pg_temp.es_id(101),pg_temp.es_id(2),purpose,dispatch_id);
  path_value:=pg_temp.es_id(101)||'/'||pg_temp.es_id(201)||'/'||pg_temp.es_id(v)||'/'||repeat('a',64)||'.pdf';
  return public.publish_estimate_pdf_generation(pg_temp.es_id(v),pg_temp.es_id(101),pg_temp.es_id(2),d.generation_token,
    path_value,repeat('a',64),1234,'2026-10-13T12:00:00.123456Z',pg_temp.es_layout(),pg_temp.es_terms(),pg_temp.es_snapshot(v));
end $f$;

-- Additional synthetic actors remain transaction-only; real Auth bootstrap.
insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.es_id(n),'army-email-session-'||n||'@example.invalid',jsonb_build_object('full_name','ARMY email actor '||n) from generate_series(4,6)n;
update public.tenant_memberships set is_default=false where user_id::text like 'efca0900-%' and user_id in(pg_temp.es_id(4),pg_temp.es_id(5),pg_temp.es_id(6));
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
select pg_temp.es_id(101),pg_temp.es_id(n),(case n when 4 then 'viewer' when 5 then 'director' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(4,6)n;
insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values(pg_temp.es_id(601),pg_temp.es_id(101),pg_temp.es_id(1),'ARMY zero rate retained pose',0);
delete from public.feature_flags where tenant_id=pg_temp.es_id(101) and flag_key='EST_031_LABOR_SPLIT';
delete from public.margin_tiers where tenant_id=pg_temp.es_id(101);

-- Legitimate initial V2 rows, matching the installed document fixture.
-- Never convert an existing V1 engine or directly edit derived V2 snapshots.
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,max_section_depth,
  date_devis,validite_jours,margin_mode,margin_multiplier,tax_rate_bp,rounding_mode,rounding_step_cents,total_ht_cents,total_tax_cents,total_ttc_cents)
select pg_temp.es_id(n),pg_temp.es_id(201),n-300,'draft',2,4,'2030-02-01',365,'fixed',1,2000,'none',100,
  case when n=305 then 0 else 10000 end,case when n=305 then 0 else 2000 end,case when n=305 then 0 else 12000 end
from generate_series(305,306)n;
insert into public.estimate_items(id,version_id,item_type,position,title)
select pg_temp.es_id(n+100),pg_temp.es_id(n),'section',0,'ARMY commercial section' from generate_series(305,306)n;
insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,line_nature,
  unit_price_ht_cents,pu_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,k_fo,h_mo,k_mo,labor_role_id)
select pg_temp.es_id(n+200),pg_temp.es_id(n),pg_temp.es_id(n+100),'line',0,'ARMY commercial line','u',2,'supply_and_labor',
  case when n=305 then 0 else 5000 end,case when n=305 then 0 else 5000 end,2000,
  case when n=305 then 0 else 10000 end,case when n=305 then 0 else 2000 end,case when n=305 then 0 else 12000 end,
  1,0.5,1,pg_temp.es_id(601) from generate_series(305,306)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
select pg_temp.es_id(n),pg_temp.es_id(2),pg_temp.es_id(701),clock_timestamp()+interval '1 hour' from generate_series(305,306)n;

create function pg_temp.es_call(version_n integer default 301,actor_n integer default 2,tenant_n integer default 101,
  session uuid default pg_temp.es_id(701),token timestamptz default null,null_token boolean default false,
  request uuid default pg_temp.es_id(901),payload text default repeat('1',64),recipient text default 'army-client@example.invalid',
  cc text[] default array['army-cc@example.invalid'],subject text default 'ARMY OFFER',body text default 'Human message',
  company jsonb default pg_temp.es_company()) returns public.estimate_emails language plpgsql as $f$
declare expected timestamptz;
begin
  expected:=case when null_token then null else coalesce(token,nullif(current_setting('es.token.v'||version_n,true),'')::timestamptz,
    (select updated_at from public.estimate_versions where id=pg_temp.es_id(version_n))) end;
  if current_setting('es.mode')='baseline' then
    return public.reserve_estimate_email_dispatch(pg_temp.es_id(version_n),pg_temp.es_id(tenant_n),expected,pg_temp.es_id(actor_n),
      request,payload,recipient,cc,subject,body,'army-from@example.invalid','http://127.0.0.1:39901',company);
  end if;
  return public.reserve_estimate_email_dispatch_with_session(pg_temp.es_id(version_n),pg_temp.es_id(tenant_n),expected,pg_temp.es_id(actor_n),
    request,payload,recipient,cc,subject,body,'army-from@example.invalid','http://127.0.0.1:39901',company,session);
end $f$;

create function pg_temp.es_refuse(command text,expected_states text[],expected_message text default null) returns void language plpgsql as $f$
declare before_state jsonb; actual_state text; actual_message text;
begin
  perform pg_temp.es_actor(null,'none');
  perform set_config('es.token.v'||n,(select updated_at::text from public.estimate_versions where id=pg_temp.es_id(n)),true) from generate_series(301,306)n;
  before_state:=pg_temp.es_state();
  perform pg_temp.es_actor(coalesce(nullif(current_setting('es.actor',true),'')::integer,2),coalesce(nullif(current_setting('es.role',true),''),'service_role'));
  begin execute command; exception when others then get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text; end;
  perform pg_temp.es_actor(null,'none');
  perform pg_temp.es_assert(actual_state=any(expected_states) and (expected_message is null or actual_message=expected_message),'Refusal did not return expected fixed error');
  perform pg_temp.es_assert(before_state=pg_temp.es_state(),'Refusal changed full fixture data/audit/workflow');
end $f$;

create function pg_temp.es_prepare_v2(version_n integer) returns void language plpgsql as $f$
declare amount bigint:=case when version_n=305 then 0 else 10000 end; tax bigint:=case when version_n=305 then 0 else 2000 end; frozen public.estimate_versions;
begin
  perform pg_temp.es_actor();
  frozen:=public.freeze_estimate_v2_document_snapshot(pg_temp.es_id(version_n),pg_temp.es_id(101),
    (select updated_at from public.estimate_versions where id=pg_temp.es_id(version_n)),
    (select content_revision from public.estimate_versions where id=pg_temp.es_id(version_n)),pg_temp.es_id(2),pg_temp.es_id(701),
    jsonb_build_object('labor_split_enabled',false,'labor_roles',jsonb_build_array(jsonb_build_object('id',pg_temp.es_id(601),'hourly_rate_cents',0)),
      'margin_tiers','[]'::jsonb,'effective_margin_multiplier',1),
    jsonb_build_array(jsonb_build_object('id',pg_temp.es_id(version_n+200),'snapshot_pu_ht_cents',amount/2,'snapshot_fo_ht_cents',amount,'snapshot_mo_ht_cents',0,
      'snapshot_mo_atelier_ht_cents',0,'snapshot_mo_chantier_ht_cents',0,'line_total_ht_cents',amount,'line_tax_cents',tax,'line_total_ttc_cents',amount+tax)),
    jsonb_build_object('total_ht_cents',amount,'total_tax_cents',tax,'total_ttc_cents',amount+tax,'rounding_adjustment_cents',0));
  perform pg_temp.es_assert(frozen.calc_engine_version=2 and frozen.calc_snapshot_content_revision=frozen.content_revision,'Real installed V2 financial prerequisite absent');
end $f$;

create function pg_temp.es_prepare(dispatch_id uuid,v integer default 301) returns public.estimate_emails language plpgsql as $f$
declare d public.estimate_documents;
begin
  select * into d from public.estimate_documents where version_id=pg_temp.es_id(v);
  return public.prepare_estimate_email_dispatch(dispatch_id,pg_temp.es_id(101),pg_temp.es_id(2),repeat('b',64),repeat('c',64),
    '<p>ARMY synthetic offer</p>','ARMY synthetic offer',d.file_path,d.sha256_hash,'ARMY-OFFER.pdf',pg_temp.es_proof(v),5::smallint);
end $f$;
create function pg_temp.es_send(v integer default 301,request_n integer default 901) returns public.estimate_emails language plpgsql as $f$
declare e public.estimate_emails; d public.estimate_documents;
begin
  e:=pg_temp.es_call(version_n=>v,request=>pg_temp.es_id(request_n));
  d:=pg_temp.es_publish(v,'email',e.id); e:=pg_temp.es_prepare(e.id,v);
  e:=public.claim_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.es_id(2),pg_temp.es_id(702),120);
  return public.complete_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.es_id(2),pg_temp.es_id(702),'ARMY-PROVIDER-ID','2026-10-13T12:05:00.123456Z');
end $f$;

create temporary sequence es_fault_hits;
create function pg_temp.es_late_fault() returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if coalesce(current_setting('es.fault',true),'')='enabled' and new.version_id=pg_temp.es_id(301) and new.event_type='reserved' then
    perform pg_temp.es_assert((select status='sending' from public.estimate_versions where id=new.version_id),'Late fault precedes version mutation');
    perform pg_temp.es_assert(exists(select 1 from public.portal_tokens where estimate_email_dispatch_id=new.dispatch_id and capability_contract_version=2),'Late fault precedes own capability');
    perform nextval('pg_temp.es_fault_hits'); raise exception using errcode='P9001',message='EMAIL_SESSION_AFTER_CAPABILITY_BEFORE_EVENT';
  end if;
  return new;
end $f$;
create trigger zzz_email_session_late_probe before insert on public.estimate_email_dispatch_events for each row execute function pg_temp.es_late_fault();

create function pg_temp.es_case(name text) returns void language plpgsql as $f$
declare e public.estimate_emails; replay public.estimate_emails; d public.estimate_documents; sig text; p record;
  token timestamptz; stale timestamptz; ttl timestamptz; actor_n integer:=2; version_n integer:=301;
  before_state jsonb; doc_before jsonb; version_before jsonb; identity_before jsonb; hits bigint; command text; target_status text;
begin
  perform pg_temp.es_actor(null,'none');
  perform set_config('es.actor','2',true); perform set_config('es.role','service_role',true); perform set_config('es.fault','',true);
  perform set_config('es.token.v'||n,'',true) from generate_series(301,306)n;
  if name='catalog-new14-boundary' then
    if current_setting('es.mode')='baseline' then
      perform pg_temp.es_assert(to_regprocedure('public.reserve_estimate_email_dispatch_with_session(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb,uuid)') is null,'Baseline unexpectedly contains new14'); return;
    end if;
    sig:='public.reserve_estimate_email_dispatch_with_session(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb,uuid)';
    select * into p from pg_proc where oid=to_regprocedure(sig);
    perform pg_temp.es_assert(p.oid is not null and not p.prosecdef and p.pronargs=14 and p.pronargdefaults=0 and p.proconfig=array['search_path=""'],'New14 boundary differs');
    perform pg_temp.es_assert(has_function_privilege('service_role',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE'),'New14 execution scope differs'); return;
  end if;
  if name in('fresh-v2-admin','fresh-v2-zero-retained-labor') then version_n:=case when name='fresh-v2-zero-retained-labor' then 305 else 306 end; perform pg_temp.es_prepare_v2(version_n); end if;
  perform pg_temp.es_actor(null,'none'); token:=(select updated_at from public.estimate_versions where id=pg_temp.es_id(version_n));
  if name in('fresh-v1-admin','fresh-v1-owner-engineer','fresh-v2-admin','fresh-v2-zero-retained-labor') then
    if name='fresh-v1-owner-engineer' then
      actor_n:=1; delete from public.draft_locks where version_id=pg_temp.es_id(301);
      insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.es_id(301),pg_temp.es_id(1),pg_temp.es_id(701),clock_timestamp()+interval '1 hour');
    end if;
    perform pg_temp.es_actor(actor_n); e:=pg_temp.es_call(version_n=>version_n,actor_n=>actor_n,token=>token);
    perform pg_temp.es_actor(null,'none');
    perform pg_temp.es_assert(e.status='preparing' and e.request_contract_version=2 and e.created_by=pg_temp.es_id(actor_n),'Fresh reservation not owned/preparing');
    perform pg_temp.es_assert((select status='sending' from public.estimate_versions where id=pg_temp.es_id(version_n)),'Fresh did not reach sending');
    perform pg_temp.es_assert((select count(*)=1 from public.portal_tokens where estimate_email_dispatch_id=e.id and version_id=e.version_id and tenant_id=e.tenant_id and capability_contract_version=2),'Fresh own capability absent/duplicated');
    perform pg_temp.es_assert((select count(*)=1 from public.estimate_email_dispatch_events where dispatch_id=e.id and event_type='reserved'),'Fresh reservation event absent/duplicated');
    if version_n in(305,306) then
      perform pg_temp.es_assert((select calc_snapshot_content_revision=content_revision and calc_engine_version=2 from public.estimate_versions where id=pg_temp.es_id(version_n)),'Fresh lost financial image');
      perform pg_temp.es_assert((select h_mo=0.5 and labor_role_id=pg_temp.es_id(601) and snapshot_mo_ht_cents=0 from public.estimate_items where id=pg_temp.es_id(version_n+200)),'Fresh lost retained zero MO');
    end if;
    return;
  end if;
  if name like 'replay-%' and name not like '%mismatch' or name='active-new-key-same-envelope' then
    perform pg_temp.es_actor();
    if name in('replay-sent','replay-delivered','replay-bounced','replay-after-accepted','replay-after-archived') then
      e:=pg_temp.es_send();
      if name in('replay-delivered','replay-bounced') then
        update public.estimate_emails set status=replace(name,'replay-','') where id=e.id returning * into e;
      elsif name in('replay-after-accepted','replay-after-archived') then
        perform public.transition_estimate_version_status(e.version_id,e.tenant_id,(select updated_at from public.estimate_versions where id=e.version_id),
          (case when name='replay-after-accepted' then 'accepted' else 'archived' end)::public.estimate_status,null,pg_temp.es_id(2),'{}',clock_timestamp(),5::smallint,pg_temp.es_proof(301));
      end if;
    else
      e:=pg_temp.es_call();
      if name<>'replay-preparing' then d:=pg_temp.es_publish(301,'email',e.id); e:=pg_temp.es_prepare(e.id); end if;
      if name in('replay-processing','replay-unknown') then e:=public.claim_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.es_id(2),pg_temp.es_id(702),120); end if;
      if name='replay-unknown' then e:=public.mark_estimate_email_dispatch_unknown(e.id,e.tenant_id,pg_temp.es_id(2),pg_temp.es_id(702),'ARMY-AMBIGUOUS','Synthetic provider uncertainty'); end if;
    end if;
    perform pg_temp.es_actor(null,'none'); delete from public.draft_locks where version_id=e.version_id; before_state:=pg_temp.es_state();
    perform pg_temp.es_actor(); replay:=pg_temp.es_call(session=>null,null_token=>true,request=>case when name='active-new-key-same-envelope' then pg_temp.es_id(902) else pg_temp.es_id(901) end);
    perform pg_temp.es_actor(null,'none');
    perform pg_temp.es_assert(to_jsonb(replay)=to_jsonb(e) and before_state=pg_temp.es_state(),'Exact replay changed dispatch/capability/doc/seal/event or required new lease/CAS'); return;
  end if;
  if name like 'replay-%mismatch' or name='active-new-key-different-envelope' then
    perform pg_temp.es_actor(); e:=pg_temp.es_call(); perform pg_temp.es_actor(null,'none');
    command:=case name
      when 'replay-payload-mismatch' then 'select pg_temp.es_call(payload=>repeat(''2'',64),session=>null,null_token=>true)'
      when 'replay-recipient-mismatch' then 'select pg_temp.es_call(recipient=>''army-other@example.invalid'',session=>null,null_token=>true)'
      when 'replay-cc-mismatch' then 'select pg_temp.es_call(cc=>array[''army-other@example.invalid''],session=>null,null_token=>true)'
      when 'replay-subject-mismatch' then 'select pg_temp.es_call(subject=>''OTHER SUBJECT'',session=>null,null_token=>true)'
      when 'replay-body-mismatch' then 'select pg_temp.es_call(body=>''Other human message'',session=>null,null_token=>true)'
      when 'replay-actor-mismatch' then 'select pg_temp.es_call(actor_n=>1,session=>null,null_token=>true)'
      when 'replay-version-mismatch' then 'select pg_temp.es_call(version_n=>302,session=>null,null_token=>true)'
      else 'select pg_temp.es_call(request=>pg_temp.es_id(902),payload=>repeat(''2'',64),session=>null,null_token=>true)' end;
    if name='replay-actor-mismatch' then perform set_config('es.actor','1',true); end if;
    perform pg_temp.es_refuse(command,array['23505'],'ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT'); return;
  end if;
  if name like 'failed-%' then
    perform pg_temp.es_actor();
    if name='failed-unfrozen-sent-recovery-no-bail' then e:=pg_temp.es_send(); e:=pg_temp.es_call(request=>pg_temp.es_id(902));
    else e:=pg_temp.es_call(); end if;
    if name='failed-frozen-requires-new-request' then
      d:=pg_temp.es_publish(301,'email',e.id); e:=pg_temp.es_prepare(e.id); e:=public.claim_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.es_id(2),pg_temp.es_id(702),120);
      e:=public.fail_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.es_id(2),pg_temp.es_id(702),'ARMY-FAILED','Synthetic explicit provider failure');
    else e:=public.fail_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.es_id(2),null,'ARMY-PREP-FAILED','Synthetic pre-provider failure'); end if;
    perform pg_temp.es_actor(null,'none'); token:=(select updated_at from public.estimate_versions where id=e.version_id);
    if name='failed-unfrozen-draft-other-session' then perform pg_temp.es_refuse('select pg_temp.es_call(session=>pg_temp.es_id(702))',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED'); return;
    elsif name='failed-unfrozen-draft-stale-cas' then perform pg_temp.es_refuse(format('select pg_temp.es_call(token=>%L::timestamptz)',token-interval '1 second'),array['40001'],'ESTIMATE_VERSION_CONFLICT'); return;
    elsif name='failed-frozen-requires-new-request' then perform pg_temp.es_refuse('select pg_temp.es_call(session=>null,null_token=>true)',array['23505'],'ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST'); return;
    end if;
    if name='failed-unfrozen-sent-recovery-no-bail' then delete from public.draft_locks where version_id=e.version_id; end if;
    perform pg_temp.es_actor(); replay:=pg_temp.es_call(token=>token,session=>case when name='failed-unfrozen-sent-recovery-no-bail' then null else pg_temp.es_id(701) end,
      request=>case when name='failed-unfrozen-sent-recovery-no-bail' then pg_temp.es_id(902) else pg_temp.es_id(901) end);
    perform pg_temp.es_actor(null,'none'); perform pg_temp.es_assert(replay.id=e.id and replay.status='preparing','Unfrozen failure did not reuse original dispatch');
    perform pg_temp.es_assert((select count(*)=1 from public.portal_tokens where estimate_email_dispatch_id=e.id),'Failure retry changed own capability count'); return;
  end if;
  if name like 'sent-%' then
    perform pg_temp.es_actor(); e:=pg_temp.es_send();
    perform pg_temp.es_actor(null,'none'); delete from public.draft_locks where version_id=e.version_id;
    doc_before:=(select to_jsonb(x) from public.estimate_documents x where version_id=e.version_id);
    version_before:=(select to_jsonb(x) from public.estimate_versions x where id=e.version_id); identity_before:=e.offer_identity_snapshot;
    if name='sent-new-resend-other-actor-original-identity' then
      actor_n:=1; update public.estimate_projects set name='ARMY CHANGED PROJECT',client_name='ARMY CHANGED CLIENT',reference='ARMY-CHANGED-REF' where id=pg_temp.es_id(201);
    end if;
    perform pg_temp.es_actor(actor_n); replay:=pg_temp.es_call(actor_n=>actor_n,session=>null,request=>pg_temp.es_id(902),company=>pg_temp.es_company()||jsonb_build_object('name','ARMY OTHER COMPANY'));
    perform pg_temp.es_actor(null,'none');
    perform pg_temp.es_assert(replay.id<>e.id and replay.offer_identity_snapshot=identity_before,'Resend recaptured original immutable identity');
    perform pg_temp.es_assert(doc_before=(select to_jsonb(x) from public.estimate_documents x where version_id=e.version_id),'Resend changed original Doc1');
    perform pg_temp.es_assert(version_before=(select to_jsonb(x) from public.estimate_versions x where id=e.version_id),'Resend changed original Seal5/version');
    perform pg_temp.es_assert((select count(*)=2 from public.portal_tokens where version_id=e.version_id and estimate_email_dispatch_id in(e.id,replay.id) and capability_contract_version=2),'Two own capabilities absent');
    perform pg_temp.es_assert((select count(*)=1 from public.portal_tokens where estimate_email_dispatch_id=replay.id and email=replay.recipient),'Resend capability not owned by new dispatch'); return;
  end if;
  case name
    when 'draft-same-actor-other-session' then perform pg_temp.es_refuse('select pg_temp.es_call(session=>pg_temp.es_id(702))',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-replaced-same-actor-session' then
      delete from public.draft_locks where version_id=pg_temp.es_id(301); insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.es_id(301),pg_temp.es_id(2),pg_temp.es_id(702),clock_timestamp()+interval '1 hour');
      perform pg_temp.es_refuse('select pg_temp.es_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-lease-expired-after-transaction-start' then
      ttl:=now()+interval '0.000001 second'; update public.draft_locks set expires_at=ttl where version_id=pg_temp.es_id(301); perform pg_sleep(0.005);
      perform pg_temp.es_assert(now()<ttl and clock_timestamp()>ttl,'Real time expiry boundary absent'); perform pg_temp.es_refuse('select pg_temp.es_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-expired-session' then update public.draft_locks set expires_at=now()-interval '1 second' where version_id=pg_temp.es_id(301); perform pg_temp.es_refuse('select pg_temp.es_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-missing-session' then delete from public.draft_locks where version_id=pg_temp.es_id(301); perform pg_temp.es_refuse('select pg_temp.es_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-other-actor-session' then delete from public.draft_locks where version_id=pg_temp.es_id(301); insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.es_id(301),pg_temp.es_id(1),pg_temp.es_id(701),clock_timestamp()+interval '1 hour'); perform pg_temp.es_refuse('select pg_temp.es_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-null-session' then perform pg_temp.es_refuse('select pg_temp.es_call(session=>null)',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'draft-invalid-uuid-session' then perform pg_temp.es_refuse('select pg_temp.es_call(session=>''not-a-uuid''::uuid)',array['22P02']);
    when 'draft-null-cas' then perform pg_temp.es_refuse('select pg_temp.es_call(null_token=>true)',array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'draft-stale-cas' then perform pg_temp.es_refuse(format('select pg_temp.es_call(token=>%L::timestamptz)',token-interval '1 second'),array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'draft-stale-same-millisecond-cas' then
      stale:=token+interval '0.000001 second'; if date_trunc('milliseconds',stale)<>date_trunc('milliseconds',token) then stale:=token-interval '0.000001 second'; end if;
      perform pg_temp.es_assert(abs(extract(epoch from stale-token))=0.000001 and date_trunc('milliseconds',stale)=date_trunc('milliseconds',token),'Exact1us same-ms boundary absent');
      perform pg_temp.es_refuse(format('select pg_temp.es_call(token=>%L::timestamptz)',stale),array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'actor-null' then perform pg_temp.es_refuse('select pg_temp.es_call(actor_n=>null)',array['42501']);
    when 'actor-viewer' then perform set_config('es.actor','4',true); perform pg_temp.es_refuse('select pg_temp.es_call(actor_n=>4)',array['42501']);
    when 'actor-director' then perform set_config('es.actor','5',true); perform pg_temp.es_refuse('select pg_temp.es_call(actor_n=>5)',array['42501']);
    when 'actor-nonowner-engineer' then perform set_config('es.actor','6',true); perform pg_temp.es_refuse('select pg_temp.es_call(actor_n=>6)',array['42501']);
    when 'actor-membership-removed' then delete from public.tenant_memberships where tenant_id=pg_temp.es_id(101) and user_id=pg_temp.es_id(2); perform pg_temp.es_refuse('select pg_temp.es_call()',array['42501']);
    when 'tenant-inactive' then update public.tenants set is_active=false where id=pg_temp.es_id(101); perform pg_temp.es_refuse('select pg_temp.es_call()',array['P0001']);
    when 'project-archived' then update public.estimate_projects set is_archived=true where id=pg_temp.es_id(201); perform pg_temp.es_refuse('select pg_temp.es_call()',array['42501']);
    when 'tenant-foreign' then perform pg_temp.es_refuse('select pg_temp.es_call(tenant_n=>102)',array['P0001']);
    when 'version-missing' then perform pg_temp.es_refuse(format('select pg_temp.es_call(version_n=>399,token=>%L::timestamptz)',token),array['P0001']);
    when 'service-role-required-postgres' then perform set_config('es.role','none',true); perform pg_temp.es_refuse('select pg_temp.es_call()',array['42501'],'SERVICE_ROLE_REQUIRED');
    when 'service-role-required-authenticated' then perform set_config('es.role','authenticated',true); perform pg_temp.es_refuse('select pg_temp.es_call()',array['42501']);
    when 'service-role-required-anon' then perform set_config('es.role','anon',true); perform pg_temp.es_refuse('select pg_temp.es_call()',array['42501']);
    when 'request-null' then perform pg_temp.es_refuse('select pg_temp.es_call(request=>null)',array['22023'],'ESTIMATE_EMAIL_DISPATCH_INPUT_INVALID');
    when 'payload-hash-invalid' then perform pg_temp.es_refuse('select pg_temp.es_call(payload=>''bad'')',array['22023'],'ESTIMATE_EMAIL_DISPATCH_INPUT_INVALID');
    when 'offer-validity-expired' then update public.estimate_versions set date_devis='2000-01-01',validite_jours=1 where id=pg_temp.es_id(301); perform pg_temp.es_refuse('select pg_temp.es_call()',array['23514'],'OFFER_VALIDITY_EXPIRED');
    when 'reserve-late-fault-rollback' then
      select case when is_called then last_value else 0 end into hits from pg_temp.es_fault_hits; perform set_config('es.fault','enabled',true);
      perform pg_temp.es_refuse('select pg_temp.es_call()',array['P9001'],'EMAIL_SESSION_AFTER_CAPABILITY_BEFORE_EVENT');
      perform pg_temp.es_assert((select is_called and last_value>hits from pg_temp.es_fault_hits),'Late fault not hit');
    else raise exception 'Unknown email-session case';
  end case;
end $f$;

do $email_session_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure_state text; failure_message text; failures integer;
begin
  foreach case_name in array array[
    'catalog-new14-boundary',
    'fresh-v1-admin',
    'fresh-v1-owner-engineer',
    'fresh-v2-admin',
    'fresh-v2-zero-retained-labor',
    'draft-same-actor-other-session',
    'draft-replaced-same-actor-session',
    'draft-lease-expired-after-transaction-start',
    'draft-expired-session',
    'draft-missing-session',
    'draft-other-actor-session',
    'draft-null-session',
    'draft-invalid-uuid-session',
    'draft-null-cas',
    'draft-stale-cas',
    'draft-stale-same-millisecond-cas',
    'actor-null',
    'actor-viewer',
    'actor-director',
    'actor-nonowner-engineer',
    'actor-membership-removed',
    'tenant-inactive',
    'project-archived',
    'tenant-foreign',
    'version-missing',
    'service-role-required-postgres',
    'service-role-required-authenticated',
    'service-role-required-anon',
    'request-null',
    'payload-hash-invalid',
    'offer-validity-expired',
    'reserve-late-fault-rollback',
    'replay-preparing',
    'replay-queued',
    'replay-processing',
    'replay-unknown',
    'replay-sent',
    'replay-delivered',
    'replay-bounced',
    'replay-after-accepted',
    'replay-after-archived',
    'active-new-key-same-envelope',
    'active-new-key-different-envelope',
    'replay-payload-mismatch',
    'replay-recipient-mismatch',
    'replay-cc-mismatch',
    'replay-subject-mismatch',
    'replay-body-mismatch',
    'replay-actor-mismatch',
    'replay-version-mismatch',
    'failed-unfrozen-draft-own-session',
    'failed-unfrozen-draft-other-session',
    'failed-unfrozen-draft-stale-cas',
    'failed-frozen-requires-new-request',
    'failed-unfrozen-sent-recovery-no-bail',
    'sent-new-resend-no-bail',
    'sent-new-resend-other-actor-original-identity',
    'sent-two-dispatches-own-capabilities'
  ] loop
    passed:=false; failure_state:=null; failure_message:=null;
    begin perform pg_temp.es_case(case_name); raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true;
      when others then get stacked diagnostics failure_state=returned_sqlstate,failure_message=message_text;
    end;
    perform pg_temp.es_actor(null,'none');
    if not passed then raise notice 'EMAIL_SESSION_PRIVATE_CASE:%',jsonb_build_object('case',case_name,'sqlstate',failure_state,'message',failure_message); end if;
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'errorSqlstate',failure_state));
  end loop;
  select count(*) into failures from jsonb_array_elements(results)x where not(x->>'passed')::boolean;
  raise exception using errcode='P9001',message='ESTIMATE_EMAIL_SESSION_PROOF:'||jsonb_build_object('mode',current_setting('es.mode'),
    'allPassed',failures=0,'fixturePrefix','efca0900','caseCount',jsonb_array_length(results),'failedCount',failures,
    'financialEngineCoverage',jsonb_build_array(1,2),'concurrencyExecuted',false,'transportExecuted',false,'pdfBytesVerified',false,
    'sealHashVerified',false,'genuineLegacyOfferVerified',false,'cases',results)::text;
end;
$email_session_probe$;
-- Mandatory P9001 above, never commit fixture identities.
rollback;
