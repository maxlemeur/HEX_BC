do $probe$
<<reproduce>>
declare
  actor constant uuid := '__CATALOGUE_ACTOR_ID__';
  tenant_a constant uuid := '__CATALOGUE_TENANT_ID__';
  offer_id constant uuid := '__CATALOGUE_OFFER_ID__';
  product_id_value constant uuid := '__CATALOGUE_PRODUCT_ID__';
  tenant_b constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106001';
  import_a1 constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106101';
  import_a2 constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106102';
  import_b1 constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106201';
  row_a1 constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106111';
  row_a2 constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106112';
  row_b1 constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106211';
  insert_offer_id constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106301';
  missing_id constant uuid := '1acba836-881c-4b48-9d73-a0bb4d106999';
  original_offer jsonb;
  original_product jsonb;
  original_history bigint;
  original_validations bigint;
  case_spec jsonb;
  cases jsonb;
  results jsonb := '[]'::jsonb;
  before_offer jsonb;
  after_offer jsonb;
  before_history bigint;
  after_history bigint;
  affected integer;
  error_state text;
  error_message text;
  outcome text;
  result jsonb;
  target_offer_id uuid;
  before_parent jsonb;
  after_parent jsonb;
  checks jsonb;
  all_passed boolean := true;
begin
  if current_database() <> 'postgres' then raise exception 'Unexpected database'; end if;
  if exists(select 1 from public.tenants where id=tenant_b)
    or exists(select 1 from public.dpgf_imports where id in(import_a1,import_a2,import_b1))
    or exists(select 1 from public.dpgf_rows_mapped where id in(row_a1,row_a2,row_b1))
    or exists(select 1 from public.supplier_pricebook where id=insert_offer_id) then
    raise exception 'Fixture identities must be absent before the rollback probe';
  end if;
  if not exists(select 1 from public.products where id=product_id_value and tenant_id=tenant_a and designation like 'ARMY-%') then
    raise exception 'Expected ARMY product fixture missing';
  end if;
  select to_jsonb(sp) into original_offer from public.supplier_pricebook sp where id=offer_id and tenant_id=tenant_a and product_id=product_id_value;
  if original_offer is null then raise exception 'Expected ARMY offer fixture missing'; end if;
  select to_jsonb(p) into original_product from public.products p where id=product_id_value;
  select count(*) into original_history from public.supplier_pricebook_history where supplier_pricebook_history.offer_id=reproduce.offer_id;
  select count(*) into original_validations from public.product_reference_price_validations where product_id=product_id_value;

  -- Fixture construction uses the local owner only; all writes remain in this
  -- statement transaction and are rolled back by its terminal exception.
  insert into public.tenants(id,name,slug,created_by) values(tenant_b,'ARMY-CATALOGUE-PROVENANCE-B','army-catalogue-provenance-1acba836',null);
  insert into public.dpgf_imports(id,tenant_id,user_id,filename,source_format,parse_mode,status,row_count) values
    (import_a1,tenant_a,actor,'ARMY-CATALOGUE-PROVENANCE-A1.csv','csv','server','completed',1),
    (import_a2,tenant_a,actor,'ARMY-CATALOGUE-PROVENANCE-A2.csv','csv','server','completed',1),
    (import_b1,tenant_b,actor,'ARMY-CATALOGUE-PROVENANCE-B1.csv','csv','server','completed',1);
  insert into public.dpgf_rows_mapped(id,tenant_id,import_id,payload,status) values
    (row_a1,tenant_a,import_a1,'{"designation":"ARMY-CATALOGUE-PROVENANCE-A1"}','mapped'),
    (row_a2,tenant_a,import_a2,'{"designation":"ARMY-CATALOGUE-PROVENANCE-A2"}','mapped'),
    (row_b1,tenant_b,import_b1,'{"designation":"ARMY-CATALOGUE-PROVENANCE-B1"}','mapped');

  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if current_user <> 'authenticated' or auth.uid() <> actor or public.current_tenant_id() <> tenant_a
    or public.is_admin_user() or not public.has_tenant_role(tenant_a,array['admin'::public.tenant_role]) then
    raise exception 'Fixture authentication scope mismatch';
  end if;
  if exists(select 1 from public.dpgf_imports where id=import_b1)
    or exists(select 1 from public.dpgf_rows_mapped where id=row_b1)
    or public.is_tenant_member(tenant_b) then
    raise exception 'Cross-tenant fixtures must be inaccessible to the actor';
  end if;

  cases := jsonb_build_array(
    jsonb_build_object('name','cross_tenant_import','expected','rejected','patch',jsonb_build_object('source_import_id',import_b1,'source_mapped_row_id',null)),
    jsonb_build_object('name','cross_tenant_row_only','expected','rejected','patch',jsonb_build_object('source_import_id',null,'source_mapped_row_id',row_b1)),
    jsonb_build_object('name','cross_tenant_pair','expected','rejected','patch',jsonb_build_object('source_import_id',import_b1,'source_mapped_row_id',row_b1)),
    jsonb_build_object('name','missing_import','expected','rejected','patch',jsonb_build_object('source_import_id',missing_id,'source_mapped_row_id',null)),
    jsonb_build_object('name','missing_row','expected','rejected','patch',jsonb_build_object('source_import_id',null,'source_mapped_row_id',missing_id)),
    jsonb_build_object('name','same_tenant_wrong_import_row','expected','rejected','patch',jsonb_build_object('source_import_id',import_a1,'source_mapped_row_id',row_a2)),
    jsonb_build_object('name','tenant_resolved_before_provenance','expected','accepted','patch',jsonb_build_object('tenant_id',tenant_b,'source_import_id',import_a1,'source_mapped_row_id',row_a1)),
    jsonb_build_object('name','foreign_source_after_tenant_resolution','expected','rejected','patch',jsonb_build_object('tenant_id',tenant_b,'source_import_id',import_b1,'source_mapped_row_id',row_b1)),
    jsonb_build_object('name','partial_import_change','expected','rejected','initialPair',true,'patch',jsonb_build_object('source_import_id',import_a2)),
    jsonb_build_object('name','partial_row_change','expected','rejected','initialPair',true,'patch',jsonb_build_object('source_mapped_row_id',row_a2)),
    jsonb_build_object('name','valid_pair','expected','accepted','patch',jsonb_build_object('source_import_id',import_a1,'source_mapped_row_id',row_a1)),
    jsonb_build_object('name','valid_row_only','expected','accepted','patch',jsonb_build_object('source_import_id',null,'source_mapped_row_id',row_a1)),
    jsonb_build_object('name','valid_import_only','expected','accepted','patch',jsonb_build_object('source_import_id',import_a1,'source_mapped_row_id',null)),
    jsonb_build_object('name','clear_both','expected','accepted','initialPair',true,'patch',jsonb_build_object('source_import_id',null,'source_mapped_row_id',null)),
    jsonb_build_object('name','clear_import_only','expected','accepted','initialPair',true,'patch',jsonb_build_object('source_import_id',null)),
    jsonb_build_object('name','clear_row_only','expected','accepted','initialPair',true,'patch',jsonb_build_object('source_mapped_row_id',null)),
    jsonb_build_object('name','metadata_only','expected','accepted','initialPair',true,'patch',jsonb_build_object('notes','ARMY provenance unchanged'))
  );
  -- The same new associations must be guarded on direct INSERT as on UPDATE.
  cases := cases || (select jsonb_agg(value || jsonb_build_object('name',(value->>'name')||'_insert','operation','insert'))
    from jsonb_array_elements(cases) where not coalesce((value->>'initialPair')::boolean,false));
  for case_spec in select value from jsonb_array_elements(cases) loop
    target_offer_id := case when case_spec->>'operation'='insert' then insert_offer_id else offer_id end;
    outcome := 'not_executed'; error_state := null; error_message := null; affected := 0;
    begin
      if coalesce((case_spec->>'initialPair')::boolean,false) then
        update public.supplier_pricebook set source_import_id=import_a1,source_mapped_row_id=row_a1 where id=offer_id;
      end if;
      select to_jsonb(sp) into before_offer from public.supplier_pricebook sp where id=target_offer_id;
      select count(*) into before_history from public.supplier_pricebook_history h where h.offer_id=target_offer_id;
      begin
        if case_spec->>'operation'='insert' then
          insert into public.supplier_pricebook select r.* from jsonb_populate_record(null::public.supplier_pricebook,
            original_offer || jsonb_build_object('id',insert_offer_id,'min_quantity',98765,'source_import_id',null,'source_mapped_row_id',null) || (case_spec->'patch')) r;
        else
        update public.supplier_pricebook sp set
          tenant_id=case when (case_spec->'patch') ? 'tenant_id' then (case_spec->'patch'->>'tenant_id')::uuid else sp.tenant_id end,
          notes=case when (case_spec->'patch') ? 'notes' then case_spec->'patch'->>'notes' else sp.notes end,
          source_import_id=case when (case_spec->'patch') ? 'source_import_id' then (case_spec->'patch'->>'source_import_id')::uuid else sp.source_import_id end,
          source_mapped_row_id=case when (case_spec->'patch') ? 'source_mapped_row_id' then (case_spec->'patch'->>'source_mapped_row_id')::uuid else sp.source_mapped_row_id end
          where sp.id=offer_id and sp.tenant_id=tenant_a;
        end if;
        get diagnostics affected = row_count;
        outcome := 'accepted';
      exception when others then
        get stacked diagnostics error_state = returned_sqlstate, error_message = message_text;
        outcome := 'rejected';
      end;
      select to_jsonb(sp) into after_offer from public.supplier_pricebook sp where id=target_offer_id;
      select count(*) into after_history from public.supplier_pricebook_history h where h.offer_id=target_offer_id;
      checks := jsonb_build_object(
        'outcomeMatches',outcome=case_spec->>'expected',
        'affectedRowsMatch',affected=case when case_spec->>'expected'='rejected' then 0 else 1 end,
        'rejectionCodeAndMessage',case when case_spec->>'expected'='rejected' then error_state='23514' and error_message='Invalid supplier price provenance.' else error_state is null end,
        'rejectedOfferUnchanged',case when case_spec->>'expected'='rejected' then before_offer is not distinct from after_offer else true end,
        'historyDeltaMatches',after_history-before_history=case when case_spec->>'expected'='rejected' or case_spec->>'operation'='insert' then 0 else 1 end,
        'acceptedTenantIsFinal',case when outcome='accepted' then after_offer->>'tenant_id'=tenant_a::text else true end,
        'acceptedSourceImportMatches',case when case_spec->>'expected'='accepted' then
          (after_offer->'source_import_id') is not distinct from
          (case when (case_spec->'patch') ? 'source_import_id' then case_spec->'patch'->'source_import_id' else before_offer->'source_import_id' end)
          else true end,
        'acceptedSourceRowMatches',case when case_spec->>'expected'='accepted' then
          (after_offer->'source_mapped_row_id') is not distinct from
          (case when (case_spec->'patch') ? 'source_mapped_row_id' then case_spec->'patch'->'source_mapped_row_id' else before_offer->'source_mapped_row_id' end)
          else true end,
        'productUnchanged',(select to_jsonb(p)=original_product from public.products p where id=product_id_value),
        'validationCountUnchanged',(select count(*)=original_validations from public.product_reference_price_validations where product_id=product_id_value));
      all_passed := all_passed and (select bool_and(value='true'::jsonb) from jsonb_each(checks));
      result := jsonb_build_object('name',case_spec->>'name','expected',case_spec->>'expected','actual',outcome,'affectedRows',affected,'sqlstate',error_state,'error',error_message,
        'checks',checks,'before',before_offer,'after',after_offer,'offerUnchanged',before_offer is not distinct from after_offer,'historyDelta',after_history-before_history,
        'productUnchanged',(select to_jsonb(p)=original_product from public.products p where id=product_id_value),
        'validationCountUnchanged',(select count(*)=original_validations from public.product_reference_price_validations where product_id=product_id_value));
      -- Force the case subtransaction to roll back, without hiding its results.
      raise exception using errcode='P9002', message='case evidence captured';
    exception when sqlstate 'P9002' then
      null;
    end;
    if (select to_jsonb(sp) is distinct from original_offer from public.supplier_pricebook sp where id=offer_id)
      or (select count(*)<>original_history from public.supplier_pricebook_history h where h.offer_id=reproduce.offer_id) then
      raise exception 'Case rollback did not restore original offer/history';
    end if;
    results := results || jsonb_build_array(result || jsonb_build_object('caseRollbackVerified',true));
  end loop;
  -- Parent movement is part of the invariant; deletion keeps SET NULL semantics.
  -- Owner-mode cases exercise constraints even for authorized multi-tenant writers.
  for case_spec in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('name','move_mapped_import_pair','target','row','field','import','expected','rejected','provenance','pair'),
    jsonb_build_object('name','move_import_tenant_pair','target','import','field','tenant','expected','rejected','provenance','pair','owner',true),
    jsonb_build_object('name','move_import_tenant_import_only','target','import','field','tenant','expected','rejected','provenance','import','owner',true),
    jsonb_build_object('name','move_import_tenant_row_only','target','import','field','tenant','expected','rejected','provenance','row','owner',true),
    jsonb_build_object('name','move_mapped_tenant_row_only','target','row','field','tenant','expected','rejected','provenance','row','owner',true),
    jsonb_build_object('name','move_mapped_import_row_only','target','row','field','import','expected','accepted','provenance','row'),
    jsonb_build_object('name','mapped_payload_edit','target','row','field','payload','expected','accepted','provenance','pair'),
    jsonb_build_object('name','import_metadata_edit','target','import','field','filename','expected','accepted','provenance','pair'),
    jsonb_build_object('name','delete_mapped_pair','target','row','field','delete','expected','accepted','provenance','pair'),
    jsonb_build_object('name','delete_import_pair','target','import','field','delete','expected','accepted','provenance','pair'),
    jsonb_build_object('name','delete_import_row_only','target','import','field','delete','expected','accepted','provenance','row'),
    jsonb_build_object('name','delete_import_import_only','target','import','field','delete','expected','accepted','provenance','import')
  )) loop
    outcome := 'not_executed'; error_state := null; error_message := null; affected := 0;
    begin
      update public.supplier_pricebook set
        source_import_id=case when case_spec->>'provenance'='row' then null else import_a1 end,
        source_mapped_row_id=case when case_spec->>'provenance'='import' then null else row_a1 end
        where id=offer_id;
      select to_jsonb(sp) into before_offer from public.supplier_pricebook sp where id=offer_id;
      select count(*) into before_history from public.supplier_pricebook_history h where h.offer_id=reproduce.offer_id;
      if coalesce((case_spec->>'owner')::boolean,false) then execute 'reset role'; end if;
      if case_spec->>'target'='row' then select to_jsonb(r) into before_parent from public.dpgf_rows_mapped r where id=row_a1;
      else select to_jsonb(i) into before_parent from public.dpgf_imports i where id=import_a1; end if;
      begin
        case case_spec->>'name'
          when 'move_mapped_import_pair', 'move_mapped_import_row_only' then update public.dpgf_rows_mapped set import_id=import_a2 where id=row_a1;
          when 'move_mapped_tenant_row_only' then update public.dpgf_rows_mapped set import_id=import_b1 where id=row_a1;
          when 'move_import_tenant_pair', 'move_import_tenant_import_only', 'move_import_tenant_row_only' then update public.dpgf_imports set tenant_id=tenant_b where id=import_a1;
          when 'mapped_payload_edit' then update public.dpgf_rows_mapped set payload='{"designation":"ARMY updated metadata"}' where id=row_a1;
          when 'import_metadata_edit' then update public.dpgf_imports set filename='ARMY updated.csv' where id=import_a1;
          when 'delete_mapped_pair' then delete from public.dpgf_rows_mapped where id=row_a1;
          else delete from public.dpgf_imports where id=import_a1;
        end case;
        get diagnostics affected = row_count;
        outcome := 'accepted';
      exception when others then
        get stacked diagnostics error_state = returned_sqlstate, error_message = message_text;
        outcome := 'rejected';
      end;
      if case_spec->>'target'='row' then select to_jsonb(r) into after_parent from public.dpgf_rows_mapped r where id=row_a1;
      else select to_jsonb(i) into after_parent from public.dpgf_imports i where id=import_a1; end if;
      execute 'set local role authenticated';
      select to_jsonb(sp) into after_offer from public.supplier_pricebook sp where id=offer_id;
      select count(*) into after_history from public.supplier_pricebook_history h where h.offer_id=reproduce.offer_id;
      checks := jsonb_build_object(
        'outcomeMatches',outcome=case_spec->>'expected',
        'affectedRowsMatch',affected=case when case_spec->>'expected'='rejected' then 0 else 1 end,
        'rejectionCode',case when case_spec->>'expected'='rejected' then error_state='23503' else error_state is null end,
        'rejectedParentUnchanged',case when case_spec->>'expected'='rejected' then before_parent is not distinct from after_parent else true end,
        'rejectedOfferAndHistoryUnchanged',case when case_spec->>'expected'='rejected' then before_offer=after_offer and before_history=after_history else true end,
        'acceptedParentStateMatches',case
          when case_spec->>'expected'<>'accepted' then true
          when case_spec->>'field'='delete' then after_parent is null
          when case_spec->>'name'='move_mapped_import_row_only' then after_parent->>'import_id'=import_a2::text and after_parent->>'tenant_id'=tenant_a::text
          when case_spec->>'name'='mapped_payload_edit' then after_parent->'payload'='{"designation":"ARMY updated metadata"}'::jsonb
          when case_spec->>'name'='import_metadata_edit' then after_parent->>'filename'='ARMY updated.csv'
          else false end,
        'acceptedParentEditPreservesOfferAndHistory',case when case_spec->>'expected'='accepted' and case_spec->>'field'<>'delete'
          then before_offer=after_offer and before_history=after_history else true end,
        'retainedTenant',after_offer->>'tenant_id'=tenant_a::text,
        'deletionProvenance',case when case_spec->>'field'='delete' then
          after_offer->>'source_mapped_row_id' is null and
          (case when case_spec->>'target'='import' then after_offer->>'source_import_id' is null else after_offer->>'source_import_id'=import_a1::text end)
          and after_parent is null else true end,
        'productUnchanged',(select to_jsonb(p)=original_product from public.products p where id=product_id_value),
        'validationCountUnchanged',(select count(*)=original_validations from public.product_reference_price_validations where product_id=product_id_value));
      all_passed := all_passed and (select bool_and(value='true'::jsonb) from jsonb_each(checks));
      result := jsonb_build_object('name',case_spec->>'name','expected',case_spec->>'expected','actual',outcome,'sqlstate',error_state,'error',error_message,
        'actorMode',case when coalesce((case_spec->>'owner')::boolean,false) then 'local fixture owner; constraints still apply' else 'authenticated' end,
        'checks',checks,'beforeParent',before_parent,'afterParent',after_parent,'before',before_offer,'after',after_offer,'historyDelta',after_history-before_history);
      raise exception using errcode='P9002',message='case evidence captured';
    exception when sqlstate 'P9002' then null;
    end;
    if (select to_jsonb(sp) is distinct from original_offer from public.supplier_pricebook sp where id=offer_id)
      or (select count(*)<>original_history from public.supplier_pricebook_history h where h.offer_id=reproduce.offer_id) then
      raise exception 'Parent case rollback did not restore original offer/history';
    end if;
    results := results || jsonb_build_array(result || jsonb_build_object('caseRollbackVerified',true));
  end loop;
  result := jsonb_build_object('database',current_database(),'port',inet_server_port(),'actor',actor,'tenant',tenant_a,'role',current_user,'globalAdmin',public.is_admin_user(),
    'foreignImportVisible',false,'foreignRowVisible',false,'newTenant',tenant_b,'newImports',jsonb_build_array(import_a1,import_a2,import_b1),'newRows',jsonb_build_array(row_a1,row_a2,row_b1),
    'originalOffer',original_offer,'originalProduct',original_product,'originalHistoryCount',original_history,'originalValidationCount',original_validations,
    'allPassed',all_passed,'cases',results,'terminalException','P9001 rolls back all fixture creation and writes');
  raise exception using errcode = 'P9001', message = 'CATALOGUE_PROVENANCE_PROOF:' || result::text;
end;
$probe$;
