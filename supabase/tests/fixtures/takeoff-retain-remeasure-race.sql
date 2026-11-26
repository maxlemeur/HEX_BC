-- The same two legitimate actions in both arrival orders. Roll back each pair
-- to reuse the original current answer and keep the admission suite independent.
create function pg_temp.member_begin() returns text language sql stable as $$
  select format('begin; set local role authenticated; set local "request.jwt.claim.sub"=%L; set local "request.jwt.claims"=%L',
    pg_temp.f(1),jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text)
$$;
create function pg_temp.retain_for_remeasure() returns text language sql stable as $$
  select format($test$with seen as (select public.read_takeoff_measure_review(%1$L,%2$L,%3$L) r)
    select public.retain_takeoff_measure(%1$L,%2$L,%3$L,%4$L,jsonb_build_object('revision',r->'revision',
      'proof_checked',true,'gap_checked',true,'rules_checked',true))->>'outcome' from seen$test$,
    pg_temp.tenant(),pg_temp.f(20),pg_temp.targets(array[300])#>>'{0,answers,0}',pg_temp.f(6091))
$$;
select is(extensions.dblink_exec('race_setup',format('update public.takeoff_items set rules_stale=false,rule_results=''[]''
  where job_id=%L',pg_temp.job(1))),'UPDATE 1','rule evaluation finished for the current answer');
select is(extensions.dblink_exec('race_a',pg_temp.member_begin()),'SET','member opens the individual review');
select is((select outcome from extensions.dblink('race_a',pg_temp.retain_for_remeasure()) x(outcome text)),'applied','retention first');
select is(extensions.dblink_exec('race_b','begin'),'BEGIN','another session opens the admission');
select is(extensions.dblink_send_query('race_b',pg_temp.remeasure_sql(6092,array[300],2,pg_temp.job(1),confirmation=>pg_temp.tile_confirmation())),1,
  'submit the remeasure');
select ok(pg_temp.waits_for('race_b','race_a'),'admission waits for individual review');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','release individual review');
select is((select answer from extensions.dblink_get_result('race_b') x(answer text)),'admitted:','admission and sealing finish');
select is((select count(*)::integer from extensions.dblink_get_result('race_b') x(answer text)),0,'admission drained');
select is(extensions.dblink_exec('race_b','rollback'),'ROLLBACK','restore the current plan');
select is(extensions.dblink_exec('race_b','begin'),'BEGIN','open admission first');
select is((select outcome from extensions.dblink('race_b',pg_temp.remeasure_sql(6092,array[300],2,pg_temp.job(1),
  confirmation=>pg_temp.tile_confirmation())) x(outcome text)),'admitted:','remeasure seals its list');
select is(extensions.dblink_exec('race_a',pg_temp.member_begin()),'SET','open individual review second');
select is(extensions.dblink_send_query('race_a',pg_temp.retain_for_remeasure()),1,'submit individual review');
select ok(pg_temp.waits_for('race_a','race_b'),'individual review waits for admission');
select is(extensions.dblink_exec('race_b','rollback'),'ROLLBACK','release the admission');
select is((select answer from extensions.dblink_get_result('race_a') x(answer text)),'applied','the original answer can be retained');
select is((select count(*)::integer from extensions.dblink_get_result('race_a') x(answer text)),0,'review drained');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','restore the current decision');
