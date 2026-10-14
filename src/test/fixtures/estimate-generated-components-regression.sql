-- CORE07: decisions/projections/library regressions written BEFORE CORE07 product SQL.
-- One forcibly aborted DO, new synthetic UUIDs, no existing fixture reused.
-- Authorization/direct DML, late failure, raw material and immutable receipts
-- cannot be established by the browser alone. Money is an explicit oracle,
-- not a SQL reimplementation of the TypeScript calculator. No real race here.
do $generated_components_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure text;
begin
  if exists(select 1 from auth.users where id::text like 'cfc70000-%') then raise exception 'Generated fixture already exists'; end if;
  execute $helpers$
  create function pg_temp.ga_id(n integer) returns uuid language sql immutable as $f$
    select ('cfc70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
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
  update public.tenant_memberships set is_default=false where user_id::text like 'cfc70000-%';
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
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%cfc70000-%%''',t.nspname,t.relname) into rows_value;
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
    if current_setting('ga.fault',true)=tg_table_name and to_jsonb(new)::text like '%cfc70000-%' and
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
  create function pg_temp.ga_sync() returns void language plpgsql as $f$
  begin
    perform pg_temp.ga_actor();
    perform set_config('ga.review',pg_temp.ga_read()->>'reviewToken',true);
    perform set_config('ga.token',(select updated_at::text from public.estimate_versions where id=pg_temp.ga_id(301)),true);
  end $f$;
  create function pg_temp.ga_input() returns jsonb language sql as $f$
    with r as(select pg_temp.ga_read() value)
    select jsonb_build_object('status',r.value->'subdetailDraft'->'status','summary',r.value->'subdetailDraft'->'summary',
      'generation_metadata',r.value->'subdetailDraft'->'generation_metadata','components',(
        select jsonb_agg(jsonb_build_object('componentId',x->'id','status',x->'status','costType',x->'cost_type',
          'designation',x->'designation','unit',x->'unit','quantity',x->'quantity','unitCostHtCents',x->'unit_cost_ht_cents',
          'lossCoeffBp',x->'loss_coeff_bp','yieldValue',x->'yield_value','yieldUnit',x->'yield_unit','confidence',x->'confidence',
          'sourceLabel',x->'source_label','facts',x->'facts','hypotheses',x->'hypotheses','inferences',x->'inferences',
          'riskSignals',coalesce(x->'metadata'->'risk_signals','[]'::jsonb),'sources',coalesce((
            select jsonb_agg(jsonb_build_object('sourceFragmentId',s->'source_fragment_id','evidenceKind',s->'evidence_kind','note',s->'note')
              order by (s->>'source_rank')::integer,s->>'id') from jsonb_array_elements(r.value->'itemSources')s where s->>'component_id'=x->>'id'),'[]'::jsonb))
          order by (x->>'component_order')::integer,x->>'id') from jsonb_array_elements(r.value->'items')x)) from r
  $f$;
  create function pg_temp.ga_known_rejection(origin text default 'manual') returns void language plpgsql as $f$
  begin
    perform pg_temp.ga_actor(null,'none');
    update public.estimate_generated_ouvrage_subdetail_items set status='rejected',metadata=case when origin is null then '{}'::jsonb else jsonb_build_object('rejected_from_status',origin) end where id=pg_temp.ga_id(951);
    update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||jsonb_build_object('component_count',0,'ds_cents',0,'indicative_target_price_cents',0) where id=pg_temp.ga_id(941);
    perform pg_temp.ga_sync();
  end $f$;
  create function pg_temp.ga_add_component(next_status text default 'rejected') returns void language plpgsql as $f$
  begin
    perform pg_temp.ga_actor(null,'none');
    insert into public.estimate_generated_ouvrage_source_fragments(id,tenant_id,project_id,draft_id,fragment_order,source_kind,label,excerpt,normalized_excerpt)
      values(pg_temp.ga_id(924),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),2,'internal_note','Second component source','Seven cents only','seven cents only');
    insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,source_fragment_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,confidence,metadata)
      values(pg_temp.ga_id(952),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(924),1,next_status,'material','FO seven','m',1,7,1,case when next_status='rejected' then '{"rejected_from_status":"manual"}'::jsonb else '{}'::jsonb end);
    insert into public.estimate_generated_ouvrage_subdetail_item_sources(id,tenant_id,draft_id,subdetail_id,parent_work_id,component_id,source_fragment_id,source_rank,evidence_kind,note)
      values(pg_temp.ga_id(962),pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(952),pg_temp.ga_id(924),0,'fact','Second component only');
    if next_status<>'rejected' then update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"component_count":2,"ds_cents":10,"indicative_target_price_cents":10}'::jsonb where id=pg_temp.ga_id(941); end if;
    perform pg_temp.ga_sync();
  end $f$;
  create function pg_temp.ga_four_proposals() returns void language plpgsql as $f$
  begin
    perform pg_temp.ga_add_component('suggested'); perform pg_temp.ga_actor(null,'none');
    insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,source_fragment_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,confidence)
      values(pg_temp.ga_id(953),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(924),2,'manual','material','FO eleven','m',1,11,1),
            (pg_temp.ga_id(954),pg_temp.ga_id(101),pg_temp.ga_id(201),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(924),3,'suggested','labor','MO twelve','h',1,12,1);
    insert into public.estimate_generated_ouvrage_subdetail_item_sources(id,tenant_id,draft_id,subdetail_id,parent_work_id,component_id,source_fragment_id,source_rank,evidence_kind,note)
      values(pg_temp.ga_id(963),pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(953),pg_temp.ga_id(924),0,'fact','Third proposal source'),
            (pg_temp.ga_id(964),pg_temp.ga_id(101),pg_temp.ga_id(901),pg_temp.ga_id(941),pg_temp.ga_id(911),pg_temp.ga_id(954),pg_temp.ga_id(924),0,'fact','Fourth proposal source');
    update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"component_count":4,"ds_cents":33,"indicative_target_price_cents":33}'::jsonb where id=pg_temp.ga_id(941);
    perform pg_temp.ga_sync();
  end $f$;
  create function pg_temp.ga_labor(free boolean default false,role_mode text default 'active',stored_quantity numeric default 1,unit_cost integer default 1000) returns jsonb language plpgsql as $f$
  declare p jsonb:=pg_temp.ga_prepared(); amount integer:=case when free then 0 else round(stored_quantity*unit_cost)::integer end;
    coefficient numeric:=case when free or stored_quantity=0 then 0 else unit_cost::numeric/4000 end;
    role_value jsonb; context_value jsonb;
  begin
    perform pg_temp.ga_actor(null,'none');
    if role_mode<>'absent' then
      insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents,is_active,position)
        values(pg_temp.ga_id(601),pg_temp.ga_id(101),pg_temp.ga_id(1),'Pose',4000,role_mode='active',1);
    end if;
    role_value:=case when role_mode='active' then jsonb_build_object('id',pg_temp.ga_id(601),'name','Pose','hourly_rate_cents',4000,'is_active',true,'position',1) else 'null'::jsonb end;
    context_value:=jsonb_build_object('labor_roles',case when role_mode='active' then jsonb_build_array(jsonb_build_object('id',pg_temp.ga_id(601),'tenant_id',pg_temp.ga_id(101),'user_id',pg_temp.ga_id(1),'hourly_rate_cents',4000)) else '[]'::jsonb end,'margin_tiers','[]'::jsonb,'labor_split_flag',null);
    update public.estimate_generated_ouvrage_subdetail_items set designation='MO C',unit='h',cost_type='labor',quantity=stored_quantity,unit_cost_ht_cents=case when free then 0 else unit_cost end where id=pg_temp.ga_id(951);
    update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||jsonb_build_object('ds_cents',amount,'indicative_target_price_cents',amount) where id=pg_temp.ga_id(941);
    p:=jsonb_set(p,'{0,componentProjections}',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'kFo',0,'kMo',coefficient,'hMo',stored_quantity,'dsCents',amount)));
    p:=jsonb_set(p,'{0,estimateItemMapping}',p->0->'estimateItemMapping'||jsonb_build_object('mode',case when role_mode='active' then 'legacy_labor_allocated' else 'labor_hours_only' end,
      'unitPriceHtCents',amount,'hMo',stored_quantity,'kFo',0,'kMo',coefficient,'laborRoleId',role_value->'id','laborRoleName',role_value->'name','laborRoleHourlyRateCents',role_value->'hourly_rate_cents',
      'totalDsCents',amount,'nonLaborDsCents',0,'laborDsCents',amount,
      'costBreakdown',jsonb_build_array(jsonb_build_object('costType','labor','componentCount',1,'quantity',stored_quantity,'dsCents',amount)),
      'laborTrace',jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(951),'designation','MO C','unit','h','quantity',stored_quantity,'derivedHours',stored_quantity,'hoursSource','quantity','dsCents',amount))));
    p:=jsonb_set(p,'{0,item}',p->0->'item'||jsonb_build_object('unit_price_ht_cents',amount,'h_mo',stored_quantity,'k_fo',0,'k_mo',coefficient,'labor_role_id',role_value->'id'));
    perform pg_temp.ga_sync();
    return jsonb_build_object('prepared',p,'preferred',role_value,'context',context_value,
      'updates',jsonb_build_array(pg_temp.ga_money(501,2),pg_temp.ga_money(502,3),pg_temp.ga_money(801,amount)),
      'footer',jsonb_build_object('total_ht_cents',5+amount,'total_tax_cents',0,'total_ttc_cents',5+amount));
  end $f$;
  create function pg_temp.ga_target() returns jsonb language plpgsql security definer set search_path='' as $f$
  declare l private.estimate_source_coverage_links%rowtype;
  begin
    l.id:=pg_temp.ga_id(981); l.kind:='component'; l.item_id:=pg_temp.ga_id(801); l.application_id:=pg_temp.ga_id(803); l.snapshot_id:=pg_temp.ga_id(804); l.component_id:=pg_temp.ga_id(951)::text;
    return private.source_coverage_target(l,pg_temp.ga_id(301),pg_temp.ga_id(201),pg_temp.ga_id(101),'{}');
  end $f$;
  create function pg_temp.ga_case(case_key text) returns void language plpgsql as $f$
  declare r jsonb; r2 jsonb; b jsonb; a jsonb; p jsonb; bundle jsonb; saved jsonb; expected_origin text;
  begin
    perform set_config('ga.fault','',true); perform pg_temp.ga_sync();
    b:=pg_temp.ga_input(); a:=pg_temp.ga_accepted(); p:=pg_temp.ga_prepared();
    case case_key
    when 'review-reject-manual-origin','review-reject-suggested-origin','review-edit-before-reject-origin' then
      if case_key<>'review-reject-manual-origin' then perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_items set status='suggested' where id=pg_temp.ga_id(951); perform pg_temp.ga_sync(); b:=pg_temp.ga_input(); end if;
      expected_origin:=case when case_key='review-reject-suggested-origin' then 'suggested' else 'manual' end;
      b:=jsonb_set(jsonb_set(b,'{components,0,status}','"rejected"'),'{status}','"pending_review"');
      b:=jsonb_set(b,'{summary}',b->'summary'||'{"component_count":0,"ds_cents":0,"indicative_target_price_cents":0}'::jsonb);
      if case_key='review-edit-before-reject-origin' then b:=jsonb_set(b,'{components,0,designation}','"FO edited before rejection"'); end if;
      r:=pg_temp.ga_save(body=>b);
      perform pg_temp.ga_assert(r->'items'->0->>'status'='rejected' and r->'items'->0->'metadata'->>'rejected_from_status'=expected_origin,'Rejection lost or invented restorable origin');
      perform pg_temp.ga_assert(r->'items'->0->'id'=to_jsonb(pg_temp.ga_id(951)) and jsonb_array_length(r->'itemSources')=1,'Rejection removed proposal or provenance');
    when 'review-rejected-edit-without-decision' then
      perform pg_temp.ga_known_rejection('manual'); b:=jsonb_set(pg_temp.ga_input(),'{components,0,designation}','"Rejected edited implicitly"');
      perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-rejected-uppercase-id-restore-refused' then
      perform pg_temp.ga_known_rejection('suggested'); b:=pg_temp.ga_input();
      b:=jsonb_set(b,'{components,0,componentId}',to_jsonb(upper(pg_temp.ga_id(951)::text)));
      b:=jsonb_set(b,'{components,0,status}','"manual"');
      perform pg_temp.ga_assert(b->'components'->0->>'componentId'<>pg_temp.ga_id(951)::text and (b->'components'->0->>'componentId')::uuid=pg_temp.ga_id(951),'Equivalent UUID vector is canonical or foreign');
      perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-suggested-edit-history' then
      perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_items set status='suggested' where id=pg_temp.ga_id(951); perform pg_temp.ga_sync();
      b:=pg_temp.ga_input(); b:=jsonb_set(jsonb_set(b,'{components,0,status}','"manual"'),'{components,0,designation}','"Suggested proposal explicitly edited"');
      r:=pg_temp.ga_save(body=>b);
      perform pg_temp.ga_assert(r->'items'->0->>'status'='manual' and r->'items'->0->'metadata'->'review_decisions'->0->>'action'='edit'
        and r->'items'->0->'metadata'->'review_decisions'->0->>'from_status'='suggested' and r->'items'->0->'metadata'->'review_decisions'->0->>'to_status'='manual'
        and (r->'items'->0->'metadata'->'review_decisions'->0->>'actor_id')::uuid=pg_temp.ga_id(1),'Suggestion edit recorded as rejection or without authoritative actor');
    when 'review-restore-manual','review-restore-suggested','review-restore-and-edit','review-restore-and-reject','review-restore-edit-and-reject' then
      expected_origin:=case when case_key='review-restore-manual' then 'manual' else 'suggested' end;
      perform pg_temp.ga_known_rejection(expected_origin); b:=pg_temp.ga_input();
      b:=jsonb_set(b,'{components,0}',b->'components'->0||jsonb_build_object('restore',true,'status',case when case_key in('review-restore-and-reject','review-restore-edit-and-reject') then 'rejected' when case_key='review-restore-and-edit' then 'manual' else expected_origin end));
      if case_key in('review-restore-and-reject','review-restore-edit-and-reject') then b:=jsonb_set(b,'{status}','"pending_review"'); end if;
      if case_key in('review-restore-and-edit','review-restore-edit-and-reject') then b:=jsonb_set(b,'{components,0,designation}','"Restored and edited"'); end if;
      r:=pg_temp.ga_save(body=>b);
      if case_key in('review-restore-and-reject','review-restore-edit-and-reject') then
        perform pg_temp.ga_assert(r->'items'->0->>'status'='rejected' and r->'items'->0->'metadata'->>'rejected_from_status'=case when case_key='review-restore-edit-and-reject' then 'manual' else 'suggested' end,'Restore then rejection changed origin incorrectly');
      else perform pg_temp.ga_assert(r->'items'->0->>'status'=case when case_key='review-restore-and-edit' then 'manual' else expected_origin end,'Explicit restore lost origin or edit state'); end if;
    when 'review-known-restore-missing-marker' then
      perform pg_temp.ga_known_rejection('manual'); b:=jsonb_set(pg_temp.ga_input(),'{components,0,status}','"manual"'); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-legacy-restore-unknown-refused' then
      perform pg_temp.ga_known_rejection(null); b:=jsonb_set(pg_temp.ga_input(),'{components,0,status}','"manual"'); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-legacy-restore-explicit-manual' then
      perform pg_temp.ga_known_rejection(null); b:=pg_temp.ga_input(); b:=jsonb_set(b,'{components,0}',b->'components'->0||'{"status":"manual","restoreAsManual":true}'::jsonb);
      r:=pg_temp.ga_save(body=>b); perform pg_temp.ga_assert(r->'items'->0->>'status'='manual' and r->'items'->0->'id'=to_jsonb(pg_temp.ga_id(951)),'Explicit legacy restore did not preserve proposal');
    when 'review-restore-marker-misuse','review-origin-input-forged','review-both-restore-markers' then
      if case_key='review-both-restore-markers' then perform pg_temp.ga_known_rejection('manual'); b:=pg_temp.ga_input(); end if;
      b:=jsonb_set(b,'{components,0}',b->'components'->0||case case_key when 'review-origin-input-forged' then '{"rejectedFromStatus":"suggested"}'::jsonb when 'review-both-restore-markers' then '{"status":"manual","restore":true,"restoreAsManual":true}'::jsonb else '{"restoreAsManual":true}'::jsonb end);
      perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-proposal-omission-refused' then
      b:=jsonb_set(b,'{components,0}',(b->'components'->0)-'componentId'); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
    when 'review-new-rejected-human-origin-manual' then
      b:=jsonb_set(b,'{components}',(b->'components')||jsonb_build_array((b->'components'->0)||'{"componentId":null,"status":"rejected","designation":"New manual proposal discarded before first save"}'::jsonb));
      r:=pg_temp.ga_save(body=>b);
      perform pg_temp.ga_assert(jsonb_array_length(r->'items')=2 and exists(select 1 from jsonb_array_elements(r->'items')x where x->>'id'<>pg_temp.ga_id(951)::text and x->>'status'='rejected' and x->'metadata'->>'rejected_from_status'='manual'),'New human rejected proposal has no derived manual origin');
      perform pg_temp.ga_assert(exists(select 1 from jsonb_array_elements(r->'items')x where x->>'id'=pg_temp.ga_id(951)::text and x->>'status'='manual'),'New discarded proposal overwrote existing identity');
    when 'review-all-rejected-save-pending','review-all-rejected-reviewed-refused' then
      perform pg_temp.ga_four_proposals(); b:=pg_temp.ga_input();
      perform pg_temp.ga_assert(jsonb_array_length(b->'components')=4 and not exists(select 1 from jsonb_array_elements(b->'components')x where x->>'status'='rejected'),'All-rejected vector preseeded a rejection');
      b:=jsonb_set(b,'{components}',(select jsonb_agg(jsonb_set(x.value,'{status}','"rejected"') order by x.ordinality) from jsonb_array_elements(b->'components') with ordinality x));
      b:=jsonb_set(b,'{status}',to_jsonb(case when case_key='review-all-rejected-save-pending' then 'pending_review'::text else 'reviewed'::text end));
      b:=jsonb_set(b,'{summary}',b->'summary'||'{"component_count":0,"ds_cents":0,"indicative_target_price_cents":0}'::jsonb);
      if case_key='review-all-rejected-reviewed-refused' then perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b));
      else
        r:=pg_temp.ga_save(body=>b);
        perform pg_temp.ga_assert(r->'subdetailDraft'->>'status'='pending_review' and jsonb_array_length(r->'items')=4 and jsonb_array_length(r->'itemSources')=4,'All-rejected save removed proposals/sources or marked reviewed');
        perform pg_temp.ga_assert(not exists(select 1 from jsonb_array_elements(r->'items')x where x->>'status'<>'rejected' or x->'metadata'->>'rejected_from_status' is distinct from case when x->>'id' in(pg_temp.ga_id(951)::text,pg_temp.ga_id(953)::text) then 'manual' else 'suggested' end),'All-rejected save lost one of four origins');
        perform pg_temp.ga_sync(); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
      end if;
    when 'commit-retained-subset' then
      perform pg_temp.ga_add_component(); r:=pg_temp.ga_call(); r2:=pg_temp.ga_read();
      perform pg_temp.ga_assert(r->>'insertedCount'='1' and jsonb_array_length(r2->'items')=2 and exists(select 1 from jsonb_array_elements(r2->'items')x where x->>'id'=pg_temp.ga_id(952)::text and x->>'status'='rejected'),'Application lost rejected review proposal');
      perform pg_temp.ga_assert((select jsonb_array_length(components)=1 and components->0->>'componentId'=pg_temp.ga_id(951)::text from public.estimate_generated_ouvrage_work_snapshots where id=pg_temp.ga_id(804)),'Snapshot composition differs from retained IDs');
      perform pg_temp.ga_assert((select count(*)=1 from public.estimate_assembly_items where assembly_id=pg_temp.ga_id(802)) and (select ds_cents=3 from public.estimate_assemblies where id=pg_temp.ga_id(802)),'Library includes rejected costs');
    when 'commit-library-component-provenance-identity' then
      perform pg_temp.ga_add_component('manual'); perform pg_temp.ga_actor(null,'none');
      update public.estimate_generated_ouvrage_subdetail_items set source_fragment_id=pg_temp.ga_id(924) where id=pg_temp.ga_id(951);
      update public.estimate_generated_ouvrage_subdetail_item_sources set source_fragment_id=pg_temp.ga_id(924) where id=pg_temp.ga_id(961);
      perform pg_temp.ga_sync();
      p:=jsonb_set(p,'{0,componentProjections}',(p->0->'componentProjections')||jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(952),'kFo',1,'kMo',0,'hMo',0,'dsCents',7)));
      p:=jsonb_set(p,'{0,estimateItemMapping}',(p->0->'estimateItemMapping')||jsonb_build_object('unitPriceHtCents',10,'totalDsCents',10,'nonLaborDsCents',10,'costBreakdown',jsonb_build_array(jsonb_build_object('costType','material','componentCount',2,'quantity',2,'dsCents',10))));
      p:=jsonb_set(p,'{0,item,unit_price_ht_cents}','10');
      r:=pg_temp.ga_call(p=>p,u=>jsonb_build_array(pg_temp.ga_money(501,2),pg_temp.ga_money(502,3),pg_temp.ga_money(801,10)),footer=>'{"total_ht_cents":15,"total_tax_cents":0,"total_ttc_cents":15}');
      perform pg_temp.ga_assert((select count(*)=2 and count(distinct source_metadata->>'component_id')=2 and bool_and(source_metadata->>'kind'='generated_ouvrage' and source_metadata->>'component_id'=case when title='FO C' then pg_temp.ga_id(951)::text else pg_temp.ga_id(952)::text end) from public.estimate_assembly_items where assembly_id=pg_temp.ga_id(802)),'Library citations substituted for validated component identity');
      perform pg_temp.ga_assert((select bool_and(source_metadata->'sources'->0->>'sourceFragmentId'=pg_temp.ga_id(924)::text) from public.estimate_assembly_items where assembly_id=pg_temp.ga_id(802)),'Shared citation was not retained for both distinct components');
    when 'commit-rejected-projection-refused' then
      perform pg_temp.ga_add_component(); perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"component_count":2,"ds_cents":10,"indicative_target_price_cents":10}'::jsonb where id=pg_temp.ga_id(941); perform pg_temp.ga_sync();
      p:=jsonb_set(p,'{0,componentProjections}',p->0->'componentProjections'||jsonb_build_array(jsonb_build_object('componentId',pg_temp.ga_id(952),'kFo',1,'kMo',0,'hMo',0,'dsCents',7)));
      p:=jsonb_set(p,'{0,estimateItemMapping}',p->0->'estimateItemMapping'||jsonb_build_object('unitPriceHtCents',10,'totalDsCents',10,'nonLaborDsCents',10,'costBreakdown',jsonb_build_array(jsonb_build_object('costType','material','componentCount',2,'quantity',2,'dsCents',10))));
      p:=jsonb_set(p,'{0,item,unit_price_ht_cents}','10');
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L,u=>%L,footer=>%L)',p,jsonb_build_array(pg_temp.ga_money(501,2),pg_temp.ga_money(502,3),pg_temp.ga_money(801,10)),'{"total_ht_cents":15,"total_tax_cents":0,"total_ttc_cents":15}'::jsonb));
    when 'commit-retained-missing-refused' then perform pg_temp.ga_add_component('manual'); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'commit-duplicate-retained-id-refused' then p:=jsonb_set(p,'{0,componentProjections}',(p->0->'componentProjections')||(p->0->'componentProjections')); perform pg_temp.ga_assert(p is not null and jsonb_array_length(p->0->'componentProjections')=2,'Duplicate vector fell back to default'); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'commit-foreign-retained-id-refused' then p:=jsonb_set(p,'{0,componentProjections,0,componentId}',to_jsonb(pg_temp.ga_id(999))); perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L)',p));
    when 'commit-all-rejected-refused' then
      perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_items set status='rejected',metadata='{"rejected_from_status":"manual"}' where id=pg_temp.ga_id(951); perform pg_temp.ga_sync(); perform pg_temp.ga_refusal('select pg_temp.ga_call()');
    when 'commit-zero-retained-material' then
      perform pg_temp.ga_actor(null,'none'); update public.estimate_generated_ouvrage_subdetail_items set unit_cost_ht_cents=0 where id=pg_temp.ga_id(951); update public.estimate_generated_ouvrage_subdetail_drafts set summary=summary||'{"ds_cents":0,"indicative_target_price_cents":0}'::jsonb where id=pg_temp.ga_id(941); perform pg_temp.ga_sync();
      p:=jsonb_set(p,'{0,componentProjections,0,dsCents}','0'); p:=jsonb_set(p,'{0,item,unit_price_ht_cents}','0');
      p:=jsonb_set(p,'{0,estimateItemMapping}',p->0->'estimateItemMapping'||jsonb_build_object('unitPriceHtCents',0,'totalDsCents',0,'nonLaborDsCents',0,'costBreakdown',jsonb_build_array(jsonb_build_object('costType','material','componentCount',1,'quantity',1,'dsCents',0))));
      r:=pg_temp.ga_call(p=>p,u=>jsonb_build_array(pg_temp.ga_money(501,2),pg_temp.ga_money(502,3),pg_temp.ga_money(801,0)),footer=>'{"total_ht_cents":5,"total_tax_cents":0,"total_ttc_cents":5}');
      perform pg_temp.ga_assert((select jsonb_array_length(components)=1 and components->0->>'componentId'=pg_temp.ga_id(951)::text and (components->0->>'dsCents')::integer=0 from public.estimate_generated_ouvrage_work_snapshots where id=pg_temp.ga_id(804)) and (select count(*)=1 from public.estimate_assembly_items where assembly_id=pg_temp.ga_id(802)),'Zero retained material lost identity/provenance');
    when 'commit-labor-preferred-role-library','commit-free-labor-hours-library' then
      bundle:=pg_temp.ga_labor(case_key='commit-free-labor-hours-library');
      r:=pg_temp.ga_call(p=>bundle->'prepared',u=>bundle->'updates',footer=>bundle->'footer',ctx=>bundle->'context',preferred=>bundle->'preferred');
      perform pg_temp.ga_assert((select labor_role_id=pg_temp.ga_id(601) and h_mo=1 and k_mo=case when case_key='commit-free-labor-hours-library' then 0 else .25 end from public.estimate_assembly_items where assembly_id=pg_temp.ga_id(802)),'Generated library lost selected role, coefficient or hours');
      perform pg_temp.ga_assert((select ds_cents=case when case_key='commit-free-labor-hours-library' then 0 else 1000 end and avg_time_hours=1 from public.estimate_assemblies where id=pg_temp.ga_id(802)) and (select h_mo=1 and labor_role_id=pg_temp.ga_id(601) from public.estimate_items where id=pg_temp.ga_id(801)),'Role-rate library/parent representation differs');
    when 'commit-free-labor-no-role-refused','commit-free-labor-inactive-role-refused' then
      bundle:=pg_temp.ga_labor(true,case when case_key='commit-free-labor-no-role-refused' then 'absent' else 'inactive' end);
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(p=>%L,u=>%L,footer=>%L,ctx=>%L,preferred=>%L)',bundle->'prepared',bundle->'updates',bundle->'footer',bundle->'context',bundle->'preferred'));
    when 'commit-labor-two-hours-total','commit-labor-zero-quantity-finite' then
      bundle:=pg_temp.ga_labor(false,'active',case when case_key='commit-labor-two-hours-total' then 2 else 0 end,4000);
      r:=pg_temp.ga_call(p=>bundle->'prepared',u=>bundle->'updates',footer=>bundle->'footer',ctx=>bundle->'context',preferred=>bundle->'preferred');
      perform pg_temp.ga_assert((select labor_role_id=pg_temp.ga_id(601) and default_quantity=case when case_key='commit-labor-two-hours-total' then 2 else 0 end and h_mo=case when case_key='commit-labor-two-hours-total' then 2 else 0 end and unit_cost_ht_cents=4000 from public.estimate_assembly_items where assembly_id=pg_temp.ga_id(802)),'Library quantity/hours/role are not exact totals');
      perform pg_temp.ga_assert((select ds_cents=case when case_key='commit-labor-two-hours-total' then 8000 else 0 end and coalesce(avg_time_hours,0)=case when case_key='commit-labor-two-hours-total' then 2 else 0 end from public.estimate_assemblies where id=pg_temp.ga_id(802)),'Library doubled hours or lost finite zero quantity');
    when 'stale-after-decision-roundtrip' then
      b:=jsonb_set(jsonb_set(b,'{components,0,status}','"rejected"'),'{status}','"pending_review"'); b:=jsonb_set(b,'{summary}',b->'summary'||'{"component_count":0,"ds_cents":0,"indicative_target_price_cents":0}'::jsonb); r:=pg_temp.ga_save(body=>b);
      perform pg_temp.ga_sync(); b:=pg_temp.ga_input(); b:=jsonb_set(b,'{components,0}',b->'components'->0||'{"status":"manual","restore":true}'::jsonb); b:=jsonb_set(b,'{status}','"reviewed"'); b:=jsonb_set(b,'{summary}',b->'summary'||'{"component_count":1,"ds_cents":3,"indicative_target_price_cents":3}'::jsonb); r:=pg_temp.ga_save(body=>b);
      perform pg_temp.ga_refusal(format('select pg_temp.ga_call(a=>%L)',a),'GENERATED_OUVRAGE_REVIEW_CHANGED');
    when 'review-rejection-late-source-rollback' then
      b:=jsonb_set(jsonb_set(b,'{components,0,status}','"rejected"'),'{status}','"pending_review"'); perform set_config('ga.fault','estimate_generated_ouvrage_subdetail_item_sources',true); perform pg_temp.ga_refusal(format('select pg_temp.ga_save(body=>%L)',b),'GENERATED_NATIVE_LATE_FAULT');
    when 'cctp-rejected-legacy-target-incompatible','cctp-legacy-target-without-status-compatible' then
      r:=pg_temp.ga_call(); perform pg_temp.ga_actor(null,'none');
      update public.estimate_generated_ouvrage_work_snapshots set components=case when case_key='cctp-rejected-legacy-target-incompatible' then jsonb_set(components,'{0,status}','"rejected"') else jsonb_build_array((components->0)-'status') end where id=pg_temp.ga_id(804);
      r:=pg_temp.ga_target(); perform pg_temp.ga_assert(r->>'state'=case when case_key='cctp-rejected-legacy-target-incompatible' then 'incompatible' else 'available' end,'Legacy component CCTP target validity differs');
    else raise exception 'Unknown CORE07 component case %',case_key;
    end case;
  end $f$;
  $helpers$;
  foreach case_name in array array[
    'review-reject-manual-origin','review-reject-suggested-origin','review-edit-before-reject-origin','review-rejected-edit-without-decision','review-rejected-uppercase-id-restore-refused','review-suggested-edit-history',
    'review-restore-manual','review-restore-suggested','review-restore-and-edit','review-restore-and-reject','review-restore-edit-and-reject',
    'review-known-restore-missing-marker','review-legacy-restore-unknown-refused','review-legacy-restore-explicit-manual',
    'review-restore-marker-misuse','review-origin-input-forged','review-both-restore-markers','review-proposal-omission-refused','review-new-rejected-human-origin-manual','review-all-rejected-save-pending','review-all-rejected-reviewed-refused',
    'commit-retained-subset','commit-library-component-provenance-identity','commit-rejected-projection-refused','commit-retained-missing-refused','commit-duplicate-retained-id-refused','commit-foreign-retained-id-refused',
    'commit-all-rejected-refused','commit-zero-retained-material','commit-labor-preferred-role-library','commit-free-labor-hours-library','commit-free-labor-no-role-refused','commit-free-labor-inactive-role-refused','commit-labor-two-hours-total','commit-labor-zero-quantity-finite',
    'stale-after-decision-roundtrip','review-rejection-late-source-rollback','cctp-rejected-legacy-target-incompatible','cctp-legacy-target-without-status-compatible'
  ] loop
    passed:=false; failure:=null;
    begin perform pg_temp.ga_case(case_name); raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true; when others then failure:=sqlstate||': '||sqlerrm; end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='ESTIMATE_GENERATED_COMPONENTS_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','cfc70000','concurrencyExecuted',false,'cases',results)::text;
end;
$generated_components_probe$;
