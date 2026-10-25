-- WFC02: native assertions written BEFORE generated-ouvrage product SQL.
-- One forcibly aborted DO, new synthetic UUIDs, no existing fixture reused.
-- Authorization/direct DML, late failure, raw material and immutable receipts
-- cannot be established by the browser alone. Money is an explicit oracle,
-- not a SQL reimplementation of the TypeScript calculator. No real race here.
do $generated_atomic_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure text;
begin
  if exists(select 1 from auth.users where id::text like 'cfc20000-%') then raise exception 'Generated fixture already exists'; end if;
  execute $helpers$
  create function pg_temp.ga_id(n integer) returns uuid language sql immutable as $f$
    select ('cfc20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  $f$;
  create function pg_temp.ga_assert(ok boolean,detail text) returns void language plpgsql as $f$
  begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
  create function pg_temp.ga_actor(n integer default 1,db_role text default 'authenticated') returns void language plpgsql as $f$
  begin
    perform set_config('role','none',true);
    perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.ga_id(n)::text end,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.ga_id(n) end,'role',db_role)::text,true);
    perform set_config('role',db_role,true);
  end $f$;
  $helpers$;
  insert into auth.users(id,email,raw_user_meta_data)
    select pg_temp.ga_id(n),'generated-atomic-'||n||'@example.invalid',jsonb_build_object('full_name','Generated actor '||n) from generate_series(1,5)n;
  update public.tenant_memberships set is_default=false where user_id::text like 'cfc20000-%';
  insert into public.tenants(id,name,slug) values(pg_temp.ga_id(101),'ARMY generated T1','generated-atomic-native-t1'),(pg_temp.ga_id(102),'ARMY generated T2','generated-atomic-native-t2');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    select pg_temp.ga_id(101),pg_temp.ga_id(n),(case n when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(1,5)n;
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values(pg_temp.ga_id(102),pg_temp.ga_id(1),'admin',false,'2021-01-01');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values
    (pg_temp.ga_id(201),pg_temp.ga_id(101),pg_temp.ga_id(1),'ARMY atomic generated'),
    (pg_temp.ga_id(202),pg_temp.ga_id(102),pg_temp.ga_id(1),'ARMY inactive generated tenant'),
    (pg_temp.ga_id(203),pg_temp.ga_id(101),pg_temp.ga_id(5),'ARMY other generated owner');
  insert into public.estimate_versions(id,project_id,version_number,calc_engine_version,max_section_depth,margin_mode,margin_multiplier,tax_rate_bp,discount_bp,total_ht_cents,total_tax_cents,total_ttc_cents)
    values(pg_temp.ga_id(301),pg_temp.ga_id(201),1,2,1,'fixed',1,0,1667,5,0,5),
          (pg_temp.ga_id(302),pg_temp.ga_id(201),2,1,1,'fixed',1,0,1667,5,0,5),
          (pg_temp.ga_id(303),pg_temp.ga_id(202),1,2,1,'fixed',1,0,0,0,0,0),
          (pg_temp.ga_id(304),pg_temp.ga_id(203),1,2,1,'fixed',1,0,0,0,0,0);
  insert into public.estimate_items(id,version_id,item_type,position,title) select pg_temp.ga_id(n+100),pg_temp.ga_id(n),'section',1,'CVC' from generate_series(301,304)n;
  insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature)
    values(pg_temp.ga_id(501),pg_temp.ga_id(301),pg_temp.ga_id(401),'line',1,'A','m',1,3,2000,1,0,1,2,2,0,2,'supply_only'),
          (pg_temp.ga_id(502),pg_temp.ga_id(301),pg_temp.ga_id(401),'line',2,'B','m',1,3,0,1,0,1,3,3,0,3,'supply_only');
  insert into public.draft_locks(version_id,user_id,session_id,expires_at) select pg_temp.ga_id(n),pg_temp.ga_id(1),pg_temp.ga_id(701),clock_timestamp()+interval '1 hour' from generate_series(301,304)n;
  delete from public.feature_flags where tenant_id=pg_temp.ga_id(101) and flag_key='EST_031_LABOR_SPLIT';
  delete from public.margin_tiers where tenant_id=pg_temp.ga_id(101);
  insert into public.estimate_generated_ouvrage_drafts(id,tenant_id,project_id,target_version_id,created_by,source_kind,status,summary)
    values(pg_temp.ga_id(901),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(1),'free_text','pending','{"totalCandidates":1,"pendingCount":1}'),
          (pg_temp.ga_id(902),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(302),pg_temp.ga_id(1),'free_text','pending','{}');
  insert into public.estimate_generated_ouvrage_candidates(id,tenant_id,project_id,target_version_id,draft_id,candidate_order,designation,normalized_designation,unit,quantity,confidence,ai_status,resolution_status)
    values(pg_temp.ga_id(911),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(901),0,'C','c','m',1,1,'certain','pending'),
          (pg_temp.ga_id(912),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(302),pg_temp.ga_id(902),0,'D','d','m',1,1,'certain','pending');
  insert into public.estimate_generated_ouvrage_source_fragments(id,tenant_id,project_id,draft_id,fragment_order,source_kind,label,excerpt,normalized_excerpt)
    values(pg_temp.ga_id(921),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),0,'free_text','Source C','Fourniture C trois centimes','fourniture c trois centimes'),
          (pg_temp.ga_id(922),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),1,'internal_note','Composant seulement','Preuve liee au composant','preuve liee au composant'),
          (pg_temp.ga_id(923),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(902),0,'free_text','Foreign draft','Ne pas utiliser','ne pas utiliser');
  insert into public.estimate_generated_ouvrage_candidate_sources(id,tenant_id,draft_id,candidate_id,source_fragment_id,source_rank,rationale)
    values(pg_temp.ga_id(931),pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(921),0,'Preuve candidat');
  insert into public.estimate_generated_ouvrage_subdetail_drafts(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,created_by,status,summary,generation_metadata)
    values(pg_temp.ga_id(941),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(1),'reviewed',
      '{"component_count":1,"ds_cents":3,"indicative_target_price_cents":3,"confidence":1,"pricing_source":"manual","risk_signals":[],"facts":[],"hypotheses":[],"inferences":[],"margin_multiplier":1}',
      jsonb_build_object('reviewed_candidate',jsonb_build_object('designation','C','unit','m','quantity',1)));
  insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,source_fragment_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,confidence)
    values(pg_temp.ga_id(951),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(922),0,'manual','material','FO C','m',1,3,1);
  insert into public.estimate_generated_ouvrage_subdetail_item_sources(id,tenant_id,draft_id,subdetail_id,parent_work_id,component_id,source_fragment_id,source_rank,evidence_kind,note)
    values(pg_temp.ga_id(961),pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(951),pg_temp.ga_id(922),0,'fact','Composant uniquement');
  execute $helpers$
  create function pg_temp.ga_state() returns jsonb language plpgsql security definer set search_path='' as $f$
  declare t record; rows_value jsonb; result jsonb:='{}';
  begin
    for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private') order by n.nspname,c.relname loop
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%cfc20000-%%''',t.nspname,t.relname) into rows_value;
      if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
    end loop; return result;
  end $f$;
  create function pg_temp.ga_read() returns jsonb language sql as $f$ select public.read_generated_ouvrage_review(pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(911)) $f$;
  create function pg_temp.ga_money(id integer,amount integer) returns jsonb language sql as $f$ select jsonb_build_object('id',pg_temp.ga_id(id),'pu_ht_cents',amount,'line_total_ht_cents',amount,'line_tax_cents',0,'line_total_ttc_cents',amount) $f$;
  create function pg_temp.ga_updates() returns jsonb language sql as $f$ select jsonb_build_array(pg_temp.ga_money(501,2),pg_temp.ga_money(502,2),pg_temp.ga_money(801,3)) $f$;
  create function pg_temp.ga_footer() returns jsonb language sql as $f$ select '{"total_ht_cents":7,"total_tax_cents":0,"total_ttc_cents":7}'::jsonb $f$;
  create function pg_temp.ga_context() returns jsonb language sql as $f$ select '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb $f$;
  create function pg_temp.ga_accepted() returns jsonb language sql as $f$
    select jsonb_build_array(jsonb_build_object('candidateId',pg_temp.ga_id(911),'designation','C','unit','m','quantity',1,'lotId',pg_temp.ga_id(401),'reviewToken',current_setting('ga.review',true)))
  $f$;
  create function pg_temp.ga_prepared() returns jsonb language sql as $f$
    select jsonb_build_array(jsonb_build_object('candidateId',pg_temp.ga_id(911),'subdetailId',pg_temp.ga_id(941),'estimateItemId',pg_temp.ga_id(801),'assemblyId',pg_temp.ga_id(802),'applicationId',pg_temp.ga_id(803),'snapshotId',pg_temp.ga_id(804),'resolvedLotId',pg_temp.ga_id(401),'placementMode','explicit',
      'estimateItemMapping',jsonb_build_object('source','generated_ouvrage_subdetail_review','mode','no_labor','unitPriceHtCents',3,'hMo',0,'kFo',1,'kMo',1,'laborRoleId',null,'laborRoleName',null,'laborRoleHourlyRateCents',null,'totalDsCents',3,'nonLaborDsCents',3,'laborDsCents',0,'costBreakdown',jsonb_build_array(jsonb_build_object('costType','material','componentCount',1,'quantity',1,'dsCents',3)),'laborTrace','[]'::jsonb),
      'componentProjections',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'kFo',1,'kMo',0,'hMo',0,'dsCents',3)),
      'item',jsonb_build_object('item_type','line','parent_id',pg_temp.ga_id(401),'title','C','description','m','quantity',1,'unit_price_ht_cents',3,'k_fo',1,'h_mo',0,'k_mo',1,'labor_role_id',null,'source_provider','generated_ouvrage','source_file_name',null,'source_page',null)))
  $f$;
  create function pg_temp.ga_call(a jsonb default null,p jsonb default null,fallback jsonb default 'null',u jsonb default null,footer jsonb default null,ctx jsonb default null,preferred jsonb default 'null',session uuid default null,token timestamptz default null,key_id integer default 1001) returns jsonb language sql as $f$
    select public.commit_generated_ouvrages(pg_temp.ga_id(301),pg_temp.ga_id(901),case when key_id is null then null else pg_temp.ga_id(key_id) end,coalesce(token,current_setting('ga.token',true)::timestamptz),coalesce(session,pg_temp.ga_id(701)),coalesce(a,pg_temp.ga_accepted()),coalesce(p,pg_temp.ga_prepared()),fallback,coalesce(u,pg_temp.ga_updates()),coalesce(footer,pg_temp.ga_footer()),coalesce(ctx,pg_temp.ga_context()),preferred)
  $f$;
  create function pg_temp.ga_review_input() returns jsonb language sql as $f$
    select jsonb_build_object('status','reviewed','summary',(pg_temp.ga_read()->'subdetailDraft'->'summary'),'generation_metadata',jsonb_build_object('reviewed_candidate',jsonb_build_object('designation','C','unit','m','quantity',1)),
      'components',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'status','manual','costType','material','designation','FO C','unit','m','quantity',1,'unitCostHtCents',3,'lossCoeffBp',0,'yieldValue',null,'yieldUnit',null,'confidence',1,'sourceLabel',null,'facts','[]'::jsonb,'hypotheses','[]'::jsonb,'inferences','[]'::jsonb,'riskSignals','[]'::jsonb,'sources',jsonb_build_array(jsonb_build_object('sourceFragmentId',pg_temp.ga_id(922),'evidenceKind','fact','note','Composant uniquement')))))
  $f$;
  create function pg_temp.ga_save(body jsonb default null,token text default null) returns jsonb language sql as $f$
    select public.persist_generated_ouvrage_review(pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(701),coalesce(token,current_setting('ga.review',true)),coalesce(body,pg_temp.ga_review_input()))
  $f$;
  create function pg_temp.ga_reject() returns jsonb language sql as $f$
    select public.reject_generated_ouvrage_candidate(pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(701),'Hors besoin')
  $f$;
  create function pg_temp.ga_abandon(a jsonb default null) returns jsonb language sql as $f$
    select public.abandon_generated_ouvrage_application(pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(1001),current_setting('ga.token',true)::timestamptz,coalesce(a,pg_temp.ga_accepted()))
  $f$;
  create function pg_temp.ga_generation() returns void language plpgsql as $f$
  begin
    perform pg_temp.ga_actor(null,'none');
    update public.estimate_generated_ouvrage_drafts set created_at='2000-01-01' where id=pg_temp.ga_id(901);
    insert into public.estimate_generated_ouvrage_drafts(id,tenant_id,project_id,target_version_id,created_by,source_kind,status,created_at)
      values(pg_temp.ga_id(903),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(1),'free_text','pending','2020-01-01'),
            (pg_temp.ga_id(904),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(2),'free_text','pending','2000-01-01'),
            (pg_temp.ga_id(905),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(1),'free_text','partially_applied','2000-01-01'),
            (pg_temp.ga_id(906),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(1),'free_text','applied','2000-01-01');
    insert into public.estimate_generated_ouvrage_candidates(id,tenant_id,project_id,target_version_id,draft_id,candidate_order,designation,normalized_designation,unit,quantity,confidence,ai_status)
      values(pg_temp.ga_id(913),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(903),0,'New generation','new generation','m',1,1,'certain');
    insert into public.estimate_generated_ouvrage_source_fragments(id,tenant_id,project_id,draft_id,fragment_order,source_kind,label,excerpt,normalized_excerpt)
      values(pg_temp.ga_id(924),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(903),0,'free_text','New source','New source','new source');
    insert into public.estimate_generated_ouvrage_candidate_sources(id,tenant_id,draft_id,candidate_id,source_fragment_id,source_rank)
      values(pg_temp.ga_id(934),pg_temp.ga_id(101),pg_temp.ga_id(903),pg_temp.ga_id(913),pg_temp.ga_id(924),0);
    perform pg_temp.ga_actor();
  end $f$;
  create function pg_temp.ga_close(mode text default 'complete',draft integer default 903,session uuid default null) returns jsonb language sql as $f$
    select public.close_generated_ouvrage_generation(pg_temp.ga_id(301),pg_temp.ga_id(draft),coalesce(session,pg_temp.ga_id(701)),mode)
  $f$;
  create temporary sequence ga_fault_hits;
  create function pg_temp.ga_fault_count() returns bigint language sql security definer set search_path='' as $f$
    select case when is_called then last_value else 0 end from pg_temp.ga_fault_hits
  $f$;
  create function pg_temp.ga_refusal(command text,expected text default null) returns void language plpgsql as $f$
  declare before_state jsonb:=pg_temp.ga_state(); state text; message text; response jsonb; hits_before bigint; hits_after bigint;
  begin
    hits_before:=pg_temp.ga_fault_count();
    begin execute command into response; exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text; end;
    perform pg_temp.ga_assert(state=any(array['42501','P0002','55000','40001','23514','22023','23505']),format('Expected business refusal, got %s/%s',state,message));
    perform pg_temp.ga_assert(expected is null or message=expected,format('Expected %s, got %s/%s',expected,state,message));
    perform pg_temp.ga_assert(before_state=pg_temp.ga_state(),'Refusal changed financial, review, library, provenance, event or receipt rows');
    if coalesce(current_setting('ga.fault',true),'')<>'' then
      hits_after:=pg_temp.ga_fault_count();
      perform pg_temp.ga_assert(hits_after=hits_before+1,'Target late fault was not reached exactly once');
    end if;
  end $f$;
  create function pg_temp.ga_fault() returns trigger language plpgsql as $f$
  begin
    if current_setting('ga.fault',true)=tg_table_name and to_jsonb(new)::text like '%cfc20000-%' and
      (tg_table_name<>'estimate_generated_ouvrage_subdetail_drafts' or to_jsonb(new)->>'status'='applied') then
      perform nextval('pg_temp.ga_fault_hits');
      raise exception using errcode='23514',message='GENERATED_NATIVE_LATE_FAULT';
    end if; return new;
  end $f$;
  create trigger zzzz_ga_test before insert on public.estimate_generated_ouvrage_applications for each row execute function pg_temp.ga_fault();
  create trigger zzzz_ga_test before insert on public.estimate_generated_ouvrage_work_snapshots for each row execute function pg_temp.ga_fault();
  create trigger zzzz_ga_test before update on public.estimate_generated_ouvrage_drafts for each row execute function pg_temp.ga_fault();
  create trigger zzzz_ga_test before update on public.estimate_generated_ouvrage_subdetail_drafts for each row execute function pg_temp.ga_fault();
  create trigger zzzz_ga_test before insert on public.estimate_generated_ouvrage_subdetail_item_sources for each row execute function pg_temp.ga_fault();
  create trigger zzzz_ga_test before update on public.estimate_generated_ouvrage_source_fragments for each row execute function pg_temp.ga_fault();
  create trigger zzzz_ga_test before insert on private.generated_ouvrage_application_receipts for each row execute function pg_temp.ga_fault();
  create function pg_temp.ga_case(name text) returns void language plpgsql as $f$
  declare r jsonb; r2 jsonb; a jsonb; p jsonb; u jsonb; b jsonb; saved jsonb; table_name text; signature text; n integer;
  begin
    perform pg_temp.ga_actor(null,'none');
    perform set_config('ga.token',(select updated_at::text from public.estimate_versions where id=pg_temp.ga_id(301)),true);
    perform set_config('ga.fault','',true);
    perform pg_temp.ga_actor(); perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true);
    a:=pg_temp.ga_accepted(); p:=pg_temp.ga_prepared(); u:=pg_temp.ga_updates(); b:=pg_temp.ga_review_input();
    case name
    when 'read-material-union' then
      r:=pg_temp.ga_read(); perform pg_temp.ga_assert(r->>'reviewToken'~'^[0-9a-f]{64}$' and jsonb_array_length(r->'fragments')=2 and jsonb_array_length(r->'itemSources')=1 and jsonb_array_length(r->'candidateSources')=1,'Review does not cover source union');
      perform pg_temp.ga_assert(r->'draft'->>'created_by'=pg_temp.ga_id(1)::text,'Creator identity missing from snapshot');
    when 'read-absent-token-null' then
      r:=public.read_generated_ouvrage_review(pg_temp.ga_id(302),pg_temp.ga_id(902),pg_temp.ga_id(912));
      perform pg_temp.ga_assert(r->'subdetailDraft'='null' and r->'reviewToken'='null' and r->'items'='[]','Missing subdetail must be explicit');
    when 'finalize-existing' then
      r:=pg_temp.ga_call(); perform pg_temp.ga_assert(r->'ok'='true' and r->'replayed'='false' and r->>'draftStatus'='applied','Finalization response not complete');
      perform pg_temp.ga_assert((select array_agg(line_total_ht_cents order by position)=array[2,2,3] from public.estimate_items where version_id=pg_temp.ga_id(301) and item_type='line'),'Full V2 allocation missing');
      perform pg_temp.ga_assert((select total_ht_cents=7 from public.estimate_versions where id=pg_temp.ga_id(301)),'Header not committed');
      perform pg_temp.ga_assert((select status='applied' from public.estimate_generated_ouvrage_subdetail_drafts where id=pg_temp.ga_id(941)),'Subdetail not finalized');
      perform pg_temp.ga_assert((select count(*)=1 from public.estimate_generated_ouvrage_applications where draft_id=pg_temp.ga_id(901)) and (select count(*)=1 from public.estimate_generated_ouvrage_work_snapshots where draft_id=pg_temp.ga_id(901)),'Provenance not atomic');
      perform pg_temp.ga_actor(null,'none'); perform pg_temp.ga_assert((select count(*)=1 from private.generated_ouvrage_application_receipts where version_id=pg_temp.ga_id(301)),'Unique receipt missing');
    when 'prepared-defaults-match-batch' then
      r:=pg_temp.ga_call();
      perform pg_temp.ga_assert((select tax_rate_bp=0 and position=3 and h_mo_majoration=1 and line_nature='supply_only' and h_mo_atelier is null and k_mo_atelier is null and labor_role_atelier_id is null and h_mo_chantier is null and k_mo_chantier is null and labor_role_chantier_id is null from public.estimate_items where id=pg_temp.ga_id(801)),'Stored defaults differ from prospective batch');
    when 'finalize-fallback' then
      a:=jsonb_set(a,'{0,lotId}','null'); p:=jsonb_set(jsonb_set(jsonb_set(p,'{0,resolvedLotId}',to_jsonb(pg_temp.ga_id(805))),'{0,placementMode}','"fallback_unclassified"'),'{0,item,parent_id}',to_jsonb(pg_temp.ga_id(805)));
      r:=pg_temp.ga_call(a=>a,p=>p,fallback=>jsonb_build_object('id',pg_temp.ga_id(805),'created',true));
      perform pg_temp.ga_assert((select title='À classer' and item_type='section' from public.estimate_items where id=pg_temp.ga_id(805)) and (select parent_id=pg_temp.ga_id(805) from public.estimate_items where id=pg_temp.ga_id(801)),'Fallback not in same finalization');
    when 'partial-preserves-other-review-token' then
      perform pg_temp.ga_actor(null,'none');
      insert into public.estimate_generated_ouvrage_candidates(id,tenant_id,project_id,target_version_id,draft_id,candidate_order,designation,normalized_designation,unit,quantity,confidence,ai_status)
        values(pg_temp.ga_id(913),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(301),pg_temp.ga_id(901),1,'Unselected','unselected','m',1,1,'certain');
      insert into public.estimate_generated_ouvrage_subdetail_drafts(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,created_by,status,summary,generation_metadata)
        select pg_temp.ga_id(942),tenant_id,project_id,target_version_id,draft_id,pg_temp.ga_id(913),created_by,status,summary,generation_metadata from public.estimate_generated_ouvrage_subdetail_drafts where id=pg_temp.ga_id(941);
      insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,confidence)
        values(pg_temp.ga_id(952),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(942),pg_temp.ga_id(913),0,'manual','material','Other FO','m',1,3,1);
      perform pg_temp.ga_actor();
      saved:=public.read_generated_ouvrage_review(pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(913));
      perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true);
      r:=pg_temp.ga_call(); r2:=public.read_generated_ouvrage_review(pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(913));
      perform pg_temp.ga_assert(r->>'draftStatus'='partially_applied' and r2->>'reviewToken'=saved->>'reviewToken','Applying A invalidates unchanged B review');
    when 'token-unrelated-fragment-unchanged' then
      saved:=pg_temp.ga_read(); perform pg_temp.ga_actor(null,'none');
      insert into public.estimate_generated_ouvrage_source_fragments(id,tenant_id,project_id,draft_id,fragment_order,source_kind,label,excerpt,normalized_excerpt)
        values(pg_temp.ga_id(924),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),2,'free_text','Unlinked','Unlinked source','unlinked source');
      perform pg_temp.ga_actor(); perform pg_temp.ga_assert(pg_temp.ga_read()->>'reviewToken'=saved->>'reviewToken','Unrelated fragment invalidates review');
    when 'late-application','late-snapshot','late-draft','late-subdetail','late-receipt' then
      table_name:=case name when 'late-application' then 'estimate_generated_ouvrage_applications' when 'late-snapshot' then 'estimate_generated_ouvrage_work_snapshots' when 'late-draft' then 'estimate_generated_ouvrage_drafts' when 'late-subdetail' then 'estimate_generated_ouvrage_subdetail_drafts' else 'generated_ouvrage_application_receipts' end;
      perform set_config('ga.fault',table_name,true); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'fallback-wrong-title' then
      a:=jsonb_set(a,'{0,lotId}','null'); p:=jsonb_set(p,'{0,placementMode}','"fallback_unclassified"');
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L,p=>%L,fallback=>%L)',a,p,jsonb_build_object('id',pg_temp.ga_id(401),'created',false)));
    when 'fallback-ascii-existing' then
      perform pg_temp.ga_actor(null,'none'); update public.estimate_items set title='A classer' where id=pg_temp.ga_id(401); perform pg_temp.ga_actor();
      perform set_config('ga.token',(select updated_at::text from public.estimate_versions where id=pg_temp.ga_id(301)),true);
      a:=jsonb_set(a,'{0,lotId}','null'); p:=jsonb_set(p,'{0,placementMode}','"fallback_unclassified"');
      r:=pg_temp.ga_call(a=>a,p=>p,fallback=>jsonb_build_object('id',pg_temp.ga_id(401),'created',false));
      perform pg_temp.ga_assert((select count(*)=1 from public.estimate_items where version_id=pg_temp.ga_id(301) and item_type='section'),'Compatible fallback duplicated');
    when 'component-cost-redistribution','component-coefficient-forgery' then
      perform pg_temp.ga_actor(null,'none');
      insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,confidence)
        values(pg_temp.ga_id(952),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),1,'manual','material','FO seven','m',1,7,1);
      update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"component_count":2,"ds_cents":10,"indicative_target_price_cents":10}' where id=pg_temp.ga_id(941);
      perform pg_temp.ga_actor(); perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true); a:=pg_temp.ga_accepted();
      p:=jsonb_set(p,'{0,estimateItemMapping}',p->0->'estimateItemMapping'||jsonb_build_object('unitPriceHtCents',10,'totalDsCents',10,'nonLaborDsCents',10,'costBreakdown',jsonb_build_array(jsonb_build_object('costType','material','componentCount',2,'quantity',2,'dsCents',10))));
      p:=jsonb_set(p,'{0,item,unit_price_ht_cents}','10');
      p:=jsonb_set(p,'{0,componentProjections}',jsonb_build_array(
        jsonb_build_object('componentId',pg_temp.ga_id(951),'kFo',case when name='component-coefficient-forgery' then 2 else 1 end,'kMo',0,'hMo',0,'dsCents',case when name='component-coefficient-forgery' then 6 else 5 end),
        jsonb_build_object('componentId',pg_temp.ga_id(952),'kFo',case when name='component-coefficient-forgery' then 0.571 else 1 end,'kMo',0,'hMo',0,'dsCents',case when name='component-coefficient-forgery' then 4 else 5 end)));
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L,p=>%L)',a,p));
    when 'parent-cost-forgery' then
      p:=jsonb_set(jsonb_set(p,'{0,estimateItemMapping,unitPriceHtCents}','6'),'{0,item,unit_price_ht_cents}','6');
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'parent-majoration-forgery' then
      p:=jsonb_set(p,'{0,item,h_mo_majoration}','2'); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'labor-trace-duplicate','labor-hours-forgery' then
      perform pg_temp.ga_actor(null,'none');
      insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents,is_active,position) values(pg_temp.ga_id(601),pg_temp.ga_id(101),pg_temp.ga_id(1),'Pose',5,true,1);
      update public.estimate_generated_ouvrage_subdetail_items set cost_type='labor',unit='h' where id=pg_temp.ga_id(951);
      insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,confidence)
        values(pg_temp.ga_id(952),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),1,'manual','labor','MO seven','h',1,7,1);
      update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"component_count":2,"ds_cents":10,"indicative_target_price_cents":10}' where id=pg_temp.ga_id(941);
      perform pg_temp.ga_actor(); perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true); a:=pg_temp.ga_accepted();
      p:=jsonb_set(p,'{0,estimateItemMapping}',p->0->'estimateItemMapping'||jsonb_build_object('mode','legacy_labor_allocated','unitPriceHtCents',10,'hMo',2,'kFo',0,'kMo',1,'laborRoleId',pg_temp.ga_id(601),'laborRoleName','Pose','laborRoleHourlyRateCents',5,'totalDsCents',10,'nonLaborDsCents',0,'laborDsCents',10,
        'costBreakdown',jsonb_build_array(jsonb_build_object('costType','labor','componentCount',2,'quantity',2,'dsCents',10)),
        'laborTrace',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'designation','FO C','unit','h','quantity',1,'derivedHours',1,'hoursSource','quantity','dsCents',3),
          jsonb_build_object('componentId',case when name='labor-trace-duplicate' then pg_temp.ga_id(951) else pg_temp.ga_id(952) end,'designation',case when name='labor-trace-duplicate' then 'FO C' else 'MO seven' end,'unit','h','quantity',1,'derivedHours',1,'hoursSource','quantity','dsCents',case when name='labor-trace-duplicate' then 3 else 7 end))));
      p:=jsonb_set(p,'{0,item}',p->0->'item'||jsonb_build_object('unit_price_ht_cents',10,'h_mo',2,'k_fo',0,'k_mo',1,'labor_role_id',pg_temp.ga_id(601)));
      p:=jsonb_set(p,'{0,componentProjections}',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'kFo',0,'kMo',1,'hMo',1,'dsCents',3),jsonb_build_object('componentId',pg_temp.ga_id(952),'kFo',0,'kMo',1,'hMo',1,'dsCents',7)));
      if name='labor-hours-forgery' then
        p:=jsonb_set(jsonb_set(p,'{0,componentProjections,0,hMo}','2'),'{0,componentProjections,0,kMo}','0.5');
        p:=jsonb_set(jsonb_set(jsonb_set(p,'{0,estimateItemMapping,hMo}','3'),'{0,estimateItemMapping,kMo}','0.667'),'{0,estimateItemMapping,laborTrace,0,derivedHours}','2');
        p:=jsonb_set(jsonb_set(p,'{0,item,h_mo}','3'),'{0,item,k_mo}','0.667');
      end if;
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L,p=>%L,preferred=>%L,ctx=>%L)',a,p,jsonb_build_object('id',pg_temp.ga_id(601),'name','Pose','hourly_rate_cents',5,'position',1,'is_active',true),jsonb_build_object('labor_roles',jsonb_build_array(jsonb_build_object('id',pg_temp.ga_id(601),'tenant_id',pg_temp.ga_id(101),'user_id',pg_temp.ga_id(1),'hourly_rate_cents',5)),'margin_tiers','[]'::jsonb,'labor_split_flag',null)));
    when 'decimal-yield-hours' then
      -- Exact JSON decimals 1.005 * .1 -> .101 hours, not binary toFixed .100.
      -- Native success checks representation only; the TS pre-code case owns
      -- parity of the real calculator, not these supplied footer values.
      perform pg_temp.ga_actor(null,'none');
      insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents,is_active,position) values(pg_temp.ga_id(601),pg_temp.ga_id(101),pg_temp.ga_id(1),'Pose',1000,true,1);
      update public.estimate_generated_ouvrage_subdetail_items set status='suggested',cost_type='labor',unit='m',unit_cost_ht_cents=1000,yield_value=.1,yield_unit='h/m' where id=pg_temp.ga_id(951);
      update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"ds_cents":1000,"indicative_target_price_cents":1000}',generation_metadata=jsonb_set(generation_metadata,'{reviewed_candidate,quantity}','1.005') where id=pg_temp.ga_id(941);
      perform pg_temp.ga_actor(); perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true); a:=jsonb_set(pg_temp.ga_accepted(),'{0,quantity}','1.005');
      p:=jsonb_set(p,'{0,estimateItemMapping}',p->0->'estimateItemMapping'||jsonb_build_object('mode','legacy_labor_allocated','unitPriceHtCents',995,'hMo',.101,'kFo',0,'kMo',9.901,'laborRoleId',pg_temp.ga_id(601),'laborRoleName','Pose','laborRoleHourlyRateCents',1000,'totalDsCents',1000,'nonLaborDsCents',0,'laborDsCents',1000,
        'costBreakdown',jsonb_build_array(jsonb_build_object('costType','labor','componentCount',1,'quantity',1,'dsCents',1000)),
        'laborTrace',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'designation','FO C','unit','m','quantity',1,'derivedHours',.101,'hoursSource','yield','dsCents',1000))));
      p:=jsonb_set(p,'{0,item}',p->0->'item'||jsonb_build_object('quantity',1.005,'unit_price_ht_cents',995,'h_mo',.101,'k_fo',0,'k_mo',9.901,'labor_role_id',pg_temp.ga_id(601)));
      p:=jsonb_set(p,'{0,componentProjections}',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'kFo',0,'kMo',9.901,'hMo',.101,'dsCents',1000)));
      r:=pg_temp.ga_call(a=>a,p=>p,u=>jsonb_build_array(pg_temp.ga_money(501,2),pg_temp.ga_money(502,3),pg_temp.ga_money(801,833)),footer=>'{"total_ht_cents":838,"total_tax_cents":0,"total_ttc_cents":838}',
        preferred=>jsonb_build_object('id',pg_temp.ga_id(601),'name','Pose','hourly_rate_cents',1000,'position',1,'is_active',true),
        ctx=>jsonb_build_object('labor_roles',jsonb_build_array(jsonb_build_object('id',pg_temp.ga_id(601),'tenant_id',pg_temp.ga_id(101),'user_id',pg_temp.ga_id(1),'hourly_rate_cents',1000)),'margin_tiers','[]'::jsonb,'labor_split_flag',null));
      perform pg_temp.ga_assert((select h_mo=.101 and k_mo=9.901 from public.estimate_items where id=pg_temp.ga_id(801)) and (select ds_cents=1000 and avg_time_hours=.101 from public.estimate_assemblies where id=pg_temp.ga_id(802)),'Exact decimal hours rejected or changed');
    when 'late-fallback-rollback' then
      a:=jsonb_set(a,'{0,lotId}','null'); p:=jsonb_set(jsonb_set(jsonb_set(p,'{0,resolvedLotId}',to_jsonb(pg_temp.ga_id(805))),'{0,placementMode}','"fallback_unclassified"'),'{0,item,parent_id}',to_jsonb(pg_temp.ga_id(805)));
      perform set_config('ga.fault','estimate_generated_ouvrage_subdetail_drafts',true);
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L,p=>%L,fallback=>%L)',a,p,jsonb_build_object('id',pg_temp.ga_id(805),'created',true)));
    when 'review-save-coherent' then
      b:=jsonb_set(b,'{components,0,designation}','"FO reviewed"'); r:=pg_temp.ga_save(b);
      perform pg_temp.ga_assert(r->'items'->0->>'designation'='FO reviewed' and r->>'reviewToken'<>current_setting('ga.review',true),'Saved review/token not coherent');
      perform pg_temp.ga_assert(jsonb_array_length(r->'itemSources')=1 and r->'subdetailDraft'->>'status'='reviewed','Review lost child sources');
    when 'review-late-child-rollback' then
      perform set_config('ga.fault','estimate_generated_ouvrage_subdetail_item_sources',true); perform pg_temp.ga_refusal('select pg_temp.ga_save()');
    when 'review-old-token' then perform pg_temp.ga_refusal(format('select pg_temp.ga_save(token=>%L)',repeat('0',64)),'GENERATED_OUVRAGE_REVIEW_CHANGED');
    when 'review-null-existing' then perform pg_temp.ga_refusal(format('select public.persist_generated_ouvrage_review(%L,%L,%L,%L,null,%L)',pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(701),b),'GENERATED_OUVRAGE_REVIEW_CHANGED');
    when 'review-foreign-fragment' then b:=jsonb_set(b,'{components,0,sources,0,sourceFragmentId}',to_jsonb(pg_temp.ga_id(923))); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-foreign-component' then b:=jsonb_set(b,'{components,0,componentId}',to_jsonb(pg_temp.ga_id(999))); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-too-many-components' then b:=jsonb_set(b,'{components}',(select jsonb_agg(b->'components'->0) from generate_series(1,25))); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'token-fragment','token-candidate-link','token-item-link','token-component','token-candidate' then
      perform pg_temp.ga_actor(null,'none');
      case name when 'token-fragment' then update public.estimate_generated_ouvrage_source_fragments set excerpt='Changed component source' where id=pg_temp.ga_id(922);
        when 'token-candidate-link' then update public.estimate_generated_ouvrage_candidate_sources set rationale='Changed without updated_at' where id=pg_temp.ga_id(931);
        when 'token-item-link' then update public.estimate_generated_ouvrage_subdetail_item_sources set note='Changed without updated_at' where id=pg_temp.ga_id(961);
        when 'token-component' then update public.estimate_generated_ouvrage_subdetail_items set quantity=2 where id=pg_temp.ga_id(951);
        else update public.estimate_generated_ouvrage_candidates set reasoning='Changed' where id=pg_temp.ga_id(911); end case;
      perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()','GENERATED_OUVRAGE_REVIEW_CHANGED');
    when 'candidate-source-foreign-direct' then
      perform pg_temp.ga_refusal(format('insert into public.estimate_generated_ouvrage_candidate_sources(tenant_id,draft_id,candidate_id,source_fragment_id,source_rank) values(%L,%L,%L,%L,2) returning to_jsonb(estimate_generated_ouvrage_candidate_sources.*)',pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(923)));
    when 'candidate-source-foreign-historical' then
      perform pg_temp.ga_actor(null,'none');
      insert into public.estimate_generated_ouvrage_candidate_sources(tenant_id,draft_id,candidate_id,source_fragment_id,source_rank) values(pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(911),pg_temp.ga_id(923),2);
      perform pg_temp.ga_actor(); perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'unreviewed-refused' then
      perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_drafts set status='pending_review' where id=pg_temp.ga_id(941); perform pg_temp.ga_actor(); perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'accepted-human-values-drift' then a:=jsonb_set(a,'{0,quantity}','2'); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L)',a));
    when 'prepared-provenance-forgery' then p:=jsonb_set(p,'{0,source_metadata}','{"excerpt":"forged"}'); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'prepared-mapping-forgery' then p:=jsonb_set(p,'{0,item,title}','"Different"'); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'prepared-foreign-component' then p:=jsonb_set(p,'{0,componentProjections,0,componentId}',to_jsonb(pg_temp.ga_id(999))); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'prepared-wrong-subdetail' then p:=jsonb_set(p,'{0,subdetailId}',to_jsonb(pg_temp.ga_id(999))); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'duplicate-candidate' then perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L,p=>%L)',a||a,p||p));
    when 'created-id-collision' then p:=jsonb_set(p,'{0,estimateItemId}',to_jsonb(pg_temp.ga_id(501))); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'projection-missing' then perform pg_temp.ga_refusal('select pg_temp.ga_call(u=>''[]'')');
    when 'projection-duplicate' then perform pg_temp.ga_refusal(format('select pg_temp.ga_call(u=>%L)',u||jsonb_build_array(u->0)));
    when 'projection-foreign' then u:=jsonb_set(u,'{0,id}',to_jsonb(pg_temp.ga_id(999))); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(u=>%L)',u));
    when 'foreign-section' then a:=jsonb_set(a,'{0,lotId}',to_jsonb(pg_temp.ga_id(403))); p:=jsonb_set(jsonb_set(p,'{0,resolvedLotId}',to_jsonb(pg_temp.ga_id(403))),'{0,item,parent_id}',to_jsonb(pg_temp.ga_id(403))); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L,p=>%L)',a,p));
    when 'viewer','director','admin-not-draft-creator','other-owner','anonymous','service-role' then
      perform pg_temp.ga_actor(case name when 'viewer' then 4 when 'director' then 3 when 'admin-not-draft-creator' then 2 when 'other-owner' then 5 when 'anonymous' then null else 1 end,case name when 'anonymous' then 'anon' when 'service-role' then 'service_role' else 'authenticated' end); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'session-null' then perform pg_temp.ga_refusal(format('select public.commit_generated_ouvrages(%L,%L,%L,%L,null,%L,%L,null,%L,%L,%L,null)',pg_temp.ga_id(301),pg_temp.ga_id(901),pg_temp.ga_id(1001),current_setting('ga.token'),a,p,u,pg_temp.ga_footer(),pg_temp.ga_context()),'GENERATED_OUVRAGE_LOCK_REQUIRED');
    when 'session-other' then perform pg_temp.ga_refusal(format('select pg_temp.ga_call(session=>%L)',pg_temp.ga_id(702)),'GENERATED_OUVRAGE_LOCK_REQUIRED');
    when 'session-expired' then perform pg_temp.ga_actor(null,'none'); update public.draft_locks set expires_at=clock_timestamp()-interval '1 hour' where version_id=pg_temp.ga_id(301); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()','GENERATED_OUVRAGE_LOCK_REQUIRED');
    when 'stale-cas' then perform pg_temp.ga_refusal('select pg_temp.ga_call(token=>''2000-01-01''::timestamptz)','GENERATED_OUVRAGE_STALE');
    when 'archived-project' then perform pg_temp.ga_actor(null,'none'); update public.estimate_projects set is_archived=true where id=pg_temp.ga_id(201); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'revoked-member' then perform pg_temp.ga_actor(null,'none'); delete from public.tenant_memberships where tenant_id=pg_temp.ga_id(101) and user_id=pg_temp.ga_id(1); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'inactive-tenant' then perform pg_temp.ga_actor(null,'none'); update public.tenants set is_active=false where id=pg_temp.ga_id(101); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'preferred-role-phantom' then perform pg_temp.ga_actor(null,'none'); insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents,is_active,position) values(pg_temp.ga_id(601),pg_temp.ga_id(101),pg_temp.ga_id(1),'New preferred',4000,true,1); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()','GENERATED_OUVRAGE_CONTEXT_CHANGED');
    when 'split-flag-phantom' then perform pg_temp.ga_actor(null,'none'); insert into public.feature_flags(tenant_id,flag_key,enabled) values(pg_temp.ga_id(101),'EST_031_LABOR_SPLIT',false); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_call()','GENERATED_OUVRAGE_CONTEXT_CHANGED');
    when 'reject-atomic' then
      r:=pg_temp.ga_reject(); perform pg_temp.ga_assert(r->>'draftStatus'='discarded' and (select resolution_status='rejected' from public.estimate_generated_ouvrage_candidates where id=pg_temp.ga_id(911)),'Rejection not committed');
      perform pg_temp.ga_assert(not exists(select 1 from public.estimate_generated_ouvrage_source_fragments where draft_id=pg_temp.ga_id(901) and status<>'discarded'),'Discarded draft left active sources');
    when 'reject-late-rollback' then perform set_config('ga.fault','estimate_generated_ouvrage_drafts',true); perform pg_temp.ga_refusal('select pg_temp.ga_reject()');
    when 'reject-then-finalize' then r:=pg_temp.ga_reject(); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'finalize-then-reject' then r:=pg_temp.ga_call(); perform pg_temp.ga_refusal('select pg_temp.ga_reject()');
    when 'finalize-then-review' then r:=pg_temp.ga_call(); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'direct-review-header' then perform pg_temp.ga_refusal(format('update public.estimate_generated_ouvrage_subdetail_drafts set status=''applied'' where id=%L returning to_jsonb(estimate_generated_ouvrage_subdetail_drafts.*)',pg_temp.ga_id(941)));
    when 'direct-review-child' then perform pg_temp.ga_refusal(format('update public.estimate_generated_ouvrage_subdetail_items set quantity=9 where id=%L returning to_jsonb(estimate_generated_ouvrage_subdetail_items.*)',pg_temp.ga_id(951)));
    when 'direct-review-source' then perform pg_temp.ga_refusal(format('delete from public.estimate_generated_ouvrage_subdetail_item_sources where id=%L returning to_jsonb(estimate_generated_ouvrage_subdetail_item_sources.*)',pg_temp.ga_id(961)));
    when 'direct-candidate-apply' then perform pg_temp.ga_refusal(format('update public.estimate_generated_ouvrage_candidates set resolution_status=''inserted'' where id=%L returning to_jsonb(estimate_generated_ouvrage_candidates.*)',pg_temp.ga_id(911)));
    when 'direct-draft-apply' then perform pg_temp.ga_refusal(format('update public.estimate_generated_ouvrage_drafts set status=''applied'' where id=%L returning to_jsonb(estimate_generated_ouvrage_drafts.*)',pg_temp.ga_id(901)));
    when 'replay-exact' then
      r:=pg_temp.ga_call(); saved:=pg_temp.ga_state(); r2:=pg_temp.ga_call(p=>'[]',u=>'[]',ctx=>'{}',session=>pg_temp.ga_id(999));
      perform pg_temp.ga_assert(r2->'replayed'='true' and r2->'receipt'=r->'receipt' and r2->'applications'=r->'applications' and saved=pg_temp.ga_state(),'Replay wrote or changed canonical identities');
    when 'replay-changed-body' then r:=pg_temp.ga_call(); a:=jsonb_set(a,'{0,designation}','"Changed"'); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L)',a),'GENERATED_OUVRAGE_IDEMPOTENCY_CONFLICT');
    when 'replay-other-actor' then r:=pg_temp.ga_call(); perform pg_temp.ga_actor(2); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'receipt-other-actor-null' then r:=pg_temp.ga_call(); perform pg_temp.ga_actor(2); perform pg_temp.ga_assert(public.get_generated_ouvrage_application_receipt(pg_temp.ga_id(301),pg_temp.ga_id(1001)) is null,'Receipt leaked another actor');
    when 'receipt-absent-null' then perform pg_temp.ga_assert(public.get_generated_ouvrage_application_receipt(pg_temp.ga_id(301),pg_temp.ga_id(1001)) is null,'Missing receipt not null');
    when 'receipt-readonly-original-actor' then r:=pg_temp.ga_call(); perform pg_temp.ga_actor(null,'none'); update public.tenant_memberships set role='viewer' where tenant_id=pg_temp.ga_id(101) and user_id=pg_temp.ga_id(1); perform pg_temp.ga_actor(); perform pg_temp.ga_assert(public.get_generated_ouvrage_application_receipt(pg_temp.ga_id(301),pg_temp.ga_id(1001))->'receipt'=r->'receipt','Original actor cannot read receipt after role downgrade'); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'receipt-direct-dml' then r:=pg_temp.ga_call(); perform pg_temp.ga_refusal('delete from private.generated_ouvrage_application_receipts returning to_jsonb(generated_ouvrage_application_receipts.*)');
    when 'abandon-fences-old-commit' then
      r:=pg_temp.ga_abandon(); saved:=pg_temp.ga_state(); r2:=pg_temp.ga_call(p=>'[]',u=>'[]',ctx=>'{}',session=>pg_temp.ga_id(999));
      perform pg_temp.ga_assert(r->>'outcome'='abandoned' and r2=r and saved=pg_temp.ga_state(),'Abandoned intention can still commit or writes on replay');
      perform pg_temp.ga_assert(not exists(select 1 from public.estimate_generated_ouvrage_applications where draft_id=pg_temp.ga_id(901)) and (select total_ht_cents=5 from public.estimate_versions where id=pg_temp.ga_id(301)),'Abandon changed business state');
    when 'abandon-after-commit-preserves-success' then
      r:=pg_temp.ga_call(); saved:=pg_temp.ga_state(); r2:=pg_temp.ga_abandon();
      perform pg_temp.ga_assert(r2->'receipt'=r->'receipt' and r2->'applications'=r->'applications' and r2->'replayed'='true' and saved=pg_temp.ga_state(),'Abandon undid or hid a committed application');
    when 'abandon-receipt-lost' then
      r:=pg_temp.ga_abandon(); saved:=pg_temp.ga_state(); r2:=public.get_generated_ouvrage_application_receipt(pg_temp.ga_id(301),pg_temp.ga_id(1001));
      perform pg_temp.ga_assert(r2=r and saved=pg_temp.ga_state(),'Lost abandonment receipt cannot be recovered exactly');
    when 'abandon-different-body' then
      r:=pg_temp.ga_abandon(); a:=jsonb_set(a,'{0,designation}','"Different"'); perform pg_temp.ga_refusal(format('select pg_temp.ga_abandon(a=>%L)',a),'GENERATED_OUVRAGE_IDEMPOTENCY_CONFLICT');
    when 'abandon-after-drift-no-lease' then
      perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_items set quantity=2 where id=pg_temp.ga_id(951); delete from public.draft_locks where version_id=pg_temp.ga_id(301); perform pg_temp.ga_actor();
      r:=pg_temp.ga_abandon(); perform pg_temp.ga_assert(r->>'outcome'='abandoned','Cannot explicitly close old intention after material drift without lease');
    when 'abandon-other-actor' then r:=pg_temp.ga_abandon(); perform pg_temp.ga_actor(2); perform pg_temp.ga_refusal('select pg_temp.ga_abandon()');
    when 'parent-delete-cascade' then r:=pg_temp.ga_call(); perform pg_temp.ga_actor(null,'none'); delete from public.estimate_versions where id=pg_temp.ga_id(301); perform pg_temp.ga_assert(not exists(select 1 from private.generated_ouvrage_application_receipts where version_id=pg_temp.ga_id(301)) and not exists(select 1 from public.estimate_generated_ouvrage_drafts where id=pg_temp.ga_id(901)),'Parent cascade blocked');
    when 'generation-complete-archives-own-pending' then
      perform pg_temp.ga_generation(); r:=pg_temp.ga_close();
      perform pg_temp.ga_assert(r=jsonb_build_object('ok',true,'versionId',pg_temp.ga_id(301),'draftId',pg_temp.ga_id(903),'status','pending','discardedDraftIds',jsonb_build_array(pg_temp.ga_id(901))),'Closure result or archived identities differ');
      perform pg_temp.ga_assert((select status='discarded' from public.estimate_generated_ouvrage_drafts where id=pg_temp.ga_id(901)) and not exists(select 1 from public.estimate_generated_ouvrage_source_fragments where draft_id=pg_temp.ga_id(901) and status<>'discarded'),'Old draft/fragments not archived together');
      perform pg_temp.ga_actor(null,'none');
      perform pg_temp.ga_assert((select array_agg(status order by id)=array['pending','pending','partially_applied','applied'] from public.estimate_generated_ouvrage_drafts where id=any(array[pg_temp.ga_id(903),pg_temp.ga_id(904),pg_temp.ga_id(905),pg_temp.ga_id(906)])),'Closure touched new/other actor/partial/applied draft');
    when 'generation-failed-discards-only-own' then
      perform pg_temp.ga_generation(); r:=pg_temp.ga_close('failed');
      perform pg_temp.ga_assert(r->>'status'='discarded' and r->'discardedDraftIds'=jsonb_build_array(pg_temp.ga_id(903)) and (select status='pending' from public.estimate_generated_ouvrage_drafts where id=pg_temp.ga_id(901)) and (select status='discarded' from public.estimate_generated_ouvrage_source_fragments where id=pg_temp.ga_id(924)),'Failure cleanup not scoped/atomic');
    when 'generation-late-fragment-rollback' then
      perform pg_temp.ga_generation(); perform set_config('ga.fault','estimate_generated_ouvrage_source_fragments',true); perform pg_temp.ga_refusal('select pg_temp.ga_close()','GENERATED_NATIVE_LATE_FAULT');
    when 'generation-incomplete-complete-refused' then
      perform pg_temp.ga_generation(); perform pg_temp.ga_actor(null,'none'); delete from public.estimate_generated_ouvrage_candidates where id=pg_temp.ga_id(913); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_close()','GENERATED_OUVRAGE_INVALID_INPUT');
    when 'generation-failed-applied-refused' then
      r:=pg_temp.ga_call(); perform pg_temp.ga_refusal('select pg_temp.ga_close(''failed'',901)','GENERATED_OUVRAGE_FORBIDDEN');
    when 'generation-closure-before-finalize' then
      r:=pg_temp.ga_close('failed',901); perform pg_temp.ga_refusal('select pg_temp.ga_call()','GENERATED_OUVRAGE_FORBIDDEN');
    when 'generation-null-session-refused' then
      perform pg_temp.ga_generation(); perform pg_temp.ga_refusal(format('select public.close_generated_ouvrage_generation(%L,%L,null,''complete'')',pg_temp.ga_id(301),pg_temp.ga_id(903)),'GENERATED_OUVRAGE_LOCK_REQUIRED');
    when 'generation-other-actor-refused' then
      perform pg_temp.ga_generation(); perform pg_temp.ga_actor(2); perform pg_temp.ga_refusal('select pg_temp.ga_close()','GENERATED_OUVRAGE_FORBIDDEN');
    when 'generation-invalid-mode-refused' then
      perform pg_temp.ga_generation(); perform pg_temp.ga_refusal('select pg_temp.ga_close(''other'')','GENERATED_OUVRAGE_INVALID_INPUT');
    when 'generation-newer-preserved' then
      perform pg_temp.ga_generation(); r:=pg_temp.ga_close('complete',901); perform pg_temp.ga_assert(r->'discardedDraftIds'='[]'::jsonb and (select status='pending' from public.estimate_generated_ouvrage_drafts where id=pg_temp.ga_id(903)),'Older completion discarded a later generation');
    when 'generation-expired-lease-refused' then
      perform pg_temp.ga_generation(); perform pg_temp.ga_actor(null,'none'); update public.draft_locks set expires_at=clock_timestamp()-interval '1 minute' where version_id=pg_temp.ga_id(301); perform pg_temp.ga_actor(); perform pg_temp.ga_refusal('select pg_temp.ga_close()','GENERATED_OUVRAGE_LOCK_REQUIRED');
    when 'generation-direct-discard-refused' then
      perform pg_temp.ga_refusal(format('update public.estimate_generated_ouvrage_drafts set status=''discarded'' where id=%L returning to_jsonb(estimate_generated_ouvrage_drafts.*)',pg_temp.ga_id(901)),'GENERATED_OUVRAGE_WRITE_REQUIRED');
    when 'acl-boundary' then
      perform pg_temp.ga_actor(null,'none');
      foreach signature in array array['public.read_generated_ouvrage_review(uuid,uuid,uuid)','public.persist_generated_ouvrage_review(uuid,uuid,uuid,uuid,text,jsonb)','public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','public.get_generated_ouvrage_application_receipt(uuid,uuid)','public.reject_generated_ouvrage_candidate(uuid,uuid,uuid,uuid,text)','public.abandon_generated_ouvrage_application(uuid,uuid,uuid,timestamptz,jsonb)','public.close_generated_ouvrage_generation(uuid,uuid,uuid,text)'] loop
        perform pg_temp.ga_assert(has_function_privilege('authenticated',signature,'EXECUTE') and not has_function_privilege('anon',signature,'EXECUTE') and not has_function_privilege('service_role',signature,'EXECUTE'),'RPC ACL broadened');
        perform pg_temp.ga_assert((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid=signature::regprocedure),'Definer/search_path not explicit');
      end loop;
      perform pg_temp.ga_assert(not has_schema_privilege('authenticated','private','USAGE') and not has_table_privilege('authenticated','private.generated_ouvrage_application_receipts','INSERT,UPDATE,DELETE'),'Private privilege broadened');
    else raise exception 'Unknown generated case %',name; end case;
  end $f$;
  $helpers$;
  -- Session-local probe helpers need explicit access after SET ROLE anon.
  -- The mandatory abort rolls back these grants; product RPC ACLs stay closed.
  grant execute on all functions in schema pg_temp to anon;
  foreach case_name in array array[
    'read-material-union','read-absent-token-null','finalize-existing','prepared-defaults-match-batch','finalize-fallback','partial-preserves-other-review-token','token-unrelated-fragment-unchanged','late-application','late-snapshot','late-draft','late-subdetail','late-receipt','late-fallback-rollback',
    'fallback-wrong-title','fallback-ascii-existing','component-cost-redistribution','component-coefficient-forgery','parent-cost-forgery','parent-majoration-forgery','labor-trace-duplicate','labor-hours-forgery','decimal-yield-hours',
    'review-save-coherent','review-late-child-rollback','review-old-token','review-null-existing','review-foreign-fragment','review-foreign-component','review-too-many-components',
    'token-fragment','token-candidate-link','token-item-link','token-component','token-candidate','candidate-source-foreign-direct','candidate-source-foreign-historical','unreviewed-refused','accepted-human-values-drift','prepared-provenance-forgery','prepared-mapping-forgery','prepared-foreign-component','prepared-wrong-subdetail','duplicate-candidate','created-id-collision','projection-missing','projection-duplicate','projection-foreign','foreign-section',
    'viewer','director','admin-not-draft-creator','other-owner','anonymous','service-role','session-null','session-other','session-expired','stale-cas','archived-project','revoked-member','inactive-tenant','preferred-role-phantom','split-flag-phantom',
    'reject-atomic','reject-late-rollback','reject-then-finalize','finalize-then-reject','finalize-then-review','direct-review-header','direct-review-child','direct-review-source','direct-candidate-apply','direct-draft-apply',
    'replay-exact','replay-changed-body','replay-other-actor','receipt-other-actor-null','receipt-absent-null','receipt-readonly-original-actor','receipt-direct-dml',
    'abandon-fences-old-commit','abandon-after-commit-preserves-success','abandon-receipt-lost','abandon-different-body','abandon-after-drift-no-lease','abandon-other-actor','parent-delete-cascade','acl-boundary',
    'generation-complete-archives-own-pending','generation-failed-discards-only-own','generation-late-fragment-rollback','generation-incomplete-complete-refused','generation-failed-applied-refused','generation-closure-before-finalize','generation-null-session-refused','generation-other-actor-refused','generation-invalid-mode-refused','generation-newer-preserved','generation-expired-lease-refused','generation-direct-discard-refused'
  ] loop
    passed:=false; failure:=null;
    begin perform pg_temp.ga_case(case_name); raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true; when others then failure:=sqlstate||': '||sqlerrm; end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='ESTIMATE_GENERATED_ATOMIC_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','cfc20000','concurrencyExecuted',false,'cases',results)::text;
end;
$generated_atomic_probe$;


