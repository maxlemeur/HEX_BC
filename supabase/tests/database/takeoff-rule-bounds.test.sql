-- TI-677 (métré L5, suites des revues de L5a et L5b) : bornes et seuil, prérequis de MERGEONE_TAKEOFF_RULES=1
-- (migration 20261104215000_takeoff_rule_bounds_and_serialization.sql). Isolation justifiée : la taille que le
-- serveur mesure avant d'écrire doit être celle que vérifie la contrainte, et le seuil que lit le garde TS celui du
-- trigger ; aucun parcours ne fabrique un résultat de 64 Kio ni un drapeau « 0.70000000000000001 ».
-- Cas écrits avant la migration :
-- - les tailles de jsonb-size.test.ts sont celles de octet_length(jsonb::text) ; un NUL ou un demi-surrogate ne se
--   stocke pas ;
-- - un lot de l'écrivain dont une ligne dépasse 64 Kio échoue en entier : les autres lignes restent périmées ;
-- - le trigger lit le seuil autrement que le TS : une tabulation que le TS rogne, plus de 17 chiffres ;
-- - un override admin dont l'audit porte le seuil lu par le TS est refusé quand le drapeau a plus de 17 chiffres.
-- La table des seuils est celle de guards.test.ts.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

-- Sizes as the server measures them (jsonb-size.test.ts, same JSON) -------------------------------------

select is(octet_length($j${"a": [1, 2.5, "é"], "b": null, "c": true}$j$::jsonb::text), 43, 'separators and a two-byte character');
select is(octet_length($j$["\"\\\n\t\u0001", 1e-7, -1.5e21, "日本", "😀", {}, []]$j$::jsonb::text), 80,
  'escapes, exponents in plain notation, three- and four-byte characters');
select is(octet_length($j${"k\"ey": "v", "ü": 0.001, "z": [true, false, null]}$j$::jsonb::text), 53, 'escaped keys and literals');
select is(octet_length($j$[5e-324, 0, 123.456, 1e21, -0.5]$j$::jsonb::text), 370, 'the smallest double written in full');
select throws_ok($$select '"a\u0000b"'::jsonb$$, '22P05', null, 'a NUL cannot be stored');
select throws_ok($$select '["ok", "\ud800"]'::jsonb$$, '22P02', null, 'a lone surrogate cannot be stored');

-- The low confidence threshold (guards.test.ts, same cases) ----------------------------------------------

select is(public.takeoff_low_confidence_threshold(fixture.raw), fixture.expected,
  format('reads %s as %s', coalesce(to_json(fixture.raw)::text, 'null'), fixture.expected))
from (values
  (null::text, 0.5::numeric), ('', 0.5), ('   ', 0.5), ('0.7', 0.7), (' 0.7 ', 0.7), (chr(9) || '0.7' || chr(10), 0.7),
  (chr(160) || '0.7', 0.7), ('0x1', 0.5), ('0b1', 0.5), ('0.70000000000000001', 0.7001), ('0.123456789012345678901', 0.1235),
  ('7e-1', 0.7), ('7E-1', 0.7), ('1e-400', 0.0001), ('1e-1000', 0.5), ('.5', 0.5), ('1.', 1), ('+0.65', 0.65), ('-0', 0),
  ('-0.00001', 0.5), ('1', 1), ('1.00001', 0.5), ('Infinity', 0.5), ('NaN', 0.5), ('0,7', 0.5), ('1_0', 0.5), ('0.6500', 0.65),
  ('0.00001', 0.0001), ('0.' || repeat('0', 120) || '1', 0.5)
) as fixture(raw, expected);

-- Fixtures -----------------------------------------------------------------------------------------------

create temporary table bounds_outcome (case_name text primary key, outcome text) on commit drop;
grant all on bounds_outcome to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '9f000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'bounds-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9f000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'bounds-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '9f000000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = '9f000000-0000-4000-8000-000000000001' limit 1), true);
update public.tenant_memberships set is_default = false where user_id = '9f000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, '9f000000-0000-4000-8000-000000000002', 'admin', true, '2020-01-01');

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('9f000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  '9f000000-0000-4000-8000-000000000001', 'Bornes des règles (fictif)', false);

insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select fixture.id, current_setting('test.tenant_id')::uuid, '9f000000-0000-4000-8000-000000000010', fixture.number, 'draft', 2, 1, 0
from (values
  ('9f000000-0000-4000-8000-000000000101'::uuid, 1), ('9f000000-0000-4000-8000-000000000102'::uuid, 2),
  ('9f000000-0000-4000-8000-000000000103'::uuid, 3), ('9f000000-0000-4000-8000-000000000104'::uuid, 4),
  ('9f000000-0000-4000-8000-000000000105'::uuid, 5)
) as fixture(id, number);

insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select ('9f000000-0000-4000-8000-0000000002' || right(version.id::text, 2))::uuid, version.tenant_id, version.id, 'section', 0, 'Lot fictif'
from public.estimate_versions version
where version.project_id = '9f000000-0000-4000-8000-000000000010';

-- Jobs (level C): ...301 a 0.7 line, ...302 a 0.6 line, ...303 a 0.7 line overridden by the admin, ...304 a 0.6 line,
-- ...305 the writer's two lines.
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.version_id, 'C', 'completed', 'plan-fictif.pdf',
  '9f000000-0000-4000-8000-000000000001'
from (values
  ('9f000000-0000-4000-8000-000000000301'::uuid, '9f000000-0000-4000-8000-000000000101'::uuid),
  ('9f000000-0000-4000-8000-000000000302'::uuid, '9f000000-0000-4000-8000-000000000102'::uuid),
  ('9f000000-0000-4000-8000-000000000303'::uuid, '9f000000-0000-4000-8000-000000000103'::uuid),
  ('9f000000-0000-4000-8000-000000000304'::uuid, '9f000000-0000-4000-8000-000000000104'::uuid),
  ('9f000000-0000-4000-8000-000000000305'::uuid, '9f000000-0000-4000-8000-000000000105'::uuid)
) as fixture(id, version_id);

insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page,
  rules_stale, created_at)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.job_id, fixture.designation, 5, 'u', fixture.confidence,
  'Repère localisé', 'plan-fictif.pdf', 1, fixture.stale, now() + fixture.rank * interval '1 second'
from (values
  ('9f000000-0000-4000-8000-000000000401'::uuid, '9f000000-0000-4000-8000-000000000301'::uuid, 'Vanne DN 20', 0.7, false, 1),
  ('9f000000-0000-4000-8000-000000000402'::uuid, '9f000000-0000-4000-8000-000000000302'::uuid, 'Vanne DN 20', 0.6, false, 2),
  ('9f000000-0000-4000-8000-000000000403'::uuid, '9f000000-0000-4000-8000-000000000303'::uuid, 'Vanne DN 20', 0.7, false, 3),
  ('9f000000-0000-4000-8000-000000000404'::uuid, '9f000000-0000-4000-8000-000000000304'::uuid, 'Vanne DN 20', 0.6, false, 4),
  ('9f000000-0000-4000-8000-000000000405'::uuid, '9f000000-0000-4000-8000-000000000305'::uuid, 'EF cuivre 20/22', 0.95, true, 5),
  ('9f000000-0000-4000-8000-000000000406'::uuid, '9f000000-0000-4000-8000-000000000305'::uuid, 'EF cuivre 20/22', 0.95, true, 6)
) as fixture(id, job_id, designation, confidence, stale, rank);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id,
  case when version.id = '9f000000-0000-4000-8000-000000000103' then '9f000000-0000-4000-8000-000000000002'::uuid
    else '9f000000-0000-4000-8000-000000000001'::uuid end,
  version.tenant_id, statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version
where version.project_id = '9f000000-0000-4000-8000-000000000010';

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
values (current_setting('test.tenant_id')::uuid, 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD', true, '0.70000000000000001');

create or replace function pg_temp.bounds_plan(p_job_id uuid)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.id, 'source_order', item.source_order, 'rule_id', null, 'action', 'none',
    'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null
  ) order by item.source_order), '[]'::jsonb)
  from (
    select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = p_job_id
  ) as item
$$;
grant execute on function pg_temp.bounds_plan(uuid) to authenticated;

create or replace function pg_temp.bounds_section(p_job_id uuid)
returns uuid
language sql
as $$
  select ('9f000000-0000-4000-8000-0000000002' || right(job.estimate_version_id::text, 2))::uuid
  from public.takeoff_jobs job where job.id = p_job_id
$$;
grant execute on function pg_temp.bounds_section(uuid) to authenticated;

create or replace function pg_temp.bounds_apply(p_case text, p_job_id uuid)
returns text
language plpgsql
as $$
declare
  outcome text := 'ok';
begin
  begin
    perform * from public.apply_takeoff_job_guarded_atomic(p_job_id, 'append', pg_temp.bounds_section(p_job_id), pg_temp.bounds_plan(p_job_id));
  exception when others then
    outcome := sqlstate || ' ' || sqlerrm;
  end;
  insert into bounds_outcome values (p_case, outcome);
  return outcome;
end;
$$;
grant execute on function pg_temp.bounds_apply(text, uuid) to authenticated;

create or replace function pg_temp.bounds_clear()
returns void
language sql
as $$
  drop table if exists pg_temp._takeoff_apply_source;
  drop table if exists pg_temp._takeoff_apply_created_ids;
  drop table if exists pg_temp._takeoff_apply_matches;
  drop table if exists pg_temp._takeoff_apply_unmatched;
  select pg_catalog.set_config('app.takeoff_apply_atomic', '', true);
  select pg_catalog.set_config('app.takeoff_apply_job', '', true);
$$;

-- The threshold the trigger reads is the one the TS guard reads ------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"9f000000-0000-4000-8000-000000000001"}', true);

-- More than 17 digits: TS read 0.7 and passed the 0.7 line, SQL kept every digit and blocked it; both block it now.
select is(pg_temp.bounds_apply('threshold-1', '9f000000-0000-4000-8000-000000000301'), 'ok',
  'TI-681: a confidence threshold cannot require an individual acknowledgement');

-- A tab the flag reader trims (JS trim): TS read 0.7 and blocked the 0.6 line, SQL fell back to 0.5 and applied it.
-- (An application leaves its working tables until commit: cleared as their owner after each case.)
reset role;
select pg_temp.bounds_clear();
update public.feature_flags set value = chr(9) || '0.7' where tenant_id = current_setting('test.tenant_id')::uuid
  and flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD';
set local role authenticated;
select is(pg_temp.bounds_apply('threshold-2', '9f000000-0000-4000-8000-000000000302'), 'ok',
  'TI-681: whitespace-normalized thresholds remain advisory');

-- « 0x1 »: TS read 1 and blocked every unverified line, SQL fell back to 0.5; both read 0.5 now.
reset role;
select pg_temp.bounds_clear();
update public.feature_flags set value = '0x1' where tenant_id = current_setting('test.tenant_id')::uuid
  and flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD';
set local role authenticated;
select is(pg_temp.bounds_apply('threshold-3', '9f000000-0000-4000-8000-000000000304'), 'ok',
  'a hexadecimal threshold falls back to 0.5 on both sides: the 0.6 line is applied');
reset role;
select pg_temp.bounds_clear();

-- An admin override carries the threshold the TS guard read (rounded up to the stored confidences' 1e-4): the trigger
-- must read the same, or the audit never matches.
update public.feature_flags set value = '0.70000000000000001' where tenant_id = current_setting('test.tenant_id')::uuid
  and flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD';
-- TI-681: retain override matching on a provenance protection, not confidence alone.
update public.takeoff_items set evidence=null where id='9f000000-0000-4000-8000-000000000403';
insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
values (current_setting('test.tenant_id')::uuid, '9f000000-0000-4000-8000-000000000002', 'takeoff_jobs',
  '9f000000-0000-4000-8000-000000000303', '9f000000-0000-4000-8000-000000000103', 'takeoff.apply.override',
  jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', '9f000000-0000-4000-8000-000000000303',
    'tenant_id', current_setting('test.tenant_id'), 'user_id', '9f000000-0000-4000-8000-000000000002',
    'metadata', jsonb_build_object('estimate_version_id', '9f000000-0000-4000-8000-000000000103', 'threshold', 0.7001,
      'blocked_item_ids', jsonb_build_array('9f000000-0000-4000-8000-000000000403'), 'blocked_items_count', 1,
      'justification', 'Vérifié sur le plan fictif',
      -- TI-677 (PR D): the lifted line's state, as the route records it (apply-override-state.ts).
      'blocked_items_state', (select jsonb_agg(jsonb_build_object('item_id', ti.id, 'quantity', ti.quantity, 'unit', ti.unit,
        'updated_at', ti.updated_at, 'rule_failures', public.takeoff_rule_failure_keys(ti.rule_results), 'rules_stale', ti.rules_stale,
        'designation', ti.designation, 'evidence', ti.evidence, 'source_page', ti.source_page, 'is_verified', ti.is_verified,
        'quantity_entered_by', ti.quantity_entered_by))
        from public.takeoff_items ti where ti.id = '9f000000-0000-4000-8000-000000000403'))));
set local role authenticated;
select set_config('request.jwt.claim.sub', '9f000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"9f000000-0000-4000-8000-000000000002"}', true);
select is(pg_temp.bounds_apply('threshold-4', '9f000000-0000-4000-8000-000000000303'), 'ok',
  'an admin override whose audit carries the threshold the TS guard read is accepted');
reset role;
select pg_temp.bounds_clear();

-- The writer leaves a line over the bound stale, and writes the others of its chunk ----------------------

set local role service_role;
select is(
  (select coalesce(array_agg(written.item_id order by written.item_id), '{}'::uuid[]) from public.write_takeoff_rule_results(
    current_setting('test.tenant_id')::uuid, '9f000000-0000-4000-8000-000000000105', jsonb_build_array(
      jsonb_build_object('id', '9f000000-0000-4000-8000-000000000405', 'results',
        '[{"rule":"dn_network","status":"pass","code":"DN_NETWORK_COMPATIBLE","version":1,"acceptable":true,"reason":"DN 20 compatible."}]'::jsonb,
        'expected_updated_at', (select updated_at from public.takeoff_items where id = '9f000000-0000-4000-8000-000000000405'),
        'expected_stale_at', (select rules_stale_at from public.takeoff_items where id = '9f000000-0000-4000-8000-000000000405')),
      jsonb_build_object('id', '9f000000-0000-4000-8000-000000000406', 'results', jsonb_build_array(jsonb_build_object(
          'rule', 'zone_overlap', 'status', 'fail', 'code', 'ZONE_OVERLAP_DUPLICATE', 'version', 101, 'acceptable', true,
          'reason', repeat('管', 30000))),
        'expected_updated_at', (select updated_at from public.takeoff_items where id = '9f000000-0000-4000-8000-000000000406'),
        'expected_stale_at', (select rules_stale_at from public.takeoff_items where id = '9f000000-0000-4000-8000-000000000406'))
    ), '[]'::jsonb, null) as written),
  array['9f000000-0000-4000-8000-000000000405'::uuid],
  'a chunk with one line over 64 KiB writes the others');
reset role;
select ok((select not rules_stale and rules_evaluated_at is not null from public.takeoff_items where id = '9f000000-0000-4000-8000-000000000405'),
  'the line within the bound is computed');
select ok((select rules_stale and rules_evaluated_at is null from public.takeoff_items where id = '9f000000-0000-4000-8000-000000000406'),
  'the line over the bound stays stale: it blocks on both sides until a computation fits');

select * from finish();
rollback;
