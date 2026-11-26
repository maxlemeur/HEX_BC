-- 1,900 takeoff lines, the number of measurable lines in the 2,031-item large
-- workbook (the other 131 entries are sections). Compare the same published plan
-- and decisions, with none and then one fifth individually retained.
create temp table workload as
select n,pg_temp.f(10000+n) as item,pg_temp.f(20000+n) as answer,pg_temp.f(30000+n) as row_id,
  pg_temp.f(40000+n) as observation,pg_temp.f(50000+n) as command_id
from generate_series(1,1897) n;
set local session_replication_role=replica;
insert into public.takeoff_list_items(id,tenant_id,project_id,origin_kind,created_in_revision,created_by)
select item,pg_temp.f(10),pg_temp.f(20),'manual',1,pg_temp.f(1) from workload;
insert into public.takeoff_list_revision_entries(revision_id,tenant_id,project_id,item_id,position,source_key,label,expected_unit,origin_kind,origin)
select pg_temp.f(310),pg_temp.f(10),pg_temp.f(20),item,n+2,'manual:'||n,'Poste '||n,'u','manual','{"kind":"manual"}' from workload;
update public.takeoff_list_revisions set item_count=1900 where id=pg_temp.f(310);
insert into public.takeoff_item_answers
select r.* from public.takeoff_item_answers a cross join workload w cross join lateral jsonb_populate_record(a,
  jsonb_build_object('id',w.answer,'item_id',w.item,'observation_count',1,'contribution_count',1,'quantity',2)) r
where a.id=pg_temp.answer(300);
insert into public.takeoff_items
select r.* from public.takeoff_items i cross join workload w cross join lateral jsonb_populate_record(i,
  jsonb_build_object('id',w.row_id,'designation','Poste '||w.n,'is_verified',true,'verified_at',now(),'verified_by',pg_temp.f(1))) r
where i.id=pg_temp.f(811);
insert into public.takeoff_item_answer_observations
select r.* from public.takeoff_item_answer_observations o cross join workload w cross join lateral jsonb_populate_record(o,
  jsonb_build_object('id',w.observation,'answer_id',w.answer,'takeoff_item_id',w.row_id)) r where o.takeoff_item_id=pg_temp.f(811);
insert into public.takeoff_item_review_commands(id,tenant_id,project_id,intent_key,actor_id,gesture,command_sha256,outcome)
select command_id,pg_temp.f(10),pg_temp.f(20),command_id,pg_temp.f(1),'accept_measured',repeat('a',64),'{}' from workload;
insert into public.takeoff_item_answer_decisions(answer_id,tenant_id,project_id,item_id,plan_logical_id,kind,revision,actor_id,decided_at,command_id)
select answer,pg_temp.f(10),pg_temp.f(20),item,pg_temp.f(100),'accepted',1,pg_temp.f(1),now(),command_id from workload;
set local session_replication_role=origin;
analyze public.takeoff_list_revision_entries;
analyze public.takeoff_item_answers;
analyze public.takeoff_item_answer_observations;
analyze public.takeoff_items;
analyze public.takeoff_item_answer_decisions;
create temp table samples(retained integer,operation text,ms numeric);
create function pg_temp.time_reads(individual integer) returns void language plpgsql as $$
declare started timestamptz; page_rows integer; matches integer; facts jsonb;
begin
  for iteration in 1..7 loop
    started:=clock_timestamp();
    select count(*),max(matching_items) into page_rows,matches from public.read_takeoff_item_table(pg_temp.f(10),pg_temp.f(20));
    insert into samples values(individual,'table',extract(epoch from clock_timestamp()-started)*1000);
    if page_rows<>50 or matches<>1900 then raise exception 'unexpected table volume %/%',page_rows,matches; end if;
    started:=clock_timestamp();
    facts:=public.read_takeoff_item_send_facts(pg_temp.f(10),pg_temp.f(20),pg_temp.job(20,1));
    insert into samples values(individual,'preview facts',extract(epoch from clock_timestamp()-started)*1000);
    if jsonb_array_length(facts->'answers')<>1900 or
      (select count(*) from jsonb_array_elements(facts->'answers') a where a#>>'{decision,kind}'='accepted')<>1897 then
      raise exception 'unexpected preview volume or effective decisions'; end if;
  end loop;
end;
$$;
select pg_temp.sign_in(1);
select pg_temp.time_reads(0);
with retained as materialized (
  select w.command_id,private.takeoff_measure_facts(a) facts from workload w join public.takeoff_item_answers a on a.id=w.answer
  where w.n%5=1
)
insert into private.takeoff_retained_measures(command_id,acknowledged,revision,restored_revision)
select command_id,facts,private.takeoff_measure_revision(facts,false),private.takeoff_measure_revision(facts,true) from retained;
insert into private.takeoff_measure_lineage(answer_id,command_id) select answer,command_id from workload where n%5=1;
analyze private.takeoff_measure_lineage;
analyze private.takeoff_retained_measures;
select pg_temp.time_reads(380);
select diag(format('takeoff read cost | %s individual | %s | ms %s | median %s',
  retained,operation,array_agg(round(ms,1)),percentile_cont(0.5) within group(order by ms)))
from samples group by retained,operation order by retained,operation;
select ok(percentile_cont(0.5) within group(order by ms)<=400,
  format('%s individual: %s within 400 ms',retained,operation)) from samples group by retained,operation;
