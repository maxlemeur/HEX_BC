do $probe$
declare
  actor constant uuid := '__PURCHASE_ACTOR_ID__';
  tenant_a constant uuid := '__PURCHASE_TENANT_ID__';
  tenant_b constant uuid := '41d15500-2e47-4fa8-a123-06125000000e';
  project_a constant uuid := '41d15500-2e47-4fa8-a123-061250000001';
  version_a constant uuid := '41d15500-2e47-4fa8-a123-061250000002';
  section_a constant uuid := '41d15500-2e47-4fa8-a123-061250000003';
  supplier_a constant uuid := '41d15500-2e47-4fa8-a123-061250000004';
  supplier_b constant uuid := '41d15500-2e47-4fa8-a123-06125000000c';
  site_a constant uuid := '41d15500-2e47-4fa8-a123-061250000005';
  product_a constant uuid := '41d15500-2e47-4fa8-a123-061250000006';
  product_b constant uuid := '41d15500-2e47-4fa8-a123-06125000000f';
  offer_a constant uuid := '41d15500-2e47-4fa8-a123-061250000007';
  line_a constant uuid := '41d15500-2e47-4fa8-a123-061250000008';
  line_b constant uuid := '41d15500-2e47-4fa8-a123-061250000009';
  line_c constant uuid := '41d15500-2e47-4fa8-a123-06125000000a';
  key_a constant uuid := '41d15500-2e47-4fa8-a123-06125000000b';
  manual_header jsonb;
  base_items jsonb;
  input_items jsonb;
  groups jsonb;
  review jsonb;
  reviewed jsonb;
  result jsonb;
  replay jsonb;
  history jsonb;
  source_before jsonb;
  source_after jsonb;
  receipt_before jsonb;
  receipt_after jsonb;
  source_order uuid;
  item_id uuid;
  revision_value bigint;
  old_revision bigint;
  other_order uuid;
  other_item uuid;
  export_ids uuid[];
  counter integer;
  case_name text;
  actual_error text;
  actual_state text;
  expected_error text;
  passed boolean;
  results jsonb := '[]'::jsonb;
  case_result jsonb;
  row_value jsonb;
  expected_totals jsonb;
begin
  if exists(select 1 from public.estimate_projects where id=project_a) then raise exception 'Decimal fixture IDs must be absent'; end if;
  insert into public.tenants(id,name,slug) values(tenant_b,'ARMY-DECIMAL other tenant','army-decimal-sql-other');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values(tenant_b,actor,'admin',false);
  insert into public.suppliers(id,tenant_id,name,is_active) values(supplier_a,tenant_a,'ARMY-DECIMAL-SQL supplier',true),(supplier_b,tenant_a,'ARMY-DECIMAL-SQL alternative supplier',true);
  insert into public.products(id,tenant_id,reference,designation,unit,unit_price_cents,is_active) values(product_a,tenant_a,'ARMY-DECIMAL-SQL','ARMY-DECIMAL-SQL product','m',999,true),(product_b,tenant_a,'ARMY-DECIMAL-DELETE','ARMY-DECIMAL detached product','m',999,true);
  insert into public.supplier_catalog_items(id,tenant_id,supplier_id,product_id,supplier_sku,is_active,created_by) values(supplier_a,tenant_a,supplier_a,product_a,'ARMY-DECIMAL-SQL-SKU',true,actor);
  insert into public.supplier_pricebook(id,tenant_id,supplier_catalog_item_id,supplier_id,product_id,supplier_sku,unit,min_quantity,unit_price_cents,currency,valid_from,valid_to,is_active,created_by)
    values(offer_a,tenant_a,supplier_a,supplier_a,product_a,'ARMY-DECIMAL-SQL-SKU','m',0.001,999,'EUR',current_date,current_date+30,true,actor);
  insert into public.delivery_sites(id,tenant_id,name,is_active) values(site_a,tenant_a,'ARMY-DECIMAL-SQL site',true);
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(project_a,tenant_a,actor,'ARMY-DECIMAL-SQL');
  insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth,currency) values(version_a,tenant_a,project_a,1,1,1,'EUR');
  insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title) values(section_a,tenant_a,version_a,'section',1,'ARMY-DECIMAL-SQL lot');
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,line_nature,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,selected_supplier_price_id,product_id,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents) values
    (line_a,tenant_a,version_a,section_a,'line','supply_only',1,'ARMY-DECIMAL-SQL half','m',12.5,123,2000,1,0,1,offer_a,product_a,123,1538,308,1846),
    (line_b,tenant_a,version_a,section_a,'line','supply_only',2,'ARMY-DECIMAL-SQL eighth','m',0.125,777,2000,1,0,1,offer_a,product_a,777,97,19,116),
    (line_c,tenant_a,version_a,section_a,'line','supply_only',3,'ARMY-DECIMAL-SQL thousandth','m',0.001,500,2000,1,0,1,offer_a,product_a,500,1,0,1);
  manual_header:=jsonb_build_object('supplier_id',supplier_a,'delivery_site_id',site_a,'notes','ARMY-DECIMAL SQL','expected_delivery_date',null);
  base_items:=jsonb_build_array(
    jsonb_build_object('designation','ARMY-DECIMAL-SQL half','quantity',12.5,'unit','m','unit_price_ht_cents',123,'tax_rate_bp',2000,'product_id',product_a,'reference','ARMY-DECIMAL-SQL-SKU'),
    jsonb_build_object('designation','ARMY-DECIMAL-SQL eighth','quantity',0.125,'unit','m','unit_price_ht_cents',777,'tax_rate_bp',2000),
    jsonb_build_object('designation','ARMY-DECIMAL-SQL thousandth','quantity',0.001,'unit','m','unit_price_ht_cents',500,'tax_rate_bp',2000));
  select jsonb_build_array(jsonb_build_object('supplier_id',supplier_a,'delivery_site_id',site_a,'delivery_site_updated_at',updated_at,'item_ids',jsonb_build_array(line_a,line_b,line_c),'expected_delivery_date',null,'notes','ARMY decimal preparation')) into groups from public.delivery_sites where id=site_a;
  select jsonb_agg(to_jsonb(i) order by i.id) into source_before from public.estimate_items i where version_id=version_a;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.current_tenant_id()<>tenant_a or current_user<>'authenticated' or public.is_admin_user() then raise exception 'Unexpected actor scope'; end if;
  foreach case_name in array array[
    'source-decimals','manual-decimals','quantity-zero','quantity-negative','quantity-precision','quantity-string','quantity-missing','quantity-overflow','quantity-max-historical',
    'price-fractional','amount-overflow','unit-missing','source-unit-spoof','source-provenance-spoof',
    'edit-note-only','edit-decimal-preserves-origin','edit-unit-sourced-refused','edit-stale-revision','edit-id-foreign','edit-id-duplicate','legacy-overload-blocked',
    'direct-line-totals-corrected','direct-header-totals-corrected','direct-fourth-decimal-refused','manual-atomic-second-line',
    'source-minimum-below','source-minimum-exact','source-unit-ambiguous','source-replay-immutable','read-history-owner','viewer-denied','non-draft-edit-denied',
    'edit-reorder','edit-remove-add','direct-source-detach-refused','source-deleted-unit-refused','legacy-unit-note-allowed','legacy-unit-correction-refused','legacy-unit-confirmation','direct-sent-update-trigger','direct-sent-delete-trigger','direct-sent-insert-trigger','export-1200-items','export-inaccessible','export-cap','source-supplier-change-refused','source-supplier-ledger-refused','source-product-preserved','source-spaced-unit','order-id-rebind-refused','order-tenant-rebind-refused','sent-product-delete-preserved'
  ] loop
    result:=null; actual_error:=null; actual_state:=null; expected_error:=null; passed:=false; case_result:=null;
    begin
      input_items:=base_items;
      if case_name='sent-product-delete-preserved' then input_items:=jsonb_set(input_items,'{0,product_id}',to_jsonb(product_b));
      elsif case_name='quantity-zero' then input_items:=jsonb_set(input_items,'{0,quantity}','0'); expected_error:='PURCHASE_ORDER_QUANTITY_INVALID';
      elsif case_name='quantity-negative' then input_items:=jsonb_set(input_items,'{0,quantity}','-0.001'); expected_error:='PURCHASE_ORDER_QUANTITY_INVALID';
      elsif case_name='quantity-precision' then input_items:=jsonb_set(input_items,'{0,quantity}','12.5004'); expected_error:='PURCHASE_ORDER_QUANTITY_INVALID';
      elsif case_name='quantity-string' then input_items:=jsonb_set(input_items,'{0,quantity}','"12.5"'); expected_error:='PURCHASE_ORDER_QUANTITY_INVALID';
      elsif case_name='quantity-missing' then input_items:=jsonb_set(input_items,'{0}',(input_items->0)-'quantity'); expected_error:='PURCHASE_ORDER_QUANTITY_INVALID';
      elsif case_name='quantity-overflow' then input_items:=jsonb_set(input_items,'{0,quantity}','2147483648'); expected_error:='PURCHASE_ORDER_QUANTITY_INVALID';
      elsif case_name='quantity-max-historical' then input_items:=jsonb_build_array(jsonb_set(jsonb_set(input_items->0,'{quantity}','2147483647'),'{unit_price_ht_cents}','0'));
      elsif case_name='price-fractional' then input_items:=jsonb_set(input_items,'{0,unit_price_ht_cents}','0.5'); expected_error:='PURCHASE_ORDER_INPUT_INVALID';
      elsif case_name='amount-overflow' then input_items:=jsonb_set(input_items,'{0,unit_price_ht_cents}','2147483647'); expected_error:='PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE';
      elsif case_name='unit-missing' then input_items:=jsonb_set(input_items,'{0}',(input_items->0)-'unit'); expected_error:='PURCHASE_ORDER_UNIT_REQUIRED';
      elsif case_name='source-unit-spoof' then input_items:=jsonb_set(input_items,'{0,price_unit}','"kg"'); expected_error:='PURCHASE_ORDER_INPUT_INVALID';
      elsif case_name='source-provenance-spoof' then input_items:=jsonb_set(input_items,'{0,source_estimate_item_id}',to_jsonb(line_a)); expected_error:='PURCHASE_ORDER_INPUT_INVALID';
      end if;
      if case_name='manual-atomic-second-line' then
        execute 'reset role';
        execute $ddl$create function pg_temp.fail_decimal_second_line() returns trigger language plpgsql as $fn$ begin raise exception 'ARMY_DECIMAL_SECOND_LINE_FAILURE'; end; $fn$$ddl$;
        execute $ddl$create trigger army_fail_decimal_second_line before insert on public.purchase_order_items for each row when(new.designation='ARMY-DECIMAL-SQL eighth') execute function pg_temp.fail_decimal_second_line()$ddl$;
        execute 'set local role authenticated'; expected_error:='ARMY_DECIMAL_SECOND_LINE_FAILURE';
      elsif case_name='viewer-denied' then
        execute 'reset role'; update public.tenant_memberships set role='viewer' where user_id=actor and tenant_id=tenant_a; execute 'set local role authenticated'; expected_error:='PURCHASE_ORDER_ACCESS_DENIED';
      end if;
      if case_name like 'source-%' and case_name not in ('source-unit-spoof','source-provenance-spoof') or case_name in ('edit-note-only','edit-decimal-preserves-origin','edit-unit-sourced-refused','source-replay-immutable','direct-source-detach-refused') then
        if case_name='source-spaced-unit' then
          execute 'reset role'; update public.supplier_pricebook set unit=' m ' where id=offer_a; execute 'set local role authenticated';
        end if;
        if case_name in ('source-minimum-below','source-minimum-exact','source-unit-ambiguous') then
          execute 'reset role';
          if case_name='source-unit-ambiguous' then update public.estimate_items set description='mL' where id=line_a;
          else update public.supplier_pricebook set min_quantity=12.500 where id=offer_a;
            if case_name='source-minimum-below' then update public.estimate_items set quantity=12.499 where id=line_a; end if;
          end if;
          execute 'set local role authenticated';
          groups:=jsonb_set(groups,'{0,item_ids}',jsonb_build_array(line_a));
          if case_name<>'source-minimum-exact' then expected_error:='ORDER_DRAFT_PREPARATION_STALE'; end if;
        end if;
        select public.get_estimate_purchase_order_review(version_a,array(select (v.value)::uuid from jsonb_array_elements_text(groups->0->'item_ids') v)) into review;
        select jsonb_agg(jsonb_build_object('item_id',l->'item_id','review_fingerprint',l->'review_fingerprint')) into reviewed from jsonb_array_elements(review->'lines') l;
        begin select public.create_estimate_purchase_order_drafts(version_a,key_a,reviewed,groups) into result;
        exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
        source_order:=(result->'orders'->0->>'purchase_order_id')::uuid;
      else
        begin execute 'select public.create_purchase_order_draft($1,$2)' into result using manual_header,input_items;
        exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
        source_order:=(result->>'id')::uuid;
      end if;
      if expected_error is not null then
        passed:=actual_error=expected_error and not exists(select 1 from public.purchase_orders where supplier_id=supplier_a);
      elsif actual_error is not null then passed:=false;
      else
        select to_jsonb(po) into row_value from public.purchase_orders po where id=source_order;
        expected_totals:=case when case_name='quantity-max-historical' then '[0,0,0]'::jsonb when case_name='source-minimum-exact' then '[1538,308,1846]'::jsonb else '[1636,327,1963]'::jsonb end;
        if jsonb_build_array(row_value->'total_ht_cents',row_value->'total_tax_cents',row_value->'total_ttc_cents')<>expected_totals then raise exception 'Exact decimal header totals mismatch: %',row_value; end if;
        if exists(select 1 from public.purchase_order_items oi where purchase_order_id=source_order and (to_jsonb(oi)->>'unit' is distinct from 'm' or to_jsonb(oi)->>'price_unit' is distinct from 'm')) then raise exception 'Persisted units missing'; end if;
        if case_name<>'quantity-max-historical' and (select quantity from public.purchase_order_items where purchase_order_id=source_order and designation='ARMY-DECIMAL-SQL half')<>12.5 then raise exception 'Fractional quantity was changed'; end if;
        revision_value:=(row_value->>'edit_revision')::bigint;
        if revision_value is null or revision_value<1 then raise exception 'Positive edit revision required'; end if;
        select id into item_id from public.purchase_order_items where purchase_order_id=source_order order by position limit 1;
        select jsonb_agg(to_jsonb(oi) order by position) into input_items from public.purchase_order_items oi where purchase_order_id=source_order;
        select jsonb_agg(jsonb_build_object('id',l->'id','designation',l->'designation','quantity',l->'quantity','unit_price_ht_cents',l->'unit_price_ht_cents','tax_rate_bp',l->'tax_rate_bp') order by (l->>'position')::integer)
          into input_items from jsonb_array_elements(input_items) l;
        if case_name in ('edit-note-only','edit-decimal-preserves-origin','edit-unit-sourced-refused','source-replay-immutable','direct-source-detach-refused') then
          execute 'reset role'; select to_jsonb(r) into receipt_before from private.estimate_purchase_receipts r where r.source_version_id=version_a and r.idempotency_key=key_a; execute 'set local role authenticated';
        end if;
        passed:=true;
        if case_name='edit-note-only' then
          execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{"notes":"ARMY note only"}'::jsonb,null::jsonb,revision_value;
          if not exists(select 1 from public.purchase_order_items where id=item_id and purchase_order_id=source_order and quantity=12.5 and reference='ARMY-DECIMAL-SQL-SKU' and source_estimate_item_id=line_a and source_selected_supplier_price_id=offer_a) then raise exception 'Note edit lost line identity or provenance'; end if;
        elsif case_name='edit-decimal-preserves-origin' then
          input_items:=jsonb_set(jsonb_set(input_items,'{0,quantity}','13.125'),'{0,unit_price_ht_cents}','137');
          execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
          if not exists(select 1 from public.purchase_order_items where id=item_id and quantity=13.125 and unit_price_ht_cents=137 and reference='ARMY-DECIMAL-SQL-SKU' and source_estimate_item_id=line_a and source_selected_supplier_price_id=offer_a) then raise exception 'Edited source identity/cost not preserved'; end if;
          execute 'select public.get_purchase_order_item_history($1)' into history using source_order;
          if not exists(select 1 from jsonb_array_elements(history->'events') e where e->>'operation'='update' and e->>'item_id'=item_id::text and e->>'actor_id'=actor::text and (e->'before'->>'quantity')::numeric=12.5 and (e->'after'->>'quantity')::numeric=13.125 and (e->'after'->>'unit_price_ht_cents')::numeric=137) then raise exception 'Correction audit missing exact before/after and actor'; end if;
          execute 'reset role';
          if (select quantity from private.estimate_purchase_transfers where source_item_id=line_a)<>12.5 then raise exception 'Initial transfer was rewritten'; end if;
          execute 'set local role authenticated';
        elsif case_name='edit-unit-sourced-refused' then
          input_items:=jsonb_set(input_items,'{0,unit}','"kg"');
          begin execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
        elsif case_name='edit-stale-revision' then
          old_revision:=revision_value;
          execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{"notes":"first edit"}'::jsonb,null::jsonb,revision_value;
          begin execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{"notes":"stale edit"}'::jsonb,null::jsonb,old_revision;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_REVISION_CONFLICT' and (select notes from public.purchase_orders where id=source_order)='first edit';
        elsif case_name in ('edit-id-foreign','edit-id-duplicate') then
          if case_name='edit-id-foreign' then
            execute 'select public.create_purchase_order_draft($1,$2)' into replay using manual_header,base_items;
            other_order:=(replay->>'id')::uuid;
            select id into other_item from public.purchase_order_items where purchase_order_id=other_order order by position limit 1;
            input_items:=jsonb_set(input_items,'{0,id}',to_jsonb(other_item));
          else input_items:=jsonb_set(input_items,'{1,id}',input_items->0->'id'); end if;
          begin execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_ITEMS_INVALID';
        elsif case_name='legacy-overload-blocked' then
          begin execute 'select public.replace_purchase_order_draft($1,$2,$3)' into replay using source_order,'{"notes":"unsafe legacy edit"}'::jsonb,null::jsonb;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_state='42501' or actual_error='PURCHASE_ORDER_REVISION_REQUIRED';
        elsif case_name='direct-line-totals-corrected' then
          update public.purchase_order_items set quantity=0.001,unit_price_ht_cents=500,line_total_ht_cents=999,line_tax_cents=999,line_total_ttc_cents=999 where id=item_id;
          select to_jsonb(oi) into row_value from public.purchase_order_items oi where id=item_id;
          passed:=jsonb_build_array(row_value->'line_total_ht_cents',row_value->'line_tax_cents',row_value->'line_total_ttc_cents')='[1,0,1]'::jsonb
            and (select edit_revision from public.purchase_orders where id=source_order)>revision_value;
        elsif case_name='direct-header-totals-corrected' then
          update public.purchase_orders set total_ht_cents=999,total_tax_cents=999,total_ttc_cents=1998 where id=source_order;
          select to_jsonb(po) into row_value from public.purchase_orders po where id=source_order;
          passed:=jsonb_build_array(row_value->'total_ht_cents',row_value->'total_tax_cents',row_value->'total_ttc_cents')='[1636,327,1963]'::jsonb;
        elsif case_name='direct-fourth-decimal-refused' then
          begin update public.purchase_order_items set quantity=12.5004 where id=item_id;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_QUANTITY_INVALID' and (select quantity from public.purchase_order_items where id=item_id)=12.5;
        elsif case_name='source-replay-immutable' then
          select public.create_estimate_purchase_order_drafts(version_a,key_a,reviewed,groups) into replay;
          passed:=(replay-'replayed')=(result-'replayed') and (replay->>'replayed')::boolean;
        elsif case_name='read-history-owner' then
          execute 'select public.get_purchase_order_item_history($1)' into history using source_order;
          passed:=jsonb_array_length(history->'events')=3;
        elsif case_name='edit-reorder' then
          input_items:=jsonb_build_array(input_items->2,input_items->0,input_items->1);
          execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
          passed:=(select position from public.purchase_order_items where id=item_id)=2;
        elsif case_name='edit-remove-add' then
          other_item:=(input_items->1->>'id')::uuid;
          input_items:=jsonb_build_array(input_items->0,base_items->2);
          execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
          execute 'select public.get_purchase_order_item_history($1)' into history using source_order;
          passed:=not exists(select 1 from public.purchase_order_items where id=other_item)
            and exists(select 1 from public.purchase_order_items where id=item_id)
            and exists(select 1 from jsonb_array_elements(history->'events') e where e->>'operation'='delete' and e->>'item_id'=other_item::text);
        elsif case_name='direct-source-detach-refused' then
          begin update public.purchase_order_items set source_estimate_item_id=null,source_selected_supplier_price_id=null where id=item_id;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_ITEMS_INVALID';
        elsif case_name='source-deleted-unit-refused' then
          delete from public.estimate_items where id=line_a;
          if not exists(select 1 from public.purchase_order_items where id=item_id and source_estimate_item_id is null and is_source_linked) then raise exception 'Source flag did not survive FK detach'; end if;
          begin update public.purchase_order_items set unit='kg' where id=item_id;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
        elsif case_name like 'legacy-unit-%' then
          execute 'reset role';
          -- Reproduce an existing pre-migration row without fabricating an origin.
          alter table public.purchase_order_items disable trigger user;
          update public.purchase_order_items set unit=null,price_unit=null where id=item_id;
          alter table public.purchase_order_items enable trigger user;
          execute 'set local role authenticated';
          if case_name='legacy-unit-note-allowed' then
            execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{"notes":"legacy note only"}'::jsonb,input_items,revision_value;
            passed:=(select unit is null from public.purchase_order_items where id=item_id);
          else
            input_items:=jsonb_set(input_items,'{0,quantity}','13.125');
            if case_name='legacy-unit-confirmation' then input_items:=jsonb_set(input_items,'{0,unit}','"m"'); end if;
            begin execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
            exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
            passed:=case when case_name='legacy-unit-correction-refused' then actual_error='PURCHASE_ORDER_UNIT_REQUIRED'
              else actual_error is null and exists(select 1 from public.purchase_order_items where id=item_id and unit='m' and price_unit='m' and quantity=13.125) end;
          end if;
        elsif case_name in ('direct-sent-update-trigger','direct-sent-delete-trigger','direct-sent-insert-trigger') then
          update public.purchase_orders set status='sent' where id=source_order;
          execute 'reset role';
          -- Isolate the trigger boundary: an RLS scan may precede a status wait.
          -- The two-connection authenticated race is qualified separately.
          begin
            if case_name='direct-sent-update-trigger' then update public.purchase_order_items set quantity=13 where id=item_id;
            elsif case_name='direct-sent-delete-trigger' then delete from public.purchase_order_items where id=item_id;
            else insert into public.purchase_order_items(tenant_id,purchase_order_id,position,designation,quantity,unit,unit_price_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
              values(tenant_a,source_order,4,'ARMY sent forbidden',1,'m',100,2000,100,20,120);
            end if;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          execute 'set local role authenticated';
          passed:=actual_error='PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
        elsif case_name in ('export-1200-items','export-inaccessible','export-cap') then
          export_ids:=array[source_order];
          if case_name='export-inaccessible' then export_ids:=export_ids||'ffffffff-ffff-4fff-afff-ffffffffffff'::uuid;
          else
            select jsonb_agg(base_items->0) into input_items from generate_series(1,case when case_name='export-cap' then 1000 else 600 end);
            execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{}'::jsonb,input_items,revision_value;
            for counter in 1..case when case_name='export-cap' then 10 else 1 end loop
              execute 'select public.create_purchase_order_draft($1,$2)' into replay using manual_header,input_items;
              export_ids:=export_ids||(replay->>'id')::uuid;
            end loop;
          end if;
          begin execute 'select public.get_purchase_order_documents($1)' into replay using export_ids;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          if case_name='export-inaccessible' then passed:=actual_error='PURCHASE_ORDER_ACCESS_DENIED';
          elsif case_name='export-cap' then passed:=actual_error='PURCHASE_ORDER_EXPORT_TOO_LARGE';
          else passed:=actual_error is null and (select sum(jsonb_array_length(o->'items')) from jsonb_array_elements(replay->'orders') o)=1200
            and not exists(select 1 from jsonb_array_elements(replay->'orders') o where (o->>'edit_revision')::bigint<1 or (o->>'total_ht_cents')::numeric<>922800);
          end if;
        elsif case_name in ('source-supplier-change-refused','source-supplier-ledger-refused') then
          if case_name='source-supplier-ledger-refused' then
            delete from public.purchase_order_items where purchase_order_id=source_order;
            delete from public.estimate_versions where id=version_a;
          end if;
          begin update public.purchase_orders set supplier_id=supplier_b where id=source_order;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_SOURCE_SUPPLIER_IMMUTABLE';
        elsif case_name='source-product-preserved' then
          passed:=(select product_id from public.purchase_order_items where id=item_id)=product_a;
        elsif case_name='order-id-rebind-refused' then
          delete from public.purchase_order_items where purchase_order_id=source_order;
          begin update public.purchase_orders set id='41d15500-2e47-4fa8-a123-06125000000d' where id=source_order;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_INPUT_INVALID';
        elsif case_name='order-tenant-rebind-refused' then
          delete from public.purchase_order_items where purchase_order_id=source_order;
          begin update public.purchase_orders set tenant_id=tenant_b where id=source_order;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_INPUT_INVALID';
        elsif case_name='sent-product-delete-preserved' then
          update public.purchase_orders set status='sent' where id=source_order;
          delete from public.products where id=product_b;
          passed:=exists(select 1 from public.purchase_order_items where id=item_id and product_id is null and quantity=12.5 and unit='m' and unit_price_ht_cents=123)
            and exists(select 1 from public.purchase_orders where id=source_order and status='sent' and total_ttc_cents=1963);
        elsif case_name='non-draft-edit-denied' then
          update public.purchase_orders set status='sent' where id=source_order;
          begin execute 'select public.replace_purchase_order_draft($1,$2,$3,$4)' into replay using source_order,'{"notes":"cannot edit"}'::jsonb,null::jsonb,revision_value;
          exception when others then get stacked diagnostics actual_error=message_text,actual_state=returned_sqlstate; end;
          passed:=actual_error='PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
        end if;
        if case_name in ('edit-note-only','edit-decimal-preserves-origin','edit-unit-sourced-refused','source-replay-immutable','direct-source-detach-refused') then
          execute 'reset role'; select to_jsonb(r) into receipt_after from private.estimate_purchase_receipts r where r.source_version_id=version_a and r.idempotency_key=key_a; execute 'set local role authenticated';
          if receipt_after is distinct from receipt_before then raise exception 'Immutable initial receipt was changed'; end if;
        end if;
        if case_name not in ('source-minimum-below','source-minimum-exact','source-unit-ambiguous','source-deleted-unit-refused','source-supplier-ledger-refused') then
          select jsonb_agg(to_jsonb(i) order by i.id) into source_after from public.estimate_items i where version_id=version_a;
          if source_after is distinct from source_before then raise exception 'Source estimate changed'; end if;
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
    -- Restore the default group selection in the PL/pgSQL variable too.
    groups:=jsonb_set(groups,'{0,item_ids}',jsonb_build_array(line_a,line_b,line_c));
  end loop;
  raise exception using errcode = 'P9001',message='PURCHASE_DECIMALS_PROOF:'||jsonb_build_object('cases',results,
    'allPassed',not exists(select 1 from jsonb_array_elements(results) r where r->>'passed'<>'true'),
    'fixtureProject',project_a,'fixtureVersion',version_a,'actor',actor,'tenant',tenant_a,'rolledBack',true)::text;
end;
$probe$;
