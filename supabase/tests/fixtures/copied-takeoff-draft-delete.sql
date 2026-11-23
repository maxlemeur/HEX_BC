-- The caller supplies draft_source(id, tenant_id, project_id) after a real send, and sign_in(n).
-- Exercise the same owner action against each writer's data, then restore the caller's scenario.
-- The affaire's Delete action, with a real send and a surviving copy until the project's cascade.
savepoint before_affaire_delete;
set constraints all immediate;
set constraints all deferred;
select pg_temp.sign_in(1);
set local role authenticated;
create temp table affaire_copy as select public.duplicate_estimate_version((select id from draft_source), false) as id;
select ok(exists (
  select 1 from public.estimate_versions v
  join public.estimate_items i on i.version_id = v.id
  join public.takeoff_jobs j on j.id = i.source_job_id
  where v.id = (select id from affaire_copy) and v.calc_engine_version = 3 and v.status = 'draft'
    and j.estimate_version_id = (select id from draft_source) and i.item_type = 'line'
), 'the engine 3 copy has a line fed by the source draft’s analysis');
select results_eq($$select outcome, message from draft_source d
  cross join lateral public.bulk_delete_draft_affaires(d.tenant_id, array[d.project_id])$$,
  $$values ('deleted'::text, null::text)$$, 'the owner deletes the whole affaire with the fed draft and its copy');
reset role;
select is((select count(*) from public.estimate_versions where project_id = (select project_id from draft_source)), 0::bigint,
  'both versions leave with the affaire');
rollback to before_affaire_delete;

savepoint before_copy_delete;
set constraints all immediate;
set constraints all deferred;
select pg_temp.sign_in(1);
set local role authenticated;
savepoint without_copies;
with removed as (
  delete from public.estimate_versions where id = (select id from draft_source) returning id
)
select is(count(*), 1::bigint, 'the owner can delete the fed draft before any copy') from removed;
rollback to without_copies;

create temp table child as select public.duplicate_estimate_version(id, false) as id from draft_source;
create temp table grandchild as select public.duplicate_estimate_version(id, false) as id from child;
reset role;
create function pg_temp.draft_state() returns jsonb language sql stable as $$
  select jsonb_build_array(
    (select jsonb_agg(to_jsonb(v) order by v.id) from public.estimate_versions v where v.project_id=d.project_id),
    (select jsonb_agg(to_jsonb(i) order by i.id) from public.estimate_items i join public.estimate_versions v on v.id=i.version_id
      where v.project_id=d.project_id),
    (select jsonb_agg(to_jsonb(j) order by j.id) from public.takeoff_jobs j where j.project_id=d.project_id)
  ) from draft_source d
$$;
create temp table original_state as select pg_temp.draft_state() as value;
create function pg_temp.delete_error() returns jsonb language plpgsql as $$
begin
  delete from public.estimate_versions where id=(select id from draft_source);
  return null;
exception when sqlstate 'PGRST' then
  return sqlerrm::jsonb;
when others then return to_jsonb(sqlstate || ' ' || sqlerrm);
end;
$$;
select pg_temp.sign_in(2);
set local role authenticated;
with removed as (
  delete from public.estimate_versions where id = (select id from draft_source) returning id
)
select is(count(*), 0::bigint, 'RLS filters an unauthorized deletion before it can disclose dependencies') from removed;
select pg_temp.sign_in(1);
create temp table refusal as select pg_temp.delete_error() as error;
select is((select error->>'code' from refusal),'ESTIMATE_DRAFT_TAKEOFF_IN_USE',
  'the owner receives the specific refusal for a source with copied lines');
select results_eq($$select x->>'id' from refusal cross join lateral jsonb_array_elements((error->>'details')::jsonb->'versions') x$$,
  $$select id::text from grandchild union all select id::text from child$$,'both copies are named in timeline order');
select matches((select error->>'message' from refusal),'V3.*V2.*Supprimez.*conservez ce brouillon',
  'the French message names both versions and explains the choice');
reset role;
select is(pg_temp.draft_state(),(select value from original_state),'source, copies, jobs and every line column are unchanged');

savepoint many_copies;
set local role authenticated;
select public.duplicate_estimate_version(s.id, false) from draft_source s cross join generate_series(1,4);
select results_eq($$select jsonb_array_length(detail->'versions'), (detail->>'total')::int
  from (select (pg_temp.delete_error()->>'details')::jsonb as detail) r$$,
  $$values (5,6)$$, 'the error names at most five versions and gives the total');
rollback to many_copies;

savepoint with_copies;
set local role authenticated;
delete from public.estimate_versions where id=(select id from grandchild);
delete from public.estimate_versions where id=(select id from child);
with removed as (
  delete from public.estimate_versions where id = (select id from draft_source) returning id
)
select is(count(*), 1::bigint, 'deleting the copies first releases the source') from removed;
rollback to with_copies;

set local role authenticated;
delete from public.estimate_versions where id = (select id from grandchild);
reset role;
insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
select child.id,auth.uid(),source.tenant_id,now()+interval '30 minutes',gen_random_uuid() from child cross join draft_source source;
set local role authenticated;
select is(public.commit_estimate_batch(v.id, gen_random_uuid(), v.updated_at, lease.session_id,
  (select jsonb_agg(jsonb_build_object('op','delete','id',i.id)) from public.estimate_items i
   where i.version_id=v.id and i.parent_id is null), '[]', '[]',
  '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"gross_ht_cents":0,"discount_applied_cents":0,"commercial_rounding_cents":0}',
  '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}', null)->>'committed', 'true',
  'the editor deletes the copied sections and their measured lines')
from public.estimate_versions v join public.draft_locks lease on lease.version_id=v.id where v.id=(select id from child);
select ok(exists(select 1 from public.takeoff_version_links where target_version_id=(select id from child)),
  'the copy still has its inherited link after removing the lines');
with removed as (
  delete from public.estimate_versions where id = (select id from draft_source) returning id
)
select is(count(*), 1::bigint, 'an inherited link alone does not hold the source') from removed;
rollback to before_copy_delete;
