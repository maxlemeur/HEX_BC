-- After #500's copy races, the new reading of the lavabo can add to the untouched
-- three on the independent draft. Commit the real writer, then inspect it from a different session.
select is((select x.outcome from extensions.dblink('race_setup', replace(replace(pg_temp.relaunch_sql(20),
  format('%L, ''reread_plans'', %L', pg_temp.f(620), pg_temp.job(20)), format('%L, ''reread_plans'', %L', pg_temp.f(680),
  pg_temp.f(1220))), pg_temp.f(1120)::text || '", "plan_set_id"', pg_temp.f(1320)::text || '", "plan_set_id"'))
  as x(outcome text)), 'admitted', 'a fourth reading of affaire 20''s plan');
select is((select x.job from extensions.dblink('race_setup', format($dispatch$select job_id::text from
  public.dispatch_next_takeoff_host_job(%L)$dispatch$, pg_temp.host())) as x(job text)), pg_temp.f(1320)::text, 'handed');
select is((select x.claimed from extensions.dblink('race_setup', replace(pg_temp.claim_sql(20, 945), pg_temp.job(20)::text,
  pg_temp.f(1320)::text)) as x(claimed bigint)), 1::bigint, 'claimed');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', replace(replace(pg_temp.publish_sql(20, 945),
  pg_temp.job(20)::text, pg_temp.f(1320)::text), pg_temp.f(820)::text, pg_temp.f(892)::text)) as x(answer text)), 'false',
  'published');
select is(extensions.dblink_exec('race_setup', format($rules$update public.takeoff_items set rules_stale = false,
  rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id = %L$rules$, pg_temp.f(1320))), 'UPDATE 1',
  'its rules are evaluated');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(20,
  pg_temp.accept_reading(633, pg_temp.f(1320)))) as x(outcome text)), 'applied', 'its lavabo accepted');
insert into plans
select 'redistribution-committed',jsonb_set(plan,'{targets,0,quantity_after}',
  to_jsonb(3 + (plan#>>'{targets,0,quantity_after}')::numeric)),null
from pg_temp.plan_into(pg_temp.f(1320),pg_temp.f(970)) as p(plan);
select is((select x.res::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.send_sql(955,'redistribution-committed'))
  as x(res text)),'false','a second genuine send into the occupied physical line commits');
select is((select i.quantity from public.estimate_items i join public.takeoff_item_send_targets t on t.estimate_item_id=i.id
  where t.version_id=pg_temp.f(970)),5::numeric,'the committed physical line now holds three plus two');
select is((select x.res::jsonb->'blockers' from extensions.dblink('race_setup',format(
  'select public.preview_takeoff_item_redistribution(%L,%L,%L,%L,%L,%L,false)::text',pg_temp.tenant(),pg_temp.f(1),pg_temp.f(20),
  pg_temp.f(970),pg_temp.f(300),'by_level')) as x(res text)),'[]'::jsonb,'a second connection sees a redistributable five');
-- The FK's KEY SHARE holds the physical line, independently of the version key.
select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','an outlier review starts referencing the line');
select is(extensions.dblink_exec('race_setup',format($link$
  insert into public.estimate_item_outlier_dismissals(tenant_id,version_id,item_id,flag_key,dismissed_by)
  select %1$L,%2$L,estimate_item_id,'quantity_outlier',%3$L from public.takeoff_item_send_targets
  where version_id=%2$L and estimate_item_id is not null$link$,pg_temp.tenant(),pg_temp.f(970),pg_temp.f(1))),
  'INSERT 0 1','the dependent holds KEY SHARE before its commit');
select is(extensions.dblink_send_query('race_b',pg_temp.redistribution_sql('by_level',956)),1,'an earlier preview tries to remove that line');
select * from pg_temp.loser('race_b','race_setup','REDISTRIBUTION_STALE');
select is((select count(*) from public.estimate_item_outlier_dismissals l join public.estimate_items i on i.id=l.item_id
  where l.version_id=pg_temp.f(970)),1::bigint,'both the committed review and its five-unit line survived');
select is(extensions.dblink_exec('race_setup',format('delete from public.estimate_item_outlier_dismissals where version_id=%L',
  pg_temp.f(970))),'DELETE 1','the next race starts without the independent review');

select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','a member prices the line');
select is((select x.locked from extensions.dblink('race_setup',format(
  'select pg_advisory_xact_lock(hashtextextended(%L,0))::text',pg_temp.f(970)::text))x(locked text)),'','editor holds the version key');
select is(extensions.dblink_exec('race_setup',format($edit$
  set local miaouffrage.estimate_v3_writer=%1$L;
  update public.estimate_items set unit_price_ht_cents=4200 where id in
    (select estimate_item_id from public.takeoff_item_send_targets where version_id=%1$L and item_id=%2$L)
$edit$,pg_temp.f(970),pg_temp.f(300))),'UPDATE 1','member enters a price on the live line');
select is(extensions.dblink_send_query('race_b',pg_temp.redistribution_sql('by_level',954)),1,'confirmation starts on its earlier preview');
select * from pg_temp.loser('race_b','race_setup','REDISTRIBUTION_STALE');
select results_eq($$select i.quantity,i.unit_price_ht_cents from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.version_id=pg_temp.f(970) and t.item_id=pg_temp.f(300)$$,$$values (5::numeric,4200)$$,'the edit and all five units remain on the line');
