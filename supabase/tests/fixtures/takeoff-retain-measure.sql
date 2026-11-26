-- Exercise the public review and released read contracts against the published two-page answer.
-- Each case rolls back its business writes before the existing send scenarios reuse the same publication.
-- A setting can change after the consent was read. Change it exactly when the journal
-- receives the decision to make the visibility boundary deterministic at READ COMMITTED.
create function pg_temp.change_threshold_at_decision() returns trigger language plpgsql as $$
begin
  insert into public.feature_flags(tenant_id,flag_key,enabled,value)
    values(new.tenant_id,'TAKEOFF_LOW_CONFIDENCE_THRESHOLD',true,'0.99')
    on conflict(tenant_id,flag_key) do update set enabled=true,value=excluded.value;
  return null;
end;
$$;
create trigger change_threshold_at_decision after insert on public.takeoff_item_review_commands
  for each row when (current_setting('test.retain_scenario',true)='threshold_changes')
  execute function pg_temp.change_threshold_at_decision();

create function pg_temp.retain_case(scenario text) returns jsonb language plpgsql as $$
declare
  answer uuid := (select a.id from public.takeoff_item_answers a where a.job_id=pg_temp.job(20,1) and a.item_id=pg_temp.f(300));
  row_id uuid := pg_temp.f(811);
  reviewed jsonb; acknowledgement jsonb; first_ jsonb; result jsonb; before_ jsonb; bulk_ text;
  fail_ jsonb := '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_NETWORK_MISSING","version":2,"reason":"Fictif","acceptable":true}]';
begin
  if to_regprocedure('public.read_takeoff_measure_review(uuid,uuid,uuid)') is null then
    return jsonb_build_object('outcome','unavailable'); end if;
  perform set_config('test.retain_scenario',scenario,true);
  if scenario not in ('rule','low_confidence','location_changed') then
    set local session_replication_role=replica;
    update public.takeoff_list_revision_entries set reference_quantity=1 where item_id=pg_temp.f(300);
    set local session_replication_role=origin;
  end if;
  if scenario in ('rule','both','unacceptable','missing_justification','invalid_justification','rule_changed','rules_unchecked','legacy','renewed','recalculated') then
    update public.takeoff_items set rule_results=case when scenario='unacceptable' then jsonb_set(fail_,'{0,acceptable}','false') else fail_ end
      where id=row_id;
    if scenario not in ('unacceptable','missing_justification') then
      perform pg_temp.sign_in(4);
      set local role authenticated;
      update public.takeoff_items set is_verified=true,verified_by=auth.uid(),verified_at=clock_timestamp(),
        verification_justification='{"reason_code":"system_documented","system_reference":"Documentation du fabricant fictif."}'
      where id=row_id;
      reset role;
      if scenario in ('legacy','renewed') then
        -- The released application audited the targeted action, before revision hashes were available.
        delete from private.takeoff_measure_justifications where item_id=row_id;
      end if;
      if scenario='renewed' then
        set local role authenticated;
        update public.takeoff_items set is_verified=false,verified_at=null,verified_by=null,
          verification_justification=null where id=row_id;
        update public.takeoff_items set is_verified=true,verified_at=clock_timestamp(),verified_by=auth.uid(),
          verification_justification='{"reason_code":"system_documented","system_reference":"Documentation du fabricant fictif."}'
          where id=row_id;
        reset role;
      end if;
      if scenario='recalculated' then
        update public.takeoff_items set rule_results=jsonb_set(rule_results,'{0,reason}','"Seconde évaluation"')
          where id=row_id;
        set local role authenticated;
        update public.takeoff_items set is_verified=is_verified,verified_at=verified_at,
          verification_justification=verification_justification where id=row_id;
        reset role;
      end if;
      if scenario='invalid_justification' then
        update public.takeoff_items set verification_justification='{"reason_code":"unknown"}' where id=row_id;
      end if;
    end if;
  end if;
  if scenario in ('low_confidence','proof_unchecked','location_changed') then update public.takeoff_items set confidence=0.1 where id=row_id; end if;
  if scenario='missing_evidence' then update public.takeoff_items set evidence=null where id=row_id; end if;
  if scenario='rules_stale' then update public.takeoff_items set rules_stale=true where id=row_id; end if;
  if scenario='alert' then update public.takeoff_items set is_excluded=true,exclusion_reason='Autre ligne' where id=row_id; end if;
  if scenario='single_unit' then
    update public.takeoff_items set unit='ml' where job_id=pg_temp.job(20,1);
    update public.takeoff_items set rules_stale=false where job_id=pg_temp.job(20,1);
  end if;
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
    'proof_checked',scenario not in ('proof_unchecked','threshold_changes'),'rules_checked',scenario<>'rules_unchecked');
  first_ := public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(20),answer,pg_temp.f(609),acknowledgement);
  if first_->>'outcome'='applied' then
    result := jsonb_build_object('replayed',public.retain_takeoff_measure(pg_temp.f(10),pg_temp.f(20),answer,pg_temp.f(609),acknowledgement)->'replayed');
  else result := '{}'::jsonb; end if;
  reset role;
  if scenario in ('restore','restore_reference','new_bulk') then
    set local role authenticated;
    result:=result || jsonb_build_object('aside',pg_temp.exclude_item(300,6001));
    reset role;
    if scenario in ('restore_reference','new_bulk') then
      set local session_replication_role=replica;
      update public.takeoff_list_revision_entries set reference_quantity=case when scenario='new_bulk' then 3 else 2 end where item_id=pg_temp.f(300);
      set local session_replication_role=origin;
    end if;
    set local role authenticated;
    result:=result || jsonb_build_object('restore',pg_temp.review(pg_temp.cmd('reinstate',6002,array[300],array[300]))->>'outcome');
    reset role;
    -- The released server refreshes the rules after an exclusion or restoration.
    update public.takeoff_items set rules_stale=false,rules_evaluated_at=clock_timestamp()
      where job_id=pg_temp.job(20,1);
    set local role authenticated;
    result:=result||jsonb_build_object('second_bulk',pg_temp.review(pg_temp.cmd('accept_measured',6003,array[300],array[300]))->>'outcome');
    reset role;
    if to_regclass('private.takeoff_measure_lineage') is null then
      result:=result||'{"individual":false}'::jsonb;
    else
      result:=result||jsonb_build_object('individual',exists(select 1 from private.takeoff_measure_lineage l
        where l.answer_id=answer and l.command_id=(first_->>'command_id')::uuid));
    end if;
  end if;
  if scenario='location_changed' then
    update public.takeoff_plan_locations set building='B',level='R+1',revision=revision+1
      where project_id=pg_temp.f(20);
    result:=result||jsonb_build_object('location_checks',public.read_takeoff_measure_destination_reviews(pg_temp.f(10),pg_temp.f(20),
      pg_temp.plan(pg_temp.job(20,1),null,jsonb_build_array(pg_temp.new_line(pg_temp.job(20,1),300,3)),
        '[{"key":"list:","title":"Métré","parent_key":null,"parent_id":null}]',pg_temp.payload(6080))));
  end if;
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
  case when scenario in ('rule','both','renewed') then '{"preserved":true}'::jsonb else '{}'::jsonb end),
  scenario || ' ' || got || ': individual retention, original author and reason, released preview and writer')
from (values ('rule'),('gap'),('both'),('low_confidence'),('renewed')) x(scenario) cross join lateral pg_temp.retain_case(scenario) got;
select ok(got @> jsonb_build_object('outcome','refused','reason',reason,'facts',null,'parts',null,'table',jsonb_build_array('pending',null)),
  scenario || ' ' || got || ': refusal without a retained decision')
from (values ('legacy','justification_required'),('recalculated','justification_required'),('single_unit','unit_mismatch'),('missing_justification','justification_required'),('invalid_justification','justification_required'),
  ('unacceptable','rule_not_acceptable'),('missing_evidence','missing_evidence'),('rules_stale','rules_stale'),
  ('alert','alert'),('unit_mismatch','unit_conflict'),('gap_unchecked','gap_confirmation_required'),
  ('rules_unchecked','rules_confirmation_required'),('proof_unchecked','proof_confirmation_required')) x(scenario,reason) cross join lateral pg_temp.retain_case(scenario) got;
select ok(got @> '{"outcome":"applied","facts":null,"parts":null,"table":["pending",null]}',
  scenario || ' ' || got || ': an old decision cannot supply the estimate')
from (values ('row_changed'),('rule_changed'),('reference_changed'),('marks_changed'),('threshold_changes')) x(scenario) cross join lateral pg_temp.retain_case(scenario) got;


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

select ok(got @> '{"aside":"applied","restore":"applied","second_bulk":"stale","individual":true,"facts":{"kind":"accepted","revision":3},"parts":3}',
  'unchanged measure reinstates with its decision: '||got::text) from pg_temp.retain_case('restore') got;
select ok(got @> '{"aside":"applied","restore":"applied","second_bulk":"stale","individual":true,"facts":null,"parts":null}',
  'a revised list reference requires a fresh individual decision: '||got::text) from pg_temp.retain_case('restore_reference') got;

select ok(got @> '{"aside":"applied","restore":"applied","second_bulk":"applied","individual":false,"facts":{"kind":"accepted"},"parts":3}',
  'a fresh ordinary acceptance of an eligible answer replaces its individual origin: '||got::text)
  from pg_temp.retain_case('new_bulk') got;

-- A column list on UPDATE is not evidence of a member's verification. Check the
-- database trigger itself so even an additional patch entry point has to obey this contract.
select ok(pg_get_triggerdef(oid) ilike '%old.is_verified%' and
  pg_get_triggerdef(oid) ilike '%old.verification_justification%reason_code%IS DISTINCT FROM%new.verification_justification%reason_code%',
  'verification stamps require a verification transition or a different coded reason')
from pg_trigger where tgrelid='public.takeoff_items'::regclass and tgname='record_takeoff_measure_justification';

-- The permissions and the one consent read belong after the final contribution lock.
-- This also checks replay's separate authorization path without relying on scheduler timing.
with def as (select lower(prosrc) as body from pg_proc
  where oid='public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb)'::regprocedure),
locked as (select split_part(body,'for update of i;',2) as tail from def)
select ok(strpos(tail,'private.lock_takeoff_measure_reviewer') between 1 and strpos(tail,'select private.takeoff_measure_review(') and
  strpos(tail,'private.takeoff_measure_facts(a)')=0,'permission is checked after waiting; consent is read once') from locked;

select ok(got @> '{"facts":{"kind":"accepted"},"parts":3,"location_checks":[]}',
  'changing building and level preserves the measured answer: '||got::text) from pg_temp.retain_case('location_changed') got;

with source as (select prosrc body from pg_proc where oid='public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
select ok(strpos(body,'takeoff-item-review:') between 1 and strpos(body,'private.lock_takeoff_item_list('),
  'retention follows the review-before-list order of remeasure admission and sealing') from source;
