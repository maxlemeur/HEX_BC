-- The list observed seven against four. The destination has one old unit and gets five
-- after page resolution. Its raw row also differs. Both the prompt and the locked writer
-- must use six against four. The old server can submit its ordinary v1 plan safely.
create function pg_temp.retained_destination_case() returns jsonb language plpgsql as $$
declare
  answer uuid; seen jsonb; requested jsonb; body_ jsonb; checks jsonb; result jsonb; confirmation jsonb; footprint text; line_before jsonb; refusal text; detail text;
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
  footprint:=pg_temp.footprint();
  checks:=public.read_takeoff_measure_destination_reviews(pg_temp.f(10),pg_temp.f(22),body_);
  select to_jsonb(i) into strict line_before from public.estimate_items i where id=pg_temp.f(993);
  begin
    perform pg_temp.send(2451,'changed-reconciliation');
  exception when serialization_failure then
    get stacked diagnostics detail=pg_exception_detail;
    refusal:=sqlstate||' '||sqlerrm||' '||(detail::jsonb->>'reason');
  end;
  result:=jsonb_build_object('review',requested->'outcome','old_writer',refusal,'checks',checks,
    'unwritten',footprint=pg_temp.footprint() and line_before=
      (select to_jsonb(i) from public.estimate_items i where id=pg_temp.f(993)));
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
select ok(result @> '{"review":"applied","unwritten":true,"checks":[{"measured":6,"reference":4,"gap":2,"matched":false}]}',
  'preview names the actual reconciliation and cumulative gap: '||result::text) from retained_destination_result;
select is(result->>'old_writer','40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE measure_reconciliation_changed',
  'released writer needs the changed reconciliation acknowledged') from retained_destination_result;
select is(result->>'wrong','40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE measure_reconciliation_changed',
  'writer refuses an acknowledgement for another gap') from retained_destination_result;
select ok(result @> '{"quantity":6,"stored":true}','writer confirms six and journals the exact acknowledgement') from retained_destination_result;

-- Remapping and copying preserve the origin when the raw row and import agree.
-- The destination version and physical line IDs deliberately differ on the copy.
create function pg_temp.reconciliation_identity() returns jsonb language plpgsql as $$
declare
  a uuid:=pg_temp.answer(320); reviewed jsonb; plan_ jsonb; result jsonb;
  copied uuid; copied_line uuid;
begin
  delete from public.takeoff_item_answer_decisions where answer_id=a;
  set local session_replication_role=replica;
  update public.takeoff_list_revision_entries set reference_quantity=4,
    origin=jsonb_set(origin,'{rawRowId}',to_jsonb(pg_temp.f(343))) where item_id=pg_temp.f(320);
  set local session_replication_role=origin;
  set local role authenticated;
  reviewed:=public.read_takeoff_measure_review(pg_temp.f(10),pg_temp.f(22),a);
  result:=public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(22),a,pg_temp.f(6070),jsonb_build_object(
    'revision',reviewed->'revision','proof_checked',false,'gap_checked',true,'rules_checked',false));
  reset role;
  set local session_replication_role=replica;
  insert into public.dpgf_rows_mapped(id,tenant_id,import_id,payload,raw_row_id,status)
    select pg_temp.f(6071),tenant_id,import_id,payload,raw_row_id,status from public.dpgf_rows_mapped where id=pg_temp.f(342);
  update public.estimate_items set source_job_id=null,source_metadata=jsonb_set(source_metadata-'takeoff_quantity_policy','{mapped_row_id}',to_jsonb(pg_temp.f(6071)))
    where id=pg_temp.f(993);
  set local session_replication_role=origin;
  plan_:=jsonb_set(pg_temp.wc(pg_temp.parts(pg_temp.job(22,1),320,22),'[]','[]',7),'{targets,0,quantity}',
    jsonb_build_object('kept_entry',false,'measured',7,'reference',4,'gap',jsonb_build_object('absolute',3)));
  set local role authenticated;
  result:=result||jsonb_build_object('remapped',public.read_takeoff_measure_destination_reviews(pg_temp.f(10),pg_temp.f(22),plan_));
  copied:=public.duplicate_estimate_version(pg_temp.f(991),false);
  reset role;
  select estimate_item_id into strict copied_line from public.read_estimate_dpgf_raw_rows(pg_temp.f(10),copied)
    where raw_row_id=pg_temp.f(343);
  plan_:=jsonb_set(jsonb_set(plan_,'{destination,version_id}',to_jsonb(copied)),'{targets,0,line,estimate_item_id}',to_jsonb(copied_line));
  set local role authenticated;
  result:=result||jsonb_build_object('copy',public.read_takeoff_measure_destination_reviews(pg_temp.f(10),pg_temp.f(22),plan_),
    'decision',public.read_takeoff_item_send_facts(pg_temp.f(10),pg_temp.f(22),pg_temp.job(22,1))#>>'{answers,0,decision,kind}');
  reset role;
  raise exception using errcode='ZX001';
exception when sqlstate 'ZX001' then return result;
end;
$$;
select ok(got @> '{"outcome":"applied","remapped":[],"copy":[],"decision":"accepted"}',
  'same import and raw row preserve reconciliation and retention across remapping and draft copy: '||got::text)
  from pg_temp.reconciliation_identity() got;
