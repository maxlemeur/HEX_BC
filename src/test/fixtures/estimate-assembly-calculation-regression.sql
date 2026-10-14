-- Written BEFORE the new financial finalizer. Real RLS/writer, sequential
-- boundary probes and a late transaction fault; not actual races or transport.
-- Run only in a surrounding local transaction; P9001 forces full rollback.
do $assembly_calculation_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure text;
begin
  if exists(select 1 from auth.users where id::text like 'afca0700-%') then raise exception 'Assembly calculation fixture prefix exists'; end if;
  execute $helpers$
  create function pg_temp.af_id(n integer) returns uuid language sql immutable as $f$
    select ('afca0700-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  $f$;
  create function pg_temp.af_assert(ok boolean,detail text) returns void language plpgsql as $f$
  begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
  create function pg_temp.af_actor(n integer default 1,db_role text default 'authenticated') returns void language plpgsql as $f$
  begin
    perform set_config('role','none',true);
    perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.af_id(n)::text end,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.af_id(n) end,'role',db_role)::text,true);
    perform set_config('role',db_role,true);
  end $f$;
  $helpers$;
  insert into auth.users(id,email,raw_user_meta_data)
    select pg_temp.af_id(n),'assembly-calculation-'||n||'@example.invalid',jsonb_build_object('full_name','Assembly calculation actor '||n) from generate_series(1,5)n;
  update public.tenant_memberships set is_default=false where user_id::text like 'afca0700-%';
  insert into public.tenants(id,name,slug) values(pg_temp.af_id(101),'ARMY assembly calculation T1','assembly-calculation-native-t1'),(pg_temp.af_id(102),'ARMY assembly calculation T2','assembly-calculation-native-t2');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    select pg_temp.af_id(101),pg_temp.af_id(n),(case n when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(1,5)n;
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values(pg_temp.af_id(102),pg_temp.af_id(1),'engineer',false,'2021-01-01');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(pg_temp.af_id(201),pg_temp.af_id(101),pg_temp.af_id(1),'ARMY assembly calculation'),(pg_temp.af_id(202),pg_temp.af_id(102),pg_temp.af_id(1),'ARMY assembly calculation other tenant');
  insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,max_section_depth,margin_mode,margin_multiplier,tax_rate_bp,total_ht_cents,total_tax_cents,total_ttc_cents)
    values(pg_temp.af_id(301),pg_temp.af_id(201),1,'draft',2,4,'fixed',1,2000,2000,400,2400),(pg_temp.af_id(302),pg_temp.af_id(201),2,'draft',1,4,'fixed',1,2000,2000,400,2400),(pg_temp.af_id(303),pg_temp.af_id(202),1,'draft',2,4,'fixed',1,2000,0,0,0);
  insert into public.estimate_items(id,version_id,item_type,position,title) values(pg_temp.af_id(401),pg_temp.af_id(301),'section',1,'Library section'),(pg_temp.af_id(402),pg_temp.af_id(302),'section',1,'Legacy library section');
  insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_provider,source_metadata)
    select pg_temp.af_id(n),pg_temp.af_id(case when n in(501,511) then 301 else 302 end),pg_temp.af_id(case when n in(501,511) then 401 else 402 end),'line',case when n<510 then 1 else 2 end,case when n<510 then 'Existing' else 'Inserted' end,'u',1,case when n<510 then 2000 else 1250 end,2000,1,0,1,case when n<510 then 2000 else 0 end,case when n<510 then 2000 else 0 end,case when n<510 then 400 else 0 end,case when n<510 then 2400 else 0 end,case when n<510 then 'manual' else 'assembly_library' end,case when n<510 then '{}'::jsonb else '{"kind":"assembly_library","library_origin":{"source_metadata":{"sources":[{"note":"Original exact"}],"legacy":null}}}'::jsonb end from unnest(array[501,502,511,512])n;
  insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values(pg_temp.af_id(601),pg_temp.af_id(101),pg_temp.af_id(1),'Pose',4000),(pg_temp.af_id(602),pg_temp.af_id(101),pg_temp.af_id(5),'Foreign owner',5000);
  insert into public.draft_locks(version_id,user_id,session_id,expires_at) select pg_temp.af_id(n),pg_temp.af_id(1),pg_temp.af_id(701),clock_timestamp()+interval '1 hour' from generate_series(301,303)n;
  delete from public.feature_flags where tenant_id=pg_temp.af_id(101) and flag_key='EST_031_LABOR_SPLIT';
  delete from public.margin_tiers where tenant_id=pg_temp.af_id(101);
  execute $helpers$
  create function pg_temp.af_state() returns jsonb language plpgsql security definer set search_path='' as $f$
  declare t record; rows_value jsonb; result jsonb:='{}';
  begin
    for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private') order by n.nspname,c.relname loop
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%afca0700-%%''',t.nspname,t.relname) into rows_value;
      if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
    end loop; return result;
  end $f$;
  create function pg_temp.af_updates(v integer default 301,discount boolean default false) returns jsonb language sql as $f$
    select jsonb_agg(jsonb_build_object('id',id,'pu_ht_cents',case when discount then unit_price_ht_cents*9/10 else unit_price_ht_cents end,'line_total_ht_cents',case when discount then unit_price_ht_cents*9/10 else unit_price_ht_cents end,'line_tax_cents',case when discount then unit_price_ht_cents*9/50 else unit_price_ht_cents/5 end,'line_total_ttc_cents',case when discount then unit_price_ht_cents*27/25 else unit_price_ht_cents*6/5 end) order by id) from public.estimate_items where version_id=pg_temp.af_id(v) and item_type='line'
  $f$;
  create function pg_temp.af_context(v integer default 301) returns jsonb language sql as $f$
    select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tenant_id',r.tenant_id,'user_id',r.user_id,'hourly_rate_cents',r.hourly_rate_cents) order by r.id) from public.labor_roles r where r.tenant_id=pg_temp.af_id(101) and r.user_id=pg_temp.af_id(1) and r.id in(select labor_role_id from public.estimate_items where version_id=pg_temp.af_id(v) and item_type='line' union select labor_role_atelier_id from public.estimate_items where version_id=pg_temp.af_id(v) and item_type='line' union select labor_role_chantier_id from public.estimate_items where version_id=pg_temp.af_id(v) and item_type='line')),'[]'),
      'margin_tiers',case when(select margin_mode from public.estimate_versions where id=pg_temp.af_id(v))='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'threshold_cents',threshold_cents,'multiplier',multiplier,'position',position) order by threshold_cents,position,id) from public.margin_tiers where tenant_id=pg_temp.af_id(101)),'[]') else '[]'::jsonb end,
      'labor_split_flag',(select jsonb_build_object('id',id,'enabled',enabled) from public.feature_flags where tenant_id=pg_temp.af_id(101) and flag_key='EST_031_LABOR_SPLIT'))
  $f$;
  create function pg_temp.af_call(updates jsonb default null,patch jsonb default null,ctx jsonb default null,token timestamptz default null,revision bigint default null,session uuid default null,ids uuid[] default null,v integer default 301) returns jsonb language plpgsql as $f$
  begin
    return public.finalize_estimate_assembly_calculation(pg_temp.af_id(v),coalesce(token,(select updated_at from public.estimate_versions where id=pg_temp.af_id(v)),nullif(current_setting('af.token.v'||v,true),'')::timestamptz),coalesce(revision,(select content_revision from public.estimate_versions where id=pg_temp.af_id(v)),nullif(current_setting('af.revision.v'||v,true),'')::bigint),coalesce(session,pg_temp.af_id(701)),coalesce(ids,array[pg_temp.af_id(v+100),pg_temp.af_id(v+210)]),coalesce(updates,pg_temp.af_updates(v),nullif(current_setting('af.updates.v'||v,true),'')::jsonb),coalesce(patch,'{"total_ht_cents":3250,"total_tax_cents":650,"total_ttc_cents":3900}'),coalesce(ctx,pg_temp.af_context(v)));
  end $f$;
  create function pg_temp.af_refusal(command text,expected_message text,expected_state text) returns void language plpgsql as $f$
  declare before_state jsonb; actual_state text; actual_message text; result jsonb;
  begin
    perform pg_temp.af_actor(null,'none');
    perform set_config('af.token.v'||n,(select updated_at::text from public.estimate_versions where id=pg_temp.af_id(n)),true) from generate_series(301,303)n;
    perform set_config('af.revision.v'||n,(select content_revision::text from public.estimate_versions where id=pg_temp.af_id(n)),true) from generate_series(301,303)n;
    -- Keep the previously authorized projection for denial probes. A SELECT
    -- after access revocation is hidden by RLS and would only test null input.
    perform set_config('af.updates.v'||n,coalesce(pg_temp.af_updates(n),'[]')::text,true) from generate_series(301,303)n;
    before_state:=pg_temp.af_state();
    perform pg_temp.af_actor(coalesce(nullif(current_setting('af.actor',true),'')::integer,1),coalesce(nullif(current_setting('af.role',true),''),'authenticated'));
    begin execute command into result; exception when others then get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text; end;
    perform pg_temp.af_actor(null,'none');
    perform pg_temp.af_assert(actual_state=expected_state and actual_message=expected_message,format('Expected %s/%s; actual %s/%s',expected_state,expected_message,actual_state,actual_message));
    perform pg_temp.af_assert(before_state=pg_temp.af_state(),'Refusal changed rows, tokens, provenance or prior materialization');
  end $f$;
  create temporary sequence af_fault_hits;
  create function pg_temp.af_fault() returns trigger language plpgsql security definer set search_path='' as $f$
  begin
    if coalesce(current_setting('af.fault',true),'')='enabled' and new.id=pg_temp.af_id(301) and new.total_ht_cents<>old.total_ht_cents then
      perform pg_temp.af_assert((select line_total_ht_cents=1250 from public.estimate_items where id=pg_temp.af_id(511)),'Fault was not after line projection');
      perform nextval('pg_temp.af_fault_hits'); raise exception using errcode='23514',message='ASSEMBLY_CALCULATION_LATE_FAULT';
    end if; return new;
  end $f$;
  create trigger assembly_calculation_probe_fault before update of total_ht_cents on public.estimate_versions for each row execute function pg_temp.af_fault();
  create function pg_temp.af_case(name text) returns void language plpgsql as $f$
  declare r jsonb; u jsonb; c jsonb; saved jsonb; v integer:=301; token timestamptz; revision bigint;
  begin
    perform set_config('af.actor','1',true); perform set_config('af.role','authenticated',true); perform set_config('af.fault','',true);
    if name in('fixed-nonempty','v2-discount','v1-gross','ordered-items','admin','section-empty-lines','context-normalized-role') then
      if name='v1-gross' then v:=302; update public.estimate_versions set discount_bp=1000 where id=pg_temp.af_id(v); end if;
      if name='v2-discount' then update public.estimate_versions set discount_bp=1000 where id=pg_temp.af_id(v); end if;
      if name='admin' then delete from public.draft_locks where version_id=pg_temp.af_id(v); insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.af_id(v),pg_temp.af_id(2),pg_temp.af_id(701),clock_timestamp()+interval '1 hour'); end if;
      if name='section-empty-lines' then delete from public.estimate_items where version_id=pg_temp.af_id(v) and item_type='line'; end if;
      if name='context-normalized-role' then
        perform pg_temp.af_actor(); insert into public.labor_roles(id,user_id,name,hourly_rate_cents) values(pg_temp.af_id(603),pg_temp.af_id(1),'Normalized tenant',2500);
        update public.estimate_items set labor_role_id=pg_temp.af_id(603) where id=pg_temp.af_id(501); perform pg_temp.af_actor(null,'none');
      end if;
      select coalesce(jsonb_agg(to_jsonb(i)-array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','updated_at'] order by id),'[]') into saved from public.estimate_items i where version_id=pg_temp.af_id(v);
      perform pg_temp.af_actor(case when name='admin' then 2 else 1 end);
      r:=pg_temp.af_call(v=>v,updates=>case when name='section-empty-lines' then '[]'::jsonb else pg_temp.af_updates(v,name='v2-discount') end,patch=>case when name='section-empty-lines' then '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb when name in('v2-discount','v1-gross') then '{"total_ht_cents":2925,"total_tax_cents":585,"total_ttc_cents":3510}'::jsonb else null end,ids=>case when name='ordered-items' then array[pg_temp.af_id(511),pg_temp.af_id(401)] when name='section-empty-lines' then array[pg_temp.af_id(401)] else null end);
      perform pg_temp.af_assert(r->'version'->>'id'=pg_temp.af_id(v)::text and (r->'version'->>'updated_at')::timestamptz=(select updated_at from public.estimate_versions where id=pg_temp.af_id(v)),'Returned version identity/token differs');
      perform pg_temp.af_assert(r->'totals'=(select jsonb_build_object('total_ht_cents',total_ht_cents,'total_tax_cents',total_tax_cents,'total_ttc_cents',total_ttc_cents) from public.estimate_versions where id=pg_temp.af_id(v)),'Returned totals differ from persisted footer');
      perform pg_temp.af_assert(saved=(select coalesce(jsonb_agg(to_jsonb(i)-array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','updated_at'] order by id),'[]') from public.estimate_items i where version_id=pg_temp.af_id(v)),'Financial finalization changed business/provenance fields');
      perform pg_temp.af_assert((select calc_snapshot_context is null and calc_snapshot_content_revision is null from public.estimate_versions where id=pg_temp.af_id(v)),'Finalization published a snapshot');
      if name='ordered-items' then perform pg_temp.af_assert(r->'items'->0->>'id'=pg_temp.af_id(511)::text and r->'items'->1->>'id'=pg_temp.af_id(401)::text,'Inserted order changed'); end if;
      if name='v1-gross' then perform pg_temp.af_assert((select line_total_ht_cents=2000 from public.estimate_items where id=pg_temp.af_id(502)) and (select line_total_ht_cents=1250 from public.estimate_items where id=pg_temp.af_id(512)),'V1 gross semantics changed'); end if;
      if name='v2-discount' then perform pg_temp.af_assert((select line_total_ht_cents=1800 from public.estimate_items where id=pg_temp.af_id(501)) and (select line_total_ht_cents=1125 from public.estimate_items where id=pg_temp.af_id(511)),'Previous V2 allocation not updated'); end if;
      return;
    end if;
    case name
    when 'acl' then
      perform pg_temp.af_assert(has_function_privilege('authenticated','public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb)','EXECUTE'),'Authenticated grant missing');
      perform pg_temp.af_assert(not has_function_privilege('anon','public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb)','EXECUTE'),'Privileged/anonymous grant broadened');
      perform pg_temp.af_assert(not(select prosecdef from pg_proc where oid='public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb)'::regprocedure),'RPC is definer');
    when 'viewer' then perform set_config('af.actor','4',true); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'director' then perform set_config('af.actor','3',true); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'other-owner' then perform set_config('af.actor','5',true); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'inactive-tenant' then perform pg_temp.af_refusal('select pg_temp.af_call(v=>303)','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'membership-revoked' then update public.tenant_memberships set role='viewer' where tenant_id=pg_temp.af_id(101) and user_id=pg_temp.af_id(1); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'membership-deleted' then delete from public.tenant_memberships where tenant_id=pg_temp.af_id(101) and user_id=pg_temp.af_id(1); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'tenant-disabled' then update public.tenants set is_active=false where id=pg_temp.af_id(101); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'tenant-priority-changed' then update public.tenant_memberships set is_default=false where user_id=pg_temp.af_id(1); update public.tenant_memberships set is_default=true where user_id=pg_temp.af_id(1) and tenant_id=pg_temp.af_id(102); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'project-archived' then update public.estimate_projects set is_archived=true where id=pg_temp.af_id(201); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'nondraft' then perform pg_temp.af_actor(null,'service_role'); update public.estimate_versions set status='sent',seal_hash=repeat('a',64) where id=pg_temp.af_id(302); perform pg_temp.af_refusal('select pg_temp.af_call(v=>302)','ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN','42501');
    when 'other-session' then perform pg_temp.af_refusal(format('select pg_temp.af_call(session=>%L)',pg_temp.af_id(702)),'ESTIMATE_ASSEMBLY_CALCULATION_LOCK_REQUIRED','55000');
    when 'expired-session' then update public.draft_locks set expires_at=clock_timestamp()-interval '1 second' where version_id=pg_temp.af_id(301); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_LOCK_REQUIRED','55000');
    when 'lease-lost' then delete from public.draft_locks where version_id=pg_temp.af_id(301); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_LOCK_REQUIRED','55000');
    when 'lease-takeover' then delete from public.draft_locks where version_id=pg_temp.af_id(301); insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.af_id(301),pg_temp.af_id(2),pg_temp.af_id(702),clock_timestamp()+interval '1 hour'); perform pg_temp.af_refusal('select pg_temp.af_call()','ESTIMATE_ASSEMBLY_CALCULATION_LOCK_REQUIRED','55000');
    when 'stale-token' then perform pg_temp.af_refusal('select pg_temp.af_call(token=>''2000-01-01''::timestamptz)','ESTIMATE_ASSEMBLY_CALCULATION_STALE','40001');
    when 'stale-revision' then perform pg_temp.af_refusal('select pg_temp.af_call(revision=>0)','ESTIMATE_ASSEMBLY_CALCULATION_STALE','40001');
    when 'concurrent-item' then
      select updated_at,content_revision into token,revision from public.estimate_versions where id=pg_temp.af_id(301); u:=pg_temp.af_updates(); update public.estimate_items set quantity=2,line_total_ht_cents=4000,line_tax_cents=800,line_total_ttc_cents=4800 where id=pg_temp.af_id(501);
      perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L,token=>%L,revision=>%s)',u,token,revision),'ESTIMATE_ASSEMBLY_CALCULATION_STALE','40001');
    when 'projection-missing' then perform pg_temp.af_refusal('select pg_temp.af_call(updates=>''[]'')','ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'projection-duplicate' then u:=pg_temp.af_updates(); perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L)',u||jsonb_build_array(u->0)),'ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'projection-foreign' then u:=jsonb_set(pg_temp.af_updates(),'{0,id}',to_jsonb(pg_temp.af_id(502))); perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L)',u),'ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'projection-extra-field' then u:=jsonb_set(pg_temp.af_updates(),'{0,source_metadata}','{"overwrite":true}'); perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L)',u),'ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'projection-negative' then u:=jsonb_set(pg_temp.af_updates(),'{0,line_total_ht_cents}','-1'); perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L)',u),'ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'projection-overflow' then u:=jsonb_set(pg_temp.af_updates(),'{0,pu_ht_cents}','2147483648'); perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L)',u),'ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'projection-malformed-id' then u:=jsonb_set(pg_temp.af_updates(),'{0,id}','"invalid"'); perform pg_temp.af_refusal(format('select pg_temp.af_call(updates=>%L)',u),'ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH','22023');
    when 'inserted-empty' then perform pg_temp.af_refusal('select pg_temp.af_call(ids=>''{}''::uuid[])','ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'inserted-duplicate' then perform pg_temp.af_refusal(format('select pg_temp.af_call(ids=>array[%L,%L]::uuid[])',pg_temp.af_id(511),pg_temp.af_id(511)),'ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'inserted-foreign' then perform pg_temp.af_refusal(format('select pg_temp.af_call(ids=>array[%L]::uuid[])',pg_temp.af_id(502)),'ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'footer-extra-field' then perform pg_temp.af_refusal('select pg_temp.af_call(patch=>''{"total_ht_cents":3250,"total_tax_cents":650,"total_ttc_cents":3900,"discount_bp":0}'')','ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'footer-overflow' then perform pg_temp.af_refusal('select pg_temp.af_call(patch=>''{"total_ht_cents":2147483648,"total_tax_cents":0,"total_ttc_cents":2147483648}'')','ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'null-input' then perform pg_temp.af_refusal('select public.finalize_estimate_assembly_calculation(null,null,null,null,null,null,null,null)','ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'context-malformed' then perform pg_temp.af_refusal('select pg_temp.af_call(ctx=>''{"labor_roles":[],"margin_tiers":[],"labor_split_flag":[]}''::jsonb)','ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT','22023');
    when 'flag-insert-stale' then c:=pg_temp.af_context(); insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.af_id(101),'EST_031_LABOR_SPLIT',false); perform pg_temp.af_refusal(format('select pg_temp.af_call(ctx=>%L)',c),'ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED','40001');
    when 'flag-update-stale' then insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.af_id(101),'EST_031_LABOR_SPLIT',false); c:=pg_temp.af_context(); update public.feature_flags set enabled=true where tenant_id=pg_temp.af_id(101) and flag_key='EST_031_LABOR_SPLIT'; perform pg_temp.af_refusal(format('select pg_temp.af_call(ctx=>%L)',c),'ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED','40001');
    when 'margin-insert-stale' then update public.estimate_versions set margin_mode='tiered' where id=pg_temp.af_id(301); c:=pg_temp.af_context(); insert into public.margin_tiers(tenant_id,threshold_cents,multiplier,position) values(pg_temp.af_id(101),0,1.2,0); perform pg_temp.af_refusal(format('select pg_temp.af_call(ctx=>%L)',c),'ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED','40001');
    when 'rate-update-stale' then update public.estimate_items set labor_role_id=pg_temp.af_id(601) where id=pg_temp.af_id(501); c:=pg_temp.af_context(); update public.labor_roles set hourly_rate_cents=5000 where id=pg_temp.af_id(601); perform pg_temp.af_refusal(format('select pg_temp.af_call(ctx=>%L)',c),'ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED','40001');
    when 'context-missing-role' then update public.estimate_items set labor_role_id=pg_temp.af_id(601) where id=pg_temp.af_id(501); c:=jsonb_set(pg_temp.af_context(),'{labor_roles}','[]'); perform pg_temp.af_refusal(format('select pg_temp.af_call(ctx=>%L)',c),'ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED','40001');
    when 'context-extra-role' then c:=jsonb_set(pg_temp.af_context(),'{labor_roles}',jsonb_build_array(jsonb_build_object('id',pg_temp.af_id(601),'tenant_id',pg_temp.af_id(101),'user_id',pg_temp.af_id(1),'hourly_rate_cents',4000))); perform pg_temp.af_refusal(format('select pg_temp.af_call(ctx=>%L)',c),'ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED','40001');
    when 'late-header-failure' then
      perform set_config('af.fault','enabled',true); perform pg_temp.af_refusal('select pg_temp.af_call()','ASSEMBLY_CALCULATION_LATE_FAULT','23514');
      perform pg_temp.af_assert((select is_called and last_value=1 from pg_temp.af_fault_hits),'Late fault was not reached');
    else raise exception 'Unknown assembly calculation case %',name;
    end case;
  end $f$;
  $helpers$;
  foreach case_name in array array['fixed-nonempty','v2-discount','v1-gross','ordered-items','admin','section-empty-lines','context-normalized-role','acl','viewer','director','other-owner','inactive-tenant','membership-revoked','membership-deleted','tenant-disabled','tenant-priority-changed','project-archived','nondraft','other-session','expired-session','lease-lost','lease-takeover','stale-token','stale-revision','concurrent-item','projection-missing','projection-duplicate','projection-foreign','projection-extra-field','projection-negative','projection-overflow','projection-malformed-id','inserted-empty','inserted-duplicate','inserted-foreign','footer-extra-field','footer-overflow','null-input','context-malformed','flag-insert-stale','flag-update-stale','margin-insert-stale','rate-update-stale','context-missing-role','context-extra-role','late-header-failure'] loop
    passed:=false; failure:=null;
    begin perform pg_temp.af_case(case_name); raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true; when others then failure:=sqlstate||': '||sqlerrm; end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='ESTIMATE_ASSEMBLY_CALCULATION_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','afca0700','concurrencyExecuted',false,'transportExecuted',false,'cases',results)::text;
end;
$assembly_calculation_probe$;
