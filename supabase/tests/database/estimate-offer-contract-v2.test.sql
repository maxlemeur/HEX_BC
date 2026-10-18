-- Lot 2, sous-lot 2.7 : document client, contrat client 2, charge de calcul 6, émission v3 (M5).
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md, F1-F3, D2, D7,
-- D8, D14, D15, §4, §5 (S2, S5), §6.1 (M5), §7 (fonctions d'offre), §14 (2.7).
-- Défaillances visées et contrat M5 supposé : docs/testing/estimate-engine-v3-2.7.md (F27-01 à F27-21).
--
-- Écrite rouge avant M5. Toute lecture ou écriture d'un objet de M5 passe par pg_temp.v3_probe
-- (sous-bloc toujours annulé) ou pg_temp.v3_try (sous-bloc conservé s'il réussit) : avant M5, chaque
-- assertion d'exigence échoue sur son propre motif (fonction absente, ESTIMATE_V3_EMISSION_NOT_READY
-- de M1, contrat 1 seul admis) et la suite va jusqu'au bout sans interrompre la transaction.
-- Les témoins du contrat 1 (v1/v2) passent avant et après M5 : ils prouvent que M5 ne les change pas.
--
-- Montants : les sept lignes-oracle du §5.1 (nombres seuls), S2 (remise 1,01 €, TVA 20 %) et S5
-- (S2, O1-O3 à 10 %, O4-O7 à 20 %) du §5.2. Les nets, la ventilation FO/MO et la TVA par ligne
-- sont recalculés selon le §4 (plus grand reste, D13) ; la fixture est contrôlée contre §5.2 par la
-- première assertion, puis contre le moteur SQL de M4 par un gel d'approbation annulé.
--
-- Une modification refusée n'est une preuve que si la version exacte est acceptée par la même
-- publication : les sondes d'altération renvoient « exacte | altérée » (pg_temp.c2_pair). Avant M5,
-- la moitié exacte échoue ; une publication qui refuserait tout contrat 2 ne passe donc pas.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Sondes (mêmes formes que estimate-engine-v3-persistence.test.sql).
-- ---------------------------------------------------------------------------
create function pg_temp.v3_probe(p_statements text[], p_action text default null)
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
    raise exception using errcode = 'P0001', message = 'V3_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'V3_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

create function pg_temp.v3_try(p_statements text[])
returns text
language plpgsql
as $try$
declare
  try_statement text;
begin
  begin
    foreach try_statement in array coalesce(p_statements, '{}'::text[]) loop
      execute try_statement;
    end loop;
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
  perform set_config('miaouffrage.estimate_version_insert_contract', '', true);
  return 'ok';
end;
$try$;

-- ---------------------------------------------------------------------------
-- Identités (constantes) :
--   ...8000-000000000001 propriétaire (engineer, entreprise A) ; ...002 administrateur de A (auteur
--   de la politique) ; ...010 projet ; ...020 rôle « Tuyauteur » 40 €/h ; ...021 rôle « Tuyauteur
--   bis » 40 €/h, cité par la seule version de fraîcheur.
--   Versions : ...120 S2 ; ...150 S5 ; ...160 fraîcheur (S2, rôle bis) ; ...170 témoin v1 sans
--   ligne ; ...180 témoin v2 sans ligne.
--   Lignes : même suffixe en « -8001- », dernier chiffre = rang (0 = section).
--   Baux : ...31x (identifiants), ...41x (sessions de page).
-- ---------------------------------------------------------------------------
create temporary table c2_fx (
  key text primary key,
  value jsonb not null
) on commit drop;
grant select, insert, update on c2_fx to service_role;

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select (value #>> '{}')::uuid from c2_fx where key = p_key
$$;

create function pg_temp.c2_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select (left(replace(p_version::text, '-8000-', '-8001-'), 35) || p_index::text)::uuid
$$;

-- ---------------------------------------------------------------------------
-- Oracle §5.1 (nombres seuls) et scénarios S2, S5 du §5.2 (1,30 / 1,20, 40 €/h).
-- symbol : symbole du référentiel src/lib/units/units.json, imprimé dans la colonne Unité.
-- ---------------------------------------------------------------------------
create temporary table c2_line (
  ord integer primary key,
  quantity numeric not null,
  pr integer not null,
  hu numeric not null,
  unit text not null,
  symbol text not null,
  pu integer not null,
  gross integer not null,
  gross_fo integer not null
) on commit drop;

insert into c2_line (ord, quantity, pr, hu, unit, symbol, pu, gross, gross_fo)
values
  (1, 20, 5466, 1.991, 'ml', 'ml', 16663, 333260, 142119),
  (2, 3, 9563, 1.75, 'u', 'u', 20832, 62496, 37296),
  (3, 21, 5850, 0, 'm2', 'm²', 7605, 159705, 159705),
  (4, 1139, 302, 0.2, 'ml', 'ml', 1353, 1541067, 447304),
  (5, 1, 2000, 6, 'u', 'u', 31400, 31400, 2600),
  (6, 282, 9186, 0.998, 'ml', 'ml', 16732, 4718424, 3367547),
  (7, 8, 883, 1.30, 'ml', 'ml', 7388, 59104, 9183);

-- Nets et FO/MO : remise de 101 c répartie [5, 1, 2, 23, 0, 69, 1] (§5.2), identiques en S2 et S5.
-- TVA par ligne : part exacte de T_r selon les nets du groupe (§4 point 10, D13).
create temporary table c2_split (
  scenario text not null,
  ord integer not null,
  net integer not null,
  fo integer not null,
  mo integer not null,
  tax integer not null,
  rate integer not null,
  primary key (scenario, ord)
) on commit drop;

insert into c2_split (scenario, ord, net, fo, mo, tax, rate)
values
  ('S2', 1, 333255, 142117, 191138, 66651, 2000),
  ('S2', 2, 62495, 37295, 25200, 12499, 2000),
  ('S2', 3, 159703, 159703, 0, 31941, 2000),
  ('S2', 4, 1541044, 447297, 1093747, 308209, 2000),
  ('S2', 5, 31400, 2600, 28800, 6280, 2000),
  ('S2', 6, 4718355, 3367498, 1350857, 943671, 2000),
  ('S2', 7, 59103, 9183, 49920, 11820, 2000),
  ('S5', 1, 333255, 142117, 191138, 33325, 1000),
  ('S5', 2, 62495, 37295, 25200, 6250, 1000),
  ('S5', 3, 159703, 159703, 0, 15970, 1000),
  ('S5', 4, 1541044, 447297, 1093747, 308209, 2000),
  ('S5', 5, 31400, 2600, 28800, 6280, 2000),
  ('S5', 6, 4718355, 3367498, 1350857, 943671, 2000),
  ('S5', 7, 59103, 9183, 49920, 11820, 2000);

create temporary table c2_scenario (
  scenario text primary key,
  discount_amount integer not null,
  gross integer not null,
  discount integer not null,
  ht integer not null,
  tax integer not null,
  ttc integer not null,
  cost integer not null,
  coef numeric not null
) on commit drop;

insert into c2_scenario (scenario, discount_amount, gross, discount, ht, tax, ttc, cost, coef)
values
  ('S2', 101, 6905456, 101, 6905355, 1381071, 8286426, 5487177, 1.258453),
  ('S5', 101, 6905456, 101, 6905355, 1325525, 8230880, 5487177, 1.258453);

-- Récapitulatif par taux, par taux croissant (ordre du contexte figé de M4).
create temporary table c2_tax (
  scenario text not null,
  rate integer not null,
  base integer not null,
  tax integer not null,
  primary key (scenario, rate)
) on commit drop;

insert into c2_tax (scenario, rate, base, tax)
values
  ('S2', 2000, 6905355, 1381071),
  ('S5', 1000, 555453, 55545),
  ('S5', 2000, 6349902, 1269980);

select is(
  (
    select array_agg(scenario.scenario order by scenario.scenario)
    from c2_scenario scenario
    where scenario.gross <> (select sum(line.gross) from c2_line line)
      or scenario.ht <> (select sum(split.net) from c2_split split where split.scenario = scenario.scenario)
      or scenario.tax <> (select sum(split.tax) from c2_split split where split.scenario = scenario.scenario)
      or scenario.tax <> (select sum(tax.tax) from c2_tax tax where tax.scenario = scenario.scenario)
      or scenario.ht <> (select sum(tax.base) from c2_tax tax where tax.scenario = scenario.scenario)
      or scenario.ttc <> scenario.ht + scenario.tax
      or scenario.ht <> scenario.gross - scenario.discount
      or exists (
        select 1
        from c2_tax tax
        where tax.scenario = scenario.scenario
          and (
            tax.base <> (select sum(split.net) from c2_split split where split.scenario = tax.scenario and split.rate = tax.rate)
            or tax.tax <> round(tax.base::numeric * tax.rate / 10000)
            or tax.tax <> (select sum(split.tax) from c2_split split where split.scenario = tax.scenario and split.rate = tax.rate)
          )
      )
      or exists (
        select 1
        from c2_split split
        join c2_line line on line.ord = split.ord
        where split.scenario = scenario.scenario
          and (split.fo + split.mo <> split.net or split.net > line.gross or line.gross <> round(line.quantity * line.pu))
      )
  ),
  null::text[],
  'fixture: S2 and S5 reproduce §5.2 (Σ nets, Σ taxes, base and VAT per rate = ⌈base × rate⌋, gross = ⌈Q × PU⌋, FO + MO = net)'
);

-- ---------------------------------------------------------------------------
-- Comptes, entreprise, projet, rôles et politique 3 (forme de la suite 2.5).
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated', fixture.email,
  crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (
  values
    ('a3270000-0000-4000-8000-000000000001'::uuid, 'v3-contract2-owner@example.test'),
    ('a3270000-0000-4000-8000-000000000002'::uuid, 'v3-contract2-admin@example.test')
) as fixture(id, email);

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = 'a3270000-0000-4000-8000-000000000001';

update public.tenant_memberships
set is_default = false
where user_id = 'a3270000-0000-4000-8000-000000000002';

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select 'a3270000-0000-4000-8000-000000000004', owner_membership.tenant_id,
  'a3270000-0000-4000-8000-000000000002', 'admin'::public.tenant_role, true
from public.tenant_memberships owner_membership
where owner_membership.user_id = 'a3270000-0000-4000-8000-000000000001';

insert into c2_fx (key, value)
select 'tenant_a', to_jsonb(membership.tenant_id)
from public.tenant_memberships membership
where membership.user_id = 'a3270000-0000-4000-8000-000000000001';

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('a3270000-0000-4000-8000-000000000010', pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001',
  'Projet contrat client 2', false);

insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position)
values
  ('a3270000-0000-4000-8000-000000000020', pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001', 'Tuyauteur', 4000, true, 1),
  ('a3270000-0000-4000-8000-000000000021', pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001', 'Tuyauteur bis', 4000, true, 2);

-- Témoins v1 et v2 sans ligne, insérés avant la politique 3 (aucun montant à figer).
select is(
  array[
    pg_temp.v3_try(array[
      $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, date_devis, validite_jours)
         select 'a3270000-0000-4000-8000-000000000170', tenant_id, id, 50, 'draft', current_date, 30
         from public.estimate_projects where id = 'a3270000-0000-4000-8000-000000000010'$s$
    ]),
    pg_temp.v3_try(array[
      $s$select set_config('miaouffrage.estimate_version_insert_contract', 'canonical_v2', true)$s$,
      $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, date_devis, validite_jours)
         select 'a3270000-0000-4000-8000-000000000180', tenant_id, id, 51, 'draft', current_date, 30
         from public.estimate_projects where id = 'a3270000-0000-4000-8000-000000000010'$s$
    ])
  ],
  array['ok', 'ok'],
  'fixture: an empty v1 and an empty v2 draft witness of the contract 1 pairing'
);

select is(
  array(
    select calc_engine_version::integer from public.estimate_versions
    where id in ('a3270000-0000-4000-8000-000000000170', 'a3270000-0000-4000-8000-000000000180')
    order by id
  ),
  array[1, 2],
  'fixture: the witnesses are engine 1 and engine 2'
);

select is(
  pg_temp.v3_try(array[
    'set local role service_role',
    format(
      'select public.set_tenant_calc_policy(p_tenant_id => %L::uuid, p_new_estimate_calc_engine => 3::smallint, '
        'p_default_sale_coefficient_fo => 1.30, p_default_sale_coefficient_mo => 1.20, '
        'p_allowed_tax_rates_bp => ''{2000,1000,550,210}''::integer[], p_change_reason => ''Pilote émission v3'', '
        'p_actor_user_id => ''a3270000-0000-4000-8000-000000000002''::uuid)',
      pg_temp.fx('tenant_a')
    )
  ]),
  'ok',
  'fixture: service_role sets tenant A to engine 3 (1,30 / 1,20, 20 / 10 / 5,5 / 2,1 %)'
);

-- ---------------------------------------------------------------------------
-- Constructeurs (évalués par postgres avant tout changement de rôle).
-- ---------------------------------------------------------------------------
create function pg_temp.c2_version_payload(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_version, 'title', 'V3 ' || p_scenario, 'date_devis', current_date, 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0,
    'discount_bp', 0, 'discount_amount_cents', scenario.discount_amount, 'discount_mode', 'simple',
    'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000, 'rounding_mode', 'none',
    'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal', 'calc_engine_version', 3,
    'sale_coefficient_fo', 1.30, 'sale_coefficient_mo', 1.20, 'gross_ht_cents', scenario.gross,
    'discount_applied_cents', scenario.discount, 'commercial_rounding_cents', 0,
    'total_ht_cents', scenario.ht, 'total_tax_cents', scenario.tax, 'total_ttc_cents', scenario.ttc
  )
  from c2_scenario scenario
  where scenario.scenario = p_scenario
$$;

create function pg_temp.c2_items_payload(p_version uuid, p_scenario text, p_role uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(jsonb_build_object(
      'id', pg_temp.c2_item(p_version, 0), 'parent_id', null, 'item_type', 'section', 'position', 1, 'title', 'Lot oracle'
    ))
    || jsonb_agg(jsonb_build_object(
      'id', pg_temp.c2_item(p_version, line.ord), 'parent_id', pg_temp.c2_item(p_version, 0), 'item_type', 'line',
      'position', line.ord, 'title', 'O' || line.ord, 'quantity', line.quantity, 'unit_price_ht_cents', line.pr,
      'tax_rate_bp', split.rate, 'k_fo', 1, 'h_mo_majoration', 1, 'k_mo', 1, 'labor_role_id', p_role,
      'h_mo_per_unit', line.hu, 'unit_code', line.unit, 'pricing_status', 'priced', 'pu_ht_cents', line.pu,
      'line_total_ht_cents', split.net, 'line_tax_cents', split.tax, 'line_total_ttc_cents', split.net + split.tax
    ) order by line.ord)
  from c2_line line
  join c2_split split on split.ord = line.ord and split.scenario = p_scenario
$$;

create function pg_temp.c2_create_sql(p_version uuid, p_scenario text, p_role uuid)
returns text
language sql
stable
as $$
  select format(
    'select public.persist_estimate_creation_atomic(%L::uuid, %L::uuid, %L::uuid, null, %L::jsonb, %L::jsonb, null)',
    pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001', 'a3270000-0000-4000-8000-000000000010',
    pg_temp.c2_version_payload(p_version, p_scenario), pg_temp.c2_items_payload(p_version, p_scenario, p_role)
  )
$$;

create function pg_temp.c2_context(p_scenario text, p_role uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'engine', 3,
    'labor_split_enabled', false,
    'labor_roles', jsonb_build_array(jsonb_build_object('id', p_role, 'hourly_rate_cents', 4000)),
    'sale_coefficients', jsonb_build_object('fo', 1.3, 'mo', 1.2),
    'discount', jsonb_build_object('kind', 'amount', 'requested_cents', scenario.discount_amount, 'rate_bp', null,
      'base_cents', scenario.gross, 'applied_cents', scenario.discount),
    'commercial_rounding', jsonb_build_object('mode', 'none', 'step_cents', 1, 'applied_cents', 0),
    'cost_subtotal_cents', scenario.cost,
    'realized_sale_coefficient', scenario.coef,
    'tax_breakdown', (
      select jsonb_agg(jsonb_build_object('rate_bp', tax.rate, 'base_cents', tax.base, 'tax_cents', tax.tax) order by tax.rate)
      from c2_tax tax where tax.scenario = p_scenario
    )
  )
  from c2_scenario scenario
  where scenario.scenario = p_scenario
$$;

-- Colonnes figées (§6.2, D7) : sans ventilation, toute la MO est « chantier ».
create function pg_temp.c2_snapshots(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object(
    'id', pg_temp.c2_item(p_version, line.ord), 'snapshot_pu_ht_cents', line.pu, 'snapshot_gross_ht_cents', line.gross,
    'snapshot_gross_fo_ht_cents', line.gross_fo, 'snapshot_fo_ht_cents', split.fo, 'snapshot_mo_ht_cents', split.mo,
    'snapshot_mo_atelier_ht_cents', 0, 'snapshot_mo_chantier_ht_cents', split.mo, 'line_total_ht_cents', split.net,
    'line_tax_cents', split.tax, 'line_total_ttc_cents', split.net + split.tax
  ) order by line.ord)
  from c2_line line
  join c2_split split on split.ord = line.ord and split.scenario = p_scenario
$$;

create function pg_temp.c2_totals(p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'gross_ht_cents', scenario.gross, 'discount_applied_cents', scenario.discount, 'commercial_rounding_cents', 0,
    'total_ht_cents', scenario.ht, 'total_tax_cents', scenario.tax, 'total_ttc_cents', scenario.ttc,
    'rounding_adjustment_cents', 0
  )
  from c2_scenario scenario
  where scenario.scenario = p_scenario
$$;

-- Gel d'approbation de M4 (contrôle de la fixture contre le moteur SQL).
create function pg_temp.c2_approval_freeze_sql(p_version uuid, p_scenario text, p_role uuid)
returns text
language sql
stable
as $$
  select format(
    'select public.freeze_estimate_v3_snapshot(%1$L::uuid, %2$L::uuid, '
      '(select updated_at from public.estimate_versions where id = %1$L::uuid), '
      '(select content_revision from public.estimate_versions where id = %1$L::uuid), '
      '%3$L::uuid, ''approval'', %4$L::jsonb, %5$L::jsonb, %6$L::jsonb)',
    p_version, pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001',
    pg_temp.c2_context(p_scenario, p_role), pg_temp.c2_snapshots(p_version, p_scenario), pg_temp.c2_totals(p_scenario)
  )
$$;

-- Gel documentaire v3 de M5 (D15) : signature jumelle de freeze_estimate_v2_document_snapshot.
create function pg_temp.c2_document_freeze_sql(p_version uuid, p_scenario text, p_role uuid, p_session uuid)
returns text
language sql
stable
as $$
  select format(
    'select public.freeze_estimate_v3_document_snapshot(%1$L::uuid, %2$L::uuid, '
      '(select updated_at from public.estimate_versions where id = %1$L::uuid), '
      '(select content_revision from public.estimate_versions where id = %1$L::uuid), '
      '%3$L::uuid, %4$L::uuid, %5$L::jsonb, %6$L::jsonb, %7$L::jsonb)',
    p_version, pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001', p_session,
    pg_temp.c2_context(p_scenario, p_role), pg_temp.c2_snapshots(p_version, p_scenario), pg_temp.c2_totals(p_scenario)
  )
$$;

create function pg_temp.c2_claim_sql(p_version uuid)
returns text
language sql
stable
as $$
  select format(
    'select public.begin_estimate_pdf_generation(%L::uuid, %L::uuid, %L::uuid, ''manual'', null)',
    p_version, pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001'
  )
$$;

create function pg_temp.c2_layout()
returns jsonb
language sql
immutable
as $$
  select '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":false}'::jsonb
$$;

create function pg_temp.c2_company()
returns jsonb
language sql
immutable
as $$
  select '{"name":"Contrat client 2 SAS","tagline":"Entreprise de test synthétique","address":{"street":"1 rue du Test","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"2 rue du Test","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 27","mobile":"+33 6 00 00 00 27"},"legal":{"siret":"TEST-SIRET-27","vat":"TEST-VAT-27"}}'::jsonb
$$;

create function pg_temp.c2_sha()
returns text
language sql
immutable
as $$
  select repeat('27', 32)
$$;

create function pg_temp.c2_publish_sql(p_version uuid, p_contract jsonb)
returns text
language sql
stable
as $$
  select format(
    'select public.publish_estimate_pdf_generation(%1$L::uuid, %2$L::uuid, %3$L::uuid, '
      '(select document.generation_token from public.estimate_documents document where document.version_id = %1$L::uuid), '
      '%4$L, %5$L, 1024, %6$L::timestamptz, %7$L::jsonb, null, %8$L::jsonb)',
    p_version, pg_temp.fx('tenant_a'), 'a3270000-0000-4000-8000-000000000001',
    pg_temp.fx('tenant_a')::text || '/a3270000-0000-4000-8000-000000000010/' || p_version::text || '/' || pg_temp.c2_sha() || '.pdf',
    pg_temp.c2_sha(), '2026-10-17T12:00:00.000000Z', pg_temp.c2_layout(), p_contract
  )
$$;

-- Bloc version du contrat (identique au contrat 1, D14), lu sur la ligne courante.
create function pg_temp.c2_version_block(p_version uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', version.id, 'tenantId', version.tenant_id, 'projectId', version.project_id,
    'number', version.version_number, 'contentRevision', version.content_revision,
    'calcEngineVersion', version.calc_engine_version, 'dateDevis', version.date_devis,
    'validiteJours', version.validite_jours, 'currency', version.currency,
    'contractorRole', version.contractor_role, 'taxRateBp', version.tax_rate_bp)
  from public.estimate_versions version
  where version.id = p_version
$$;

-- Contrat client 2 (D14) d'une version oracle : lignes brutes, section = somme brute, pied v3.
create function pg_temp.c2_contract(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'schemaVersion', 2,
    'version', pg_temp.c2_version_block(p_version),
    'project', (select value -> 'project' from c2_fx where key = 'identity:' || p_version::text),
    'issuer', (select value -> 'issuer' from c2_fx where key = 'identity:' || p_version::text),
    'company', (select value -> 'company' from c2_fx where key = 'identity:' || p_version::text),
    'rows', jsonb_build_array(jsonb_build_object(
        'kind', 'section', 'id', pg_temp.c2_item(p_version, 0), 'parentId', null, 'position', 1, 'depth', 0,
        'title', 'Lot oracle', 'number', '01', 'saleHtCents', scenario.gross
      )) || (
      select jsonb_agg(jsonb_build_object(
        'kind', 'line', 'id', pg_temp.c2_item(p_version, line.ord), 'parentId', pg_temp.c2_item(p_version, 0),
        'position', line.ord, 'depth', 1, 'title', 'O' || line.ord, 'quantity', line.quantity,
        'unitCode', line.unit, 'unitLabel', line.symbol, 'pricingStatus', 'priced', 'taxRateBp', split.rate,
        'unitSaleHtCents', line.pu, 'saleHtCents', line.gross
      ) order by line.ord)
      from c2_line line
      join c2_split split on split.ord = line.ord and split.scenario = p_scenario
    ),
    'totals', jsonb_build_object(
      'grossHtCents', scenario.gross, 'commercialDiscountCents', scenario.discount,
      'discountIntent', jsonb_build_object('kind', 'amount'), 'commercialRoundingCents', 0,
      'netHtCents', scenario.ht,
      'taxByRate', (
        select jsonb_agg(jsonb_build_object('rateBp', tax.rate, 'baseHtCents', tax.base, 'taxCents', tax.tax) order by tax.rate)
        from c2_tax tax where tax.scenario = p_scenario
      ),
      'taxCents', scenario.tax, 'payableTtcCents', scenario.ttc, 'reverseCharge', false
    ),
    'exclusions', null
  )
  from c2_scenario scenario
  where scenario.scenario = p_scenario
$$;

-- Le même devis présenté au contrat client 1 (forme de 20261013130248 : lignes nettes).
create function pg_temp.c2_contract_v1(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'version', pg_temp.c2_version_block(p_version),
    'project', (select value -> 'project' from c2_fx where key = 'identity:' || p_version::text),
    'issuer', (select value -> 'issuer' from c2_fx where key = 'identity:' || p_version::text),
    'company', (select value -> 'company' from c2_fx where key = 'identity:' || p_version::text),
    'rows', jsonb_build_array(jsonb_build_object(
        'kind', 'section', 'id', pg_temp.c2_item(p_version, 0), 'parentId', null, 'position', 1, 'depth', 0,
        'title', 'Lot oracle', 'number', '1', 'saleHtCents', scenario.ht
      )) || (
      select jsonb_agg(jsonb_build_object(
        'kind', 'line', 'id', pg_temp.c2_item(p_version, line.ord), 'parentId', pg_temp.c2_item(p_version, 0),
        'position', line.ord, 'depth', 1, 'title', 'O' || line.ord, 'quantity', line.quantity, 'unit', line.unit,
        'unitSaleHtCents', line.pu, 'saleHtCents', split.net
      ) order by line.ord)
      from c2_line line
      join c2_split split on split.ord = line.ord and split.scenario = p_scenario
    ),
    'totals', jsonb_build_object('saleHtCents', scenario.ht, 'taxCents', scenario.tax,
      'calculatedTtcCents', scenario.ttc, 'payableTtcCents', scenario.ttc, 'roundingAdjustmentCents', 0),
    'exclusions', null
  )
  from c2_scenario scenario
  where scenario.scenario = p_scenario
$$;

-- Contrat d'une version sans ligne (témoins v1/v2), au schéma 1 ou 2.
create function pg_temp.c2_empty_contract(p_version uuid, p_schema integer)
returns jsonb
language sql
stable
as $$
  select case when p_schema = 1 then jsonb_build_object(
      'schemaVersion', 1, 'version', pg_temp.c2_version_block(p_version),
      'project', (select value -> 'project' from c2_fx where key = 'identity:' || p_version::text),
      'issuer', (select value -> 'issuer' from c2_fx where key = 'identity:' || p_version::text),
      'company', (select value -> 'company' from c2_fx where key = 'identity:' || p_version::text),
      'rows', '[]'::jsonb,
      'totals', (
        select jsonb_build_object('saleHtCents', version.total_ht_cents,
          'taxCents', version.total_tax_cents - coalesce(version.rounding_adjustment_cents, 0),
          'calculatedTtcCents', version.total_ht_cents + version.total_tax_cents - coalesce(version.rounding_adjustment_cents, 0),
          'payableTtcCents', version.total_ttc_cents, 'roundingAdjustmentCents', coalesce(version.rounding_adjustment_cents, 0))
        from public.estimate_versions version where version.id = p_version),
      'exclusions', null)
    else jsonb_build_object(
      'schemaVersion', 2, 'version', pg_temp.c2_version_block(p_version),
      'project', (select value -> 'project' from c2_fx where key = 'identity:' || p_version::text),
      'issuer', (select value -> 'issuer' from c2_fx where key = 'identity:' || p_version::text),
      'company', (select value -> 'company' from c2_fx where key = 'identity:' || p_version::text),
      'rows', '[]'::jsonb,
      'totals', jsonb_build_object('grossHtCents', 0, 'commercialDiscountCents', 0,
        'discountIntent', jsonb_build_object('kind', 'none'), 'commercialRoundingCents', 0, 'netHtCents', 0,
        'taxByRate', '[]'::jsonb, 'taxCents', 0, 'payableTtcCents', 0, 'reverseCharge', false),
      'exclusions', null)
    end
$$;

create function pg_temp.c2_add(p_contract jsonb, p_path text[], p_delta bigint)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_contract, p_path, to_jsonb((p_contract #>> p_path)::bigint + p_delta))
$$;

create function pg_temp.c2_set(p_contract jsonb, p_path text[], p_value jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(p_contract, p_path, p_value)
$$;

create function pg_temp.c2_valid(p_contract jsonb)
returns text
language sql
stable
as $$
  select pg_temp.v3_probe(null, format(
    'select public.estimate_offer_client_valid_v2(%L::jsonb, %L::jsonb)::text', p_contract, pg_temp.c2_layout()))
$$;

create function pg_temp.c2_publish(p_version uuid, p_contract jsonb)
returns text
language sql
stable
as $$
  select pg_temp.v3_probe(array['set local role service_role', pg_temp.c2_publish_sql(p_version, p_contract)])
$$;

-- « exacte | altérée » : la même publication accepte le contrat exact et refuse l'altération.
create function pg_temp.c2_pair(p_version uuid, p_scenario text, p_altered jsonb)
returns text
language sql
stable
as $$
  select pg_temp.c2_publish(p_version, pg_temp.c2_contract(p_version, p_scenario)) || ' | ' ||
    pg_temp.c2_publish(p_version, p_altered)
$$;

-- Refus nommés d'une publication de contrat : invalide en soi, ou différent du devis figé.
create function pg_temp.c2_refused_pattern()
returns text
language sql
immutable
as $$
  select '^ok \| (22023 ESTIMATE_PDF_PUBLICATION_INVALID|23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH)$'
$$;

-- ---------------------------------------------------------------------------
-- Versions v3 S2, S5 et de fraîcheur, créées par la RPC canonique sous la politique 3 (M4), et
-- l'identité d'offre capturée pour leur propriétaire.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_create_sql(
      'a3270000-0000-4000-8000-000000000120', 'S2', 'a3270000-0000-4000-8000-000000000020')]),
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_create_sql(
      'a3270000-0000-4000-8000-000000000150', 'S5', 'a3270000-0000-4000-8000-000000000020')]),
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_create_sql(
      'a3270000-0000-4000-8000-000000000160', 'S2', 'a3270000-0000-4000-8000-000000000021')])
  ],
  array['ok', 'ok', 'ok'],
  'fixture: S2, S5 and the freshness version are created as v3 drafts by the canonical RPC (M4)'
);

select is(
  (
    select array_agg(concat_ws('|', version.calc_engine_version, version.gross_ht_cents, version.discount_applied_cents,
      version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents) order by version.id)
    from public.estimate_versions version
    where version.id in ('a3270000-0000-4000-8000-000000000120', 'a3270000-0000-4000-8000-000000000150',
      'a3270000-0000-4000-8000-000000000160')
  ),
  array['3|6905456|101|6905355|1381071|8286426', '3|6905456|101|6905355|1325525|8230880', '3|6905456|101|6905355|1381071|8286426'],
  'fixture: stored S2 (TVA 1 381 071) and S5 (TVA 55 545 + 1 269 980) totals, gross 6 905 456 and discount 101'
);

select is(
  array[
    pg_temp.v3_probe(array['set local role service_role', pg_temp.c2_approval_freeze_sql(
      'a3270000-0000-4000-8000-000000000120', 'S2', 'a3270000-0000-4000-8000-000000000020')]),
    pg_temp.v3_probe(array['set local role service_role', pg_temp.c2_approval_freeze_sql(
      'a3270000-0000-4000-8000-000000000150', 'S5', 'a3270000-0000-4000-8000-000000000020')])
  ],
  array['ok', 'ok'],
  'fixture: the SQL engine of M4 freezes exactly these S2 and S5 projections (approval freeze, rolled back)'
);

select is(
  pg_temp.v3_try(array[
    'set local role service_role',
    $s$insert into c2_fx (key, value)
       select 'identity:' || version.id::text, public.capture_estimate_offer_identity(version,
         'a3270000-0000-4000-8000-000000000001', pg_temp.c2_company())
       from public.estimate_versions version where version.project_id = 'a3270000-0000-4000-8000-000000000010'$s$
  ]),
  'ok',
  'fixture: the offer identity (project, issuer, company) of the renderer is captured per version (reference suffix _V<n>)'
);

insert into public.draft_locks (id, version_id, user_id, tenant_id, locked_at, expires_at, session_id)
select fixture.id, fixture.version_id, 'a3270000-0000-4000-8000-000000000001', pg_temp.fx('tenant_a'), now(),
  now() + interval '30 minutes', fixture.session_id
from (
  values
    ('a3270000-0000-4000-8000-000000000312'::uuid, 'a3270000-0000-4000-8000-000000000120'::uuid, 'a3270000-0000-4000-8000-000000000412'::uuid),
    ('a3270000-0000-4000-8000-000000000315'::uuid, 'a3270000-0000-4000-8000-000000000150'::uuid, 'a3270000-0000-4000-8000-000000000415'::uuid),
    ('a3270000-0000-4000-8000-000000000316'::uuid, 'a3270000-0000-4000-8000-000000000160'::uuid, 'a3270000-0000-4000-8000-000000000416'::uuid),
    ('a3270000-0000-4000-8000-000000000317'::uuid, 'a3270000-0000-4000-8000-000000000170'::uuid, 'a3270000-0000-4000-8000-000000000417'::uuid),
    ('a3270000-0000-4000-8000-000000000318'::uuid, 'a3270000-0000-4000-8000-000000000180'::uuid, 'a3270000-0000-4000-8000-000000000418'::uuid)
) as fixture(id, version_id, session_id);

-- ---------------------------------------------------------------------------
-- F27-01 : structure de M5 (§6.1, D14, D15), réservée à service_role.
-- ---------------------------------------------------------------------------
select has_function('public', 'estimate_offer_client_valid_v2', array['jsonb', 'jsonb'],
  'F27-01 the client contract 2 validator exists');
select has_function('public', 'estimate_offer_client_items_match_v2', array['jsonb', 'estimate_versions'],
  'F27-01 the client contract 2 item match exists');
select has_function('public', 'freeze_estimate_v3_document_snapshot',
  array['uuid', 'uuid', 'timestamp with time zone', 'bigint', 'uuid', 'uuid', 'jsonb', 'jsonb', 'jsonb'],
  'F27-01 the v3 document freeze exists with the signature of freeze_estimate_v2_document_snapshot (D15)');

select is(
  pg_temp.v3_probe(null, $a$
    select array[
      has_function_privilege('service_role', 'public.estimate_offer_client_valid_v2(jsonb,jsonb)', 'execute'),
      has_function_privilege('authenticated', 'public.estimate_offer_client_valid_v2(jsonb,jsonb)', 'execute'),
      has_function_privilege('anon', 'public.estimate_offer_client_valid_v2(jsonb,jsonb)', 'execute'),
      has_function_privilege('service_role', 'public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions)', 'execute'),
      has_function_privilege('authenticated', 'public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions)', 'execute'),
      has_function_privilege('service_role', 'public.freeze_estimate_v3_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)', 'execute'),
      has_function_privilege('authenticated', 'public.freeze_estimate_v3_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)', 'execute'),
      has_function_privilege('anon', 'public.freeze_estimate_v3_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)', 'execute')
    ]::text
  $a$),
  'ok:{t,f,f,t,f,t,f,f}',
  'F27-01 the contract 2 validators and the v3 document freeze are executable by service_role only'
);

-- ---------------------------------------------------------------------------
-- F27-02 à F27-07 : validateur strict du contrat 2 (D14), sur S2 et S5 en mémoire.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2')),
    pg_temp.c2_valid(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'))
  ],
  array['ok:true', 'ok:true'],
  'F27-02 the exact S2 (one rate) and S5 (two rates) client contracts 2 are valid'
);

select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,saleHtCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,0,saleHtCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'),
      '{rows,1,saleHtCents}', 1), '{rows,2,saleHtCents}', -1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,4,unitSaleHtCents}', 1))
  ],
  array_fill('ok:false'::text, array[4]),
  'F27-03 a line or section altered by 1 c is invalid: Σ lines ≠ gross, section ≠ Σ of its lines, or PT ≠ ⌈Q × PU⌋ (even with the sums kept)'
);

select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{totals,commercialDiscountCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{totals,netHtCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{totals,grossHtCents}', 1))
  ],
  array_fill('ok:false'::text, array[3]),
  'F27-04 discount, net or gross altered by 1 c is invalid: net ≠ gross − discount − rounding or Σ lines ≠ gross'
);

select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'), '{totals,taxByRate,0,baseHtCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'),
      '{totals,taxByRate,0,taxCents}', 1), '{totals,taxCents}', 1), '{totals,payableTtcCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'),
      '{totals,taxCents}', 1), '{totals,payableTtcCents}', 1)),
    pg_temp.c2_valid(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'), '{totals,payableTtcCents}', 1))
  ],
  array_fill('ok:false'::text, array[4]),
  'F27-05 S5: a rate base +1 c (Σ bases ≠ net), a rate VAT +1 c (≠ ⌈base × rate⌋), Σ VAT by rate ≠ VAT, or TTC ≠ net + VAT is invalid'
);

select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,unitPriceRaw}', '1')),
    pg_temp.c2_valid(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2') #- '{rows,1,unitCode}'),
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{totals,roundingAdjustmentCents}', '0')),
    pg_temp.c2_valid(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2') #- '{totals,taxByRate}'),
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{marginBp}', '0'))
  ],
  array_fill('ok:false'::text, array[5]),
  'F27-06 a key added to or removed from a line, the totals or the contract is invalid (strict keys)'
);

select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,5,pricingStatus}', '"gratuit"')),
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,5,pricingStatus}', '"included"')),
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,unitCode}', '""')),
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{totals,discountIntent,kind}', '"bogus"'))
  ],
  array_fill('ok:false'::text, array[4]),
  'F27-07 an unknown status, a non-priced line that still carries an amount, an empty unit or an unknown discount intent is invalid'
);

select is(
  array[
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{version,calcEngineVersion}', '2')),
    pg_temp.c2_valid(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{schemaVersion}', '1')),
    pg_temp.c2_valid(pg_temp.c2_contract_v1('a3270000-0000-4000-8000-000000000120', 'S2'))
  ],
  array_fill('ok:false'::text, array[3]),
  'F27-08 contract 2 is reserved to engine 3: engine 2, schema 1 or the contract 1 shape is invalid'
);

-- ---------------------------------------------------------------------------
-- F27-09 à F27-11 : gel documentaire v3, réclamation et appariement exact au devis figé (S2).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array['set local role service_role', pg_temp.c2_document_freeze_sql(
    'a3270000-0000-4000-8000-000000000120', 'S2', 'a3270000-0000-4000-8000-000000000020',
    'a3270000-0000-4000-8000-000000000412')]),
  'ok',
  'F27-09 the exact S2 projection is frozen for its document under the exact page-session lease'
);

select is(
  pg_temp.v3_probe(null, $a$
    select concat_ws('|', (calc_snapshot_content_revision = content_revision)::text, calc_snapshot_context->>'engine',
      (calc_snapshot_context->'tax_breakdown')::text)
    from public.estimate_versions where id = 'a3270000-0000-4000-8000-000000000120'
  $a$),
  'ok:true|3|[{"rate_bp": 2000, "tax_cents": 1381071, "base_cents": 6905355}]',
  'F27-09 the S2 document freeze is fresh and stores the v3 context with its VAT by rate'
);

select is(
  array[
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_claim_sql('a3270000-0000-4000-8000-000000000120')]),
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_claim_sql('a3270000-0000-4000-8000-000000000160')])
  ],
  array['ok', 'ok'],
  'F27-09 a v3 draft, frozen or not, can claim a manual PDF generation (the M1 refusal of every v3 document is lifted)'
);

select is(
  pg_temp.c2_publish('a3270000-0000-4000-8000-000000000120', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2')),
  'ok',
  'F27-10 the exact S2 client contract 2 is published against the frozen v3'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'),
      '{rows,1,saleHtCents}', 1), '{rows,2,saleHtCents}', -1)),
  pg_temp.c2_refused_pattern(),
  'F27-10 publication: 1 c moved between two lines (sums kept) is refused while the exact contract passes'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'),
      '{totals,commercialDiscountCents}', 1), '{totals,netHtCents}', -1), '{totals,taxByRate,0,baseHtCents}', -1),
      '{totals,payableTtcCents}', -1)),
  pg_temp.c2_refused_pattern(),
  'F27-10 publication: a discount of 1,02 € with a consistent net, base and TTC (VAT unchanged by rounding) is refused against the frozen 1,01 €'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_set(pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'),
      '{rows,1,unitCode}', '"u"'), '{rows,1,unitLabel}', '"u"')),
  pg_temp.c2_refused_pattern(),
  'F27-10 publication: a unit altered to another valid unit (O1 ml → u) is refused'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,5,pricingStatus}', '"included"')),
  pg_temp.c2_refused_pattern(),
  'F27-10 publication: a status altered (O5 priced → included) is refused'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,taxRateBp}', '1000')),
  pg_temp.c2_refused_pattern(),
  'F27-10 publication: a line VAT rate altered (O1 20 % → 10 %) is refused'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,costHtCents}', '268600')),
  pg_temp.c2_refused_pattern(),
  'F27-10 publication: a key added to a line (a cost) is refused'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_contract_v1('a3270000-0000-4000-8000-000000000120', 'S2')),
  pg_temp.c2_refused_pattern(),
  'F27-11 publication: a v3 with the contract 1 is refused while its contract 2 passes'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
    pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{version,calcEngineVersion}', '2')),
  pg_temp.c2_refused_pattern(),
  'F27-11 publication: a contract 2 that names engine 2 for a v3 is refused'
);

-- ---------------------------------------------------------------------------
-- F27-12 : base ou TVA d'un taux altérée d'1 c (S5, deux taux).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array[
    'set local role service_role',
    pg_temp.c2_document_freeze_sql('a3270000-0000-4000-8000-000000000150', 'S5', 'a3270000-0000-4000-8000-000000000020',
      'a3270000-0000-4000-8000-000000000415'),
    pg_temp.c2_claim_sql('a3270000-0000-4000-8000-000000000150')
  ]),
  'ok',
  'F27-12 the exact S5 projection (10 % and 20 %) is frozen for its document, then claims its PDF generation'
);

select is(
  pg_temp.c2_publish('a3270000-0000-4000-8000-000000000150', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5')),
  'ok',
  'F27-12 the exact S5 client contract 2 (10 %: 5 554,53 / 555,45 ; 20 %: 63 499,02 / 12 699,80) is published'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000150', 'S5',
    pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'),
      '{totals,taxByRate,0,baseHtCents}', 1), '{totals,taxByRate,1,baseHtCents}', -1)),
  pg_temp.c2_refused_pattern(),
  'F27-12 publication: 1 c of base moved from 20 % to 10 % (Σ bases and VAT unchanged by rounding) is refused'
);

select matches(
  pg_temp.c2_pair('a3270000-0000-4000-8000-000000000150', 'S5',
    pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_add(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'),
      '{totals,taxByRate,0,taxCents}', 1), '{totals,taxCents}', 1), '{totals,payableTtcCents}', 1)),
  pg_temp.c2_refused_pattern(),
  'F27-12 publication: the 10 % VAT altered by 1 c (with a consistent total and TTC) is refused'
);

-- ---------------------------------------------------------------------------
-- F27-13 : appariement exact du contrat 2 aux lignes et au pied figés.
-- ---------------------------------------------------------------------------
create function pg_temp.c2_match(p_version uuid, p_contract jsonb)
returns text
language sql
stable
as $$
  select pg_temp.v3_probe(array['set local role service_role'], format(
    'select public.estimate_offer_client_items_match_v2(%L::jsonb, version)::text from public.estimate_versions version where version.id = %L::uuid',
    p_contract, p_version))
$$;

select is(
  array[
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2')),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120', pg_temp.c2_add(pg_temp.c2_add(
      pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,saleHtCents}', 1), '{rows,2,saleHtCents}', -1)),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120', pg_temp.c2_set(pg_temp.c2_set(
      pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,1,unitCode}', '"u"'), '{rows,1,unitLabel}', '"u"')),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120', pg_temp.c2_set(
      pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,5,pricingStatus}', '"included"')),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000150', pg_temp.c2_add(pg_temp.c2_add(
      pg_temp.c2_contract('a3270000-0000-4000-8000-000000000150', 'S5'), '{totals,taxByRate,0,baseHtCents}', 1),
      '{totals,taxByRate,1,baseHtCents}', -1)),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000160', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000160', 'S2'))
  ],
  array['ok:true', 'ok:false', 'ok:false', 'ok:false', 'ok:false', 'ok:false'],
  'F27-13 the contract 2 item match accepts the frozen S2 and refuses a 1 c line shift, a unit, a status, a base shift between rates, and a never-frozen v3'
);

-- ---------------------------------------------------------------------------
-- F27-20, F27-21 : ordre des lignes et numéros de section du contrat 2 (revue Codex de 37440c82, C4). Le portail et
-- le PDF rendent les lignes dans l'ordre du tableau avec leur `number`, et le sceau les couvre : la copie suit le
-- parcours préfixe de l'arbre stocké (frères par position) et chaque section porte le numéro qui en découle, comme
-- computeEstimateItemNumbering (racine sur deux chiffres au moins, puis rang parmi tous les frères, lignes comprises).
-- Isolation (AGENTS.md) : seule la publication service_role reçoit un contrat présenté ; la route PDF ne prend qu'une
-- mise en page et construit le contrat côté serveur, authenticated ne lit que estimate_documents. Aucun parcours ne
-- peut donc présenter une copie réordonnée ou renumérotée.
-- ---------------------------------------------------------------------------
create function pg_temp.c2_swap(p_contract jsonb, p_left integer, p_right integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(jsonb_set(p_contract, array['rows', p_left::text], p_contract -> 'rows' -> p_right),
    array['rows', p_right::text], p_contract -> 'rows' -> p_left)
$$;

select is(
  array[
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2')),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120',
      pg_temp.c2_swap(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), 1, 2)),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120', (select jsonb_set(contract, '{rows}',
      (contract -> 'rows' - 0) || jsonb_build_array(contract -> 'rows' -> 0))
      from pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2') contract)),
    pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
      pg_temp.c2_swap(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), 1, 2))
  ],
  array['ok:true', 'ok:false', 'ok:false', 'ok | 23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH'],
  'F27-20 the contract 2 item match refuses rows out of the stored order (O1 and O2 swapped, the section after its lines), and publication refuses them by name'
);

select is(
  array[
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120',
      pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,0,number}', '"02"')),
    pg_temp.c2_match('a3270000-0000-4000-8000-000000000120',
      pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,0,number}', '"1"')),
    pg_temp.c2_pair('a3270000-0000-4000-8000-000000000120', 'S2',
      pg_temp.c2_set(pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'), '{rows,0,number}', '"02"'))
  ],
  array['ok:false', 'ok:false', 'ok | 23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH'],
  'F27-21 the contract 2 item match refuses a section number other than the derived 01 ("02", "1"), and publication refuses it by name'
);

-- Arbre v3 imbriqué, oracle indépendant écrit d'après computeEstimateItemNumbering : racines 01 et 02 (positions 5 et
-- 9), douze frères sous 01 dont la section de rang 12 (01.12), une section de profondeur 2 après une ligne (01.2.2).
-- Les identifiants décroissent quand la position croît. Les lignes copient la ligne O1 figée de S2 ; elles sont
-- écrites hors déclencheurs (session_replication_role, sous-bloc annulé) sous une version synthétique au gel frais.
create function pg_temp.c2n_id(p_index integer)
returns uuid
language sql
immutable
as $$
  select ('a3270000-0000-4000-8002-0000000001' || lpad((99 - p_index)::text, 2, '0'))::uuid
$$;

create function pg_temp.c2n_tree()
returns table(ord integer, parent integer, kind text, pos integer, depth integer, number text)
language sql
immutable
as $$
  select * from (values
    (1, null::integer, 'section', 5, 0, '01'), (2, 1, 'line', 1, 1, null::text), (3, 1, 'section', 2, 1, '01.2'),
    (4, 3, 'line', 1, 2, null), (5, 3, 'section', 2, 2, '01.2.2'), (6, 5, 'line', 1, 3, null),
    (7, 1, 'line', 3, 1, null), (8, 1, 'line', 4, 1, null), (9, 1, 'line', 5, 1, null), (10, 1, 'line', 6, 1, null),
    (11, 1, 'line', 7, 1, null), (12, 1, 'line', 8, 1, null), (13, 1, 'line', 9, 1, null), (14, 1, 'line', 10, 1, null),
    (15, 1, 'line', 11, 1, null), (16, 1, 'section', 12, 1, '01.12'), (17, 16, 'line', 1, 2, null),
    (18, null, 'section', 9, 0, '02'), (19, 18, 'line', 1, 1, null)
  ) tree(ord, parent, kind, pos, depth, number)
$$;

-- Contrat de l'arbre, lignes dans l'ordre `p_order` (ordre préfixe par défaut) ; pied nul, comme la version synthétique.
create function pg_temp.c2n_contract(p_order integer[] default array(select generate_series(1, 19)))
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'rows', jsonb_agg(case when tree.kind = 'section'
      then jsonb_build_object('kind', 'section', 'id', pg_temp.c2n_id(tree.ord), 'parentId', pg_temp.c2n_id(tree.parent),
        'position', tree.pos, 'depth', tree.depth, 'title', 'N' || tree.ord, 'number', tree.number, 'saleHtCents', 0)
      else jsonb_build_object('kind', 'line', 'id', pg_temp.c2n_id(tree.ord), 'parentId', pg_temp.c2n_id(tree.parent),
        'position', tree.pos, 'depth', tree.depth, 'title', 'N' || tree.ord, 'quantity', source.quantity,
        'unitCode', source.unit_code, 'unitLabel', unit.symbol, 'pricingStatus', source.pricing_status,
        'taxRateBp', source.tax_rate_bp, 'unitSaleHtCents', source.snapshot_pu_ht_cents,
        'saleHtCents', source.snapshot_gross_ht_cents) end
      order by array_position(p_order, tree.ord)),
    'totals', jsonb_build_object('grossHtCents', 0, 'commercialDiscountCents', 0, 'commercialRoundingCents', 0,
      'netHtCents', 0, 'taxCents', 0, 'payableTtcCents', 0, 'reverseCharge', false,
      'discountIntent', jsonb_build_object('kind', 'none'), 'taxByRate', '[]'::jsonb))
  from pg_temp.c2n_tree() tree
  cross join public.estimate_items source
  left join public.measurement_units unit on unit.code = source.unit_code
  where source.id = pg_temp.c2_item('a3270000-0000-4000-8000-000000000120', 1)
$$;

create function pg_temp.c2n_match(p_contract jsonb)
returns text
language sql
stable
as $$
  select pg_temp.v3_probe(array[
      'set local session_replication_role = replica',
      $s$insert into public.estimate_items
        select (jsonb_populate_record(source, jsonb_build_object('id', pg_temp.c2n_id(tree.ord),
          'version_id', 'a3270000-0000-4000-8002-000000000000', 'parent_id', pg_temp.c2n_id(tree.parent),
          'position', tree.pos, 'title', 'N' || tree.ord))).*
        from pg_temp.c2n_tree() tree
        join public.estimate_items source on source.id = pg_temp.c2_item('a3270000-0000-4000-8000-000000000120',
          case when tree.kind = 'section' then 0 else 1 end)$s$,
      'set local session_replication_role = origin',
      'set local role service_role'
    ],
    format('select public.estimate_offer_client_items_match_v2(%L::jsonb, %L::public.estimate_versions)::text', p_contract,
      (select jsonb_populate_record(version, jsonb_build_object('id', 'a3270000-0000-4000-8002-000000000000',
        'content_revision', 1, 'calc_snapshot_content_revision', 1,
        'calc_snapshot_context', jsonb_build_object('engine', 3, 'discount', jsonb_build_object('kind', 'none'), 'tax_breakdown', '[]'::jsonb),
        'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0, 'total_ht_cents', 0,
        'total_tax_cents', 0, 'total_ttc_cents', 0, 'rounding_adjustment_cents', 0, 'contractor_role', 'principal'))
       from public.estimate_versions version where version.id = 'a3270000-0000-4000-8000-000000000120')))
$$;

select is(
  array[
    pg_temp.c2n_match(pg_temp.c2n_contract()),
    pg_temp.c2n_match(pg_temp.c2_set(pg_temp.c2n_contract(), '{rows,15,number}', '"01.012"')),
    pg_temp.c2n_match(pg_temp.c2_set(pg_temp.c2n_contract(), '{rows,4,number}', '"01.2.1"')),
    pg_temp.c2n_match(pg_temp.c2n_contract(array[1, 2, 3, 4, 5, 6, 16, 17, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19])),
    pg_temp.c2n_match(pg_temp.c2n_contract(array[18, 19, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]))
  ],
  array['ok:true', 'ok:false', 'ok:false', 'ok:false', 'ok:false'],
  'F27-21 nested tree: the exact pre-order with 01, 01.2, 01.2.2, 01.12, 02 matches; 01.012, a rank among sections only (01.2.1), a sibling block or a root block out of order does not'
);

-- ---------------------------------------------------------------------------
-- F27-14, F27-15 : publication sans gel document v3 frais.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.c2_publish('a3270000-0000-4000-8000-000000000160', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000160', 'S2')),
  '^(23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH|40001 ESTIMATE_V[23]_(DOCUMENT_)?SNAPSHOT_STALE)$',
  'F27-14 the exact contract 2 of a v3 that was never frozen for its document is refused by name'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_versions set status = 'sending' where id = 'a3270000-0000-4000-8000-000000000160'$s$
  ]),
  '40001 ESTIMATE_V2_SNAPSHOT_STALE',
  'F27-14 a never-frozen v3 cannot move to sending: the inherited freshness refusal replaces ESTIMATE_V3_EMISSION_NOT_READY'
);

select is(
  pg_temp.v3_try(array[
    'set local role service_role',
    pg_temp.c2_document_freeze_sql('a3270000-0000-4000-8000-000000000160', 'S2', 'a3270000-0000-4000-8000-000000000021',
      'a3270000-0000-4000-8000-000000000416'),
    pg_temp.c2_claim_sql('a3270000-0000-4000-8000-000000000160')
  ]),
  'ok',
  'F27-15 fixture: the freshness version is frozen for its document (role bis), then claims again'
);

select is(
  pg_temp.c2_publish('a3270000-0000-4000-8000-000000000160', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000160', 'S2')),
  'ok',
  'F27-15 once frozen, the exact contract 2 of the freshness version is published'
);

select matches(
  pg_temp.v3_probe(array[
    $s$update public.labor_roles set hourly_rate_cents = 4100 where id = 'a3270000-0000-4000-8000-000000000021'$s$,
    'set local role service_role',
    pg_temp.c2_publish_sql('a3270000-0000-4000-8000-000000000160', pg_temp.c2_contract('a3270000-0000-4000-8000-000000000160', 'S2'))
  ]),
  '^(23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH|40001 ESTIMATE_V[23]_(DOCUMENT_)?SNAPSHOT_STALE)$',
  'F27-15 a document freeze made stale (hourly rate of a cited role changed) blocks the publication of the same contract'
);

-- ---------------------------------------------------------------------------
-- F27-16, F27-17 : contrat 1 inchangé ; une v1/v2 ne reçoit jamais le contrat 2 (témoins).
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_claim_sql('a3270000-0000-4000-8000-000000000170')]),
    pg_temp.v3_try(array['set local role service_role', pg_temp.c2_claim_sql('a3270000-0000-4000-8000-000000000180')])
  ],
  array['ok', 'ok'],
  'F27-16 fixture: the v1 and v2 witnesses claim a manual PDF generation'
);

select is(
  (
    select array_agg(result.value order by result.ordinality)
    from unnest(array[
      pg_temp.c2_publish('a3270000-0000-4000-8000-000000000170', pg_temp.c2_empty_contract('a3270000-0000-4000-8000-000000000170', 2)),
      pg_temp.c2_publish('a3270000-0000-4000-8000-000000000170', pg_temp.c2_set(
        pg_temp.c2_empty_contract('a3270000-0000-4000-8000-000000000170', 2), '{version,calcEngineVersion}', '3')),
      pg_temp.c2_publish('a3270000-0000-4000-8000-000000000180', pg_temp.c2_empty_contract('a3270000-0000-4000-8000-000000000180', 2)),
      pg_temp.c2_publish('a3270000-0000-4000-8000-000000000180', pg_temp.c2_set(
        pg_temp.c2_empty_contract('a3270000-0000-4000-8000-000000000180', 2), '{version,calcEngineVersion}', '3'))
    ]) with ordinality as result(value, ordinality)
    where result.value not in ('22023 ESTIMATE_PDF_PUBLICATION_INVALID', '23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH')
  ),
  null::text[],
  'F27-16 a v1 or a v2 never publishes a contract 2, even one that claims engine 3 (pairing witness, green before M5)'
);

select is(
  pg_temp.v3_try(array['set local role service_role', pg_temp.c2_publish_sql('a3270000-0000-4000-8000-000000000170',
    pg_temp.c2_empty_contract('a3270000-0000-4000-8000-000000000170', 1))]),
  'ok',
  'F27-17 the v1 witness still publishes its contract 1 (behaviour of 20261013130248 unchanged)'
);

select is(
  pg_temp.v3_probe(array['set local role service_role'], $a$
    select concat_ws('|', document.status, document.client_contract_version,
      public.estimate_offer_document_valid(document, version, false)::text)
    from public.estimate_documents document join public.estimate_versions version on version.id = document.version_id
    where document.version_id = 'a3270000-0000-4000-8000-000000000170'
  $a$),
  'ok:ready|1|true',
  'F27-17 the v1 witness document is ready under contract 1 and valid'
);

-- ---------------------------------------------------------------------------
-- F27-18, F27-19 : émission manuelle d'une v3 S2 : contrat 2 et marqueur de sceau 5.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array['set local role service_role', pg_temp.c2_publish_sql('a3270000-0000-4000-8000-000000000120',
    pg_temp.c2_contract('a3270000-0000-4000-8000-000000000120', 'S2'))]),
  'ok',
  'F27-18 the S2 document is published under its client contract 2'
);

select is(
  pg_temp.v3_probe(array['set local role service_role'], $a$
    select concat_ws('|', document.status, document.client_contract_version,
      (document.client_contract_snapshot->'totals'->>'netHtCents'),
      public.estimate_offer_document_valid(document, version, false)::text)
    from public.estimate_documents document join public.estimate_versions version on version.id = document.version_id
    where document.version_id = 'a3270000-0000-4000-8000-000000000120'
  $a$),
  'ok:ready|2|6905355|true',
  'F27-18 the S2 document is ready, carries contract 2 (net 6 905 355) and is a valid offer document'
);

select is(
  pg_temp.v3_try(array['set local role service_role', format(
    'select public.transition_estimate_draft_to_sent(%1$L::uuid, %2$L::uuid, '
      '(select updated_at from public.estimate_versions where id = %1$L::uuid), ''sent''::public.estimate_status, %3$L, '
      '%4$L::uuid, ''{}''::jsonb, null, 5::smallint, '
      '(select public.estimate_offer_document_proof(document, version) from public.estimate_documents document '
      'join public.estimate_versions version on version.id = document.version_id where document.version_id = %1$L::uuid), %5$L::uuid)',
    'a3270000-0000-4000-8000-000000000120', pg_temp.fx('tenant_a'), repeat('5a', 32),
    'a3270000-0000-4000-8000-000000000001', 'a3270000-0000-4000-8000-000000000412')]),
  'ok',
  'F27-19 the frozen S2 v3 with its contract 2 document is issued manually under seal marker 5'
);

select is(
  pg_temp.v3_probe(array['set local role service_role'], $a$
    select concat_ws('|', version.status, version.seal_payload_version, version.seal_hash,
      version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents,
      (version.calc_snapshot_content_revision = version.content_revision)::text,
      public.estimate_offer_document_valid(document, version, false)::text)
    from public.estimate_versions version join public.estimate_documents document on document.version_id = version.id
    where version.id = 'a3270000-0000-4000-8000-000000000120'
  $a$),
  'ok:sent|5|' || repeat('5a', 32) || '|6905355|1381071|8286426|true|true',
  'F27-19 the issued S2 keeps marker 5, its seal, its S2 amounts, a fresh freeze and a valid contract 2 document'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_documents set client_contract_snapshot = jsonb_set(client_contract_snapshot, '{totals,netHtCents}', '6905356')
       where version_id = 'a3270000-0000-4000-8000-000000000120'$s$
  ]),
  '42501 OFFER_DOCUMENT_IMMUTABLE',
  'F27-19 the contract 2 of an issued v3 cannot be rewritten'
);

select * from finish();
rollback;
