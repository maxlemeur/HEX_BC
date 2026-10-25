-- CORE07 library provenance: written BEFORE the new materialization SQL.
-- Real RPC/RLS calls, opaque JSON cases and a late trigger failure are gaps
-- of the ordinary browser journey. Every case and the enclosing DO abort.
-- No concurrent transaction, persistent seed, history write or DDL install.
do $assembly_provenance_probe$
declare case_name text; results jsonb:='[]'; passed boolean; failure text;
begin
  if exists(select 1 from auth.users where id::text like 'cfca0000-%') then
    raise exception 'Assembly provenance fixture already exists';
  end if;
  execute $helpers$
  create function pg_temp.ap_id(n integer) returns uuid language sql immutable as $f$
    select ('cfca0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  $f$;
  create function pg_temp.ap_assert(ok boolean,detail text) returns void language plpgsql as $f$
  begin if ok is distinct from true then raise exception '%',detail; end if; end $f$;
  create function pg_temp.ap_actor(n integer default 1,db_role text default 'authenticated') returns void language plpgsql as $f$
  begin
    perform set_config('role','none',true);
    perform set_config('request.jwt.claim.sub',case when n is null then '' else pg_temp.ap_id(n)::text end,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',case when n is null then null else pg_temp.ap_id(n) end,'role',db_role)::text,true);
    perform set_config('role',db_role,true);
  end $f$;
  $helpers$;
  insert into auth.users(id,email,raw_user_meta_data)
    select pg_temp.ap_id(n),'assembly-provenance-'||n||'@example.invalid',jsonb_build_object('full_name','Assembly actor '||n) from generate_series(1,3)n;
  update public.tenant_memberships set is_default=false where user_id::text like 'cfca0000-%';
  insert into public.tenants(id,name,slug) values
    (pg_temp.ap_id(101),'ARMY assembly provenance T1','assembly-provenance-native-t1'),
    (pg_temp.ap_id(102),'ARMY assembly provenance T2','assembly-provenance-native-t2');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at) values
    (pg_temp.ap_id(101),pg_temp.ap_id(1),'engineer',true,'2020-01-01'),
    (pg_temp.ap_id(101),pg_temp.ap_id(2),'viewer',true,'2020-01-01'),
    (pg_temp.ap_id(102),pg_temp.ap_id(1),'engineer',false,'2021-01-01');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values
    (pg_temp.ap_id(201),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY assembly target'),
    (pg_temp.ap_id(202),pg_temp.ap_id(102),pg_temp.ap_id(1),'ARMY assembly inactive tenant'),
    (pg_temp.ap_id(204),pg_temp.ap_id(101),pg_temp.ap_id(2),'ARMY assembly viewer target');
  insert into public.estimate_versions(id,project_id,version_number,status,calc_engine_version,max_section_depth,margin_mode,margin_multiplier,tax_rate_bp,total_ht_cents,total_tax_cents,total_ttc_cents) values
    (pg_temp.ap_id(301),pg_temp.ap_id(201),1,'draft',2,4,'fixed',1,0,0,0,0),
    (pg_temp.ap_id(302),pg_temp.ap_id(201),2,'sent',2,4,'fixed',1,0,0,0,0),
    (pg_temp.ap_id(303),pg_temp.ap_id(202),1,'draft',2,4,'fixed',1,0,0,0,0),
    (pg_temp.ap_id(304),pg_temp.ap_id(204),1,'draft',2,4,'fixed',1,0,0,0,0);
  insert into public.estimate_items(id,version_id,item_type,position,title) values
    (pg_temp.ap_id(401),pg_temp.ap_id(304),'section',1,'Foreign parent'),
    (pg_temp.ap_id(403),pg_temp.ap_id(301),'section',1,'Existing target section');
  insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
    values(pg_temp.ap_id(402),pg_temp.ap_id(301),pg_temp.ap_id(403),'line',1,'Existing target line','u',1,0,0,1,0,1,0,0,0,0);
  insert into public.labor_roles(id,tenant_id,user_id,name,hourly_rate_cents,is_active,position)
    values(pg_temp.ap_id(601),pg_temp.ap_id(101),pg_temp.ap_id(1),'Pose',4000,true,1);
  insert into public.estimate_assemblies(id,tenant_id,created_by,name,source_metadata) values
    (pg_temp.ap_id(1001),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY generated library',jsonb_build_object('kind','generated_ouvrage','draft_id',pg_temp.ap_id(901),'candidate_id',pg_temp.ap_id(911))),
    (pg_temp.ap_id(1002),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY manual library','{}'),
    (pg_temp.ap_id(1003),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY imported library','{"kind":"imported","file":"catalogue.xlsx"}'),
    (pg_temp.ap_id(1004),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY nested middle','{}'),
    (pg_temp.ap_id(1005),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY nested root','{}'),
    (pg_temp.ap_id(1006),pg_temp.ap_id(101),pg_temp.ap_id(1),'ARMY empty library','{}'),
    (pg_temp.ap_id(2001),pg_temp.ap_id(102),pg_temp.ap_id(1),'ARMY foreign library','{"private":"foreign"}');
  insert into public.estimate_assembly_items(id,assembly_id,tenant_id,title,unit,cost_type,default_quantity,unit_cost_ht_cents,k_fo,h_mo,k_mo,labor_role_id,position,source_metadata) values
    (pg_temp.ap_id(1101),pg_temp.ap_id(1001),pg_temp.ap_id(101),'Generated FO','m','material',2,125,1.1,0,0,null,1,
      jsonb_build_object('kind','generated_ouvrage','component_id',pg_temp.ap_id(951),'confidence',0.91,'facts',jsonb_build_array('FO original'),'sources',jsonb_build_array(jsonb_build_object('source_fragment_id',pg_temp.ap_id(921),'evidence_kind','fact','note','Citation exacte'),jsonb_build_object('source_fragment_id',pg_temp.ap_id(922),'evidence_kind','hypothesis','note',null)))),
    (pg_temp.ap_id(1105),pg_temp.ap_id(1001),pg_temp.ap_id(101),'Generated free MO','h','labor',2,0,0,2,0,pg_temp.ap_id(601),2,
      jsonb_build_object('kind','generated_ouvrage','component_id',pg_temp.ap_id(955),'sources',jsonb_build_array(jsonb_build_object('source_fragment_id',pg_temp.ap_id(921),'evidence_kind','fact','note','MO distincte sur le meme fragment')))),
    (pg_temp.ap_id(1102),pg_temp.ap_id(1002),pg_temp.ap_id(101),'Manual','u','material',3,20,1,0,0,null,1,'{}'),
    (pg_temp.ap_id(1103),pg_temp.ap_id(1003),pg_temp.ap_id(101),'Imported','u','equipment',1,45,1,0,0,null,1,'{"kind":"catalogue_import","file":"catalogue.xlsx","row":17,"enabled":false,"sources":[{"label":"Deuxième","page":2},{"label":"Premier","page":1}],"legacy":{"nullable":null}}'),
    (pg_temp.ap_id(2101),pg_temp.ap_id(2001),pg_temp.ap_id(102),'Foreign','u','material',1,3,1,0,0,null,1,'{"secret_origin":"foreign"}');
  insert into public.estimate_assembly_members(id,parent_assembly_id,child_assembly_id,tenant_id,quantity,position) values
    (pg_temp.ap_id(1201),pg_temp.ap_id(1004),pg_temp.ap_id(1001),pg_temp.ap_id(101),2,1),
    (pg_temp.ap_id(1202),pg_temp.ap_id(1004),pg_temp.ap_id(1002),pg_temp.ap_id(101),3,2),
    (pg_temp.ap_id(1203),pg_temp.ap_id(1004),pg_temp.ap_id(1003),pg_temp.ap_id(101),4,3),
    (pg_temp.ap_id(1204),pg_temp.ap_id(1005),pg_temp.ap_id(1004),pg_temp.ap_id(101),3,1);
  execute $helpers$
  create function pg_temp.ap_state() returns jsonb language plpgsql security definer set search_path='' as $f$
  declare t record; rows_value jsonb; result jsonb:='{}';
  begin
    for t in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private') order by n.nspname,c.relname loop
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from %I.%I x where to_jsonb(x)::text like ''%%cfca0000-%%''',t.nspname,t.relname) into rows_value;
      if rows_value<>'[]'::jsonb then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,rows_value); end if;
    end loop; return result;
  end $f$;
  create function pg_temp.ap_origin(item public.estimate_assembly_items) returns jsonb language sql immutable as $f$
    select jsonb_build_object('kind','assembly_library','library_origin',jsonb_build_object('assembly_id',item.assembly_id,'assembly_item_id',item.id,'source_metadata',item.source_metadata))
  $f$;
  create function pg_temp.ap_insert(assembly integer default 1001,version integer default 301) returns jsonb language sql as $f$
    select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) from public.insert_estimate_assembly_into_version(pg_temp.ap_id(version),pg_temp.ap_id(assembly),null)item
  $f$;
  create function pg_temp.ap_verify(rows_value jsonb,expected_lines integer) returns void language plpgsql as $f$
  declare item jsonb; source_item public.estimate_assembly_items%rowtype; found_lines integer:=0;
  begin
    for item in select value from jsonb_array_elements(rows_value) where value->>'item_type'='line' loop
      found_lines:=found_lines+1;
      select a.* into source_item from public.estimate_assembly_items a where a.id=(item->'source_metadata'->'library_origin'->>'assembly_item_id')::uuid;
      perform pg_temp.ap_assert(found and item->>'source_provider'='assembly_library','Materialized source provider or item identity missing');
      perform pg_temp.ap_assert(item->'source_metadata'=pg_temp.ap_origin(source_item),'Materialized wrapper or exact original JSON differs');
      perform pg_temp.ap_assert(item->'source_job_id'='null'::jsonb and item->'source_file_name'='null'::jsonb and item->'source_page'='null'::jsonb and (not(item?'source_extracted_at') or item->'source_extracted_at'='null'::jsonb),'Library origin was promoted to direct document provenance');
      perform pg_temp.ap_assert((select i.source_provider='assembly_library' and i.source_metadata=item->'source_metadata' from public.estimate_items i where i.id=(item->>'id')::uuid),'Returned provenance was not stored exactly');
    end loop;
    perform pg_temp.ap_assert(found_lines=expected_lines,'Materialized line count differs');
  end $f$;
  create temporary sequence ap_fault_hits;
  create function pg_temp.ap_fault_count() returns bigint language sql security definer set search_path='' as $f$
    select case when is_called then last_value else 0 end from pg_temp.ap_fault_hits
  $f$;
  create function pg_temp.ap_fault() returns trigger language plpgsql security definer set search_path='' as $f$
  begin
    if coalesce(current_setting('ap.fault',true),'')='enabled' and new.version_id=pg_temp.ap_id(301) and new.title='Imported' then
      perform nextval('pg_temp.ap_fault_hits');
      raise exception using errcode='23514',message='ASSEMBLY_PROVENANCE_LATE_FAULT';
    end if; return new;
  end $f$;
  create trigger assembly_provenance_probe_fault before insert on public.estimate_items for each row execute function pg_temp.ap_fault();
  create function pg_temp.ap_refusal(command text,expected_state text default null,expected_message text default null) returns void language plpgsql as $f$
  declare before_state jsonb:=pg_temp.ap_state(); actual_state text; actual_message text; result jsonb;
  begin
    begin execute command into result; exception when others then get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text; end;
    perform pg_temp.ap_assert(actual_state=any(array['42501','P0001','23514']),format('Expected refusal, got %s/%s',actual_state,actual_message));
    perform pg_temp.ap_assert(expected_state is null or actual_state=expected_state,format('Expected %s, got %s',expected_state,actual_state));
    perform pg_temp.ap_assert(expected_message is null or actual_message=expected_message,format('Expected %s, got %s',expected_message,actual_message));
    perform pg_temp.ap_assert(before_state=pg_temp.ap_state(),'Refusal left partial estimate, library or provenance rows');
  end $f$;
  create function pg_temp.ap_case(name text) returns void language plpgsql as $f$
  declare result jsonb; original jsonb; changed jsonb; item_id uuid; value_json jsonb;
  begin
    perform pg_temp.ap_actor();
    case name
    when 'generated-origin-exact' then
      result:=pg_temp.ap_insert(); perform pg_temp.ap_verify(result,2);
      perform pg_temp.ap_assert(jsonb_array_length(result)=3,'Generated library section/lines differ');
    when 'manual-origin-empty' then
      result:=pg_temp.ap_insert(1002); perform pg_temp.ap_verify(result,1);
      perform pg_temp.ap_assert(result->1->'source_metadata'->'library_origin'->'source_metadata'='{}'::jsonb,'Manual library acquired fabricated metadata');
    when 'imported-origin-exact' then
      result:=pg_temp.ap_insert(1003); perform pg_temp.ap_verify(result,1);
    when 'legacy-generated-no-component-id' then
      update public.estimate_assembly_items set source_metadata='{"kind":"generated_ouvrage","sources":[{"source_fragment_id":"cfca0000-0000-4000-8000-000000000921"}]}' where id=pg_temp.ap_id(1103);
      result:=pg_temp.ap_insert(1003); perform pg_temp.ap_verify(result,1);
      perform pg_temp.ap_assert(not(result->1->'source_metadata'->'library_origin'->'source_metadata'?'component_id'),'Legacy component identity was invented');
    when 'legacy-opaque-json' then
      foreach value_json in array array['null'::jsonb,'["legacy",null,2,{"nested":false}]'::jsonb,'"legacy text"'::jsonb,'17'::jsonb] loop
        update public.estimate_assembly_items set source_metadata=value_json where id=pg_temp.ap_id(1103);
        result:=pg_temp.ap_insert(1003); perform pg_temp.ap_verify(result,1);
        perform pg_temp.ap_assert(result->1->'source_metadata'->'library_origin'->'source_metadata'=value_json,'Opaque legacy JSON was transformed');
      end loop;
    when 'nested-leaf-origin-and-parameters' then
      result:=pg_temp.ap_insert(1005); perform pg_temp.ap_verify(result,4);
      perform pg_temp.ap_assert(jsonb_array_length(result)=9,'Nested structure differs');
      perform pg_temp.ap_assert(exists(select 1 from jsonb_array_elements(result)i where i->>'title'='Generated FO' and (i->>'quantity')::numeric=12 and (i->>'unit_price_ht_cents')::integer=125 and (i->>'k_fo')::numeric=1.1 and (i->>'h_mo')::numeric=0),'Nested FO parameters changed');
      perform pg_temp.ap_assert(exists(select 1 from jsonb_array_elements(result)i where i->>'title'='Generated free MO' and (i->>'quantity')::numeric=12 and (i->>'h_mo')::numeric=12 and (i->>'k_mo')::numeric=0 and (i->>'unit_price_ht_cents')::integer=0 and i->>'labor_role_id'=pg_temp.ap_id(601)::text),'Nested free labor hours or role changed');
      perform pg_temp.ap_assert(exists(select 1 from jsonb_array_elements(result)i where i->>'title'='Manual' and (i->>'quantity')::numeric=27) and exists(select 1 from jsonb_array_elements(result)i where i->>'title'='Imported' and (i->>'quantity')::numeric=12),'Nested quantity multipliers changed');
    when 'copy-survives-library-edit' then
      result:=pg_temp.ap_insert(); perform pg_temp.ap_verify(result,2); original:=result->1->'source_metadata'; item_id:=(result->1->>'id')::uuid;
      update public.estimate_assembly_items set source_metadata='{"later":"changed"}' where id=pg_temp.ap_id(1101);
      select i.source_metadata into changed from public.estimate_items i where i.id=item_id;
      perform pg_temp.ap_assert(changed=original and changed->'library_origin'->'source_metadata'<> '{"later":"changed"}'::jsonb,'Materialized origin followed later library edit');
    when 'copy-survives-library-item-delete' then
      result:=pg_temp.ap_insert(); perform pg_temp.ap_verify(result,2); original:=result->1->'source_metadata'; item_id:=(result->1->>'id')::uuid;
      delete from public.estimate_assembly_items where id=pg_temp.ap_id(1101);
      select i.source_metadata into changed from public.estimate_items i where i.id=item_id;
      perform pg_temp.ap_assert(changed=original,'Materialized origin was deleted with library item');
    when 'opaque-origin-not-direct-generated-proof' then
      update public.estimate_assembly_items set source_metadata=jsonb_build_object('kind','generated_ouvrage','application_id',pg_temp.ap_id(803),'snapshot_id',pg_temp.ap_id(804),'project_id',pg_temp.ap_id(202),'confidence',1,'facts',jsonb_build_array('Old project'),'sources',jsonb_build_array(jsonb_build_object('source_fragment_id',pg_temp.ap_id(923)))) where id=pg_temp.ap_id(1103);
      result:=pg_temp.ap_insert(1003); perform pg_temp.ap_verify(result,1);
      perform pg_temp.ap_actor(null,'none');
      perform pg_temp.ap_assert(not exists(select 1 from public.estimate_generated_ouvrage_applications a where a.estimate_item_id=(result->1->>'id')::uuid) and not exists(select 1 from public.estimate_generated_ouvrage_work_snapshots s where s.estimate_item_id=(result->1->>'id')::uuid),'Library reuse created direct generated application or snapshot');
      perform pg_temp.ap_assert(not exists(select 1 from private.estimate_source_coverage_links l where to_jsonb(l)::text like '%cfca0000-%'),'Library reuse invented CCTP coverage');
    when 'anonymous-refused' then
      -- Lot 3.3 removes PUBLIC's global default EXECUTE, including on pg_temp
      -- helpers. Reach the actual product RPC and check its exact ACL refusal.
      original:=pg_temp.ap_state();
      perform pg_temp.ap_actor(null,'anon');
      begin
        perform public.insert_estimate_assembly_into_version(
          'cfca0000-0000-4000-8000-000000000301',
          'cfca0000-0000-4000-8000-000000001001',null);
        raise exception 'Anonymous assembly insertion unexpectedly succeeded';
      exception when insufficient_privilege then
        if sqlerrm <> 'permission denied for function insert_estimate_assembly_into_version' then raise; end if;
      end;
      perform set_config('role','none',true);
      perform pg_temp.ap_assert(original=pg_temp.ap_state(),'Anonymous refusal left partial rows');
    when 'viewer-owned-version-refused' then
      perform pg_temp.ap_actor(2); perform pg_temp.ap_refusal('select pg_temp.ap_insert(1001,304)', '42501');
    when 'outsider-refused' then
      perform pg_temp.ap_actor(3); perform pg_temp.ap_refusal('select pg_temp.ap_insert()', 'P0001','Estimate version not found or access denied');
    when 'inactive-tenant-version-refused' then
      perform pg_temp.ap_actor(null,'none'); update public.tenants set is_active=false where id=pg_temp.ap_id(102); perform pg_temp.ap_actor();
      perform pg_temp.ap_refusal('select pg_temp.ap_insert(2001,303)', 'P0001','Estimate version not found or access denied');
    when 'foreign-tenant-library-refused' then
      perform pg_temp.ap_refusal('select pg_temp.ap_insert(2001)', 'P0001','Estimate assembly and version tenant mismatch');
    when 'read-only-version-refused' then
      perform pg_temp.ap_refusal('select pg_temp.ap_insert(1001,302)', 'P0001','Estimate version is read only');
    when 'invalid-parent-refused' then
      perform pg_temp.ap_refusal('select jsonb_agg(to_jsonb(i)) from public.materialize_estimate_assembly_tree(pg_temp.ap_id(301),pg_temp.ap_id(1001),pg_temp.ap_id(401),1,1,0)i','P0001','Estimate assembly parent section is invalid');
      perform pg_temp.ap_refusal('select jsonb_agg(to_jsonb(i)) from public.materialize_estimate_assembly_tree(pg_temp.ap_id(301),pg_temp.ap_id(1001),pg_temp.ap_id(402),1,1,0)i','P0001','Estimate assembly parent section is invalid');
    when 'depth-and-quantity-guards-preserved' then
      perform pg_temp.ap_refusal('select jsonb_agg(to_jsonb(i)) from public.materialize_estimate_assembly_tree(pg_temp.ap_id(301),pg_temp.ap_id(1001),null,1,1,3)i','P0001','Estimate assembly composition is limited to two nested levels');
      perform pg_temp.ap_refusal('select jsonb_agg(to_jsonb(i)) from public.materialize_estimate_assembly_tree(pg_temp.ap_id(301),pg_temp.ap_id(1001),null,1,-1,0)i','P0001','Estimate assembly quantity must be positive');
    when 'empty-library-refused' then
      perform pg_temp.ap_refusal('select pg_temp.ap_insert(1006)', 'P0001','Estimate assembly has no contents');
    when 'nested-late-failure-atomic' then
      perform set_config('ap.fault','enabled',true);
      perform pg_temp.ap_refusal('select pg_temp.ap_insert(1005)', '23514','ASSEMBLY_PROVENANCE_LATE_FAULT');
      perform pg_temp.ap_assert(pg_temp.ap_fault_count()=1,'Actual late insertion failure was not reached exactly once');
    else raise exception 'Unknown assembly provenance case %',name;
    end case;
  end $f$;
  $helpers$;
  foreach case_name in array array[
    'generated-origin-exact','manual-origin-empty','imported-origin-exact','legacy-generated-no-component-id','legacy-opaque-json',
    'nested-leaf-origin-and-parameters','copy-survives-library-edit','copy-survives-library-item-delete','opaque-origin-not-direct-generated-proof',
    'anonymous-refused','viewer-owned-version-refused','outsider-refused','inactive-tenant-version-refused','foreign-tenant-library-refused',
    'read-only-version-refused','invalid-parent-refused','depth-and-quantity-guards-preserved','empty-library-refused','nested-late-failure-atomic'
  ] loop
    passed:=false; failure:=null;
    begin perform pg_temp.ap_case(case_name); raise exception using errcode='P9002',message='CASE_ROLLBACK';
    exception when sqlstate 'P9002' then passed:=true; when others then failure:=sqlstate||': '||sqlerrm; end;
    perform set_config('role','none',true);
    results:=results||jsonb_build_array(jsonb_build_object('case',case_name,'passed',passed,'error',failure));
  end loop;
  raise exception using errcode='P9001',message='ESTIMATE_ASSEMBLY_PROVENANCE_PROOF:'||jsonb_build_object('allPassed',not exists(select 1 from jsonb_array_elements(results)x where not(x->>'passed')::boolean),'fixturePrefix','cfca0000','concurrencyExecuted',false,'cases',results)::text;
end;
$assembly_provenance_probe$;
