-- TI-682 (D12, Q2, Q4; migration …_estimate_line_offer_treatments.sql): the internal reason of an exclusion and the
-- reserve written in the offer, stored on the line under source_metadata.offer_treatment by one writer.
-- Isolation justified: the writer is granted to authenticated and reachable through the Data API, whatever the
-- server route checks first; its refusals (a reserve the offer text does not hold, a decision that does not fit the
-- status, a stale read, a draft lock not held by this session, an author named by the caller, a colleague who may
-- not write the estimate, another tenant, a version already sent) are the database's own guarantees.
-- Written before the migration (red on 613e850: the function does not exist). All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'd6820000-0000-4000-8000-000000000001', 'authenticated',
    'authenticated', 'offer-treatment-owner@example.test', crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd6820000-0000-4000-8000-000000000002', 'authenticated',
    'authenticated', 'offer-treatment-stranger@example.test', crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd6820000-0000-4000-8000-000000000003', 'authenticated',
    'authenticated', 'offer-treatment-viewer@example.test', crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd6820000-0000-4000-8000-000000000004', 'authenticated',
    'authenticated', 'offer-treatment-colleague@example.test', crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id in ('d6820000-0000-4000-8000-000000000001', 'd6820000-0000-4000-8000-000000000002');

create temporary table ot_fx on commit drop as
select membership.tenant_id
from public.tenant_memberships membership
where membership.user_id = 'd6820000-0000-4000-8000-000000000001';
grant select on ot_fx to authenticated, service_role;

-- Two colleagues of the owner's tenant: a viewer, and an engineer who does not own the affaire.
update public.tenant_memberships set is_default = false
where user_id in ('d6820000-0000-4000-8000-000000000003', 'd6820000-0000-4000-8000-000000000004');
insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select fixture.id, ot_fx.tenant_id, fixture.user_id, fixture.role, true
from ot_fx, (values
  ('d6820000-0000-4000-8000-000000000033'::uuid, 'd6820000-0000-4000-8000-000000000003'::uuid, 'viewer'::public.tenant_role),
  ('d6820000-0000-4000-8000-000000000034'::uuid, 'd6820000-0000-4000-8000-000000000004'::uuid, 'engineer'::public.tenant_role)
) as fixture(id, user_id, role);

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd6820000-0000-4000-8000-000000000010', tenant_id, 'd6820000-0000-4000-8000-000000000001',
  'Projet réserve dans l''offre', false
from ot_fx;

insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position)
select 'd6820000-0000-4000-8000-000000000020', tenant_id, 'd6820000-0000-4000-8000-000000000001',
  'Tuyauteur', 4000, true, 1
from ot_fx;

-- An engine 3 draft: a priced line (1 u, PR 1 000, FO provision 1,010, c_FO 1,30 → 1 313), a « Non chiffrée » line
-- and a « Hors lot » line, both with their entries kept and no amount.
set local role service_role;
select public.set_tenant_calc_policy(
  p_tenant_id => (select tenant_id from ot_fx), p_new_estimate_calc_engine => 3::smallint,
  p_default_sale_coefficient_fo => 1.30, p_default_sale_coefficient_mo => 1.20,
  p_allowed_tax_rates_bp => null, p_change_reason => 'Pilote réserve dans l''offre',
  p_actor_user_id => 'd6820000-0000-4000-8000-000000000001'::uuid);
select public.persist_estimate_creation_atomic(
  (select tenant_id from ot_fx), 'd6820000-0000-4000-8000-000000000001'::uuid,
  'd6820000-0000-4000-8000-000000000010'::uuid, null,
  '{"id":"d6820000-0000-4000-8000-000000000100","title":"Réserve","date_devis":"2026-11-11","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_amount_cents":null,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"contractor_role":"principal","calc_engine_version":3,"sale_coefficient_fo":1.30,"sale_coefficient_mo":1.20,"gross_ht_cents":1313,"discount_applied_cents":0,"commercial_rounding_cents":0,"total_ht_cents":1313,"total_tax_cents":263,"total_ttc_cents":1576}'::jsonb,
  jsonb_build_array(
    '{"id":"d6820000-0000-4000-8001-000000000100","parent_id":null,"item_type":"section","position":1,"title":"Lot"}'::jsonb,
    '{"id":"d6820000-0000-4000-8001-000000000101","parent_id":"d6820000-0000-4000-8001-000000000100","item_type":"line","position":1,"title":"Réseau EU","quantity":1,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"k_fo":1,"h_mo_majoration":1,"k_mo":1,"h_mo_per_unit":0,"unit_code":"u","pricing_status":"priced","pu_ht_cents":1313,"line_total_ht_cents":1313,"line_tax_cents":263,"line_total_ttc_cents":1576}'::jsonb,
    '{"id":"d6820000-0000-4000-8001-000000000102","parent_id":"d6820000-0000-4000-8001-000000000100","item_type":"line","position":2,"title":"Calorifuge","quantity":3,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"k_fo":1,"h_mo_majoration":1,"k_mo":1,"h_mo_per_unit":2,"labor_role_id":"d6820000-0000-4000-8000-000000000020","unit_code":"u","pricing_status":"not_priced","pu_ht_cents":null,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb,
    '{"id":"d6820000-0000-4000-8001-000000000103","parent_id":"d6820000-0000-4000-8001-000000000100","item_type":"line","position":3,"title":"Percements","quantity":3,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"k_fo":1,"h_mo_majoration":1,"k_mo":1,"h_mo_per_unit":2,"labor_role_id":"d6820000-0000-4000-8000-000000000020","unit_code":"u","pricing_status":"out_of_scope","pu_ht_cents":null,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb
  ), null);
reset role;

update public.estimate_versions set exclusions = 'Hors peinture.'
where id = 'd6820000-0000-4000-8000-000000000100';
-- A provenance key the writer must keep.
set local miaouffrage.estimate_v3_writer = 'd6820000-0000-4000-8000-000000000100';
update public.estimate_items set source_metadata = '{"takeoff_provision":{"version":1,"job_id":"j","sources":[]}}'::jsonb
where id = 'd6820000-0000-4000-8001-000000000102';
set local miaouffrage.estimate_v3_writer = '';

-- The owner edits the draft in one session of the editor: its draft lock.
insert into public.draft_locks (id, version_id, user_id, tenant_id, locked_at, expires_at, session_id)
select 'd6820000-0000-4000-8000-0000000000a0', 'd6820000-0000-4000-8000-000000000100',
  'd6820000-0000-4000-8000-000000000001', tenant_id, statement_timestamp(),
  statement_timestamp() + interval '30 minutes', 'd6820000-0000-4000-8000-0000000000a1'
from ot_fx;

-- Calls the writer as the current role and answers 'ok' or the refusal; a refused call leaves nothing behind.
create function pg_temp.ot_set(p_treatments jsonb, p_exclusions text, p_revision bigint default null,
  p_version_id uuid default 'd6820000-0000-4000-8000-000000000100',
  p_session uuid default 'd6820000-0000-4000-8000-0000000000a1')
returns text
language plpgsql
as $probe$
declare
  revision bigint := p_revision;
begin
  if revision is null then
    select version.content_revision into revision from public.estimate_versions version where version.id = p_version_id;
  end if;
  begin
    perform public.set_estimate_line_offer_treatments(p_version_id, coalesce(revision, 1), p_session, p_treatments, p_exclusions);
    return 'ok';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

create function pg_temp.ot_reserve(p_item text, p_title text, p_text text, p_basis text default 'private_estimate')
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'treatment', jsonb_build_object(
    'kind', 'offer_reserve', 'basis', p_basis, 'text', p_text,
    'sentence', 'Réserve — « ' || p_title || ' » : ' || p_text)))
$$;

create function pg_temp.ot_exclusion(p_item text, p_reason text, p_note text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'treatment', jsonb_build_object(
    'kind', 'internal_exclusion', 'reason_code', p_reason, 'note', p_note)))
$$;

create temporary table ot_before on commit drop as
select version.content_revision, version.total_ht_cents, version.gross_ht_cents,
  (select jsonb_agg(to_jsonb(item) - array['source_metadata', 'updated_at'] order by item.id)
    from public.estimate_items item where item.version_id = version.id) as items
from public.estimate_versions version where version.id = 'd6820000-0000-4000-8000-000000000100';
grant select on ot_before to authenticated;

select is(has_function_privilege('anon', 'public.set_estimate_line_offer_treatments(uuid, bigint, uuid, jsonb, text)', 'execute'),
  false, 'anon cannot call the writer');
select is(has_function_privilege('authenticated', 'public.set_estimate_line_offer_treatments(uuid, bigint, uuid, jsonb, text)', 'execute'),
  true, 'authenticated can call the writer, under its row-level policies');

select set_config('request.jwt.claim.sub', 'd6820000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'd6820000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Refusals: nothing is written ------------------------------------------------------------------------------

select is(pg_temp.ot_set(pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000102', 'Calorifuge', 'non chiffré, à définir sur relevé.'),
  'Hors peinture.'), '22023 ESTIMATE_OFFER_RESERVE_NOT_WRITTEN',
  'a reserve whose sentence the offer text does not hold is refused');
select is(pg_temp.ot_set(pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000102', 'Calorifuge', 'non chiffré, à définir sur relevé.'),
  'Nota : Réserve — « Calorifuge » : non chiffré, à définir sur relevé. Voir CCTP.'), '22023 ESTIMATE_OFFER_RESERVE_NOT_WRITTEN',
  'a sentence buried in a paragraph is not written: it stands alone on its line');
select is(pg_temp.ot_set(pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000102', 'Calorifuge', 'non chiffré.', 'public_tender'),
  'Réserve — « Calorifuge » : non chiffré.'), '22023 ESTIMATE_OFFER_TREATMENT_INVALID',
  'a reserve states one of the two bases that allow it');
select is(pg_temp.ot_set(jsonb_build_array(jsonb_build_object('item_id', 'd6820000-0000-4000-8001-000000000102',
  'treatment', jsonb_build_object('kind', 'offer_reserve', 'text', 'non chiffré.', 'sentence', 'Réserve — « Calorifuge » : non chiffré.'))),
  'Réserve — « Calorifuge » : non chiffré.'), '22023 ESTIMATE_OFFER_TREATMENT_INVALID',
  'a reserve without a basis is refused');
select is(pg_temp.ot_set(jsonb_build_array(jsonb_build_object('item_id', 'd6820000-0000-4000-8001-000000000102',
  'treatment', jsonb_build_object('kind', 'offer_reserve', 'basis', 'private_estimate', 'text', 'non chiffré.',
    'sentence', 'Calorifuge : autre texte.'))),
  'Calorifuge : autre texte.'), '22023 ESTIMATE_OFFER_TREATMENT_INVALID',
  'the sentence is the reserve sentence of the text, not any line of the offer');
select is(pg_temp.ot_set(jsonb_build_array(jsonb_build_object('item_id', 'd6820000-0000-4000-8001-000000000102',
  'treatment', jsonb_build_object('kind', 'offer_reserve', 'basis', 'private_estimate', 'text', 'non chiffré.',
    'sentence', 'Réserve — « Calorifuge » : non chiffré.', 'decided_by', 'd6820000-0000-4000-8000-000000000002'))),
  'Réserve — « Calorifuge » : non chiffré.'), '22023 ESTIMATE_OFFER_TREATMENT_INVALID',
  'the caller cannot name the author of a decision');
select is(pg_temp.ot_set(pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000102', 'Calorifuge', E'ligne 1\nligne 2'),
  E'Réserve — « Calorifuge » : ligne 1\nligne 2'), '22023 ESTIMATE_OFFER_TREATMENT_INVALID',
  'a reserve text is one line');
select is(pg_temp.ot_set(pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000103', 'Percements', 'non chiffré.'),
  'Réserve — « Percements » : non chiffré.'), '22023 ESTIMATE_OFFER_TREATMENT_LINE_MISMATCH',
  'a reserve does not fit a « Hors lot » line');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000101', 'other_lot'), 'Hors peinture.'),
  '22023 ESTIMATE_OFFER_TREATMENT_LINE_MISMATCH', 'an exclusion reason does not fit a priced line');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000100', 'other_lot'), 'Hors peinture.'),
  '22023 ESTIMATE_OFFER_TREATMENT_LINE_MISMATCH', 'a section carries no decision');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'because'), 'Hors peinture.'),
  '22023 ESTIMATE_OFFER_TREATMENT_INVALID', 'an unknown reason is refused');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other'), 'Hors peinture.'),
  '22023 ESTIMATE_OFFER_TREATMENT_INVALID', '« Autre motif » needs its note');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot')
  || pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'not_applicable'), 'Hors peinture.'),
  '22023 ESTIMATE_OFFER_TREATMENT_INVALID', 'a line is named once per call');
select is(pg_temp.ot_set('[]'::jsonb, 'Hors peinture.'), '22023 ESTIMATE_OFFER_TREATMENT_INVALID', 'an empty call is refused');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), repeat('x', 5001)),
  '22023 ESTIMATE_OFFER_TREATMENT_INVALID', 'the offer text keeps its 5 000 characters ceiling');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), 'Hors peinture.',
  (select content_revision - 1 from ot_before)), '40001 ESTIMATE_OFFER_TREATMENT_STALE',
  'a caller that read an earlier revision is refused');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), 'Hors peinture.',
  1, 'd6820000-0000-4000-8000-0000000009ff'), 'P0002 ESTIMATE_OFFER_TREATMENT_NOT_FOUND', 'an unknown version is not found');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), 'Hors peinture.',
  null, 'd6820000-0000-4000-8000-000000000100', 'd6820000-0000-4000-8000-0000000000a2'),
  '55000 ESTIMATE_OFFER_TREATMENT_LOCK_REQUIRED', 'another session of the owner does not write under this session''s lock');
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), 'Hors peinture.',
  null, 'd6820000-0000-4000-8000-000000000100', null),
  '55000 ESTIMATE_OFFER_TREATMENT_LOCK_REQUIRED', 'a call that names no lock session is refused');

select is((select version.content_revision from public.estimate_versions version
  where version.id = 'd6820000-0000-4000-8000-000000000100'), (select content_revision from ot_before),
  'refused calls wrote nothing: the content revision did not move');

-- The reserve of a « Non chiffrée » line, written with the offer text ----------------------------------------

select is(pg_temp.ot_set(pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000102', 'Calorifuge', 'non chiffré, à définir sur relevé.'),
  E'Hors peinture.\n\nRéserve — « Calorifuge » : non chiffré, à définir sur relevé.'), 'ok',
  'the owner writes a reserve whose sentence the offer text holds');
select is(coalesce(current_setting('miaouffrage.estimate_v3_writer', true), ''), '',
  'the writer contract is restored once the call returns');
select is((select (item.source_metadata -> 'offer_treatment') - 'decided_at'::text from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000102'),
  '{"version":1,"kind":"offer_reserve","basis":"private_estimate","text":"non chiffré, à définir sur relevé.","sentence":"Réserve — « Calorifuge » : non chiffré, à définir sur relevé.","decided_by":"d6820000-0000-4000-8000-000000000001"}'::jsonb,
  'the line carries the reserve, its basis, its sentence and the caller as author');
select ok((select item.source_metadata #>> '{offer_treatment,decided_at}' from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000102') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$',
  'the instant of the decision is the database''s, in UTC');
select is((select item.source_metadata -> 'takeoff_provision' from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000102'), '{"version":1,"job_id":"j","sources":[]}'::jsonb,
  'the other provenance keys of the line are kept');
select is((select version.exclusions from public.estimate_versions version
  where version.id = 'd6820000-0000-4000-8000-000000000100'),
  E'Hors peinture.\n\nRéserve — « Calorifuge » : non chiffré, à définir sur relevé.',
  'the offer text is saved in the same call');
select ok((select version.content_revision from public.estimate_versions version
  where version.id = 'd6820000-0000-4000-8000-000000000100') > (select content_revision from ot_before),
  'the content revision moved: an earlier freeze or PDF is stale');
select is((select jsonb_agg(to_jsonb(item) - array['source_metadata', 'updated_at'] order by item.id)
  from public.estimate_items item where item.version_id = 'd6820000-0000-4000-8000-000000000100'),
  (select items from ot_before), 'no amount, status or entry of any line changed');
select is((select array[version.total_ht_cents, version.gross_ht_cents] from public.estimate_versions version
  where version.id = 'd6820000-0000-4000-8000-000000000100'),
  (select array[total_ht_cents, gross_ht_cents] from ot_before), 'the totals of the version did not change');

-- The internal reason of an exclusion, and a provisional quantity on a priced line -----------------------------

select is(pg_temp.ot_set(
  pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other', 'Voir CCTP 3.2')
    || pg_temp.ot_reserve('d6820000-0000-4000-8001-000000000101', 'Réseau EU', 'quantité provisionnelle.'),
  E'Hors peinture.\n\nRéserve — « Calorifuge » : non chiffré, à définir sur relevé.\nRéserve — « Réseau EU » : quantité provisionnelle.'),
  'ok', 'several decisions are written in one call');
select is((select (item.source_metadata -> 'offer_treatment') - 'decided_at'::text from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000103'),
  '{"version":1,"kind":"internal_exclusion","reason_code":"other","note":"Voir CCTP 3.2","decided_by":"d6820000-0000-4000-8000-000000000001"}'::jsonb,
  'the « Hors lot » line carries its internal reason');
select is((select item.source_metadata #>> '{offer_treatment,kind}' from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000101'), 'offer_reserve',
  'the priced line carries its provisional quantity reserve');

-- Withdrawing a decision --------------------------------------------------------------------------------------

select is(pg_temp.ot_set(jsonb_build_array(jsonb_build_object('item_id', 'd6820000-0000-4000-8001-000000000102', 'treatment', null)),
  E'Hors peinture.\n\nRéserve — « Réseau EU » : quantité provisionnelle.'), 'ok', 'a decision is withdrawn with a null treatment');
select is((select item.source_metadata from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000102'), '{"takeoff_provision":{"version":1,"job_id":"j","sources":[]}}'::jsonb,
  'only the decision key is removed');
select is(pg_temp.ot_set(jsonb_build_array(jsonb_build_object('item_id', 'd6820000-0000-4000-8001-000000000101', 'treatment', null)),
  null), 'ok', 'the last reserve leaves and the offer text can be emptied');
select is((select version.exclusions from public.estimate_versions version
  where version.id = 'd6820000-0000-4000-8000-000000000100'), null, 'an empty offer text is stored as null');

-- An expired lock, colleagues who may not write, another tenant, a version already sent ------------------------

reset role;
update public.draft_locks set expires_at = statement_timestamp() - interval '1 second'
where id = 'd6820000-0000-4000-8000-0000000000a0';
set local role authenticated;
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), null),
  '55000 ESTIMATE_OFFER_TREATMENT_LOCK_REQUIRED', 'an expired draft lock does not allow the write');
reset role;
update public.draft_locks set expires_at = statement_timestamp() + interval '30 minutes'
where id = 'd6820000-0000-4000-8000-0000000000a0';

select set_config('request.jwt.claim.sub', 'd6820000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'd6820000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
-- The row-level policies answer for them: the version is not theirs to lock for a write.
select matches(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), null),
  '^(P0002 ESTIMATE_OFFER_TREATMENT_NOT_FOUND|42501 ESTIMATE_OFFER_TREATMENT_FORBIDDEN)$', 'a viewer of the tenant cannot write a decision');
reset role;
select set_config('request.jwt.claim.sub', 'd6820000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'd6820000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select matches(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), null),
  '^(P0002 ESTIMATE_OFFER_TREATMENT_NOT_FOUND|42501 ESTIMATE_OFFER_TREATMENT_FORBIDDEN)$', 'an engineer who does not own the affaire cannot write a decision either');

reset role;
select set_config('request.jwt.claim.sub', 'd6820000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'd6820000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), null, 1),
  'P0002 ESTIMATE_OFFER_TREATMENT_NOT_FOUND', 'an engineer of another tenant does not find the version');
reset role;

select is((select item.source_metadata #>> '{offer_treatment,reason_code}' from public.estimate_items item
  where item.id = 'd6820000-0000-4000-8001-000000000103'), 'other', 'and the line keeps the reason its owner wrote');

-- A version on engine 2, then a sent version (engine and status set past their guards).
set local session_replication_role = replica;
update public.estimate_versions set calc_engine_version = 2, sale_coefficient_fo = null, sale_coefficient_mo = null,
  gross_ht_cents = null, discount_applied_cents = null, commercial_rounding_cents = null
where id = 'd6820000-0000-4000-8000-000000000100';
set local session_replication_role = origin;
select set_config('request.jwt.claim.sub', 'd6820000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'd6820000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), null),
  '0A000 ESTIMATE_OFFER_TREATMENT_ENGINE_NOT_SUPPORTED', 'the owner writes no decision on an engine 2 version');
reset role;
set local session_replication_role = replica;
update public.estimate_versions set calc_engine_version = 3, sale_coefficient_fo = 1.30, sale_coefficient_mo = 1.20,
  gross_ht_cents = 1313, discount_applied_cents = 0, commercial_rounding_cents = 0, status = 'sent'
where id = 'd6820000-0000-4000-8000-000000000100';
set local session_replication_role = origin;
set local role authenticated;
select matches(pg_temp.ot_set(pg_temp.ot_exclusion('d6820000-0000-4000-8001-000000000103', 'other_lot'), null),
  '^(55000 ESTIMATE_OFFER_TREATMENT_READ_ONLY|P0002 ESTIMATE_OFFER_TREATMENT_NOT_FOUND)$',
  'the owner no longer writes a decision on a sent version');
reset role;

select * from finish();
rollback;
