-- TI-534: precision, per-component defaults, explicit manual neutrality and tenant isolation.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions,public,pg_catalog;
select no_plan();
select has_column('public','estimate_items','k_fo_manual','explicit manual overrides are persisted');
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '53500000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'estimate-fo-provision@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '53500000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '53500000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('53500000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '53500000-0000-4000-8000-000000000001', 'Affaire provision FO');
insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position) values
  ('53500000-0000-4000-8000-000000000020', current_setting('test.tenant_id')::uuid,
   '53500000-0000-4000-8000-000000000001', 'Tuyauteur', 4000, true, 1);
insert into public.supply_types (id, tenant_id, code, name, default_fo_provision) values
  ('53500000-0000-4000-8000-000000000041', current_setting('test.tenant_id')::uuid, 'tube', 'Tube', 1.130),
  ('53500000-0000-4000-8000-000000000043', current_setting('test.tenant_id')::uuid, 'calorifuge', 'Calorifuge', 1.020);
insert into public.supply_types (id, tenant_id, code, name) values
  ('53500000-0000-4000-8000-000000000042', current_setting('test.tenant_id')::uuid, 'raccord', 'Raccord');


insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,sale_coefficient_fo,sale_coefficient_mo,gross_ht_cents,discount_applied_cents,commercial_rounding_cents)
values ('53500000-0000-4000-8000-000000000110',current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000010',1,3,1,1,0,0,0);
select set_config('miaouffrage.estimate_v3_writer','53500000-0000-4000-8000-000000000110',true);
insert into public.estimate_items(id,version_id,item_type,title) values ('53500000-0000-4000-8000-000000000200','53500000-0000-4000-8000-000000000110','section','Lot');
insert into public.estimate_items(id,version_id,item_type,title,quantity,unit_price_ht_cents,k_fo,supply_type_id,unit_code,pricing_status,tax_rate_bp,parent_id,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
values ('53500000-0000-4000-8000-000000000201','53500000-0000-4000-8000-000000000110','line','Tube',101,10000,1,'53500000-0000-4000-8000-000000000041','ml','priced',2000,'53500000-0000-4000-8000-000000000200',1,0,0,0,0);
select is((select k_fo from public.estimate_items where id='53500000-0000-4000-8000-000000000201'),1.13::numeric,'new tube has one coefficient containing loss and transport');
select is((select fo_provision from public.estimate_items where id='53500000-0000-4000-8000-000000000201'),1::numeric,'no second provision multiplies the unified coefficient');
update public.estimate_items set k_fo=1.0735,k_fo_manual=true where id='53500000-0000-4000-8000-000000000201';
select is((select k_fo from public.estimate_items where id='53500000-0000-4000-8000-000000000201'),1.0735::numeric,'volume retains four decimal precision');
select is((select k_fo from public.snapshot_estimate_item_bulk_updates('53500000-0000-4000-8000-000000000110','[{"id":"53500000-0000-4000-8000-000000000201","title":"Tube"}]'::jsonb)),1.0735::numeric,'the guarded bulk snapshot retains the four-decimal coefficient');
select ok((select k_fo_manual from public.estimate_items where id='53500000-0000-4000-8000-000000000201'),'a direct edit becomes manual');
update public.estimate_items set k_fo=1 where id='53500000-0000-4000-8000-000000000201';
update public.estimate_items set supply_type_id='53500000-0000-4000-8000-000000000042' where id='53500000-0000-4000-8000-000000000201';
select is((select k_fo from public.estimate_items where id='53500000-0000-4000-8000-000000000201'),1::numeric,'changing family preserves a manual neutral coefficient');
-- REST writers cannot bypass company-setting authorization with a direct table update.
select set_config('request.jwt.claims',jsonb_build_object('sub','53500000-0000-4000-8000-000000000001','role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$update public.supply_types set default_fo_provision=1.0735 where id='53500000-0000-4000-8000-000000000041'$$,'42501','KFO_COMPANY_ADMIN_REQUIRED','a non-admin cannot alter the company K FO through PostgREST');
select throws_ok($$insert into public.supply_types(tenant_id,code,name,default_fo_provision) values(current_setting('test.tenant_id')::uuid,'unauthorized-custom','Custom',1.5)$$,'42501','KFO_COMPANY_ADMIN_REQUIRED','non-admin creation cannot set a custom company base');
select lives_ok($$insert into public.supply_types(tenant_id,code,name) values(current_setting('test.tenant_id')::uuid,'new-family','New family')$$,'ordinary family creation still receives the derived company base');
reset role;
update public.tenant_memberships set role='admin' where user_id='53500000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$update public.supply_types set default_fo_provision=1.0735 where id='53500000-0000-4000-8000-000000000041'$$,'an admin can save a four-decimal company K FO');
reset role;
select is((select default_fo_provision from public.supply_types where id='53500000-0000-4000-8000-000000000041'),1.0735::numeric,'company coefficient retains four decimal precision');
set local role authenticated;
select lives_ok($$update public.supply_types set default_fo_provision=0.95 where id='53500000-0000-4000-8000-000000000041'$$,'the unified company K FO can include a volume reduction');
reset role;
select is((select default_fo_provision from public.supply_types where id='53500000-0000-4000-8000-000000000041'),0.95::numeric,'the company volume reduction is retained');
-- Included transport only removes the known transport component of standard bases.
select is(private.estimate_kfo_base(current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000001',null,'{"transport_mode":"included"}'::jsonb),1.02::numeric,'an unknown family retains the common fallback with included transport');
update public.supply_types set default_fo_provision=1.0735 where id='53500000-0000-4000-8000-000000000041';
select is(private.estimate_kfo_base(current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000001','53500000-0000-4000-8000-000000000041','{"transport_mode":"included"}'::jsonb),1.0735::numeric,'custom tube base is authoritative for included transport');
update public.supply_types set default_fo_provision=0.95 where id='53500000-0000-4000-8000-000000000042';
select is(private.estimate_kfo_base(current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000001','53500000-0000-4000-8000-000000000042','{"transport_mode":"included"}'::jsonb),0.95::numeric,'custom fitting base is authoritative for included transport');
insert into public.estimate_fo_preferences(tenant_id,user_id,supply_type_id,coefficient) values(current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000001','53500000-0000-4000-8000-000000000041',0);
select is(private.estimate_kfo_base(current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000001','53500000-0000-4000-8000-000000000041','{"transport_mode":"included"}'::jsonb),0::numeric,'personal zero is retained with included transport');
-- A saved model is a price snapshot, including old FO provisions and neutral overrides.
insert into public.estimate_items(id,version_id,parent_id,item_type,title,position,quantity,unit_price_ht_cents,k_fo,fo_provision,supply_type_id,unit_code,pricing_status,tax_rate_bp,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
values('53500000-0000-4000-8000-000000000202','53500000-0000-4000-8000-000000000110','53500000-0000-4000-8000-000000000200','line','Legacy model supply',2,1,10000,1,1.03,'53500000-0000-4000-8000-000000000041','u','priced',2000,1,0,0,0,0);
update public.estimate_items set source_metadata='{"kit_metier":true}' where id='53500000-0000-4000-8000-000000000200';
select set_config('test.template_id',public.create_estimate_template_from_version('53500000-0000-4000-8000-000000000110','K FO snapshot',null)::text,true);
select is((select k_fo from public.estimate_template_items where template_id=current_setting('test.template_id')::uuid and title='Legacy model supply'),1.03::numeric,'saving a v3 model folds historical provision once');
select ok((select k_fo_manual from public.estimate_template_items where template_id=current_setting('test.template_id')::uuid and title='Legacy model supply'),'model preserves explicit saved price mode');
select ok((select kit_metier from public.estimate_template_items where template_id=current_setting('test.template_id')::uuid and item_type='section'),'model stores its kit boundary');
select lives_ok($$select public.insert_estimate_template_into_version('53500000-0000-4000-8000-000000000110',current_setting('test.template_id')::uuid,null)$$,'model reinserts through its owned writer');
select is((select k_fo from public.estimate_items where version_id='53500000-0000-4000-8000-000000000110' and title='Legacy model supply' and id<>'53500000-0000-4000-8000-000000000202'),1.03::numeric,'reinserted model retains effective supply cost');
select is((select count(*) from public.estimate_items where version_id='53500000-0000-4000-8000-000000000110' and item_type='section' and source_metadata @> '{"kit_metier":true}'::jsonb),2::bigint,'reinserted model retains hidden kit decomposition');
select is((select k_fo from public.estimate_items where version_id='53500000-0000-4000-8000-000000000110' and title='Tube' and id<>'53500000-0000-4000-8000-000000000201'),1::numeric,'a saved manual neutral coefficient remains neutral after insertion');
select set_config('test.template_copy_id',public.duplicate_estimate_template(current_setting('test.template_id')::uuid,'K FO snapshot copy')::text,true);
select ok((select k_fo_manual from public.estimate_template_items where template_id=current_setting('test.template_copy_id')::uuid and title='Legacy model supply'),'duplicating the model retains manual mode');
select ok((select kit_metier from public.estimate_template_items where template_id=current_setting('test.template_copy_id')::uuid and item_type='section'),'duplicating the model retains its kit boundary');
insert into public.estimate_assemblies(id,tenant_id,created_by,name) values('53500000-0000-4000-8000-000000000301',current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000001','Saved coefficient');
insert into public.estimate_assembly_items(tenant_id,assembly_id,title,unit,default_quantity,k_fo,source_metadata,position,unit_cost_ht_cents)
values(current_setting('test.tenant_id')::uuid,'53500000-0000-4000-8000-000000000301','Saved neutral supply','u',1,1,'{"k_fo_manual":true}',1,10000);
select lives_ok($$select public.materialize_estimate_assembly_tree('53500000-0000-4000-8000-000000000110','53500000-0000-4000-8000-000000000301',null,99,1,1)$$,'saved ouvrage materializes through its normal writer');
select is((select k_fo from public.estimate_items where version_id='53500000-0000-4000-8000-000000000110' and title='Saved neutral supply'),1::numeric,'saved ouvrage preserves manual neutrality');
select ok((select k_fo_manual from public.estimate_items where version_id='53500000-0000-4000-8000-000000000110' and title='Saved neutral supply'),'saved ouvrage retains its manual price mode');
select * from finish();
rollback;
