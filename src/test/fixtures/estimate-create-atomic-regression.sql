-- CORE-08: written BEFORE the product migration. Run only in a surrounding
-- transaction on the disposable local stack; P9001 forces the final rollback.
-- These sequential SQL assertions cover direct-RPC boundaries and late rollback
-- which browser totals alone cannot establish. They do not qualify real races.
do $atomic_create_probe$
declare case_name text; results jsonb := '[]'; passed boolean; failure text;
begin
  if exists(select 1 from auth.users where id::text like 'ac080000-%') then
    raise exception 'Atomic-create fixture prefix already exists';
  end if;
  execute $helpers$
  create function pg_temp.ac_id(n integer) returns uuid language sql immutable as $f$
    select ('ac080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  $f$;
  create function pg_temp.ac_assert(ok boolean, detail text) returns void language plpgsql as $f$
    begin if ok is distinct from true then raise exception '%',detail; end if; end
  $f$;
  create function pg_temp.ac_actor(n integer default 1, db_role text default 'authenticated') returns void language plpgsql as $f$
  begin
    perform set_config('role','none',true);
    perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.ac_id(n)::text end,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.ac_id(n) end,'role',db_role)::text,true);
    perform set_config('role',db_role,true);
  end $f$;
  $helpers$;
  insert into auth.users(id,email,raw_user_meta_data)
    select pg_temp.ac_id(n),'atomic-create-'||n||'@example.invalid',jsonb_build_object('full_name','Atomic create actor '||n) from generate_series(1,5)n;
  update public.tenant_memberships set is_default=false where user_id::text like 'ac080000-%';
  insert into public.tenants(id,name,slug) values
    (pg_temp.ac_id(101),'Atomic create T1','atomic-create-native-t1'),
    (pg_temp.ac_id(102),'Atomic create T2','atomic-create-native-t2');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    select pg_temp.ac_id(101),pg_temp.ac_id(n),(case n when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(1,5)n;
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    values(pg_temp.ac_id(102),pg_temp.ac_id(1),'admin',false,'2021-01-01');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values
    (pg_temp.ac_id(201),pg_temp.ac_id(101),pg_temp.ac_id(1),'ARMY atomic create'),
    (pg_temp.ac_id(202),pg_temp.ac_id(102),pg_temp.ac_id(1),'ARMY atomic other tenant');
  insert into public.estimate_versions(id,project_id,version_number,calc_engine_version,max_section_depth,margin_mode,margin_multiplier,total_ht_cents,total_tax_cents,total_ttc_cents)
    values(pg_temp.ac_id(301),pg_temp.ac_id(201),1,2,1,'fixed',1,40000,8000,48000),
          (pg_temp.ac_id(302),pg_temp.ac_id(201),2,1,1,'fixed',1,40000,8000,48000),
          (pg_temp.ac_id(303),pg_temp.ac_id(202),1,2,1,'fixed',1,0,0,0);
  insert into public.estimate_items(id,version_id,item_type,position,title) values
    (pg_temp.ac_id(401),pg_temp.ac_id(301),'section',1,'CVC'),
    (pg_temp.ac_id(402),pg_temp.ac_id(302),'section',1,'Legacy'),
    (pg_temp.ac_id(403),pg_temp.ac_id(303),'section',1,'Other tenant');
  insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature)
    values(pg_temp.ac_id(501),pg_temp.ac_id(301),pg_temp.ac_id(401),'line',1,'Existing V2','m',10,4000,2000,1,0,1,4000,40000,8000,48000,'supply_only'),
          (pg_temp.ac_id(502),pg_temp.ac_id(302),pg_temp.ac_id(402),'line',1,'Existing V1','m',10,4000,2000,1,0,1,4000,40000,8000,48000,'supply_only');
  insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values
    (pg_temp.ac_id(601),pg_temp.ac_id(101),pg_temp.ac_id(1),'Pose',4000),
    (pg_temp.ac_id(602),pg_temp.ac_id(101),pg_temp.ac_id(5),'Other owner',5000),
    (pg_temp.ac_id(603),pg_temp.ac_id(102),pg_temp.ac_id(1),'Other tenant',6000);
  insert into public.draft_locks(version_id,user_id,session_id,expires_at) select pg_temp.ac_id(n),pg_temp.ac_id(1),pg_temp.ac_id(701),clock_timestamp()+interval '1 hour' from generate_series(301,303)n;
  delete from public.feature_flags where tenant_id=pg_temp.ac_id(101) and flag_key='EST_031_LABOR_SPLIT';
  delete from public.margin_tiers where tenant_id=pg_temp.ac_id(101);
  execute $helpers$
  create function pg_temp.ac_item(v integer default 301) returns jsonb language sql as $f$
    select jsonb_build_object('id',pg_temp.ac_id(801),'parent_id',pg_temp.ac_id(v+100),'item_type','line','position',2,'title','New line','description','m','quantity',2,'unit_price_ht_cents',1000,'tax_rate_bp',2000,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1,'line_nature','supply_only','pu_ht_cents',1000,'line_total_ht_cents',2000,'line_tax_cents',400,'line_total_ttc_cents',2400)
  $f$;
  create function pg_temp.ac_updates(v integer default 301, new_item jsonb default null) returns jsonb language sql as $f$
    select case when v=302 then '[]'::jsonb else
      coalesce((select jsonb_agg(jsonb_build_object('id',id,'pu_ht_cents',pu_ht_cents,'line_total_ht_cents',line_total_ht_cents,'line_tax_cents',line_tax_cents,'line_total_ttc_cents',line_total_ttc_cents) order by id) from public.estimate_items where version_id=pg_temp.ac_id(v) and item_type='line'),'[]') ||
      case when coalesce(new_item,pg_temp.ac_item(v))->>'item_type'='line' then jsonb_build_array(coalesce(new_item,pg_temp.ac_item(v)) - array['parent_id','item_type','position','title','description','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','line_nature','labor_role_id','aid','source_provider','source_file_name','source_page']) else '[]'::jsonb end end
  $f$;
  create function pg_temp.ac_context(v integer default 301, item jsonb default null) returns jsonb language sql as $f$
    select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tenant_id',r.tenant_id,'user_id',r.user_id,'hourly_rate_cents',r.hourly_rate_cents) order by r.id)
      from public.labor_roles r where r.tenant_id=pg_temp.ac_id(101) and r.user_id=pg_temp.ac_id(1) and r.id in
      (select labor_role_id from public.estimate_items where version_id=pg_temp.ac_id(v) union select labor_role_atelier_id from public.estimate_items where version_id=pg_temp.ac_id(v) union select labor_role_chantier_id from public.estimate_items where version_id=pg_temp.ac_id(v) union select (item->>'labor_role_id')::uuid union select (item->>'labor_role_atelier_id')::uuid union select (item->>'labor_role_chantier_id')::uuid)),'[]'),
      'margin_tiers',case when (select margin_mode from public.estimate_versions where id=pg_temp.ac_id(v))='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'threshold_cents',threshold_cents,'multiplier',multiplier,'position',position) order by threshold_cents,position,id) from public.margin_tiers where tenant_id=pg_temp.ac_id(101)),'[]') else '[]'::jsonb end,
      'labor_split_flag',(select jsonb_build_object('id',id,'enabled',enabled) from public.feature_flags where tenant_id=pg_temp.ac_id(101) and flag_key='EST_031_LABOR_SPLIT'))
  $f$;
  create function pg_temp.ac_call(item jsonb default null, updates jsonb default null, patch jsonb default null, ctx jsonb default null, token timestamptz default null, session uuid default null, v integer default 301) returns jsonb language plpgsql as $f$
  begin
    return public.atomic_create_estimate_item(pg_temp.ac_id(v),coalesce(item,pg_temp.ac_item(v)),coalesce(updates,pg_temp.ac_updates(v,item)),coalesce(patch,'{"total_ht_cents":42000,"total_tax_cents":8400,"total_ttc_cents":50400}'),coalesce(token,(select updated_at from public.estimate_versions where id=pg_temp.ac_id(v)),nullif(current_setting('ac.token.v'||v,true),'')::timestamptz),coalesce(session,pg_temp.ac_id(701)),coalesce(ctx,pg_temp.ac_context(v,item)));
  end $f$;
  create function pg_temp.ac_refusal(command text, expected text default null) returns void language plpgsql as $f$
  declare state text; message text; before_state jsonb; after_state jsonb;
  begin
    perform pg_temp.ac_actor(null,'none');
    -- A denied actor still submits a previously obtained valid token. Otherwise
    -- RLS hides this SELECT and the probe would only exercise missing-input validation.
    perform set_config('ac.token.v'||n,(select updated_at::text from public.estimate_versions where id=pg_temp.ac_id(n)),true) from generate_series(301,303)n;
    select jsonb_build_object('v',(select jsonb_agg(to_jsonb(v) order by id) from public.estimate_versions v where id::text like 'ac080000-%'),'i',(select jsonb_agg(to_jsonb(i) order by id) from public.estimate_items i where id::text like 'ac080000-%')) into before_state;
    perform pg_temp.ac_actor(coalesce(nullif(current_setting('ac.actor',true),'')::integer,1),coalesce(nullif(current_setting('ac.role',true),''),'authenticated'));
    begin execute command; exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text; end;
    perform pg_temp.ac_actor(null,'none');
    select jsonb_build_object('v',(select jsonb_agg(to_jsonb(v) order by id) from public.estimate_versions v where id::text like 'ac080000-%'),'i',(select jsonb_agg(to_jsonb(i) order by id) from public.estimate_items i where id::text like 'ac080000-%')) into after_state;
    perform pg_temp.ac_assert(state is not null and state<>'42883' and (expected is null or message=expected),format('Expected %s, got %s/%s',expected,state,message));
    perform pg_temp.ac_assert(before_state=after_state,'Refused creation changed existing rows/token or left an orphan');
  end $f$;
  create function pg_temp.ac_case(name text) returns void language plpgsql as $f$
  declare r jsonb; p jsonb:=pg_temp.ac_item(); u jsonb; c jsonb; saved jsonb; t timestamptz; v integer:=301;
  begin
    perform set_config('ac.actor','1',true); perform set_config('ac.role','authenticated',true); perform pg_temp.ac_actor();
    if name in ('v2-line','v1-line','section-v2','section-v1','incomplete-v2','incomplete-v1','precision-coercion','source-metadata','admin') then
      if name in ('v1-line','section-v1','incomplete-v1') then v:=302; p:=pg_temp.ac_item(v); end if;
      if name in ('section-v2','section-v1') then p:=jsonb_build_object('id',pg_temp.ac_id(801),'item_type','section','position',2,'title','New section'); end if;
      if name in ('incomplete-v2','incomplete-v1') then p:=p||'{"h_mo":1,"line_nature":"supply_and_labor"}'; end if;
      if name='precision-coercion' then p:=p||'{"quantity":1.0005,"h_mo_majoration":1.00005,"k_fo":999999999.9994}'; end if;
      if name='source-metadata' then p:=p||'{"aid":"CVC-08","source_provider":"takeoff","source_file_name":"CCTP.pdf","source_page":3}'; end if;
      if name='admin' then
        perform pg_temp.ac_actor(null,'none'); delete from public.draft_locks where version_id=pg_temp.ac_id(v);
        insert into public.draft_locks(version_id,user_id,session_id,expires_at) values(pg_temp.ac_id(v),pg_temp.ac_id(2),pg_temp.ac_id(701),clock_timestamp()+interval '1 hour'); perform pg_temp.ac_actor(2);
      end if;
      select to_jsonb(i) into saved from public.estimate_items i where id=pg_temp.ac_id(v+200);
      r:=pg_temp.ac_call(p,null,case when name like 'section-%' then '{"total_ht_cents":40000,"total_tax_cents":8000,"total_ttc_cents":48000}'::jsonb else null end,null,null,null,v);
      perform pg_temp.ac_assert(r->'item'->>'id'=pg_temp.ac_id(801)::text and r->'version'->>'id'=pg_temp.ac_id(v)::text,'Wrong committed identity');
      perform pg_temp.ac_assert((r->'version'->>'updated_at')::timestamptz=(select updated_at from public.estimate_versions where id=pg_temp.ac_id(v)),'Returned token differs from persisted token');
      perform pg_temp.ac_assert(r->'totals'=case when name like 'section-%' then '{"total_ht_cents":40000,"total_tax_cents":8000,"total_ttc_cents":48000}'::jsonb else '{"total_ht_cents":42000,"total_tax_cents":8400,"total_ttc_cents":50400}'::jsonb end,'Header not committed with creation');
      if v=302 then perform pg_temp.ac_assert(saved=(select to_jsonb(i) from public.estimate_items i where id=pg_temp.ac_id(502)),'V1 existing line was rewritten'); end if;
      perform pg_temp.ac_assert((r->'item'->>'snapshot_pu_ht_cents') is null,'Creation published a snapshot');
      if name='precision-coercion' then perform pg_temp.ac_assert(r->'item'->>'quantity'='1.001' and r->'item'->>'h_mo_majoration'='1.0001' and r->'item'->>'k_fo'='999999999.999','Native precision did not preserve compatible coercion'); end if;
      if name='source-metadata' then perform pg_temp.ac_assert(r->'item'->>'aid'='CVC-08' and r->'item'->>'source_page'='3','Creation lost provenance'); end if;
      return;
    end if;
    case name
    when 'acl' then
      perform pg_temp.ac_assert(not has_function_privilege('anon','public.atomic_create_estimate_item(uuid,jsonb,jsonb,jsonb,timestamptz,uuid,jsonb)','EXECUTE'),'Anonymous execution granted');
      perform pg_temp.ac_assert(not has_schema_privilege('authenticated','private','USAGE'),'Private schema usage broadened');
      perform pg_temp.ac_assert(not(select prosecdef from pg_proc where oid='public.atomic_create_estimate_item(uuid,jsonb,jsonb,jsonb,timestamptz,uuid,jsonb)'::regprocedure),'RPC unexpectedly privileged');
    when 'viewer' then perform set_config('ac.actor','4',true); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'director' then perform set_config('ac.actor','3',true); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'other-owner' then perform set_config('ac.actor','5',true); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'inactive-tenant' then perform pg_temp.ac_refusal('select pg_temp.ac_call(v=>303)','ESTIMATE_CREATE_FORBIDDEN');
    when 'no-session' then perform pg_temp.ac_refusal(format('select public.atomic_create_estimate_item(%L,%L,%L,%L,(select updated_at from public.estimate_versions where id=%L),null,%L)',pg_temp.ac_id(301),p,pg_temp.ac_updates(),'{"total_ht_cents":42000,"total_tax_cents":8400,"total_ttc_cents":50400}',pg_temp.ac_id(301),pg_temp.ac_context()),'ESTIMATE_CREATE_LOCK_REQUIRED');
    when 'other-session' then perform pg_temp.ac_refusal(format('select pg_temp.ac_call(session=>%L)',pg_temp.ac_id(702)),'ESTIMATE_CREATE_LOCK_REQUIRED');
    when 'expired-session' then perform pg_temp.ac_actor(null,'none'); update public.draft_locks set expires_at=clock_timestamp()-interval '1 second' where version_id=pg_temp.ac_id(301); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_LOCK_REQUIRED');
    when 'stale-token' then perform pg_temp.ac_refusal('select pg_temp.ac_call(token=>''2000-01-01''::timestamptz)','ESTIMATE_CREATE_STALE');
    when 'member-role-revoked' then perform pg_temp.ac_actor(null,'none'); update public.tenant_memberships set role='viewer' where tenant_id=pg_temp.ac_id(101) and user_id=pg_temp.ac_id(1); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'member-deleted' then perform pg_temp.ac_actor(null,'none'); delete from public.tenant_memberships where tenant_id=pg_temp.ac_id(101) and user_id=pg_temp.ac_id(1); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'tenant-disabled' then perform pg_temp.ac_actor(null,'none'); update public.tenants set is_active=false where id=pg_temp.ac_id(101); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'tenant-priority-changed' then perform pg_temp.ac_actor(null,'none'); update public.tenant_memberships set is_default=false where user_id=pg_temp.ac_id(1); update public.tenant_memberships set is_default=true where user_id=pg_temp.ac_id(1) and tenant_id=pg_temp.ac_id(102); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'project-archived' then perform pg_temp.ac_actor(null,'none'); update public.estimate_projects set is_archived=true where id=pg_temp.ac_id(201); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_FORBIDDEN');
    when 'lease-lost' then perform pg_temp.ac_actor(null,'none'); delete from public.draft_locks where version_id=pg_temp.ac_id(301); perform pg_temp.ac_refusal('select pg_temp.ac_call()','ESTIMATE_CREATE_LOCK_REQUIRED');
    when 'wrong-parent' then p:=p||jsonb_build_object('parent_id',pg_temp.ac_id(402)); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p));
    when 'parent-is-line' then p:=p||jsonb_build_object('parent_id',pg_temp.ac_id(501)); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p));
    when 'duplicate-position' then p:=p||'{"position":1}'; perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p));
    when 'precision-overflow' then p:=p||'{"quantity":999999999.9995}'; perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p));
    when 'foreign-role' then p:=p||jsonb_build_object('labor_role_id',pg_temp.ac_id(602)); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p));
    when 'tenant-role' then p:=p||jsonb_build_object('labor_role_id',pg_temp.ac_id(603)); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p));
    when 'snapshot-injection' then p:=p||'{"snapshot_pu_ht_cents":1000}'; perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p),'ESTIMATE_CREATE_INVALID_INPUT');
    when 'tenant-injection' then p:=p||jsonb_build_object('tenant_id',pg_temp.ac_id(102)); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L)',p),'ESTIMATE_CREATE_INVALID_INPUT');
    when 'projection-missing' then perform pg_temp.ac_refusal('select pg_temp.ac_call(updates=>''[]'')','ESTIMATE_CREATE_PROJECTION_MISMATCH');
    when 'projection-duplicate' then u:=pg_temp.ac_updates(); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(updates=>%L)',u||jsonb_build_array(u->0)),'ESTIMATE_CREATE_PROJECTION_MISMATCH');
    when 'projection-unknown' then u:=jsonb_set(pg_temp.ac_updates(),'{0,id}',to_jsonb(pg_temp.ac_id(999))); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(updates=>%L)',u),'ESTIMATE_CREATE_PROJECTION_MISMATCH');
    when 'projection-extra-field' then u:=jsonb_set(pg_temp.ac_updates(),'{0,title}','"Overwrite"'); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(updates=>%L)',u),'ESTIMATE_CREATE_PROJECTION_MISMATCH');
    when 'v1-update-forbidden' then perform pg_temp.ac_refusal(format('select pg_temp.ac_call(v=>302,updates=>%L)',pg_temp.ac_updates()),'ESTIMATE_CREATE_PROJECTION_MISMATCH');
    when 'late-header-failure' then perform pg_temp.ac_refusal('select pg_temp.ac_call(patch=>''{"total_ht_cents":42000,"total_tax_cents":8400,"total_ttc_cents":1}'')');
    when 'late-line-failure' then u:=jsonb_set(pg_temp.ac_updates(),'{0,line_total_ht_cents}','-1'); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(updates=>%L)',u));
    when 'flag-insert-stale' then
      c:=pg_temp.ac_context(); perform pg_temp.ac_actor(null,'none'); insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.ac_id(101),'EST_031_LABOR_SPLIT',false);
      perform pg_temp.ac_refusal(format('select pg_temp.ac_call(ctx=>%L)',c),'ESTIMATE_CREATE_CONTEXT_CHANGED');
    when 'flag-update-stale' then
      perform pg_temp.ac_actor(null,'none'); insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.ac_id(101),'EST_031_LABOR_SPLIT',false); c:=pg_temp.ac_context(); update public.feature_flags set enabled=true where tenant_id=pg_temp.ac_id(101) and flag_key='EST_031_LABOR_SPLIT';
      perform pg_temp.ac_refusal(format('select pg_temp.ac_call(ctx=>%L)',c),'ESTIMATE_CREATE_CONTEXT_CHANGED');
    when 'margin-insert-stale' then
      perform pg_temp.ac_actor(null,'none'); update public.estimate_versions set margin_mode='tiered' where id=pg_temp.ac_id(301); c:=pg_temp.ac_context(); insert into public.margin_tiers(tenant_id,threshold_cents,multiplier,position) values(pg_temp.ac_id(101),0,1.2,0);
      perform pg_temp.ac_refusal(format('select pg_temp.ac_call(ctx=>%L)',c),'ESTIMATE_CREATE_CONTEXT_CHANGED');
    when 'rate-update-stale' then
      p:=p||jsonb_build_object('labor_role_id',pg_temp.ac_id(601)); c:=pg_temp.ac_context(301,p); perform pg_temp.ac_actor(null,'none'); update public.labor_roles set hourly_rate_cents=5000 where id=pg_temp.ac_id(601);
      perform pg_temp.ac_refusal(format('select pg_temp.ac_call(item=>%L,ctx=>%L)',p,c),'ESTIMATE_CREATE_CONTEXT_CHANGED');
    when 'context-extra-role' then c:=jsonb_set(pg_temp.ac_context(),'{labor_roles}',jsonb_build_array(jsonb_build_object('id',pg_temp.ac_id(601),'tenant_id',pg_temp.ac_id(101),'user_id',pg_temp.ac_id(1),'hourly_rate_cents',4000))); perform pg_temp.ac_refusal(format('select pg_temp.ac_call(ctx=>%L)',c),'ESTIMATE_CREATE_CONTEXT_CHANGED');
    when 'nondraft' then perform pg_temp.ac_actor(null,'service_role'); update public.estimate_versions set status='sent',seal_hash=repeat('a',64) where id=pg_temp.ac_id(302); perform pg_temp.ac_refusal('select pg_temp.ac_call(v=>302)','ESTIMATE_CREATE_FORBIDDEN');
    else raise exception 'Unknown atomic-create case %',name;
    end case;
  end $f$;
  $helpers$;
  foreach case_name in array array['v2-line','v1-line','section-v2','section-v1','incomplete-v2','incomplete-v1','precision-coercion','source-metadata','admin','acl','viewer','director','other-owner','inactive-tenant','no-session','other-session','expired-session','stale-token','wrong-parent','parent-is-line','duplicate-position','precision-overflow','foreign-role','tenant-role','snapshot-injection','tenant-injection','projection-missing','projection-duplicate','projection-unknown','projection-extra-field','v1-update-forbidden','late-header-failure','late-line-failure','flag-insert-stale','flag-update-stale','margin-insert-stale','rate-update-stale','context-extra-role','nondraft','member-role-revoked','member-deleted','tenant-disabled','tenant-priority-changed','project-archived','lease-lost'] loop
    passed:=false; failure:=null;
    begin
      perform pg_temp.ac_case(case_name);
      raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true;
      when others then failure:=sqlstate||': '||sqlerrm;
    end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='ESTIMATE_CREATE_ATOMIC_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','ac080000','concurrencyExecuted',false,'cases',results)::text;
end;
$atomic_create_probe$;
