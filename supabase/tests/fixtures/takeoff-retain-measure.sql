-- Exercise the public review and released read contracts against the published two-page answer.
-- Each case rolls back its business writes before the existing send scenarios reuse the same publication.
create function pg_temp.retain_case(scenario text) returns jsonb language plpgsql as $$
declare
  answer uuid := (select a.id from public.takeoff_item_answers a where a.job_id=pg_temp.job(20,1) and a.item_id=pg_temp.f(300));
  row_id uuid := pg_temp.f(811);
  reviewed jsonb; acknowledgement jsonb; first_ jsonb; result jsonb; before_ jsonb; bulk_ text;
  fail_ jsonb := '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_NETWORK_MISSING","version":2,"reason":"Fictif","acceptable":true}]';
begin
  if to_regprocedure('public.read_takeoff_measure_review(uuid,uuid,uuid)') is null then
    return jsonb_build_object('outcome','unavailable'); end if;
  if scenario not in ('rule','low_confidence') then
    set local session_replication_role=replica;
    update public.takeoff_list_revision_entries set reference_quantity=1 where item_id=pg_temp.f(300);
    set local session_replication_role=origin;
  end if;
  if scenario in ('rule','both','unacceptable','missing_justification','invalid_justification','rule_changed','rules_unchecked','legacy') then
    update public.takeoff_items set rule_results=case when scenario='unacceptable' then jsonb_set(fail_,'{0,acceptable}','false') else fail_ end
      where id=row_id;
    if scenario not in ('unacceptable','missing_justification') then
      perform pg_temp.sign_in(4);
      set local role authenticated;
      update public.takeoff_items set is_verified=true,verified_by=auth.uid(),verified_at=clock_timestamp(),
        verification_justification='{"reason_code":"system_documented","system_reference":"Documentation du fabricant fictif."}'
      where id=row_id;
      reset role;
      if scenario='legacy' then
        -- The released application audited the targeted action, before revision hashes were available.
        delete from private.takeoff_measure_justifications where item_id=row_id;
      end if;
      if scenario='invalid_justification' then
        update public.takeoff_items set verification_justification='{"reason_code":"unknown"}' where id=row_id;
      end if;
    end if;
  end if;
  if scenario in ('low_confidence','proof_unchecked') then update public.takeoff_items set confidence=0.1 where id=row_id; end if;
  if scenario='missing_evidence' then update public.takeoff_items set evidence=null where id=row_id; end if;
  if scenario='rules_stale' then update public.takeoff_items set rules_stale=true where id=row_id; end if;
  if scenario='alert' then update public.takeoff_items set is_excluded=true,exclusion_reason='Autre ligne' where id=row_id; end if;
  if scenario='unit_mismatch' then
    update public.takeoff_items set unit='ml' where id=row_id;
    update public.takeoff_items set rules_stale=false where job_id=pg_temp.job(20,1);
  end if;
  select jsonb_build_array(verified_by,verified_at,verification_justification) into before_ from public.takeoff_items where id=row_id;
  perform pg_temp.sign_in(1);
  set local role authenticated;
  bulk_ := pg_temp.review(pg_temp.cmd('accept_measured',608,array[300],array[300]))->>'outcome';
  reviewed := public.read_takeoff_measure_review(pg_temp.f(10),pg_temp.f(20),answer);
  acknowledgement := jsonb_build_object('revision',reviewed->'revision','gap_checked',scenario<>'gap_unchecked',
    'proof_checked',scenario<>'proof_unchecked','rules_checked',scenario<>'rules_unchecked');
  first_ := public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(20),answer,pg_temp.f(609),acknowledgement);
  if first_->>'outcome'='applied' then
    result := jsonb_build_object('replayed',public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(20),answer,pg_temp.f(609),acknowledgement)->'replayed');
  else result := '{}'::jsonb; end if;
  reset role;
  if scenario='rule_changed' then
    update public.takeoff_items set rule_results=jsonb_set(rule_results,'{0,reason}','"Nouveau constat"') where id=row_id;
  elsif scenario='row_changed' then update public.takeoff_items set evidence='Autre preuve' where id=row_id;
  elsif scenario='marks_changed' then
    insert into public.takeoff_count_answer_states(answer_id,tenant_id,project_id,revision,member_edited)
    values(answer,pg_temp.f(10),pg_temp.f(20),1,true)
    on conflict(answer_id) do update set revision=public.takeoff_count_answer_states.revision+1;
  elsif scenario='reference_changed' then
    set local session_replication_role=replica;
    update public.takeoff_list_revision_entries set reference_quantity=2 where item_id=pg_temp.f(300);
    set local session_replication_role=origin;
  end if;
  result := result || jsonb_build_object('bulk',bulk_,'outcome',first_->>'outcome','reason',first_->>'reason',
    'preserved',(select jsonb_build_array(verified_by,verified_at,verification_justification)=before_ from public.takeoff_items where id=row_id),
    'table',(select jsonb_build_array(t.decision,t.readings#>>'{0,decision,kind}') from public.read_takeoff_item_table(
       pg_temp.f(10),pg_temp.f(20),pg_temp.f(100),p_item_ids=>array[pg_temp.f(300)]) t),
    'audit',(select jsonb_build_object('actor',d.actor_id=pg_temp.f(1),'instant',d.decided_at=c.created_at,
      'scope',m.acknowledged->>'answer_id'=d.answer_id::text and m.acknowledged->>'plan_id'=d.plan_logical_id::text
        and m.acknowledged->>'item_id'=d.item_id::text,'quantity',m.acknowledged->'quantity','unit',m.acknowledged->'unit',
      'marks_revision',m.acknowledged->'marks_revision','list_revision',m.acknowledged->'list_revision',
      'rows',jsonb_array_length(m.acknowledged->'rows')) from public.takeoff_item_answer_decisions d
       join private.takeoff_retained_measures m on m.command_id=d.command_id
       join public.takeoff_item_review_commands c on c.id=d.command_id where d.answer_id=answer),
    'facts',(select a->'decision' from jsonb_array_elements(public.read_takeoff_item_send_facts(pg_temp.f(10),pg_temp.f(20),pg_temp.job(20,1))->'answers') a
      where a->>'item_id'=pg_temp.f(300)::text),
    'parts',(select sum((p->>'quantity')::numeric) from private.takeoff_item_send_resolved_parts(pg_temp.f(10),pg_temp.f(20),pg_temp.job(20,1),array[2,7]) p
      where p->>'item_id'=pg_temp.f(300)::text));
  raise exception using errcode='ZX001';
exception when sqlstate 'ZX001' then return result;
end;
$$;
select ok(got @> ('{"bulk":"stale","outcome":"applied","replayed":true,"facts":{"kind":"accepted","revision":1},"parts":3,"table":["accepted","accepted"],"audit":{"actor":true,"instant":true,"scope":true,"quantity":3,"unit":"u","marks_revision":0,"list_revision":1,"rows":2}}'::jsonb ||
  case when scenario in ('rule','both','legacy') then '{"preserved":true}'::jsonb else '{}'::jsonb end),
  scenario || ' ' || got || ': individual retention, original author and reason, released preview and writer')
from (values ('rule'),('gap'),('both'),('low_confidence'),('legacy')) x(scenario) cross join lateral pg_temp.retain_case(scenario) got;
select ok(got @> jsonb_build_object('outcome','refused','reason',reason,'facts',null,'parts',null,'table',jsonb_build_array('pending',null)),
  scenario || ' ' || got || ': refusal without a retained decision')
from (values ('missing_justification','justification_required'),('invalid_justification','justification_required'),
  ('unacceptable','rule_not_acceptable'),('missing_evidence','missing_evidence'),('rules_stale','rules_stale'),
  ('alert','alert'),('unit_mismatch','unit_conflict'),('gap_unchecked','gap_confirmation_required'),
  ('rules_unchecked','rules_confirmation_required'),('proof_unchecked','proof_confirmation_required')) x(scenario,reason) cross join lateral pg_temp.retain_case(scenario) got;
select ok(got @> '{"outcome":"applied","facts":null,"parts":null,"table":["pending",null]}',
  scenario || ' ' || got || ': an old decision cannot supply the estimate')
from (values ('row_changed'),('rule_changed'),('reference_changed'),('marks_changed')) x(scenario) cross join lateral pg_temp.retain_case(scenario) got;


-- The decision and its journal have no anonymous, service or direct table write entry point.
select ok(not has_function_privilege('anon','public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb)','execute')
  and not has_table_privilege('authenticated','private.takeoff_retained_measures','insert'),
  'only the signed-in review command can create an acknowledgement');
select pg_temp.sign_in(3);
set local role authenticated;
select is(pg_temp.refusal($call$select public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(20),null,pg_temp.f(2454),'{}')$call$),
  '42501 TAKEOFF_ITEM_REVIEW_FORBIDDEN','reader cannot retain a measure');
select pg_temp.sign_in(5);
select is(pg_temp.refusal($call$select public.read_takeoff_measure_review(pg_temp.f(10),pg_temp.f(20),null)$call$),
  '42501 TAKEOFF_ITEM_REVIEW_FORBIDDEN','review is scoped to the current tenant');
reset role;
