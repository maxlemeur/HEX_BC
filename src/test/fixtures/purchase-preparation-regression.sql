do $probe$
declare
  actor constant uuid := '__PURCHASE_ACTOR_ID__';
  tenant_a constant uuid := '__PURCHASE_TENANT_ID__';
  project_a constant uuid := 'ee79e800-6e80-4788-9061-613157000001';
  version_a constant uuid := 'ee79e800-6e80-4788-9061-613157000002';
  section_a constant uuid := 'ee79e800-6e80-4788-9061-613157000003';
  product_a constant uuid := 'ee79e800-6e80-4788-9061-613157000004';
  supplier_a constant uuid := 'ee79e800-6e80-4788-9061-613157000005';
  supplier_b constant uuid := 'ee79e800-6e80-4788-9061-613157000006';
  offer_a constant uuid := 'ee79e800-6e80-4788-9061-613157000007';
  offer_b constant uuid := 'ee79e800-6e80-4788-9061-613157000008';
  line_a constant uuid := 'ee79e800-6e80-4788-9061-613157000009';
  line_b constant uuid := 'ee79e800-6e80-4788-9061-61315700000a';
  site_a constant uuid := 'ee79e800-6e80-4788-9061-61315700000b';
  key_a constant uuid := 'ee79e800-6e80-4788-9061-61315700000c';
  key_b constant uuid := 'ee79e800-6e80-4788-9061-61315700000d';
  version_other constant uuid := 'ee79e800-6e80-4788-9061-613157000010';
  section_other constant uuid := 'ee79e800-6e80-4788-9061-613157000011';
  tenant_b constant uuid := 'ee79e800-6e80-4788-9061-613157000020';
  project_b constant uuid := 'ee79e800-6e80-4788-9061-613157000021';
  version_b constant uuid := 'ee79e800-6e80-4788-9061-613157000022';
  section_b constant uuid := 'ee79e800-6e80-4788-9061-613157000023';
  case_name text;
  expected_error text;
  actual_error text;
  actual_state text;
  review jsonb;
  reviewed jsonb;
  groups jsonb;
  original_groups jsonb;
  result jsonb;
  replay jsonb;
  transfers jsonb;
  source_before jsonb;
  source_after jsonb;
  retained_review jsonb;
  results jsonb := '[]'::jsonb;
  case_result jsonb;
  passed boolean;
  order_count integer;
  item_count integer;
  receipt_count integer;
  claim_count integer;
  record_data record;
begin
  if exists(select 1 from public.estimate_projects where id=project_a)
    or exists(select 1 from public.products where id=product_a) then
    raise exception 'ARMY purchase probe identities must be absent';
  end if;
  if not exists(select 1 from public.tenant_memberships tm join public.profiles p on p.id=tm.user_id
    where tm.user_id=actor and tm.tenant_id=tenant_a and tm.role='admin' and p.role<>'admin') then
    raise exception 'Expected tenant admin fixture, not a global admin';
  end if;
  insert into public.suppliers(id,tenant_id,name,is_active) values
    (supplier_a,tenant_a,'ARMY-PREP-A',true),(supplier_b,tenant_a,'ARMY-PREP-B',true);
  insert into public.products(id,tenant_id,reference,designation,unit,unit_price_cents,is_active)
    values(product_a,tenant_a,'ARMY-PREP-PROBE','ARMY-PREP product','m',1500,true);
  insert into public.supplier_catalog_items(id,tenant_id,supplier_id,product_id,supplier_sku,is_active,created_by) values
    (supplier_a,tenant_a,supplier_a,product_a,'ARMY-A',true,actor),(supplier_b,tenant_a,supplier_b,product_a,'ARMY-B',true,actor);
  insert into public.supplier_pricebook(id,tenant_id,supplier_catalog_item_id,supplier_id,product_id,supplier_sku,unit,min_quantity,unit_price_cents,currency,valid_from,valid_to,is_active,created_by) values
    (offer_a,tenant_a,supplier_a,supplier_a,product_a,'ARMY-A','m',1,1800,'EUR',current_date,current_date+30,true,actor),
    (offer_b,tenant_a,supplier_b,supplier_b,product_a,'ARMY-B','m',1,900,'EUR',current_date,current_date+30,true,actor);
  -- Seed an earlier timestamp so set_updated_at(now()) during this single
  -- transaction genuinely changes the site revision as a later request would.
  insert into public.delivery_sites(id,tenant_id,name,is_active,updated_at) values(site_a,tenant_a,'ARMY-PREP chantier',true,now()-interval '1 second');
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(project_a,tenant_a,actor,'ARMY-PREP SQL');
  insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth,currency)
    values(version_a,tenant_a,project_a,1,1,1,'EUR');
  insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
    values(section_a,tenant_a,version_a,'section',1,'ARMY-PREP lot');
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,line_nature,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,selected_supplier_price_id,product_id,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
    values(line_a,tenant_a,version_a,section_a,'line','supply_only',1,'ARMY-PREP ligne A','m',2,1200,2000,1,0,1,offer_a,product_a,1200,2400,480,2880),
    (line_b,tenant_a,version_a,section_a,'line','supply_only',2,'ARMY-PREP ligne B','m',3,777,2000,1,0,1,offer_b,product_a,777,2331,466,2797);
  insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth,currency)
    values(version_other,tenant_a,project_a,2,1,1,'EUR');
  insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
    values(section_other,tenant_a,version_other,'section',1,'ARMY-PREP autre lot');
  insert into public.tenants(id,name,slug) values(tenant_b,'ARMY-PREP other tenant','army-prep-sql-other');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values(tenant_b,actor,'admin',false);
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(project_b,tenant_b,actor,'ARMY-PREP other project');
  insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth,currency)
    values(version_b,tenant_b,project_b,1,1,1,'EUR');
  insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
    values(section_b,tenant_b,version_b,'section',1,'ARMY-PREP other tenant lot');
  select jsonb_agg(to_jsonb(i) order by i.id) into source_before from public.estimate_items i where version_id=version_a;
  select jsonb_build_array(
    jsonb_build_object('supplier_id',supplier_a,'delivery_site_id',site_a,'delivery_site_updated_at',s.updated_at,'item_ids',jsonb_build_array(line_a),'expected_delivery_date',null,'notes','ARMY preparation'),
    jsonb_build_object('supplier_id',supplier_b,'delivery_site_id',site_a,'delivery_site_updated_at',s.updated_at,'item_ids',jsonb_build_array(line_b),'expected_delivery_date',null,'notes','ARMY preparation'))
    into original_groups from public.delivery_sites s where id=site_a;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if current_user<>'authenticated' or auth.uid()<>actor or public.current_tenant_id()<>tenant_a or public.is_admin_user() then
    raise exception 'Incorrect fixture auth scope';
  end if;
  foreach case_name in array array[
    'valid-two-suppliers','replay-same-key','reused-key-different-payload',
    'stale-quantity','stale-cost','stale-tax','stale-title','stale-unit','stale-site','stale-policy','stale-uppercase-fingerprint',
    'inactive-offer','inactive-supplier','expired-offer','future-offer','minimum-offer','currency-offer',
    'fractional-quantity','currency-version','second-supplier-failure',
    'duplicate-draft','duplicate-sent','duplicate-confirmed','duplicate-received','duplicate-canceled','duplicate-deleted',
    'viewer-role','director-role','inactive-tenant','inaccessible-version','private-ledger-dml','direct-second-transfer',
    'transferred-item-version-move','transferred-item-tenant-move','transferred-version-project-move',
    'delete-source-version','invalid-notes-object','invalid-date-object','invalid-date-calendar'
  ] loop
    case_result:=null; actual_error:=null; actual_state:=null; expected_error:=null; passed:=false;
    begin
      groups:=original_groups;
      execute 'select public.get_estimate_purchase_order_review($1,$2)' into review using version_a,array[line_a,line_b];
      select jsonb_agg(jsonb_build_object('item_id',l->'item_id','review_fingerprint',l->'review_fingerprint') order by l->>'item_id')
        into reviewed from jsonb_array_elements(review->'lines') l;
      if jsonb_array_length(reviewed)<>2 then raise exception 'Review must contain two exact source lines'; end if;
      if exists(select 1 from jsonb_array_elements(review->'lines') l where l ? '_snapshot') then raise exception 'Private source snapshot must not be exposed by review RPC'; end if;
      if case_name like 'invalid-%' then
        expected_error:='ORDER_DRAFT_INPUT_INVALID';
        if case_name='invalid-notes-object' then groups:=jsonb_set(groups,'{0,notes}','{"unsafe":"object"}');
        elsif case_name='invalid-date-object' then groups:=jsonb_set(groups,'{0,expected_delivery_date}','{"unsafe":"object"}');
        elsif case_name='invalid-date-calendar' then groups:=jsonb_set(groups,'{0,expected_delivery_date}','"2026-02-30"'); end if;
      end if;
      if case_name like 'stale-%' or case_name in ('inactive-offer','inactive-supplier','expired-offer','future-offer','minimum-offer','currency-offer','fractional-quantity','currency-version','viewer-role','director-role','inactive-tenant','second-supplier-failure') then
        execute 'reset role';
        if case_name='stale-quantity' then update public.estimate_items set quantity=3 where id=line_a;
        elsif case_name='stale-cost' then update public.estimate_items set unit_price_ht_cents=1300 where id=line_a;
        elsif case_name='stale-tax' then update public.estimate_items set tax_rate_bp=1000 where id=line_a;
        elsif case_name='stale-title' then update public.estimate_items set title='ARMY-PREP changed' where id=line_a;
        elsif case_name='stale-unit' then update public.estimate_items set description='u' where id=line_a;
        elsif case_name='stale-site' then update public.delivery_sites set name='ARMY-PREP changed',updated_at=clock_timestamp() where id=site_a;
        elsif case_name='stale-policy' then insert into public.feature_flags(tenant_id,flag_key,enabled,value) values(tenant_a,'STALE_PRICE_DAYS',true,'1') on conflict(tenant_id,flag_key) do update set enabled=true,value='1';
        elsif case_name='stale-uppercase-fingerprint' then
          update public.estimate_items set unit_price_ht_cents=1300 where id=line_a;
          select jsonb_agg(jsonb_set(l,'{item_id}',to_jsonb(upper(l->>'item_id')))) into reviewed from jsonb_array_elements(reviewed) l;
        elsif case_name='inactive-offer' then update public.supplier_pricebook set is_active=false where id=offer_a;
        elsif case_name='inactive-supplier' then update public.suppliers set is_active=false where id=supplier_a;
        elsif case_name='expired-offer' then update public.supplier_pricebook set valid_from=current_date-20,valid_to=current_date-1 where id=offer_a;
        elsif case_name='future-offer' then update public.supplier_pricebook set valid_from=current_date+1,valid_to=current_date+30 where id=offer_a;
        elsif case_name='minimum-offer' then update public.supplier_pricebook set min_quantity=10 where id=offer_a;
        elsif case_name='currency-offer' then update public.supplier_pricebook set currency='USD' where id=offer_a;
        elsif case_name='fractional-quantity' then update public.estimate_items set quantity=2.5 where id=line_a;
        elsif case_name='currency-version' then update public.estimate_versions set currency='USD' where id=version_a;
        elsif case_name='viewer-role' then update public.tenant_memberships set role='viewer' where tenant_id=tenant_a and user_id=actor;
        elsif case_name='director-role' then update public.tenant_memberships set role='director' where tenant_id=tenant_a and user_id=actor;
        elsif case_name='inactive-tenant' then update public.tenants set is_active=false where id=tenant_a;
        elsif case_name='second-supplier-failure' then
          execute $ddl$create function pg_temp.fail_purchase_second_supplier() returns trigger language plpgsql as $fn$ begin raise exception 'ARMY_SECOND_SUPPLIER_FAILURE'; end; $fn$$ddl$;
          execute $ddl$create trigger army_fail_purchase_second_supplier before insert on public.purchase_order_items for each row when (new.designation='ARMY-PREP ligne B') execute function pg_temp.fail_purchase_second_supplier()$ddl$;
        end if;
        execute 'set local role authenticated';
        expected_error:=case when case_name in ('viewer-role','director-role','inactive-tenant') then 'ORDER_DRAFT_ACCESS_DENIED' when case_name='second-supplier-failure' then 'ARMY_SECOND_SUPPLIER_FAILURE' else 'ORDER_DRAFT_PREPARATION_STALE' end;
      end if;
      if case_name='inaccessible-version' then
        expected_error:='ORDER_DRAFT_ACCESS_DENIED';
        begin execute 'select public.create_estimate_purchase_order_drafts($1,$2,$3,$4)' into result using gen_random_uuid(),key_a,reviewed,groups;
        exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
      elsif case_name='private-ledger-dml' then
        expected_error:='42501';
        begin execute 'delete from private.estimate_purchase_transfers';
        exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
      else
        begin execute 'select public.create_estimate_purchase_order_drafts($1,$2,$3,$4)' into result using version_a,key_a,reviewed,groups;
        exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
      end if;
      if expected_error is not null then
        passed:=case when expected_error='42501' then actual_state='42501' else actual_error=expected_error end;
        execute 'reset role';
        select count(*) into order_count from public.purchase_orders where source_estimate_version_id=version_a;
        select count(*) into item_count from public.purchase_order_items where source_estimate_item_id in(line_a,line_b);
        execute 'select count(*) from private.estimate_purchase_receipts where source_version_id=$1' into receipt_count using version_a;
        execute 'select count(*) from private.estimate_purchase_transfers where source_version_id=$1' into claim_count using version_a;
        passed:=passed and order_count=0 and item_count=0 and receipt_count=0 and claim_count=0;
      elsif actual_error is not null then passed:=false;
      else
        if jsonb_array_length(result->'orders')<>2 then raise exception 'Two orders required'; end if;
        if result->'summary'<>jsonb_build_object('draft_orders_created',2,'draft_lines_created',2) then raise exception 'Exact result counts required'; end if;
        select count(*) into order_count from public.purchase_orders where source_estimate_version_id=version_a;
        select count(*) into item_count from public.purchase_order_items where source_estimate_item_id in(line_a,line_b);
        if order_count<>2 or item_count<>2 then raise exception 'Two persisted orders and two persisted items required'; end if;
        if exists(select 1 from public.purchase_orders po where po.source_estimate_version_id=version_a and not exists(
          select 1 from jsonb_array_elements(result->'orders') o where (o->>'purchase_order_id')::uuid=po.id and o->>'reference'=po.reference
        )) then raise exception 'Receipt must identify actual persisted orders'; end if;
        for record_data in select po.supplier_id,po.status,po.total_ht_cents,po.total_tax_cents,po.total_ttc_cents,poi.quantity,poi.unit_price_ht_cents,poi.source_selected_supplier_price_id
          from public.purchase_orders po join public.purchase_order_items poi on poi.purchase_order_id=po.id where po.source_estimate_version_id=version_a loop
          if record_data.status<>'draft' then raise exception 'Only draft orders may be created'; end if;
          if record_data.supplier_id=supplier_a and (record_data.total_ht_cents<>2400 or record_data.total_tax_cents<>480 or record_data.total_ttc_cents<>2880 or record_data.quantity<>2 or record_data.unit_price_ht_cents<>1200 or record_data.source_selected_supplier_price_id<>offer_a) then raise exception 'A totals/source mismatch'; end if;
          if record_data.supplier_id=supplier_b and (record_data.total_ht_cents<>2331 or record_data.total_tax_cents<>466 or record_data.total_ttc_cents<>2797 or record_data.quantity<>3 or record_data.unit_price_ht_cents<>777 or record_data.source_selected_supplier_price_id<>offer_b) then raise exception 'B totals/source mismatch'; end if;
        end loop;
        select jsonb_agg(to_jsonb(i) order by i.id) into source_after from public.estimate_items i where version_id=version_a;
        if source_after is distinct from source_before then raise exception 'Source estimate changed'; end if;
        passed:=true;
        if case_name='replay-same-key' then
          execute 'select public.create_estimate_purchase_order_drafts($1,$2,$3,$4)' into replay using version_a,key_a,reviewed,groups;
          passed:=replay->>'replayed'='true' and (replay-'replayed')=(result-'replayed');
        elsif case_name='reused-key-different-payload' then
          groups:=jsonb_set(groups,'{0,notes}','"Changed request"');
          begin execute 'select public.create_estimate_purchase_order_drafts($1,$2,$3,$4)' into replay using version_a,key_a,reviewed,groups;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='ORDER_DRAFT_IDEMPOTENCY_CONFLICT';
        elsif case_name like 'duplicate-%' then
          if case_name='duplicate-deleted' then delete from public.purchase_orders where source_estimate_version_id=version_a;
          elsif case_name<>'duplicate-draft' then update public.purchase_orders set status=substring(case_name from 11)::public.purchase_order_status where source_estimate_version_id=version_a; end if;
          execute 'select public.get_estimate_purchase_order_receipt($1,$2)' into replay using version_a,key_a;
          if case_name='duplicate-deleted' and exists(select 1 from jsonb_array_elements(replay->'orders') o where o->>'current_status'<>'deleted') then raise exception 'Deleted receipt status lost'; end if;
          if case_name='duplicate-deleted' then
            execute 'reset role';
            execute 'select review_snapshot from private.estimate_purchase_receipts where source_version_id=$1 and idempotency_key=$2' into retained_review using version_a,key_a;
            if jsonb_array_length(retained_review)<>2 or not exists(select 1 from jsonb_array_elements(retained_review) l where
              l->>'item_id'=line_a::text and (l->'_snapshot'->>'unit_price_ht_cents')::numeric=1200
              and (l->'_snapshot'->>'tax_rate_bp')::numeric=2000 and (l->'_snapshot'->>'quantity')::numeric=2
              and l->'_snapshot'->>'unit'='m' and l->'_snapshot'->>'selected_supplier_price_id'=offer_a::text
              and (l->'_snapshot'->>'offer_unit_price_cents')::numeric=1800 and l->'_snapshot'->>'offer_currency'='EUR'
              and (l->'_snapshot'->>'offer_min_quantity')::numeric=1 and l->'_snapshot'->>'offer_valid_to'=(current_date+30)::text) then
              raise exception 'Full reviewed purchase source must survive order deletion';
            end if;
            execute 'set local role authenticated';
          end if;
          execute 'select public.get_estimate_purchase_order_transfers($1)' into transfers using version_a;
          if jsonb_array_length(transfers->'lines')<>2 then raise exception 'Durable transfers lost'; end if;
          begin execute 'select public.create_estimate_purchase_order_drafts($1,$2,$3,$4)' into replay using version_a,key_b,reviewed,groups;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='ORDER_DRAFT_ALREADY_EXISTS';
        elsif case_name='direct-second-transfer' then
          begin
            insert into public.purchase_orders(id,tenant_id,user_id,reference,supplier_id,delivery_site_id,source_estimate_version_id)
              values(key_b,tenant_a,actor,'ARMY-PREP duplicate',supplier_a,site_a,version_a);
            insert into public.purchase_order_items(tenant_id,purchase_order_id,position,designation,quantity,unit_price_ht_cents,tax_rate_bp,source_estimate_item_id,source_selected_supplier_price_id)
              values(tenant_a,key_b,1,'ARMY-PREP duplicate',2,1200,2000,line_a,offer_a);
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='ORDER_DRAFT_ALREADY_EXISTS' or actual_state='23505';
        elsif case_name like 'transferred-%' then
          begin
            if case_name='transferred-item-version-move' then update public.estimate_items set version_id=version_other,parent_id=section_other where id=line_a;
            elsif case_name='transferred-item-tenant-move' then update public.estimate_items set tenant_id=tenant_b,version_id=version_b,parent_id=section_b,product_id=null where id=line_a;
            elsif case_name='transferred-version-project-move' then update public.estimate_versions set project_id=project_b,tenant_id=tenant_b,version_number=3 where id=version_a;
            end if;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='ORDER_DRAFT_SOURCE_SCOPE_INVALID';
        elsif case_name='delete-source-version' then
          begin delete from public.estimate_versions where id=version_a;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error is null and not exists(select 1 from public.estimate_versions where id=version_a)
            and (select count(*) from public.purchase_orders where source_estimate_version_id is null and id in(select (o->>'purchase_order_id')::uuid from jsonb_array_elements(result->'orders') o))=2;
          execute 'reset role';
          execute 'select count(*) from private.estimate_purchase_receipts where source_version_id=$1' into receipt_count using version_a;
          execute 'select count(*) from private.estimate_purchase_transfers where source_version_id=$1' into claim_count using version_a;
          passed:=passed and receipt_count=1 and claim_count=2;
        end if;
      end if;
      case_result:=jsonb_build_object('case',case_name,'passed',coalesce(passed,false),'expectedError',expected_error,'actualError',actual_error,'actualState',actual_state,'result',result);
      raise exception using errcode='P9002',message=case_result::text;
    exception
      when sqlstate 'P9002' then get stacked diagnostics actual_error=message_text; case_result:=actual_error::jsonb;
      when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate;
        case_result:=jsonb_build_object('case',case_name,'passed',false,'actualError',actual_error,'actualState',actual_state);
    end;
    results:=results||jsonb_build_array(case_result);
  end loop;
  raise exception using errcode = 'P9001',message='PURCHASE_PREPARATION_PROOF:'||jsonb_build_object(
    'cases',results,'allPassed',not exists(select 1 from jsonb_array_elements(results) r where r->>'passed'<>'true'),
    'fixtureProject',project_a,'fixtureVersion',version_a,'fixtureLines',array[line_a,line_b],
    'authenticatedActor',actor,'tenant',tenant_a,'rolledBack',true)::text;
end;
$probe$;
