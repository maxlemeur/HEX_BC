-- Written before the coverage migration. Native metadata/SQL proof only.
-- Always embedded in a single DO ending with forced rollback P9001.
do $coverage_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure text; ticket jsonb; a uuid; b uuid;
begin
  perform set_config('statement_timeout','60s',true);
  perform set_config('lock_timeout','500ms',true);
  if exists(select 1 from auth.users where id::text like 'dc510000-%') then raise exception 'Fixture prefix already exists'; end if;
  execute $helpers$
  create function pg_temp.cov_id(n integer) returns uuid language sql immutable as $f$
    select ('dc510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  $f$;
  create function pg_temp.cov_assert(ok boolean,detail text) returns void language plpgsql as $f$
    begin if ok is distinct from true then raise exception using message=detail; end if; end
  $f$;
  create function pg_temp.cov_actor(n integer default 1,db_role text default 'authenticated') returns void language plpgsql as $f$
  begin
    perform set_config('role','none',true);
    perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.cov_id(n)::text end,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.cov_id(n) end,'role',db_role)::text,true);
    perform set_config('role',db_role,true);
  end $f$;
  create function pg_temp.cov_error(command text,expected text default null) returns void language plpgsql as $f$
  declare message text; state text;
  begin
    begin execute command; exception when others then get stacked diagnostics message=message_text,state=returned_sqlstate; end;
    perform pg_temp.cov_assert(state is not null and state<>'42883' and (expected is null or message=expected),format('Expected refusal %s, got %s/%s',expected,state,message));
  end $f$;
  $helpers$;
  insert into auth.users(id,email,raw_user_meta_data)
    select pg_temp.cov_id(n),'coverage-native-'||n||'@example.invalid',jsonb_build_object('full_name','Coverage actor '||n) from generate_series(1,7)n;
  update public.tenant_memberships set is_default=false where user_id::text like 'dc510000-%';
  insert into public.tenants(id,name,slug) values(pg_temp.cov_id(101),'Coverage T1','coverage-native-t1'),(pg_temp.cov_id(102),'Coverage T2','coverage-native-t2');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
    select pg_temp.cov_id(101),pg_temp.cov_id(n),(case n when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' else 'engineer' end)::public.tenant_role,true,'2020-01-01' from generate_series(1,6)n;
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values(pg_temp.cov_id(102),pg_temp.cov_id(1),'admin',false,'2021-01-01');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values
    (pg_temp.cov_id(201),pg_temp.cov_id(101),pg_temp.cov_id(1),'ARMY coverage P'),
    (pg_temp.cov_id(202),pg_temp.cov_id(101),pg_temp.cov_id(5),'ARMY coverage other P'),
    (pg_temp.cov_id(203),pg_temp.cov_id(102),pg_temp.cov_id(1),'ARMY coverage T2 P');
  insert into public.estimate_versions(id,project_id,version_number,calc_engine_version,max_section_depth,total_ht_cents,total_tax_cents,total_ttc_cents)
    values(pg_temp.cov_id(301),pg_temp.cov_id(201),1,2,1,71000,14200,85200),
    (pg_temp.cov_id(302),pg_temp.cov_id(202),1,2,1,0,0,0),
    (pg_temp.cov_id(303),pg_temp.cov_id(203),1,2,1,0,0,0),
    (pg_temp.cov_id(304),pg_temp.cov_id(201),2,2,1,0,0,0);
  insert into public.estimate_items(id,version_id,item_type,title,position) values
    (pg_temp.cov_id(501),pg_temp.cov_id(301),'section','SA',1),(pg_temp.cov_id(502),pg_temp.cov_id(301),'section','SB',2),
    (pg_temp.cov_id(505),pg_temp.cov_id(304),'section','Other version section',1);
  insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents) values(pg_temp.cov_id(321),pg_temp.cov_id(101),pg_temp.cov_id(1),'Coverage native pose',4000);
  insert into public.estimate_items(id,version_id,parent_id,item_type,title,description,quantity,unit_price_ht_cents,k_fo,h_mo,k_mo,tax_rate_bp,position,line_nature,labor_role_id,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
    values(pg_temp.cov_id(511),pg_temp.cov_id(301),pg_temp.cov_id(501),'line','CH-A calorifuge','m',10,4000,0.5,5,1,2000,1,'supply_and_labor',pg_temp.cov_id(321),4000,40000,8000,48000),
    (pg_temp.cov_id(512),pg_temp.cov_id(301),pg_temp.cov_id(501),'line','Protection droite','m',4,1000,1,1,1,2000,2,'supply_and_labor',pg_temp.cov_id(321),2000,8000,1600,9600),
    (pg_temp.cov_id(513),pg_temp.cov_id(301),pg_temp.cov_id(501),'line','Raccords','u',2,1500,1,0.5,1,2000,3,'supply_and_labor',pg_temp.cov_id(321),2500,5000,1000,6000),
    (pg_temp.cov_id(514),pg_temp.cov_id(301),pg_temp.cov_id(502),'line','ECS-B sans calorifuge','m',6,2000,1,1.5,1,2000,1,'supply_and_labor',pg_temp.cov_id(321),3000,18000,3600,21600),
    (pg_temp.cov_id(515),pg_temp.cov_id(304),pg_temp.cov_id(505),'line','Other version','m',6,2000,1,1,1,2000,1,'supply_and_labor',pg_temp.cov_id(321),2667,16000,3200,19200);
  insert into public.affaire_intake_uploads(id,tenant_id,project_id,status) values(pg_temp.cov_id(401),pg_temp.cov_id(101),pg_temp.cov_id(201),'ready');
  insert into public.affaire_intake_documents(id,tenant_id,project_id,upload_id,file_name,mime_type,size_bytes,upload_status,document_kind,storage_path)
    select pg_temp.cov_id(n),pg_temp.cov_id(101),pg_temp.cov_id(201),pg_temp.cov_id(401),'CCTP.pdf','application/pdf',1234,'uploaded','cctp',
      pg_temp.cov_id(101)||'/'||pg_temp.cov_id(201)||'/'||pg_temp.cov_id(401)||'/'||pg_temp.cov_id(n)||'/CCTP.pdf' from generate_series(411,412)n;
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('estimate-source-references','estimate-source-references',false,52428800,array['application/pdf']) on conflict(id) do nothing;
  for i in 411..412 loop
    perform pg_temp.cov_actor();
    ticket:=public.reserve_estimate_source_reference_copy(pg_temp.cov_id(301),pg_temp.cov_id(i),0,pg_temp.cov_id(1000+i));
    perform pg_temp.cov_actor(null,'none');
    insert into storage.objects(bucket_id,name,metadata) values('estimate-source-references',ticket->'destination_locator'->>'path','{"size":1234,"mimetype":"application/pdf"}');
    perform pg_temp.cov_actor(null,'service_role');
    perform public.complete_estimate_source_reference_copy((ticket->>'copy_id')::uuid,repeat(case i when 411 then 'a' else 'b' end,64),1234,3);
    if i=411 then a:=(ticket->>'copy_id')::uuid; else b:=(ticket->>'copy_id')::uuid; end if;
  end loop;
  perform public.confirm_estimate_source_reference(pg_temp.cov_id(1),pg_temp.cov_id(301),a,0,pg_temp.cov_id(2001),repeat('a',64),'A reviewed');
  perform set_config('coverage.copy_a',a::text,true); perform set_config('coverage.copy_b',b::text,true);
  perform pg_temp.cov_actor(null,'none');
  insert into public.estimate_generated_ouvrage_drafts(id,tenant_id,project_id,target_version_id,created_by,source_kind,status)
    values(pg_temp.cov_id(701),pg_temp.cov_id(101),pg_temp.cov_id(201),pg_temp.cov_id(301),pg_temp.cov_id(1),'cctp_excerpt','applied');
  insert into public.estimate_generated_ouvrage_candidates(id,tenant_id,project_id,target_version_id,draft_id,candidate_order,designation,normalized_designation,unit,quantity,confidence,ai_status,resolution_status)
    values(pg_temp.cov_id(711),pg_temp.cov_id(101),pg_temp.cov_id(201),pg_temp.cov_id(301),pg_temp.cov_id(701),0,'CH-A calorifuge','ch-a calorifuge','m',10,1,'certain','inserted');
  insert into public.estimate_generated_ouvrage_applications(id,tenant_id,draft_id,candidate_id,target_version_id,estimate_item_id,applied_payload)
    values(pg_temp.cov_id(721),pg_temp.cov_id(101),pg_temp.cov_id(701),pg_temp.cov_id(711),pg_temp.cov_id(301),pg_temp.cov_id(511),jsonb_build_object('designation','CH-A calorifuge','unit','m','quantity',10,'lot_id',pg_temp.cov_id(501),'estimate_item_mapping',jsonb_build_object('hMo',5,'laborRoleId',pg_temp.cov_id(321))));
  insert into public.estimate_generated_ouvrage_work_snapshots(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,estimate_item_id,summary,components,metadata)
    values(pg_temp.cov_id(731),pg_temp.cov_id(101),pg_temp.cov_id(201),pg_temp.cov_id(301),pg_temp.cov_id(701),pg_temp.cov_id(711),pg_temp.cov_id(511),'{"dsCents":40000,"componentCount":3}',
    '[{"componentId":"C-ISO","designation":"Calorifuge 30 mm","unit":"m","quantity":10,"costType":"material","unitCostHtCents":800,"lossCoeffBp":0,"yieldValue":null,"yieldUnit":null},{"componentId":"C-TUBE","designation":"Tube","unit":"m","quantity":10,"costType":"material","unitCostHtCents":1200,"lossCoeffBp":0,"yieldValue":null,"yieldUnit":null},{"componentId":"C-POSE","designation":"Pose","unit":"h","quantity":5,"costType":"labor","unitCostHtCents":4000,"lossCoeffBp":0,"yieldValue":null,"yieldUnit":null}]',
    jsonb_build_object('applied_values',jsonb_build_object('designation','CH-A calorifuge','unit','m','quantity',10,'lot_id',pg_temp.cov_id(501)),'estimate_item_mapping',jsonb_build_object('hMo',5,'laborRoleId',pg_temp.cov_id(321))));
  insert into public.affaire_register_entries(id,tenant_id,project_id,version_id,kind,text,scope_type,scope_id,scope_label,created_by)
    values(pg_temp.cov_id(601),pg_temp.cov_id(101),pg_temp.cov_id(201),pg_temp.cov_id(301),'assumption','Accès à confirmer','lot',pg_temp.cov_id(502),'SB',pg_temp.cov_id(1)),
    (pg_temp.cov_id(602),pg_temp.cov_id(101),pg_temp.cov_id(201),pg_temp.cov_id(301),'missing_piece','Détail D-B attendu','lot',pg_temp.cov_id(502),'SB',pg_temp.cov_id(1));
  execute $helpers$
  create function pg_temp.cov_dimensions() returns void language plpgsql as $f$
  begin
    perform pg_temp.cov_actor();
    perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(801),0,pg_temp.cov_id(20801),'create','{"kind":"zone","label":"Zone A","extentNote":"Chaufferie"}');
    perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(802),0,pg_temp.cov_id(20802),'create','{"kind":"network","label":"CH-A","extentNote":null}');
    perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(803),0,pg_temp.cov_id(20803),'create','{"kind":"zone","label":"Zone B","extentNote":"Etage"}');
    perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(804),0,pg_temp.cov_id(20804),'create','{"kind":"network","label":"ECS-B","extentNote":null}');
  end $f$;
  create function pg_temp.cov_payload(n integer,links jsonb default null,complete boolean default true) returns jsonb language sql as $f$
    select jsonb_build_object('prescription','Prescription '||n,'expectedService','Prestation '||n,
      'scope',jsonb_build_object('mode','specified','zoneId',pg_temp.cov_id(case when n>=7 then 803 else 801 end),'networkId',pg_temp.cov_id(case when n>=7 then 804 else 802 end),'dpgfLotId',pg_temp.cov_id(case when n>=7 then 502 else 501 end)),
      'completeness',case when complete then 'complete' else 'partial' end,'completenessReason',case when complete then 'Toute la prestation a été revue' else null end,
      'citations',jsonb_build_array(jsonb_build_object('id',pg_temp.cov_id(10000+n),'copyId',current_setting('coverage.copy_a')::uuid,'page',2,'folio','CVC-10','excerpt','Clause '||n)),
      'links',coalesce(links,jsonb_build_array(jsonb_build_object('id',pg_temp.cov_id(9000+n),'kind','line','itemId',pg_temp.cov_id(512),'justification','Prestation explicitement identifiée'))))
  $f$;
  create function pg_temp.cov_get(n integer) returns jsonb language sql as $f$
    select public.get_estimate_source_coverage(pg_temp.cov_id(301),pg_temp.cov_id(8000+n))->'selectedRequirement'
  $f$;
  create function pg_temp.cov_req(n integer,links jsonb default null,complete boolean default true,verify boolean default true) returns jsonb language plpgsql as $f$
  declare result jsonb;
  begin
    perform pg_temp.cov_dimensions();
    result:=public.mutate_estimate_source_requirement(pg_temp.cov_id(301),pg_temp.cov_id(8000+n),0,1,pg_temp.cov_id(11000+n),'create',pg_temp.cov_payload(n,links,complete));
    if verify then
      perform pg_temp.cov_actor(null,'service_role');
      perform public.verify_estimate_source_requirement_citation(pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8000+n),pg_temp.cov_id(10000+n),1,1,repeat('a',64),pg_temp.cov_id(12000+n));
      perform pg_temp.cov_actor();
    end if;
    return pg_temp.cov_get(n);
  end $f$;
  create function pg_temp.cov_decide(n integer,treatment text default 'priced',key_no integer default null) returns jsonb language plpgsql as $f$
  declare preview jsonb; result jsonb; decision jsonb;
  begin
    preview:=public.preview_estimate_source_coverage_decision(pg_temp.cov_id(301),pg_temp.cov_id(8000+n));
    decision:=jsonb_build_object('treatment',treatment,'reason','Traitement revu','otherLot',case when treatment='other_lot' then 'Electricité' else null end,'uncertainty',case when treatment='provisional' then 'Détail et accès attendus' else null end,'completeness','complete');
    perform pg_temp.cov_actor(null,'service_role');
    result:=public.decide_estimate_source_requirement(pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8000+n),
      (preview->>'requirementRevision')::bigint,(preview->>'referenceRevision')::bigint,(preview->>'contentRevision')::bigint,preview->>'reviewedFingerprint',pg_temp.cov_id(coalesce(key_no,13000+n)),decision);
    perform pg_temp.cov_actor(); return result;
  end $f$;
  create function pg_temp.cov_case(name text) returns void language plpgsql as $f$
  declare r jsonb; before_row jsonb; p jsonb; result jsonb; links jsonb; item_record public.estimate_items%rowtype; event_id uuid;
  begin
    perform pg_temp.cov_actor();
    if name='empty-no-write' then
      r:=public.get_estimate_source_coverage(pg_temp.cov_id(301));
      perform pg_temp.cov_assert(r->'counts'->>'total'='0' and r->'requirements'='[]' and r->>'referenceRevision'='1','Initial coverage not empty'); return;
    elsif name='acl' then
      perform pg_temp.cov_error('select * from private.estimate_source_coverage_requirements');
      perform pg_temp.cov_error('select * from private.estimate_source_coverage_events');
      perform pg_temp.cov_error(format('select public.verify_estimate_source_requirement_citation(%L,%L,%L,%L,1,1,repeat(''a'',64),%L)',pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),pg_temp.cov_id(10001),pg_temp.cov_id(40001)));
      perform pg_temp.cov_actor(null,'anon'); perform pg_temp.cov_error(format('select public.get_estimate_source_coverage(%L)',pg_temp.cov_id(301))); return;
    elsif name='reader-rights' then
      perform pg_temp.cov_actor(3); r:=public.get_estimate_source_coverage(pg_temp.cov_id(301));
      perform pg_temp.cov_assert(r->>'canWrite'='false','Director can write');
      perform pg_temp.cov_actor(5); perform pg_temp.cov_error(format('select public.get_estimate_source_coverage(%L)',pg_temp.cov_id(301)),'SOURCE_COVERAGE_ACCESS_DENIED');
      perform pg_temp.cov_actor(2); r:=public.get_estimate_source_coverage(pg_temp.cov_id(301)); perform pg_temp.cov_assert(r->>'canWrite'='true','Admin cannot write'); return;
    elsif name='component-inclusion' or name='stale-component' or name='cascade-history' then
      links:=jsonb_build_array(jsonb_build_object('id',pg_temp.cov_id(9001),'kind','component','itemId',pg_temp.cov_id(511),'applicationId',pg_temp.cov_id(721),'snapshotId',pg_temp.cov_id(731),'componentId','C-ISO','justification','Calorifuge appliqué et relu'));
      perform pg_temp.cov_req(1,links); perform pg_temp.cov_decide(1,'included');
      r:=pg_temp.cov_get(1); perform pg_temp.cov_assert(r->>'validity'='current','Real component inclusion not current'); before_row:=r->'lastDecision';
      if name='component-inclusion' then perform pg_temp.cov_assert(before_row->'facts'->'targets'->0->'fact'->>'quantity'='10','Component facts not captured'); return; end if;
      perform pg_temp.cov_actor(null,'none');
      if name='stale-component' then update public.estimate_items set quantity=12 where id=pg_temp.cov_id(511);
      else delete from public.estimate_generated_ouvrage_drafts where id=pg_temp.cov_id(701); end if;
      perform pg_temp.cov_actor(); r:=pg_temp.cov_get(1);
      perform pg_temp.cov_assert(r->>'validity'='needs_review' and r->'lastDecision'=before_row,'Snapshot loss erased proof or stayed valid');
      perform pg_temp.cov_error('select pg_temp.cov_decide(1,''included'',40002)'); return;
    elsif name='partial' then
      perform pg_temp.cov_req(1,null,false); perform pg_temp.cov_error('select pg_temp.cov_decide(1)','SOURCE_COVERAGE_INCOMPLETE'); return;
    elsif name='unverified' then
      r:=pg_temp.cov_req(1,null,true,false); perform pg_temp.cov_assert(r->'citations'->0->'verification'='null','Typed citation was verified');
      perform pg_temp.cov_error('select pg_temp.cov_decide(1)','SOURCE_COVERAGE_CITATION_NOT_VERIFIED'); return;
    elsif name='citation-page' then
      perform pg_temp.cov_dimensions(); p:=jsonb_set(pg_temp.cov_payload(1),'{citations,0,page}','4');
      perform pg_temp.cov_error(format('select public.mutate_estimate_source_requirement(%L,%L,0,1,%L,''create'',%L::jsonb)',pg_temp.cov_id(301),pg_temp.cov_id(8001),pg_temp.cov_id(40001),p)); return;
    elsif name='bad-target' then
      perform pg_temp.cov_dimensions();
      foreach event_id in array array[pg_temp.cov_id(501),pg_temp.cov_id(515)] loop
        p:=jsonb_set(pg_temp.cov_payload(1),'{links,0,itemId}',to_jsonb(event_id));
        perform pg_temp.cov_error(format('select public.mutate_estimate_source_requirement(%L,%L,0,1,%L,''create'',%L::jsonb)',pg_temp.cov_id(301),pg_temp.cov_id(8001),pg_temp.cov_id(40001),p));
      end loop; return;
    elsif name='register-invalidation' or name='register-incompatible' then
      links:=jsonb_build_array(jsonb_build_object('id',pg_temp.cov_id(9007),'kind','register','registerEntryId',pg_temp.cov_id(601),'justification','Accès à confirmer pour zone B'));
      if name='register-incompatible' then
        perform pg_temp.cov_dimensions(); p:=pg_temp.cov_payload(1,links);
        perform pg_temp.cov_error(format('select public.mutate_estimate_source_requirement(%L,%L,0,1,%L,''create'',%L::jsonb)',pg_temp.cov_id(301),pg_temp.cov_id(8001),pg_temp.cov_id(40001),p)); return;
      end if;
      perform pg_temp.cov_req(7,links); perform pg_temp.cov_decide(7,'provisional');
      perform pg_temp.cov_actor(null,'service_role');
      perform public.update_affaire_register_entry_with_event(pg_temp.cov_id(601),'{"status":"validated"}','status_changed','Native source change',null,null,pg_temp.cov_id(1));
      perform pg_temp.cov_actor(); r:=pg_temp.cov_get(7);
      perform pg_temp.cov_assert(r->>'validity'='needs_review' and r->>'treatment'='provisional','Register resolution confirmed coverage');
      -- Existing C17/C21: precise exception-scope change, written before fix.
      perform pg_temp.cov_actor(null,'none');
      update public.affaire_register_entries set scope_type='exception',scope_id=null,scope_ref='Traversée A',scope_label='Traversée spéciale' where id=pg_temp.cov_id(601);
      perform pg_temp.cov_actor(); perform pg_temp.cov_decide(7,'provisional',40003);
      perform pg_temp.cov_assert(pg_temp.cov_get(7)->>'validity'='current','Exception baseline not current');
      perform pg_temp.cov_actor(null,'none'); update public.affaire_register_entries set scope_ref='Traversée B' where id=pg_temp.cov_id(601);
      perform pg_temp.cov_actor(); perform pg_temp.cov_assert(pg_temp.cov_get(7)->>'validity'='needs_review','Changed exception scope retained current decision'); return;
    end if;
    r:=pg_temp.cov_req(1); before_row:=pg_temp.cov_decide(1); r:=pg_temp.cov_get(1);
    perform pg_temp.cov_assert(r->>'validity'='current','Baseline decision failed');
    case name
    when 'line-aba' then
      perform pg_temp.cov_actor(null,'none'); update public.estimate_items set quantity=5 where id=pg_temp.cov_id(512); update public.estimate_items set quantity=4 where id=pg_temp.cov_id(512);
      perform pg_temp.cov_actor(); perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='needs_review','Quantity ABA restored validity');
    when 'nontechnical' then
      perform pg_temp.cov_actor(null,'none'); update public.estimate_items set unit_price_ht_cents=1200,position=30 where id=pg_temp.cov_id(512); update public.estimate_items set quantity=7 where id=pg_temp.cov_id(514); update public.estimate_versions set margin_multiplier=1.1 where id=pg_temp.cov_id(301);
      perform pg_temp.cov_actor(); perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='current','Price/order/margin/unrelated item invalidated');
    when 'dimension-label-extent' then
      perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(801),1,pg_temp.cov_id(40001),'update','{"kind":"zone","label":"Zone A corrigée","extentNote":"Chaufferie"}');
      perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='current','Label invalidated');
      perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(801),2,pg_temp.cov_id(40002),'update','{"kind":"zone","label":"Zone A corrigée","extentNote":"Chaufferie élargie"}');
      perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(301),pg_temp.cov_id(801),3,pg_temp.cov_id(40003),'update','{"kind":"zone","label":"Zone A corrigée","extentNote":"Chaufferie"}');
      perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='needs_review','Extent ABA restored validity');
    when 'requirement-aba' then
      p:=pg_temp.cov_payload(1)||'{"prescription":"Changed"}';
      perform public.mutate_estimate_source_requirement(pg_temp.cov_id(301),pg_temp.cov_id(8001),(r->>'revision')::bigint,1,pg_temp.cov_id(40001),'update',p);
      perform public.mutate_estimate_source_requirement(pg_temp.cov_id(301),pg_temp.cov_id(8001),(r->>'revision')::bigint+1,1,pg_temp.cov_id(40002),'update',pg_temp.cov_payload(1));
      perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='needs_review','Requirement ABA restored validity');
    when 'reference-B' then
      perform pg_temp.cov_actor(null,'service_role');
      perform public.confirm_estimate_source_reference(pg_temp.cov_id(1),pg_temp.cov_id(301),current_setting('coverage.copy_b')::uuid,1,pg_temp.cov_id(2002),repeat('b',64),'B reviewed');
      perform pg_temp.cov_actor(); perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='needs_review','B did not invalidate A');
      perform pg_temp.cov_error('select pg_temp.cov_decide(1,''priced'',40001)','SOURCE_COVERAGE_CITATION_NOT_VERIFIED');
    when 'replay' then
      p:=before_row->'receipt'->'canonicalRequest'->'request'; perform pg_temp.cov_actor(null,'service_role');
      result:=public.decide_estimate_source_requirement(pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),(p->>'expectedRequirementRevision')::bigint,(p->>'expectedReferenceRevision')::bigint,(p->>'expectedContentRevision')::bigint,p->>'reviewedFingerprint',(p->>'operationKey')::uuid,p->'decision');
      perform pg_temp.cov_assert(result->'receipt'=before_row->'receipt' and result->>'replayed'='true','Replay changed receipt');
      perform pg_temp.cov_error(format('select public.decide_estimate_source_requirement(%L,%L,%L,%s,1,%s,%L,%L,%L::jsonb)',pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),p->>'expectedRequirementRevision',p->>'expectedContentRevision',p->>'reviewedFingerprint',p->>'operationKey',jsonb_set(p->'decision','{reason}','"Different"')),'SOURCE_COVERAGE_IDEMPOTENCY_CONFLICT');
    when 'preview-stale' then
      p:=public.preview_estimate_source_coverage_decision(pg_temp.cov_id(301),pg_temp.cov_id(8001));
      perform pg_temp.cov_actor(null,'none'); update public.estimate_items set quantity=5 where id=pg_temp.cov_id(512);
      perform pg_temp.cov_actor(null,'service_role');
      perform pg_temp.cov_error(format('select public.decide_estimate_source_requirement(%L,%L,%L,%s,1,%s,%L,%L,%L::jsonb)',pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),p->>'requirementRevision',p->>'contentRevision',p->>'reviewedFingerprint',pg_temp.cov_id(40001),'{"treatment":"priced","reason":"Stale","otherLot":null,"uncertainty":null,"completeness":"complete"}'),'SOURCE_COVERAGE_STALE');
    when 'delete-reinsert' then
      perform pg_temp.cov_actor(null,'none'); select * into item_record from public.estimate_items where id=pg_temp.cov_id(512); delete from public.estimate_items where id=item_record.id; insert into public.estimate_items select (item_record).*;
      perform pg_temp.cov_actor(); perform pg_temp.cov_assert(pg_temp.cov_get(1)->>'validity'='needs_review','Deleted identity resurrected decision');
    when 'archive-reopen' then
      perform public.mutate_estimate_source_requirement(pg_temp.cov_id(301),pg_temp.cov_id(8001),(r->>'revision')::bigint,1,pg_temp.cov_id(40001),'archive','{"reason":"Duplicate prescription"}');
      result:=public.get_estimate_source_coverage(pg_temp.cov_id(301)); perform pg_temp.cov_assert(result->'counts'->>'total'='0','Archived requirement counted');
      r:=pg_temp.cov_get(1); perform public.mutate_estimate_source_requirement(pg_temp.cov_id(301),pg_temp.cov_id(8001),(r->>'revision')::bigint,1,pg_temp.cov_id(40002),'reopen','{"reason":"Reconsidered"}');
      r:=pg_temp.cov_get(1); perform pg_temp.cov_assert(r->>'validity'='needs_review' and r->'lastDecision' is not null,'Reopen lost or silently validated history');
    when 'history-immutable' then
      perform pg_temp.cov_actor(null,'none'); event_id:=(before_row->'receipt'->>'eventId')::uuid;
      perform pg_temp.cov_error(format('delete from private.estimate_source_coverage_events where id=%L',event_id));
      perform pg_temp.cov_error(format('update private.estimate_source_coverage_events set actor_id=%L where id=%L',pg_temp.cov_id(2),event_id));
      -- C29 precise counterexample found during review, written before its fix:
      -- a dimension receipt can exist before the first source-reference review.
      perform pg_temp.cov_actor();
      perform public.mutate_estimate_source_coverage_dimension(pg_temp.cov_id(304),pg_temp.cov_id(805),0,pg_temp.cov_id(40029),'create','{"kind":"zone","label":"Avant référence","extentNote":null}');
      perform pg_temp.cov_actor(null,'none');
      perform pg_temp.cov_assert(not exists(select 1 from private.estimate_source_reviews where version_id=pg_temp.cov_id(304)),'Pre-reference probe unexpectedly has a review');
      perform pg_temp.cov_error(format('update public.estimate_versions set project_id=%L where id=%L',pg_temp.cov_id(202),pg_temp.cov_id(304)),'SOURCE_COVERAGE_ACCESS_DENIED');
    when 'source-metadata-loss-replay' then
      p:=before_row->'receipt'->'canonicalRequest'->'request'; perform pg_temp.cov_actor(null,'none'); perform set_config('storage.allow_delete_query','true',true);
      delete from storage.objects where id=(select storage_object_id from private.estimate_source_reference_copies where id=current_setting('coverage.copy_a')::uuid);
      perform pg_temp.cov_actor(null,'service_role');
      result:=public.decide_estimate_source_requirement(pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),(p->>'expectedRequirementRevision')::bigint,1,(p->>'expectedContentRevision')::bigint,p->>'reviewedFingerprint',(p->>'operationKey')::uuid,p->'decision');
      perform pg_temp.cov_assert(result->>'replayed'='true','Historical replay depends on source availability');
    when 'role-replay' then
      p:=before_row->'receipt'->'canonicalRequest'->'request'; perform pg_temp.cov_actor(null,'none'); update public.tenant_memberships set role='viewer' where user_id=pg_temp.cov_id(1) and tenant_id=pg_temp.cov_id(101);
      perform pg_temp.cov_actor(null,'service_role'); perform pg_temp.cov_error(format('select public.decide_estimate_source_requirement(%L,%L,%L,%s,1,%s,%L,%L,%L::jsonb)',pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),p->>'expectedRequirementRevision',p->>'expectedContentRevision',p->>'reviewedFingerprint',p->>'operationKey',p->'decision'));
      perform pg_temp.cov_actor(); result:=public.get_estimate_source_coverage(pg_temp.cov_id(301)); perform pg_temp.cov_assert(result->>'canWrite'='false','Owner viewer read lost');
    when 'target-catalogue' then
      result:=public.get_estimate_source_coverage_targets(pg_temp.cov_id(301),'line','',null,2); perform pg_temp.cov_assert(jsonb_array_length(result->'items')=2 and result->>'nextAfterId' is not null,'Catalogue page broken');
      p:=public.get_estimate_source_coverage_targets(pg_temp.cov_id(301),'line','',(result->>'nextAfterId')::uuid,2);
      perform pg_temp.cov_assert(jsonb_array_length(p->'items')=2 and p->'nextAfterId'='null' and p->'items'->0->>'id'<>result->'items'->0->>'id','Catalogue repeats/truncates');
      result:=public.get_estimate_source_coverage_targets(pg_temp.cov_id(301),'component','',null,50); perform pg_temp.cov_assert(jsonb_array_length(result->'items')=1 and jsonb_array_length(result->'items'->0->'components')=3 and result::text not like '%unitCost%','Catalogue leaks costs or loses components');
    when 'financial-unchanged' then
      perform pg_temp.cov_actor(null,'none'); select to_jsonb(v) into p from public.estimate_versions v where id=pg_temp.cov_id(301);
      perform pg_temp.cov_assert(p->>'total_ht_cents'='71000' and p->>'total_tax_cents'='14200' and p->>'total_ttc_cents'='85200','Coverage changed totals');
      perform pg_temp.cov_assert((select count(*)=6 and sum(h_mo)=8 from public.estimate_items where version_id=pg_temp.cov_id(301)),'Coverage changed lines/hours');
    when 'unspecified' then
      p:=jsonb_set(pg_temp.cov_payload(1),'{scope}','{"mode":"unspecified","zoneId":null,"networkId":null,"dpgfLotId":null}');
      perform public.mutate_estimate_source_requirement(pg_temp.cov_id(301),pg_temp.cov_id(8001),(r->>'revision')::bigint,1,pg_temp.cov_id(40001),'update',p);
      perform pg_temp.cov_error('select pg_temp.cov_decide(1,''priced'',40002)','SOURCE_COVERAGE_INCOMPLETE');
    when 'duplicate-target' then
      p:=pg_temp.cov_payload(1); p:=jsonb_set(p,'{links}',(p->'links')||jsonb_build_array(jsonb_set(p->'links'->0,'{id}',to_jsonb(pg_temp.cov_id(49001)))));
      perform pg_temp.cov_error(format('select public.mutate_estimate_source_requirement(%L,%L,%s,1,%L,''update'',%L::jsonb)',pg_temp.cov_id(301),pg_temp.cov_id(8001),r->>'revision',pg_temp.cov_id(40001),p),'SOURCE_COVERAGE_INVALID_INPUT');
    when 'citation-hash' then
      perform pg_temp.cov_actor(null,'service_role'); perform pg_temp.cov_error(format('select public.verify_estimate_source_requirement_citation(%L,%L,%L,%L,%s,1,repeat(''b'',64),%L)',pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),pg_temp.cov_id(10001),r->>'revision',pg_temp.cov_id(40001)),'SOURCE_COVERAGE_STALE');
    when 'event-atomic' then
      perform pg_temp.cov_actor(null,'none');
      execute 'create function pg_temp.cov_fail_event() returns trigger language plpgsql as ''begin raise exception using errcode=''''P9009'''',message=''''COVERAGE_EVENT_FAILURE''''; end''';
      execute 'create trigger zz_cov_injected_failure before insert on private.estimate_source_coverage_events for each row execute function pg_temp.cov_fail_event()';
      perform pg_temp.cov_actor(); perform pg_temp.cov_error('select pg_temp.cov_decide(1,''priced'',40001)','COVERAGE_EVENT_FAILURE');
      perform pg_temp.cov_actor(); perform pg_temp.cov_assert(pg_temp.cov_get(1)=r,'Failed event partially changed requirement');
    when 'revision-overflow' then
      perform pg_temp.cov_actor(null,'none'); update private.estimate_source_coverage_requirements set revision=9007199254740991 where id=pg_temp.cov_id(8001);
      perform pg_temp.cov_actor(); perform pg_temp.cov_error(format('select public.mutate_estimate_source_requirement(%L,%L,9007199254740991,1,%L,''update'',%L::jsonb)',pg_temp.cov_id(301),pg_temp.cov_id(8001),pg_temp.cov_id(40001),pg_temp.cov_payload(1)),'SOURCE_COVERAGE_REVISION_OVERFLOW');
    when 'shared-dimension-version-delete' then
      perform pg_temp.cov_actor(null,'none'); delete from public.estimate_versions where id=pg_temp.cov_id(301);
      perform pg_temp.cov_actor(); result:=public.get_estimate_source_coverage(pg_temp.cov_id(304));
      perform pg_temp.cov_assert(jsonb_array_length(result->'dimensions')=4 and result->'counts'->>'total'='0','Version cascade deleted project dimensions or copied coverage');
    when 'nondraft-replay' then
      p:=before_row->'receipt'->'canonicalRequest'->'request'; perform pg_temp.cov_actor(null,'service_role');
      -- Establish a genuinely valid non-draft prerequisite through the existing
      -- freeze RPC. This is fixture preparation, not a calculator qualification.
      perform public.freeze_estimate_v2_snapshot(pg_temp.cov_id(301),pg_temp.cov_id(101),
        (select updated_at from public.estimate_versions where id=pg_temp.cov_id(301)),
        (select content_revision from public.estimate_versions where id=pg_temp.cov_id(301)),pg_temp.cov_id(1),'approval',
        jsonb_build_object('labor_split_enabled',false,'labor_roles',jsonb_build_array(jsonb_build_object('id',pg_temp.cov_id(321),'hourly_rate_cents',4000)),'margin_tiers','[]'::jsonb,'effective_margin_multiplier',1),
        (select jsonb_agg(jsonb_build_object('id',id,'snapshot_pu_ht_cents',pu_ht_cents,'snapshot_fo_ht_cents',(quantity*unit_price_ht_cents*k_fo)::integer,'snapshot_mo_ht_cents',(h_mo*4000)::integer,'snapshot_mo_atelier_ht_cents',0,'snapshot_mo_chantier_ht_cents',(h_mo*4000)::integer,'line_total_ht_cents',line_total_ht_cents,'line_tax_cents',line_tax_cents,'line_total_ttc_cents',line_total_ttc_cents) order by id) from public.estimate_items where version_id=pg_temp.cov_id(301) and item_type='line'),
        '{"total_ht_cents":71000,"total_tax_cents":14200,"total_ttc_cents":85200}');
      update public.estimate_versions set status='sent',seal_hash=repeat('a',64) where id=pg_temp.cov_id(301);
      result:=public.decide_estimate_source_requirement(pg_temp.cov_id(1),pg_temp.cov_id(301),pg_temp.cov_id(8001),(p->>'expectedRequirementRevision')::bigint,1,(p->>'expectedContentRevision')::bigint,p->>'reviewedFingerprint',(p->>'operationKey')::uuid,p->'decision');
      perform pg_temp.cov_assert(result->>'replayed'='true','Nondraft historical replay refused');
      perform pg_temp.cov_actor(); perform pg_temp.cov_error('select pg_temp.cov_decide(1,''priced'',40001)');
    when 'whole-parent-delete' then
      perform pg_temp.cov_actor(null,'none'); delete from public.estimate_projects where id=pg_temp.cov_id(201);
      perform pg_temp.cov_assert(not exists(select 1 from private.estimate_source_coverage_requirements where id=pg_temp.cov_id(8001)),'Project cascade blocked');
    else raise exception 'Unknown native case %',name;
    end case;
  end $f$;
  $helpers$;
  -- Session-local probe helpers need explicit access after SET ROLE anon.
  -- The mandatory abort rolls back these grants; product RPC ACLs stay closed.
  grant execute on all functions in schema pg_temp to anon;
  foreach case_name in array array['empty-no-write','acl','reader-rights','component-inclusion','stale-component','cascade-history','partial','unverified','citation-page','bad-target','register-invalidation','register-incompatible','line-aba','nontechnical','dimension-label-extent','requirement-aba','reference-B','replay','preview-stale','delete-reinsert','archive-reopen','history-immutable','source-metadata-loss-replay','role-replay','target-catalogue','financial-unchanged','unspecified','duplicate-target','citation-hash','event-atomic','revision-overflow','shared-dimension-version-delete','nondraft-replay','whole-parent-delete'] loop
    passed:=false; failure:=null;
    begin
      perform pg_temp.cov_case(case_name);
      raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true;
      when others then failure:=sqlstate||': '||sqlerrm;
    end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='SOURCE_COVERAGE_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','dc510000','physicalStorageProof',false,'concurrencyExecuted',false,'cases',results)::text;
end;
$coverage_probe$;
