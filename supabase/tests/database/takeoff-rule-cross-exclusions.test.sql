-- TI-677 (métré L5, PR B) : une règle croisée en échec ne bloque plus une ligne dont tous les partenaires sont
-- laissés de côté (Codex #160, fil 4467409538 ; migration 20261104224500_takeoff_rule_cross_exclusions.sql).
-- Isolation justifiée : le décompte du trigger doit rester celui du garde TS (guards.test.ts), y compris pour un
-- client Data API qui appelle la RPC d'application avec son propre plan.
-- Cas écrits avant la migration :
-- - un doublon dont l'unique partenaire est exclu bloque encore (le plan de mapping saute le partenaire : la RPC
--   l'exclut, puis le trigger compte le résultat stocké de la ligne retenue) ;
-- - une pièce dont toutes les pièces recouvertes sont exclues bloque encore ;
-- - en sens inverse, jamais levés : un partenaire inclus, une liste coupée (compte stocké plus grand), un partenaire
--   introuvable, des zones non recalées, un résultat sans compte (calculé avant cette version).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values ('00000000-0000-0000-0000-000000000000', '9f200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'cross-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '9f200000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = '9f200000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('9f200000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  '9f200000-0000-4000-8000-000000000001', 'Règles croisées (fictif)', false);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
values ('9f200000-0000-4000-8000-000000000101', current_setting('test.tenant_id')::uuid, '9f200000-0000-4000-8000-000000000010', 1,
  'draft', 2, 1, 0);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values ('9f200000-0000-4000-8000-000000000201', current_setting('test.tenant_id')::uuid, '9f200000-0000-4000-8000-000000000101',
  'section', 0, 'Lot fictif');
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values ('9f200000-0000-4000-8000-000000000301', current_setting('test.tenant_id')::uuid, '9f200000-0000-4000-8000-000000000101',
  'B', 'completed', 'plan-fictif.pdf', '9f200000-0000-4000-8000-000000000001');
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values ('9f200000-0000-4000-8000-000000000101', '9f200000-0000-4000-8000-000000000001', current_setting('test.tenant_id')::uuid,
  statement_timestamp() + interval '30 minutes', gen_random_uuid());

-- A duplicate of `partners`, `count` partners in all; a room overlapping `ids`, `count` rooms in all.
create or replace function pg_temp.duplicate_of(p_partners uuid[], p_count integer)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object('rule', 'zone_overlap', 'status', 'fail', 'code', 'ZONE_OVERLAP_DUPLICATE',
    'version', 101, 'acceptable', true, 'reason', 'Tronçon compté aussi en Z2.',
    'details', jsonb_build_object('partner_count', p_count, 'overlap_m', 1, 'partners', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', partner, 'job_id', '9f200000-0000-4000-8000-000000000301', 'zone', 'Z2',
        'designation', 'EF cuivre 20/22', 'overlap_m', 1, 'resolved', false)) from unnest(p_partners) as partner), '[]'::jsonb))))
$$;
create or replace function pg_temp.rooms_of(p_ids uuid[], p_count integer)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object('rule', 'room_overlap', 'status', 'fail', 'code', 'ROOM_OVERLAP', 'version', 1,
    'acceptable', true, 'reason', 'Ce contour recouvre une autre pièce.',
    'details', jsonb_build_object('overlapping_item_ids', to_jsonb(p_ids), 'overlap_count', p_count, 'overlap_m2', 2)))
$$;

-- Lines: ...401 retained and ...402 its duplicate (the plan skips it); ...403 excluded, ...404 included (partners only).
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page,
  is_excluded, exclusion_reason, rule_results, rules_evaluated_at, created_at)
select fixture.id, current_setting('test.tenant_id')::uuid, '9f200000-0000-4000-8000-000000000301', 'EF cuivre 20/22', 4, 'ml', 0.95,
  'Repère localisé', 'plan-fictif.pdf', 1, fixture.excluded, case when fixture.excluded then 'Hors lot (fictif)' end, fixture.results,
  now(), now() + fixture.rank * interval '1 second'
from (values
  ('9f200000-0000-4000-8000-000000000401'::uuid, false, pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000402'::uuid], 1), 1),
  ('9f200000-0000-4000-8000-000000000402'::uuid, false, pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000401'::uuid], 1), 2),
  ('9f200000-0000-4000-8000-000000000403'::uuid, true, '[]'::jsonb, 3),
  ('9f200000-0000-4000-8000-000000000404'::uuid, false, '[]'::jsonb, 4)
) as fixture(id, excluded, results, rank);

-- The shared predicate -------------------------------------------------------------------------------

select ok(not public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1), false, false),
  'a duplicate whose only partner is excluded no longer blocks');
select ok(not public.takeoff_item_rule_blocked(pg_temp.rooms_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1), false, false),
  'a room whose only overlapping room is excluded no longer blocks');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000404'::uuid], 1), false, false),
  'a duplicate whose partner is included blocks');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid,
  '9f200000-0000-4000-8000-000000000404'::uuid], 2), false, false), 'a duplicate blocks while one of its partners is included');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 2), false, false),
  'a duplicate whose partner list was cut blocks');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-0000000004ff'::uuid], 1), false, false),
  'a duplicate whose partner no longer exists blocks');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid,
  '9f200000-0000-4000-8000-000000000403'::uuid], 2), false, false), 'a partner listed twice never stands for two');
-- Review of PR B: the TS guard reads a count of 1.0 as 1 and an id whatever its case; so does the trigger.
select ok(not public.takeoff_item_rule_blocked(jsonb_set(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1),
  '{0,details,partner_count}', '1.0'::jsonb), false, false), 'a count written 1.0 is one partner');
select ok(not public.takeoff_item_rule_blocked(jsonb_set(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1),
  '{0,details,partners,0,item_id}', to_jsonb(upper('9f200000-0000-4000-8000-000000000403'))), false, false), 'an id in capitals is the same line');
select ok(public.takeoff_item_rule_blocked(jsonb_set(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid,
  '9f200000-0000-4000-8000-000000000403'::uuid], 2), '{0,details,partners,0,item_id}', to_jsonb(upper('9f200000-0000-4000-8000-000000000403'))),
  false, false), 'one line named in two cases never stands for two partners');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1) #- '{0,details,partner_count}',
  false, false), 'a duplicate computed without its partner count blocks');
select ok(public.takeoff_item_rule_blocked(jsonb_set(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1),
  '{0,code}', '"ZONE_OVERLAP_UNREGISTERED"'), false, false), 'zones never registered block, whatever their lines');
select ok(public.takeoff_item_rule_blocked(pg_temp.duplicate_of(array['9f200000-0000-4000-8000-000000000403'::uuid], 1), true, false),
  'stale results block even when every partner is excluded');

-- The application: the plan skips the duplicate of the retained line -----------------------------------

create or replace function pg_temp.cross_apply(p_skip uuid)
returns text
language plpgsql
as $$
declare
  outcome text := 'ok';
begin
  begin
    perform * from public.apply_takeoff_job_guarded_atomic('9f200000-0000-4000-8000-000000000301', 'append',
      '9f200000-0000-4000-8000-000000000201', (
        select jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', item.source_order, 'rule_id', null,
          'action', case when item.id = p_skip then 'skip' else 'none' end, 'designation', btrim(item.designation),
          'unit_price_cents', null, 'category_id', null, 'assembly_id', null) order by item.source_order)
        from (select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
          from public.takeoff_items ti where ti.job_id = '9f200000-0000-4000-8000-000000000301') as item));
  exception when others then
    outcome := sqlstate || ' ' || sqlerrm;
  end;
  return outcome;
end;
$$;
grant execute on function pg_temp.cross_apply(uuid) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '9f200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"9f200000-0000-4000-8000-000000000001"}', true);

select is(pg_temp.cross_apply(null), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'both lines of a duplicate block when the plan keeps both');
select is(pg_temp.cross_apply('9f200000-0000-4000-8000-000000000402'), 'ok', 'the retained line is applied once the plan skips its duplicate');
reset role;
select is((select status::text from public.takeoff_jobs where id = '9f200000-0000-4000-8000-000000000301'), 'applied', 'the job is applied');
select is((select array_agg(id::text || ':' || is_excluded::text order by id) from public.takeoff_items
  where id in ('9f200000-0000-4000-8000-000000000401', '9f200000-0000-4000-8000-000000000402')),
  array['9f200000-0000-4000-8000-000000000401:false', '9f200000-0000-4000-8000-000000000402:true'],
  'the skipped duplicate is left out, the retained line applied');

select * from finish();
rollback;
