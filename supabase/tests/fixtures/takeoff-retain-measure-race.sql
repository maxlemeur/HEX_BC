-- B reads an effective decision. The rule engine then revises its evaluation stamp without changing the
-- quantity or its verification. A retains that new revision while B confirms the originally valid plan.
create function pg_temp.retain_sql(intent integer) returns text language sql stable as $$
  select format(
  $retain$with seen as (select public.read_takeoff_measure_review(%1$L,%2$L,%3$L) as review)
    select public.retain_takeoff_measure(%1$L,%2$L,%3$L,%4$L,jsonb_build_object('revision',review->'revision',
      'gap_checked',false,'proof_checked',false,'rules_checked',false)) from seen$retain$,
  pg_temp.tenant(),pg_temp.f(20),(select id from public.takeoff_item_answers where job_id=pg_temp.job(20) and item_id=pg_temp.f(300)),
  pg_temp.f(intent))
$$;
select is((select x.result->>'outcome' from extensions.dblink('race_a',pg_temp.retain_sql(619)) x(result jsonb)),
  'applied','first retention supplies an ordinary v1 preview');
insert into plans values ('before-retention',pg_temp.plan(20,null,300,2,pg_temp.payload(720)),pg_temp.payload(720));
select is(extensions.dblink_exec('race_setup',format('update public.takeoff_items set rules_evaluated_at=clock_timestamp()
  where id=%L',pg_temp.f(820))),'UPDATE 1','the reviewed revision changed at the same quantity');
select is(extensions.dblink_exec('race_a','begin'),'BEGIN','open the individual retention');
select is((select x.result->>'outcome' from extensions.dblink('race_a',pg_temp.retain_sql(620)) x(result jsonb)),
  'applied','A retained the new revision, still uncommitted');
select is(extensions.dblink_send_query('race_b',pg_temp.send_sql(969,'before-retention')),1,'B confirms the old preview');
select ok(pg_temp.waits_for('race_b','race_a'),'confirmation waits for the individual decision');
select is(extensions.dblink_exec('race_a','commit'),'COMMIT','commit the decision');
select ok(pg_temp.answered('race_b'),'the writer resumes');
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) x(answer text)),0,'no receipt');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%answers_changed%',
  'the locked writer observed the new decision: '||extensions.dblink_error_message('race_b'));
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) x(answer text)),0,'B drained');
select is(pg_temp.written(20),'0/0/0/0/completed','no partial send');

-- Exercise the final permission gate without issuing a business write. The SQL
-- contract test also checks where the public writer calls this gate.
select to_regprocedure('private.lock_takeoff_measure_reviewer(uuid,uuid,uuid)') is not null as has_locked_reviewer \gset
\if :has_locked_reviewer
select is(extensions.dblink_exec('race_setup',format('begin; update public.tenant_memberships set role=''director''
  where tenant_id=%L and user_id=%L',pg_temp.tenant(),pg_temp.f(1))),'UPDATE 1','role change pending');
select is(extensions.dblink_exec('race_a','begin; set local role postgres'),'SET','exercise the private permission gate with the member identity');
select is(extensions.dblink_send_query('race_a',format('select private.lock_takeoff_measure_reviewer(%L,%L,%L)',
  pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1))),1,'evaluate permission');
select ok(pg_temp.waits_for('race_a','race_setup'),'permission evaluation waits for the membership');
select is(extensions.dblink_exec('race_setup','commit'),'COMMIT','role change commits');
select is((select allowed from extensions.dblink_get_result('race_a') x(allowed boolean)),false,'committed demotion denies retention');
select is((select count(*)::integer from extensions.dblink_get_result('race_a') x(r boolean)),0,'permission evaluation drained');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','close permission probe');
select is(extensions.dblink_exec('race_setup',format('update public.tenant_memberships set role=''engineer''
  where tenant_id=%L and user_id=%L',pg_temp.tenant(),pg_temp.f(1))),'UPDATE 1','restore fixture role');
\else
select fail('the writer needs a permission gate that serializes with membership changes');
\endif
