-- PRECODE: failures were defined in docs/testing/offer-contract-sql.md first.
-- Never run on hosted Supabase. The external runner owns connection admission,
-- before/after preservation and terminal SQLSTATE inspection. No PDF/provider,
-- historical offer, JS seal validation, or two-session race is proved here.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';
set local idle_in_transaction_session_timeout = '120s';

do $preflight$
declare signature text; column_spec text; required_table text; required_column text;
begin
  if current_user <> 'postgres' then
    raise exception 'missing-precondition: local specialist connection must be postgres';
  end if;
  foreach signature in array array[
    'public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb)',
    'public.begin_estimate_pdf_generation(uuid,uuid,uuid,text,uuid)',
    'public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb)',
    'public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,smallint)',
    'public.claim_estimate_email_dispatch(uuid,uuid,uuid,uuid,integer)',
    'public.complete_estimate_email_dispatch(uuid,uuid,uuid,uuid,text,timestamptz)',
    'public.reconcile_estimate_email_dispatch(uuid,text,uuid,text,text)',
    'public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb)',
    'public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'missing-precondition: future offer signature absent: %',signature;
    end if;
  end loop;
  foreach column_spec in array array[
    'portal_tokens.estimate_email_dispatch_id','portal_tokens.capability_contract_version',
    'estimate_emails.request_contract_version','estimate_emails.portal_url',
    'estimate_emails.offer_identity_snapshot','estimate_documents.client_contract_version',
    'estimate_documents.client_contract_snapshot','estimate_versions.seal_payload_version'
  ] loop
    required_table:=split_part(column_spec,'.',1); required_column:=split_part(column_spec,'.',2);
    if not exists(select 1 from information_schema.columns c where c.table_schema='public'
      and c.table_name=required_table and c.column_name=required_column) then
      raise exception 'missing-precondition: future offer column absent: %',column_spec;
    end if;
  end loop;
  if exists(select 1 from auth.users where id::text like 'efca0700-%')
    or exists(select 1 from public.tenants where id::text like 'efca0700-%')
    or exists(select 1 from public.estimate_projects where id::text like 'efca0700-%') then
    raise exception 'missing-precondition: offer fixture prefix already exists';
  end if;
end;
$preflight$;

create function pg_temp.oc_id(n integer) returns uuid language sql immutable as $f$
  select ('efca0700-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$f$;
create function pg_temp.oc_assert(ok boolean,detail text) returns void language plpgsql as $f$
begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
create function pg_temp.oc_actor(n integer default 2,db_role text default 'service_role')
returns void language plpgsql as $f$
begin
  perform set_config('role','none',true);
  perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.oc_id(n)::text end,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.oc_id(n) end,'role',db_role)::text,true);
  perform set_config('role',db_role,true);
end $f$;

-- Transaction-only Auth rows invoke the REAL profile/bootstrap triggers.
insert into auth.users(id,email,raw_user_meta_data)
select pg_temp.oc_id(n),'army-offer-sql-'||n||'@example.invalid',
  jsonb_build_object('full_name',case n when 1 then 'ARMY project owner' when 2 then 'ARMY emitting admin' else 'ARMY other tenant actor' end)
from generate_series(1,3)n;
update public.profiles set full_name='ARMY emitting admin',job_title='Chargé d’affaires',
  phone='+33 1 00 00 00 02',work_email='army-issuer@example.invalid' where id=pg_temp.oc_id(2);
update public.tenant_memberships set is_default=false where user_id::text like 'efca0700-%';
insert into public.tenants(id,name,slug) values
  (pg_temp.oc_id(101),'ARMY offer contract T1','army-offer-contract-t1'),
  (pg_temp.oc_id(102),'ARMY offer contract T2','army-offer-contract-t2');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values
  (pg_temp.oc_id(101),pg_temp.oc_id(1),'engineer',true,'2020-01-01'),
  (pg_temp.oc_id(101),pg_temp.oc_id(2),'admin',true,'2020-01-01'),
  (pg_temp.oc_id(102),pg_temp.oc_id(3),'admin',true,'2020-01-01');
insert into public.estimate_projects(id,tenant_id,user_id,name,reference,estimate_reference,client_name,site_address)
values (pg_temp.oc_id(201),pg_temp.oc_id(101),pg_temp.oc_id(1),'ARMY captured project A',
  'ARMY-REF-A','ARMY-EST-A','ARMY client A','ARMY site A'),
  (pg_temp.oc_id(202),pg_temp.oc_id(102),pg_temp.oc_id(3),'ARMY other tenant project',
  'ARMY-REF-T2','ARMY-EST-T2','ARMY client T2','ARMY site T2');
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,
  date_devis,validite_jours,margin_mode,margin_multiplier,tax_rate_bp,total_ht_cents,total_tax_cents,total_ttc_cents)
select pg_temp.oc_id(n),pg_temp.oc_id(201),n-300,'draft',1,'2030-02-01',365,'fixed',1,2000,10000,2000,12000
from generate_series(301,303)n;
insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,date_devis,validite_jours)
values(pg_temp.oc_id(304),pg_temp.oc_id(202),1,'draft',1,'2030-02-01',365);
-- PREPARATION revision04: installed hierarchy requires a section parent for
-- every line. Actual root sections belong to the SAME version as their child.
insert into public.estimate_items(id,version_id,item_type,position,title)
select pg_temp.oc_id(n+100),pg_temp.oc_id(n),'section',0,'ARMY commercial section'
from generate_series(301,304)n;
insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,
  unit_price_ht_cents,pu_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,k_fo,h_mo,k_mo)
select pg_temp.oc_id(n+200),pg_temp.oc_id(n),pg_temp.oc_id(n+100),'line',0,'ARMY commercial line','u',2,5000,5000,
  2000,10000,2000,12000,1,0,1 from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
select pg_temp.oc_id(n),pg_temp.oc_id(2),pg_temp.oc_id(701),clock_timestamp()+interval '1 hour'
from generate_series(301,303)n;
insert into public.draft_locks(version_id,user_id,session_id,expires_at)
values(pg_temp.oc_id(304),pg_temp.oc_id(3),pg_temp.oc_id(701),clock_timestamp()+interval '1 hour');

create function pg_temp.oc_state() returns jsonb
language plpgsql security definer set search_path='' as $f$
declare t record; rows_value jsonb; result jsonb:='{}';
begin
  -- Related random dispatch/token/audit IDs still contain the dedicated parent
  -- UUID in their full row. Images stay internal; they are NEVER reported.
  for t in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in('public','private','auth')
    order by n.nspname,c.relname loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%efca0700-%%''',t.nspname,t.relname) into rows_value;
    if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
  end loop;
  return result;
end $f$;
create function pg_temp.oc_refuse(command text,expected_states text[]) returns void
language plpgsql as $f$
declare before_state jsonb; actual_state text; changed_rows bigint;
begin
  perform pg_temp.oc_actor(null,'none'); before_state:=pg_temp.oc_state();
  perform pg_temp.oc_actor(coalesce(nullif(current_setting('oc.actor',true),'')::integer,2),coalesce(nullif(current_setting('oc.role',true),''),'service_role'));
  begin execute command; get diagnostics changed_rows=row_count;
  exception when others then actual_state:=sqlstate; end;
  perform pg_temp.oc_actor(null,'none');
  perform pg_temp.oc_assert(actual_state=any(expected_states),
    format('Expected SQLSTATE %s, actual %s (rows %s)',expected_states,coalesce(actual_state,'success'),changed_rows));
  perform pg_temp.oc_assert(before_state=pg_temp.oc_state(),'Refusal changed full fixture data/audit/event state');
end $f$;
create function pg_temp.oc_company() returns jsonb language sql immutable as $f$
  select '{"name":"ARMY COMPANY A","tagline":"Synthetic test company","address":{"street":"ARMY street A","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"ARMY office A","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 03","mobile":"+33 6 00 00 00 04"},"legal":{"siret":"ARMY-FIXTURE-A","vat":"ARMY-VAT-A"}}'::jsonb
$f$;
create function pg_temp.oc_layout() returns jsonb language sql immutable as $f$
  select '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":true}'::jsonb
$f$;
create function pg_temp.oc_terms() returns jsonb language sql immutable as $f$
  select jsonb_build_object('templateId',pg_temp.oc_id(801),'title','Synthetic CGV fixture',
    'body','TEST FIXTURE ONLY. Synthetic review metadata is not a genuine legal approval.',
    'version',1,'legalReviewedAt','2026-10-01T12:00:00.000Z','capturedAt','2026-10-13T12:00:00.000Z')
$f$;
create function pg_temp.oc_snapshot(v integer default 301) returns jsonb language sql as $f$
  select jsonb_build_object('schemaVersion',1,
    'version',jsonb_build_object('id',e.id,'tenantId',e.tenant_id,'projectId',e.project_id,'number',e.version_number,
      'contentRevision',e.content_revision,'calcEngineVersion',e.calc_engine_version,'dateDevis',e.date_devis,
      'validiteJours',e.validite_jours,'currency',e.currency,'contractorRole',e.contractor_role,'taxRateBp',e.tax_rate_bp),
    'project',jsonb_build_object('name',p.name,'reference',p.reference,'estimateReference',
      case when e.version_number>1 then p.estimate_reference||'_V'||e.version_number else p.estimate_reference end,
      'clientName',p.client_name,'siteAddress',p.site_address),
    'issuer',jsonb_build_object('userId',pg_temp.oc_id(2),'displayName','ARMY emitting admin','displayRole','Chargé d’affaires',
      'phone','+33 1 00 00 00 02','email','army-issuer@example.invalid'),
    'company',pg_temp.oc_company(),
    'rows',jsonb_build_array(
      jsonb_build_object('kind','section','id',pg_temp.oc_id(v+100),'parentId',null,'position',0,'depth',0,
        'number','1','title','ARMY commercial section','saleHtCents',10000),
      jsonb_build_object('kind','line','id',pg_temp.oc_id(v+200),'parentId',pg_temp.oc_id(v+100),'position',0,'depth',1,
        'title','ARMY commercial line','quantity',2,'unit','u','unitSaleHtCents',5000,'saleHtCents',10000)),
    'totals',jsonb_build_object('saleHtCents',10000,'taxCents',2000,'calculatedTtcCents',12000,'payableTtcCents',12000,'roundingAdjustmentCents',0),
    'exclusions',e.exclusions)
  from public.estimate_versions e join public.estimate_projects p on p.id=e.project_id where e.id=pg_temp.oc_id(v)
$f$;
create function pg_temp.oc_proof(v integer default 301) returns jsonb language sql as $f$
  select jsonb_build_object('proofVersion',1,'documentId',d.id,'tenantId',d.tenant_id,'versionId',d.version_id,
    'projectId',e.project_id,'status',d.status,'filePath',d.file_path,'sha256Hash',d.sha256_hash,'fileSizeBytes',d.file_size_bytes,
    'generatedAt',case when d.generated_at is null then null else to_char(d.generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'generatedBy',d.generated_by,'publishedGenerationToken',d.published_generation_token,'publishedPurpose',d.published_purpose,
    'publishedDispatchId',d.published_dispatch_id,'publishedContentRevision',d.published_content_revision,
    'clientContractVersion',d.client_contract_version,'clientContractSnapshot',d.client_contract_snapshot,
    'layoutOptions',d.layout_options,'termsSnapshot',d.terms_snapshot)
  from public.estimate_documents d join public.estimate_versions e on e.id=d.version_id where d.version_id=pg_temp.oc_id(v)
$f$;
create function pg_temp.oc_reserve(v integer default 301,request_n integer default 901) returns public.estimate_emails language plpgsql as $f$
begin
  return public.reserve_estimate_email_dispatch(pg_temp.oc_id(v),pg_temp.oc_id(101),
    (select updated_at from public.estimate_versions where id=pg_temp.oc_id(v)),pg_temp.oc_id(2),pg_temp.oc_id(request_n),
    repeat('1',64),'army-client@example.invalid',array['army-cc@example.invalid'],'ARMY OFFER','Human message',
    'army-from@example.invalid','http://127.0.0.1:39901',pg_temp.oc_company());
end $f$;
create function pg_temp.oc_publish(v integer default 301,purpose text default 'email',dispatch_id uuid default null)
returns public.estimate_documents language plpgsql as $f$
declare d public.estimate_documents; path_value text;
begin
  d:=public.begin_estimate_pdf_generation(pg_temp.oc_id(v),pg_temp.oc_id(101),pg_temp.oc_id(2),purpose,dispatch_id);
  path_value:=pg_temp.oc_id(101)||'/'||pg_temp.oc_id(201)||'/'||pg_temp.oc_id(v)||'/'||repeat('a',64)||'.pdf';
  return public.publish_estimate_pdf_generation(pg_temp.oc_id(v),pg_temp.oc_id(101),pg_temp.oc_id(2),d.generation_token,
    path_value,repeat('a',64),1234,'2026-10-13T12:00:00.123456Z',pg_temp.oc_layout(),pg_temp.oc_terms(),pg_temp.oc_snapshot(v));
end $f$;
create function pg_temp.oc_prepare(dispatch_id uuid,v integer default 301) returns public.estimate_emails language plpgsql as $f$
declare d public.estimate_documents;
begin
  select * into d from public.estimate_documents where version_id=pg_temp.oc_id(v);
  return public.prepare_estimate_email_dispatch(dispatch_id,pg_temp.oc_id(101),pg_temp.oc_id(2),repeat('b',64),repeat('c',64),
    '<p>ARMY synthetic offer</p>','ARMY synthetic offer',d.file_path,d.sha256_hash,'ARMY-OFFER.pdf',pg_temp.oc_proof(v),5::smallint);
end $f$;
create function pg_temp.oc_send(v integer default 301,request_n integer default 901) returns public.estimate_emails language plpgsql as $f$
declare e public.estimate_emails; d public.estimate_documents;
begin
  e:=pg_temp.oc_reserve(v,request_n);
  d:=pg_temp.oc_publish(v,'email',e.id);
  e:=pg_temp.oc_prepare(e.id,v);
  e:=public.claim_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.oc_id(2),pg_temp.oc_id(702),120);
  return public.complete_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.oc_id(2),pg_temp.oc_id(702),'ARMY-PROVIDER-ID','2026-10-13T12:05:00.123456Z');
end $f$;
create function pg_temp.oc_decide(token_id uuid,decision text,proof jsonb default null) returns void language plpgsql as $f$
begin
  perform public.claim_portal_estimate_decision(token_id,decision,'127.0.0.1'::inet,
    case when decision='rejected' then 'ARMY synthetic refusal' else null end,repeat('b',64),coalesce(proof,pg_temp.oc_proof()));
end $f$;

-- Nontransactional sequence values witness the exact hit even when the
-- statement/savepoint rolls back. The sequence itself disappears at rollback.
create temporary sequence oc_fault_hits;
create function pg_temp.oc_failpoint() returns trigger
language plpgsql security definer set search_path='' as $f$
declare mode text:=coalesce(current_setting('oc.failpoint',true),''); decision text;
begin
  if tg_table_name='estimate_email_dispatch_events' then
    if mode='reserve-before-event' and new.version_id=pg_temp.oc_id(301) and new.event_type='reserved' then
      perform pg_temp.oc_assert((select status='sending' from public.estimate_versions where id=new.version_id),'Reserve fault before version freeze');
      perform pg_temp.oc_assert(exists(select 1 from public.portal_tokens t where t.estimate_email_dispatch_id=new.dispatch_id and t.capability_contract_version=2),'Reserve fault before capability');
      perform pg_temp.oc_assert(exists(select 1 from public.estimate_emails e where e.id=new.dispatch_id and e.portal_url is not null and e.offer_identity_snapshot is not null),'Reserve fault before identity/URL');
      perform nextval('pg_temp.oc_fault_hits'); raise exception using errcode='P9001',message='OFFER_RESERVE_BEFORE_EVENT';
    end if;
  elsif tg_table_name='estimate_version_events' then
    if mode='decision-before-event' and new.estimate_version_id=pg_temp.oc_id(301) and new.event_type in('accepted','rejected') then
      decision:=new.event_type;
      perform pg_temp.oc_assert((select status::text=case when decision='accepted' then 'accepted' else 'archived' end from public.estimate_versions where id=new.estimate_version_id),'Decision fault before parent change');
      perform pg_temp.oc_assert(exists(select 1 from public.portal_tokens where version_id=new.estimate_version_id and status=decision),'Decision fault before token change');
      perform pg_temp.oc_assert(not exists(select 1 from public.portal_tokens where version_id=new.estimate_version_id and status='pending'),'Decision fault before siblings expired');
      perform nextval('pg_temp.oc_fault_hits'); raise exception using errcode='P9001',message='OFFER_DECISION_BEFORE_EVENT';
    end if;
  elsif tg_table_name='audit_logs' then
    if mode='decision-after-audit' and new.table_name='estimate_version_events' and new.estimate_version_id=pg_temp.oc_id(301)
      and new.after_data->>'event_type' in('accepted','rejected') then
      perform pg_temp.oc_assert(exists(select 1 from public.audit_logs where id=new.id),'Audit AFTER hit without actual row');
      perform pg_temp.oc_assert(exists(select 1 from public.estimate_version_events where id=new.record_id),'Audit AFTER hit without actual event');
      perform nextval('pg_temp.oc_fault_hits'); raise exception using errcode='P9001',message='OFFER_DECISION_AFTER_AUDIT';
    end if;
  end if;
  return new;
end $f$;
create trigger zzz_offer_contract_reserve_probe before insert on public.estimate_email_dispatch_events
  for each row execute function pg_temp.oc_failpoint();
create trigger zzz_offer_contract_decision_probe before insert on public.estimate_version_events
  for each row execute function pg_temp.oc_failpoint();
create trigger zzz_offer_contract_audit_probe after insert on public.audit_logs
  for each row execute function pg_temp.oc_failpoint();

create function pg_temp.oc_case(name text) returns void language plpgsql as $f$
declare e public.estimate_emails; replay public.estimate_emails; d public.estimate_documents; d2 public.estimate_documents;
  t public.portal_tokens; sibling public.portal_tokens; proof jsonb; snapshot jsonb; command text; p record;
  signature text; test_role text; mode text; decision text; mutation text;
  hit_before bigint; hit_after bigint;
begin
  perform set_config('oc.actor','2',true); perform set_config('oc.role','service_role',true); perform set_config('oc.failpoint','',true);
  perform pg_temp.oc_actor();
  if name='catalog-all-overloads' then
    perform pg_temp.oc_actor(null,'none');
    -- Do not shadow the uninitialized PL/pgSQL record p with a SQL alias p.
    -- Every actual RPC call and 42501 oracle below remain unchanged.
    for p in select proc_row.* from pg_catalog.pg_proc proc_row join pg_catalog.pg_namespace n on n.oid=proc_row.pronamespace
      where n.nspname='public' and proc_row.proname=any(array['reserve_estimate_email_dispatch','begin_estimate_pdf_generation',
        'publish_estimate_pdf_generation','prepare_estimate_email_dispatch','claim_estimate_email_dispatch',
        'complete_estimate_email_dispatch','reconcile_estimate_email_dispatch','transition_estimate_version_status','claim_portal_estimate_decision']) loop
      perform pg_temp.oc_assert(not p.prosecdef and 'search_path=""'=any(coalesce(p.proconfig,array[]::text[])),'Offer overload invoker/search_path differs');
      perform pg_temp.oc_assert(not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE'),'Offer overload effective ACL differs');
      perform pg_temp.oc_assert(not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute retained');
      foreach test_role in array array['anon','authenticated'] loop
        command:=format('select %s(%s)',p.oid::regproc,(select string_agg('NULL::'||format_type(x.arg,null),',' order by x.ordinality) from unnest(p.proargtypes::oid[]) with ordinality x(arg,ordinality)));
        perform set_config('oc.role',test_role,true); perform pg_temp.oc_refuse(command,array['42501']);
      end loop;
    end loop;
    foreach signature in array array[
      'public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text)',
      'public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb)',
      'public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text)',
      'public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz)',
      'public.claim_portal_estimate_decision(uuid,text,inet,text)'
    ] loop perform pg_temp.oc_assert(to_regprocedure(signature) is null,'Old emitting overload remains'); end loop;
    foreach test_role in array array['anon','authenticated'] loop
      perform pg_temp.oc_assert(not has_table_privilege(test_role,'public.portal_tokens','INSERT')
        and not has_table_privilege(test_role,'public.portal_tokens','UPDATE')
        and not has_table_privilege(test_role,'public.portal_tokens','DELETE'),'Public token table write privilege retained');
    end loop;
    return;
  end if;
  if name like 'reserve-actor-%' then
    perform pg_temp.oc_actor(null,'none');
    case name
      when 'reserve-actor-membership-deleted' then delete from public.tenant_memberships where tenant_id=pg_temp.oc_id(101) and user_id=pg_temp.oc_id(2);
      when 'reserve-actor-viewer' then update public.tenant_memberships set role='viewer' where tenant_id=pg_temp.oc_id(101) and user_id=pg_temp.oc_id(2);
      when 'reserve-actor-inactive-tenant' then update public.tenants set is_active=false where id=pg_temp.oc_id(101);
      when 'reserve-actor-other-tenant' then null;
      else raise exception 'Unknown actor refusal';
    end case;
    command:=case when name='reserve-actor-other-tenant' then format('select public.reserve_estimate_email_dispatch(%L,%L,(select updated_at from public.estimate_versions where id=%L),%L,%L,%L,%L,NULL::text[],%L,%L,%L,%L,%L::jsonb)',pg_temp.oc_id(301),pg_temp.oc_id(101),pg_temp.oc_id(301),pg_temp.oc_id(3),pg_temp.oc_id(901),repeat('1',64),'army-client@example.invalid','ARMY OFFER','Human message','army-from@example.invalid','http://127.0.0.1:39901',pg_temp.oc_company()) else 'select pg_temp.oc_reserve()' end;
    perform pg_temp.oc_refuse(command,case when name='reserve-actor-inactive-tenant' then array['P0001','42501'] else array['42501'] end); return;
  end if;
  if name='reserve-rollback' then
    perform pg_temp.oc_actor(null,'none'); select case when is_called then last_value else 0 end into hit_before from pg_temp.oc_fault_hits;
    perform set_config('oc.failpoint','reserve-before-event',true); perform pg_temp.oc_refuse('select pg_temp.oc_reserve()',array['P9001']);
    select last_value into hit_after from pg_temp.oc_fault_hits; perform pg_temp.oc_assert(hit_after=hit_before+1,'Reserve exact failpoint not reached'); return;
  end if;
  if name='reserve-replay-identity' then
    e:=pg_temp.oc_reserve(); select * into t from public.portal_tokens where estimate_email_dispatch_id=e.id;
    perform pg_temp.oc_assert(t.id is not null and t.capability_contract_version=2 and t.version_id=e.version_id and t.tenant_id=e.tenant_id and t.email=e.recipient and t.expires_at>clock_timestamp(),'Capability relation invalid');
    perform pg_temp.oc_assert(e.request_contract_version=2 and e.portal_url='http://127.0.0.1:39901/portal/'||t.token::text,'Frozen URL invalid');
    snapshot:=pg_temp.oc_snapshot();
    perform pg_temp.oc_assert(e.offer_identity_snapshot=jsonb_build_object('schemaVersion',1,
      'version',jsonb_build_object('id',e.version_id,'tenantId',e.tenant_id,'projectId',pg_temp.oc_id(201),'contentRevision',e.version_content_revision),
      'issuer',snapshot->'issuer','company',snapshot->'company','project',snapshot->'project'),
      'Reservation complete identity/allowlist/anchors differ');
    perform pg_temp.oc_assert(e.offer_identity_snapshot->'issuer'->>'userId'=pg_temp.oc_id(2)::text and e.created_by=pg_temp.oc_id(2) and e.created_by<>(select user_id from public.estimate_projects where id=pg_temp.oc_id(201)),'Owner substituted for actor');
    perform pg_temp.oc_actor(null,'none');
    update public.estimate_projects set name='ARMY project changed later' where id=pg_temp.oc_id(201);
    update public.profiles set full_name='ARMY profile changed later' where id=pg_temp.oc_id(2);
    perform pg_temp.oc_actor(); replay:=pg_temp.oc_reserve();
    perform pg_temp.oc_assert(to_jsonb(replay)=to_jsonb(e),'Reservation replay reconstructed envelope/identity/capability');
    perform pg_temp.oc_assert((select count(*)=1 from public.portal_tokens where estimate_email_dispatch_id=e.id) and (select count(*)=1 from public.estimate_email_dispatch_events where dispatch_id=e.id and event_type='reserved'),'Replay duplicated token/event');
    perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(format('select public.reserve_estimate_email_dispatch(%L,%L,(select updated_at from public.estimate_versions where id=%L),%L,%L,%L,%L,NULL::text[],%L,%L,%L,%L,%L::jsonb)',e.version_id,e.tenant_id,e.version_id,e.created_by,e.request_id,repeat('2',64),e.recipient,'Changed human subject',e.body,e.from_address,'http://127.0.0.1:39901',pg_temp.oc_company()),array['23505']); return;
  end if;
  if name like 'token-%' or name like 'request-%' then
    e:=pg_temp.oc_reserve(); select * into t from public.portal_tokens where estimate_email_dispatch_id=e.id;
    if name='token-select-rls' then
      perform pg_temp.oc_actor(1,'authenticated'); perform pg_temp.oc_assert((select count(*)=1 from public.portal_tokens where id=t.id),'Owner SELECT RLS lost');
      perform pg_temp.oc_actor(3,'authenticated'); perform pg_temp.oc_assert((select count(*)=0 from public.portal_tokens where id=t.id),'Other tenant SELECT leaked'); return;
    end if;
    mutation:=substring(name from '^(?:token|request)-(.*)$');
    if mutation='relink-same-tenant' then replay:=pg_temp.oc_reserve(302,902); end if;
    if mutation='relink-other-tenant' then
      replay:=public.reserve_estimate_email_dispatch(pg_temp.oc_id(304),pg_temp.oc_id(102),
        (select updated_at from public.estimate_versions where id=pg_temp.oc_id(304)),pg_temp.oc_id(3),pg_temp.oc_id(902),
        repeat('1',64),'army-client-t2@example.invalid',NULL::text[],'ARMY OFFER T2','Human message',
        'army-from@example.invalid','http://127.0.0.1:39901',pg_temp.oc_company());
    end if;
    command:=case mutation
      when 'null-dispatch' then format('update public.portal_tokens set estimate_email_dispatch_id=NULL where id=%L',t.id)
      when 'downgrade' then format('update public.portal_tokens set capability_contract_version=1 where id=%L',t.id)
      when 'relink' then format('update public.portal_tokens set estimate_email_dispatch_id=%L where id=%L',pg_temp.oc_id(999),t.id)
      when 'relink-same-tenant' then format('update public.portal_tokens set estimate_email_dispatch_id=%L where id=%L',replay.id,t.id)
      when 'relink-other-tenant' then format('update public.portal_tokens set estimate_email_dispatch_id=%L where id=%L',replay.id,t.id)
      when 'tenant' then format('update public.portal_tokens set tenant_id=%L where id=%L',pg_temp.oc_id(102),t.id)
      when 'version' then format('update public.portal_tokens set version_id=%L where id=%L',pg_temp.oc_id(302),t.id)
      when 'token' then format('update public.portal_tokens set token=%L where id=%L',pg_temp.oc_id(998),t.id)
      when 'email' then format('update public.portal_tokens set email=%L where id=%L','other@example.invalid',t.id)
      when 'created-at' then format('update public.portal_tokens set created_at=created_at-interval ''1 day'' where id=%L',t.id)
      when 'expiration' then format('update public.portal_tokens set expires_at=expires_at+interval ''1 day'' where id=%L',t.id)
      when 'delete' then format('delete from public.portal_tokens where id=%L',t.id)
      when 'insert-null' then format('insert into public.portal_tokens(tenant_id,version_id,email,expires_at,estimate_email_dispatch_id,capability_contract_version) values(%L,%L,%L,clock_timestamp()+interval ''1 day'',NULL,2)',t.tenant_id,t.version_id,t.email)
      when 'spoof-legacy' then format('insert into public.portal_tokens(tenant_id,version_id,email,expires_at,created_at,estimate_email_dispatch_id,capability_contract_version) values(%L,%L,%L,clock_timestamp()+interval ''1 day'',''2000-01-01'',NULL,1)',t.tenant_id,t.version_id,t.email)
      when 'initial-null' then format('insert into public.estimate_emails(tenant_id,version_id,recipient,subject,body,type,status,request_id) values(%L,%L,%L,%L,%L,''initial'',''preparing'',NULL)',e.tenant_id,e.version_id,e.recipient,'ARMY OFFER','Human message')
      when 'identity' then format('update public.estimate_emails set offer_identity_snapshot=offer_identity_snapshot||''{"project":{"name":"Changed"}}''::jsonb where id=%L',e.id)
      when 'url' then format('update public.estimate_emails set portal_url=%L where id=%L','http://127.0.0.1:39901/other',e.id)
      when 'contract-downgrade' then format('update public.estimate_emails set request_contract_version=1 where id=%L',e.id)
      else null end;
    perform pg_temp.oc_assert(command is not null,'Unknown token/request mutation');
    perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['42501','23514']);
    if name like 'token-%' then
      perform set_config('oc.role','authenticated',true); perform pg_temp.oc_refuse(command,array['42501']);
      perform set_config('oc.role','anon',true); perform pg_temp.oc_refuse(command,array['42501']);
    end if;
    return;
  end if;
  if name like 'publication-%' then
    -- PRECODE revision03: bypass the independently broken reservation/token
    -- trigger so these specialist probes isolate document and JSON-null gates.
    -- A manual claim is real; no token/status/provider proof is preseeded.
    if name in('publication-ready-without-client-contract','publication-included-terms-json-null') then
      d:=public.begin_estimate_pdf_generation(pg_temp.oc_id(302),pg_temp.oc_id(101),pg_temp.oc_id(2),'manual',null);
      if name='publication-ready-without-client-contract' then
        command:=format('update public.estimate_documents set status=''ready'',file_path=%L,sha256_hash=%L,file_size_bytes=1234,generated_at=%L::timestamptz,generated_by=%L,layout_options=%L::jsonb,terms_snapshot=%L::jsonb,published_generation_token=%L,published_purpose=''manual'',published_dispatch_id=NULL,published_content_revision=generation_content_revision,generation_token=NULL,generation_purpose=NULL,generation_dispatch_id=NULL,generation_content_revision=NULL,generation_started_at=NULL,client_contract_version=NULL,client_contract_snapshot=NULL where id=%L',
          pg_temp.oc_id(101)||'/'||pg_temp.oc_id(201)||'/'||pg_temp.oc_id(302)||'/'||repeat('a',64)||'.pdf',repeat('a',64),
          '2026-10-13T12:00:00.123456Z',pg_temp.oc_id(2),pg_temp.oc_layout(),pg_temp.oc_terms(),d.generation_token,d.id);
        perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['23514','42501']);
      else
        command:=format('select public.publish_estimate_pdf_generation(%L,%L,%L,%L,%L,%L,1234,%L::timestamptz,%L::jsonb,''null''::jsonb,%L::jsonb)',
          pg_temp.oc_id(302),pg_temp.oc_id(101),pg_temp.oc_id(2),d.generation_token,
          pg_temp.oc_id(101)||'/'||pg_temp.oc_id(201)||'/'||pg_temp.oc_id(302)||'/'||repeat('a',64)||'.pdf',repeat('a',64),
          '2026-10-13T12:00:00.123456Z',pg_temp.oc_layout(),pg_temp.oc_snapshot(302));
        perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['22023','23514']);
      end if;
      return;
    end if;
    e:=pg_temp.oc_reserve();
    if name='publication-superseded' then
      d:=public.begin_estimate_pdf_generation(e.version_id,e.tenant_id,pg_temp.oc_id(2),'email',e.id);
      d2:=public.begin_estimate_pdf_generation(e.version_id,e.tenant_id,pg_temp.oc_id(2),'email',e.id);
      command:=format('select public.publish_estimate_pdf_generation(%L,%L,%L,%L,%L,%L,1234,%L::timestamptz,%L::jsonb,%L::jsonb,%L::jsonb)',e.version_id,e.tenant_id,pg_temp.oc_id(2),d.generation_token,pg_temp.oc_id(101)||'/'||pg_temp.oc_id(201)||'/'||e.version_id||'/'||repeat('a',64)||'.pdf',repeat('a',64),'2026-10-13T12:00:00.123456Z',pg_temp.oc_layout(),pg_temp.oc_terms(),pg_temp.oc_snapshot());
      perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['40001']); return;
    end if;
    d:=pg_temp.oc_publish(301,'email',e.id); snapshot:=d.client_contract_snapshot;
    if name='publication-exact-replay' then
      d2:=public.publish_estimate_pdf_generation(e.version_id,e.tenant_id,pg_temp.oc_id(2),d.published_generation_token,d.file_path,d.sha256_hash,d.file_size_bytes,d.generated_at,d.layout_options,d.terms_snapshot,snapshot);
      perform pg_temp.oc_assert(to_jsonb(d2)=to_jsonb(d),'Publication exact replay changed complete document'); return;
    end if;
    mutation:=substring(name from '^publication-(.*)$');
    case mutation
      when 'project' then snapshot:=jsonb_set(snapshot,'{project,name}','"ARMY changed project"');
      when 'issuer' then snapshot:=jsonb_set(snapshot,'{issuer,displayName}','"ARMY changed issuer"');
      when 'company' then snapshot:=jsonb_set(snapshot,'{company,name}','"ARMY changed company"');
      when 'layout' then d.layout_options:=jsonb_set(d.layout_options,'{density}','"compact"');
      when 'terms' then d.terms_snapshot:=jsonb_set(d.terms_snapshot,'{body}','"Changed synthetic clause"');
      when 'timestamp' then d.generated_at:=d.generated_at+interval '0.000001 seconds';
      when 'size' then d.file_size_bytes:=d.file_size_bytes+1;
      when 'actor' then d.generated_by:=pg_temp.oc_id(1);
      else raise exception 'Unknown publication replay mutation';
    end case;
    command:=format('select public.publish_estimate_pdf_generation(%L,%L,%L,%L,%L,%L,%s,%L::timestamptz,%L::jsonb,%L::jsonb,%L::jsonb)',e.version_id,e.tenant_id,d.generated_by,d.published_generation_token,d.file_path,d.sha256_hash,d.file_size_bytes,d.generated_at,d.layout_options,d.terms_snapshot,snapshot);
    perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['40001','22023','23514']); return;
  end if;
  if name like 'snapshot-%' then
    e:=pg_temp.oc_reserve(); d:=public.begin_estimate_pdf_generation(e.version_id,e.tenant_id,pg_temp.oc_id(2),'email',e.id);
    snapshot:=pg_temp.oc_snapshot(); mutation:=substring(name from '^snapshot-(.*)$');
    case mutation
      when 'null' then snapshot:=null;
      when 'schema' then snapshot:=jsonb_set(snapshot,'{schemaVersion}','2');
      when 'private-cost' then snapshot:=snapshot||'{"costSubtotalCents":100}'::jsonb;
      when 'fractional-cents' then snapshot:=jsonb_set(snapshot,'{rows,0,saleHtCents}','10000.5');
      when 'foreign-tenant' then snapshot:=jsonb_set(snapshot,'{version,tenantId}',to_jsonb(pg_temp.oc_id(102)));
      when 'stale-revision' then snapshot:=jsonb_set(snapshot,'{version,contentRevision}','1');
      when 'duplicate-row' then snapshot:=jsonb_set(snapshot,'{rows}',(snapshot->'rows')||(snapshot->'rows'));
      when 'cycle' then snapshot:=jsonb_set(snapshot,'{rows,0,parentId}',snapshot->'rows'->0->'id');
      when 'footer' then snapshot:=jsonb_set(snapshot,'{totals,calculatedTtcCents}','12001');
      else raise exception 'Unknown snapshot mutation';
    end case;
    command:=format('select public.publish_estimate_pdf_generation(%L,%L,%L,%L,%L,%L,1234,%L::timestamptz,%L::jsonb,%L::jsonb,%L::jsonb)',e.version_id,e.tenant_id,pg_temp.oc_id(2),d.generation_token,pg_temp.oc_id(101)||'/'||pg_temp.oc_id(201)||'/'||e.version_id||'/'||repeat('a',64)||'.pdf',repeat('a',64),'2026-10-13T12:00:00.123456Z',pg_temp.oc_layout(),pg_temp.oc_terms(),snapshot);
    perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['22023','23514']); return;
  end if;
  if name like 'manual-%' then
    if name<>'manual-missing-document' then d:=pg_temp.oc_publish(302,'manual',null); proof:=pg_temp.oc_proof(302); end if;
    if name='manual-success' then
      perform public.transition_estimate_version_status(pg_temp.oc_id(302),pg_temp.oc_id(101),(select updated_at from public.estimate_versions where id=pg_temp.oc_id(302)),'sent',repeat('b',64),pg_temp.oc_id(2),'{}',clock_timestamp(),5::smallint,proof);
      perform pg_temp.oc_assert((select status='sent' and seal_payload_version=5 and seal_hash=repeat('b',64) from public.estimate_versions where id=pg_temp.oc_id(302)),'Manual proof/marker not sealed');
      perform pg_temp.oc_assert(not exists(select 1 from public.estimate_emails where version_id=pg_temp.oc_id(302)) and not exists(select 1 from public.portal_tokens where version_id=pg_temp.oc_id(302)),'Manual workflow produced outbox/capability'); return;
    end if;
    if name='manual-unequal-proof' then proof:=jsonb_set(proof,'{clientContractSnapshot,project,name}','"ARMY altered"'); end if;
    if name='manual-actor-revoked' then
      perform pg_temp.oc_actor(null,'none'); delete from public.tenant_memberships where tenant_id=pg_temp.oc_id(101) and user_id=pg_temp.oc_id(2);
    end if;
    command:=format('select public.transition_estimate_version_status(%L,%L,(select updated_at from public.estimate_versions where id=%L),''sent'',%L,%L,''{}''::jsonb,clock_timestamp(),%s::smallint,%L::jsonb)',pg_temp.oc_id(302),pg_temp.oc_id(101),pg_temp.oc_id(302),repeat('b',64),pg_temp.oc_id(2),case when name='manual-legacy-payload' then 4 else 5 end,proof);
    perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,
      case when name='manual-actor-revoked' then array['42501'] else array['22023','23514','40001'] end); return;
  end if;
  -- All cases below begin with an actual reserved/published/prepared/claimed/
  -- completed SQL baseline. It is still NOT a real provider send or PDF seal.
  e:=pg_temp.oc_send(); select * into t from public.portal_tokens where estimate_email_dispatch_id=e.id;
  if name='resend-original-issuer' then
    replay:=public.reserve_estimate_email_dispatch(e.version_id,e.tenant_id,
      (select updated_at from public.estimate_versions where id=e.version_id),pg_temp.oc_id(1),pg_temp.oc_id(902),
      repeat('1',64),e.recipient,e.cc,e.subject,e.body,e.from_address,'http://127.0.0.1:39901',pg_temp.oc_company());
    snapshot:=(pg_temp.oc_proof())->'clientContractSnapshot';
    perform pg_temp.oc_assert(replay.created_by=pg_temp.oc_id(1) and replay.created_by<>(snapshot->'issuer'->>'userId')::uuid,
      'Resend actor must differ from original document issuer');
    perform pg_temp.oc_assert(replay.offer_identity_snapshot=jsonb_build_object('schemaVersion',1,
      'version',jsonb_build_object('id',e.version_id,'tenantId',e.tenant_id,'projectId',pg_temp.oc_id(201),'contentRevision',e.version_content_revision),
      'issuer',snapshot->'issuer','company',snapshot->'company','project',snapshot->'project'),
      'Resend reconstructed original identity using new actor/project/company');
    perform pg_temp.oc_assert((select count(*)=1 from public.portal_tokens where estimate_email_dispatch_id=replay.id),'Resend lacks its own capability');
    return;
  end if;
  if name like 'document-%' then
    mutation:=substring(name from '^document-(.*)$');
    command:=case mutation
      when 'marker-null' then 'update public.estimate_documents set client_contract_version=NULL where version_id=pg_temp.oc_id(301)'
      when 'marker-change' then 'update public.estimate_documents set client_contract_version=2 where version_id=pg_temp.oc_id(301)'
      when 'snapshot-null' then 'update public.estimate_documents set client_contract_snapshot=NULL where version_id=pg_temp.oc_id(301)'
      when 'snapshot-edit' then 'update public.estimate_documents set client_contract_snapshot=jsonb_set(client_contract_snapshot,''{project,name}'',''"Altered"'') where version_id=pg_temp.oc_id(301)'
      when 'layout' then 'update public.estimate_documents set layout_options=jsonb_set(layout_options,''{density}'',''"compact"'') where version_id=pg_temp.oc_id(301)'
      when 'terms' then 'update public.estimate_documents set terms_snapshot=NULL where version_id=pg_temp.oc_id(301)'
      when 'hash' then 'update public.estimate_documents set sha256_hash=repeat(''d'',64) where version_id=pg_temp.oc_id(301)'
      when 'path' then 'update public.estimate_documents set file_path=''other.pdf'' where version_id=pg_temp.oc_id(301)'
      when 'revision' then 'update public.estimate_documents set published_content_revision=published_content_revision+1 where version_id=pg_temp.oc_id(301)'
      when 'claim' then 'update public.estimate_documents set published_generation_token=pg_temp.oc_id(999) where version_id=pg_temp.oc_id(301)'
      when 'tenant' then 'update public.estimate_documents set tenant_id=pg_temp.oc_id(102) where version_id=pg_temp.oc_id(301)'
      when 'parent' then 'update public.estimate_documents set version_id=pg_temp.oc_id(302) where version_id=pg_temp.oc_id(301)'
      when 'issuer' then 'update public.estimate_documents set generated_by=pg_temp.oc_id(1) where version_id=pg_temp.oc_id(301)'
      when 'generated-at' then 'update public.estimate_documents set generated_at=generated_at+interval ''1 second'' where version_id=pg_temp.oc_id(301)'
      when 'size' then 'update public.estimate_documents set file_size_bytes=file_size_bytes+1 where version_id=pg_temp.oc_id(301)'
      when 'delete' then 'delete from public.estimate_documents where version_id=pg_temp.oc_id(301)'
      else null end;
    perform pg_temp.oc_assert(command is not null,'Unknown document mutation'); perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['42501','23514']); return;
  end if;
  if name like 'provider-%' then
    mutation:=substring(name from '^provider-(.*)$');
    if mutation='complete-replay' then
      replay:=public.complete_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.oc_id(2),pg_temp.oc_id(702),e.provider_id,e.sent_at+interval '1 hour');
      perform pg_temp.oc_assert(to_jsonb(replay)=to_jsonb(e),'Completion replay replaced sent_at/provider proof'); return;
    end if;
    command:=case mutation
      when 'sent-at' then format('update public.estimate_emails set sent_at=sent_at+interval ''1 hour'' where id=%L',e.id)
      when 'sent-at-null' then format('update public.estimate_emails set sent_at=NULL where id=%L',e.id)
      when 'id' then format('update public.estimate_emails set provider_id=%L where id=%L','ARMY-OTHER-PROVIDER',e.id)
      when 'regression' then format('update public.estimate_emails set status=''unknown'' where id=%L',e.id)
      else null end;
    perform pg_temp.oc_assert(command is not null,'Unknown provider mutation'); perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['42501','23514']); return;
  end if;
  if name like 'prepare-%' then
    proof:=pg_temp.oc_proof(); mutation:=substring(name from '^prepare-(.*)$');
    if mutation='exact-replay' then
      replay:=public.prepare_estimate_email_dispatch(e.id,e.tenant_id,pg_temp.oc_id(2),repeat('b',64),e.provider_payload_hash,
        e.html_body,e.text_body,e.document_path,e.document_sha256,e.attachment_filename,proof,5::smallint);
      perform pg_temp.oc_assert(to_jsonb(replay)=to_jsonb(e),'Prepare exact replay changed frozen provider envelope'); return;
    end if;
    case mutation
      when 'html' then e.html_body:='<p>Changed synthetic HTML, same hash</p>';
      when 'text' then e.text_body:='Changed synthetic text, same hash';
      when 'filename' then e.attachment_filename:='Changed.pdf';
      when 'proof' then proof:=jsonb_set(proof,'{clientContractSnapshot,company,name}','"Altered"');
      else raise exception 'Unknown prepare mutation';
    end case;
    command:=format('select public.prepare_estimate_email_dispatch(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,5::smallint)',e.id,e.tenant_id,pg_temp.oc_id(2),repeat('b',64),e.provider_payload_hash,e.html_body,e.text_body,e.document_path,e.document_sha256,e.attachment_filename,proof);
    perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,array['22023','23514','40001']); return;
  end if;
  if name like 'decision-%' then
    decision:=case when name like '%-accepted' then 'accepted' else 'rejected' end;
    mutation:=substring(name from '^decision-(.*)-(?:accepted|rejected)$');
    if mutation in('preparing','queued','processing','unknown','failed') then
      replay:=pg_temp.oc_reserve(301,902);
      if mutation<>'preparing' then replay:=pg_temp.oc_prepare(replay.id); end if;
      if mutation in('processing','unknown') then replay:=public.claim_estimate_email_dispatch(replay.id,replay.tenant_id,pg_temp.oc_id(2),pg_temp.oc_id(703),120); end if;
      if mutation='unknown' then update public.estimate_emails set status='unknown',lease_token=NULL,lease_expires_at=NULL where id=replay.id; end if;
      if mutation='failed' then update public.estimate_emails set status='failed' where id=replay.id; end if;
      select * into t from public.portal_tokens where estimate_email_dispatch_id=replay.id;
      perform pg_temp.oc_assert((select status='sent' from public.estimate_versions where id=e.version_id),'Resend parent not sent');
      perform pg_temp.oc_assert((select status=mutation and provider_id is null and sent_at is null from public.estimate_emails where id=replay.id),'Wrong nonterminal dispatch fixture');
      perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(format('select pg_temp.oc_decide(%L,%L)',t.id,decision),array['P0001','42501','23514','40001']); return;
    end if;
    if mutation in('sent','delivered','bounced') then
      if mutation<>'sent' then update public.estimate_emails set status=mutation where id=e.id; end if;
      perform pg_temp.oc_assert((select provider_id=e.provider_id and sent_at=e.sent_at from public.estimate_emails where id=e.id),'Webhook changed provider proof');
      perform pg_temp.oc_decide(t.id,decision);
      perform pg_temp.oc_assert((select status=decision from public.portal_tokens where id=t.id),'Positive own-dispatch decision not stored');
      perform pg_temp.oc_assert((select status::text=case when decision='accepted' then 'accepted' else 'archived' end from public.estimate_versions where id=e.version_id),'Positive parent status differs');
      perform pg_temp.oc_assert((select count(*)=1 from public.estimate_version_events where estimate_version_id=e.version_id and event_type=decision),'Positive decision event differs'); return;
    end if;
    if mutation in('before-event','after-audit') then
      replay:=pg_temp.oc_reserve(301,902); select * into sibling from public.portal_tokens where estimate_email_dispatch_id=replay.id;
      perform pg_temp.oc_assert(sibling.id is not null and sibling.status='pending','Missing real sibling capability');
      mode:=case when mutation='before-event' then 'decision-before-event' else 'decision-after-audit' end;
      perform pg_temp.oc_actor(null,'none'); select case when is_called then last_value else 0 end into hit_before from pg_temp.oc_fault_hits;
      perform set_config('oc.failpoint',mode,true); perform pg_temp.oc_refuse(format('select pg_temp.oc_decide(%L,%L)',t.id,decision),array['P9001']);
      select last_value into hit_after from pg_temp.oc_fault_hits; perform pg_temp.oc_assert(hit_after=hit_before+1,'Exact decision failpoint was not hit'); return;
    end if;
    if mutation='unequal-proof' then
      proof:=jsonb_set(pg_temp.oc_proof(),'{clientContractSnapshot,project,name}','"Altered"');
      perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(format('select pg_temp.oc_decide(%L,%L,%L::jsonb)',t.id,decision,proof),array['22023','23514','40001']); return;
    end if;
    if mutation in('missing-proof','wrong-seal','inactive-tenant') then
      proof:=pg_temp.oc_proof();
      if mutation='inactive-tenant' then
        perform pg_temp.oc_actor(null,'none'); update public.tenants set is_active=false where id=e.tenant_id;
      end if;
      command:=format('select public.claim_portal_estimate_decision(%L,%L,''127.0.0.1''::inet,NULL,%L,%L::jsonb)',t.id,decision,
        case when mutation='wrong-seal' then repeat('d',64) else repeat('b',64) end,
        case when mutation='missing-proof' then null else proof end);
      perform pg_temp.oc_actor(null,'none'); perform pg_temp.oc_refuse(command,
        case when mutation='inactive-tenant' then array['P0001','42501'] else array['22023','23514','40001'] end); return;
    end if;
  end if;
  raise exception 'Unknown offer contract case';
end $f$;

do $offer_contract_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure_state text; failures integer;
begin
  perform pg_temp.oc_assert(not exists(select 1 from public.profiles where id in(pg_temp.oc_id(1),pg_temp.oc_id(2),pg_temp.oc_id(3)) and role='admin'),'Synthetic actors are global admins');
  foreach case_name in array array[
    'catalog-all-overloads','reserve-actor-membership-deleted','reserve-actor-viewer','reserve-actor-inactive-tenant','reserve-actor-other-tenant',
    'reserve-rollback','reserve-replay-identity','resend-original-issuer',
    'token-select-rls','token-null-dispatch','token-downgrade','token-relink','token-relink-same-tenant','token-relink-other-tenant','token-tenant','token-version','token-token','token-email','token-created-at','token-expiration','token-delete','token-insert-null','token-spoof-legacy',
    'request-initial-null','request-identity','request-url','request-contract-downgrade',
    'publication-superseded','publication-exact-replay','publication-project','publication-issuer','publication-company','publication-layout','publication-terms','publication-timestamp','publication-size','publication-actor',
    'publication-ready-without-client-contract','publication-included-terms-json-null',
    'snapshot-null','snapshot-schema','snapshot-private-cost','snapshot-fractional-cents','snapshot-foreign-tenant','snapshot-stale-revision','snapshot-duplicate-row','snapshot-cycle','snapshot-footer',
    'manual-success','manual-missing-document','manual-unequal-proof','manual-legacy-payload','manual-actor-revoked',
    'document-marker-null','document-marker-change','document-snapshot-null','document-snapshot-edit','document-layout','document-terms','document-hash','document-path','document-revision','document-claim','document-tenant','document-parent','document-issuer','document-generated-at','document-size','document-delete',
    'provider-complete-replay','provider-sent-at','provider-sent-at-null','provider-id','provider-regression',
    'prepare-exact-replay','prepare-html','prepare-text','prepare-filename','prepare-proof',
    'decision-preparing-accepted','decision-preparing-rejected','decision-queued-accepted','decision-queued-rejected',
    'decision-processing-accepted','decision-processing-rejected','decision-unknown-accepted','decision-unknown-rejected','decision-failed-accepted','decision-failed-rejected',
    'decision-sent-accepted','decision-sent-rejected','decision-delivered-accepted','decision-delivered-rejected','decision-bounced-accepted','decision-bounced-rejected',
    'decision-before-event-accepted','decision-before-event-rejected','decision-after-audit-accepted','decision-after-audit-rejected','decision-unequal-proof-accepted','decision-unequal-proof-rejected',
    'decision-missing-proof-accepted','decision-missing-proof-rejected','decision-wrong-seal-accepted','decision-wrong-seal-rejected','decision-inactive-tenant-accepted','decision-inactive-tenant-rejected'
  ] loop
    passed:=false; failure_state:=null;
    begin
      perform pg_temp.oc_case(case_name);
      raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true;
      when others then failure_state:=sqlstate;
    end;
    perform pg_temp.oc_actor(null,'none');
    -- Do not serialize message_text: integrity errors may embed dynamic SQL,
    -- tokens or full snapshots. Runner keeps private diagnostics separately.
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'errorSqlstate',failure_state));
  end loop;
  select count(*) into failures from jsonb_array_elements(results)x where not(x->>'passed')::boolean;
  raise exception using errcode='P9001',message='ESTIMATE_OFFER_CONTRACT_PROOF:'||jsonb_build_object(
    'allPassed',failures=0,'fixturePrefix','efca0700','caseCount',jsonb_array_length(results),'failedCount',failures,
    'financialEngine',1,'concurrencyExecuted',false,'transportExecuted',false,'pdfBytesVerified',false,
    'sealHashVerified',false,'genuineLegacyOfferVerified',false,'cases',results)::text;
end;
$offer_contract_probe$;
-- P9001 above is mandatory. Never COMMIT this fixture.
rollback;
