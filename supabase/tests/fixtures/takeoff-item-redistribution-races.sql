\ir takeoff-item-redistribution-locations.sql
-- A separate draft already holds three units from a different plan. Copy the stored
-- shapes of the existing fixture, substituting a new job, document, part and line.
select is(extensions.dblink_exec('race_setup',format($prior$
begin;
set local session_replication_role=replica;
insert into public.estimate_versions select (jsonb_populate_record(null::public.estimate_versions,
  to_jsonb(v)||jsonb_build_object('id',%1$L,'version_number',99))).*
  from public.estimate_versions v where id=%2$L;
insert into public.takeoff_jobs(id,tenant_id,project_id,estimate_version_id,level,status,source_file_name,created_by)
  values(%3$L,%4$L,%5$L,%1$L,'A','applied','Autre plan.pdf',%6$L);
insert into public.estimate_items select (jsonb_populate_record(null::public.estimate_items,to_jsonb(i)||jsonb_build_object(
  'id',case when i.item_type='section' then %7$L else %8$L end,'version_id',%1$L,
  'parent_id',case when i.item_type='line' then %7$L end,'source_job_id',case when i.item_type='line' then %3$L end))).*
  from public.estimate_items i where i.id in (
    select estimate_item_id from public.takeoff_item_send_targets where version_id=%2$L union
    select estimate_item_id from public.takeoff_item_send_sections where version_id=%2$L);
insert into public.takeoff_item_send_receipts select (jsonb_populate_record(null::public.takeoff_item_send_receipts,
  to_jsonb(r)||jsonb_build_object('id',%9$L,'job_id',%3$L,'version_id',%1$L,'request_id',%10$L))).*
  from public.takeoff_item_send_receipts r where version_id=%2$L and command_kind='send';
insert into public.takeoff_item_send_sections select (jsonb_populate_record(null::public.takeoff_item_send_sections,
  to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'version_id',%1$L,'estimate_item_id',%7$L,'receipt_id',%9$L))).*
  from public.takeoff_item_send_sections s where version_id=%2$L;
insert into public.takeoff_item_send_targets select (jsonb_populate_record(null::public.takeoff_item_send_targets,
  to_jsonb(t)||jsonb_build_object('id',%11$L,'version_id',%1$L,'estimate_item_id',%8$L,'created_by_receipt_id',%9$L))).*
  from public.takeoff_item_send_targets t where version_id=%2$L;
insert into public.takeoff_item_send_parts select (jsonb_populate_record(null::public.takeoff_item_send_parts,
  to_jsonb(p)||jsonb_build_object('id',%12$L,'version_id',%1$L,'job_id',%3$L,'target_id',%11$L,'receipt_id',%9$L,
    'plan_logical_id',%13$L,'answer_id',gen_random_uuid(),'observation_ids',array[gen_random_uuid()],'takeoff_item_ids',array[gen_random_uuid()]))).*
  from public.takeoff_item_send_parts p where version_id=%2$L and state='live';
insert into public.takeoff_item_send_pages select (jsonb_populate_record(null::public.takeoff_item_send_pages,
  to_jsonb(g)||jsonb_build_object('id',gen_random_uuid(),'version_id',%1$L,'job_id',%3$L,'receipt_id',%9$L,
    'part_ids',jsonb_build_array(%12$L),'document',jsonb_build_object('file_name','Autre plan.pdf','content_hash',repeat('e',64),'plan_file_id',%13$L)))).*
  from public.takeoff_item_send_pages g where version_id=%2$L;
insert into public.draft_locks(version_id,tenant_id,user_id,expires_at,session_id)
  values(%1$L,%4$L,%6$L,clock_timestamp()+interval '30 minutes',gen_random_uuid());
commit
$prior$,pg_temp.f(970),pg_temp.f(730),pg_temp.f(971),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),
  pg_temp.f(972),pg_temp.f(973),pg_temp.f(974),pg_temp.f(975),pg_temp.f(976),pg_temp.f(977),pg_temp.f(978))),'COMMIT',
  'a second plan has sent its three units on another draft of the same affaire');
-- The accepted reading adds to the other plan's three units, with nothing to replace.
insert into plans
select 'redistribution-other-plan',jsonb_set(plan,'{targets,0,quantity_after}',
  to_jsonb(3 + (plan#>>'{targets,0,quantity_after}')::numeric)),null
from pg_temp.plan_into(pg_temp.f(1120),pg_temp.f(970)) as p(plan);
-- The competing send must be independently valid. Probe it and roll it back before the actual race.
select is(extensions.dblink_exec('race_a','begin'),'BEGIN','check the competing send before the race');
select is(extensions.dblink_exec('race_a',pg_temp.as_server_sql()),'SET','use the send RPC');
select is((select x.result::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.send_sql(949,'redistribution-other-plan'))x(result text)),
  'false','the other plan could feed this item before the redistribution');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','restore the shared starting point');
create function pg_temp.redistribution_sql(mode text, request integer) returns text language sql stable as $$
  select format('select public.redistribute_takeoff_item(%L,%L,%L,%L,%L,%L,false,%L,%L,%L::jsonb)::text',
    pg_temp.tenant(),pg_temp.f(1),pg_temp.f(20),pg_temp.f(970),pg_temp.f(300),mode,pg_temp.f(request),
    pg_temp.preview_read(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(20),pg_temp.f(970),pg_temp.f(300),mode,false)->>'digest',
    pg_temp.location_input(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(20),pg_temp.f(970),pg_temp.f(300),mode,false))
$$;
create function pg_temp.loser(waiting text, holding text, refusal text) returns setof text language plpgsql as $$
begin
  return next ok(pg_temp.waits_for(waiting,holding),'second command waits for the transaction that won');
  return next is(extensions.dblink_exec(holding,'commit'),'COMMIT','first transaction commits');
  return next ok(pg_temp.answered(waiting),'waiting command returns');
  return next is((select count(*) from extensions.dblink_get_result(waiting,false) x(answer text)),0::bigint,'waiting command writes nothing');
  return next ok(position(refusal in extensions.dblink_error_message(waiting))>0,'waiting command reports '||refusal);
  perform * from extensions.dblink_get_result(waiting,false) x(answer text);
end;
$$;
select is(extensions.dblink_exec('race_a','begin'), 'BEGIN','redistributing the previously sent item');
select is(extensions.dblink_exec('race_a',pg_temp.as_server_sql()),'SET','through the server');
select is((select x.receipt::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.redistribution_sql('by_level',950)) x(receipt text)),
  'false','redistribution completes while its transaction stays open');
select is(extensions.dblink_send_query('race_b',pg_temp.send_sql(951,'redistribution-other-plan')),1,'a later plan send into the same item starts');
select * from pg_temp.loser('race_b','race_a','TAKEOFF_ITEM_SEND_PREVIEW_STALE');
select results_eq($$select i.quantity,t.breakdown from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.version_id=pg_temp.f(970) and t.item_id=pg_temp.f(300)$$,$$values (3::numeric,'by_level'::text)$$,'one live destination and the original three');

select is(extensions.dblink_exec('race_a','begin'),'BEGIN','two fresh intentions see the same state');
select is(extensions.dblink_exec('race_a',pg_temp.as_server_sql()),'SET','first through the server');
select is((select x.receipt::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.redistribution_sql('together',952)) x(receipt text)),
  'false','first confirmation has moved the three to one line');
select is(extensions.dblink_send_query('race_b',pg_temp.redistribution_sql('by_building',953)),1,'second confirmation starts');
select * from pg_temp.loser('race_b','race_a','REDISTRIBUTION_STALE');
select results_eq($$select i.quantity,t.breakdown from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.version_id=pg_temp.f(970) and t.item_id=pg_temp.f(300)$$,$$values (3::numeric,'together'::text)$$,'only the first confirmation took effect');
