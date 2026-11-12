-- TI-682, lot C, PR 5 : la quantité provisionnelle. Un administrateur déclare qu'une ligne chiffrée dont la quantité
-- repose sur une hypothèse du métré part avec une quantité provisionnelle : ce sur quoi elle est établie, ce qui la
-- confirmera. Le client lit la phrase dans « Précisions et limites de prestation » ; la ligne reste une ligne chiffrée.
-- Règles de la migration *_estimate_line_provisional_quantity.sql :
-- - public.estimate_offer_choice_valid admet le kind « provisional_quantity » sur une ligne « priced » (la réserve de la
--   PR 4 inchangée) ; « établie sur » et « à confirmer selon » tiennent sur une ligne, de 3 à 160 caractères ;
-- - public.estimate_item_takeoff_hypothesis, jumelle SQL de readTakeoffProvision (kind « hypothesis ») ;
-- - public.set_estimate_line_offer_choice le refuse sur une ligne sans marqueur d'hypothèse ;
-- - private.clear_estimate_item_offer_choice l'efface quand la ligne quitte « priced » ou perd son marqueur, et refuse
--   tout autre écrivain qui le poserait sans marqueur ou hors moteur 3 ; aucune insertion ne le porte.
-- Le contrôle d'envoi (provisional_quantity_mention_missing) est en TypeScript : src/lib/estimates/gating.test.ts.
-- Isolation : la validation, la déclaration, le déclencheur et la duplication ne s'observent pas depuis un parcours.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Sonde : exécute les instructions puis l'action, et annule toujours ses écritures.
create function pg_temp.pq_probe(p_statements text[], p_action text default null)
returns text
language plpgsql
as $probe$
declare
  probe_statement text;
  action_result text;
begin
  begin
    foreach probe_statement in array coalesce(p_statements, '{}'::text[]) loop
      execute probe_statement;
    end loop;
    if p_action is not null then
      execute p_action into action_result;
    end if;
    raise exception using errcode = 'P0001', message = 'PQ_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'PQ_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

-- Un choix stocké : la base, la note, ce sur quoi la quantité est établie, ce qui la confirmera, l'auteur et l'heure.
create function pg_temp.pq_stored(p_patch jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('kind', 'provisional_quantity', 'basis', 'private_estimate', 'note', null,
    'established_on', 'le plan CVC indice B', 'to_confirm_by', 'le relevé contradictoire sur site',
    'decided_by', '68500000-0000-4000-8000-000000000001', 'decided_at', '2026-11-12T09:00:00.123456+00:00') || p_patch
$$;

create function pg_temp.pq_reserve_stored(p_patch jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('kind', 'reserve', 'basis', 'private_estimate', 'code', 'pending_survey', 'note', null,
    'decided_by', '68500000-0000-4000-8000-000000000001', 'decided_at', '2026-11-12T09:00:00Z') || p_patch
$$;

-- ---------------------------------------------------------------------------
-- Forme et statut.
-- ---------------------------------------------------------------------------
select is(
  array[
    public.estimate_offer_choice_valid(pg_temp.pq_stored(), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"basis":"indicative_quantities","note":"RC article 5.2"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', repeat('é', 160),
      'to_confirm_by', 'abc')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"note":"Relevé prévu en semaine 48"}'), 'priced'),
    -- refused
    public.estimate_offer_choice_valid(pg_temp.pq_stored(), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(), 'included'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"code":"pending_survey"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored() - 'to_confirm_by', 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored() - 'established_on', 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"established_on":null}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"to_confirm_by":12}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"basis":"indicative_quantities"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"basis":"public_lump_sum"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"established_on":"ab"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', repeat('é', 161))), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', E'le plan\nCVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', E'le plan\rCVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', E'le plan\tCVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', 'le plan  CVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', ' le plan CVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('to_confirm_by', 'le relevé ')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', U&'le plan\00A0CVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', U&'le plan\200BCVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', U&'le plan \202ECVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', U&'le plan \2028CVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('established_on', U&'le plan \0007CVC')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored(jsonb_build_object('to_confirm_by', U&'relevé \+0E0041')), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"by":"x"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_stored('{"decided_by":"someone"}'), 'priced')
  ],
  array[true, true, true, true,
    false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false,
    false, false, false, false, false, false, false, false],
  'a provisional quantity: a priced line, a known basis, no code, what it rests on and what confirms it on one line of 3 '
    || 'to 160 characters (no line break, no doubled or edge blank, no invisible or control character), its author and time'
);

select is(
  array[
    public.estimate_offer_choice_valid(pg_temp.pq_reserve_stored(), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_reserve_stored('{"code":"other","note":"Réseau enterré non relevé"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_reserve_stored(), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_reserve_stored('{"code":"other"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_reserve_stored() - 'code', 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.pq_reserve_stored('{"established_on":"le plan CVC"}'), 'not_priced')
  ],
  array[true, true, false, false, false, false],
  'the reserve of PR 4 is unchanged: a « Non chiffrée » line, its code, no provisional texts'
);

-- La jumelle de readTakeoffProvision : une hypothèse lisible (saisie, estimée, non observable, forcée comme hypothèse
-- chiffrée) ; ni une provision interne, ni un marqueur illisible, ni l'absence de marqueur.
create function pg_temp.pq_marker(p_source jsonb, p_marker_patch jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('takeoff_provision', jsonb_build_object('version', 1, 'job_id', 'job-1',
    'sources', jsonb_build_array(jsonb_build_object('takeoff_item_id', 'takeoff-1', 'forced', false, 'forced_reason', null,
      'entry_category', null) || p_source)) || p_marker_patch)
$$;

select is(
  array[
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"estimated"}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"entry_category":"hypothesis"}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"forced":true,"forced_reason":"priced_hypothesis"}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"non_observable","extra":1}')),
    public.estimate_item_takeoff_hypothesis(jsonb_build_object('takeoff_provision', jsonb_build_object('version', 1,
      'job_id', 'job-1', 'sources', jsonb_build_array(
        jsonb_build_object('takeoff_item_id', 'a', 'forced', true, 'forced_reason', 'other', 'entry_category', null),
        jsonb_build_object('takeoff_item_id', 'b', 'forced', false, 'forced_reason', null, 'entry_category', null,
          'hypothesis_cause', 'estimated'))))),
    -- not an hypothesis
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"forced":true,"forced_reason":"other"}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":null}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"estimated"}', '{"version":2}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"estimated"}', '{"job_id":null}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"estimated"}', '{"sources":[]}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"estimated"}') #- '{takeoff_provision,sources,0,forced_reason}'),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":"estimated","forced":"no"}')),
    public.estimate_item_takeoff_hypothesis(pg_temp.pq_marker('{"hypothesis_cause":3}')),
    public.estimate_item_takeoff_hypothesis('{"takeoff_provision":null}'),
    public.estimate_item_takeoff_hypothesis('{}'),
    public.estimate_item_takeoff_hypothesis(null)
  ],
  array[true, true, true, true, true, false, false, false, false, false, false, false, false, false, false, false],
  'the SQL twin of readTakeoffProvision: a readable marker with a source resting on an hypothesis'
);

-- ---------------------------------------------------------------------------
-- Fixture : un administrateur et un ingénieur de la même entreprise.
--   ...8000-000000000001 administrateur ; ...003 ingénieur ; ...010 affaire ; versions ...110 v3 brouillon,
--   ...120 v2 brouillon. Lignes : « -8001- », puis le rang.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select '00000000-0000-0000-0000-000000000000', entry.id, 'authenticated', 'authenticated', entry.email,
  crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from (values
  ('68500000-0000-4000-8000-000000000001'::uuid, 'estimate-provisional-admin@example.test')
) as entry(id, email);
update public.tenant_memberships set role = 'admin'::public.tenant_role
where user_id = '68500000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '68500000-0000-4000-8000-000000000001' limit 1), true);
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values ('00000000-0000-0000-0000-000000000000', '68500000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
  'estimate-provisional-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.tenant_memberships (tenant_id, user_id, role)
values (current_setting('test.tenant_id')::uuid, '68500000-0000-4000-8000-000000000003', 'engineer');

insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('68500000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '68500000-0000-4000-8000-000000000001', 'Affaire quantité provisionnelle');

select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 3::smallint, p_default_sale_coefficient_fo => 1, p_default_sale_coefficient_mo => 1,
  p_allowed_tax_rates_bp => null, p_change_reason => 'TI-682 lot C', p_actor_user_id => '68500000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);

create function pg_temp.pq_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select (left(replace(p_version::text, '-8000-', '-8001-'), 35) || p_index::text)::uuid
$$;

create function pg_temp.pq_line(p_id uuid, p_parent uuid, p_position integer, p_title text, p_status text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p_id, 'parent_id', p_parent, 'item_type', 'line', 'position', p_position,
    'title', p_title, 'quantity', 12, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1,
    'h_mo_per_unit', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'unit_code', 'ml', 'pricing_status', p_status,
    'pu_ht_cents', case when p_status = 'priced' then 0 end, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
    'line_total_ttc_cents', 0)
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('role', 'service_role', true);
select public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
  '68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000010', null,
  jsonb_build_object('id', '68500000-0000-4000-8000-000000000110', 'title', 'Quantité provisionnelle',
    'date_devis', '2026-11-12', 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
    'contractor_role', 'principal', 'calc_engine_version', 3, 'total_ht_cents', 0, 'total_tax_cents', 0,
    'total_ttc_cents', 0, 'sale_coefficient_fo', 1, 'sale_coefficient_mo', 1, 'gross_ht_cents', 0,
    'discount_applied_cents', 0, 'commercial_rounding_cents', 0),
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 0), 'parent_id', null,
      'item_type', 'section', 'position', 1, 'title', 'Lot'),
    pg_temp.pq_line(pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1),
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 0), 1, 'L1 hypothèse', 'priced'),
    pg_temp.pq_line(pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 2),
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 0), 2, 'L2 ordinaire', 'priced'),
    pg_temp.pq_line(pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 3),
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 0), 3, 'L3 non chiffrée', 'not_priced'),
    pg_temp.pq_line(pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 4),
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 0), 4, 'L4 provision', 'priced')
  ), null);
select set_config('role', 'none', true);
select set_config('request.jwt.claims', '', true);

-- Les marqueurs du métré, écrits comme private.takeoff_mark_provisions les écrit (sous le contrat d'écrivain v3).
-- L1 et L3 reposent sur une hypothèse ; L4 est une provision interne (source forcée) ; L2 n'a aucun marqueur.
select set_config('miaouffrage.estimate_v3_writer', '68500000-0000-4000-8000-000000000110', true);
update public.estimate_items set source_metadata = coalesce(source_metadata, '{}'::jsonb)
  || pg_temp.pq_marker('{"hypothesis_cause":"estimated"}')
where id in (pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 3));
update public.estimate_items set source_metadata = coalesce(source_metadata, '{}'::jsonb)
  || pg_temp.pq_marker('{"forced":true,"forced_reason":"other"}')
where id = pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 4);
select set_config('miaouffrage.estimate_v3_writer', '', true);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values
  ('68500000-0000-4000-8000-000000000110', '68500000-0000-4000-8000-000000000001',
   current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
   '68500000-0000-4000-8000-000000000403');

-- Une v2 brouillon, une ligne chiffrée marquée hypothèse.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title)
values ('68500000-0000-4000-8000-000000000120', current_setting('test.tenant_id')::uuid,
  '68500000-0000-4000-8000-000000000010', 2, 'draft', 2, 'Quantité provisionnelle v2');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values (pg_temp.pq_item('68500000-0000-4000-8000-000000000120', 0), current_setting('test.tenant_id')::uuid,
  '68500000-0000-4000-8000-000000000120', null, 'section', 1, 'Lot v2');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
  line_total_ttc_cents, source_metadata)
values (pg_temp.pq_item('68500000-0000-4000-8000-000000000120', 1), current_setting('test.tenant_id')::uuid,
  '68500000-0000-4000-8000-000000000120', pg_temp.pq_item('68500000-0000-4000-8000-000000000120', 0), 'line', 1, 'V2',
  1, 0, 2000, 1, 0, 1, 1, 0, 0, 0, 0, pg_temp.pq_marker('{"hypothesis_cause":"estimated"}'));
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values
  ('68500000-0000-4000-8000-000000000120', '68500000-0000-4000-8000-000000000001',
   current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
   '68500000-0000-4000-8000-000000000403');

select is(
  (select string_agg(concat_ws(':', title, pricing_status, public.estimate_item_takeoff_hypothesis(source_metadata)::text), ','
     order by position) from public.estimate_items where version_id = '68500000-0000-4000-8000-000000000110' and item_type = 'line'),
  'L1 hypothèse:priced:true,L2 ordinaire:priced:false,L3 non chiffrée:not_priced:true,L4 provision:priced:false',
  'fixture: a priced hypothesis, a plain priced line, an unpriced hypothesis and an internal provision'
);

-- L'appel du serveur : acteur, version, ligne, choix, jeton (celui de la version), session de verrou.
create function pg_temp.pq_call(p_actor uuid, p_version uuid, p_item uuid, p_choice jsonb)
returns text
language plpgsql
as $$
declare
  response jsonb;
begin
  perform set_config('role', 'service_role', true);
  response := public.set_estimate_line_offer_choice(current_setting('test.tenant_id')::uuid, p_version, p_item, p_actor,
    p_choice, (select updated_at from public.estimate_versions where id = p_version), '68500000-0000-4000-8000-000000000403');
  perform set_config('role', 'none', true);
  return 'ok:' || coalesce(response -> 'item' -> 'offer_choice' ->> 'kind', '-');
exception when others then
  perform set_config('role', 'none', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

create function pg_temp.pq_input(p_patch jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('kind', 'provisional_quantity', 'basis', 'private_estimate',
    'established_on', 'le plan CVC indice B', 'to_confirm_by', 'le relevé contradictoire sur site') || p_patch
$$;

-- ---------------------------------------------------------------------------
-- La déclaration : refus, puis admission.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.pq_call('68500000-0000-4000-8000-000000000003', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_input()),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 2), pg_temp.pq_input()),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 4), pg_temp.pq_input()),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 3), pg_temp.pq_input()),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000120',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000120', 1), pg_temp.pq_input()),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_input('{"code":"pending_survey"}')),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_input() - 'to_confirm_by'),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_input(jsonb_build_object('established_on', repeat('é', 161)))),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_input(jsonb_build_object('established_on', U&'plan\200BCVC'))),
    pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1), pg_temp.pq_input('{"basis":"indicative_quantities"}'))
  ],
  array[
    '42501 ESTIMATE_OFFER_CHOICE_FORBIDDEN',
    '23514 ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED',
    '23514 ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED',
    '23514 ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH',
    '0A000 ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID'
  ],
  'refused to an engineer, on a priced line without hypothesis marker or with an internal provision, on a « Non '
    || 'chiffrée » line, on a v2, with a code, without what confirms it, with a text too long or invisible characters, '
    || 'and on indicative quantities without the reference of the consultation rules'
);

select is(
  pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
    pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1),
    pg_temp.pq_input(jsonb_build_object('established_on', E'  le plan\n CVC \u00a0indice B ', 'note', '   '))),
  'ok:provisional_quantity',
  'an administrator declares the provisional quantity of a priced hypothesis'
);
select is(
  (select jsonb_build_object('established_on', offer_choice -> 'established_on', 'to_confirm_by', offer_choice -> 'to_confirm_by',
     'note', offer_choice -> 'note', 'basis', offer_choice -> 'basis', 'by', offer_choice -> 'decided_by',
     'keys', (select jsonb_agg(key order by key) from jsonb_object_keys(offer_choice) key))
   from public.estimate_items where id = pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1)),
  jsonb_build_object('established_on', 'le plan CVC indice B', 'to_confirm_by', 'le relevé contradictoire sur site',
    'note', null, 'basis', 'private_estimate', 'by', '68500000-0000-4000-8000-000000000001',
    'keys', jsonb_build_array('basis', 'decided_at', 'decided_by', 'established_on', 'kind', 'note', 'to_confirm_by')),
  'stored with its texts on one line (blanks and line breaks reduced to one space), no code, its author and time'
);

-- ---------------------------------------------------------------------------
-- Écriture directe : ni l'API de données (v3 ou v2), ni un écrivain de confiance sur une ligne sans marqueur.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.pq_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68500000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.pq_stored(),
        pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))
    ]),
    pg_temp.pq_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68500000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.pq_stored(),
        pg_temp.pq_item('68500000-0000-4000-8000-000000000120', 1))
    ]),
    pg_temp.pq_probe(array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68500000-0000-4000-8000-000000000110', true)$s$,
      format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.pq_stored(),
        pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 2))
    ]),
    pg_temp.pq_probe(array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68500000-0000-4000-8000-000000000110', true)$s$,
      format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.pq_stored(),
        pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 4))
    ]),
    pg_temp.pq_probe(array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68500000-0000-4000-8000-000000000110', true)$s$,
      format('update public.estimate_items set offer_choice = %L, source_metadata = %L where id = %L', pg_temp.pq_stored(),
        pg_temp.pq_marker('{"hypothesis_cause":"estimated"}'), pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 2))
    ], format('select offer_choice ->> %L from public.estimate_items where id = %L', 'kind',
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 2)))
  ],
  array['0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED', '0A000 ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED',
    '23514 ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED', '23514 ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED',
    'ok:provisional_quantity'],
  'the Data API declares none (v3 writer contract, engine 2 refused); a trusted writer only with the hypothesis marker'
);

-- ---------------------------------------------------------------------------
-- La ligne change : la quantité ou le titre gardent le choix (le contrôle d'envoi demande la phrase nouvelle) ; quitter
-- « Chiffrée » ou perdre le marqueur d'hypothèse l'efface, et y revenir ne le rend pas.
-- ---------------------------------------------------------------------------
create function pg_temp.pq_writer(p_statements text[])
returns text
language sql
as $$
  select pg_temp.pq_probe(
    array[$s$select set_config('miaouffrage.estimate_v3_writer', '68500000-0000-4000-8000-000000000110', true)$s$]
      || p_statements,
    format('select concat_ws(%L, pricing_status, quantity, coalesce(offer_choice->>%L, %L)) from public.estimate_items where id = %L',
      ':', 'kind', '-', pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))
  )
$$;

select is(
  array[
    pg_temp.pq_writer(array[format('update public.estimate_items set quantity = 12.5, title = %L where id = %L',
      'L1 renommée', pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))]),
    pg_temp.pq_writer(array[format($s$update public.estimate_items set pricing_status = 'included' where id = %L$s$,
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))]),
    pg_temp.pq_writer(array[format($s$update public.estimate_items set pricing_status = 'not_priced' where id = %L$s$,
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1)),
      format($s$update public.estimate_items set pricing_status = 'priced' where id = %L$s$,
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))]),
    -- A re-measure whose new sources are no hypothesis: private.takeoff_mark_provisions removes the marker.
    pg_temp.pq_writer(array[format($s$update public.estimate_items set quantity = 14, source_metadata = source_metadata - 'takeoff_provision' where id = %L$s$,
      pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))]),
    pg_temp.pq_writer(array[format('update public.estimate_items set source_metadata = source_metadata || %L where id = %L',
      pg_temp.pq_marker('{"forced":true,"forced_reason":"other"}'), pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))]),
    -- A re-measure still resting on an hypothesis keeps the choice; its quantity changes, so does the sentence.
    pg_temp.pq_writer(array[format('update public.estimate_items set quantity = 15, source_metadata = source_metadata || %L where id = %L',
      pg_temp.pq_marker('{"entry_category":"hypothesis"}'), pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1))])
  ],
  array['ok:priced:12.500:provisional_quantity', 'ok:included:12.000:-', 'ok:priced:12.000:-', 'ok:priced:14.000:-',
    'ok:priced:12.000:-', 'ok:priced:15.000:provisional_quantity'],
  'a provisional quantity survives its quantity and title; leaving « Chiffrée » or losing the hypothesis clears it for good'
);

select is(
  (select offer_choice ->> 'kind' from public.estimate_items where id = pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 1)),
  'provisional_quantity',
  'fixture: the probes roll back, the provisional quantity is still declared'
);

-- La réserve de la PR 4 se déclare toujours sur la ligne « Non chiffrée » marquée.
select is(
  pg_temp.pq_call('68500000-0000-4000-8000-000000000001', '68500000-0000-4000-8000-000000000110',
    pg_temp.pq_item('68500000-0000-4000-8000-000000000110', 3),
    '{"kind":"reserve","basis":"private_estimate","code":"pending_survey"}'::jsonb),
  'ok:reserve',
  'a reserve is still declared on a « Non chiffrée » line, marked or not'
);

-- ---------------------------------------------------------------------------
-- Duplication : une nouvelle version est une nouvelle offre, aucun choix ne suit, le marqueur reste.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.pq_probe(
    array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68500000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('pq_test.duplicate_id',
         public.duplicate_estimate_version('68500000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select string_agg(concat_ws(':', title, pricing_status, public.estimate_item_takeoff_hypothesis(source_metadata)::text,
         coalesce(offer_choice::text, '-')), ',' order by position)
       from public.estimate_items where version_id = current_setting('pq_test.duplicate_id')::uuid and item_type = 'line'$a$
  ),
  'ok:L1 hypothèse:priced:true:-,L2 ordinaire:priced:false:-,L3 non chiffrée:not_priced:true:-,L4 provision:priced:false:-',
  'a duplicated version keeps the hypothesis markers and none of the offer choices: each offer is declared again'
);

-- ---------------------------------------------------------------------------
-- L'envoi : l'événement « sent » recopie la quantité provisionnelle avec ses textes.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.pq_probe(array[
    $s$insert into public.estimate_version_events (tenant_id, estimate_version_id, event_type, metadata, created_by)
       select tenant_id, id, 'sent', '{}'::jsonb, '68500000-0000-4000-8000-000000000001'
       from public.estimate_versions where id = '68500000-0000-4000-8000-000000000110'$s$
  ], $a$select string_agg(concat_ws(':', choice ->> 'kind', coalesce(choice ->> 'established_on', ''),
       coalesce(choice ->> 'to_confirm_by', ''), coalesce(choice ->> 'code', '-')), ',' order by ordinality)
     from public.estimate_version_events event
     cross join lateral jsonb_array_elements(event.metadata -> 'offer_choices') with ordinality as entry(choice, ordinality)
     where event.estimate_version_id = '68500000-0000-4000-8000-000000000110' and event.event_type = 'sent'$a$),
  'ok:provisional_quantity:le plan CVC indice B:le relevé contradictoire sur site:-,reserve:::pending_survey',
  'the sent event records the provisional quantity with what it rests on and what confirms it, next to the reserve'
);

select * from finish();
rollback;
