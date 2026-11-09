-- TI-686 D9: accepting (V) a scale or printed-area failure needs a coded reason and a note, through every path (the
-- review RPC and the Data API), as a network failure already does. Isolation justified: the cases write the column
-- directly as each role, which no journey can, and read the journal the trigger writes in the same transaction.
-- Cases written before the migration (red on main):
-- - V on a scale or printed-area failure is accepted without a reason, or with a reason for another rule;
-- - a printed surface declared on the price line's basis is accepted below the printed value (D17);
-- - a gas PE reason is accepted on a pipe that is no gas PE;
-- - the trigger rewrites the justification on another user's update that keeps V, which the journal then records as
--   that user taking the verification over.
-- The TS side runs the same cases in src/lib/takeoff/rules/verification.test.ts. All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

-- Fixtures -----------------------------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'a6860000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'reasons-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a6860000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'reasons-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = 'a6860000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = 'a6860000-0000-4000-8000-000000000001' limit 1), true);
update public.tenant_memberships set is_default = false where user_id = 'a6860000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, 'a6860000-0000-4000-8000-000000000002', 'admin', true, '2020-01-01');

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('a6860000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  'a6860000-0000-4000-8000-000000000001', 'Motifs d''acceptation (fictif)', false);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
values ('a6860000-0000-4000-8000-000000000101', current_setting('test.tenant_id')::uuid,
  'a6860000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0);
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values ('a6860000-0000-4000-8000-000000000301', current_setting('test.tenant_id')::uuid,
  'a6860000-0000-4000-8000-000000000101', 'A', 'completed', 'plan-fictif.pdf', 'a6860000-0000-4000-8000-000000000001');

-- Results as the server writes them (scale rule version 2, printed area version 3 with the price line's basis).
select set_config('test.scale', '{"rule":"scale_dimension","status":"fail","code":"SCALE_DIMENSION_MISMATCH","version":2,"acceptable":true,"reason":"Fictif.","details":{"scale_reason":"dimension_mismatch"}}', true);
select set_config('test.area', '{"rule":"area_printed","status":"fail","code":"AREA_PRINTED_MISMATCH","version":3,"acceptable":true,"reason":"Fictif.","details":{"printed_m2":20,"measured_m2":19.5,"deviation":-0.025,"expected_basis":"net_floor","quantity_context_key":"c0ffee"}}', true);
select set_config('test.network', '{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION","version":3,"acceptable":true,"reason":"Fictif."}', true);
select set_config('test.duplicate', '{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":101,"acceptable":true,"reason":"Fictif.","details":{"overlap_m":1}}', true);

-- ...401 scale; ...402 and ...403 printed area at 19.5 m² for 20 m² printed; ...404 network and scale; ...405 scale
-- (notes); ...406 network (no gas); ...407 scale and area, never timestamped by a computation (an attestation keeps its
-- results fresh); ...408 a duplicate only; ...409 network, verified before D9 with the flat justification.
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, rule_results, rules_evaluated_at, is_verified, verified_at, verified_by, verification_justification)
select fixture.id, current_setting('test.tenant_id')::uuid, 'a6860000-0000-4000-8000-000000000301', fixture.designation,
  fixture.quantity, fixture.unit, 0.95, 'Repère localisé', 'plan-fictif.pdf', 1, fixture.results,
  case when fixture.evaluated then now() end, fixture.justification is not null,
  case when fixture.justification is not null then now() end,
  case when fixture.justification is not null then 'a6860000-0000-4000-8000-000000000001'::uuid end, fixture.justification
from (values
  ('a6860000-0000-4000-8000-000000000401'::uuid, 'EF cuivre DN 22', 5::numeric, 'ml',
    jsonb_build_array(current_setting('test.scale')::jsonb), true, null::jsonb),
  ('a6860000-0000-4000-8000-000000000402'::uuid, 'Revêtement de sol Bureau', 19.5, 'm2',
    jsonb_build_array(current_setting('test.area')::jsonb), true, null),
  ('a6860000-0000-4000-8000-000000000403'::uuid, 'Revêtement de sol Bureau', 19.5, 'm2',
    jsonb_build_array(current_setting('test.area')::jsonb), true, null),
  ('a6860000-0000-4000-8000-000000000404'::uuid, 'EF PEHD DN 32', 5, 'ml',
    jsonb_build_array(current_setting('test.network')::jsonb, current_setting('test.scale')::jsonb), true, null),
  ('a6860000-0000-4000-8000-000000000405'::uuid, 'EF cuivre DN 28', 5, 'ml',
    jsonb_build_array(current_setting('test.scale')::jsonb), true, null),
  ('a6860000-0000-4000-8000-000000000406'::uuid, 'EF PEHD DN 40', 5, 'ml',
    jsonb_build_array(current_setting('test.network')::jsonb), true, null),
  ('a6860000-0000-4000-8000-000000000407'::uuid, 'Revêtement de sol Hall', 19.5, 'm2',
    jsonb_build_array(current_setting('test.scale')::jsonb, current_setting('test.area')::jsonb), false, null),
  ('a6860000-0000-4000-8000-000000000408'::uuid, 'EF cuivre DN 35', 5, 'ml',
    jsonb_build_array(current_setting('test.duplicate')::jsonb), true, null),
  ('a6860000-0000-4000-8000-000000000409'::uuid, 'EF PEHD DN 50', 5, 'ml',
    jsonb_build_array(current_setting('test.network')::jsonb), true,
    '{"reason_code":"system_documented","system_reference":"Fabricant fictif, gamme G, certificat C"}'::jsonb)
) as fixture(id, designation, quantity, unit, results, evaluated, justification);

create function pg_temp.as_user(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user)::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

-- V by the signed-in user with a justification, as the Data API can write it.
create function pg_temp.accept(p_item uuid, p_justification jsonb)
returns void language sql as $$
  update public.takeoff_items set is_verified = true, verified_by = auth.uid(), verified_at = now(),
    verification_justification = p_justification where id = p_item;
$$;
grant execute on function pg_temp.accept(uuid, jsonb) to authenticated;

-- The same line verified again from scratch: V withdrawn, then given with the justification.
create function pg_temp.reaccept(p_item uuid, p_justification jsonb)
returns void language sql as $$
  update public.takeoff_items set is_verified = false, verified_by = null, verified_at = null where id = p_item;
  update public.takeoff_items set is_verified = true, verified_by = auth.uid(), verified_at = now(),
    verification_justification = p_justification where id = p_item;
$$;
grant execute on function pg_temp.reaccept(uuid, jsonb) to authenticated;

create function pg_temp.scale_reason(p_note text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('scale_dimension', jsonb_build_object('reason_code', 'scale_confirmed_by_other_dimensions', 'note', p_note));
$$;
grant execute on function pg_temp.scale_reason(text) to authenticated;

create function pg_temp.area_reason(p_basis text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('area_printed', jsonb_build_object('reason_code', 'printed_area_basis_identified', 'note',
    'Tableau des surfaces du plan fictif, indice B.') || case when p_basis is null then '{}'::jsonb
      else jsonb_build_object('retained_basis', p_basis) end);
$$;
grant execute on function pg_temp.area_reason(text) to authenticated;

set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000001');

-- Scale -----------------------------------------------------------------------------------------------------

select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000401', null)$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'V on a scale failure needs a reason');
select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000401',
  '{"reason_code":"system_documented","system_reference":"Fabricant fictif, gamme G, certificat C"}')$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'a network reason does not settle a scale failure');
select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000401',
  '{"scale_dimension":{"reason_code":"system_documented","note":"Cotes 5,00 et 3,00 concordantes."}}')$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'a scale reason comes from its own list');
select lives_ok($q$select * from public.update_takeoff_item_for_review(current_setting('test.tenant_id')::uuid,
  'a6860000-0000-4000-8000-000000000301', 'a6860000-0000-4000-8000-000000000401',
  (select updated_at from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000401'),
  jsonb_build_object('is_verified', true, 'verified_by', auth.uid(), 'verified_at', now(),
    'verification_justification', pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.')))$q$,
  'the review RPC accepts a scale failure with its coded reason and note');
reset role;
select is((select verification_justification from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000401'),
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.'), 'the scale reason is stored with the verification');
select is((select count(*)::integer from public.audit_logs log
  where log.record_id = 'a6860000-0000-4000-8000-000000000301'
    and log.user_id = 'a6860000-0000-4000-8000-000000000001'
    and log.after_data #>> '{metadata,item_id}' = 'a6860000-0000-4000-8000-000000000401'
    and log.after_data #>> '{metadata,field}' = 'is_verified'
    and log.after_data #>> '{metadata,justification,scale_dimension,reason_code}' = 'scale_confirmed_by_other_dimensions'
    and log.after_data #> '{metadata,rule_failures}' = '["scale_dimension|SCALE_DIMENSION_MISMATCH|2|"]'::jsonb), 1,
  'the journal records the reason and the acknowledged failure at version 2, in the same transaction');

-- Notes: 10 to 500 code points once the ASCII blanks at both ends are removed (noteText on the TS side).
set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000001');
select throws_ok(format('select pg_temp.accept(%L, pg_temp.scale_reason(%L))', 'a6860000-0000-4000-8000-000000000405', note.text),
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', note.name)
from (values
  ('a note of 9 code points is refused', repeat('x', 9)),
  ('5 emoji (10 UTF-16 units) are refused', repeat('😀', 5)),
  ('a note of 501 code points is refused', repeat('é', 501)),
  ('9 code points between ASCII blanks are refused', E' \t' || repeat('x', 9) || E'\n\r\f\v')
) as note(name, text);
select lives_ok(format('select pg_temp.reaccept(%L, pg_temp.scale_reason(%L))', 'a6860000-0000-4000-8000-000000000405',
  note.text), note.name)
from (values
  ('10 emoji (10 code points) are accepted', repeat('😀', 10)),
  ('a note of 500 code points is accepted', repeat('é', 500)),
  ('a no-break space is no blank: 9 code points after it are accepted', U&'\00A0' || repeat('x', 9))
) as note(name, text);

-- Printed area ----------------------------------------------------------------------------------------------

select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000402', pg_temp.area_reason(null))$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'a printed-area reason states the basis of the printed surface');
select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000402', pg_temp.area_reason('gross_floor'))$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'the basis comes from its own list');
select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000402', pg_temp.area_reason('net_floor'))$q$,
  '23514', 'TAKEOFF_RULE_AREA_QUANTITY_BELOW_PRINTED',
  'the price line''s basis makes both surfaces comparable: 19.5 m² is not accepted for 20 m² printed (D17)');
select lives_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000402', pg_temp.area_reason('shab'))$q$,
  'another basis compares nothing: the quantity stays the line''s');
select is((select array[quantity::text, verification_justification #>> '{area_printed,retained_basis}']
  from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000402'), array['19.500', 'shab'],
  'accepted at 19.5 m² with a SHAB printed surface');

select throws_ok($q$update public.takeoff_items set quantity = 20, is_verified = true, verified_by = auth.uid(),
  verified_at = now(), verification_justification = pg_temp.area_reason('net_floor')
  where id = 'a6860000-0000-4000-8000-000000000403'$q$, '23514', 'TAKEOFF_RULES_STALE',
  'the printed surface is retained before V, never in the same request: a new quantity leaves the rules to compute again');
update public.takeoff_items set quantity = 20 where id = 'a6860000-0000-4000-8000-000000000403';
reset role;
-- The server's computation after the save, which left every line of the version to compute again
-- (stale_takeoff_rule_peers): the results stay the same, the measurement does not move.
update public.takeoff_items set rules_stale = false, rules_stale_at = null, rules_evaluated_at = clock_timestamp()
where job_id = 'a6860000-0000-4000-8000-000000000301' and rules_evaluated_at is not null;
set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000001');
select lives_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000403', pg_temp.area_reason('net_floor'))$q$,
  'the printed surface retained first, the same basis is accepted');
select is((select array[quantity::text, verification_justification #>> '{area_printed,retained_basis}', is_verified::text]
  from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000403'), array['20.000', 'net_floor', 'true'],
  'accepted at the printed 20 m² on the net floor basis');

-- Several failures, unknown keys and the gas PE reasons --------------------------------------------------------

select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000404',
  '{"reason_code":"system_documented","system_reference":"Fabricant fictif, gamme G, certificat C"}')$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'the network reason alone does not settle a scale failure beside it');
select lives_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000404',
  '{"reason_code":"system_documented","system_reference":"Fabricant fictif, gamme G, certificat C"}'::jsonb
    || pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.'))$q$,
  'each failure with its own reason is accepted');
select throws_ok($q$select pg_temp.reaccept('a6860000-0000-4000-8000-000000000405',
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.') || '{"extra":true}')$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'an unknown key is refused');
select throws_ok($q$select pg_temp.reaccept('a6860000-0000-4000-8000-000000000405',
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.') || pg_temp.area_reason('shab'))$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'the reason of a rule the line does not fail is refused when written');
select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000406',
  '{"reason_code":"gas_pe_buried_outside","system_reference":"Fabricant fictif, gamme G, certificat C"}')$q$,
  '23514', 'TAKEOFF_RULE_GAS_PE_REASON_NOT_APPLICABLE', 'a gas PE reason is refused on a pipe that is no gas PE');

-- (guard) A rule V settles without a reason: a reason sent anyway is not stored.
select lives_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000408',
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.'))$q$, 'a duplicate is accepted with a stray reason');
reset role;
select ok((select is_verified and verification_justification is null from public.takeoff_items
  where id = 'a6860000-0000-4000-8000-000000000408'), 'the stray reason is stored null');

-- (guard) A justification written before D9, in its flat form, stays valid when the verifier saves the line again.
set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000001');
select lives_ok($q$update public.takeoff_items set is_verified = true, verified_by = auth.uid(), verified_at = now()
  where id = 'a6860000-0000-4000-8000-000000000409'$q$, 'a verification keeping its flat network justification is accepted');
reset role;
select is((select verification_justification from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000409'),
  '{"reason_code":"system_documented","system_reference":"Fabricant fictif, gamme G, certificat C"}'::jsonb,
  'the flat justification is kept as it was');

-- Another user's update never rewrites the justification; its verifier prunes it ----------------------------------

set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000001');
select lives_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000407',
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.') || pg_temp.area_reason('shab'))$q$,
  'A accepts the scale and the printed area with their reasons');
reset role;
set local role service_role;
update public.takeoff_items set rule_results = jsonb_build_array(
  '{"rule":"scale_dimension","status":"pass","code":"SCALE_DIMENSION_CONSISTENT","version":2,"acceptable":true,"reason":"Fictif."}'::jsonb,
  current_setting('test.area')::jsonb)
where id = 'a6860000-0000-4000-8000-000000000407';
reset role;
select ok((select is_verified from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000407'),
  'a failure that disappears closes by itself: the line stays verified');

set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000002');
select lives_ok($q$update public.takeoff_items set quantity_entered_by = auth.uid(), quantity_entered_at = now(),
  quantity_entry_category = 'site_survey' where id = 'a6860000-0000-4000-8000-000000000407'$q$,
  'B attests the quantity (with its category, TI-686 D12) and keeps the verification');
reset role;
select is((select verification_justification from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000407'),
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes en travée 2.') || pg_temp.area_reason('shab'),
  'B''s update leaves A''s justification as it was, the scale key included');
select is((select count(*)::integer from public.audit_logs log
  where log.user_id = 'a6860000-0000-4000-8000-000000000002'
    and log.after_data #>> '{metadata,item_id}' = 'a6860000-0000-4000-8000-000000000407'
    and log.after_data #>> '{metadata,field}' = 'is_verified'), 0,
  'the journal does not record B as taking the verification over');

set local role authenticated;
select pg_temp.as_user('a6860000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000407',
  pg_temp.scale_reason('Cotes 5,00 et 3,00 concordantes, relues.') || pg_temp.area_reason('shab'))$q$,
  '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED', 'A writing the justification again cannot keep the reason of a rule that passes');
select lives_ok($q$select pg_temp.accept('a6860000-0000-4000-8000-000000000407', pg_temp.area_reason('shab'))$q$,
  'A writes it again without the scale reason');
reset role;
select is((select verification_justification from public.takeoff_items where id = 'a6860000-0000-4000-8000-000000000407'),
  pg_temp.area_reason('shab'), 'the scale key is pruned by its verifier');

-- Boundary -------------------------------------------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'public.validate_takeoff_rule_acceptance()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.validate_takeoff_rule_acceptance()', 'EXECUTE'),
  'the trigger function stays out of the API');

select * from finish();
rollback;
