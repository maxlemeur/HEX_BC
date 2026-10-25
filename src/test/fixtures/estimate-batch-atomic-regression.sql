-- CORE-08/WFC: assertions written BEFORE the batch product migration.
-- Candidate only during the CCTP freeze. NO EXECUTION has been performed.
-- The future runner must target only the owned disposable stack, surround this
-- DO and candidate DDL with a transaction, and verify rollback independently.
-- P9001 always aborts the outer transaction, even if every assertion passes.
-- Direct-RPC ACL, cascades, late faults, receipts and technical ABA are the
-- isolation exception: browser totals cannot establish these boundaries.
-- Financial values below are explicit oracles; this fixture does not calculate
-- money or qualify the TypeScript calculator, HTTP, bytes, or real concurrency.
do $batch_atomic_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure text;
begin
  if exists(select 1 from auth.users where id::text like 'bfc10000-%') then
    raise exception 'Batch fixture identity already exists';
  end if;
  execute $helpers$
  create function pg_temp.ba_id(n integer) returns uuid language sql immutable as $f$
    select ('bfc10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  $f$;
  create function pg_temp.ba_assert(ok boolean, detail text) returns void language plpgsql as $f$
  begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
  create function pg_temp.ba_actor(n integer default 1, db_role text default 'authenticated') returns void language plpgsql as $f$
  begin
    perform set_config('role','none',true);
    perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.ba_id(n)::text end,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.ba_id(n) end,'role',db_role)::text,true);
    perform set_config('role',db_role,true);
  end $f$;
  $helpers$;
  insert into auth.users(id,email,raw_user_meta_data)
    select pg_temp.ba_id(n),'batch-atomic-'||n||'@example.invalid',jsonb_build_object('full_name','Batch actor '||n) from generate_series(1,5)n;
  update public.tenant_memberships set is_default=false where user_id::text like 'bfc10000-%';
  insert into public.tenants(id,name,slug) values
    (pg_temp.ba_id(101),'ARMY batch T1','batch-atomic-native-t1'),
    (pg_temp.ba_id(102),'ARMY batch T2','batch-atomic-native-t2');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    select pg_temp.ba_id(101),pg_temp.ba_id(n),(case n when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(1,5)n;
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    values(pg_temp.ba_id(102),pg_temp.ba_id(1),'admin',false,'2021-01-01');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values
    (pg_temp.ba_id(201),pg_temp.ba_id(101),pg_temp.ba_id(1),'ARMY atomic batch'),
    (pg_temp.ba_id(202),pg_temp.ba_id(102),pg_temp.ba_id(1),'ARMY inactive batch tenant'),
    (pg_temp.ba_id(203),pg_temp.ba_id(101),pg_temp.ba_id(5),'ARMY other owner');
  insert into public.estimate_versions(id,project_id,version_number,calc_engine_version,max_section_depth,margin_mode,margin_multiplier,tax_rate_bp,discount_bp,total_ht_cents,total_tax_cents,total_ttc_cents)
    values(pg_temp.ba_id(301),pg_temp.ba_id(201),1,2,1,'fixed',1,0,5000,5,0,5),
          (pg_temp.ba_id(302),pg_temp.ba_id(201),2,1,1,'fixed',1,0,5000,5,0,5),
          (pg_temp.ba_id(303),pg_temp.ba_id(202),1,2,1,'fixed',1,0,0,0,0,0),
          (pg_temp.ba_id(304),pg_temp.ba_id(203),1,2,1,'fixed',1,0,0,0,0,0);
  insert into public.estimate_items(id,version_id,item_type,position,title) values
    (pg_temp.ba_id(401),pg_temp.ba_id(301),'section',1,'CVC'),
    (pg_temp.ba_id(402),pg_temp.ba_id(302),'section',1,'Legacy'),
    (pg_temp.ba_id(403),pg_temp.ba_id(303),'section',1,'Inactive tenant'),
    (pg_temp.ba_id(404),pg_temp.ba_id(304),'section',1,'Other owner');
  insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature)
    values(pg_temp.ba_id(501),pg_temp.ba_id(301),pg_temp.ba_id(401),'line',1,'A','m',1,5,0,1,0,1,2,2,0,2,'supply_only'),
          (pg_temp.ba_id(502),pg_temp.ba_id(301),pg_temp.ba_id(401),'line',2,'B','m',1,5,0,1,0,1,3,3,0,3,'supply_only'),
          (pg_temp.ba_id(511),pg_temp.ba_id(302),pg_temp.ba_id(402),'line',1,'A legacy','m',1,5,0,1,0,1,5,5,0,5,'supply_only'),
          (pg_temp.ba_id(512),pg_temp.ba_id(302),pg_temp.ba_id(402),'line',2,'B legacy','m',1,5,0,1,0,1,5,5,0,5,'supply_only');
  insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values
    (pg_temp.ba_id(601),pg_temp.ba_id(101),pg_temp.ba_id(1),'Pose',4000),
    (pg_temp.ba_id(602),pg_temp.ba_id(101),pg_temp.ba_id(5),'Other owner',5000),
    (pg_temp.ba_id(603),pg_temp.ba_id(102),pg_temp.ba_id(1),'Other tenant',6000);
  insert into public.draft_locks(version_id,user_id,session_id,expires_at)
    select pg_temp.ba_id(n),pg_temp.ba_id(1),pg_temp.ba_id(701),clock_timestamp()+interval '1 hour' from generate_series(301,304)n;
  delete from public.feature_flags where tenant_id=pg_temp.ba_id(101) and flag_key in('EST_031_LABOR_SPLIT','ESTIMATE_ITEM_AID_REGEX');
  delete from public.margin_tiers where tenant_id=pg_temp.ba_id(101);
  insert into public.products(id,tenant_id,designation,unit_price_cents) values(pg_temp.ba_id(621),pg_temp.ba_id(102),'Foreign product',5);
  insert into public.suppliers(id,tenant_id,name) values(pg_temp.ba_id(622),pg_temp.ba_id(102),'Foreign supplier');
  insert into public.supplier_catalog_items(id,tenant_id,supplier_id,product_id) values(pg_temp.ba_id(620),pg_temp.ba_id(102),pg_temp.ba_id(622),pg_temp.ba_id(621));
  insert into public.supplier_pricebook(id,tenant_id,supplier_id,product_id,unit_price_cents) values(pg_temp.ba_id(623),pg_temp.ba_id(102),pg_temp.ba_id(622),pg_temp.ba_id(621),5);
  insert into public.estimate_categories(id,tenant_id,user_id,name) values(pg_temp.ba_id(624),pg_temp.ba_id(101),pg_temp.ba_id(5),'Foreign owner category');
  insert into public.supply_types(id,tenant_id,code,name) values(pg_temp.ba_id(625),pg_temp.ba_id(102),'BA-X','Foreign supply');
  insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by) values(pg_temp.ba_id(626),pg_temp.ba_id(102),pg_temp.ba_id(303),'A',pg_temp.ba_id(1));

  -- Synthetic provenance exists only to exercise native cascade and rollback.
  -- It is not a claim that an ouvrage was generated/applied through the product.
  insert into public.estimate_generated_ouvrage_drafts(id,tenant_id,project_id,target_version_id,created_by,source_kind,status)
    values(pg_temp.ba_id(901),pg_temp.ba_id(101),pg_temp.ba_id(201),pg_temp.ba_id(301),pg_temp.ba_id(1),'free_text','applied');
  insert into public.estimate_generated_ouvrage_candidates(id,tenant_id,project_id,target_version_id,draft_id,candidate_order,designation,normalized_designation,confidence,ai_status,resolution_status)
    values(pg_temp.ba_id(902),pg_temp.ba_id(101),pg_temp.ba_id(201),pg_temp.ba_id(301),pg_temp.ba_id(901),0,'A','a',1,'certain','inserted');
  insert into public.estimate_generated_ouvrage_applications(id,tenant_id,draft_id,candidate_id,target_version_id,estimate_item_id,applied_by,applied_payload)
    values(pg_temp.ba_id(903),pg_temp.ba_id(101),pg_temp.ba_id(901),pg_temp.ba_id(902),pg_temp.ba_id(301),pg_temp.ba_id(501),pg_temp.ba_id(1),'{"fixture":"cascade"}');
  insert into public.estimate_generated_ouvrage_work_snapshots(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,estimate_item_id,applied_by,components)
    values(pg_temp.ba_id(904),pg_temp.ba_id(101),pg_temp.ba_id(201),pg_temp.ba_id(301),pg_temp.ba_id(901),pg_temp.ba_id(902),pg_temp.ba_id(501),pg_temp.ba_id(1),'[{"id":"fixture-component","quantity":1}]');
  insert into private.estimate_source_reviews(id,tenant_id,project_id,version_id)
    values(pg_temp.ba_id(911),pg_temp.ba_id(101),pg_temp.ba_id(201),pg_temp.ba_id(301));
  insert into private.estimate_source_coverage_requirements(id,review_id,revision,prescription,expected_service,scope)
    values(pg_temp.ba_id(912),pg_temp.ba_id(911),1,'Native technical ABA','Quantity stays reviewed only while facts do','{"mode":"whole_project"}');
  insert into private.estimate_source_coverage_links(id,requirement_id,kind,item_id,justification,target_key)
    values(pg_temp.ba_id(913),pg_temp.ba_id(912),'line',pg_temp.ba_id(501),'Fixture technical dependency','line:'||pg_temp.ba_id(501));

  execute $helpers$
  -- This privileged TEMP observer only returns a complete fixture snapshot to
  -- test code. Product calls below still use the genuine SET ROLE + auth.uid.
  create function pg_temp.ba_state() returns jsonb language plpgsql security definer set search_path='' as $f$
  declare t record; rows_value jsonb; result jsonb:='{}';
  begin
    for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private') order by n.nspname,c.relname loop
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%bfc10000-%%''',t.nspname,t.relname) into rows_value;
      if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
    end loop;
    return result;
  end $f$;
  create function pg_temp.ba_money(n integer, amount integer) returns jsonb language sql as $f$
    select jsonb_build_object('id',pg_temp.ba_id(n),'pu_ht_cents',amount,'line_total_ht_cents',amount,'line_tax_cents',0,'line_total_ttc_cents',amount)
  $f$;
  create function pg_temp.ba_projection(v integer default 301) returns jsonb language sql as $f$
    select case when v=302 then jsonb_build_array(pg_temp.ba_money(801,5)) else jsonb_build_array(pg_temp.ba_money(501,2),pg_temp.ba_money(502,2),pg_temp.ba_money(801,3)) end
  $f$;
  create function pg_temp.ba_existing() returns jsonb language sql as $f$
    select jsonb_build_array(pg_temp.ba_money(501,2),pg_temp.ba_money(502,3))
  $f$;
  create function pg_temp.ba_footer(amount integer default 7) returns jsonb language sql as $f$
    select jsonb_build_object('total_ht_cents',amount,'total_tax_cents',0,'total_ttc_cents',amount)
  $f$;
  create function pg_temp.ba_operations(v integer default 301) returns jsonb language sql as $f$
    select jsonb_build_array(jsonb_build_object('op','create','data',jsonb_build_object('item_type','line','parent_id',pg_temp.ba_id(v+100),'title','C','quantity',1,'unit_price_ht_cents',5)))
  $f$;
  create function pg_temp.ba_created() returns jsonb language sql as $f$
    select jsonb_build_array(jsonb_build_object('index',0,'id',pg_temp.ba_id(801)))
  $f$;
  create function pg_temp.ba_context() returns jsonb language sql as $f$
    select jsonb_build_object('labor_roles','[]'::jsonb,'margin_tiers','[]'::jsonb,'labor_split_flag',null)
  $f$;
  create function pg_temp.ba_call(ops jsonb default null,ids jsonb default null,updates jsonb default null,patch jsonb default null,ctx jsonb default null,token timestamptz default null,session uuid default null,v integer default 301,key_id integer default 1001,aid jsonb default 'null') returns jsonb language plpgsql as $f$
  begin
    return public.commit_estimate_batch(pg_temp.ba_id(v),case when key_id is null then null else pg_temp.ba_id(key_id) end,
      coalesce(token,nullif(current_setting('ba.token.v'||v,true),'')::timestamptz,(select updated_at from public.estimate_versions where id=pg_temp.ba_id(v))),
      coalesce(session,pg_temp.ba_id(701)),coalesce(ops,pg_temp.ba_operations(v)),coalesce(ids,pg_temp.ba_created()),coalesce(updates,pg_temp.ba_projection(v)),coalesce(patch,pg_temp.ba_footer()),coalesce(ctx,pg_temp.ba_context()),aid);
  end $f$;
  create function pg_temp.ba_refusal(command text,expected text default null,operation_index integer default null) returns void language plpgsql as $f$
  declare state text; message text; before_state jsonb; response jsonb;
  begin
    before_state:=pg_temp.ba_state();
    begin execute command into response; exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text; end;
    if operation_index is not null then
      perform pg_temp.ba_assert(state is null and response->'committed'='false'::jsonb,'Operation failure must be a confirmed full rollback result');
      perform pg_temp.ba_assert(jsonb_array_length(response->'results')=operation_index+1,'Failure must stop at first failing index');
      perform pg_temp.ba_assert(response->'results'->operation_index->>'status'='error' and (response->'results'->operation_index->>'index')::integer=operation_index,'Wrong first failed operation');
      perform pg_temp.ba_assert(not exists(select 1 from jsonb_array_elements(response->'results') x where (x->>'index')::integer<operation_index and (x->>'status'<>'ok' or x->'data'<>'{"rolled_back":true}'::jsonb)),'Prior results claim persisted intermediate data');
      message:=response->'results'->operation_index->>'code';
    elsif state is null then
      perform pg_temp.ba_assert(response->'committed'='false'::jsonb,'Refusal unexpectedly succeeded');
      select x->>'code' into message from jsonb_array_elements(response->'results') x where x->>'status'='error' limit 1;
    end if;
    perform pg_temp.ba_assert(state is distinct from '42883' and (expected is null or message=expected),format('Expected %s, got %s/%s',expected,state,message));
    if state is null then
      perform pg_temp.ba_assert(message like 'ESTIMATE_BATCH_%' and response::text not like '%BA_INJECTED_%','Unsanitized or missing public failure code');
    end if;
    perform pg_temp.ba_assert(before_state=pg_temp.ba_state(),'Refusal changed fixture rows, audit, coverage, receipt or version');
  end $f$;
  create function pg_temp.ba_fault() returns trigger language plpgsql as $f$
  begin
    if current_setting('ba.fault',true)=tg_table_name and to_jsonb(new)::text like '%bfc10000-%'
      and (tg_table_name<>'audit_logs' or to_jsonb(new)->'after_data'->>'type'='batch_operations') then
      raise exception using errcode='23514',message='BA_INJECTED_PRIVATE_DETAIL';
    end if;
    return new;
  end $f$;
  create trigger zzzz_batch_test_fault before insert on public.audit_logs for each row execute function pg_temp.ba_fault();
  create trigger zzzz_batch_test_fault before insert on private.estimate_batch_receipts for each row execute function pg_temp.ba_fault();
  -- now() is constant inside this forced-rollback DO. Supply only the later
  -- token precondition for the replay test; this is NOT evidence for the real
  -- production timestamp generator or an intertransaction race.
  create function pg_temp.ba_later_token() returns trigger language plpgsql as $f$
  begin
    if new.id=pg_temp.ba_id(301) and current_setting('ba.later_token',true)='yes' then new.updated_at:=clock_timestamp(); end if;
    return new;
  end $f$;
  create trigger zzzzz_batch_test_later_token before update on public.estimate_versions for each row execute function pg_temp.ba_later_token();
  create function pg_temp.ba_case(name text) returns void language plpgsql as $f$
  declare r jsonb; r2 jsonb; p jsonb:=pg_temp.ba_operations(); ids jsonb:=pg_temp.ba_created(); u jsonb:=pg_temp.ba_projection(); saved jsonb; ctx jsonb:=pg_temp.ba_context(); t timestamptz; tech bigint; v integer:=301; n integer; signature text;
  begin
    perform pg_temp.ba_actor(null,'none');
    perform set_config('ba.token.v'||x,(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(x)),true) from generate_series(301,304)x;
    t:=(select updated_at from public.estimate_versions where id=pg_temp.ba_id(301));
    perform set_config('ba.fault','',true);
    perform set_config('ba.later_token','no',true);
    perform pg_temp.ba_actor();
    case name
    when 'wfc01-late-operation-rollback' then
      p:=p||jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(999),'data',jsonb_build_object('quantity',2)));
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_NOT_FOUND',1);
    when 'wfc01-success-v2' then
      r:=pg_temp.ba_call();
      perform pg_temp.ba_assert(r->'committed'='true' and r->'replayed'='false','Success missing commit status');
      perform pg_temp.ba_assert(r->'totals'=pg_temp.ba_footer() and (select total_ht_cents=7 from public.estimate_versions where id=pg_temp.ba_id(301)),'Footer missing');
      perform pg_temp.ba_assert((select array_agg(line_total_ht_cents order by position)=array[2,2,3] from public.estimate_items where version_id=pg_temp.ba_id(301) and item_type='line'),'Wrong final WFC allocations');
      perform pg_temp.ba_assert(r->'results'->0->'data'->'item'=(select to_jsonb(i) from public.estimate_items i where id=pg_temp.ba_id(801)),'Create result is not final row');
      perform pg_temp.ba_assert((r->'version'->>'updated_at')::timestamptz=(select updated_at from public.estimate_versions where id=pg_temp.ba_id(301)),'Commit token not persisted');
      perform pg_temp.ba_actor(null,'none');
      perform pg_temp.ba_assert((select count(*)=1 from private.estimate_batch_receipts where version_id=pg_temp.ba_id(301)),'No unique receipt');
      perform pg_temp.ba_assert((select count(*)=1 from public.audit_logs where estimate_version_id=pg_temp.ba_id(301) and after_data->>'type'='batch_operations'),'Batch audit not committed exactly once');
    when 'v1-untargeted-line-unchanged' then
      select to_jsonb(i) into saved from public.estimate_items i where id=pg_temp.ba_id(511);
      r:=pg_temp.ba_call(v=>302);
      perform pg_temp.ba_assert(r->'committed'='true' and r->'totals'=pg_temp.ba_footer(),'V1 did not commit canonical footer');
      perform pg_temp.ba_assert(saved=(select to_jsonb(i) from public.estimate_items i where id=pg_temp.ba_id(511)),'V1 untouched row was reprojected');
      perform pg_temp.ba_assert((select line_total_ht_cents=5 from public.estimate_items where id=pg_temp.ba_id(801)),'V1 gross new line became discounted allocation');
    when 'v1-targeted-projection' then
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(511),'data','{"quantity":2}'::jsonb));
      r:=pg_temp.ba_call(v=>302,ops=>p,ids=>'[]',updates=>jsonb_build_array(pg_temp.ba_money(511,10)),patch=>pg_temp.ba_footer());
      perform pg_temp.ba_assert(r->'committed'='true' and (select quantity=2 and line_total_ht_cents=10 from public.estimate_items where id=pg_temp.ba_id(511)),'V1 target projection missing');
      perform pg_temp.ba_assert((select line_total_ht_cents=5 from public.estimate_items where id=pg_temp.ba_id(512)),'V1 unrelated allocation rewritten');
    when 'section-default-v2' then
      r:=pg_temp.ba_call(ops=>'[{"op":"create","data":{"item_type":"section"}}]',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5));
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'->>'item_type'='section','Section failed');
      perform pg_temp.ba_assert(r->'results'->0->'data'->'item'->>'title' is not null and r->'totals'=pg_temp.ba_footer(5),'Section defaults/footer lost');
    when 'incomplete-labor-v1' then
      p:=jsonb_set(pg_temp.ba_operations(302),'{0,data,h_mo}','1'); r:=pg_temp.ba_call(v=>302,ops=>p);
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'->>'labor_role_id' is null,'V1 incomplete draft rejected');
    when 'incomplete-labor-v2' then
      p:=jsonb_set(p,'{0,data,h_mo}','1'); r:=pg_temp.ba_call(ops=>p);
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'->>'labor_role_id' is null,'V2 incomplete draft rejected');
    when 'precision-storage-coercion' then
      p:=jsonb_set(jsonb_set(p,'{0,data,quantity}','1.0005'),'{0,data,h_mo_majoration}','1.00005'); r:=pg_temp.ba_call(ops=>p);
      perform pg_temp.ba_assert((r->'results'->0->'data'->'item'->>'quantity')::numeric=1.001 and (r->'results'->0->'data'->'item'->>'h_mo_majoration')::numeric=1.0001,'Storage-compatible numeric coercion changed');
    when 'precision-overflow' then p:=jsonb_set(p,'{0,data,quantity}','999999999.9995'); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),null,0);
    when 'reorder-exact-permutation' then
      p:=jsonb_build_array(jsonb_build_object('op','reorder','data',jsonb_build_object('parent_id',pg_temp.ba_id(401),'ordered_ids',jsonb_build_array(pg_temp.ba_id(502),pg_temp.ba_id(501)))));
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5));
      perform pg_temp.ba_assert(r->'committed'='true' and (select array_agg(id order by position)=array[pg_temp.ba_id(502),pg_temp.ba_id(501)] from public.estimate_items where parent_id=pg_temp.ba_id(401)),'Permutation failed or used conflicting positive positions');
      perform pg_temp.ba_assert((r->'results'->0->'data'->>'updated_count')::integer=2,'Reorder result count wrong');
    when 'reorder-incomplete-set' then
      p:=jsonb_build_array(jsonb_build_object('op','reorder','data',jsonb_build_object('parent_id',pg_temp.ba_id(401),'ordered_ids',jsonb_build_array(pg_temp.ba_id(501)))));
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'delete-cascade-commit' then
      p:=jsonb_build_array(jsonb_build_object('op','delete','id',pg_temp.ba_id(401)));
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>'[]',patch=>pg_temp.ba_footer(0));
      perform pg_temp.ba_assert(r->'committed'='true' and jsonb_array_length(r->'results'->0->'data'->'deleted_ids')=3,'Delete closure not reported');
      perform pg_temp.ba_actor(null,'none');
      perform pg_temp.ba_assert(not exists(select 1 from public.estimate_generated_ouvrage_applications where id=pg_temp.ba_id(903)) and not exists(select 1 from public.estimate_generated_ouvrage_work_snapshots where id=pg_temp.ba_id(904)),'Native provenance cascade missing');
      perform pg_temp.ba_assert(exists(select 1 from private.estimate_source_coverage_links where id=pg_temp.ba_id(913)),'Historical technical link incorrectly deleted');
    when 'mixed-cascade-late-rollback' then
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data','{"quantity":2}'::jsonb),jsonb_build_object('op','reorder','data',jsonb_build_object('parent_id',pg_temp.ba_id(401),'ordered_ids',jsonb_build_array(pg_temp.ba_id(502),pg_temp.ba_id(501)))),jsonb_build_object('op','delete','id',pg_temp.ba_id(401)),jsonb_build_object('op','update','id',pg_temp.ba_id(999),'data','{"quantity":2}'::jsonb));
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>''[]'',patch=>pg_temp.ba_footer(0))',p),'ESTIMATE_BATCH_NOT_FOUND',3);
    when 'technical-aba' then
      perform pg_temp.ba_actor(null,'none'); select technical_revision into tech from private.estimate_source_coverage_requirements where id=pg_temp.ba_id(912); perform pg_temp.ba_actor();
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data','{"quantity":2}'::jsonb),jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data','{"quantity":1}'::jsonb));
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5));
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'=r->'results'->1->'data'->'item','Repeated update results must be final canonical rows');
      perform pg_temp.ba_actor(null,'none'); perform pg_temp.ba_assert((select technical_revision>tech from private.estimate_source_coverage_requirements where id=pg_temp.ba_id(912)),'Committed A-B-A incorrectly removed technical invalidation');
    when 'price-does-not-invalidate' then
      perform pg_temp.ba_actor(null,'none'); select technical_revision into tech from private.estimate_source_coverage_requirements where id=pg_temp.ba_id(912); perform pg_temp.ba_actor();
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data','{"unit_price_ht_cents":6}'::jsonb));
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5));
      perform pg_temp.ba_assert(r->'committed'='true','Price edit failed'); perform pg_temp.ba_actor(null,'none');
      perform pg_temp.ba_assert((select technical_revision=tech from private.estimate_source_coverage_requirements where id=pg_temp.ba_id(912)),'Price invalidated technical coverage');
    when 'update-then-delete-result' then
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data','{"quantity":2}'::jsonb),jsonb_build_object('op','delete','id',pg_temp.ba_id(501)));
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>jsonb_build_array(pg_temp.ba_money(502,2)),patch=>pg_temp.ba_footer(2));
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'='null' and r->'results'->0->'data'->'deleted_in_batch'='true' and r->'results'->0->'data'->>'deleted_item_id'=pg_temp.ba_id(501)::text,'Deleted update result claims a persisted row or loses original identity');
    when 'create-then-parent-delete' then
      p:=p||jsonb_build_array(jsonb_build_object('op','delete','id',pg_temp.ba_id(401)));
      r:=pg_temp.ba_call(ops=>p,updates=>'[]',patch=>pg_temp.ba_footer(0));
      perform pg_temp.ba_assert(r->'committed'='true' and r->'totals'=pg_temp.ba_footer(0),'Create followed by parent deletion failed to commit final empty projection');
      perform pg_temp.ba_assert(r->'results'->0->'data'=jsonb_build_object('item',null,'deleted_in_batch',true,'deleted_item_id',pg_temp.ba_id(801)),'Deleted create lacks the truthful final result and original ID');
      perform pg_temp.ba_assert((select array_agg((x#>>'{}')::uuid order by (x#>>'{}')::uuid)=array[pg_temp.ba_id(401),pg_temp.ba_id(501),pg_temp.ba_id(502),pg_temp.ba_id(801)] from jsonb_array_elements(r->'results'->1->'data'->'deleted_ids') x),'Delete closure omitted the newly created descendant');
      perform pg_temp.ba_assert(not exists(select 1 from public.estimate_items where version_id=pg_temp.ba_id(301)) and (select total_ht_cents=0 and total_tax_cents=0 and total_ttc_cents=0 from public.estimate_versions where id=pg_temp.ba_id(301)),'Deleted create or money survived the batch');
      perform pg_temp.ba_actor(null,'none');
      perform pg_temp.ba_assert((select count(*)=1 from private.estimate_batch_receipts where version_id=pg_temp.ba_id(301)),'Cascaded create must commit exactly one receipt');
    when 'surviving-create-projection-still-required' then
      perform pg_temp.ba_refusal('select pg_temp.ba_call(updates=>pg_temp.ba_existing())','ESTIMATE_BATCH_PROJECTION_MISMATCH');
    when 'late-footer-rollback' then perform pg_temp.ba_refusal('select pg_temp.ba_call(patch=>''{"total_ht_cents":7,"total_tax_cents":0,"total_ttc_cents":1}'')');
    when 'late-audit-rollback' then perform set_config('ba.fault','audit_logs',true); perform pg_temp.ba_refusal('select pg_temp.ba_call()');
    when 'late-receipt-rollback' then perform set_config('ba.fault','estimate_batch_receipts',true); perform pg_temp.ba_refusal('select pg_temp.ba_call()');
    when 'missing-key' then perform pg_temp.ba_refusal('select pg_temp.ba_call(key_id=>null)','ESTIMATE_BATCH_OPERATION_KEY_REQUIRED');
    when 'empty-operations' then perform pg_temp.ba_refusal('select pg_temp.ba_call(ops=>''[]'',ids=>''[]'')','ESTIMATE_BATCH_INVALID_INPUT');
    when '1001-operations' then
      select jsonb_agg(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data',jsonb_build_object('quantity',1))) into p from generate_series(1,1001);
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT');
    when '1000-operations-supported' then
      select jsonb_agg(jsonb_build_object('op','reorder','data',jsonb_build_object('parent_id',pg_temp.ba_id(401),'ordered_ids',jsonb_build_array(pg_temp.ba_id(501),pg_temp.ba_id(502))))) into p from generate_series(1,1000);
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5));
      perform pg_temp.ba_assert(r->'committed'='true' and jsonb_array_length(r->'results')=1000,'Supported override was silently capped at 100');
    when 'request-over-1mib' then
      select jsonb_agg(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data',jsonb_build_object('description',repeat('x',1500)))) into p from generate_series(1,800);
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'receipt-over-2mib' then
      perform pg_temp.ba_actor(null,'none'); update public.estimate_items set description=repeat('x',6000) where id=pg_temp.ba_id(501);
      perform set_config('ba.token.v301',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(301)),true); perform pg_temp.ba_actor();
      select jsonb_agg(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data',jsonb_build_object('unit_price_ht_cents',5))) into p from generate_series(1,400);
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'projection-missing' then perform pg_temp.ba_refusal('select pg_temp.ba_call(updates=>''[]'')','ESTIMATE_BATCH_PROJECTION_MISMATCH');
    when 'projection-duplicate' then u:=u||jsonb_build_array(u->0); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(updates=>%L)',u),'ESTIMATE_BATCH_PROJECTION_MISMATCH');
    when 'projection-foreign' then u:=jsonb_set(u,'{0,id}',to_jsonb(pg_temp.ba_id(511))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(updates=>%L)',u),'ESTIMATE_BATCH_PROJECTION_MISMATCH');
    when 'projection-extra-field' then u:=jsonb_set(u,'{0,title}','"Poison"'); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(updates=>%L)',u),'ESTIMATE_BATCH_PROJECTION_MISMATCH');
    when 'v1-projection-untargeted' then perform pg_temp.ba_refusal(format('select pg_temp.ba_call(v=>302,updates=>%L)',pg_temp.ba_projection(302)||jsonb_build_array(pg_temp.ba_money(511,2))),'ESTIMATE_BATCH_PROJECTION_MISMATCH');
    when 'created-id-existing' then ids:=jsonb_set(ids,'{0,id}',to_jsonb(pg_temp.ba_id(501))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ids=>%L)',ids),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'created-id-duplicate' then perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ids=>%L)',ids||ids),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'created-index-not-create' then ids:=jsonb_set(ids,'{0,index}','1'); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ids=>%L)',ids),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'reserved-create-id' then p:=jsonb_set(p,'{0,data,id}',to_jsonb(pg_temp.ba_id(888))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'reserved-tenant' then p:=jsonb_set(p,'{0,data,tenant_id}',to_jsonb(pg_temp.ba_id(102))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'reserved-snapshot' then p:=jsonb_set(p,'{0,data,snapshot_pu_ht_cents}','4'); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT');
    when 'foreign-parent' then p:=jsonb_set(p,'{0,data,parent_id}',to_jsonb(pg_temp.ba_id(403))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'line-parent' then p:=jsonb_set(p,'{0,data,parent_id}',to_jsonb(pg_temp.ba_id(501))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'foreign-role' then p:=jsonb_set(p,'{0,data,labor_role_id}',to_jsonb(pg_temp.ba_id(602))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'wrong-tenant-role' then p:=jsonb_set(p,'{0,data,labor_role_id}',to_jsonb(pg_temp.ba_id(603))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'foreign-product' then p:=jsonb_set(p,'{0,data,product_id}',to_jsonb(pg_temp.ba_id(621))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'foreign-offer' then p:=jsonb_set(p,'{0,data,selected_supplier_price_id}',to_jsonb(pg_temp.ba_id(623))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'foreign-category' then p:=jsonb_set(p,'{0,data,category_id}',to_jsonb(pg_temp.ba_id(624))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'foreign-supply' then p:=jsonb_set(p,'{0,data,supply_type_id}',to_jsonb(pg_temp.ba_id(625))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'foreign-source-job' then p:=jsonb_set(p,'{0,data,source_job_id}',to_jsonb(pg_temp.ba_id(626))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'inherited-takeoff-update' then
      perform pg_temp.ba_actor(null,'none');
      insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by) values(pg_temp.ba_id(627),pg_temp.ba_id(101),pg_temp.ba_id(302),'A',pg_temp.ba_id(1));
      update public.estimate_items set source_job_id=pg_temp.ba_id(627),source_provider='takeoff' where id=pg_temp.ba_id(501);
      perform set_config('ba.token.v301',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(301)),true); perform pg_temp.ba_actor();
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(501),'data','{"quantity":2}'::jsonb));
      r:=pg_temp.ba_call(ops=>p,ids=>'[]',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5));
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'->>'source_job_id'=pg_temp.ba_id(627)::text,'Inherited source job was rejected or rewritten');
    when 'linked-takeoff-create' then
      perform pg_temp.ba_actor(null,'none');
      insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by) values(pg_temp.ba_id(627),pg_temp.ba_id(101),pg_temp.ba_id(302),'A',pg_temp.ba_id(1));
      insert into public.takeoff_version_links(tenant_id,takeoff_job_id,source_version_id,target_version_id,linked_by) values(pg_temp.ba_id(101),pg_temp.ba_id(627),pg_temp.ba_id(302),pg_temp.ba_id(301),pg_temp.ba_id(1));
      perform pg_temp.ba_actor(); p:=jsonb_set(p,'{0,data,source_job_id}',to_jsonb(pg_temp.ba_id(627))); r:=pg_temp.ba_call(ops=>p);
      perform pg_temp.ba_assert(r->'committed'='true' and r->'results'->0->'data'->'item'->>'source_job_id'=pg_temp.ba_id(627)::text,'Explicit inherited takeoff link not accepted');
    when 'unlinked-takeoff-create-refused' then
      perform pg_temp.ba_actor(null,'none');
      insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by) values(pg_temp.ba_id(627),pg_temp.ba_id(101),pg_temp.ba_id(302),'A',pg_temp.ba_id(1));
      perform pg_temp.ba_actor(); p:=jsonb_set(p,'{0,data,source_job_id}',to_jsonb(pg_temp.ba_id(627)));
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'section-cycle' then p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(401),'data',jsonb_build_object('parent_id',pg_temp.ba_id(401)))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'section-excess-depth' then p:=jsonb_build_array(jsonb_build_object('op','create','data',jsonb_build_object('item_type','section','parent_id',pg_temp.ba_id(401)))); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'section-move-under-descendant-refused' then
      -- The old BEFORE trigger sees T->S before the move and accepts level 3;
      -- the RPC must reject S->T before that becomes the cycle S<->T.
      perform pg_temp.ba_actor(null,'none');
      update public.estimate_versions set max_section_depth=3 where id=pg_temp.ba_id(301);
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title) values(pg_temp.ba_id(405),pg_temp.ba_id(301),pg_temp.ba_id(401),'section',3,'T descendant');
      perform set_config('ba.token.v301',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(301)),true); perform pg_temp.ba_actor();
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(401),'data',jsonb_build_object('parent_id',pg_temp.ba_id(405),'position',1)));
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'section-move-subtree-depth-refused' then
      -- S and U start at level 1, T under S at level 2. S under U is locally
      -- valid, but its retained child T would be level 3 with max depth 2.
      perform pg_temp.ba_actor(null,'none');
      update public.estimate_versions set max_section_depth=2 where id=pg_temp.ba_id(301);
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title) values
        (pg_temp.ba_id(405),pg_temp.ba_id(301),pg_temp.ba_id(401),'section',3,'T descendant'),
        (pg_temp.ba_id(406),pg_temp.ba_id(301),null,'section',2,'U root');
      perform set_config('ba.token.v301',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(301)),true); perform pg_temp.ba_actor();
      p:=jsonb_build_array(jsonb_build_object('op','update','id',pg_temp.ba_id(401),'data',jsonb_build_object('parent_id',pg_temp.ba_id(406),'position',1)));
      perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L,ids=>''[]'',updates=>pg_temp.ba_existing(),patch=>pg_temp.ba_footer(5))',p),'ESTIMATE_BATCH_INVALID_INPUT',0);
    when 'projection-over-1000-lines' then
      perform pg_temp.ba_actor(null,'none');
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature)
        select pg_temp.ba_id(2000+x),pg_temp.ba_id(301),pg_temp.ba_id(401),'line',x+2,'Pagination sentinel',0,0,0,1,0,1,0,0,0,0,'supply_only' from generate_series(1,1001)x;
      perform set_config('ba.token.v301',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(301)),true);
      select pg_temp.ba_projection()||jsonb_agg(pg_temp.ba_money(2000+x,0) order by x) into u from generate_series(1,1001)x;
      perform pg_temp.ba_actor(); r:=pg_temp.ba_call(updates=>u);
      perform pg_temp.ba_assert(r->'committed'='true' and (select count(*)=1004 from public.estimate_items where version_id=pg_temp.ba_id(301) and item_type='line'),'Full projection silently capped/truncated');
    when 'viewer' then perform pg_temp.ba_actor(null,'none'); update public.tenant_memberships set role='viewer' where tenant_id=pg_temp.ba_id(101) and user_id=pg_temp.ba_id(1); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_FORBIDDEN');
    when 'director' then perform pg_temp.ba_actor(null,'none'); update public.tenant_memberships set role='director' where tenant_id=pg_temp.ba_id(101) and user_id=pg_temp.ba_id(1); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_FORBIDDEN');
    when 'other-owner' then perform pg_temp.ba_actor(5); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_NOT_FOUND');
    when 'inactive-tenant' then perform pg_temp.ba_refusal('select pg_temp.ba_call(v=>303)','ESTIMATE_BATCH_NOT_FOUND');
    when 'anonymous' then perform pg_temp.ba_actor(null,'anon'); perform pg_temp.ba_refusal('select pg_temp.ba_call()');
    when 'service-role' then perform pg_temp.ba_actor(1,'service_role'); perform pg_temp.ba_refusal('select pg_temp.ba_call()');
    when 'missing-auth-uid' then perform pg_temp.ba_actor(null); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_FORBIDDEN');
    when 'session-null' then perform pg_temp.ba_refusal(format('select public.commit_estimate_batch(%L,%L,%L,null,%L,%L,%L,%L,%L,''null'')',pg_temp.ba_id(301),pg_temp.ba_id(1001),t,p,ids,u,pg_temp.ba_footer(),ctx),'ESTIMATE_BATCH_LOCK_REQUIRED');
    when 'session-other' then perform pg_temp.ba_refusal(format('select pg_temp.ba_call(session=>%L)',pg_temp.ba_id(702)),'ESTIMATE_BATCH_LOCK_REQUIRED');
    when 'session-expired' then perform pg_temp.ba_actor(null,'none'); update public.draft_locks set expires_at=clock_timestamp()-interval '1 second' where version_id=pg_temp.ba_id(301); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_LOCK_REQUIRED');
    when 'stale-cas' then perform pg_temp.ba_refusal('select pg_temp.ba_call(token=>''2000-01-01''::timestamptz)','ESTIMATE_BATCH_STALE');
    when 'member-revoked' then perform pg_temp.ba_actor(null,'none'); delete from public.tenant_memberships where tenant_id=pg_temp.ba_id(101) and user_id=pg_temp.ba_id(1); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_NOT_FOUND');
    when 'tenant-disabled' then perform pg_temp.ba_actor(null,'none'); update public.tenants set is_active=false where id=pg_temp.ba_id(101); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_NOT_FOUND');
    when 'project-archived' then perform pg_temp.ba_actor(null,'none'); update public.estimate_projects set is_archived=true where id=pg_temp.ba_id(201); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_FORBIDDEN');
    when 'nondraft-new-intent' then perform pg_temp.ba_actor(null,'service_role'); update public.estimate_versions set status='sent',seal_hash=repeat('a',64) where id=pg_temp.ba_id(302); perform set_config('ba.token.v302',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(302)),true); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call(v=>302)','ESTIMATE_BATCH_FORBIDDEN');
    when 'flag-absent-to-false' then perform pg_temp.ba_actor(null,'none'); insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.ba_id(101),'EST_031_LABOR_SPLIT',false); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_CONTEXT_CHANGED');
    when 'tier-phantom' then perform pg_temp.ba_actor(null,'none'); update public.estimate_versions set margin_mode='tiered' where id=pg_temp.ba_id(301); perform set_config('ba.token.v301',(select updated_at::text from public.estimate_versions where id=pg_temp.ba_id(301)),true); insert into public.margin_tiers(tenant_id,threshold_cents,multiplier,position) values(pg_temp.ba_id(101),0,1.2,0); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_CONTEXT_CHANGED');
    when 'aid-policy-phantom' then perform pg_temp.ba_actor(null,'none'); insert into public.feature_flags(tenant_id,flag_key,enabled,value) values(pg_temp.ba_id(101),'ESTIMATE_ITEM_AID_REGEX',true,'^[A-Z]+$'); perform pg_temp.ba_actor(); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_CONTEXT_CHANGED');
    when 'replay-exact-ignores-derived' then
      r:=pg_temp.ba_call(); saved:=pg_temp.ba_state();
      r2:=pg_temp.ba_call(ids=>jsonb_build_array(jsonb_build_object('index',0,'id',pg_temp.ba_id(899))),updates=>'[]',patch=>pg_temp.ba_footer(0),ctx=>'{}',session=>pg_temp.ba_id(702));
      perform pg_temp.ba_assert(r2->'replayed'='true' and (r2-array['replayed','current_version'])=(r-array['replayed','current_version']),'Replay changed immutable receipt/results or revalidated derived projection');
      perform pg_temp.ba_assert(saved=pg_temp.ba_state(),'Replay wrote data/audit/revision');
    when 'replay-different-body' then r:=pg_temp.ba_call(); p:=jsonb_set(p,'{0,data,title}','"Different"'); perform pg_temp.ba_refusal(format('select pg_temp.ba_call(ops=>%L)',p),'ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT');
    when 'replay-different-token' then r:=pg_temp.ba_call(); perform pg_temp.ba_refusal('select pg_temp.ba_call(token=>''2000-01-01''::timestamptz)','ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT');
    when 'replay-other-actor' then r:=pg_temp.ba_call(); perform pg_temp.ba_actor(2); perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT');
    when 'receipt-other-actor-null' then r:=pg_temp.ba_call(); perform pg_temp.ba_actor(2); r2:=public.get_estimate_batch_receipt(pg_temp.ba_id(301),pg_temp.ba_id(1001)); perform pg_temp.ba_assert(r2 is null,'Admin learned another actor receipt');
    when 'receipt-absent-null' then r:=public.get_estimate_batch_receipt(pg_temp.ba_id(301),pg_temp.ba_id(1999)); perform pg_temp.ba_assert(r is null,'Absent receipt not null');
    when 'replay-current-token-distinct' then
      r:=pg_temp.ba_call(); perform pg_temp.ba_actor(null,'none'); perform set_config('ba.later_token','yes',true); update public.estimate_items set title='Later mutation' where id=pg_temp.ba_id(801); perform set_config('ba.later_token','no',true); perform pg_temp.ba_actor();
      saved:=pg_temp.ba_state(); r2:=pg_temp.ba_call();
      perform pg_temp.ba_assert(r2->'version'=r->'version' and r2->'results'=r->'results' and r2->'totals'=r->'totals','Historical response was recomputed');
      perform pg_temp.ba_assert(r2->'current_version'->>'updated_at'<>r->'version'->>'updated_at','Current version was replaced by receipt token');
      perform pg_temp.ba_assert(saved=pg_temp.ba_state(),'Historical replay overwrote later edit');
    when 'replay-nondraft-expired-session' then
      r:=pg_temp.ba_call(v=>302); perform pg_temp.ba_actor(null,'service_role'); update public.estimate_versions set status='sent',seal_hash=repeat('b',64) where id=pg_temp.ba_id(302); perform pg_temp.ba_actor(null,'none'); delete from public.draft_locks where version_id=pg_temp.ba_id(302); perform pg_temp.ba_actor();
      saved:=pg_temp.ba_state(); r2:=pg_temp.ba_call(v=>302,session=>pg_temp.ba_id(702));
      perform pg_temp.ba_assert(r2->'replayed'='true' and r2->'version'=r->'version' and r2->'current_version'->>'status'='sent','Replay incorrectly requires original draft/lease');
      perform pg_temp.ba_assert(public.get_estimate_batch_receipt(pg_temp.ba_id(302),pg_temp.ba_id(1001))->'version'=r->'version' and saved=pg_temp.ba_state(),'GET receipt requires draft/lease or writes');
    when 'writer-revoked-read-receipt' then
      r:=pg_temp.ba_call(); perform pg_temp.ba_actor(null,'none'); update public.tenant_memberships set role='viewer' where tenant_id=pg_temp.ba_id(101) and user_id=pg_temp.ba_id(1); perform pg_temp.ba_actor();
      perform pg_temp.ba_assert(public.get_estimate_batch_receipt(pg_temp.ba_id(301),pg_temp.ba_id(1001))->'receipt'=r->'receipt','Read-only original actor cannot recover own receipt');
      perform pg_temp.ba_refusal('select pg_temp.ba_call()','ESTIMATE_BATCH_FORBIDDEN');
    when 'receipt-no-current-access' then
      r:=pg_temp.ba_call(); perform pg_temp.ba_actor(null,'none'); delete from public.tenant_memberships where tenant_id=pg_temp.ba_id(101) and user_id=pg_temp.ba_id(1); perform pg_temp.ba_actor();
      perform pg_temp.ba_refusal(format('select public.get_estimate_batch_receipt(%L,%L)',pg_temp.ba_id(301),pg_temp.ba_id(1001)),'ESTIMATE_BATCH_NOT_FOUND');
    when 'ledger-no-direct-dml' then
      r:=pg_temp.ba_call(); perform pg_temp.ba_refusal('delete from private.estimate_batch_receipts returning to_jsonb(estimate_batch_receipts.*)');
    when 'receipt-parent-delete' then
      r:=pg_temp.ba_call(); perform pg_temp.ba_actor(null,'none'); delete from public.estimate_versions where id=pg_temp.ba_id(301);
      perform pg_temp.ba_assert(not exists(select 1 from private.estimate_batch_receipts where version_id=pg_temp.ba_id(301)),'Receipt prevented parent deletion or escaped cascade');
    when 'receipt-version-rebind-refused' then
      r:=pg_temp.ba_call(v=>302); perform pg_temp.ba_actor(null,'none');
      perform pg_temp.ba_refusal(format('update public.estimate_versions set project_id=%L where id=%L returning to_jsonb(estimate_versions.*)',pg_temp.ba_id(203),pg_temp.ba_id(302)));
    when 'receipt-project-rebind-refused' then
      r:=pg_temp.ba_call(); perform pg_temp.ba_actor(null,'none');
      perform pg_temp.ba_refusal(format('update public.estimate_projects set tenant_id=%L where id=%L returning to_jsonb(estimate_projects.*)',pg_temp.ba_id(102),pg_temp.ba_id(201)));
    when 'acl-definer-boundary' then
      -- Resolve private object names as the test observer; the checked role
      -- remains authenticated/service_role, not this observer's privileges.
      perform pg_temp.ba_actor(null,'none');
      foreach signature in array array['public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','public.get_estimate_batch_receipt(uuid,uuid)'] loop
        perform pg_temp.ba_assert(has_function_privilege('authenticated',signature,'EXECUTE') and not has_function_privilege('anon',signature,'EXECUTE') and not has_function_privilege('service_role',signature,'EXECUTE'),'RPC execution broadened');
        perform pg_temp.ba_assert((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid=signature::regprocedure),'RPC definer/search_path not explicit');
      end loop;
      perform pg_temp.ba_assert(not has_schema_privilege('authenticated','private','USAGE'),'Private schema USAGE broadened');
      perform pg_temp.ba_assert(not has_table_privilege('authenticated','private.estimate_batch_receipts','INSERT,UPDATE,DELETE') and not has_table_privilege('service_role','private.estimate_batch_receipts','INSERT,UPDATE,DELETE'),'Ledger DML broadened');
    else raise exception 'Unknown batch test case %',name;
    end case;
  end $f$;
  $helpers$;

  -- Session-local probe helpers need explicit access after SET ROLE anon.
  -- The mandatory abort rolls back these grants; product RPC ACLs stay closed.
  grant execute on all functions in schema pg_temp to anon;
  foreach case_name in array array[
    'wfc01-late-operation-rollback','wfc01-success-v2','v1-untargeted-line-unchanged','v1-targeted-projection','section-default-v2','incomplete-labor-v1','incomplete-labor-v2','precision-storage-coercion','precision-overflow',
    'reorder-exact-permutation','reorder-incomplete-set','delete-cascade-commit','mixed-cascade-late-rollback','technical-aba','price-does-not-invalidate','update-then-delete-result','create-then-parent-delete','surviving-create-projection-still-required','late-footer-rollback','late-audit-rollback','late-receipt-rollback',
    'missing-key','empty-operations','1001-operations','1000-operations-supported','request-over-1mib','receipt-over-2mib','projection-missing','projection-duplicate','projection-foreign','projection-extra-field','v1-projection-untargeted',
    'created-id-existing','created-id-duplicate','created-index-not-create','reserved-create-id','reserved-tenant','reserved-snapshot','foreign-parent','line-parent','foreign-role','wrong-tenant-role','foreign-product','foreign-offer','foreign-category','foreign-supply','foreign-source-job','inherited-takeoff-update','linked-takeoff-create','unlinked-takeoff-create-refused','section-cycle','section-excess-depth','section-move-under-descendant-refused','section-move-subtree-depth-refused','projection-over-1000-lines',
    'viewer','director','other-owner','inactive-tenant','anonymous','service-role','missing-auth-uid','session-null','session-other','session-expired','stale-cas','member-revoked','tenant-disabled','project-archived','nondraft-new-intent',
    'flag-absent-to-false','tier-phantom','aid-policy-phantom','replay-exact-ignores-derived','replay-different-body','replay-different-token','replay-other-actor','receipt-other-actor-null','receipt-absent-null','replay-current-token-distinct','replay-nondraft-expired-session','writer-revoked-read-receipt','receipt-no-current-access','ledger-no-direct-dml','receipt-parent-delete','receipt-version-rebind-refused','receipt-project-rebind-refused','acl-definer-boundary'
  ] loop
    passed:=false; failure:=null;
    begin
      perform pg_temp.ba_case(case_name);
      raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true;
      when others then failure:=sqlstate||': '||sqlerrm;
    end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='ESTIMATE_BATCH_ATOMIC_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','bfc10000','concurrencyExecuted',false,'cases',results)::text;
end;
$batch_atomic_probe$;
