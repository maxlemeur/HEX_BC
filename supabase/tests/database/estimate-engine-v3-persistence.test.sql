-- Lot 2, sous-lot 2.5 : persistance, gel et règles v3, derrière la politique d'entreprise (M4).
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md, D2 à D9, D12,
-- D14, D15, D17, D18, §4, §5 (O1-O7, S1-S3, EUHIST, T-MARG), §6.2 à §6.5, §7, §14 (2.5).
-- Défaillances visées et contrat supposé : docs/testing/estimate-engine-v3-2.5.md (F25-01 à F25-19).
--
-- Écrite rouge avant M4. Toute lecture ou écriture d'un objet de M4 passe par pg_temp.v3_probe
-- (sous-bloc toujours annulé) ou pg_temp.v3_try (sous-bloc conservé s'il réussit) : avant M4,
-- chaque assertion échoue sur son propre motif (table, colonne, fonction ou refus absents) et la
-- suite va jusqu'au bout sans interrompre la transaction. Fixtures insérées par postgres dans la
-- transaction, annulées à la fin.
--
-- Montants : les sept lignes-oracle du §5.1 (nombres seuls) et les totaux S1, S2, S3 du §5.2.
-- Répartitions par ligne (remise, TVA, FO/MO) recalculées selon le §4 en décimal exact ; la table
-- de fixture est contrôlée contre les totaux du §5.2 par la première assertion.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Sondes.
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

-- Comme v3_probe, mais conserve les écritures si toutes les instructions réussissent.
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
  return 'ok';
end;
$try$;

-- ---------------------------------------------------------------------------
-- Identités (constantes) :
--   ...8000-000000000001 propriétaire (engineer, entreprise A) ; ...002 administrateur de A
--   (relecteur, auteur de la politique) ; ...003 membre d'une autre entreprise (B) ;
--   ...010 projet ; ...020 rôle « Tuyauteur » 40 €/h du propriétaire ; ...030 règle d'approbation.
--   Versions : ...100 témoin v2 (sans politique) ; ...110 S1 ; ...120 S2 ; ...130 S3 ;
--   ...140 T-MARG ; ...150 unité manquante ; ...160 taux non autorisé ; ...170 EUHIST ;
--   ...180 heures par unité ; ...190 brouillon de sonde ; ...1a0 coefficients par défaut ;
--   ...1b0 création après retour à la politique 2.
--   Lignes : même suffixe en « -8001- », dernier chiffre = rang (0 = section).
-- ---------------------------------------------------------------------------
create temporary table v3_fx (
  key text primary key,
  id uuid not null
) on commit drop;

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from v3_fx where key = p_key
$$;

create function pg_temp.v3_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select (left(replace(p_version::text, '-8000-', '-8001-'), 35) || p_index::text)::uuid
$$;

-- ---------------------------------------------------------------------------
-- Oracle §5.1 (O1-O7, nombres seuls) et scénarios §5.2 (S1-S3), 1,30 / 1,20, 40 €/h.
-- ---------------------------------------------------------------------------
create temporary table v3_oracle_line (
  ord integer primary key,
  quantity numeric not null,
  pr integer not null,
  hu numeric not null,
  unit text not null,
  pu integer not null,
  gross integer not null,
  gross_fo integer not null,
  h_mo text not null
) on commit drop;

insert into v3_oracle_line (ord, quantity, pr, hu, unit, pu, gross, gross_fo, h_mo)
values
  (1, 20, 5466, 1.991, 'ml', 16663, 333260, 142119, '39.820'),
  (2, 3, 9563, 1.75, 'u', 20832, 62496, 37296, '5.250'),
  (3, 21, 5850, 0, 'm2', 7605, 159705, 159705, '0.000'),
  (4, 1139, 302, 0.2, 'ml', 1353, 1541067, 447304, '227.800'),
  (5, 1, 2000, 6, 'u', 31400, 31400, 2600, '6.000'),
  (6, 282, 9186, 0.998, 'ml', 16732, 4718424, 3367547, '281.436'),
  (7, 8, 883, 1.30, 'ml', 7388, 59104, 9183, '10.400');

create temporary table v3_oracle_split (
  scenario text not null,
  ord integer not null,
  net integer not null,
  fo integer not null,
  mo integer not null,
  tax integer not null,
  primary key (scenario, ord)
) on commit drop;

insert into v3_oracle_split (scenario, ord, net, fo, mo, tax)
values
  ('S1', 1, 333260, 142119, 191141, 66652),
  ('S1', 2, 62496, 37296, 25200, 12499),
  ('S1', 3, 159705, 159705, 0, 31941),
  ('S1', 4, 1541067, 447304, 1093763, 308213),
  ('S1', 5, 31400, 2600, 28800, 6280),
  ('S1', 6, 4718424, 3367547, 1350877, 943685),
  ('S1', 7, 59104, 9183, 49921, 11821),
  ('S2', 1, 333255, 142117, 191138, 66651),
  ('S2', 2, 62495, 37295, 25200, 12499),
  ('S2', 3, 159703, 159703, 0, 31941),
  ('S2', 4, 1541044, 447297, 1093747, 308209),
  ('S2', 5, 31400, 2600, 28800, 6280),
  ('S2', 6, 4718355, 3367498, 1350857, 943671),
  ('S2', 7, 59103, 9183, 49920, 11820),
  ('S3', 1, 299934, 127907, 172027, 59987),
  ('S3', 2, 56246, 33566, 22680, 11249),
  ('S3', 3, 143735, 143735, 0, 28747),
  ('S3', 4, 1386960, 402574, 984386, 277392),
  ('S3', 5, 28260, 2340, 25920, 5652),
  ('S3', 6, 4246581, 3030792, 1215789, 849316),
  ('S3', 7, 53194, 8265, 44929, 10639);

create temporary table v3_scenario (
  scenario text primary key,
  discount_amount integer,
  discount_bp integer not null,
  gross integer not null,
  discount integer not null,
  rounding integer not null,
  ht integer not null,
  tax integer not null,
  ttc integer not null,
  cost integer not null,
  coef numeric not null
) on commit drop;

-- §5.2 : S1 sans remise, S2 remise 1,01 €, S3 remise 10 % ; déboursé Σ D du §5.1.
insert into v3_scenario (scenario, discount_amount, discount_bp, gross, discount, rounding, ht, tax, ttc, cost, coef)
values
  ('S1', null, 0, 6905456, 0, 0, 6905456, 1381091, 8286547, 5487177, 1.258472),
  ('S2', 101, 0, 6905456, 101, 0, 6905355, 1381071, 8286426, 5487177, 1.258453),
  ('S3', null, 1000, 6905456, 690546, 0, 6214910, 1242982, 7457892, 5487177, 1.132624);

select is(
  (
    select array_agg(scenario.scenario order by scenario.scenario)
    from v3_scenario scenario
    where scenario.gross <> (select sum(line.gross) from v3_oracle_line line)
      or scenario.ht <> (select sum(split.net) from v3_oracle_split split where split.scenario = scenario.scenario)
      or scenario.tax <> (select sum(split.tax) from v3_oracle_split split where split.scenario = scenario.scenario)
      or scenario.ttc <> scenario.ht + scenario.tax
      or scenario.ht <> scenario.gross - scenario.discount - scenario.rounding
      or exists (
        select 1
        from v3_oracle_split split
        join v3_oracle_line line on line.ord = split.ord
        where split.scenario = scenario.scenario
          and (
            split.fo + split.mo <> split.net
            or split.net > line.gross
            or line.gross <> round(line.quantity * line.pu)
          )
      )
  ),
  null::text[],
  'fixture: the oracle lines reproduce the §5.2 S1/S2/S3 totals (Σ nets, Σ taxes, FO + MO = net <= gross = Q × PU)'
);

-- ---------------------------------------------------------------------------
-- Constructeurs de charges utiles (évalués par postgres avant tout changement de rôle).
-- ---------------------------------------------------------------------------
create function pg_temp.v3_base_version(p_version uuid, p_title text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_version,
    'title', p_title,
    'date_devis', '2026-10-17',
    'validite_jours', 30,
    'margin_multiplier', 1,
    'margin_mode', 'fixed',
    'currency', 'EUR',
    'margin_bp', 0,
    'discount_bp', 0,
    'discount_amount_cents', null,
    'discount_mode', 'simple',
    'discount_steps', '[]'::jsonb,
    'global_coefficient', 1,
    'tax_rate_bp', 2000,
    'rounding_mode', 'none',
    'rounding_step_cents', 1,
    'max_section_depth', 3,
    'contractor_role', 'principal',
    'calc_engine_version', 3,
    'sale_coefficient_fo', 1.30,
    'sale_coefficient_mo', 1.20,
    'gross_ht_cents', 0,
    'discount_applied_cents', 0,
    'commercial_rounding_cents', 0,
    'total_ht_cents', 0,
    'total_tax_cents', 0,
    'total_ttc_cents', 0
  )
$$;

-- Charge utile v2 historique : ni attente de moteur, ni clé v3.
create function pg_temp.v3_v2_version(p_version uuid, p_title text)
returns jsonb
language sql
immutable
as $$
  select pg_temp.v3_base_version(p_version, p_title) - array[
    'calc_engine_version', 'sale_coefficient_fo', 'sale_coefficient_mo',
    'gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents'
  ]
$$;

create function pg_temp.v3_create_sql(p_version jsonb, p_items jsonb)
returns text
language sql
stable
as $$
  select format(
    'select public.persist_estimate_creation_atomic(%L::uuid, %L::uuid, %L::uuid, null, %L::jsonb, %L::jsonb, null)',
    pg_temp.fx('tenant_a'),
    'a3250000-0000-4000-8000-000000000001',
    'a3250000-0000-4000-8000-000000000010',
    p_version,
    p_items
  )
$$;

create function pg_temp.v3_line_items(p_version uuid, p_line jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', pg_temp.v3_item(p_version, 0), 'parent_id', null, 'item_type', 'section',
      'position', 1, 'title', 'Lot'
    ),
    jsonb_build_object(
      'id', pg_temp.v3_item(p_version, 1), 'parent_id', pg_temp.v3_item(p_version, 0),
      'item_type', 'line', 'position', 1, 'title', 'L1',
      'k_fo', 1, 'h_mo_majoration', 1, 'k_mo', 1, 'pricing_status', 'priced'
    ) || p_line
  )
$$;

create function pg_temp.v3_line_snapshot(p_version uuid, p_values jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(jsonb_build_object('id', pg_temp.v3_item(p_version, 1)) || p_values)
$$;

create function pg_temp.v3_oracle_totals(p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'gross_ht_cents', scenario.gross,
    'discount_applied_cents', scenario.discount,
    'commercial_rounding_cents', scenario.rounding,
    'total_ht_cents', scenario.ht,
    'total_tax_cents', scenario.tax,
    'total_ttc_cents', scenario.ttc,
    'rounding_adjustment_cents', 0
  )
  from v3_scenario scenario
  where scenario.scenario = p_scenario
$$;

create function pg_temp.v3_oracle_version(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select pg_temp.v3_base_version(p_version, 'V3 ' || p_scenario)
    || (pg_temp.v3_oracle_totals(p_scenario) - 'rounding_adjustment_cents')
    || jsonb_build_object(
      'discount_amount_cents', scenario.discount_amount,
      'discount_bp', scenario.discount_bp
    )
  from v3_scenario scenario
  where scenario.scenario = p_scenario
$$;

create function pg_temp.v3_oracle_items(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_array(jsonb_build_object(
      'id', pg_temp.v3_item(p_version, 0), 'parent_id', null, 'item_type', 'section',
      'position', 1, 'title', 'Lot oracle'
    ))
    || jsonb_agg(jsonb_build_object(
      'id', pg_temp.v3_item(p_version, line.ord),
      'parent_id', pg_temp.v3_item(p_version, 0),
      'item_type', 'line',
      'position', line.ord,
      'title', 'O' || line.ord,
      'quantity', line.quantity,
      'unit_price_ht_cents', line.pr,
      'tax_rate_bp', 2000,
      'k_fo', 1,
      'h_mo_majoration', 1,
      'k_mo', 1,
      'labor_role_id', 'a3250000-0000-4000-8000-000000000020',
      'h_mo_per_unit', line.hu,
      'unit_code', line.unit,
      'pricing_status', 'priced',
      'pu_ht_cents', line.pu,
      'line_total_ht_cents', split.net,
      'line_tax_cents', split.tax,
      'line_total_ttc_cents', split.net + split.tax
    ) order by line.ord)
  from v3_oracle_line line
  join v3_oracle_split split on split.ord = line.ord and split.scenario = p_scenario
$$;

-- Colonnes figées v3 (§6.2, D7) : sans ventilation, toute la MO est « chantier » (convention v2,
-- imposée par estimate_items_v2_snapshot_complete_check).
create function pg_temp.v3_oracle_snapshots(p_version uuid, p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object(
    'id', pg_temp.v3_item(p_version, line.ord),
    'snapshot_pu_ht_cents', line.pu,
    'snapshot_gross_ht_cents', line.gross,
    'snapshot_gross_fo_ht_cents', line.gross_fo,
    'snapshot_fo_ht_cents', split.fo,
    'snapshot_mo_ht_cents', split.mo,
    'snapshot_mo_atelier_ht_cents', 0,
    'snapshot_mo_chantier_ht_cents', split.mo,
    'line_total_ht_cents', split.net,
    'line_tax_cents', split.tax,
    'line_total_ttc_cents', split.net + split.tax
  ) order by line.ord)
  from v3_oracle_line line
  join v3_oracle_split split on split.ord = line.ord and split.scenario = p_scenario
$$;

-- Contexte figé v3 (§6.5) des scénarios oracle.
create function pg_temp.v3_oracle_context(p_scenario text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'engine', 3,
    'labor_split_enabled', false,
    'labor_roles', jsonb_build_array(jsonb_build_object(
      'id', 'a3250000-0000-4000-8000-000000000020', 'hourly_rate_cents', 4000
    )),
    'sale_coefficients', jsonb_build_object('fo', 1.3, 'mo', 1.2),
    'discount', jsonb_build_object(
      'kind', case
        when scenario.discount_amount is not null then 'amount'
        when scenario.discount_bp > 0 then 'rate'
        else 'none'
      end,
      'requested_cents', scenario.discount_amount,
      'rate_bp', case when scenario.discount_bp > 0 then scenario.discount_bp end,
      'base_cents', scenario.gross,
      'applied_cents', scenario.discount
    ),
    'commercial_rounding', jsonb_build_object('mode', 'none', 'step_cents', 1, 'applied_cents', 0),
    'cost_subtotal_cents', scenario.cost,
    'realized_sale_coefficient', scenario.coef,
    'tax_breakdown', jsonb_build_array(jsonb_build_object(
      'rate_bp', 2000, 'base_cents', scenario.ht, 'tax_cents', scenario.tax
    ))
  )
  from v3_scenario scenario
  where scenario.scenario = p_scenario
$$;

create function pg_temp.v3_freeze_sql(p_version uuid, p_context jsonb, p_items jsonb, p_totals jsonb)
returns text
language sql
stable
as $$
  select format(
    'select public.freeze_estimate_v3_snapshot(%1$L::uuid, %2$L::uuid, '
      '(select updated_at from public.estimate_versions where id = %1$L::uuid), '
      '(select content_revision from public.estimate_versions where id = %1$L::uuid), '
      '%3$L::uuid, %4$L, %5$L::jsonb, %6$L::jsonb, %7$L::jsonb)',
    p_version,
    pg_temp.fx('tenant_a'),
    'a3250000-0000-4000-8000-000000000001',
    'approval',
    p_context,
    p_items,
    p_totals
  )
$$;

create function pg_temp.v3_policy_sql(
  p_tenant_expression text,
  p_engine integer,
  p_fo numeric,
  p_mo numeric,
  p_reason text,
  p_actor uuid
)
returns text
language sql
immutable
as $$
  select format(
    'select public.set_tenant_calc_policy('
      'p_tenant_id => %s, p_new_estimate_calc_engine => %s::smallint, '
      'p_default_sale_coefficient_fo => %L::numeric, p_default_sale_coefficient_mo => %L::numeric, '
      'p_allowed_tax_rates_bp => %L::integer[], p_change_reason => %L, p_actor_user_id => %L::uuid)',
    p_tenant_expression,
    p_engine,
    p_fo,
    p_mo,
    '{2000,1000,550,210}',
    p_reason,
    p_actor
  )
$$;

create function pg_temp.v3_adjust(p_items jsonb, p_index integer, p_key text, p_delta integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    p_items,
    array[p_index::text, p_key],
    to_jsonb((p_items -> p_index ->> p_key)::bigint + p_delta)
  )
$$;

-- Déplace 1 c de chaque clé de l'élément p_from vers l'élément p_to : les sommes ne changent pas.
create function pg_temp.v3_shift(p_items jsonb, p_from integer, p_to integer, p_keys text[])
returns jsonb
language plpgsql
immutable
as $$
declare
  shifted jsonb := p_items;
  shifted_key text;
begin
  foreach shifted_key in array p_keys loop
    shifted := pg_temp.v3_adjust(shifted, p_from, shifted_key, -1);
    shifted := pg_temp.v3_adjust(shifted, p_to, shifted_key, 1);
  end loop;
  return shifted;
end;
$$;

-- Empreinte des lignes d'une version, sans identifiant (duplication). plpgsql : les colonnes de
-- M4 ne sont résolues qu'à l'exécution, dans une sonde.
create function pg_temp.v3_lines_signature(p_version uuid)
returns text
language plpgsql
stable
as $$
declare
  signature text;
begin
  select string_agg(
      concat_ws(
        ':', item.item_type, item.position, item.title, item.quantity, item.unit_price_ht_cents,
        item.tax_rate_bp, item.labor_role_id, item.h_mo_per_unit, item.h_mo, item.unit_code,
        item.pricing_status, item.pu_ht_cents, item.line_total_ht_cents, item.line_tax_cents,
        item.line_total_ttc_cents
      ),
      ',' order by item.item_type, item.position, item.title
    )
    into signature
  from public.estimate_items item
  where item.version_id = p_version;
  return signature;
end;
$$;

-- ---------------------------------------------------------------------------
-- F25-02, F25-03 : structure de M4 (D18 : colonnes et types vérifiés en pgTAP).
-- ---------------------------------------------------------------------------
select has_table('public', 'tenant_calc_policies', 'F25-02 the typed tenant calculation policy table exists');
select has_table('public', 'tenant_calc_policy_events', 'F25-02 the tenant calculation policy journal exists');
select col_is_pk('public', 'tenant_calc_policies', 'tenant_id', 'F25-02 one policy row per tenant');
select col_type_is('public', 'tenant_calc_policies', 'new_estimate_calc_engine', 'smallint', 'F25-02 policy engine is a smallint');
select col_type_is('public', 'tenant_calc_policies', 'default_sale_coefficient_fo', 'numeric(8,4)', 'F25-02 policy default FO coefficient is numeric(8,4)');
select col_type_is('public', 'tenant_calc_policies', 'default_sale_coefficient_mo', 'numeric(8,4)', 'F25-02 policy default MO coefficient is numeric(8,4)');
select col_type_is('public', 'tenant_calc_policies', 'allowed_tax_rates_bp', 'integer[]', 'F25-02 policy allowed tax rates are integer[]');
select col_type_is('public', 'tenant_calc_policies', 'change_reason', 'text', 'F25-02 policy change reason is text');
select col_type_is('public', 'tenant_calc_policies', 'updated_by', 'uuid', 'F25-02 policy author is a uuid');
select col_type_is('public', 'tenant_calc_policy_events', 'tenant_id', 'uuid', 'F25-02 policy event tenant');
select col_type_is('public', 'tenant_calc_policy_events', 'previous_policy', 'jsonb', 'F25-02 policy event before image');
select col_type_is('public', 'tenant_calc_policy_events', 'new_policy', 'jsonb', 'F25-02 policy event after image');
select col_type_is('public', 'tenant_calc_policy_events', 'change_reason', 'text', 'F25-02 policy event reason');
select col_type_is('public', 'tenant_calc_policy_events', 'changed_by', 'uuid', 'F25-02 policy event author');
select col_type_is('public', 'tenant_calc_policy_events', 'created_at', 'timestamp with time zone', 'F25-02 policy event time');

select is(
  array(
    select format('%s:%s', relation.relname, relation.relrowsecurity)
    from pg_class relation
    where relation.oid in (
      to_regclass('public.tenant_calc_policies'),
      to_regclass('public.tenant_calc_policy_events')
    )
    order by 1
  ),
  array['tenant_calc_policies:true', 'tenant_calc_policy_events:true'],
  'F25-03 row level security is enabled on the policy and its journal'
);

select col_type_is('public', 'estimate_versions', 'sale_coefficient_fo', 'numeric(8,4)', 'F25-02 version FO sale coefficient is numeric(8,4)');
select col_type_is('public', 'estimate_versions', 'sale_coefficient_mo', 'numeric(8,4)', 'F25-02 version MO sale coefficient is numeric(8,4)');
select col_type_is('public', 'estimate_versions', 'gross_ht_cents', 'integer', 'F25-02 version gross amount is integer');
select col_type_is('public', 'estimate_versions', 'discount_applied_cents', 'integer', 'F25-02 version applied discount is integer');
select col_type_is('public', 'estimate_versions', 'commercial_rounding_cents', 'integer', 'F25-02 version commercial rounding is integer');
select col_type_is('public', 'estimate_items', 'unit_code', 'text', 'F25-02 line unit code is text');
select col_type_is('public', 'estimate_items', 'pricing_status', 'estimate_line_pricing_status', 'F25-02 line pricing status uses the D9 enum');
select col_not_null('public', 'estimate_items', 'pricing_status', 'F25-02 line pricing status is never null');
select col_type_is('public', 'estimate_items', 'h_mo_per_unit', 'numeric(12,4)', 'F25-02 hours per unit is numeric(12,4)');
select col_type_is('public', 'estimate_items', 'h_mo_atelier_per_unit', 'numeric(12,4)', 'F25-02 workshop hours per unit is numeric(12,4)');
select col_type_is('public', 'estimate_items', 'h_mo_chantier_per_unit', 'numeric(12,4)', 'F25-02 site hours per unit is numeric(12,4)');
select col_type_is('public', 'estimate_items', 'snapshot_gross_ht_cents', 'integer', 'F25-02 frozen gross line amount is integer');
select col_type_is('public', 'estimate_items', 'snapshot_gross_fo_ht_cents', 'integer', 'F25-02 frozen gross FO line amount is integer');
select fk_ok(
  'public', 'estimate_items', 'unit_code',
  'public', 'measurement_units', 'code',
  'F25-02 the line unit code references the unit referential'
);

select has_function(
  'public', 'set_tenant_calc_policy',
  array['uuid', 'smallint', 'numeric', 'numeric', 'integer[]', 'text', 'uuid'],
  'F25-03 the policy writer RPC exists'
);
select has_function(
  'public', 'freeze_estimate_v3_snapshot',
  array['uuid', 'uuid', 'timestamp with time zone', 'bigint', 'uuid', 'text', 'jsonb', 'jsonb', 'jsonb'],
  'F25-10 the v3 freeze RPC exists with the signature of its v2 twin'
);
select has_function('private', 'estimate_v3_compute', array['uuid'], 'F25-10 the full v3 recomputation exists');
select has_function('private', 'estimate_v3_assert_draft', array['uuid'], 'F25-09 the v3 draft assertion exists');

select is(
  pg_temp.v3_probe(null, $a$
    select array[
      has_function_privilege('service_role', 'public.set_tenant_calc_policy(uuid,smallint,numeric,numeric,integer[],text,uuid)', 'execute'),
      has_function_privilege('authenticated', 'public.set_tenant_calc_policy(uuid,smallint,numeric,numeric,integer[],text,uuid)', 'execute'),
      has_function_privilege('anon', 'public.set_tenant_calc_policy(uuid,smallint,numeric,numeric,integer[],text,uuid)', 'execute'),
      (select procedure.prosecdef from pg_proc procedure
       where procedure.oid = 'public.set_tenant_calc_policy(uuid,smallint,numeric,numeric,integer[],text,uuid)'::regprocedure)
    ]::text
  $a$),
  'ok:{t,f,f,t}',
  'F25-03 set_tenant_calc_policy is a security definer executable by service_role only (P-13)'
);

select is(
  pg_temp.v3_probe(null, $a$
    select array[
      has_function_privilege('service_role', 'public.freeze_estimate_v3_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)', 'execute'),
      has_function_privilege('authenticated', 'public.freeze_estimate_v3_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)', 'execute'),
      has_function_privilege('anon', 'public.freeze_estimate_v3_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)', 'execute'),
      has_function_privilege('service_role', 'private.estimate_v3_compute(uuid)', 'execute'),
      has_function_privilege('authenticated', 'private.estimate_v3_compute(uuid)', 'execute'),
      has_function_privilege('service_role', 'private.estimate_v3_assert_draft(uuid)', 'execute'),
      has_function_privilege('authenticated', 'private.estimate_v3_assert_draft(uuid)', 'execute')
    ]::text
  $a$),
  'ok:{t,f,f,f,f,f,f}',
  'F25-10 the v3 freeze is service_role only and the private recomputation is owner only'
);

-- ---------------------------------------------------------------------------
-- Comptes, entreprises, projet, rôle, règle (aucun objet de M4).
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  crypt('test-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('a3250000-0000-4000-8000-000000000001'::uuid, 'v3-persistence-owner@example.test'),
    ('a3250000-0000-4000-8000-000000000002'::uuid, 'v3-persistence-admin@example.test'),
    ('a3250000-0000-4000-8000-000000000003'::uuid, 'v3-persistence-outsider@example.test')
) as fixture(id, email);

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = 'a3250000-0000-4000-8000-000000000001';

update public.tenant_memberships
set is_default = false
where user_id = 'a3250000-0000-4000-8000-000000000002';

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select
  'a3250000-0000-4000-8000-000000000004',
  owner_membership.tenant_id,
  'a3250000-0000-4000-8000-000000000002',
  'admin'::public.tenant_role,
  true
from public.tenant_memberships owner_membership
where owner_membership.user_id = 'a3250000-0000-4000-8000-000000000001';

insert into v3_fx (key, id)
select 'tenant_a', membership.tenant_id
from public.tenant_memberships membership
where membership.user_id = 'a3250000-0000-4000-8000-000000000001';

insert into v3_fx (key, id)
select 'tenant_b', membership.tenant_id
from public.tenant_memberships membership
where membership.user_id = 'a3250000-0000-4000-8000-000000000003'
  and membership.is_default;

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values (
  'a3250000-0000-4000-8000-000000000010',
  pg_temp.fx('tenant_a'),
  'a3250000-0000-4000-8000-000000000001',
  'Projet persistance v3',
  false
);

insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position)
values (
  'a3250000-0000-4000-8000-000000000020',
  pg_temp.fx('tenant_a'),
  'a3250000-0000-4000-8000-000000000001',
  'Tuyauteur',
  4000,
  true,
  1
);

insert into public.estimate_rules (id, tenant_id, rule_type, scope_type, threshold_value, action, is_active)
values (
  'a3250000-0000-4000-8000-000000000030',
  pg_temp.fx('tenant_a'),
  'require_approval'::public.estimate_rule_type,
  'global'::public.estimate_rule_scope_type,
  0,
  'require_approval'::public.estimate_rule_action,
  true
);

-- ---------------------------------------------------------------------------
-- F25-01 : politique absente → moteur 2 ; attente 3 sans politique → CONTEXT_CHANGED.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_v2_version('a3250000-0000-4000-8000-000000000100', 'Témoin v2 sans politique')
        || '{"total_ht_cents":100,"total_tax_cents":20,"total_ttc_cents":120}'::jsonb,
      '[
        {"id":"a3250000-0000-4000-8001-000000000100","parent_id":null,"item_type":"section","position":1,"title":"Lot v2"},
        {"id":"a3250000-0000-4000-8001-000000000101","parent_id":"a3250000-0000-4000-8001-000000000100","item_type":"line","position":1,"title":"Ligne v2","description":"u","quantity":1,"unit_price_ht_cents":100,"tax_rate_bp":2000,"k_fo":1,"h_mo":0,"h_mo_majoration":1,"k_mo":1,"pu_ht_cents":100,"line_total_ht_cents":100,"line_tax_cents":20,"line_total_ttc_cents":120}
      ]'::jsonb
    )
  ]),
  'ok',
  'F25-01 fixture: without a policy, a creation without engine expectation succeeds'
);

select is(
  (select calc_engine_version from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000100'),
  2::smallint,
  'F25-01 an absent policy means engine 2 for new versions'
);

select is(
  pg_temp.v3_probe(null, $a$
    select (
      row(version.sale_coefficient_fo, version.sale_coefficient_mo, version.gross_ht_cents,
        version.discount_applied_cents, version.commercial_rounding_cents) is null
      and row(item.unit_code, item.h_mo_per_unit, item.h_mo_atelier_per_unit, item.h_mo_chantier_per_unit,
        item.snapshot_gross_ht_cents, item.snapshot_gross_fo_ht_cents) is null
      and item.pricing_status = 'priced'
    )::text
    from public.estimate_versions version
    join public.estimate_items item on item.version_id = version.id and item.item_type = 'line'
    where version.id = 'a3250000-0000-4000-8000-000000000100'
  $a$),
  'ok:true',
  'F25-19 a v1/v2 row carries only neutral v3 values (no conversion, D17)'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1'),
      pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1')
    )
  ]),
  '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'F25-01 without a policy, a client expecting engine 3 gets CONTEXT_CHANGED and nothing is created'
);

-- ---------------------------------------------------------------------------
-- F25-03 : écriture de la politique (service_role seul, motif, coefficients pour 3, journal).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$,
    pg_temp.v3_policy_sql('public.current_tenant_id()', 3, 1.30, 1.20, 'Activation par un administrateur', 'a3250000-0000-4000-8000-000000000002')
  ]),
  '42501 permission denied for function set_tenant_calc_policy',
  'F25-03 a tenant administrator cannot call set_tenant_calc_policy'
);

select is(
  pg_temp.v3_probe(array[
    'set local role anon',
    pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_a')) || '::uuid', 3, 1.30, 1.20, 'Activation anonyme', null)
  ]),
  '42501 permission denied for function set_tenant_calc_policy',
  'F25-03 anon cannot call set_tenant_calc_policy'
);

select is(
  array[
    pg_temp.v3_probe(array[
      'set local role service_role',
      pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_a')) || '::uuid', 3, 1.30, 1.20, 'abc', 'a3250000-0000-4000-8000-000000000002')
    ]),
    pg_temp.v3_probe(array[
      'set local role service_role',
      pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_a')) || '::uuid', 3, 1.30, 1.20, null, 'a3250000-0000-4000-8000-000000000002')
    ])
  ],
  array_fill('22023 TENANT_CALC_POLICY_REASON_REQUIRED'::text, array[2]),
  'F25-03 a policy change needs a reason of at least 5 characters'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_a')) || '::uuid', 3, null, null, 'Pilote sans coefficients', 'a3250000-0000-4000-8000-000000000002')
  ]),
  '22023 TENANT_CALC_POLICY_V3_DEFAULTS_REQUIRED',
  'F25-03 switching to engine 3 without default sale coefficients is refused'
);

select is(
  pg_temp.v3_probe(array[
    format(
      'insert into public.tenant_calc_policies (tenant_id, new_estimate_calc_engine, change_reason) values (%L, 3, %L)',
      pg_temp.fx('tenant_b'),
      'Insertion directe'
    )
  ]),
  '23514 new row for relation "tenant_calc_policies" violates check constraint "tenant_calc_policies_v3_requires_defaults"',
  'F25-03 the table itself refuses engine 3 without default coefficients'
);

select is(
  array[
    pg_temp.v3_try(array[
      'set local role service_role',
      pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_a')) || '::uuid', 3, 1.30, 1.20, 'Pilote moteur 3', 'a3250000-0000-4000-8000-000000000002')
    ]),
    pg_temp.v3_try(array[
      'set local role service_role',
      pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_b')) || '::uuid', 2, null, null, 'Témoin autre entreprise', 'a3250000-0000-4000-8000-000000000003')
    ])
  ],
  array['ok', 'ok'],
  'F25-03 fixture: service_role sets tenant A to engine 3 (1,30 / 1,20) and tenant B to engine 2'
);

select is(
  pg_temp.v3_probe(null, format(
    $a$select concat_ws('|', new_estimate_calc_engine, default_sale_coefficient_fo, default_sale_coefficient_mo,
         allowed_tax_rates_bp, change_reason, updated_by)
       from public.tenant_calc_policies where tenant_id = %L$a$,
    pg_temp.fx('tenant_a')
  )),
  'ok:3|1.3000|1.2000|{2000,1000,550,210}|Pilote moteur 3|a3250000-0000-4000-8000-000000000002',
  'F25-03 the policy row records engine, defaults, allowed rates, reason and author'
);

select is(
  pg_temp.v3_probe(null, format(
    $a$select concat_ws('|', count(*), bool_and(previous_policy is null),
         max(new_policy->>'new_estimate_calc_engine'), max(change_reason), max(changed_by::text))
       from public.tenant_calc_policy_events where tenant_id = %L$a$,
    pg_temp.fx('tenant_a')
  )),
  'ok:1|true|3|Pilote moteur 3|a3250000-0000-4000-8000-000000000002',
  'F25-03 the policy change is journaled with before/after images, reason and author'
);

-- ---------------------------------------------------------------------------
-- F25-04 : RLS de la politique et de son journal.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.v3_probe(
      array['set local role authenticated', $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000001', true)$s$],
      $a$select coalesce(string_agg(new_estimate_calc_engine::text, ','), 'none') from public.tenant_calc_policies$a$
    ),
    pg_temp.v3_probe(
      array['set local role authenticated', $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000003', true)$s$],
      $a$select coalesce(string_agg(new_estimate_calc_engine::text, ','), 'none') from public.tenant_calc_policies$a$
    )
  ],
  array['ok:3', 'ok:2'],
  'F25-04 each member reads the policy of its own tenant only'
);

select is(
  array[
    pg_temp.v3_probe(
      array['set local role authenticated', $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000001', true)$s$],
      $a$select count(*) || ':' || coalesce(string_agg(new_policy->>'new_estimate_calc_engine', ','), '') from public.tenant_calc_policy_events$a$
    ),
    pg_temp.v3_probe(
      array['set local role authenticated', $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000003', true)$s$],
      $a$select count(*) || ':' || coalesce(string_agg(new_policy->>'new_estimate_calc_engine', ','), '') from public.tenant_calc_policy_events$a$
    )
  ],
  array['ok:1:3', 'ok:1:2'],
  'F25-04 each member reads the policy journal of its own tenant only'
);

select is(
  array[
    pg_temp.v3_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$,
      $s$insert into public.tenant_calc_policies (tenant_id, new_estimate_calc_engine, change_reason)
         values (public.current_tenant_id(), 2, 'Écriture directe')$s$
    ]),
    pg_temp.v3_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$,
      $s$update public.tenant_calc_policies set new_estimate_calc_engine = 2 where tenant_id = public.current_tenant_id()$s$
    ]),
    pg_temp.v3_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$,
      $s$delete from public.tenant_calc_policies where tenant_id = public.current_tenant_id()$s$
    ]),
    pg_temp.v3_probe(array[
      'set local role anon',
      $s$select count(*) from public.tenant_calc_policies$s$
    ])
  ],
  array_fill('42501 permission denied for table tenant_calc_policies'::text, array[4]),
  'F25-04 no direct insert, update or delete by a tenant administrator, and nothing for anon'
);

select is(
  array[
    pg_temp.v3_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$,
      $s$insert into public.tenant_calc_policy_events (tenant_id, new_policy, change_reason, changed_by)
         values (public.current_tenant_id(), '{}'::jsonb, 'Journal forgé', 'a3250000-0000-4000-8000-000000000002')$s$
    ]),
    pg_temp.v3_probe(array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$,
      $s$delete from public.tenant_calc_policy_events where tenant_id = public.current_tenant_id()$s$
    ]),
    pg_temp.v3_probe(array[
      'set local role anon',
      $s$select count(*) from public.tenant_calc_policy_events$s$
    ])
  ],
  array_fill('42501 permission denied for table tenant_calc_policy_events'::text, array[3]),
  'F25-04 the policy journal cannot be forged or erased by members, and anon reads nothing'
);

-- ---------------------------------------------------------------------------
-- F25-01 : politique 3 ↔ création (attente du client).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1') - 'calc_engine_version',
      pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1')
    )
  ]),
  '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'F25-01 under policy 3, a client without engine expectation (old bundle) is treated as expecting 2 and refused'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_v2_version('a3250000-0000-4000-8000-000000000190', 'Attente 2') || '{"calc_engine_version":2}'::jsonb,
      '[]'::jsonb
    )
  ]),
  '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'F25-01 under policy 3, a client expecting engine 2 is refused, never silently given a v3'
);

select is(
  pg_temp.v3_probe(
    array[
      'set local role service_role',
      pg_temp.v3_create_sql(
        (pg_temp.v3_base_version('a3250000-0000-4000-8000-0000000001a0', 'Coefficients par défaut')
          - array['sale_coefficient_fo', 'sale_coefficient_mo'])
          || '{"gross_ht_cents":1300,"total_ht_cents":1300,"total_tax_cents":260,"total_ttc_cents":1560}'::jsonb,
        pg_temp.v3_line_items(
          'a3250000-0000-4000-8000-0000000001a0',
          '{"quantity":1,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"h_mo_per_unit":0,"unit_code":"u","pu_ht_cents":1300,"line_total_ht_cents":1300,"line_tax_cents":260,"line_total_ttc_cents":1560}'::jsonb
        )
      )
    ],
    $a$select sale_coefficient_fo || ' ' || sale_coefficient_mo from public.estimate_versions
       where id = 'a3250000-0000-4000-8000-0000000001a0'$a$
  ),
  'ok:1.3000 1.2000',
  'F25-05 a v3 created without coefficients receives the policy defaults (1,30 / 1,20)'
);

-- ---------------------------------------------------------------------------
-- F25-09 : projection altérée d'un centime refusée à la sauvegarde (création).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1'),
      pg_temp.v3_adjust(pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1'), 1, 'pu_ht_cents', 1)
    )
  ]),
  '22023 ESTIMATE_V3_PROJECTION_MISMATCH',
  'F25-09 save: a line PU off by one cent (O1 16 664 instead of 16 663) is refused'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1'),
      pg_temp.v3_shift(
        pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1'),
        2, 1, array['line_total_ht_cents', 'line_total_ttc_cents']
      )
    )
  ]),
  '22023 ESTIMATE_V3_PROJECTION_MISMATCH',
  'F25-09 save: a compensated error putting a line net one cent above its gross Q × PU is refused'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1')
        || '{"gross_ht_cents":6905457,"discount_applied_cents":1}'::jsonb,
      pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1')
    )
  ]),
  '22023 ESTIMATE_V3_PROJECTION_MISMATCH',
  'F25-09 save: a version gross off by one cent (with an invented discount keeping the identity) is refused'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1')
        || '{"total_tax_cents":1381092,"total_ttc_cents":8286548}'::jsonb,
      pg_temp.v3_adjust(
        pg_temp.v3_adjust(pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1'), 1, 'line_tax_cents', 1),
        1, 'line_total_ttc_cents', 1
      )
    )
  ]),
  '22023 ESTIMATE_V3_PROJECTION_MISMATCH',
  'F25-09 save: a tax rate group summing one cent above round(base × rate) is refused, even with consistent sums'
);

-- ---------------------------------------------------------------------------
-- Versions v3 créées par la RPC canonique, sous la politique 3.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000110', 'S1'),
      pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000110', 'S1')
    )]),
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000120', 'S2'),
      pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000120', 'S2')
    )]),
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000130', 'S3'),
      pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000130', 'S3')
    )]),
    -- T-MARG : 1,25 / 1,25, remise 20 % → marque nette 0.
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_base_version('a3250000-0000-4000-8000-000000000140', 'T-MARG')
        || '{"sale_coefficient_fo":1.25,"sale_coefficient_mo":1.25,"discount_bp":2000,"gross_ht_cents":12500,"discount_applied_cents":2500,"total_ht_cents":10000,"total_tax_cents":2000,"total_ttc_cents":12000}'::jsonb,
      pg_temp.v3_line_items('a3250000-0000-4000-8000-000000000140',
        '{"quantity":1,"unit_price_ht_cents":10000,"tax_rate_bp":2000,"h_mo_per_unit":0,"unit_code":"u","pu_ht_cents":12500,"line_total_ht_cents":10000,"line_tax_cents":2000,"line_total_ttc_cents":12000}'::jsonb)
    )]),
    -- Unité manquante : un brouillon peut rester incomplet.
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_base_version('a3250000-0000-4000-8000-000000000150', 'Sans unité')
        || '{"gross_ht_cents":1300,"total_ht_cents":1300,"total_tax_cents":260,"total_ttc_cents":1560}'::jsonb,
      pg_temp.v3_line_items('a3250000-0000-4000-8000-000000000150',
        '{"quantity":1,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"h_mo_per_unit":0,"unit_code":null,"pu_ht_cents":1300,"line_total_ht_cents":1300,"line_tax_cents":260,"line_total_ttc_cents":1560}'::jsonb)
    )]),
    -- Taux de 19,6 %, absent de la politique : accepté en brouillon, refusé au gel.
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_base_version('a3250000-0000-4000-8000-000000000160', 'Taux non autorisé')
        || '{"gross_ht_cents":1300,"total_ht_cents":1300,"total_tax_cents":255,"total_ttc_cents":1555}'::jsonb,
      pg_temp.v3_line_items('a3250000-0000-4000-8000-000000000160',
        '{"quantity":1,"unit_price_ht_cents":1000,"tax_rate_bp":1960,"h_mo_per_unit":0,"unit_code":"u","pu_ht_cents":1300,"line_total_ht_cents":1300,"line_tax_cents":255,"line_total_ttc_cents":1555}'::jsonb)
    )]),
    -- EUHIST : PR 200 c, c_FO 1, remise 10 % (passera à c_FO 2 par les réglages).
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_base_version('a3250000-0000-4000-8000-000000000170', 'EUHIST')
        || '{"sale_coefficient_fo":1,"discount_bp":1000,"gross_ht_cents":200,"discount_applied_cents":20,"total_ht_cents":180,"total_tax_cents":36,"total_ttc_cents":216}'::jsonb,
      pg_temp.v3_line_items('a3250000-0000-4000-8000-000000000170',
        '{"quantity":1,"unit_price_ht_cents":200,"tax_rate_bp":2000,"h_mo_per_unit":0,"unit_code":"u","pu_ht_cents":200,"line_total_ht_cents":180,"line_tax_cents":36,"line_total_ttc_cents":216}'::jsonb)
    )]),
    -- Heures par unité : version à 10 %, ligne sans taux (taux de version attendu), Q 10 × 0,5 h/u.
    pg_temp.v3_try(array['set local role service_role', pg_temp.v3_create_sql(
      pg_temp.v3_base_version('a3250000-0000-4000-8000-000000000180', 'Heures par unité')
        || '{"tax_rate_bp":1000,"gross_ht_cents":37000,"total_ht_cents":37000,"total_tax_cents":3700,"total_ttc_cents":40700}'::jsonb,
      pg_temp.v3_line_items('a3250000-0000-4000-8000-000000000180',
        '{"quantity":10,"unit_price_ht_cents":1000,"h_mo_per_unit":0.5,"labor_role_id":"a3250000-0000-4000-8000-000000000020","unit_code":"u","pu_ht_cents":3700,"line_total_ht_cents":37000,"line_tax_cents":3700,"line_total_ttc_cents":40700}'::jsonb)
    )])
  ],
  array_fill('ok'::text, array[8]),
  'F25-01 fixture: under policy 3 the canonical RPC creates the v3 drafts S1, S2, S3, T-MARG, no-unit, 19.6 %, EUHIST and hours-per-unit'
);

select is(
  array[
    pg_temp.v3_probe(null, $a$
      select concat_ws('|', calc_engine_version, sale_coefficient_fo, sale_coefficient_mo,
        coalesce(discount_amount_cents::text, 'null'), discount_bp, gross_ht_cents, discount_applied_cents,
        commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents)
      from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000110'
    $a$),
    pg_temp.v3_probe(null, $a$
      select concat_ws('|', calc_engine_version, sale_coefficient_fo, sale_coefficient_mo,
        coalesce(discount_amount_cents::text, 'null'), discount_bp, gross_ht_cents, discount_applied_cents,
        commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents)
      from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000120'
    $a$),
    pg_temp.v3_probe(null, $a$
      select concat_ws('|', calc_engine_version, sale_coefficient_fo, sale_coefficient_mo,
        coalesce(discount_amount_cents::text, 'null'), discount_bp, gross_ht_cents, discount_applied_cents,
        commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents)
      from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000130'
    $a$)
  ],
  array[
    'ok:3|1.3000|1.2000|null|0|6905456|0|0|6905456|1381091|8286547|0',
    'ok:3|1.3000|1.2000|101|0|6905456|101|0|6905355|1381071|8286426|0',
    'ok:3|1.3000|1.2000|null|1000|6905456|690546|0|6214910|1242982|7457892|0'
  ],
  'F25-05 S1, S2 and S3 are stored as v3 with the §5.2 gross, discount (amount 101 with bp 0; rate 1000 without amount), HT, VAT and TTC'
);

select is(
  pg_temp.v3_probe(null, $a$
    select string_agg(
      concat_ws(':', pu_ht_cents, line_total_ht_cents, line_tax_cents, h_mo, unit_code, pricing_status, tax_rate_bp),
      ',' order by position)
    from public.estimate_items
    where version_id = 'a3250000-0000-4000-8000-000000000110' and item_type = 'line'
  $a$),
  (
    select 'ok:' || string_agg(
      concat_ws(':', line.pu, split.net, split.tax, line.h_mo, line.unit, 'priced', 2000),
      ',' order by line.ord)
    from v3_oracle_line line
    join v3_oracle_split split on split.ord = line.ord and split.scenario = 'S1'
  ),
  'F25-07 S1 lines keep the oracle PU, net and VAT, and h_mo is derived as round(Q × h/u, 3) (O1 39.820 ... O6 281.436)'
);

select is(
  pg_temp.v3_probe(null, $a$
    select concat_ws('|', tax_rate_bp, h_mo, h_mo_per_unit)
    from public.estimate_items where id = 'a3250000-0000-4000-8001-000000000181'
  $a$),
  'ok:1000|5.000|0.5000',
  'F25-08 a v3 line written without tax rate takes the version rate (1000, not the 2000 column default)'
);

-- ---------------------------------------------------------------------------
-- F25-06 : forme v3 de la version (CHECK estimate_versions_engine_v3_shape_check).
-- Sondes postgres sous contrat d'écrivain : seul le CHECK de forme peut refuser.
-- ---------------------------------------------------------------------------
create function pg_temp.v3_shape_probe(p_version uuid, p_assignments text)
returns text
language sql
as $$
  select pg_temp.v3_probe(array[
    format($s$select set_config('miaouffrage.estimate_v3_writer', %L, true)$s$, p_version),
    format('update public.estimate_versions set %s where id = %L', p_assignments, p_version)
  ])
$$;

select is(
  array[
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', $u$margin_mode = 'tiered'$u$),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'margin_multiplier = 1.3'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'global_coefficient = 1.1'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', $u$discount_mode = 'cascade', discount_steps = '{500}'$u$),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'discount_amount_cents = 101, discount_bp = 1000'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', $u$rounding_mode = 'up', rounding_step_cents = 100$u$),
    -- L'ajustement d'arrondi est géré (guard_estimate_rounding_adjustment) : marqueur de réglages.
    pg_temp.v3_probe(array[
      'set local role service_role',
      $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
      $s$select set_config('miaouffrage.estimate_settings_atomic', 'a3250000-0000-4000-8000-000000000180', true)$s$,
      $s$update public.estimate_versions set rounding_adjustment_cents = 1 where id = 'a3250000-0000-4000-8000-000000000180'$s$
    ]),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'total_ht_cents = total_ht_cents + 1, total_ttc_cents = total_ttc_cents + 1'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'sale_coefficient_fo = null'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'sale_coefficient_mo = 0'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'gross_ht_cents = null'),
    pg_temp.v3_shape_probe('a3250000-0000-4000-8000-000000000180', 'commercial_rounding_cents = null')
  ],
  array_fill(
    '23514 new row for relation "estimate_versions" violates check constraint "estimate_versions_engine_v3_shape_check"'::text,
    array[12]
  ),
  'F25-06 a v3 refuses tiers, a margin multiplier or global coefficient <> 1, cascade, amount + rate, mode up, a rounding adjustment, a broken total identity and null or zero v3 values'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_versions set sale_coefficient_fo = 1.3 where id = 'a3250000-0000-4000-8000-000000000100'$s$
  ]),
  '23514 new row for relation "estimate_versions" violates check constraint "estimate_versions_engine_v3_shape_check"',
  'F25-06 a v2 version cannot carry a sale coefficient'
);

-- ---------------------------------------------------------------------------
-- F25-07 : heures par unité (D4) et colonnes v3 réservées à la v3.
-- ---------------------------------------------------------------------------
create function pg_temp.v3_hu_insert_sql(p_index integer, p_columns text)
returns text
language sql
immutable
as $$
  select format(
    'insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, '
      'unit_price_ht_cents, k_fo, h_mo_majoration, k_mo, unit_code, pu_ht_cents, line_total_ht_cents, '
      'line_tax_cents, line_total_ttc_cents, quantity, tax_rate_bp, h_mo, h_mo_per_unit, '
      'h_mo_atelier_per_unit, h_mo_chantier_per_unit, labor_role_id) '
      'select %L, version.tenant_id, version.id, %L, ''line'', %s, ''H%s'', 1000, 1, 1, 1, ''u'', 0, 0, 0, 0, %s '
      'from public.estimate_versions version where version.id = ''a3250000-0000-4000-8000-000000000180''',
    pg_temp.v3_item('a3250000-0000-4000-8000-000000000180', p_index),
    pg_temp.v3_item('a3250000-0000-4000-8000-000000000180', 0),
    p_index,
    p_index,
    p_columns
  )
$$;

select is(
  pg_temp.v3_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
      pg_temp.v3_hu_insert_sql(5, $c$10, null, null, 0.5, null, null, 'a3250000-0000-4000-8000-000000000020'$c$)
    ],
    $a$select concat_ws('|', h_mo, tax_rate_bp) from public.estimate_items where id = 'a3250000-0000-4000-8001-000000000185'$a$
  ),
  'ok:5.000|1000',
  'F25-07 insert: h_mo = round(Q × h/u, 3) = 10 × 0.5 and the missing rate takes the version rate'
);

select is(
  pg_temp.v3_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
      pg_temp.v3_hu_insert_sql(6, $c$2.5, 1000, null, 0.001, null, null, null$c$),
      pg_temp.v3_hu_insert_sql(7, $c$10, 1000, null, 0, 0.25, 0.125, null$c$)
    ],
    $a$select string_agg(concat_ws(' ', h_mo, h_mo_atelier, h_mo_chantier), '|' order by position)
       from public.estimate_items
       where id in ('a3250000-0000-4000-8001-000000000186', 'a3250000-0000-4000-8001-000000000187')$a$
  ),
  'ok:0.003|0.000 2.500 1.250',
  'F25-07 insert: line hours round half up at 3 decimals (2.5 × 0.001 = 0.003) and workshop/site hours derive from their own per-unit columns'
);

select is(
  pg_temp.v3_probe(array[
    $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
    pg_temp.v3_hu_insert_sql(8, $c$10, 1000, 5, null, null, null, null$c$)
  ]),
  '22023 ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED',
  'F25-07 insert: h_mo > 0 without hours per unit is refused (no silent division)'
);

select is(
  array[
    pg_temp.v3_probe(array[
      $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
      $s$update public.estimate_items set h_mo = 7 where id = 'a3250000-0000-4000-8001-000000000181'$s$
    ]),
    pg_temp.v3_probe(
      array[
        $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
        $s$update public.estimate_items set quantity = 20 where id = 'a3250000-0000-4000-8001-000000000181'$s$
      ],
      $a$select h_mo::text from public.estimate_items where id = 'a3250000-0000-4000-8001-000000000181'$a$
    ),
    pg_temp.v3_probe(
      array[
        $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
        $s$update public.estimate_items set h_mo_per_unit = 0.75 where id = 'a3250000-0000-4000-8001-000000000181'$s$
      ],
      $a$select h_mo::text from public.estimate_items where id = 'a3250000-0000-4000-8001-000000000181'$a$
    )
  ],
  array['22023 ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED', 'ok:10.000', 'ok:7.500'],
  'F25-07 update: h_mo edited alone is refused; it follows the quantity (20 × 0.5) and the hours per unit (10 × 0.75)'
);

select is(
  array[
    pg_temp.v3_probe(array[$s$update public.estimate_items set h_mo_per_unit = 0.5 where id = 'a3250000-0000-4000-8001-000000000101'$s$]),
    pg_temp.v3_probe(array[$s$update public.estimate_items set unit_code = 'u' where id = 'a3250000-0000-4000-8001-000000000101'$s$]),
    pg_temp.v3_probe(array[$s$update public.estimate_items set pricing_status = 'included' where id = 'a3250000-0000-4000-8001-000000000101'$s$]),
    pg_temp.v3_probe(array[
      $s$insert into public.estimate_items (
           id, tenant_id, version_id, parent_id, item_type, position, title, description,
           quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
           h_mo_chantier_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
         )
         select 'a3250000-0000-4000-8001-000000000102', tenant_id, id, 'a3250000-0000-4000-8001-000000000100', 'line', 2,
           'Ligne v2 avec h/u', 'u', 1, 100, 2000, 1, 0, 1, 1, 0.1, 100, 100, 20, 120
         from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000100'$s$
    ])
  ],
  array_fill('0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED'::text, array[4]),
  'F25-07 a v1/v2 line refuses hours per unit (update and insert), a unit code and a non-priced status'
);

-- CHECK du §6.2 (23514, nom libre) ou refus du déclencheur de colonnes, au choix de M4.
select matches(
  pg_temp.v3_probe(array[
    $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000180', true)$s$,
    $s$insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title, unit_code)
       select 'a3250000-0000-4000-8001-000000000189', tenant_id, id, 'section', 9, 'Section avec unité', 'u'
       from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000180'$s$
  ]),
  '^(23514 |0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED$)',
  'F25-07 a section never carries a unit, a status or hours per unit'
);

select is(
  array[
    pg_temp.v3_probe(array['set local role service_role',
      $s$update public.estimate_versions set sale_coefficient_fo = 1.31 where id = 'a3250000-0000-4000-8000-000000000180'$s$]),
    pg_temp.v3_probe(array['set local role service_role',
      $s$update public.estimate_items set h_mo_per_unit = 0.6 where id = 'a3250000-0000-4000-8001-000000000181'$s$]),
    pg_temp.v3_probe(array['set local role service_role',
      $s$update public.estimate_items set unit_code = 'ml' where id = 'a3250000-0000-4000-8001-000000000181'$s$]),
    pg_temp.v3_probe(array['set local role service_role',
      $s$update public.estimate_items set pricing_status = 'included' where id = 'a3250000-0000-4000-8001-000000000181'$s$])
  ],
  array_fill('0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED'::text, array[4]),
  'F25-07 the new v3 columns are calculation columns of the writer contract'
);

-- ---------------------------------------------------------------------------
-- F25-10 à F25-12 : gel v3 (recalcul complet, égalité au centime, unité, taux autorisés).
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
      'a3250000-0000-4000-8000-000000000110',
      pg_temp.v3_oracle_context('S1'),
      pg_temp.v3_shift(pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000110', 'S1'),
        0, 1, array['line_tax_cents', 'line_total_ttc_cents']),
      pg_temp.v3_oracle_totals('S1')
    )]),
    pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
      'a3250000-0000-4000-8000-000000000110',
      pg_temp.v3_oracle_context('S1'),
      pg_temp.v3_adjust(pg_temp.v3_adjust(pg_temp.v3_adjust(
        pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000110', 'S1'),
        0, 'snapshot_fo_ht_cents', 1), 0, 'snapshot_mo_ht_cents', -1), 0, 'snapshot_mo_chantier_ht_cents', -1),
      pg_temp.v3_oracle_totals('S1')
    )]),
    pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
      'a3250000-0000-4000-8000-000000000110',
      pg_temp.v3_oracle_context('S1'),
      pg_temp.v3_adjust(pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000110', 'S1'),
        0, 'snapshot_gross_fo_ht_cents', 1),
      pg_temp.v3_oracle_totals('S1')
    )]),
    pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
      'a3250000-0000-4000-8000-000000000120',
      pg_temp.v3_oracle_context('S2'),
      pg_temp.v3_shift(pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000120', 'S2'),
        0, 1, array['line_total_ht_cents', 'snapshot_mo_ht_cents', 'snapshot_mo_chantier_ht_cents', 'line_total_ttc_cents']),
      pg_temp.v3_oracle_totals('S2')
    )])
  ],
  array_fill('22023 ESTIMATE_V3_PROJECTION_MISMATCH'::text, array[4]),
  'F25-10 freeze: one cent moved inside a VAT group, between net FO and MO, into the gross FO share, or between two discount shares is refused'
);

select is(
  pg_temp.v3_try(array['set local role service_role', pg_temp.v3_freeze_sql(
    'a3250000-0000-4000-8000-000000000110',
    pg_temp.v3_oracle_context('S1'),
    pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000110', 'S1'),
    pg_temp.v3_oracle_totals('S1')
  )]),
  'ok',
  'F25-10 freeze: the exact S1 projection is accepted for approval'
);

select is(
  pg_temp.v3_probe(null, $a$
    select concat_ws('|',
      version.calc_snapshot_content_revision = version.content_revision,
      version.calc_snapshot_context->>'engine',
      version.calc_snapshot_context->>'cost_subtotal_cents',
      version.calc_snapshot_context->'tax_breakdown' = '[{"rate_bp":2000,"base_cents":6905456,"tax_cents":1381091}]'::jsonb,
      version.calc_snapshot_context ? 'effective_margin_multiplier',
      version.calc_snapshot_context ? 'margin_tiers',
      (select sum(item.snapshot_gross_ht_cents) from public.estimate_items item where item.version_id = version.id),
      (select sum(item.snapshot_gross_fo_ht_cents) from public.estimate_items item where item.version_id = version.id),
      (select string_agg(item.snapshot_pu_ht_cents::text, ',' order by item.position)
       from public.estimate_items item where item.version_id = version.id and item.item_type = 'line'),
      version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents)
    from public.estimate_versions version
    where version.id = 'a3250000-0000-4000-8000-000000000110'
  $a$),
  'ok:true|3|5487177|true|false|false|6905456|4165754|16663,20832,7605,1353,31400,16732,7388|6905456|1381091|8286547',
  'F25-10 the S1 freeze is fresh, stores the v3 context (cost, VAT by rate, no v2 multiplier or tiers) and the frozen gross and PU'
);

select is(
  array[
    pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
      'a3250000-0000-4000-8000-000000000120',
      pg_temp.v3_oracle_context('S2'),
      pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000120', 'S2'),
      pg_temp.v3_oracle_totals('S2')
    )]),
    pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
      'a3250000-0000-4000-8000-000000000130',
      pg_temp.v3_oracle_context('S3'),
      pg_temp.v3_oracle_snapshots('a3250000-0000-4000-8000-000000000130', 'S3'),
      pg_temp.v3_oracle_totals('S3')
    )])
  ],
  array['ok', 'ok'],
  'F25-10 freeze: the exact S2 (amount 1,01 €) and S3 (rate 10 %) projections are accepted'
);

select is(
  pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
    'a3250000-0000-4000-8000-000000000150',
    '{"engine":3,"labor_split_enabled":false,"labor_roles":[],"sale_coefficients":{"fo":1.3,"mo":1.2},"discount":{"kind":"none","requested_cents":null,"rate_bp":null,"base_cents":1300,"applied_cents":0},"commercial_rounding":{"mode":"none","step_cents":1,"applied_cents":0},"cost_subtotal_cents":1000,"realized_sale_coefficient":1.3,"tax_breakdown":[{"rate_bp":2000,"base_cents":1300,"tax_cents":260}]}'::jsonb,
    pg_temp.v3_line_snapshot('a3250000-0000-4000-8000-000000000150',
      '{"snapshot_pu_ht_cents":1300,"snapshot_gross_ht_cents":1300,"snapshot_gross_fo_ht_cents":1300,"snapshot_fo_ht_cents":1300,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":1300,"line_tax_cents":260,"line_total_ttc_cents":1560}'::jsonb),
    '{"gross_ht_cents":1300,"discount_applied_cents":0,"commercial_rounding_cents":0,"total_ht_cents":1300,"total_tax_cents":260,"total_ttc_cents":1560,"rounding_adjustment_cents":0}'::jsonb
  )]),
  '22023 ESTIMATE_V3_UNIT_REQUIRED',
  'F25-11 freeze: a priced v3 line without unit is refused'
);

select is(
  pg_temp.v3_probe(array['set local role service_role', pg_temp.v3_freeze_sql(
    'a3250000-0000-4000-8000-000000000160',
    '{"engine":3,"labor_split_enabled":false,"labor_roles":[],"sale_coefficients":{"fo":1.3,"mo":1.2},"discount":{"kind":"none","requested_cents":null,"rate_bp":null,"base_cents":1300,"applied_cents":0},"commercial_rounding":{"mode":"none","step_cents":1,"applied_cents":0},"cost_subtotal_cents":1000,"realized_sale_coefficient":1.3,"tax_breakdown":[{"rate_bp":1960,"base_cents":1300,"tax_cents":255}]}'::jsonb,
    pg_temp.v3_line_snapshot('a3250000-0000-4000-8000-000000000160',
      '{"snapshot_pu_ht_cents":1300,"snapshot_gross_ht_cents":1300,"snapshot_gross_fo_ht_cents":1300,"snapshot_fo_ht_cents":1300,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":1300,"line_tax_cents":255,"line_total_ttc_cents":1555}'::jsonb),
    '{"gross_ht_cents":1300,"discount_applied_cents":0,"commercial_rounding_cents":0,"total_ht_cents":1300,"total_tax_cents":255,"total_ttc_cents":1555,"rounding_adjustment_cents":0}'::jsonb
  )]),
  '22023 ESTIMATE_V3_TAX_RATE_NOT_ALLOWED',
  'F25-12 freeze: a VAT rate outside the tenant policy (19.6 %) is refused'
);

-- ---------------------------------------------------------------------------
-- F25-13 : chaque nouvelle colonne de version incrémente content_revision et périme le gel.
-- Le CHECK de forme est retiré dans la sonde (annulée) pour changer une seule colonne.
-- ---------------------------------------------------------------------------
create temporary table v3_s1_revision on commit drop as
select content_revision as revision
from public.estimate_versions
where id = 'a3250000-0000-4000-8000-000000000110';

create function pg_temp.v3_revision_probe(p_assignment text)
returns text
language sql
as $$
  select pg_temp.v3_probe(
    array[
      'set constraints all immediate',
      'alter table public.estimate_versions drop constraint estimate_versions_engine_v3_shape_check',
      $s$select set_config('miaouffrage.estimate_v3_writer', 'a3250000-0000-4000-8000-000000000110', true)$s$,
      format('update public.estimate_versions set %s where id = %L', p_assignment, 'a3250000-0000-4000-8000-000000000110')
    ],
    $a$select (version.content_revision > snapshot.revision
         and version.calc_snapshot_content_revision is distinct from version.content_revision)::text
       from public.estimate_versions version cross join v3_s1_revision snapshot
       where version.id = 'a3250000-0000-4000-8000-000000000110'$a$
  )
$$;

select is(
  array[
    pg_temp.v3_revision_probe('sale_coefficient_fo = 1.31'),
    pg_temp.v3_revision_probe('sale_coefficient_mo = 1.21'),
    pg_temp.v3_revision_probe('gross_ht_cents = gross_ht_cents + 1'),
    pg_temp.v3_revision_probe('discount_applied_cents = 1'),
    pg_temp.v3_revision_probe('commercial_rounding_cents = 1')
  ],
  array_fill('ok:true'::text, array[5]),
  'F25-13 sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents and commercial_rounding_cents each bump content_revision and stale the freeze'
);

-- ---------------------------------------------------------------------------
-- F25-14 : réglages v3 (EUHIST) : l'intention de remise n'est jamais réécrite.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array[
    format(
      'insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values (%L, %L, %L, statement_timestamp() + interval ''30 minutes'', %L)',
      'a3250000-0000-4000-8000-000000000170', 'a3250000-0000-4000-8000-000000000001', pg_temp.fx('tenant_a'),
      'a3250000-0000-4000-8000-000000000401'
    ),
    format(
      'insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id) values (%L, %L, %L, statement_timestamp() + interval ''30 minutes'', %L)',
      'a3250000-0000-4000-8000-000000000180', 'a3250000-0000-4000-8000-000000000001', pg_temp.fx('tenant_a'),
      'a3250000-0000-4000-8000-000000000402'
    )
  ]),
  'ok',
  'fixture: the owner holds the draft leases of EUHIST and hours-per-unit'
);

create function pg_temp.v3_settings_sql(p_patch jsonb, p_projections jsonb, p_totals jsonb)
returns text
language sql
stable
as $$
  select format(
    'select public.save_estimate_settings_atomic(%1$L::uuid, %2$L::uuid, %3$L::uuid, '
      '(select updated_at from public.estimate_versions where id = %1$L::uuid), '
      '(select content_revision from public.estimate_versions where id = %1$L::uuid), '
      '%4$L::uuid, %5$L::jsonb, %6$L::jsonb, %7$L::jsonb, %8$L::jsonb)',
    'a3250000-0000-4000-8000-000000000170',
    pg_temp.fx('tenant_a'),
    'a3250000-0000-4000-8000-000000000001',
    'a3250000-0000-4000-8000-000000000401',
    p_patch,
    p_projections,
    p_totals,
    '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb
  )
$$;

select is(
  pg_temp.v3_probe(
    array[
      'set local role service_role',
      pg_temp.v3_settings_sql(
        '{"sale_coefficient_fo":2}'::jsonb,
        '[{"id":"a3250000-0000-4000-8001-000000000171","pu_ht_cents":400,"line_total_ht_cents":360,"line_tax_cents":72,"line_total_ttc_cents":432,"tax_rate_bp":2000}]'::jsonb,
        '{"total_ht_cents":360,"total_tax_cents":72,"total_ttc_cents":432,"rounding_adjustment_cents":0,"gross_ht_cents":400,"discount_applied_cents":40,"commercial_rounding_cents":0}'::jsonb
      )
    ],
    $a$select concat_ws('|', version.sale_coefficient_fo, coalesce(version.discount_amount_cents::text, 'null'),
         version.discount_bp, version.gross_ht_cents, version.discount_applied_cents, version.total_ht_cents,
         version.total_tax_cents, version.total_ttc_cents, item.pu_ht_cents)
       from public.estimate_versions version
       join public.estimate_items item on item.version_id = version.id and item.item_type = 'line'
       where version.id = 'a3250000-0000-4000-8000-000000000170'$a$
  ),
  'ok:2.0000|null|1000|400|40|360|72|432|400',
  'F25-14 EUHIST: c_FO 1 → 2 with a 10 % intent gives gross 400, discount 40, HT 360, VAT 72, TTC 432 and discount_bp stays 1000 (no derived amount)'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    pg_temp.v3_settings_sql(
      '{"sale_coefficient_fo":2}'::jsonb,
      '[{"id":"a3250000-0000-4000-8001-000000000171","pu_ht_cents":401,"line_total_ht_cents":360,"line_tax_cents":72,"line_total_ttc_cents":432,"tax_rate_bp":2000}]'::jsonb,
      '{"total_ht_cents":360,"total_tax_cents":72,"total_ttc_cents":432,"rounding_adjustment_cents":0,"gross_ht_cents":400,"discount_applied_cents":40,"commercial_rounding_cents":0}'::jsonb
    )
  ]),
  '22023 ESTIMATE_V3_PROJECTION_MISMATCH',
  'F25-09 save: the settings RPC refuses a v3 PU off by one cent'
);

-- ---------------------------------------------------------------------------
-- F25-15 : file d'approbation, marque nette exacte sur un gel frais, NULL sinon.
-- ---------------------------------------------------------------------------
select is(
  array[
    pg_temp.v3_try(array[
      'set local role service_role',
      format(
        'select public.open_estimate_review_cycle(%L::uuid, %L::uuid, %L::uuid, %L::uuid, array[%L::uuid], null, ''{}''::jsonb)',
        'a3250000-0000-4000-8000-000000000110', pg_temp.fx('tenant_a'), 'a3250000-0000-4000-8000-000000000001',
        'a3250000-0000-4000-8000-000000000002', 'a3250000-0000-4000-8000-000000000030'
      )
    ]),
    pg_temp.v3_try(array[
      'set local role service_role',
      pg_temp.v3_freeze_sql(
        'a3250000-0000-4000-8000-000000000140',
        '{"engine":3,"labor_split_enabled":false,"labor_roles":[],"sale_coefficients":{"fo":1.25,"mo":1.25},"discount":{"kind":"rate","requested_cents":null,"rate_bp":2000,"base_cents":12500,"applied_cents":2500},"commercial_rounding":{"mode":"none","step_cents":1,"applied_cents":0},"cost_subtotal_cents":10000,"realized_sale_coefficient":1,"tax_breakdown":[{"rate_bp":2000,"base_cents":10000,"tax_cents":2000}]}'::jsonb,
        pg_temp.v3_line_snapshot('a3250000-0000-4000-8000-000000000140',
          '{"snapshot_pu_ht_cents":12500,"snapshot_gross_ht_cents":12500,"snapshot_gross_fo_ht_cents":12500,"snapshot_fo_ht_cents":10000,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":10000,"line_tax_cents":2000,"line_total_ttc_cents":12000}'::jsonb),
        '{"gross_ht_cents":12500,"discount_applied_cents":2500,"commercial_rounding_cents":0,"total_ht_cents":10000,"total_tax_cents":2000,"total_ttc_cents":12000,"rounding_adjustment_cents":0}'::jsonb
      ),
      format(
        'select public.open_estimate_review_cycle(%L::uuid, %L::uuid, %L::uuid, %L::uuid, array[%L::uuid], null, ''{}''::jsonb)',
        'a3250000-0000-4000-8000-000000000140', pg_temp.fx('tenant_a'), 'a3250000-0000-4000-8000-000000000001',
        'a3250000-0000-4000-8000-000000000002', 'a3250000-0000-4000-8000-000000000030'
      )
    ])
  ],
  array['ok', 'ok'],
  'fixture: S1 and T-MARG enter review with a fresh v3 freeze'
);

create function pg_temp.v3_queue_margin(p_version uuid, p_statements text[] default '{}'::text[])
returns text
language sql
as $$
  select pg_temp.v3_probe(
    p_statements || array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000002', true)$s$
    ],
    format(
      $a$select coalesce(queue.margin_bp::text, 'null') from public.list_approval_queue('priority') queue where queue.version_id = %L$a$,
      p_version
    )
  )
$$;

select is(
  array[
    pg_temp.v3_queue_margin('a3250000-0000-4000-8000-000000000110'),
    pg_temp.v3_queue_margin('a3250000-0000-4000-8000-000000000140'),
    pg_temp.v3_queue_margin(
      'a3250000-0000-4000-8000-000000000110',
      array[$s$update public.labor_roles set hourly_rate_cents = 4100 where id = 'a3250000-0000-4000-8000-000000000020'$s$]
    )
  ],
  array['ok:2054', 'ok:0', 'ok:null'],
  'F25-15 approval queue: S1 net markup (6 905 456 − 5 487 177) / 6 905 456 = 2054 bp, T-MARG exactly 0 (not NULL), NULL once the freeze is stale'
);

-- ---------------------------------------------------------------------------
-- F25-16 : métré sur une v3 refusé par le contrat d'écrivain (P-19), rien d'écrit.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array[
    format(
      'insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by) '
        'values (%L, %L, %L, ''A''::public.takeoff_job_level, ''completed''::public.takeoff_job_status, ''persistance-v3.pdf'', %L)',
      'a3250000-0000-4000-8000-000000000301', pg_temp.fx('tenant_a'), 'a3250000-0000-4000-8000-000000000180',
      'a3250000-0000-4000-8000-000000000001'
    ),
    format(
      'insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page) '
        'values (%L, %L, %L, ''Tube cuivre'', 2, ''ml'', 0.95, ''Repère localisé'', ''persistance-v3.pdf'', 1)',
      'a3250000-0000-4000-8000-000000000302', pg_temp.fx('tenant_a'), 'a3250000-0000-4000-8000-000000000301'
    )
  ]),
  'ok',
  'fixture: a completed takeoff job targets the hours-per-unit v3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000001', true)$s$,
    $s$select count(*) from public.apply_takeoff_job_guarded_atomic(
         'a3250000-0000-4000-8000-000000000301',
         'append',
         'a3250000-0000-4000-8001-000000000180',
         '[{"item_id":"a3250000-0000-4000-8000-000000000302","source_order":0,"rule_id":null,"action":"set_price","designation":"Tube cuivre","unit_price_cents":2500,"category_id":null,"assembly_id":null}]'::jsonb
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F25-16 a takeoff job cannot be applied to a v3 created by the canonical path'
);

-- ---------------------------------------------------------------------------
-- F25-17, F25-18 : retour à la politique 2, montants v3 conservés, duplication v3 → v3.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_try(array[
    'set local role service_role',
    pg_temp.v3_policy_sql(quote_literal(pg_temp.fx('tenant_a')) || '::uuid', 2, 1.30, 1.20, 'Retour au moteur 2', 'a3250000-0000-4000-8000-000000000002')
  ]),
  'ok',
  'F25-17 fixture: service_role puts tenant A back to engine 2'
);

select is(
  array[
    pg_temp.v3_probe(
      array[
        'set local role service_role',
        pg_temp.v3_create_sql(
          pg_temp.v3_v2_version('a3250000-0000-4000-8000-0000000001b0', 'Après retour à 2'),
          '[]'::jsonb
        )
      ],
      $a$select calc_engine_version::text from public.estimate_versions where id = 'a3250000-0000-4000-8000-0000000001b0'$a$
    ),
    pg_temp.v3_probe(array[
      'set local role service_role',
      pg_temp.v3_create_sql(
        pg_temp.v3_oracle_version('a3250000-0000-4000-8000-000000000190', 'S1'),
        pg_temp.v3_oracle_items('a3250000-0000-4000-8000-000000000190', 'S1')
      )
    ]),
    pg_temp.v3_probe(null, $a$
      select concat_ws('|', calc_engine_version, gross_ht_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
      from public.estimate_versions where id = 'a3250000-0000-4000-8000-000000000110'
    $a$),
    pg_temp.v3_probe(null, format(
      $a$select concat_ws('|', count(*), bool_or(previous_policy->>'new_estimate_calc_engine' = '3'
           and new_policy->>'new_estimate_calc_engine' = '2'))
         from public.tenant_calc_policy_events where tenant_id = %L$a$,
      pg_temp.fx('tenant_a')
    ))
  ],
  array[
    'ok:2',
    '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
    'ok:3|6905456|6905456|1381091|8286547',
    'ok:2|true'
  ],
  'F25-17 back on policy 2: new versions are v2, a client still expecting 3 is refused, S1 keeps its engine and amounts, the change is journaled'
);

select is(
  pg_temp.v3_probe(
    array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3250000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('v3_test.duplicate_id', public.duplicate_estimate_version('a3250000-0000-4000-8000-000000000120', false)::text, true)$s$,
      'reset role'
    ],
    $a$select concat_ws('|', version.calc_engine_version, version.sale_coefficient_fo, version.sale_coefficient_mo,
         coalesce(version.discount_amount_cents::text, 'null'), version.discount_bp, version.gross_ht_cents,
         version.discount_applied_cents, version.commercial_rounding_cents, version.total_ht_cents,
         version.total_tax_cents, version.total_ttc_cents, version.rounding_adjustment_cents,
         pg_temp.v3_lines_signature(version.id) = pg_temp.v3_lines_signature('a3250000-0000-4000-8000-000000000120'))
       from public.estimate_versions version
       where version.id = current_setting('v3_test.duplicate_id')::uuid$a$
  ),
  'ok:3|1.3000|1.2000|101|0|6905456|101|0|6905355|1381071|8286426|0|true',
  'F25-18 duplicating S2 under policy 2 gives a v3 with the same coefficients, intent, amounts and lines'
);

select * from finish();
rollback;
