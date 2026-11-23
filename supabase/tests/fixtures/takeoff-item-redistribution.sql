-- The stored result of two confirmed sends to a draft. Fixture IDs are scoped to this test.
create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at)
select pg_temp.f(n), 'redistribution-' || n || '@example.test', '{}', now() from generate_series(1,3) n;
update public.tenant_memberships set is_default=false where user_id in (pg_temp.f(1),pg_temp.f(2),pg_temp.f(3));
insert into public.tenants(id,name,slug) values (pg_temp.f(10),'Atelier fictif','redistribution-test'),
  (pg_temp.f(11),'Agence fictive','redistribution-other');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values
  (pg_temp.f(10),pg_temp.f(1),'engineer',true),(pg_temp.f(10),pg_temp.f(2),'director',true),
  (pg_temp.f(11),pg_temp.f(3),'admin',true);
update public.feature_flags set enabled=true where tenant_id=pg_temp.f(10) and flag_key='TAKEOFF_MODULE_ENABLED';
insert into public.estimate_projects(id,tenant_id,user_id,name) select pg_temp.f(n),pg_temp.f(10),pg_temp.f(1),'Affaire fictive '||n
  from generate_series(20,21) n;
set local session_replication_role=replica;
insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,max_section_depth,currency,
  status,margin_mode,margin_multiplier,margin_bp,global_coefficient,discount_bp,discount_mode,tax_rate_bp,
  rounding_mode,rounding_step_cents,sale_coefficient_fo,sale_coefficient_mo,gross_ht_cents,discount_applied_cents,
  commercial_rounding_cents,total_ht_cents,total_tax_cents,total_ttc_cents)
values(pg_temp.f(30),pg_temp.f(10),pg_temp.f(20),1,3,3,'EUR','draft','fixed',1,0,1,0,'simple',2000,'none',1,1,1,0,0,0,0,0,0);
insert into public.takeoff_jobs(id,tenant_id,project_id,estimate_version_id,level,status,source_file_name,created_by)
select pg_temp.f(40+n),pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),'A','applied','Plan '||n||'.pdf',pg_temp.f(1) from generate_series(1,2) n;
insert into public.takeoff_list_items(id,tenant_id,project_id,origin_kind,created_in_revision,created_by)
values(pg_temp.f(50),pg_temp.f(10),pg_temp.f(20),'manual',1,pg_temp.f(1));
set local session_replication_role=origin;
select set_config('miaouffrage.estimate_v3_writer',pg_temp.f(30)::text,true);
select set_config('mergeone.takeoff_item_send','fixture',true);
insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
values(pg_temp.f(60),pg_temp.f(10),pg_temp.f(30),'section',1,'Métré');
insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,quantity,unit_code,
  pricing_status,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,pu_ht_cents,line_total_ht_cents,
  line_tax_cents,line_total_ttc_cents,source_provider,source_job_id,source_metadata)
values(pg_temp.f(61),pg_temp.f(10),pg_temp.f(30),pg_temp.f(60),'line',1,'Lavabo','u',5,'u','priced',0,2000,1,0,1,1,0,0,0,0,
  'takeoff',pg_temp.f(41),jsonb_build_object('takeoff_item_send', jsonb_build_object('version',1,'item_id',pg_temp.f(50),
  'compartment_key','together','breakdown','together')));
insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,quantity,unit_code,
  pricing_status,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
values(pg_temp.f(62),pg_temp.f(10),pg_temp.f(30),pg_temp.f(60),'line',2,'Autre ligne chiffrée','u',2,'u','priced',1200,550,1,0,1,1,0,0,0,0);
select public.estimate_v3_complete_entry_for_writer(pg_temp.f(30),array[pg_temp.f(61),pg_temp.f(62)]);
insert into public.takeoff_item_send_receipts(id,tenant_id,project_id,job_id,version_id,request_id,format_version,actor_id,
  plan_sha256,version_created,write_plan,result)
select pg_temp.f(70+n),pg_temp.f(10),pg_temp.f(20),pg_temp.f(40+n),pg_temp.f(30),pg_temp.f(80+n),1,pg_temp.f(1),
  repeat('a',64),n=1,'{}',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('estimate_item_id',pg_temp.f(61),
  'quantity_after',case when n=1 then 3 else 5 end))) from generate_series(1,2)n;
insert into public.takeoff_item_send_sections(tenant_id,project_id,version_id,section_key,title,estimate_item_id,receipt_id)
values(pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),'list:','Métré',pg_temp.f(60),pg_temp.f(71));
insert into public.takeoff_item_send_targets(id,tenant_id,project_id,version_id,item_id,breakdown,compartment_key,estimate_item_id,
  line_kind,unit_code,created_by_receipt_id)
values(pg_temp.f(90),pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),pg_temp.f(50),'together','together',pg_temp.f(61),'new_line','u',pg_temp.f(71));
insert into public.takeoff_item_send_parts(id,tenant_id,project_id,version_id,target_id,receipt_id,job_id,item_id,plan_logical_id,
  kind,answer_id,answer_revision,decision_revision,observation_ids,takeoff_item_ids,quantity,unit,unit_code,pages)
select pg_temp.f(100+n),pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),pg_temp.f(90),pg_temp.f(70+n),pg_temp.f(40+n),
  pg_temp.f(50),pg_temp.f(110+n),'measured',pg_temp.f(120+n),repeat('a',64),1,array[pg_temp.f(130+n)],array[pg_temp.f(140+n)],
  4-n,'u','u',array[1] from generate_series(1,2)n;
insert into public.takeoff_item_send_pages(tenant_id,project_id,version_id,receipt_id,job_id,document,page,item_ids,part_ids)
select pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),pg_temp.f(70+n),pg_temp.f(40+n),
  jsonb_build_object('plan_file_id',pg_temp.f(110+n),'content_hash',repeat(n::text,64),'file_name','Plan '||n||'.pdf'),
  1,array[pg_temp.f(50)],array[pg_temp.f(100+n)] from generate_series(1,2)n;
insert into public.takeoff_plan_locations(tenant_id,project_id,source_kind,source_id,content_hash,revision,building_choice,
  building,building_set_by,building_set_at,building_set_revision,level_choice,level,level_set_by,level_set_at,level_set_revision,
  plan_file_id,document_name,created_by,updated_by)
select pg_temp.f(10),pg_temp.f(20),'plan_file',pg_temp.f(110+n),repeat(n::text,64),1,'value','A',pg_temp.f(1),now(),1,'value',
  case n when 1 then 'RDC' else 'R+1' end,pg_temp.f(1),now(),1,pg_temp.f(110+n),'Plan.pdf',pg_temp.f(1),pg_temp.f(1)
from generate_series(1,2)n;
insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
values(pg_temp.f(30),pg_temp.f(1),pg_temp.f(10),clock_timestamp()+interval '10 minutes',gen_random_uuid());
select set_config('mergeone.takeoff_item_send','',true);
select set_config('miaouffrage.estimate_v3_writer','',true);
