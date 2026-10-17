-- Lot 2, sous-lot 2.5 : ligne v3 non chiffrée (D9, 2.4 R-08, décisions d'implémentation de M4).
-- Contrat : docs/testing/estimate-engine-v3-2.5.md, « Implémentation SQL (M4) », F25-21 et F25-22.
-- Écrite rouge avant M4 (mêmes sondes que estimate-engine-v3-persistence.test.sql : chaque
-- assertion échoue sur son propre motif tant que M4 est absente).
--
-- F25-21 : une ligne non chiffrée stocke h_mo* = 0.000 (h/u renseigné), un PU nul, net et TVA
-- nuls, et ne compte pas dans le pied ; un PU ou un montant sur elle est refusé à la sauvegarde.
-- F25-22 : le gel v3 l'accepte avec un PU figé nul et des parts figées à 0.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.np_probe(p_statements text[], p_action text default null)
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
    raise exception using errcode = 'P0001', message = 'NP_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'NP_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', 'a3260000-0000-4000-8000-000000000001', 'authenticated',
  'authenticated', 'v3-nonpriced-owner@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = 'a3260000-0000-4000-8000-000000000001';

create temporary table np_fx on commit drop as
select membership.tenant_id
from public.tenant_memberships membership
where membership.user_id = 'a3260000-0000-4000-8000-000000000001';

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'a3260000-0000-4000-8000-000000000010', tenant_id, 'a3260000-0000-4000-8000-000000000001',
  'Projet ligne non chiffrée', false
from np_fx;

insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position)
select 'a3260000-0000-4000-8000-000000000020', tenant_id, 'a3260000-0000-4000-8000-000000000001',
  'Tuyauteur', 4000, true, 1
from np_fx;

-- Version : une ligne chiffrée (1 u, PR 1 000, c_FO 1,30 → 1 300) et une ligne « incluse »
-- (3 u, PR 1 000, 2 h/u, saisies conservées, contribution nulle).
create function pg_temp.np_create_sql(p_nonpriced jsonb, p_priced jsonb default '{}'::jsonb)
returns text
language sql
stable
as $$
  select format(
    'select public.persist_estimate_creation_atomic(%L::uuid, %L::uuid, %L::uuid, null, %L::jsonb, %L::jsonb, null)',
    (select tenant_id from np_fx),
    'a3260000-0000-4000-8000-000000000001',
    'a3260000-0000-4000-8000-000000000010',
    '{"id":"a3260000-0000-4000-8000-000000000100","title":"Non chiffrée","date_devis":"2026-10-17","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_amount_cents":null,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"contractor_role":"principal","calc_engine_version":3,"sale_coefficient_fo":1.30,"sale_coefficient_mo":1.20,"gross_ht_cents":1300,"discount_applied_cents":0,"commercial_rounding_cents":0,"total_ht_cents":1300,"total_tax_cents":260,"total_ttc_cents":1560}'::jsonb,
    jsonb_build_array(
      '{"id":"a3260000-0000-4000-8001-000000000100","parent_id":null,"item_type":"section","position":1,"title":"Lot"}'::jsonb,
      '{"id":"a3260000-0000-4000-8001-000000000101","parent_id":"a3260000-0000-4000-8001-000000000100","item_type":"line","position":1,"title":"Chiffrée","quantity":1,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"k_fo":1,"h_mo_majoration":1,"k_mo":1,"h_mo_per_unit":0,"unit_code":"u","pricing_status":"priced","pu_ht_cents":1300,"line_total_ht_cents":1300,"line_tax_cents":260,"line_total_ttc_cents":1560}'::jsonb || p_priced,
      '{"id":"a3260000-0000-4000-8001-000000000102","parent_id":"a3260000-0000-4000-8001-000000000100","item_type":"line","position":2,"title":"Incluse","quantity":3,"unit_price_ht_cents":1000,"tax_rate_bp":2000,"k_fo":1,"h_mo_majoration":1,"k_mo":1,"h_mo_per_unit":2,"labor_role_id":"a3260000-0000-4000-8000-000000000020","unit_code":"u","pricing_status":"included","pu_ht_cents":null,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb
        || p_nonpriced
    )
  )
$$;

select is(
  pg_temp.np_probe(array[
    'set local role service_role',
    format(
      'select public.set_tenant_calc_policy(p_tenant_id => %L::uuid, p_new_estimate_calc_engine => 3::smallint, '
        'p_default_sale_coefficient_fo => 1.30, p_default_sale_coefficient_mo => 1.20, '
        'p_allowed_tax_rates_bp => null, p_change_reason => %L, p_actor_user_id => %L::uuid)',
      (select tenant_id from np_fx), 'Pilote ligne non chiffrée', 'a3260000-0000-4000-8000-000000000001'
    ),
    pg_temp.np_create_sql('{}'::jsonb)
  ], $a$
    select concat_ws('|', item.pricing_status, coalesce(item.pu_ht_cents::text, 'null'), item.h_mo,
      item.line_total_ht_cents, item.line_tax_cents, version.gross_ht_cents, version.total_ht_cents)
    from public.estimate_items item
    join public.estimate_versions version on version.id = item.version_id
    where item.id = 'a3260000-0000-4000-8001-000000000102'
  $a$),
  'ok:included|null|0.000|0|0|1300|1300',
  'F25-21 a non-priced v3 line stores no PU, h_mo 0.000 (hours per unit kept), zero amounts, and stays out of the gross'
);

select is(
  array[
    pg_temp.np_probe(array[
      'set local role service_role',
      format(
        'select public.set_tenant_calc_policy(p_tenant_id => %L::uuid, p_new_estimate_calc_engine => 3::smallint, '
          'p_default_sale_coefficient_fo => 1.30, p_default_sale_coefficient_mo => 1.20, '
          'p_allowed_tax_rates_bp => null, p_change_reason => %L, p_actor_user_id => %L::uuid)',
        (select tenant_id from np_fx), 'Pilote ligne non chiffrée', 'a3260000-0000-4000-8000-000000000001'
      ),
      pg_temp.np_create_sql('{"pu_ht_cents":2000}'::jsonb)
    ]),
    pg_temp.np_probe(array[
      'set local role service_role',
      format(
        'select public.set_tenant_calc_policy(p_tenant_id => %L::uuid, p_new_estimate_calc_engine => 3::smallint, '
          'p_default_sale_coefficient_fo => 1.30, p_default_sale_coefficient_mo => 1.20, '
          'p_allowed_tax_rates_bp => null, p_change_reason => %L, p_actor_user_id => %L::uuid)',
        (select tenant_id from np_fx), 'Pilote ligne non chiffrée', 'a3260000-0000-4000-8000-000000000001'
      ),
      pg_temp.np_create_sql(
        '{"line_total_ht_cents":1,"line_total_ttc_cents":1}'::jsonb,
        '{"line_total_ht_cents":1299,"line_total_ttc_cents":1559}'::jsonb
      )
    ])
  ],
  array_fill('22023 ESTIMATE_V3_PROJECTION_MISMATCH'::text, array[2]),
  'F25-21 save: a non-priced v3 line carrying a PU or an amount is refused'
);

select is(
  pg_temp.np_probe(array[
    'set local role service_role',
    format(
      'select public.set_tenant_calc_policy(p_tenant_id => %L::uuid, p_new_estimate_calc_engine => 3::smallint, '
        'p_default_sale_coefficient_fo => 1.30, p_default_sale_coefficient_mo => 1.20, '
        'p_allowed_tax_rates_bp => null, p_change_reason => %L, p_actor_user_id => %L::uuid)',
      (select tenant_id from np_fx), 'Pilote ligne non chiffrée', 'a3260000-0000-4000-8000-000000000001'
    ),
    pg_temp.np_create_sql('{}'::jsonb),
    format(
      'select public.freeze_estimate_v3_snapshot(%1$L::uuid, %2$L::uuid, '
        '(select updated_at from public.estimate_versions where id = %1$L::uuid), '
        '(select content_revision from public.estimate_versions where id = %1$L::uuid), '
        '%3$L::uuid, ''approval'', %4$L::jsonb, %5$L::jsonb, %6$L::jsonb)',
      'a3260000-0000-4000-8000-000000000100',
      (select tenant_id from np_fx),
      'a3260000-0000-4000-8000-000000000001',
      '{"engine":3,"labor_split_enabled":false,"labor_roles":[{"id":"a3260000-0000-4000-8000-000000000020","hourly_rate_cents":4000}],"sale_coefficients":{"fo":1.3,"mo":1.2},"discount":{"kind":"none","requested_cents":null,"rate_bp":null,"base_cents":1300,"applied_cents":0},"commercial_rounding":{"mode":"none","step_cents":1,"applied_cents":0},"cost_subtotal_cents":1000,"realized_sale_coefficient":1.3,"tax_breakdown":[{"rate_bp":2000,"base_cents":1300,"tax_cents":260}]}',
      '[{"id":"a3260000-0000-4000-8001-000000000101","snapshot_pu_ht_cents":1300,"snapshot_gross_ht_cents":1300,"snapshot_gross_fo_ht_cents":1300,"snapshot_fo_ht_cents":1300,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":1300,"line_tax_cents":260,"line_total_ttc_cents":1560},'
        '{"id":"a3260000-0000-4000-8001-000000000102","snapshot_pu_ht_cents":null,"snapshot_gross_ht_cents":0,"snapshot_gross_fo_ht_cents":0,"snapshot_fo_ht_cents":0,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}]',
      '{"gross_ht_cents":1300,"discount_applied_cents":0,"commercial_rounding_cents":0,"total_ht_cents":1300,"total_tax_cents":260,"total_ttc_cents":1560,"rounding_adjustment_cents":0}'
    )
  ], $a$
    select concat_ws('|', (version.calc_snapshot_content_revision = version.content_revision)::text,
      coalesce(item.snapshot_pu_ht_cents::text, 'null'), item.snapshot_gross_ht_cents,
      item.snapshot_fo_ht_cents, item.snapshot_mo_chantier_ht_cents, coalesce(item.pu_ht_cents::text, 'null'))
    from public.estimate_items item
    join public.estimate_versions version on version.id = item.version_id
    where item.id = 'a3260000-0000-4000-8001-000000000102'
  $a$),
  'ok:true|null|0|0|0|null',
  'F25-22 the v3 freeze accepts a non-priced line with no frozen PU and zero frozen shares'
);

select * from finish();
rollback;
