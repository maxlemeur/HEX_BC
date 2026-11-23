begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
\ir ../fixtures/takeoff-item-redistribution.sql

create temp table kept_line as select * from public.estimate_items where id=pg_temp.f(62);
create temp table initial_parts as select id,to_jsonb(p)-'target_id' as raw from public.takeoff_item_send_parts p where version_id=pg_temp.f(30);
create temp table initial_pages as select * from public.takeoff_item_send_pages where version_id=pg_temp.f(30);
create temp table initial_receipts as select * from public.takeoff_item_send_receipts where version_id=pg_temp.f(30);
create function pg_temp.preview(mode text, actor integer default 1, project integer default 20) returns jsonb language sql as $$
  select public.preview_takeoff_item_redistribution(pg_temp.f(10),pg_temp.f(actor),pg_temp.f(project),pg_temp.f(30),pg_temp.f(50),mode,true)
$$;
create function pg_temp.confirm(mode text,digest text,request integer) returns jsonb language sql as $$
  select public.redistribute_takeoff_item(pg_temp.f(10),pg_temp.f(1),pg_temp.f(20),pg_temp.f(30),pg_temp.f(50),mode,true,pg_temp.f(request),digest)
$$;
-- A length rounds up once per destination. The raw 1.2 m and 0.2 m therefore
-- occupy two metres together, and two plus one when split across levels.
savepoint length_fixture;
set local session_replication_role=replica;
update public.takeoff_item_send_parts set unit='m',unit_code='m',
  quantity=case id when pg_temp.f(101) then 1.2 else 0.2 end where version_id=pg_temp.f(30);
update public.takeoff_item_send_targets set unit_code='m' where version_id=pg_temp.f(30);
update public.estimate_items set quantity=2,unit_code='m',description='m' where id=pg_temp.f(61);
set local session_replication_role=origin;
create temp table length_preview as select pg_temp.preview('by_level') as plan;
select results_eq($$select (d->>'raw')::numeric,(d->>'quantity')::numeric from length_preview,
  jsonb_array_elements(plan->'destinations') d order by 1$$,
  $$values (0.2::numeric,1::numeric),(1.2,2)$$,'the preview shows the raw and rounded length of each new line');
select pg_temp.confirm('by_level',plan->>'digest',207) from length_preview;
select is((select sum(i.quantity) from public.estimate_items i join public.takeoff_item_send_targets t
  on t.estimate_item_id=i.id where t.item_id=pg_temp.f(50)),3::numeric,'the split writes the announced three metres');
select is((select sum(quantity) from public.takeoff_item_send_parts where item_id=pg_temp.f(50)),1.4::numeric,
  'the same raw 1.4 metres remain in the two observations');
rollback to length_fixture;

create temp table shown as select pg_temp.preview('by_level') as plan;
select is((select plan->'blockers' from shown),'[]'::jsonb,'intact line is movable');
select results_eq($$select value->>'label',(value->>'quantity')::numeric from shown,jsonb_array_elements(plan->'destinations') order by 1$$,
  $$values ('A · R+1'::text,2::numeric),('A · RDC',3)$$,'the preview splits the five by their plans');
select throws_ok($$select pg_temp.preview('by_level',2)$$,'42501','REDISTRIBUTION_FORBIDDEN','a reader cannot preview');
select throws_ok($$select pg_temp.preview('by_level',3)$$,'42501','REDISTRIBUTION_FORBIDDEN','another tenant cannot preview');
select throws_ok($$select pg_temp.preview('by_level',1,21)$$,'42501','REDISTRIBUTION_FORBIDDEN','another affaire cannot preview this version');
savepoint before_seal;
set local session_replication_role=replica;
update public.estimate_versions set status='sent' where id=pg_temp.f(30);
set local session_replication_role=origin;
select throws_ok($$select pg_temp.preview('by_level')$$,'55000','REDISTRIBUTION_SEALED','issued versions stay read-only');
select throws_ok($$select pg_temp.confirm('by_level',(select plan->>'digest' from shown),210)$$,'55000','REDISTRIBUTION_SEALED','an earlier preview cannot write after issue');
rollback to before_seal;
create function pg_temp.edited_preview(statement text) returns jsonb language plpgsql as $$
declare observed jsonb;
begin
  begin
    perform set_config('miaouffrage.estimate_v3_writer',pg_temp.f(30)::text,true);
    execute statement;
    observed := pg_temp.preview('by_level');
    raise exception using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;
  end;
  return observed;
end;
$$;
select is(pg_temp.edited_preview('update public.estimate_items set quantity=7 where id=pg_temp.f(61)')#>>'{blockers,0,title}',
  'Lavabo','the line with a typed quantity is named');
select is(pg_temp.edited_preview('update public.estimate_items set quantity=7 where id=pg_temp.f(61);
  update public.estimate_items set quantity=5 where id=pg_temp.f(61)')#>>'{blockers,0,reason}',
  'edited','a manual edit remains protected even when the quantity later equals the measured total');
select is(pg_temp.edited_preview('update public.estimate_items set unit_price_ht_cents=3250,h_mo_per_unit=1.5 where id=pg_temp.f(61)')#>>'{blockers,0,title}',
  'Lavabo','the priced line is protected');
select is(pg_temp.edited_preview($$update public.estimate_items set title='Section personnalisée' where id=pg_temp.f(60)$$)#>>'{blockers,0,title}',
  'Section personnalisée','the edited section is named');
select is(pg_temp.edited_preview($$insert into public.estimate_item_outlier_dismissals(tenant_id,version_id,item_id,flag_key,dismissed_by)
  values(pg_temp.f(10),pg_temp.f(30),pg_temp.f(61),'quantity_outlier',pg_temp.f(1))$$)#>>'{blockers,0,reason}',
  'used','a real third-party reference protects the line');
-- Live business references include historical modules that do not declare an FK.
select is(pg_temp.edited_preview($q$
  insert into private.estimate_source_reviews(id,tenant_id,project_id,version_id,revision)
    values(pg_temp.f(400),pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),1);
  insert into private.estimate_source_coverage_requirements(id,review_id,revision,prescription,expected_service,scope)
    values(pg_temp.f(401),pg_temp.f(400),1,'Sanitaires','Lavabo','{"mode":"unspecified"}');
  insert into private.estimate_source_coverage_links(id,requirement_id,kind,item_id,justification,target_key)
    values(pg_temp.f(402),pg_temp.f(401),'line',pg_temp.f(61),'Lot sanitaire','line:'||pg_temp.f(61))
$q$)#>>'{blockers,0,reason}','used','the CCTP requirement keeps its available estimate line');
select is(pg_temp.edited_preview($q$
  insert into public.affaire_register_entries(tenant_id,project_id,version_id,kind,text,status,origin_kind,scope_type,scope_id,scope_label)
    values(pg_temp.f(10),pg_temp.f(20),pg_temp.f(30),'assumption','Conserver le lavabo','open','manual','line',pg_temp.f(61),'Lavabo')
$q$)#>>'{blockers,0,reason}','used','the line-scoped affaire register protects the line');
\ir ../fixtures/takeoff-item-redistribution-uses.sql
select is(pg_temp.edited_preview('delete from public.estimate_items where id=pg_temp.f(61)')#>>'{blockers,0,reason}',
  'deleted','a line deleted deliberately is not recreated');
select is((select plan->'remove_lines' from shown),jsonb_build_array(pg_temp.f(61)), 'only the original line will be removed');
select is(pg_temp.preview('together')#>>'{blockers,0,reason}','unchanged','a confirmation must actually move contributions');
savepoint before_missing_lease;
delete from public.draft_locks where version_id=pg_temp.f(30);
select throws_ok($$select pg_temp.confirm('by_level',(select plan->>'digest' from shown),205)$$,'55P03','REDISTRIBUTION_LEASE','confirmation needs the member lease');
rollback to before_missing_lease;
savepoint before_mixed;
set local session_replication_role=replica;
insert into public.estimate_items select (jsonb_populate_record(null::public.estimate_items,
  to_jsonb(i)||jsonb_build_object('id',pg_temp.f(63),'position',3,'quantity',2))).*
  from public.estimate_items i where id=pg_temp.f(61);
insert into public.takeoff_item_send_targets select (jsonb_populate_record(null::public.takeoff_item_send_targets,
  to_jsonb(t)||jsonb_build_object('id',pg_temp.f(91),'estimate_item_id',pg_temp.f(63),'breakdown','by_level','compartment_key','unallocated'))).*
  from public.takeoff_item_send_targets t where id=pg_temp.f(90);
update public.takeoff_item_send_parts set target_id=pg_temp.f(91) where id=pg_temp.f(102);
set local session_replication_role=origin;
select ok(pg_temp.preview('by_level')->'blockers' @> '[{"reason":"mixed","title":"Lavabo"}]','a draft mixing modes for one item names its lines');
select throws_ok($$select pg_temp.confirm('by_level',pg_temp.preview('by_level')->>'digest',206)$$,'55000','REDISTRIBUTION_PROTECTED','even a fresh mixed plan writes nothing');
rollback to before_mixed;
create temp table result as select pg_temp.confirm('by_level',plan->>'digest',200) as receipt from shown;
select results_eq($$select t.compartment_key,i.quantity from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.item_id=pg_temp.f(50) order by 1$$,$$values ('level:["a","r+1"]'::text,2::numeric),('level:["a","rdc"]',3)$$,'the two lines hold the announced quantities');
select results_eq($$select t.compartment_key,i.source_job_id,i.source_file_name,i.source_page
  from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id where t.item_id=pg_temp.f(50) order by 1$$,
  $$values ('level:["a","r+1"]',pg_temp.f(42),null::text,null::integer),('level:["a","rdc"]',pg_temp.f(41),null,null)$$,
  'a new line opens the analysis that contributed to that destination and keeps the send file/page convention');
select is((select pg_temp.confirm('by_level',plan->>'digest',200)->>'receipt_id' from shown),
  (select receipt->>'receipt_id' from result),'the same intention returns the original receipt');
select throws_ok($$select pg_temp.confirm('by_level',(select plan->>'digest' from shown),201)$$,'40001','REDISTRIBUTION_STALE','another intention requires a fresh preview');
select is((select receipt->'source_receipts' from result),jsonb_build_array(pg_temp.f(71),pg_temp.f(72)),'receipt names both sends');
select is((select jsonb_array_length(receipt->'moves') from result),2,'receipt records each move');
select results_eq($$select (held.value->>'part_id')::uuid,(held.value->>'estimate_item_id')::uuid
  from initial_pages page cross join lateral jsonb_array_elements(private.takeoff_item_send_held_pages(
    pg_temp.f(10),pg_temp.f(30),pg_temp.f(199),page.document,array[1])) seen
  cross join lateral jsonb_array_elements(seen->'parts') held order by 1$$,
  $$select p.id,t.estimate_item_id from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id=p.target_id
  where p.version_id=pg_temp.f(30) order by p.id$$,'page guard finds the original part on its new physical line');
select is((select estimate_item_id from public.takeoff_item_send_targets where id=pg_temp.f(90)),null::uuid,'retired target keeps its history');
select is((select count(*) from public.takeoff_item_send_targets where created_by_receipt_id=(select (receipt->>'receipt_id')::uuid from result)),
  2::bigint,'both new targets refer to this receipt');

-- Synthetic same-scope destinations exist after the split. Altering anything else is prohibited even inside the command.
create function pg_temp.move_sql(extra text) returns text language sql as $$
  select format('update public.takeoff_item_send_parts set target_id=%L %s where id=%L',
    (select target_id from public.takeoff_item_send_parts where id=pg_temp.f(102)),extra,pg_temp.f(101))
$$;
select set_config('mergeone.takeoff_item_redistribution',pg_temp.f(200)::text,true);
select throws_ok(pg_temp.move_sql(',quantity=9'),'42501','TAKEOFF_ITEM_SEND_IMMUTABLE','move cannot change quantity');
select throws_ok(pg_temp.move_sql(',pages=array[2]'),'42501','TAKEOFF_ITEM_SEND_IMMUTABLE','move cannot change pages');
select throws_ok(pg_temp.move_sql($$,state='redistributed'$$),'42501','TAKEOFF_ITEM_SEND_IMMUTABLE','reserved state stays unwritten');
select throws_ok(pg_temp.move_sql(',item_id=gen_random_uuid()'),'42501','TAKEOFF_ITEM_SEND_IMMUTABLE','move cannot change item');
create temp table direct_move as select pg_temp.move_sql('') as statement;
grant select on direct_move to service_role,authenticated;
set local role service_role;
select throws_ok((select statement from direct_move),'42501','TAKEOFF_ITEM_SEND_WRITER_REQUIRED','service role direct write is refused even with the marker');
reset role;
set local role authenticated;
select throws_ok((select statement from direct_move),'42501','permission denied for table takeoff_item_send_parts','member with the marker has SELECT only');
reset role;
select set_config('mergeone.takeoff_item_redistribution','',true);
select set_config('mergeone.takeoff_item_send','send',true);
select throws_ok(pg_temp.move_sql(''),'42501','TAKEOFF_ITEM_SEND_IMMUTABLE','the send cannot move a part');
select set_config('mergeone.takeoff_item_send','',true);
select pg_temp.confirm('together',pg_temp.preview('together')->>'digest',202);
select results_eq($$select i.quantity from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id where t.item_id=pg_temp.f(50)$$,
  $$values (5::numeric)$$,'back to one line of five');
select is((select i.source_job_id from public.estimate_items i join public.takeoff_item_send_targets t
  on t.estimate_item_id=i.id where t.item_id=pg_temp.f(50)),pg_temp.f(41),'a combined destination keeps its first contributor as origin');
select results_eq($$select id,to_jsonb(p)-'target_id' from public.takeoff_item_send_parts p where version_id=pg_temp.f(30) order by id$$,
  $$select * from initial_parts order by id$$,'every raw column of both original parts is conserved');
select results_eq($$select * from public.takeoff_item_send_pages where version_id=pg_temp.f(30) order by id$$,$$select * from initial_pages order by id$$,'same pages and part IDs');
select results_eq($$select * from public.takeoff_item_send_receipts where version_id=pg_temp.f(30) and command_kind='send' order by id$$,
  $$select * from initial_receipts order by id$$,'the two send receipts stay unchanged');
select results_eq($$select * from public.estimate_items where id=pg_temp.f(62)$$,$$select * from kept_line$$,
  'every column of the unrelated priced line survives both redistributions');
-- A genuine version copy owns distinct parts. Its redistribution links back to
-- both original sends and changes no line, target or part on the source.
create temp table source_rows as
select id,to_jsonb(i) as row from public.estimate_items i where version_id=pg_temp.f(30)
union all select id,to_jsonb(t) from public.takeoff_item_send_targets t where version_id=pg_temp.f(30)
union all select id,to_jsonb(p) from public.takeoff_item_send_parts p where version_id=pg_temp.f(30);
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.f(1),'role','authenticated')::text,true);
set local role authenticated;
create temp table copied as select public.duplicate_estimate_version(pg_temp.f(30),false) id;
reset role;
insert into public.draft_locks(tenant_id,version_id,user_id,expires_at,session_id)
  select pg_temp.f(10),id,pg_temp.f(1),clock_timestamp()+interval '10 minutes',gen_random_uuid() from copied;
create temp table copy_plan as select public.preview_takeoff_item_redistribution(pg_temp.f(10),pg_temp.f(1),
  pg_temp.f(20),id,pg_temp.f(50),'by_level',true) plan from copied;
select is((select plan->'blockers' from copy_plan),'[]'::jsonb,'copied pristine targets can be redistributed');
create temp table copy_result as select public.redistribute_takeoff_item(pg_temp.f(10),pg_temp.f(1),pg_temp.f(20),
  id,pg_temp.f(50),'by_level',true,pg_temp.f(203),plan->>'digest') receipt from copied cross join copy_plan;
select ok((select receipt->'source_receipts' @> jsonb_build_array(pg_temp.f(71),pg_temp.f(72)) from copy_result),
  'redistribution in the copy references the original sends');
select results_eq($$select i.quantity from public.estimate_items i join public.takeoff_item_send_targets t on t.estimate_item_id=i.id
  where t.version_id=(select id from copied) order by i.quantity$$,$$values (2::numeric),(3::numeric)$$,
  'the copy holds two and three on its own lines');
select results_eq($$select id,to_jsonb(i) from public.estimate_items i where version_id=pg_temp.f(30)
  union all select id,to_jsonb(t) from public.takeoff_item_send_targets t where version_id=pg_temp.f(30)
  union all select id,to_jsonb(p) from public.takeoff_item_send_parts p where version_id=pg_temp.f(30)
  order by 1$$,$$select * from source_rows order by id$$,'the source estimate and journal stay intact');

-- A copy of a copy keeps each original send identity on its own receipt, even if
-- its intermediate receipt can no longer be read.
set local role authenticated;
create temp table nested_copy as select public.duplicate_estimate_version(id,false) id from copied;
reset role;
select results_eq($$select distinct (r.write_plan->>'original_send_receipt_id')::uuid
  from public.takeoff_item_send_parts p join public.takeoff_item_send_receipts r on r.id=p.receipt_id
  where p.version_id=(select id from nested_copy) order by 1$$,
  $$values (pg_temp.f(71)),(pg_temp.f(72))$$,'a nested copy retains both original send identities in its own journal');

select set_config('miaouffrage.estimate_v3_writer',pg_temp.f(30)::text,true);
update public.estimate_items set title='Lavabo personnalisé' where id in
  (select estimate_item_id from public.takeoff_item_send_targets where version_id=pg_temp.f(30) and item_id=pg_temp.f(50));
set local role authenticated;
create temp table custom_copy as select public.duplicate_estimate_version(pg_temp.f(30),false) id;
reset role;
select ok((select public.preview_takeoff_item_redistribution(pg_temp.f(10),pg_temp.f(1),pg_temp.f(20),id,pg_temp.f(50),'by_level',true)
  ->'blockers' @> '[{"reason":"edited","title":"Lavabo personnalisé"}]' from custom_copy),
  'a copied line personalized before duplication is named and protected on its own draft');

-- One historical edit at a time. A user can restore the old visible value. The audit
-- still contains the change, and even a subsequently duplicated line must retain it.
create function pg_temp.history_protected(field text) returns boolean language plpgsql as $$
declare original public.estimate_items; test_copy uuid; source_blocked boolean; copy_blocked boolean;
begin
  begin
    select i.* into strict original from public.estimate_items i join public.takeoff_item_send_targets t
      on i.id=t.estimate_item_id where t.version_id=(select id from copied) and t.item_id=pg_temp.f(50) order by i.id limit 1;
    insert into public.audit_logs(tenant_id,user_id,table_name,record_id,estimate_version_id,action,before_data,after_data)
      values(original.tenant_id,pg_temp.f(1),'estimate_items',original.id,original.version_id,'UPDATE',
        jsonb_set(to_jsonb(original),array[field],case when field='quantity' then '21'::jsonb else 'null'::jsonb end),
        jsonb_set(to_jsonb(original),array[field],case when field='quantity' then '19'::jsonb else '"historical value"'::jsonb end));
    source_blocked:=public.preview_takeoff_item_redistribution(pg_temp.f(10),pg_temp.f(1),pg_temp.f(20),
      original.version_id,pg_temp.f(50),'together',true)->'blockers' @> '[{"reason":"edited"}]';
    test_copy:=public.duplicate_estimate_version(original.version_id,false);
    copy_blocked:=public.preview_takeoff_item_redistribution(pg_temp.f(10),pg_temp.f(1),pg_temp.f(20),
      test_copy,pg_temp.f(50),'together',true)->'blockers' @> '[{"reason":"edited"}]';
    raise exception using errcode='Z0001';
  exception when sqlstate 'Z0001' then null; end;
  return source_blocked and copy_blocked;
end;
$$;
select ok(pg_temp.history_protected(field),field||' edits stay protected on the draft and on its copy')
from unnest(array['title','description','position','parent_id','quantity','unit_code','category_id','aid','line_nature','pricing_status',
  'unit_price_ht_cents','fo_price_origin','selected_supplier_price_id','product_id','offer_choice','supply_type_id','was_not_priced',
  'status_reason','tax_rate_bp','k_fo','k_fo_manual','fo_provision','k_mo','k_mo_atelier','k_mo_chantier','h_mo','h_mo_per_unit',
  'h_mo_atelier','h_mo_atelier_per_unit','h_mo_chantier','h_mo_chantier_per_unit','h_mo_majoration','labor_role_id',
  'labor_role_atelier_id','labor_role_chantier_id','source_provider','source_job_id','source_file_name','source_page','source_metadata']) field;
select * from finish();
rollback;
