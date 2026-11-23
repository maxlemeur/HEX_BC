-- The send writer sees the same new-line plan after an initial move and a round trip.
-- The two ordinary sends run in rolled-back transactions so both start with just the three.
select is((select x.r::jsonb->>'replayed' from extensions.dblink('race_setup',
  pg_temp.redistribution_sql('by_level',960)) x(r text)),'false','three units land on Non réparti');
select is(extensions.dblink_exec('race_setup',format($history$
  begin;
  set local mergeone.takeoff_item_send='fixture';
  insert into public.takeoff_item_send_parts select (jsonb_populate_record(null::public.takeoff_item_send_parts,
    to_jsonb(p)||jsonb_build_object('id',%1$L,'state','replaced','observation_ids',array[gen_random_uuid()],
      'replaced_by_receipt_id',p.receipt_id,'replaced_at',now()))).*
    from public.takeoff_item_send_parts p where p.id=%2$L;
  commit
$history$,pg_temp.f(967),pg_temp.f(977))),'COMMIT','the compartment also owns an earlier replaced observation');
select is(extensions.dblink_exec('race_setup',format($correct$
  insert into public.takeoff_plan_locations(tenant_id,project_id,source_kind,source_id,content_hash,revision,
    building_choice,building_set_by,building_set_at,building_set_revision,level_choice,level,level_set_by,
    level_set_at,level_set_revision,plan_file_id,document_name,created_by,updated_by)
  values(%1$L,%2$L,'plan_file',%3$L,repeat('e',64),1,'reading',%4$L,now(),1,'value','RDC',
    %4$L,now(),1,%3$L,'Autre plan.pdf',%4$L,%4$L)
$correct$,pg_temp.tenant(),pg_temp.f(20),pg_temp.f(978),pg_temp.f(1))),'INSERT 0 1','the plan now names RDC');
select is((select x.r::jsonb->>'replayed' from extensions.dblink('race_setup',
  pg_temp.redistribution_sql('by_level',961)) x(r text)),'false','RDC receives the three and Non réparti is vacated');

select ok(exists(select from public.takeoff_item_send_targets t join public.takeoff_item_send_parts p on p.target_id=t.id
    where p.id=pg_temp.f(967) and p.state='replaced' and t.version_id=pg_temp.f(970)
    and t.breakdown='by_level' and t.estimate_item_id is null and to_jsonb(t)->>'vacated_compartment_key'='unallocated'
    and exists(select from public.takeoff_item_send_receipts r where r.request_id=pg_temp.f(961)
      and r.result->'vacated_target_ids' @> jsonb_build_array(t.id))),
  'the replaced observation retains its target and original compartment');
create function pg_temp.send_into_vacancy(p_request integer) returns setof text language plpgsql as $$
declare body jsonb; target jsonb; answer jsonb;
begin
  body:=pg_temp.plan_into(pg_temp.f(1120),pg_temp.f(970));
  target:=body#>'{targets,0}' || jsonb_build_object('key',pg_temp.f(300)||'|unallocated','compartment_key','unallocated',
    'line',jsonb_build_object('kind','new_line','title','Poste 0 (fictif)','unit_code','u','order',1,
      'section_key','list:/unallocated','section_id',(select estimate_item_id from public.takeoff_item_send_sections
        where version_id=pg_temp.f(970) and section_key='list:/unallocated')));
  insert into plans values('vacancy-'||p_request,jsonb_set(body||jsonb_build_object('breakdown','by_level','targets',
    jsonb_build_array(target)),'{page_contributions,0,target_keys}',jsonb_build_array(target->>'key')),null);
  perform extensions.dblink_exec('race_a','begin');
  perform extensions.dblink_exec('race_a',pg_temp.as_server_sql());
  select r::jsonb into answer from extensions.dblink('race_a',pg_temp.send_sql(p_request,'vacancy-'||p_request),false) x(r text);
  return next is(answer->>'replayed','false','another plan sends two units without a recreation choice');
  if answer is not null then
    return next results_eq(format($q$select qty from extensions.dblink('race_a',%L) x(qty numeric)$q$,format(
      'select i.quantity from public.estimate_items i join public.takeoff_item_send_targets t on t.estimate_item_id=i.id
       where t.version_id=%L and t.compartment_key=''unallocated''',pg_temp.f(970))),
      'values (2::numeric)','there is exactly one two-unit line in the vacated compartment');
  end if;
  perform extensions.dblink_exec('race_a','rollback');
end;
$$;
select * from pg_temp.send_into_vacancy(962);
select is((select x.r::jsonb->>'replayed' from extensions.dblink('race_setup',
  pg_temp.redistribution_sql('together',963)) x(r text)),'false','redistribute back to Ensemble');
select is((select x.r::jsonb->>'replayed' from extensions.dblink('race_setup',
  pg_temp.redistribution_sql('by_level',964)) x(r text)),'false','redistribution re-enters the vacated RDC');
select * from pg_temp.send_into_vacancy(965);
select is((select x.r::jsonb->>'replayed' from extensions.dblink('race_setup',
  pg_temp.redistribution_sql('together',966)) x(r text)),'false','restore the three on Ensemble for the next committed send');
