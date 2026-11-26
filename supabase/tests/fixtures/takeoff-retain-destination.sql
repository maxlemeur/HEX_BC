-- The list observed seven against four. The destination has one old unit and gets five
-- after page resolution. Its raw row also differs. Both the prompt and the locked writer
-- must use six against four. The old server can submit its ordinary v1 plan safely.
create function pg_temp.retained_destination_case() returns jsonb language plpgsql as $$
declare
  answer uuid; seen jsonb; requested jsonb; body_ jsonb; checks jsonb; result jsonb; confirmation jsonb;
begin
  if to_regprocedure('public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb)') is null then return '{"outcome":"unavailable"}'; end if;
  select id into answer from public.takeoff_item_answers where job_id=pg_temp.job(22,1) and item_id=pg_temp.f(320);
  delete from public.takeoff_item_answer_decisions where answer_id=answer;
  set local session_replication_role=replica;
  update public.takeoff_list_revision_entries set reference_quantity=4 where item_id=pg_temp.f(320);
  set local session_replication_role=origin;
  perform pg_temp.sign_in(1);
  set local role authenticated;
  seen:=public.read_takeoff_measure_review(pg_temp.f(10),pg_temp.f(22),answer);
  requested:=public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(22),answer,pg_temp.f(2450),
    jsonb_build_object('revision',seen->'revision','gap_checked',true,'proof_checked',false,'rules_checked',false));
  reset role;
  select jsonb_set(body,'{targets,0,quantity}',jsonb_build_object('kept_entry',false,'measured',6,'reference',4,
    'gap',jsonb_build_object('absolute',2))) into body_ from plans where name='wc_page_7';
  insert into plans values ('changed-reconciliation',body_,null);
  set local role authenticated;
  checks:=public.read_takeoff_measure_destination_reviews(pg_temp.f(10),pg_temp.f(22),body_);
  result:=jsonb_build_object('review',requested->'outcome','old_writer',pg_temp.refusal($q$select pg_temp.send(2451,'changed-reconciliation')$q$),
    'checks',checks);
  reset role;
  insert into plans values ('wrong-reconciliation',body_||jsonb_build_object('measure_confirmations',
    jsonb_set(checks,'{0,gap}','3')),null),('confirmed-reconciliation',body_||jsonb_build_object('measure_confirmations',checks),null);
  set local role authenticated;
  result:=result || jsonb_build_object('wrong',pg_temp.refusal($q$select pg_temp.send(2452,'wrong-reconciliation')$q$));
  confirmation:=pg_temp.send(2453,'confirmed-reconciliation');
  reset role;
  result:=result || jsonb_build_object('quantity',confirmation#>'{lines,0,quantity_after}','stored',exists(select 1 from public.takeoff_item_send_receipts
    where id=(confirmation->>'receipt_id')::uuid and write_plan->'measure_confirmations'=checks));
  raise exception using errcode='ZX001';
exception when sqlstate 'ZX001' then return result;
end;
$$;
create temp table retained_destination_result as select pg_temp.retained_destination_case() as result;
select ok(result @> '{"review":"applied","checks":[{"measured":6,"reference":4,"gap":2,"matched":false}]}',
  'preview names the actual reconciliation and cumulative gap: '||result::text) from retained_destination_result;
select is(result->>'old_writer','40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE measure_reconciliation_changed',
  'released writer needs the changed reconciliation acknowledged') from retained_destination_result;
select is(result->>'wrong','40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE measure_reconciliation_changed',
  'writer refuses an acknowledgement for another gap') from retained_destination_result;
select ok(result @> '{"quantity":6,"stored":true}','writer confirms six and journals the exact acknowledgement') from retained_destination_result;
