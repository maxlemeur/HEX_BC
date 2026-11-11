-- TI-682, lot C, PR 4 (D10, D25, D28, D29) : la réserve écrite dans l'offre. Un administrateur déclare qu'une ligne
-- « Non chiffrée » part non chiffrée, avec ce qui fonde la réserve ; le client lit « Non chiffrée » sur la ligne et le
-- texte « Précisions et limites de prestation », déjà imprimés et scellés. Règles de la migration
-- *_estimate_line_offer_choice.sql :
-- - estimate_items.offer_choice (jsonb), forme et statut de la ligne validés par public.estimate_offer_choice_valid
--   (kind « reserve » seulement, sur une ligne « Non chiffrée ») ;
-- - écrit par public.set_estimate_line_offer_choice seulement (service_role, acteur administrateur actif du tenant, v3
--   brouillon, verrou du brouillon de l'acteur, jeton de version) ; ni le lot, ni la création d'une ligne, ni l'API de
--   données ne l'écrivent ;
-- - effacé quand le statut de la ligne ne lui convient plus, jamais recopié par une insertion (duplication, copie) ;
-- - figé par la base une fois la version envoyée ; l'événement « sent » recopie les choix de la version.
-- Le contrôle d'envoi (offer_reserve_declared, offer_limits_required) est en TypeScript : src/lib/estimates/gating.test.ts.
-- Isolation : la fonction, les gardes, le déclencheur et l'événement ne s'observent pas depuis un parcours.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Sonde : exécute les instructions puis l'action, et annule toujours ses écritures.
create function pg_temp.oc_probe(p_statements text[], p_action text default null)
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
    raise exception using errcode = 'P0001', message = 'OC_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'OC_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------
select col_type_is('public', 'estimate_items', 'offer_choice', 'jsonb', 'the offer choice is a jsonb');
select col_is_null('public', 'estimate_items', 'offer_choice', 'a line has no offer choice by default');
select is(
  (select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'estimate_offer_choice_valid'),
  'i',
  'the validation of an offer choice is an immutable function (usable by the CHECK constraint)'
);
select is(
  array[
    has_function_privilege('anon', 'public.set_estimate_line_offer_choice(uuid,uuid,uuid,uuid,jsonb,timestamptz,uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.set_estimate_line_offer_choice(uuid,uuid,uuid,uuid,jsonb,timestamptz,uuid)', 'execute'),
    has_function_privilege('service_role', 'public.set_estimate_line_offer_choice(uuid,uuid,uuid,uuid,jsonb,timestamptz,uuid)', 'execute')
  ],
  array[false, false, true],
  'only the server (service_role) declares an offer choice'
);

-- Un choix stocké : la base, le code, la note, l'auteur et l'heure.
create function pg_temp.oc_stored(p_patch jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('kind', 'reserve', 'basis', 'private_estimate', 'code', 'pending_survey', 'note', null,
    'decided_by', '68400000-0000-4000-8000-000000000001', 'decided_at', '2026-11-11T18:02:23.123456+00:00') || p_patch
$$;

select is(
  array[
    public.estimate_offer_choice_valid(pg_temp.oc_stored(), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"code":"quantity_not_determinable","note":"Quantité impossible à établir"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"code":"pending_buyer_answer","decided_at":"2026-11-11T18:02:23Z"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored(jsonb_build_object('code', 'other', 'note', repeat('é', 500))), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"basis":"indicative_quantities","note":"RC article 5.2, quantités indicatives"}'), 'not_priced'),
    -- refused
    public.estimate_offer_choice_valid(pg_temp.oc_stored(), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored(), 'out_of_scope'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"kind":"provisional_quantity"}'), 'priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"basis":"public_lump_sum"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"code":"unknown"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"note":" 123456789 "}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored(jsonb_build_object('note', repeat('é', 501))), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"code":"other"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"basis":"indicative_quantities"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"by":"x"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored() - 'decided_by', 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"decided_by":"someone"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"decided_at":"hier"}'), 'not_priced'),
    public.estimate_offer_choice_valid(pg_temp.oc_stored('{"note":12345678901}'), 'not_priced'),
    public.estimate_offer_choice_valid('"reserve"', 'not_priced'),
    public.estimate_offer_choice_valid(null, 'not_priced')
  ],
  array[true, true, true, true, true,
    false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  'a reserve: a « Non chiffrée » line, a known basis and code, a note of 10 to 500 code points once trimmed (required for '
    || '« other » and for indicative quantities), its author and time; nothing else (provisional quantity waits for PR 5)'
);

-- ---------------------------------------------------------------------------
-- Fixture : un administrateur et un ingénieur de la même entreprise, l'administrateur d'une autre entreprise.
--   ...8000-000000000001 administrateur ; ...003 ingénieur ; ...002 autre entreprise ; ...010 affaire ;
--   versions ...110 v3 brouillon, ...120 v2 brouillon, ...130 v3 envoyée. Lignes : « -8001- », puis le rang.
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
  ('68400000-0000-4000-8000-000000000001'::uuid, 'estimate-offer-choice-admin@example.test'),
  ('68400000-0000-4000-8000-000000000002'::uuid, 'estimate-offer-choice-other@example.test'),
  ('68400000-0000-4000-8000-000000000003'::uuid, 'estimate-offer-choice-engineer@example.test')
) as entry(id, email);
update public.tenant_memberships set role = 'admin'::public.tenant_role
where user_id = '68400000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '68400000-0000-4000-8000-000000000001' limit 1), true);
select set_config('test.other_tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '68400000-0000-4000-8000-000000000002' limit 1), true);
insert into public.tenant_memberships (tenant_id, user_id, role)
values (current_setting('test.tenant_id')::uuid, '68400000-0000-4000-8000-000000000003', 'engineer');
select isnt(current_setting('test.other_tenant_id'), current_setting('test.tenant_id'),
  'fixture: the second administrator belongs to another company');

insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('68400000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '68400000-0000-4000-8000-000000000001', 'Affaire réserve');

select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 3::smallint, p_default_sale_coefficient_fo => 1, p_default_sale_coefficient_mo => 1,
  p_allowed_tax_rates_bp => null, p_change_reason => 'TI-682 lot C', p_actor_user_id => '68400000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);

create function pg_temp.oc_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select (left(replace(p_version::text, '-8000-', '-8001-'), 35) || p_index::text)::uuid
$$;

-- Une ligne v3 à 0 € (prix 0, aucune heure) : son montant est nul quel que soit son statut. Le pied reste à 0.
create function pg_temp.oc_line(p_id uuid, p_parent uuid, p_position integer, p_title text, p_status text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p_id, 'parent_id', p_parent, 'item_type', 'line', 'position', p_position,
    'title', p_title, 'quantity', 1, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1,
    'h_mo_per_unit', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'unit_code', 'u', 'pricing_status', p_status,
    'pu_ht_cents', case when p_status = 'priced' then 0 end, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
    'line_total_ttc_cents', 0)
$$;

create function pg_temp.oc_create(p_version uuid, p_items jsonb)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000010', null,
    jsonb_build_object('id', p_version, 'title', 'Réserve', 'date_devis', '2026-11-11', 'validite_jours', 30,
      'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
      'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
      'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
      'contractor_role', 'principal', 'calc_engine_version', 3, 'total_ht_cents', 0, 'total_tax_cents', 0,
      'total_ttc_cents', 0, 'sale_coefficient_fo', 1, 'sale_coefficient_mo', 1, 'gross_ht_cents', 0,
      'discount_applied_cents', 0, 'commercial_rounding_cents', 0),
    p_items, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

-- L1, L3 « Non chiffrée » ; L2 chiffrée ; L4 « Hors lot ».
select is(
  pg_temp.oc_create('68400000-0000-4000-8000-000000000110', jsonb_build_array(
    jsonb_build_object('id', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0), 'parent_id', null,
      'item_type', 'section', 'position', 1, 'title', 'Lot'),
    pg_temp.oc_line(pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1),
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0), 1, 'L1', 'not_priced'),
    pg_temp.oc_line(pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 2),
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0), 2, 'L2', 'priced'),
    pg_temp.oc_line(pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 3),
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0), 3, 'L3', 'not_priced'),
    pg_temp.oc_line(pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 4),
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0), 4, 'L4', 'out_of_scope')
  )),
  'ok',
  'fixture: a v3 draft at 0 € with two « Non chiffrée » lines'
);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values
  ('68400000-0000-4000-8000-000000000110', '68400000-0000-4000-8000-000000000001',
   current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
   '68400000-0000-4000-8000-000000000403');

-- Une v2 brouillon (une ligne chiffrée) et une v3 envoyée (une ligne « Non chiffrée » réservée), écrites sans les
-- déclencheurs d'effets ni d'effacement : seules leurs gardes comptent ici.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title,
  sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents)
values
  ('68400000-0000-4000-8000-000000000130', current_setting('test.tenant_id')::uuid,
   '68400000-0000-4000-8000-000000000010', 3, 'sent', 3, 'Réserve envoyée', 1, 1, 0, 0, 0);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title)
values ('68400000-0000-4000-8000-000000000120', current_setting('test.tenant_id')::uuid,
  '68400000-0000-4000-8000-000000000010', 2, 'draft', 2, 'Réserve v2');
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger bump_estimate_content_revision_from_item;
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger af_clear_estimate_item_offer_choice;
select set_config('miaouffrage.estimate_v3_writer', '68400000-0000-4000-8000-000000000130', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values (pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 0), current_setting('test.tenant_id')::uuid,
  '68400000-0000-4000-8000-000000000130', null, 'section', 1, 'Lot envoyé');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit, pu_ht_cents,
  line_total_ht_cents, line_tax_cents, line_total_ttc_cents, offer_choice)
values (pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1), current_setting('test.tenant_id')::uuid,
  '68400000-0000-4000-8000-000000000130', pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 0), 'line', 1, 'E1',
  1, 0, 2000, 1, 1, 1, 'u', 'not_priced', 0, null, 0, 0, 0, pg_temp.oc_stored());
select set_config('miaouffrage.estimate_v3_writer', '', true);
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items enable trigger af_clear_estimate_item_offer_choice;
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values (pg_temp.oc_item('68400000-0000-4000-8000-000000000120', 0), current_setting('test.tenant_id')::uuid,
  '68400000-0000-4000-8000-000000000120', null, 'section', 1, 'Lot v2');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
  line_total_ttc_cents)
values (pg_temp.oc_item('68400000-0000-4000-8000-000000000120', 1), current_setting('test.tenant_id')::uuid,
  '68400000-0000-4000-8000-000000000120', pg_temp.oc_item('68400000-0000-4000-8000-000000000120', 0), 'line', 1, 'V2',
  1, 0, 2000, 1, 0, 1, 1, 0, 0, 0, 0);
set constraints public.estimate_items_parent_id_fkey immediate; set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items enable trigger bump_estimate_content_revision_from_item;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values
  ('68400000-0000-4000-8000-000000000120', '68400000-0000-4000-8000-000000000001',
   current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
   '68400000-0000-4000-8000-000000000403');

-- L'appel du serveur : acteur, version, ligne, choix, jeton (par défaut celui de la version), session de verrou.
create function pg_temp.oc_call(p_actor uuid, p_version uuid, p_item uuid, p_choice jsonb,
  p_token timestamptz default null, p_session uuid default '68400000-0000-4000-8000-000000000403',
  p_tenant uuid default null)
returns text
language plpgsql
as $$
declare
  response jsonb;
begin
  perform set_config('role', 'service_role', true);
  response := public.set_estimate_line_offer_choice(coalesce(p_tenant, current_setting('test.tenant_id')::uuid), p_version,
    p_item, p_actor, p_choice,
    coalesce(p_token, (select updated_at from public.estimate_versions where id = p_version)), p_session);
  perform set_config('role', 'none', true);
  return 'ok:' || coalesce(response -> 'item' -> 'offer_choice' ->> 'code', '-');
exception when others then
  perform set_config('role', 'none', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

create function pg_temp.oc_reserve(p_patch jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('kind', 'reserve', 'basis', 'private_estimate', 'code', 'pending_survey') || p_patch
$$;

-- ---------------------------------------------------------------------------
-- Refus : rôle, acteur, entreprise, version, moteur, ligne, forme, jeton, verrou. Rien n'est écrit.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.oc_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true)$s$,
    format($s$select public.set_estimate_line_offer_choice(%L, %L, %L, %L, %L::jsonb, now(), %L)$s$,
      current_setting('test.tenant_id'), '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), '68400000-0000-4000-8000-000000000001',
      pg_temp.oc_reserve(), '68400000-0000-4000-8000-000000000403')
  ]),
  '42501 permission denied for function set_estimate_line_offer_choice',
  'an authenticated client cannot call the declaration, even as an administrator'
);

select is(
  array[
    pg_temp.oc_call('68400000-0000-4000-8000-000000000003', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000002', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000002', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve(), null, '68400000-0000-4000-8000-000000000403',
      current_setting('test.other_tenant_id')::uuid),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000130',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000120',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000120', 1), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 2), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 4), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0), pg_temp.oc_reserve()),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1), pg_temp.oc_reserve())
  ],
  array[
    '42501 ESTIMATE_OFFER_CHOICE_FORBIDDEN',
    '42501 ESTIMATE_OFFER_CHOICE_FORBIDDEN',
    '42501 ESTIMATE_OFFER_CHOICE_FORBIDDEN',
    '42501 ESTIMATE_VERSION_READ_ONLY',
    '0A000 ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED',
    '23514 ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH',
    '23514 ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH',
    '22023 ESTIMATE_OFFER_CHOICE_LINE_REQUIRED',
    '22023 ESTIMATE_OFFER_CHOICE_LINE_REQUIRED'
  ],
  'refused to an engineer, to another company''s administrator (with its tenant or this one), on a sent version, on a v2, '
    || 'on a priced or « Hors lot » line, on a section and on a line of another version'
);

select is(
  array[
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve('{"basis":"public_lump_sum"}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve('{"code":"unknown"}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve('{"note":" 123456789 "}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve('{"code":"other","note":"   "}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve('{"basis":"indicative_quantities"}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve('{"kind":"provisional_quantity"}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1),
      pg_temp.oc_reserve('{"decided_by":"68400000-0000-4000-8000-000000000003"}')),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), '"reserve"'::jsonb),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve(), '2026-01-01T00:00:00Z'),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve(), null,
      '68400000-0000-4000-8000-000000000404'),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve(), null, null)
  ],
  array[
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '22023 ESTIMATE_OFFER_CHOICE_INVALID',
    '40001 ESTIMATE_OFFER_CHOICE_STALE',
    '55000 ESTIMATE_OFFER_CHOICE_LOCK_REQUIRED',
    '55000 ESTIMATE_OFFER_CHOICE_LOCK_REQUIRED'
  ],
  'refused: an unknown basis or code, a short or blank note, indicative quantities without the reference, a provisional '
    || 'quantity (PR 5), an author given by the client, a non-object; a stale version token; another session or no lock'
);

-- An expired lock, an inactive company, an archived affaire.
select is(
  array[
    pg_temp.oc_probe(array[
      $s$update public.draft_locks set expires_at = statement_timestamp() - interval '1 second'
         where version_id = '68400000-0000-4000-8000-000000000110'$s$
    ], format('select pg_temp.oc_call(%L, %L, %L, %L::jsonb)', '68400000-0000-4000-8000-000000000001',
      '68400000-0000-4000-8000-000000000110', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve())),
    pg_temp.oc_probe(array[
      format('update public.tenants set is_active = false where id = %L', current_setting('test.tenant_id'))
    ], format('select pg_temp.oc_call(%L, %L, %L, %L::jsonb)', '68400000-0000-4000-8000-000000000001',
      '68400000-0000-4000-8000-000000000110', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve())),
    pg_temp.oc_probe(array[
      $s$update public.estimate_projects set is_archived = true where id = '68400000-0000-4000-8000-000000000010'$s$
    ], format('select pg_temp.oc_call(%L, %L, %L, %L::jsonb)', '68400000-0000-4000-8000-000000000001',
      '68400000-0000-4000-8000-000000000110', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1), pg_temp.oc_reserve()))
  ],
  array['ok:55000 ESTIMATE_OFFER_CHOICE_LOCK_REQUIRED', 'ok:42501 ESTIMATE_OFFER_CHOICE_FORBIDDEN',
    'ok:42501 ESTIMATE_OFFER_CHOICE_FORBIDDEN'],
  'refused with an expired lock, in an inactive company and on an archived affaire'
);

select is(
  (select count(*) from public.estimate_items where offer_choice is not null
     and version_id <> '68400000-0000-4000-8000-000000000130'),
  0::bigint,
  'nothing refused was written'
);

-- ---------------------------------------------------------------------------
-- Admis : un administrateur déclare la réserve d'une ligne « Non chiffrée » d'une v3 brouillon.
-- ---------------------------------------------------------------------------
select set_config('test.revision_before',
  (select content_revision::text from public.estimate_versions where id = '68400000-0000-4000-8000-000000000110'), true);
select is(
  pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
    pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1),
    pg_temp.oc_reserve('{"code":"quantity_not_determinable","note":"  Réseau enterré non relevé \n"}')),
  'ok:quantity_not_determinable',
  'an administrator declares the reserve of a « Non chiffrée » line of a v3 draft'
);
select is(
  (select jsonb_build_object('kind', offer_choice -> 'kind', 'basis', offer_choice -> 'basis', 'code', offer_choice -> 'code',
     'note', offer_choice -> 'note', 'decided_by', offer_choice -> 'decided_by',
     'decided_at', (offer_choice ->> 'decided_at')::timestamptz between now() and clock_timestamp(), 'keys', (select array_agg(k order by k) from jsonb_object_keys(offer_choice) k),
     'status', pricing_status)
   from public.estimate_items where id = pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1)),
  jsonb_build_object('kind', 'reserve', 'basis', 'private_estimate', 'code', 'quantity_not_determinable',
    'note', 'Réseau enterré non relevé', 'decided_by', '68400000-0000-4000-8000-000000000001', 'decided_at', true,
    'keys', array['basis', 'code', 'decided_at', 'decided_by', 'kind', 'note'], 'status', 'not_priced'),
  'the stored choice: its basis, code and trimmed note, its author and time set by the database; the line stays « Non chiffrée »'
);
-- One transaction here: updated_at, the version token, keeps the transaction time; each request has its own.
select is(
  (select content_revision - current_setting('test.revision_before')::bigint
   from public.estimate_versions where id = '68400000-0000-4000-8000-000000000110'),
  1::bigint,
  'the declaration takes one content revision'
);
select is(
  (select count(*) from public.estimate_items where version_id = '68400000-0000-4000-8000-000000000110'
     and offer_choice is not null),
  1::bigint,
  'the other lines are not touched'
);

-- ---------------------------------------------------------------------------
-- Écriture directe : ni l'API de données, ni un écrivain de confiance hors statut, ni une insertion.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.oc_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.oc_stored(),
        pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 3))
    ]),
    pg_temp.oc_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set offer_choice = null where id = %L',
        pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1))
    ]),
    pg_temp.oc_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true)$s$,
      format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.oc_stored(),
        pg_temp.oc_item('68400000-0000-4000-8000-000000000120', 1))
    ])
  ],
  array['0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED', '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_offer_choice_check"'],
  'the Data API neither declares nor withdraws a reserve on a v3 draft, and cannot put one on a v2 line'
);

create function pg_temp.oc_writer(p_statement text, p_index integer)
returns text
language sql
as $$
  select pg_temp.oc_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68400000-0000-4000-8000-000000000110', true)$s$,
      p_statement
    ],
    format('select concat_ws(%L, pricing_status, coalesce(offer_choice->>%L, %L)) from public.estimate_items where id = %L',
      ':', 'code', '-', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', p_index))
  )
$$;

select is(
  array[
    pg_temp.oc_writer(format('update public.estimate_items set offer_choice = %L where id = %L', pg_temp.oc_stored(),
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 2)), 2),
    pg_temp.oc_writer(format('update public.estimate_items set offer_choice = %L where id = %L',
      pg_temp.oc_stored('{"basis":"other"}'), pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 3)), 3),
    pg_temp.oc_writer(format($s$update public.estimate_items set pricing_status = 'priced', offer_choice = %L where id = %L$s$,
      pg_temp.oc_stored('{"code":"pending_buyer_answer"}'), pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1)), 1),
    pg_temp.oc_writer(format($s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position,
        title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status,
        h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, offer_choice)
      select %L, tenant_id, id, %L, 'line', 7, 'L7', 1, 0, 2000, 1, 1, 1, 'u', 'not_priced', 0, null, 0, 0, 0, %L
      from public.estimate_versions where id = '68400000-0000-4000-8000-000000000110'$s$,
      pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 7), pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 0),
      pg_temp.oc_stored()), 7)
  ],
  array[
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_offer_choice_check"',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_offer_choice_check"',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_offer_choice_check"',
    'ok:not_priced:-'
  ],
  'under the writer contract: a reserve only of the stored shape on a « Non chiffrée » line (CHECK), and an inserted line '
    || 'never carries one'
);

-- ---------------------------------------------------------------------------
-- Le lot : il ne l'écrit jamais ; il la garde au titre, l'efface quand la ligne quitte « Non chiffrée ».
-- ---------------------------------------------------------------------------
create function pg_temp.oc_batch(p_operations jsonb, p_created_ids jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  updates jsonb;
  response jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', line.id,
      'pu_ht_cents', case when line.status = 'priced' then 0 end,
      'line_total_ht_cents', 0, 'line_tax_cents', 0, 'line_total_ttc_cents', 0) order by line.id), '[]'::jsonb)
    into updates
  from (
    select item.id, coalesce((
        select op -> 'data' ->> 'pricing_status' from jsonb_array_elements(p_operations) op
        where op ->> 'op' = 'update' and (op ->> 'id')::uuid = item.id and op -> 'data' ? 'pricing_status'
        order by 1 desc limit 1), item.pricing_status::text) as status
    from public.estimate_items item
    where item.version_id = '68400000-0000-4000-8000-000000000110' and item.item_type = 'line'
  ) line;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true);
  response := public.commit_estimate_batch('68400000-0000-4000-8000-000000000110', gen_random_uuid(),
    (select updated_at from public.estimate_versions where id = '68400000-0000-4000-8000-000000000110'),
    '68400000-0000-4000-8000-000000000403', p_operations, p_created_ids, updates,
    '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"gross_ht_cents":0,"discount_applied_cents":0,"commercial_rounding_cents":0}'::jsonb,
    '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return response;
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('error', sqlstate || ' ' || sqlerrm);
end
$$;

create function pg_temp.oc_update(p_index integer, p_data jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(jsonb_build_object('op', 'update',
    'id', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', p_index), 'data', p_data))
$$;

select is(
  array[
    pg_temp.oc_batch(pg_temp.oc_update(3, jsonb_build_object('offer_choice', pg_temp.oc_stored())))::text,
    pg_temp.oc_batch(jsonb_build_array(jsonb_build_object('op', 'create', 'data', jsonb_build_object('item_type', 'line',
        'title', 'L8', 'pricing_status', 'not_priced', 'offer_choice', pg_temp.oc_stored()))),
      jsonb_build_array(jsonb_build_object('index', 0, 'id', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 8))))::text
  ],
  array_fill('{"error": "22023 ESTIMATE_BATCH_INVALID_INPUT"}'::text, array[2]),
  'the batch refuses the offer choice as an input, on an update and on a creation'
);

-- The receipt of the batch echoes the choice of a line that has one, and leaves the column out at null (2 MiB receipt).
select is(
  (select array_agg(case when result -> 'data' -> 'item' ? 'offer_choice' then result -> 'data' -> 'item' -> 'offer_choice' ->> 'code'
     else 'absent' end order by (result ->> 'index')::integer)
   from jsonb_array_elements(pg_temp.oc_batch(pg_temp.oc_update(1, '{"title":"L1 renommée"}')
     || pg_temp.oc_update(3, '{"title":"L3 renommée"}')) -> 'results') result),
  array['quantity_not_determinable', 'absent'],
  'renaming a reserved line keeps its reserve; the receipt echoes it, and omits the column of a line without one'
);
select is(
  (select offer_choice ->> 'code' from public.estimate_items where id = pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1)),
  'quantity_not_determinable',
  'the reserve survives a write of its line that keeps it « Non chiffrée »'
);

select is(
  array[
    pg_temp.oc_probe(array[
      format('select pg_temp.oc_batch(pg_temp.oc_update(1, %L))', '{"pricing_status":"priced"}')
    ], format('select concat_ws(%L, pricing_status, coalesce(offer_choice::text, %L)) from public.estimate_items where id = %L',
      ':', '-', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1))),
    pg_temp.oc_probe(array[
      format('select pg_temp.oc_batch(pg_temp.oc_update(1, %L))', '{"pricing_status":"out_of_scope"}')
    ], format('select concat_ws(%L, pricing_status, coalesce(offer_choice::text, %L)) from public.estimate_items where id = %L',
      ':', '-', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1))),
    pg_temp.oc_probe(array[
      format('select pg_temp.oc_batch(pg_temp.oc_update(1, %L))', '{"pricing_status":"priced"}'),
      format('select pg_temp.oc_batch(pg_temp.oc_update(1, %L))', '{"pricing_status":"not_priced"}')
    ], format('select concat_ws(%L, pricing_status, coalesce(offer_choice::text, %L)) from public.estimate_items where id = %L',
      ':', '-', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1)))
  ],
  array['ok:priced:-', 'ok:out_of_scope:-', 'ok:not_priced:-'],
  'leaving « Non chiffrée » clears the reserve (priced or excluded), and coming back does not restore it'
);

-- ---------------------------------------------------------------------------
-- Retrait par l'administrateur, puis nouvelle déclaration (pour la suite).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.oc_probe(array[
    format('select pg_temp.oc_call(%L, %L, %L, null)', '68400000-0000-4000-8000-000000000001',
      '68400000-0000-4000-8000-000000000110', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1))
  ], format('select coalesce(offer_choice::text, %L) from public.estimate_items where id = %L', '-',
    pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1))),
  'ok:-',
  'an administrator withdraws the reserve (null)'
);
select is(
  pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000110',
    pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 3),
    pg_temp.oc_reserve('{"basis":"indicative_quantities","code":"pending_buyer_answer","note":"RC article 5.2 : quantités indicatives"}')),
  'ok:pending_buyer_answer',
  'a reserve on indicative quantities, with the reference of the consultation rules in its note'
);

-- ---------------------------------------------------------------------------
-- Duplication : une nouvelle version est une nouvelle offre, aucune réserve ne suit.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.oc_probe(
    array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('oc_test.duplicate_id',
         public.duplicate_estimate_version('68400000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select string_agg(concat_ws(':', title, pricing_status, coalesce(offer_choice::text, '-')), ',' order by title collate "C")
       from public.estimate_items where version_id = current_setting('oc_test.duplicate_id')::uuid and item_type = 'line'$a$
  ),
  'ok:L1 renommée:not_priced:-,L2:priced:-,L3 renommée:not_priced:-,L4:out_of_scope:-',
  'a duplicated version keeps the « Non chiffrée » lines and none of their reserves: each offer is declared again'
);

-- ---------------------------------------------------------------------------
-- L'envoi : l'événement « sent » recopie les choix de la version ; les autres événements, rien.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.oc_probe(array[
      $s$insert into public.estimate_version_events (tenant_id, estimate_version_id, event_type, metadata, created_by)
         select tenant_id, id, 'sent', '{"forced_by_admin":false}'::jsonb, '68400000-0000-4000-8000-000000000001'
         from public.estimate_versions where id = '68400000-0000-4000-8000-000000000110'$s$
    ], $a$select jsonb_build_object('forced', metadata -> 'forced_by_admin',
         'choices', (select jsonb_agg(jsonb_build_object('item', choice ->> 'item_id', 'kind', choice ->> 'kind',
            'basis', choice ->> 'basis', 'code', choice ->> 'code', 'note', choice ->> 'note',
            'decided_by', choice ->> 'decided_by', 'decided_at', choice ? 'decided_at'))
           from jsonb_array_elements(metadata -> 'offer_choices') choice))::text
       from public.estimate_version_events where estimate_version_id = '68400000-0000-4000-8000-000000000110'
         and event_type = 'sent'$a$),
    pg_temp.oc_probe(array[
      $s$insert into public.estimate_version_events (tenant_id, estimate_version_id, event_type, metadata, created_by)
         select tenant_id, id, 'accepted', '{}'::jsonb, '68400000-0000-4000-8000-000000000001'
         from public.estimate_versions where id = '68400000-0000-4000-8000-000000000110'$s$
    ], $a$select metadata::text from public.estimate_version_events
       where estimate_version_id = '68400000-0000-4000-8000-000000000110' and event_type = 'accepted'$a$),
    pg_temp.oc_probe(array[
      $s$insert into public.estimate_version_events (tenant_id, estimate_version_id, event_type, metadata, created_by)
         select tenant_id, id, 'sent', '{}'::jsonb, '68400000-0000-4000-8000-000000000001'
         from public.estimate_versions where id = '68400000-0000-4000-8000-000000000120'$s$
    ], $a$select metadata::text from public.estimate_version_events
       where estimate_version_id = '68400000-0000-4000-8000-000000000120' and event_type = 'sent'$a$)
  ],
  array[
    'ok:' || jsonb_build_object('forced', false, 'choices', jsonb_build_array(jsonb_build_object(
      'item', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 1)::text, 'kind', 'reserve',
      'basis', 'private_estimate', 'code', 'quantity_not_determinable', 'note', 'Réseau enterré non relevé',
      'decided_by', '68400000-0000-4000-8000-000000000001', 'decided_at', true), jsonb_build_object(
      'item', pg_temp.oc_item('68400000-0000-4000-8000-000000000110', 3)::text, 'kind', 'reserve',
      'basis', 'indicative_quantities', 'code', 'pending_buyer_answer', 'note', 'RC article 5.2 : quantités indicatives',
      'decided_by', '68400000-0000-4000-8000-000000000001', 'decided_at', true)))::text,
    'ok:{}',
    'ok:{}'
  ],
  'the sent event records every offer choice of the version, in line order, next to the metadata it was given; other '
    || 'events and a version without a choice are unchanged'
);

-- ---------------------------------------------------------------------------
-- Version envoyée : la réserve est figée.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.oc_probe(array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68400000-0000-4000-8000-000000000130', true)$s$,
      format('update public.estimate_items set offer_choice = null where id = %L',
        pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1))
    ]),
    pg_temp.oc_call('68400000-0000-4000-8000-000000000001', '68400000-0000-4000-8000-000000000130',
      pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1), null),
    pg_temp.oc_probe(array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '68400000-0000-4000-8000-000000000130', true)$s$,
      format($s$update public.estimate_items set pricing_status = 'priced' where id = %L$s$,
        pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1))
    ]),
    (select offer_choice ->> 'code' from public.estimate_items where id = pg_temp.oc_item('68400000-0000-4000-8000-000000000130', 1))
  ],
  array['42501 ESTIMATE_VERSION_READ_ONLY', '42501 ESTIMATE_VERSION_READ_ONLY', '42501 ESTIMATE_VERSION_READ_ONLY',
    'pending_survey'],
  'once the version is sent, its reserve is frozen: neither a trusted writer, nor the declaration, nor a status change'
);

-- ---------------------------------------------------------------------------
-- RLS : une autre entreprise ne lit ni la ligne ni sa réserve.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.oc_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000002', true)$s$
    ], $a$select count(*)::text from public.estimate_items where version_id = '68400000-0000-4000-8000-000000000110' and offer_choice is not null$a$),
    pg_temp.oc_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '68400000-0000-4000-8000-000000000001', true)$s$
    ], $a$select count(*)::text from public.estimate_items where version_id = '68400000-0000-4000-8000-000000000110' and offer_choice is not null$a$)
  ],
  array['ok:0', 'ok:2'],
  'another company reads no line and no reserve; the company itself reads its own'
);

select * from finish();
rollback;
