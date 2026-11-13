-- TI-718: composition precision, hierarchy compatibility and guarded quantity writes.
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
  '00000000-0000-0000-0000-000000000000', '71800000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'ouvrage-quantity@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '71800000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '71800000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('71800000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '71800000-0000-4000-8000-000000000001', 'Ouvrage quantity');

insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth)
values ('71800000-0000-4000-8000-000000000110',current_setting('test.tenant_id')::uuid,'71800000-0000-4000-8000-000000000010',1,2,1);
insert into public.estimate_items(id,version_id,item_type,title) values ('71800000-0000-4000-8000-000000000199','71800000-0000-4000-8000-000000000110','section','Lot');
insert into public.estimate_items(id,version_id,parent_id,item_type,title,source_metadata) values
('71800000-0000-4000-8000-000000000200','71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000199','section','Ouvrage','{"kit_metier":true,"assembly_id":"retained"}');
insert into public.estimate_items(id,version_id,parent_id,item_type,title,quantity,unit_price_ht_cents,k_fo,k_mo,h_mo,h_mo_majoration,tax_rate_bp,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_metadata)
values ('71800000-0000-4000-8000-000000000201','71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200','line','Component',0.333,1000,1,1,2,1,2000,1000,333,67,400,'{"origin":"retained"}');
select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',3);
select is((select quantity from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),0.999::numeric,'quantity scales exactly once');
select is((select h_mo from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),6::numeric,'historical total labor scales with the ouvrage');
select is((select source_metadata->>'origin' from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),'retained','component provenance is unchanged');
select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',0.5);
select is((select quantity from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),0.167::numeric,'fractional quantities round once to storage precision');
select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',0);
select is((select quantity from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),0::numeric,'zero clears effective component quantities');
select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',1);
select is((select quantity from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),0.333::numeric,'composition survives zero and fractional resize without drift');
select is((select h_mo from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),2::numeric,'labor composition survives zero');
update public.estimate_items set quantity=2,h_mo=4 where id='71800000-0000-4000-8000-000000000201';
select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',3);
select is((select quantity from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),6::numeric,'edited detail becomes the new composition');
select is((select h_mo from public.estimate_items where id='71800000-0000-4000-8000-000000000201'),12::numeric,'edited historical hours follow quantity');
select ok(not has_function_privilege('authenticated','private.resize_estimate_ouvrage(uuid,uuid,numeric)','execute'),'authenticated cannot bypass the guarded batch');
select ok(not has_function_privilege('anon','private.resize_estimate_ouvrage(uuid,uuid,numeric)','execute'),'anonymous cannot call the private writer');
select throws_ok($$select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000201',2)$$,'22023','ESTIMATE_BATCH_INVALID_INPUT','a component cannot be resized as an ouvrage');
select throws_ok($$select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',-1)$$,'22023','ESTIMATE_BATCH_INVALID_INPUT','negative quantities are refused');
select throws_ok($$insert into public.estimate_items(version_id,parent_id,item_type,title) values ('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200','section','Extra chapter')$$,'P0001','Profondeur de section depassee (max 1).','ordinary chapters still respect the depth limit');

select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000200',0);
insert into public.estimate_items select (jsonb_populate_record(null::public.estimate_items,to_jsonb(i)||'{"id":"71800000-0000-4000-8000-000000000300","position":2}'::jsonb)).* from public.estimate_items i where id='71800000-0000-4000-8000-000000000200';
insert into public.estimate_items select (jsonb_populate_record(null::public.estimate_items,to_jsonb(i)||'{"id":"71800000-0000-4000-8000-000000000301","parent_id":"71800000-0000-4000-8000-000000000300"}'::jsonb)).* from public.estimate_items i where id='71800000-0000-4000-8000-000000000201';
select private.resize_estimate_ouvrage('71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000300',1);
select is((select quantity from public.estimate_items where id='71800000-0000-4000-8000-000000000301'),2::numeric,'copy at zero retains the edited composition across new identities');
select is((select h_mo from public.estimate_items where id='71800000-0000-4000-8000-000000000301'),4::numeric,'copy at zero retains historical labor composition');
-- Historical four-kit trees fit the old four physical section levels.
insert into public.estimate_items(id,version_id,parent_id,item_type,title,position,source_metadata)
values ('71800000-0000-4000-8000-000000000400','71800000-0000-4000-8000-000000000110',null,'section','Legacy kit 1',2,'{"kit_metier":true}'),
('71800000-0000-4000-8000-000000000401','71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000400','section','Legacy kit 2',1,'{"kit_metier":true}'),
('71800000-0000-4000-8000-000000000402','71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000401','section','Legacy kit 3',1,'{"kit_metier":true}'),
('71800000-0000-4000-8000-000000000403','71800000-0000-4000-8000-000000000110','71800000-0000-4000-8000-000000000402','section','Legacy kit 4',1,'{"kit_metier":true}');
select throws_ok($$update public.estimate_items set parent_id='71800000-0000-4000-8000-000000000199' where id='71800000-0000-4000-8000-000000000400'$$,
'P0001','Le déplacement dépasse la profondeur autorisée des chapitres ou ouvrages.','moving the whole legacy subtree cannot create unsupported deep snapshots');
select ok(public.estimate_offer_ouvrage_hierarchy_valid('[{"id":"a","parentId":null,"kind":"section","depth":0,"kitMetier":true},{"id":"b","parentId":"a","kind":"section","depth":1,"kitMetier":true},{"id":"c","parentId":"b","kind":"section","depth":2,"kitMetier":true},{"id":"d","parentId":"c","kind":"section","depth":3,"kitMetier":true},{"id":"e","parentId":"d","kind":"line","depth":4}]'), 'existing shallow four-kit snapshots remain valid');
select ok(not public.estimate_offer_ouvrage_hierarchy_valid('[{"id":"a","parentId":null,"kind":"section","depth":0,"kitMetier":true},{"id":"b","parentId":"a","kind":"section","depth":1,"kitMetier":true},{"id":"c","parentId":"b","kind":"section","depth":2,"kitMetier":true},{"id":"d","parentId":"c","kind":"section","depth":3,"kitMetier":true},{"id":"e","parentId":"d","kind":"section","depth":4}]'), 'extending four-kit snapshots beyond their historical envelope is refused');
select * from finish();
rollback;
