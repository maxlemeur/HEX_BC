-- PRECODE: failures, SQL isolation exception and proof boundaries are in plan.md.
-- Explicit baseline executes old10; candidate/installed executes ONLY new11.
-- Never commit fixture identities; root owns admission/full-column conservation.
begin;
set local lock_timeout='3s';
set local statement_timeout='90s';
set local idle_in_transaction_session_timeout='120s';
do $preflight$
begin
  if current_user<>'postgres' then raise exception 'missing-precondition: specialist postgres required'; end if;
  if to_regprocedure('public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb)') is null
    or to_regprocedure('public.begin_estimate_pdf_generation(uuid,uuid,uuid,text,uuid)') is null
    or to_regprocedure('public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)') is null then
    raise exception 'missing-precondition: installed contracts absent';
  end if;
  if coalesce(current_setting('me.mode',true),'') not in('baseline','candidate','installed') then raise exception 'missing-precondition: explicit runner mode required'; end if;
  if current_setting('me.mode')<>'baseline' and to_regprocedure('public.transition_estimate_draft_to_sent(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb,uuid)') is null then
    raise exception 'missing-precondition: new session RPC absent; no native fallback';
  end if;
  if exists(select 1 from auth.users where id::text like 'afca0800-%') or exists(select 1 from public.tenants where id::text like 'afca0800-%')
    or exists(select 1 from public.estimate_projects where id::text like 'afca0800-%') then raise exception 'missing-precondition: manual fixture prefix occupied'; end if;
end;
$preflight$;
create function pg_temp.me_id(n integer) returns uuid language sql immutable as $f$
  select ('afca0800-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$f$;
create function pg_temp.me_assert(ok boolean,detail text) returns void language plpgsql as $f$
begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
create function pg_temp.me_actor(n integer default 2,db_role text default 'service_role')
returns void language plpgsql as $f$
begin
  perform set_config('role','none',true);
  perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.me_id(n)::text end,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.me_id(n) end,'role',db_role)::text,true);
  perform set_config('role',db_role,true);
end $f$;

-- Transaction-only Auth rows invoke the REAL profile/bootstrap triggers.
insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.me_id(n),'army-manual-session-sql-'||n||'@example.invalid',
  jsonb_build_object('full_name',case n when 1 then 'ARMY project owner' when 2 then 'ARMY emitting admin' else 'ARMY other tenant actor' end)
from generate_series(1,3)n;
update public.profiles set full_name='ARMY emitting admin',job_title='Chargé d’affaires',
  phone='+33 1 00 00 00 02',work_email='army-issuer@example.invalid' where id=pg_temp.me_id(2);
update public.tenant_memberships set is_default=false where user_id::text like 'afca0800-%';
insert into public.tenants(id,name,slug) values
  (pg_temp.me_id(101),'ARMY offer contract T1','army-manual-session-t1'),
  (pg_temp.me_id(102),'ARMY offer contract T2','army-manual-session-t2');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values
  (pg_temp.me_id(101),pg_temp.me_id(1),'engineer',true,'2020-01-01'),
  (pg_temp.me_id(101),pg_temp.me_id(2),'admin',true,'2020-01-01'),
  (pg_temp.me_id(102),pg_temp.me_id(3),'admin',true,'2020-01-01');
insert into public.estimate_projects(id,tenant_id,user_id,name,reference,estimate_reference,client_name,site_address)
values (pg_temp.me_id(201),pg_temp.me_id(101),pg_temp.me_id(1),'ARMY captured project A',
  'ARMY-REF-A','ARMY-EST-A','ARMY client A','ARMY site A'),
  (pg_temp.me_id(202),pg_temp.me_id(102),pg_temp.me_id(3),'ARMY other tenant project',
  'ARMY-REF-T2','ARMY-EST-T2','ARMY client T2','ARMY site T2');
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,
  date_devis,validite_jours,margin_mode,margin_multiplier,tax_rate_bp,total_ht_cents,total_tax_cents,total_ttc_cents)
select pg_temp.me_id(n),pg_temp.me_id(201),n-300,'draft',1,'2030-02-01',365,'fixed',1,2000,10000,2000,12000
from generate_series(301,303)n;
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,date_devis,validite_jours)
values(pg_temp.me_id(304),pg_temp.me_id(202),1,'draft',1,'2030-02-01',365);
-- PREPARATION revision04: installed hierarchy requires a section parent for
-- every line. Actual root sections belong to the SAME version as their child.
insert into public.estimate_items(id,version_id,item_type,position,title)
select pg_temp.me_id(n+100),pg_temp.me_id(n),'section',0,'ARMY commercial section'
from generate_series(301,304)n;
insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,
  unit_price_ht_cents,pu_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,k_fo,h_mo,k_mo)
select pg_temp.me_id(n+200),pg_temp.me_id(n),pg_temp.me_id(n+100),'line',0,'ARMY commercial line','u',2,5000,5000,
  2000,10000,2000,12000,1,0,1 from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
select pg_temp.me_id(n),pg_temp.me_id(2),pg_temp.me_id(701),clock_timestamp()+interval '1 hour'
from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
values(pg_temp.me_id(304),pg_temp.me_id(3),pg_temp.me_id(701),clock_timestamp()+interval '1 hour');

create function pg_temp.me_state() returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t record; rows_value jsonb; result jsonb:='{}';
begin
  -- Related random dispatch/token/audit IDs still contain the dedicated parent
  -- UUID in their full row. Images stay internal; they are NEVER reported.
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in('public','private','auth')
    order by n.nspname,c.relname loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%afca0800-%%''',t.nspname,t.relname) into rows_value;
    if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
  end loop;
  return result;
end $f$;
create function pg_temp.me_company() returns jsonb language sql immutable as $f$
  select '{"name":"ARMY COMPANY A","tagline":"Synthetic test company","address":{"street":"ARMY street A","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"ARMY office A","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 03","mobile":"+33 6 00 00 00 04"},"legal":{"siret":"ARMY-FIXTURE-A","vat":"ARMY-VAT-A"}}'::jsonb
$f$;
create function pg_temp.me_layout() returns jsonb language sql immutable as $f$
  select '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":true}'::jsonb
$f$;
create function pg_temp.me_terms() returns jsonb language sql immutable as $f$
  select jsonb_build_object('templateId',pg_temp.me_id(801),'title','Synthetic CGV fixture',
    'body','TEST FIXTURE ONLY. Synthetic review metadata is not a genuine legal approval.',
    'version',1,'legalReviewedAt','2026-10-01T12:00:00.000Z','capturedAt','2026-10-13T12:00:00.000Z')
$f$;
create function pg_temp.me_snapshot(v integer default 301) returns jsonb language sql as $f$
  select jsonb_build_object('schemaVersion',1,
    'version',jsonb_build_object('id',e.id,'tenantId',e.tenant_id,'projectId',e.project_id,'number',e.version_number,
      'contentRevision',e.content_revision,'calcEngineVersion',e.calc_engine_version,'dateDevis',e.date_devis,
      'validiteJours',e.validite_jours,'currency',e.currency,'contractorRole',e.contractor_role,'taxRateBp',e.tax_rate_bp),
    'project',jsonb_build_object('name',p.name,'reference',p.reference,'estimateReference',
      case when e.version_number>1 then p.estimate_reference||'_V'||e.version_number else p.estimate_reference end,
      'clientName',p.client_name,'siteAddress',p.site_address),
    'issuer',jsonb_build_object('userId',pg_temp.me_id(2),'displayName','ARMY emitting admin','displayRole','Chargé d’affaires',
      'phone','+33 1 00 00 00 02','email','army-issuer@example.invalid'),
    'company',pg_temp.me_company(),
    'rows',jsonb_build_array(
      jsonb_build_object('kind','section','id',pg_temp.me_id(v+100),'parentId',null,'position',0,'depth',0,
        'number','1','title','ARMY commercial section','saleHtCents',e.total_ht_cents),
      jsonb_build_object('kind','line','id',pg_temp.me_id(v+200),'parentId',pg_temp.me_id(v+100),'position',0,'depth',1,
        'title','ARMY commercial line','quantity',2,'unit','u','unitSaleHtCents',e.total_ht_cents/2,'saleHtCents',e.total_ht_cents)),
    'totals',jsonb_build_object('saleHtCents',e.total_ht_cents,'taxCents',e.total_tax_cents,'calculatedTtcCents',e.total_ttc_cents,'payableTtcCents',e.total_ttc_cents,'roundingAdjustmentCents',0),
    'exclusions',e.exclusions)
  from public.estimate_versions e join public.estimate_projects p on p.id=e.project_id where e.id=pg_temp.me_id(v)
$f$;
create function pg_temp.me_proof(v integer default 301) returns jsonb language sql as $f$
  select jsonb_build_object('proofVersion',1,'documentId',d.id,'tenantId',d.tenant_id,'versionId',d.version_id,
    'projectId',e.project_id,'status',d.status,'filePath',d.file_path,'sha256Hash',d.sha256_hash,'fileSizeBytes',d.file_size_bytes,
    'generatedAt',case when d.generated_at is null then null else to_char(d.generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'generatedBy',d.generated_by,'publishedGenerationToken',d.published_generation_token,'publishedPurpose',d.published_purpose,
    'publishedDispatchId',d.published_dispatch_id,'publishedContentRevision',d.published_content_revision,
    'clientContractVersion',d.client_contract_version,'clientContractSnapshot',d.client_contract_snapshot,
    'layoutOptions',d.layout_options,'termsSnapshot',d.terms_snapshot)
  from public.estimate_documents d join public.estimate_versions e on e.id=d.version_id where d.version_id=pg_temp.me_id(v)
$f$;
create function pg_temp.me_publish(v integer default 301,purpose text default 'email',dispatch_id uuid default null)
returns public.estimate_documents language plpgsql as $f$
declare d public.estimate_documents; path_value text;
begin
  d:=public.begin_estimate_pdf_generation(pg_temp.me_id(v),pg_temp.me_id(101),pg_temp.me_id(2),purpose,dispatch_id);
  path_value:=pg_temp.me_id(101)||'/'||pg_temp.me_id(201)||'/'||pg_temp.me_id(v)||'/'||repeat('a',64)||'.pdf';
  return public.publish_estimate_pdf_generation(pg_temp.me_id(v),pg_temp.me_id(101),pg_temp.me_id(2),d.generation_token,
    path_value,repeat('a',64),1234,'2026-10-13T12:00:00.123456Z',pg_temp.me_layout(),pg_temp.me_terms(),pg_temp.me_snapshot(v));
end $f$;

-- Additional synthetic actors remain transaction-only; real Auth bootstrap.
insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.me_id(n),'army-manual-session-'||n||'@example.invalid',jsonb_build_object('full_name','ARMY manual actor '||n) from generate_series(4,6)n;
update public.tenant_memberships set is_default=false where user_id::text like 'afca0800-%' and user_id in(pg_temp.me_id(4),pg_temp.me_id(5),pg_temp.me_id(6));
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
select pg_temp.me_id(101),pg_temp.me_id(n),(case n when 4 then 'viewer' when 5 then 'director' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(4,6)n;
insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values(pg_temp.me_id(601),pg_temp.me_id(101),pg_temp.me_id(1),'ARMY zero rate retained pose',0);
delete from public.feature_flags where tenant_id=pg_temp.me_id(101) and flag_key='EST_031_LABOR_SPLIT';
delete from public.margin_tiers where tenant_id=pg_temp.me_id(101);

-- Legitimate initial V2 rows, matching the installed document fixture.
-- Never convert an existing V1 engine or directly edit derived V2 snapshots.
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,max_section_depth,
  date_devis,validite_jours,margin_mode,margin_multiplier,tax_rate_bp,rounding_mode,rounding_step_cents,total_ht_cents,total_tax_cents,total_ttc_cents)
select pg_temp.me_id(n),pg_temp.me_id(201),n-300,'draft',2,4,'2030-02-01',365,'fixed',1,2000,'none',100,
  case when n=305 then 0 else 10000 end,case when n=305 then 0 else 2000 end,case when n=305 then 0 else 12000 end
from generate_series(305,306)n;
insert into public.estimate_items(id,version_id,item_type,position,title)
select pg_temp.me_id(n+100),pg_temp.me_id(n),'section',0,'ARMY commercial section' from generate_series(305,306)n;
insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,line_nature,
  unit_price_ht_cents,pu_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,k_fo,h_mo,k_mo,labor_role_id)
select pg_temp.me_id(n+200),pg_temp.me_id(n),pg_temp.me_id(n+100),'line',0,'ARMY commercial line','u',2,'supply_and_labor',
  case when n=305 then 0 else 5000 end,case when n=305 then 0 else 5000 end,2000,
  case when n=305 then 0 else 10000 end,case when n=305 then 0 else 2000 end,case when n=305 then 0 else 12000 end,
  1,0.5,1,pg_temp.me_id(601) from generate_series(305,306)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
select pg_temp.me_id(n),pg_temp.me_id(2),pg_temp.me_id(701),clock_timestamp()+interval '1 hour' from generate_series(305,306)n;

create function pg_temp.me_refuse(command text,expected_states text[],expected_message text default null) returns void language plpgsql as $f$
declare before_state jsonb; actual_state text; actual_message text;
begin
  perform pg_temp.me_actor(null,'none');
  perform set_config('me.token.v'||n,(select updated_at::text from public.estimate_versions where id=pg_temp.me_id(n)),true) from generate_series(301,304)n;
  before_state:=pg_temp.me_state();
  perform pg_temp.me_actor(coalesce(nullif(current_setting('me.actor',true),'')::integer,2),coalesce(nullif(current_setting('me.role',true),''),'service_role'));
  begin execute command; exception when others then get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text; end;
  perform pg_temp.me_actor(null,'none');
  perform pg_temp.me_assert(actual_state=any(expected_states) and (expected_message is null or actual_message=expected_message),'Refusal did not return the expected fixed error class');
  perform pg_temp.me_assert(before_state=pg_temp.me_state(),'Refusal changed full fixture data/audit/workflow');
end $f$;

create function pg_temp.me_call(actor integer default 2,session uuid default pg_temp.me_id(701),token timestamptz default null,
  version_n integer default 302,tenant_n integer default 101,next_status public.estimate_status default 'sent',
  seal text default repeat('b',64),marker smallint default 5,proof jsonb default null,metadata jsonb default '{}',occurred timestamptz default clock_timestamp())
returns public.estimate_versions language plpgsql as $f$
declare expected timestamptz; captured jsonb;
begin
  expected:=coalesce(token,nullif(current_setting('me.token.v'||version_n,true),'')::timestamptz,(select updated_at from public.estimate_versions where id=pg_temp.me_id(version_n)));
  captured:=coalesce(proof,pg_temp.me_proof(version_n));
  if current_setting('me.mode')='baseline' then
    -- Explicit regression baseline only. This is NEVER an application fallback.
    return public.transition_estimate_version_status(pg_temp.me_id(version_n),pg_temp.me_id(tenant_n),expected,next_status,seal,pg_temp.me_id(actor),metadata,occurred,marker,captured);
  end if;
  return public.transition_estimate_draft_to_sent(pg_temp.me_id(version_n),pg_temp.me_id(tenant_n),expected,next_status,seal,pg_temp.me_id(actor),metadata,occurred,marker,captured,session);
end $f$;

create function pg_temp.me_prepare_v2(zero_money boolean default false) returns void language plpgsql as $f$
declare version_n integer:=case when zero_money then 305 else 306 end; frozen public.estimate_versions; amount bigint:=case when zero_money then 0 else 10000 end; tax bigint:=case when zero_money then 0 else 2000 end;
begin
  perform pg_temp.me_actor();
  frozen:=public.freeze_estimate_v2_snapshot(pg_temp.me_id(version_n),pg_temp.me_id(101),(select updated_at from public.estimate_versions where id=pg_temp.me_id(version_n)),
    (select content_revision from public.estimate_versions where id=pg_temp.me_id(version_n)),pg_temp.me_id(2),'send',
    jsonb_build_object('labor_split_enabled',false,'labor_roles',jsonb_build_array(jsonb_build_object('id',pg_temp.me_id(601),'hourly_rate_cents',0)),
      'margin_tiers','[]'::jsonb,'effective_margin_multiplier',1),
    jsonb_build_array(jsonb_build_object('id',pg_temp.me_id(version_n+200),'snapshot_pu_ht_cents',amount/2,'snapshot_fo_ht_cents',amount,'snapshot_mo_ht_cents',0,
      'snapshot_mo_atelier_ht_cents',0,'snapshot_mo_chantier_ht_cents',0,'line_total_ht_cents',amount,'line_tax_cents',tax,'line_total_ttc_cents',amount+tax)),
    jsonb_build_object('total_ht_cents',amount,'total_tax_cents',tax,'total_ttc_cents',amount+tax,'rounding_adjustment_cents',0));
  perform pg_temp.me_assert(frozen.calc_engine_version=2 and frozen.calc_snapshot_content_revision=frozen.content_revision,'Real v2 freeze prerequisite missing');
end $f$;

create temporary sequence me_fault_hits;
create function pg_temp.me_late_fault() returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if coalesce(current_setting('me.fault',true),'')='enabled' and new.estimate_version_id=pg_temp.me_id(302) and new.event_type='sent' then
    perform pg_temp.me_assert((select status='sent' and seal_payload_version=5 and seal_hash=repeat('b',64) from public.estimate_versions where id=pg_temp.me_id(302)), 'Late fault precedes actual status/seal mutation');
    perform nextval('pg_temp.me_fault_hits'); raise exception using errcode='P9001',message='MANUAL_SESSION_AFTER_STATUS_BEFORE_EVENT';
  end if;
  return new;
end $f$;
create trigger zzz_manual_session_late_probe before insert on public.estimate_version_events for each row execute function pg_temp.me_late_fault();

create function pg_temp.me_case(name text) returns void language plpgsql as $f$
declare result public.estimate_versions; d public.estimate_documents; proof jsonb; token timestamptz; stale timestamptz; sig text; command text;
  p record; test_role text; before_state jsonb; prior_items jsonb; hits bigint; actor_n integer:=2; ttl timestamptz; target_version_n integer:=302;
begin
  perform pg_temp.me_actor(null,'none');
  perform set_config('me.actor','2',true); perform set_config('me.role','service_role',true); perform set_config('me.fault','',true);
  -- Never carry a token cache across case savepoints.
  perform set_config('me.token.v'||n,'',true) from generate_series(301,304)n;
  if name='catalog-contract' then
    if current_setting('me.mode')='baseline' then
      perform pg_temp.me_assert(to_regprocedure('public.transition_estimate_draft_to_sent(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb,uuid)') is null,'Baseline unexpectedly contains new RPC'); return;
    end if;
    sig:='public.transition_estimate_draft_to_sent(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb,uuid)';
    select * into p from pg_proc where oid=to_regprocedure(sig);
    perform pg_temp.me_assert(p.oid is not null and not p.prosecdef and p.pronargs=11 and p.pronargdefaults=0 and p.proconfig=array['search_path=""'],'New RPC privilege/config/default contract differs');
    perform pg_temp.me_assert(has_function_privilege('service_role',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE'),'New RPC exposes nonservice EXECUTE'); return;
  end if;
  if name in('v2-zero-money-success','v2-retained-zero-labor-success') then target_version_n:=case when name='v2-zero-money-success' then 305 else 306 end; perform pg_temp.me_prepare_v2(name='v2-zero-money-success'); end if;
  perform pg_temp.me_actor();
  if name<>'missing-document' then d:=pg_temp.me_publish(target_version_n,'workflow',null); proof:=pg_temp.me_proof(target_version_n); end if;
  perform pg_temp.me_actor(null,'none');
  token:=(select updated_at from public.estimate_versions where id=pg_temp.me_id(target_version_n));
  prior_items:=(select jsonb_agg(to_jsonb(i) order by i.position,i.id) from public.estimate_items i where version_id=pg_temp.me_id(target_version_n));
  if name in('admin-success','owner-engineer-success','v2-zero-money-success','v2-retained-zero-labor-success','null-optional-metadata') then
    if name='owner-engineer-success' then
      actor_n:=1; delete from public.draft_locks where version_id=pg_temp.me_id(target_version_n);
      insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.me_id(target_version_n),pg_temp.me_id(1),pg_temp.me_id(701),clock_timestamp()+interval '1 hour');
    end if;
    perform pg_temp.me_actor(actor_n);
    result:=pg_temp.me_call(actor=>actor_n,token=>token,version_n=>target_version_n,metadata=>case when name='null-optional-metadata' then null else '{}'::jsonb end,occurred=>case when name='null-optional-metadata' then null else clock_timestamp() end);
    perform pg_temp.me_actor(null,'none');
    perform pg_temp.me_assert(result.status='sent' and result.seal_hash=repeat('b',64) and result.seal_payload_version=5,'Success did not produce sent/Seal5');
    perform pg_temp.me_assert(prior_items=(select jsonb_agg(to_jsonb(i) order by i.position,i.id) from public.estimate_items i where version_id=pg_temp.me_id(target_version_n)),'Transition changed native line rows');
    perform pg_temp.me_assert(not exists(select 1 from public.estimate_emails where version_id=pg_temp.me_id(target_version_n)) and not exists(select 1 from public.portal_tokens where version_id=pg_temp.me_id(target_version_n)),'Manual path created transport/capability');
    perform pg_temp.me_assert((select count(*)=1 from public.estimate_version_events where estimate_version_id=pg_temp.me_id(target_version_n) and event_type='sent'),'Sent event absent/duplicated');
    if name like 'v2-%' then
      perform pg_temp.me_assert((select calc_snapshot_content_revision=content_revision and calc_engine_version=2 from public.estimate_versions where id=pg_temp.me_id(target_version_n)),'Transition lost current v2 image');
      perform pg_temp.me_assert((select h_mo=0.5 and labor_role_id=pg_temp.me_id(601) and snapshot_mo_ht_cents=0 from public.estimate_items where id=pg_temp.me_id(target_version_n+200)),'Transition lost zero-rate retained hours/role');
      if name='v2-zero-money-success' then perform pg_temp.me_assert(result.total_ht_cents=0 and result.total_tax_cents=0 and result.total_ttc_cents=0,'Zero money changed'); end if;
    end if;
    return;
  end if;
  case name
    when 'same-actor-other-session' then perform pg_temp.me_refuse('select pg_temp.me_call(session=>pg_temp.me_id(702))',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'replaced-same-actor-session' then
      delete from public.draft_locks where version_id=pg_temp.me_id(302);
      insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.me_id(302),pg_temp.me_id(2),pg_temp.me_id(702),clock_timestamp()+interval '1 hour');
      perform pg_temp.me_refuse('select pg_temp.me_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'lease-expired-after-transaction-start' then
      ttl:=now()+interval '0.000001 second'; update public.draft_locks set expires_at=ttl where version_id=pg_temp.me_id(302);
      perform pg_sleep(0.005); perform pg_temp.me_assert(now()<ttl and clock_timestamp()>ttl,'Clock boundary not established');
      perform pg_temp.me_refuse('select pg_temp.me_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'expired-session' then update public.draft_locks set expires_at=now()-interval '1 second' where version_id=pg_temp.me_id(302); perform pg_temp.me_refuse('select pg_temp.me_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'missing-session' then delete from public.draft_locks where version_id=pg_temp.me_id(302); perform pg_temp.me_refuse('select pg_temp.me_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'other-actor-session' then delete from public.draft_locks where version_id=pg_temp.me_id(302); insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.me_id(302),pg_temp.me_id(1),pg_temp.me_id(701),clock_timestamp()+interval '1 hour'); perform pg_temp.me_refuse('select pg_temp.me_call()',array['40001'],'ESTIMATE_DRAFT_LOCK_REQUIRED');
    when 'null-session' then perform pg_temp.me_refuse('select pg_temp.me_call(session=>null)',array['22023']);
    when 'invalid-uuid-session' then perform pg_temp.me_refuse('select pg_temp.me_call(session=>''not-a-uuid''::uuid)',array['22P02']);
    when 'null-cas-token' then
      command:=case when current_setting('me.mode')='baseline' then
        format('select public.transition_estimate_version_status(%L,%L,NULL::timestamptz,''sent'',%L,%L,''{}'',clock_timestamp(),5::smallint,%L::jsonb)',pg_temp.me_id(302),pg_temp.me_id(101),repeat('b',64),pg_temp.me_id(2),proof)
      else format('select public.transition_estimate_draft_to_sent(%L,%L,NULL::timestamptz,''sent'',%L,%L,''{}'',clock_timestamp(),5::smallint,%L::jsonb,%L)',pg_temp.me_id(302),pg_temp.me_id(101),repeat('b',64),pg_temp.me_id(2),proof,pg_temp.me_id(701)) end;
      perform pg_temp.me_refuse(command,array['22023']);
    when 'cas-stale-same-millisecond' then
      stale:=token+interval '0.000001 second'; if date_trunc('milliseconds',stale)<>date_trunc('milliseconds',token) then stale:=token-interval '0.000001 second'; end if;
      perform pg_temp.me_assert(abs(extract(epoch from stale-token))=0.000001 and date_trunc('milliseconds',stale)=date_trunc('milliseconds',token),'CAS exact1us same-ms boundary not established');
      perform pg_temp.me_refuse(format('select pg_temp.me_call(token=>%L::timestamptz)',stale),array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'cas-stale-ordinary' then perform pg_temp.me_refuse(format('select pg_temp.me_call(token=>%L::timestamptz)',token-interval '1 second'),array['40001'],'ESTIMATE_VERSION_CONFLICT');
    when 'viewer' then perform set_config('me.actor','4',true); perform pg_temp.me_refuse('select pg_temp.me_call(actor=>4)',array['42501']);
    when 'director' then perform set_config('me.actor','5',true); perform pg_temp.me_refuse('select pg_temp.me_call(actor=>5)',array['42501']);
    when 'engineer-other-owner' then perform set_config('me.actor','6',true); perform pg_temp.me_refuse('select pg_temp.me_call(actor=>6)',array['42501']);
    when 'foreign-tenant-actor' then perform set_config('me.actor','3',true); perform pg_temp.me_refuse('select pg_temp.me_call(actor=>3)',array['42501']);
    when 'wrong-tenant' then perform pg_temp.me_refuse('select pg_temp.me_call(tenant_n=>102)',array['42501','P0001']);
    when 'foreign-version' then perform pg_temp.me_refuse('select pg_temp.me_call(version_n=>304,tenant_n=>102)',array['42501']);
    when 'missing-version' then perform pg_temp.me_refuse(format('select pg_temp.me_call(version_n=>399,token=>%L::timestamptz)',token),array['42501','P0001']);
    when 'membership-revoked' then delete from public.tenant_memberships where tenant_id=pg_temp.me_id(101) and user_id=pg_temp.me_id(2); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501']);
    when 'inactive-tenant' then update public.tenants set is_active=false where id=pg_temp.me_id(101); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501']);
    when 'archived-project' then update public.estimate_projects set is_archived=true where id=pg_temp.me_id(201); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501']);
    when 'anon-direct' then perform set_config('me.role','anon',true); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501']);
    when 'authenticated-direct' then perform set_config('me.role','authenticated',true); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501']);
    when 'postgres-direct' then perform set_config('me.role','none',true); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501'],'SERVICE_ROLE_REQUIRED');
    when 'missing-document' then perform pg_temp.me_refuse('select pg_temp.me_call()',array['23514']);
    when 'unequal-document-proof' then proof:=jsonb_set(proof,'{clientContractSnapshot,project,name}','"ARMY altered"'); perform pg_temp.me_refuse(format('select pg_temp.me_call(proof=>%L::jsonb)',proof),array['23514'],'OFFER_DOCUMENT_PROOF_MISMATCH');
    when 'legacy-seal-marker' then perform pg_temp.me_refuse('select pg_temp.me_call(marker=>4::smallint)',array['23514'],'OFFER_MANUAL_EMISSION_CONTRACT_REQUIRED');
    when 'null-seal-marker' then perform pg_temp.me_refuse('select pg_temp.me_call(marker=>null)',array['23514']);
    when 'null-seal-hash' then perform pg_temp.me_refuse('select pg_temp.me_call(seal=>null)',array['23514']);
    when 'invalid-seal-hash' then perform pg_temp.me_refuse('select pg_temp.me_call(seal=>''invalid'')',array['23514']);
    when 'no-accepted-entry' then perform pg_temp.me_refuse('select pg_temp.me_call(next_status=>''accepted'')',array['22023']);
    when 'no-archived-entry' then perform pg_temp.me_refuse('select pg_temp.me_call(next_status=>''archived'')',array['22023']);
    when 'no-null-status-entry' then perform pg_temp.me_refuse('select pg_temp.me_call(next_status=>null)',array['22023']);
    when 'not-draft-sent' then
      perform pg_temp.me_actor(); result:=pg_temp.me_call(); perform pg_temp.me_actor(null,'none');
      perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501'],'ESTIMATE_MANUAL_EMISSION_REQUIRES_DRAFT');
    when 'not-draft-accepted' then
      perform pg_temp.me_actor(); result:=pg_temp.me_call();
      result:=public.transition_estimate_version_status(pg_temp.me_id(302),pg_temp.me_id(101),result.updated_at,'accepted',null,pg_temp.me_id(2),'{}',clock_timestamp(),5::smallint,pg_temp.me_proof(302));
      perform pg_temp.me_actor(null,'none'); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501'],'ESTIMATE_MANUAL_EMISSION_REQUIRES_DRAFT');
    when 'not-draft-archived' then
      perform pg_temp.me_actor(); result:=pg_temp.me_call();
      result:=public.transition_estimate_version_status(pg_temp.me_id(302),pg_temp.me_id(101),result.updated_at,'archived',null,pg_temp.me_id(2),'{}',clock_timestamp(),5::smallint,pg_temp.me_proof(302));
      perform pg_temp.me_actor(null,'none'); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501'],'ESTIMATE_MANUAL_EMISSION_REQUIRES_DRAFT');
    when 'not-draft-sending' then
      perform pg_temp.me_actor();
      perform public.reserve_estimate_email_dispatch(pg_temp.me_id(302),pg_temp.me_id(101),token,pg_temp.me_id(2),pg_temp.me_id(901),repeat('1',64),
        'army-manual-session@example.invalid',null::text[],'ARMY manual sending fixture','Synthetic message','army-from@example.invalid','http://127.0.0.1:39901',pg_temp.me_company());
      perform pg_temp.me_actor(null,'none'); perform pg_temp.me_refuse('select pg_temp.me_call()',array['42501'],'ESTIMATE_MANUAL_EMISSION_REQUIRES_DRAFT');
    when 'old-lifecycle-without-lease' then
      perform pg_temp.me_actor(); result:=pg_temp.me_call(); perform pg_temp.me_actor(null,'none'); delete from public.draft_locks where version_id=pg_temp.me_id(302); perform pg_temp.me_actor();
      result:=public.transition_estimate_version_status(pg_temp.me_id(302),pg_temp.me_id(101),result.updated_at,'accepted',null,pg_temp.me_id(2),'{}',clock_timestamp(),5::smallint,pg_temp.me_proof(302));
      result:=public.transition_estimate_version_status(pg_temp.me_id(302),pg_temp.me_id(101),result.updated_at,'archived',null,pg_temp.me_id(2),'{}',clock_timestamp(),5::smallint,pg_temp.me_proof(302));
      perform pg_temp.me_assert(result.status='archived' and result.seal_payload_version=5 and result.seal_hash=repeat('b',64),'Old lifecycle changed original Seal5');
    when 'late-failure-rollback' then
      hits:=coalesce((select last_value from pg_temp.me_fault_hits where is_called),0);
      perform set_config('me.fault','enabled',true); perform pg_temp.me_refuse('select pg_temp.me_call()',array['P9001'],'MANUAL_SESSION_AFTER_STATUS_BEFORE_EVENT');
      perform pg_temp.me_assert((select is_called and last_value>hits from pg_temp.me_fault_hits),'Late fault never hit');
    else raise exception 'Unknown manual session case';
  end case;
end $f$;

do $manual_session_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure_state text; failures integer;
begin
  foreach case_name in array array[
    'catalog-contract','admin-success','owner-engineer-success','v2-zero-money-success','v2-retained-zero-labor-success','null-optional-metadata',
    'same-actor-other-session','replaced-same-actor-session','lease-expired-after-transaction-start','expired-session','missing-session','other-actor-session','null-session','invalid-uuid-session','null-cas-token',
    'cas-stale-same-millisecond','cas-stale-ordinary','viewer','director','engineer-other-owner','foreign-tenant-actor','wrong-tenant','foreign-version','missing-version',
    'membership-revoked','inactive-tenant','archived-project','anon-direct','authenticated-direct','postgres-direct','missing-document','unequal-document-proof',
    'legacy-seal-marker','null-seal-marker','null-seal-hash','invalid-seal-hash','no-accepted-entry','no-archived-entry','no-null-status-entry','not-draft-sent','not-draft-accepted','not-draft-archived','not-draft-sending','old-lifecycle-without-lease','late-failure-rollback'
  ] loop
    passed:=false; failure_state:=null;
    begin perform pg_temp.me_case(case_name); raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true; when others then failure_state:=sqlstate; end;
    perform pg_temp.me_actor(null,'none');
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'errorSqlstate',failure_state));
  end loop;
  select count(*) into failures from jsonb_array_elements(results)x where not(x->>'passed')::boolean;
  raise exception using errcode='P9001',message='ESTIMATE_MANUAL_SESSION_PROOF:'||jsonb_build_object('mode',current_setting('me.mode'),
    'allPassed',failures=0,'fixturePrefix','afca0800','caseCount',jsonb_array_length(results),'failedCount',failures,
    'financialEngineCoverage',jsonb_build_array(1,2),'concurrencyExecuted',false,'transportExecuted',false,'pdfBytesVerified',false,'sealHashVerified',false,'genuineLegacyOfferVerified',false,'cases',results)::text;
end;
$manual_session_probe$;
-- Mandatory P9001 above; never commit this fixture.
rollback;
