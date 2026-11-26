-- An independent retained measure joins an earlier part of two units. The other
-- one-unit part of the earlier line is superseded on this plan as in the ordinary send.
create function pg_temp.retain_unreferenced() returns jsonb language plpgsql as $$
declare
  a uuid:=pg_temp.answer(300);
  review jsonb;
  result jsonb;
  target jsonb;
  plan_ jsonb;
  receipt jsonb;
begin
  delete from public.takeoff_item_answer_decisions where answer_id=a;
  -- Seed the independent prior plan before either public review or send runs.
  set local session_replication_role=replica;
  update public.takeoff_item_send_parts set plan_logical_id=pg_temp.f(109),pages=array[8] where quantity=2
    and job_id=pg_temp.job(20,1) and state='live';
  update public.takeoff_item_send_pages set page=8 where job_id=pg_temp.job(20,1) and page=2;
  set local session_replication_role=origin;
  set local role authenticated;
  review:=public.read_takeoff_measure_review(pg_temp.f(10),pg_temp.f(20),a);
  result:=public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(20),a,pg_temp.f(6060),
    jsonb_build_object('revision',review->'revision','gap_checked',false,'proof_checked',false,'rules_checked',false));
  reset role;
  plan_:=pg_temp.second(pg_temp.decisions(),pg_temp.chosen());
  target:=plan_#>'{targets,0}';
  target:=target||jsonb_build_object('quantity_after',7,'quantity',jsonb_build_object(
    'reference',null,'earlier',3,'replaced',1,'added',5,'measured',7,'gap',null,'kept_entry',false));
  plan_:=jsonb_set(plan_,'{targets,0}',target);
  insert into plans values ('individual-no-reference',plan_,null);
  set local role authenticated;
  result:=result||jsonb_build_object('checks',public.read_takeoff_measure_destination_reviews(pg_temp.f(10),pg_temp.f(20),plan_),
    'shown',target->'quantity_after');
  receipt:=pg_temp.send(6061,'individual-no-reference');
  reset role;
  result:=result||jsonb_build_object('receipt',receipt#>'{lines,0,quantity_after}',
    'stored',(select i.quantity from public.estimate_items i join draft d on d.line_id=i.id));
  raise exception using errcode='ZX001';
exception when sqlstate 'ZX001' then return result;
end;
$$;
select ok(got @> '{"outcome":"applied","checks":[],"shown":7,"receipt":7,"stored":7}',
  'without a DPGF reference five joins two: '||got::text) from pg_temp.retain_unreferenced() got;
