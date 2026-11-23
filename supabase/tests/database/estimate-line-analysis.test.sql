begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select fk_ok('public', 'estimate_items', array['source_job_id','tenant_id'],
  'public', 'takeoff_jobs', array['id','tenant_id'], 'the analysis reference includes the tenant');

\ir ../fixtures/copy-items-estimate.sql

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('29300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
-- The reader selects this tenant. The outsider keeps their own default tenant.
update public.tenant_memberships set is_default=false where user_id=pg_temp.id(4);
update public.tenant_memberships set is_default=true
where user_id=pg_temp.id(4) and tenant_id=current_setting('test.tenant_id')::uuid;
select pg_temp.cp29_version(pg_temp.id(101), 1, pg_temp.id(1), pg_temp.id(301));
select pg_temp.cp29_version(pg_temp.id(102), 0, pg_temp.id(1), pg_temp.id(302));
select pg_temp.cp29_version(pg_temp.id(103), 0, pg_temp.id(1), pg_temp.id(303));
insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.id(11), current_setting('test.tenant_id')::uuid, pg_temp.id(1), 'Autre affaire fictive');
select pg_temp.cp29_version(pg_temp.id(104), 0, pg_temp.id(1), pg_temp.id(304));
update public.estimate_versions set project_id=pg_temp.id(11) where id=pg_temp.id(104);
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values (pg_temp.id(501),current_setting('test.tenant_id')::uuid,pg_temp.id(101),'B','completed','plan.pdf',pg_temp.id(1));
insert into public.takeoff_version_links (tenant_id, takeoff_job_id, source_version_id, target_version_id)
values (current_setting('test.tenant_id')::uuid,pg_temp.id(501),pg_temp.id(101),pg_temp.id(103));
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
set local role authenticated;
update public.estimate_items set source_job_id = pg_temp.id(501)
where version_id = pg_temp.id(101) and item_type = 'line';
reset role;
select is(public.estimate_version_holds_analysis(current_setting('test.tenant_id')::uuid,pg_temp.id(101),pg_temp.id(501)),
  true,'the owning version holds the analysis');
select is(public.estimate_version_holds_analysis(current_setting('test.tenant_id')::uuid,pg_temp.id(102),pg_temp.id(501)),
  false,'another draft of the same affaire needs an inheritance link');
select is(public.estimate_version_holds_analysis(current_setting('test.tenant_id')::uuid,pg_temp.id(104),pg_temp.id(501)),
  false,'the other affaire does not hold the analysis');
select is(public.estimate_version_holds_analysis((select tenant_id from public.tenant_memberships where user_id=pg_temp.id(5)
    and is_default),pg_temp.id(101),pg_temp.id(501)),
  false,'the tenant is part of the scope');

select is(pg_temp.cp29_call(pg_temp.id(1), pg_temp.id(n), pg_temp.id(n+200), pg_temp.cp29_copy(
  (select id from public.estimate_items where version_id=pg_temp.id(101) and parent_id is null),pg_temp.id(n),1)),
  'ok', 'the owner can copy a section into draft ' || n) from generate_series(102,104) n;
set constraints public.estimate_line_analysis_scope immediate;
select is((select source_job_id from public.estimate_items where version_id=pg_temp.id(103) and item_type='line'),
  pg_temp.id(501),'the copied line keeps its inherited analysis');
select results_eq($$select to_jsonb(i) - array['id','version_id','parent_id','created_at','updated_at'] from public.estimate_items i
  where version_id=pg_temp.id(102) and item_type='line'$$,
  $$select (to_jsonb(i) - array['id','version_id','parent_id','created_at','updated_at']) || '{"source_job_id":null}'::jsonb
  from public.estimate_items i where version_id=pg_temp.id(103) and item_type='line'$$,
  'without inheritance only the analysis reference differs');
select results_eq($$select to_jsonb(i) - array['id','version_id','parent_id','created_at','updated_at'] from public.estimate_items i
  where version_id=pg_temp.id(104) and item_type='line'$$,
  $$select to_jsonb(i) - array['id','version_id','parent_id','created_at','updated_at'] from public.estimate_items i
  where version_id=pg_temp.id(102) and item_type='line'$$,
  'the other affaire receives the same line without an analysis');
set constraints public.estimate_analysis_unlink immediate;
select throws_ok($$delete from public.takeoff_version_links where target_version_id=pg_temp.id(103)$$,
  'M0A01','Cette version du devis ne détient pas cette analyse.','inheritance persists while a copied line depends on it');
set constraints public.estimate_analysis_unlink deferred;
select pg_temp.cp29_version(pg_temp.id(105), 0, pg_temp.id(1), pg_temp.id(305));
insert into public.estimate_items (id, tenant_id, version_id, item_type, title, position)
values (pg_temp.id(205), current_setting('test.tenant_id')::uuid, pg_temp.id(105), 'section', 'Lot', 1);
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values (pg_temp.id(505),current_setting('test.tenant_id')::uuid,pg_temp.id(105),'B','completed','plan.pdf',pg_temp.id(1));
insert into public.takeoff_version_links (tenant_id, takeoff_job_id, source_version_id, target_version_id)
values (current_setting('test.tenant_id')::uuid,pg_temp.id(501),pg_temp.id(101),pg_temp.id(105));

create function pg_temp.insert_line(n integer, job uuid) returns void language sql as $$
  insert into public.estimate_items (id,tenant_id,version_id,parent_id,item_type,position,title,quantity,unit_price_ht_cents,
    tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_job_id)
  values (pg_temp.id(n),current_setting('test.tenant_id')::uuid,pg_temp.id(105),pg_temp.id(205),'line',n,'Ligne',1,0,
    2000,1,0,1,0,0,0,0,job)
$$;

create function pg_temp.add_line(n integer, job uuid) returns uuid language sql as $$
  select (public.atomic_create_estimate_item(pg_temp.id(105),
    jsonb_build_object('id',pg_temp.id(n),'parent_id',pg_temp.id(205),'item_type','line',
      'position',n,'title','Ligne fictive','source_job_id', job),
    (select jsonb_agg(jsonb_build_object('id',rows.id,'pu_ht_cents',0,'line_total_ht_cents',0,'line_tax_cents',0,
      'line_total_ttc_cents',0)) from (select pg_temp.id(n) as id union all select id from public.estimate_items
      where version_id=pg_temp.id(105) and item_type='line') rows),
    '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
    coalesce((select updated_at from public.estimate_versions where id=pg_temp.id(105)),now()),
    pg_temp.id(305),'{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb) #>> '{item,id}')::uuid
$$;
-- Each API call normally has its own transaction. Roll back the successful
-- probe after reading the stored reference, including the writer's temporary tables.
create function pg_temp.unit_keeps_reference(n integer, job uuid) returns boolean language plpgsql as $$
declare kept boolean;
begin
  perform pg_temp.add_line(n,job);
  select i.source_job_id is not distinct from job into kept from public.estimate_items i where i.id=pg_temp.id(n);
  raise exception using errcode='ZT001',message='end unit probe';
exception when sqlstate 'ZT001' then return kept;
end
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
set local role authenticated;
select is(pg_temp.unit_keeps_reference(601,null),true,'unit creation accepts a manual line');
select is(pg_temp.unit_keeps_reference(602,pg_temp.id(505)),true,'unit creation accepts an owned analysis');
select is(pg_temp.unit_keeps_reference(603,pg_temp.id(501)),true,'unit creation accepts an inherited analysis');
select throws_ok($$select pg_temp.add_line(604,gen_random_uuid())$$,'M0A01','Cette version du devis ne détient pas cette analyse.',
  'unit creation reports an unknown analysis');
select is((select count(*) from public.estimate_items where id=pg_temp.id(604)),0::bigint,'the refusal wrote no line');
select lives_ok($$select pg_temp.insert_line(611,null), pg_temp.insert_line(612,pg_temp.id(505)),
  pg_temp.insert_line(613,pg_temp.id(501))$$,'a member can directly insert manual, owned and inherited lines');
select throws_ok($$select pg_temp.insert_line(614,gen_random_uuid())$$,'M0A01','Cette version du devis ne détient pas cette analyse.',
  'a direct insert reports the scoped refusal');
select is((select count(*) from public.estimate_items where id=pg_temp.id(614)),0::bigint,'the direct refusal wrote no line');
select throws_ok($$update public.estimate_items set source_job_id=gen_random_uuid()
  where version_id=pg_temp.id(101) and item_type='line'$$, 'M0A01','Cette version du devis ne détient pas cette analyse.',
  'an unknown reference is refused without disclosing information about an analysis');
select is((select source_job_id from public.estimate_items where version_id=pg_temp.id(101) and item_type='line'),
  pg_temp.id(501),'a refused write preserves the reference used by the page guard');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(4),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.add_line(604,null)$$,'42501','ESTIMATE_CREATE_FORBIDDEN','the reader cannot create a manual line');
select throws_ok($$select pg_temp.add_line(604,gen_random_uuid())$$,'42501','ESTIMATE_CREATE_FORBIDDEN',
  'the reader receives the same authorization refusal with a reference');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(5),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.add_line(604,pg_temp.id(501))$$,'42501','ESTIMATE_CREATE_FORBIDDEN',
  'the other tenant receives an authorization refusal');
select throws_ok($$select pg_temp.add_line(604,gen_random_uuid())$$,'42501','ESTIMATE_CREATE_FORBIDDEN',
  'an unknown identifier gives the outsider the same refusal');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
set local role authenticated;
set constraints public.estimate_line_analysis_scope deferred;
select throws_ok($test$do $probe$
begin
  perform pg_temp.insert_line(615,pg_temp.id(501));
  delete from public.takeoff_version_links where target_version_id=pg_temp.id(105);
  set constraints public.estimate_line_analysis_scope immediate;
end
$probe$$test$, 'M0A01','Cette version du devis ne détient pas cette analyse.',
  'the deferred line constraint checks inheritance at the end of the write');
select is((select outcome from public.bulk_delete_draft_affaires(current_setting('test.tenant_id')::uuid,array[pg_temp.id(10)])),
  'deleted','the owner can delete the source affaire after the section copy');
reset role;
select is((select count(*) from public.estimate_items where version_id=pg_temp.id(104) and item_type='line'),1::bigint,
  'the copied line survives the deletion');
select * from finish();
rollback;
