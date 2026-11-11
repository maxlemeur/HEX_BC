-- TI-534, lot 1 : provision FO automatique d'une ligne du moteur 3 (pertes, chutes, petites fournitures).
-- FO_unitaire = P × provision FO × K FO. Décisions validées le 24/10/2026 (Linear TI-534), règles de calcul :
-- docs/metier/regles-de-calcul.md ; miroir TS des projections : src/lib/estimates/fo-provision.ts.
-- - le type FO porte la provision d'une ligne neuve (1,030 tube et calorifuge, 1,010 sinon) ; sans type : 1,010 ;
-- - une section et une ligne v1/v2 gardent 1,000 ; une autre valeur y est refusée par son nom ;
-- - la provision est posée à la création et redérivée quand le type FO change ; une valeur fournie à
--   l'insertion par un écrivain est gardée (copie de version) ; la création canonique ignore celle du client ;
-- - changer la provision d'un type ne touche aucune ligne existante ; une copie de version garde la sienne ;
-- - le moteur SQL la lit : une projection calculée sans elle est refusée (D12).
-- Isolation : le déclencheur, le refus D12 et la copie de version ne s'observent pas depuis un parcours ;
-- les projections TS sont couvertes par src/lib/estimates/engine-v3 et batch-preparation (vitest).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Sonde : exécute les instructions puis l'action, et annule toujours ses écritures.
create function pg_temp.fp_probe(p_statements text[], p_action text default null)
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
    raise exception using errcode = 'P0001', message = 'FP_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'FP_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------
select col_type_is('public', 'estimate_items', 'fo_provision', 'numeric(4,3)', 'the line FO provision is numeric(4,3)');
select col_hasnt_default('public', 'estimate_items', 'fo_provision',
  'the line FO provision has no column default: every new line goes through the derivation');
select col_type_is('public', 'supply_types', 'default_fo_provision', 'numeric(4,3)',
  'the supply type FO provision is numeric(4,3)');
select col_not_null('public', 'supply_types', 'default_fo_provision', 'a supply type always carries an FO provision');
select col_default_is('public', 'supply_types', 'default_fo_provision', '1.010',
  'a supply type created without provision gets 1,010');

-- ---------------------------------------------------------------------------
-- Fixture : un ingénieur, son entreprise, une affaire, un rôle à 40 €/h et trois types FO.
--   ...8000-000000000001 utilisateur ; ...010 affaire ; ...020 rôle ; ...041 Tube (1,030) ;
--   ...042 Raccord (sans valeur : 1,010) ; ...043 Calorifuge (1,030). Versions : ...100 v2, ...110 v3,
--   ...120 v3 refusée. Lignes : « -8001- », même suffixe sans son dernier chiffre, puis le rang (0 = section).
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '53400000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'estimate-fo-provision@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '53400000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '53400000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('53400000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '53400000-0000-4000-8000-000000000001', 'Affaire provision FO');
insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position) values
  ('53400000-0000-4000-8000-000000000020', current_setting('test.tenant_id')::uuid,
   '53400000-0000-4000-8000-000000000001', 'Tuyauteur', 4000, true, 1);
insert into public.supply_types (id, tenant_id, code, name, default_fo_provision) values
  ('53400000-0000-4000-8000-000000000041', current_setting('test.tenant_id')::uuid, 'tube', 'Tube', 1.030),
  ('53400000-0000-4000-8000-000000000043', current_setting('test.tenant_id')::uuid, 'calorifuge', 'Calorifuge', 1.030);
insert into public.supply_types (id, tenant_id, code, name) values
  ('53400000-0000-4000-8000-000000000042', current_setting('test.tenant_id')::uuid, 'raccord', 'Raccord');

select is(
  array[
    (select default_fo_provision::text from public.supply_types where id = '53400000-0000-4000-8000-000000000042'),
    pg_temp.fp_probe(array[$s$update public.supply_types set default_fo_provision = 0.999
      where id = '53400000-0000-4000-8000-000000000042'$s$]),
    pg_temp.fp_probe(array[$s$update public.supply_types set default_fo_provision = 2.001
      where id = '53400000-0000-4000-8000-000000000042'$s$])
  ],
  array['1.010',
    '23514 new row for relation "supply_types" violates check constraint "supply_types_default_fo_provision_check"',
    '23514 new row for relation "supply_types" violates check constraint "supply_types_default_fo_provision_check"'],
  'a supply type provision defaults to 1,010 and stays within 1 and 2'
);

create function pg_temp.fp_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select (left(replace(p_version::text, '-8000-', '-8001-'), 35) || p_index::text)::uuid
$$;

create function pg_temp.fp_version(p_id uuid, p_engine integer, p_ht integer, p_tax integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p_id, 'title', 'Provision FO', 'date_devis', '2026-10-24', 'validite_jours', 30,
      'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
      'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
      'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
      'contractor_role', 'principal', 'calc_engine_version', p_engine,
      'total_ht_cents', p_ht, 'total_tax_cents', p_tax, 'total_ttc_cents', p_ht + p_tax)
    || case when p_engine = 3 then jsonb_build_object('sale_coefficient_fo', 1, 'sale_coefficient_mo', 1,
      'gross_ht_cents', p_ht, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0) else '{}'::jsonb end
$$;

-- Une ligne v3 chiffrée (unité u, TVA 20 %) et sa projection : PU, HT = Q × PU, TVA = HT / 5.
create function pg_temp.fp_line(p_id uuid, p_parent uuid, p_position integer, p_title text, p_quantity integer,
  p_price integer, p_pu integer, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p_id, 'parent_id', p_parent, 'item_type', 'line', 'position', p_position,
      'title', p_title, 'quantity', p_quantity, 'unit_price_ht_cents', p_price, 'tax_rate_bp', 2000, 'k_fo', 1,
      'h_mo_per_unit', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'unit_code', 'u', 'pricing_status', 'priced',
      'pu_ht_cents', p_pu, 'line_total_ht_cents', p_quantity * p_pu, 'line_tax_cents', p_quantity * p_pu / 5,
      'line_total_ttc_cents', p_quantity * p_pu * 6 / 5)
    || p_extra
$$;

create function pg_temp.fp_create(p_version jsonb, p_items jsonb)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '53400000-0000-4000-8000-000000000001', '53400000-0000-4000-8000-000000000010', null, p_version, p_items, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

-- Provisions d'une version, par intitulé.
create function pg_temp.fp_provisions(p_version uuid)
returns text
language sql
stable
as $$
  select string_agg(item.title || ':' || item.fo_provision, ',' order by item.title collate "C")
  from public.estimate_items item
  where item.version_id = p_version
$$;

create function pg_temp.fp_provision_of(p_item uuid)
returns text
language sql
stable
as $$
  select fo_provision::text from public.estimate_items where id = p_item
$$;

-- ---------------------------------------------------------------------------
-- Moteur 2 : aucune provision, même avec un type FO « Tube ».
-- ---------------------------------------------------------------------------
select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 2::smallint, p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null,
  p_allowed_tax_rates_bp => null, p_change_reason => 'TI-534 v2', p_actor_user_id => '53400000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);

select is(
  pg_temp.fp_create(
    pg_temp.fp_version('53400000-0000-4000-8000-000000000100', 2, 0, 0),
    jsonb_build_array(
      jsonb_build_object('id', pg_temp.fp_item('53400000-0000-4000-8000-000000000100', 0), 'parent_id', null,
        'item_type', 'section', 'position', 1, 'title', 'Lot'),
      jsonb_build_object('id', pg_temp.fp_item('53400000-0000-4000-8000-000000000100', 1),
        'parent_id', pg_temp.fp_item('53400000-0000-4000-8000-000000000100', 0), 'item_type', 'line', 'position', 1,
        'title', 'Tube v2', 'description', 'ml', 'quantity', 10, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000,
        'k_fo', 1, 'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 0, 'line_total_ht_cents', 0,
        'line_tax_cents', 0, 'line_total_ttc_cents', 0, 'supply_type_id', '53400000-0000-4000-8000-000000000041'))
  ),
  'ok',
  'fixture: a v2 draft with a Tube line is created under policy 2'
);

select is(
  array[
    pg_temp.fp_provisions('53400000-0000-4000-8000-000000000100'),
    pg_temp.fp_probe(array[$s$update public.estimate_items set supply_type_id = '53400000-0000-4000-8000-000000000043'
      where id = '53400000-0000-4000-8001-000000000101'$s$],
      $a$select pg_temp.fp_provision_of('53400000-0000-4000-8001-000000000101')$a$),
    pg_temp.fp_probe(array[$s$update public.estimate_items set fo_provision = 1.010
      where id = '53400000-0000-4000-8001-000000000101'$s$])
  ],
  array['Lot:1.000,Tube v2:1.000', 'ok:1.000', '0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED'],
  'a v2 line and its section keep 1,000 whatever their supply type, and refuse another provision by name'
);

-- ---------------------------------------------------------------------------
-- Moteur 3, création canonique (import, modèle, nouveau devis) à c_FO = c_MO = 1 :
--   L1 sans type, provision 1,5 envoyée par le client (ignorée) : 1 × 1 000 × 1,010 = 1 010 ;
--   L2 Tube : 1 × 1 000 × 1,030 = 1 030 ; L3 Raccord (défaut du type) : 1 010 ;
--   L4 Calorifuge, K FO 2 : 3 × (500 × 1,030 × 2) = 3 × 1 030 = 3 090 ;
--   L5 Tube avec pose 0,5 h/u à 40 €/h : 2 × (1 030 + 2 000) = 6 060 (la provision ne touche que la FO).
--   HT 12 200, TVA 2 440, TTC 14 640.
-- ---------------------------------------------------------------------------
select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 3::smallint, p_default_sale_coefficient_fo => 1, p_default_sale_coefficient_mo => 1,
  p_allowed_tax_rates_bp => null, p_change_reason => 'TI-534 v3', p_actor_user_id => '53400000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);

create function pg_temp.fp_v3_items(p_version uuid, p_l1_pu integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('id', pg_temp.fp_item(p_version, 0), 'parent_id', null, 'item_type', 'section',
      'position', 1, 'title', 'Lot'),
    pg_temp.fp_line(pg_temp.fp_item(p_version, 1), pg_temp.fp_item(p_version, 0), 1, 'L1', 1, 1000, p_l1_pu,
      '{"fo_provision":1.5}'::jsonb),
    pg_temp.fp_line(pg_temp.fp_item(p_version, 2), pg_temp.fp_item(p_version, 0), 2, 'L2', 1, 1000, 1030,
      '{"supply_type_id":"53400000-0000-4000-8000-000000000041"}'::jsonb),
    pg_temp.fp_line(pg_temp.fp_item(p_version, 3), pg_temp.fp_item(p_version, 0), 3, 'L3', 1, 1000, 1010,
      '{"supply_type_id":"53400000-0000-4000-8000-000000000042"}'::jsonb),
    pg_temp.fp_line(pg_temp.fp_item(p_version, 4), pg_temp.fp_item(p_version, 0), 4, 'L4', 3, 500, 1030,
      '{"supply_type_id":"53400000-0000-4000-8000-000000000043","k_fo":2}'::jsonb),
    pg_temp.fp_line(pg_temp.fp_item(p_version, 5), pg_temp.fp_item(p_version, 0), 5, 'L5', 2, 1000, 3030,
      '{"supply_type_id":"53400000-0000-4000-8000-000000000041","h_mo_per_unit":0.5,"labor_role_id":"53400000-0000-4000-8000-000000000020"}'::jsonb)
  )
$$;

select is(
  pg_temp.fp_create(
    pg_temp.fp_version('53400000-0000-4000-8000-000000000120', 3, 12190, 2438),
    pg_temp.fp_v3_items('53400000-0000-4000-8000-000000000120', 1000)
  ),
  '22023 ESTIMATE_V3_PROJECTION_MISMATCH',
  'D12: a creation whose projection ignores the provision of a line without supply type (PU 1 000) is refused'
);

select is(
  pg_temp.fp_create(
    pg_temp.fp_version('53400000-0000-4000-8000-000000000110', 3, 12200, 2440),
    pg_temp.fp_v3_items('53400000-0000-4000-8000-000000000110', 1010)
  ),
  'ok',
  'a v3 creation passes D12 with FO = P × provision FO × K FO on every line'
);

select is(
  (select concat_ws('|', pg_temp.fp_provisions(version.id),
     (select string_agg(item.pu_ht_cents::text, ',' order by item.position) from public.estimate_items item
      where item.version_id = version.id and item.item_type = 'line'),
     version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents)
   from public.estimate_versions version where version.id = '53400000-0000-4000-8000-000000000110'),
  'L1:1.010,L2:1.030,L3:1.010,L4:1.030,L5:1.030,Lot:1.000|1010,1030,1010,1030,3030|12200|2440|14640',
  'each v3 line stores the provision of its supply type (1,010 without one, the client value ignored) and its amounts'
);

select is(
  pg_temp.fp_probe(null, $a$
    select string_agg(item ->> 'fo_provision', ',' order by item ->> 'id')
    from jsonb_array_elements(private.estimate_v3_canonical_input('53400000-0000-4000-8000-000000000110') -> 'items') item
    where item ->> 'item_type' = 'line'
  $a$),
  'ok:1.010,1.030,1.010,1.030,1.030',
  'the canonical engine input of a stored v3 carries the provision of every line'
);

select is(
  pg_temp.fp_probe(array[
    $s$select private.estimate_v3_assert_draft('53400000-0000-4000-8000-000000000110')$s$
  ]),
  'ok',
  'D12: the stored v3 amounts are those of the SQL engine with the provision'
);

-- ---------------------------------------------------------------------------
-- Déclencheur, sous le contrat d'écrivain de la v3 (lot, création atomique, réglages).
-- ---------------------------------------------------------------------------
create function pg_temp.fp_writer_probe(p_statement text, p_item uuid)
returns text
language sql
as $$
  select pg_temp.fp_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', '53400000-0000-4000-8000-000000000110', true)$s$,
      p_statement
    ],
    format('select pg_temp.fp_provision_of(%L::uuid)', p_item)
  )
$$;

select is(
  array[
    pg_temp.fp_writer_probe($s$update public.estimate_items set quantity = 2
      where id = '53400000-0000-4000-8001-000000000111'$s$, '53400000-0000-4000-8001-000000000111'),
    pg_temp.fp_writer_probe($s$update public.estimate_items set supply_type_id = '53400000-0000-4000-8000-000000000041'
      where id = '53400000-0000-4000-8001-000000000111'$s$, '53400000-0000-4000-8001-000000000111'),
    pg_temp.fp_writer_probe($s$update public.estimate_items set supply_type_id = '53400000-0000-4000-8000-000000000042'
      where id = '53400000-0000-4000-8001-000000000112'$s$, '53400000-0000-4000-8001-000000000112'),
    pg_temp.fp_writer_probe($s$update public.estimate_items set supply_type_id = null
      where id = '53400000-0000-4000-8001-000000000112'$s$, '53400000-0000-4000-8001-000000000112')
  ],
  array['ok:1.010', 'ok:1.030', 'ok:1.010', 'ok:1.010'],
  'an edit keeps the provision; a supply type change derives it again (Tube 1,030, Raccord 1,010, no type 1,010)'
);

select is(
  array[
    pg_temp.fp_writer_probe($s$update public.estimate_items
      set supply_type_id = '53400000-0000-4000-8000-000000000042', fo_provision = 1.050
      where id = '53400000-0000-4000-8001-000000000112'$s$, '53400000-0000-4000-8001-000000000112'),
    pg_temp.fp_writer_probe($s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type,
        position, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code,
        pricing_status, h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
        supply_type_id, fo_provision)
      select '53400000-0000-4000-8001-000000000116', tenant_id, id, '53400000-0000-4000-8001-000000000110', 'line',
        6, 'Copie', 1, 1000, 2000, 1, 1, 1, 'u', 'priced', 0, 1020, 1020, 204, 1224,
        '53400000-0000-4000-8000-000000000041', 1.020
      from public.estimate_versions where id = '53400000-0000-4000-8000-000000000110'$s$,
      '53400000-0000-4000-8001-000000000116'),
    pg_temp.fp_writer_probe($s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type,
        position, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code,
        pricing_status, h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
        supply_type_id)
      select '53400000-0000-4000-8001-000000000117', tenant_id, id, '53400000-0000-4000-8001-000000000110', 'line',
        7, 'Neuve', 1, 1000, 2000, 1, 1, 1, 'u', 'priced', 0, 1030, 1030, 206, 1236,
        '53400000-0000-4000-8000-000000000043'
      from public.estimate_versions where id = '53400000-0000-4000-8000-000000000110'$s$,
      '53400000-0000-4000-8001-000000000117')
  ],
  array['ok:1.050', 'ok:1.020', 'ok:1.030'],
  'a provision written by the writer is kept (with a type change, or on an insert such as a version copy); a new line without one takes its type'
);

select is(
  array[
    pg_temp.fp_probe(array[
      $s$update public.supply_types set default_fo_provision = 1.050 where id = '53400000-0000-4000-8000-000000000041'$s$
    ], $a$select pg_temp.fp_provisions('53400000-0000-4000-8000-000000000110')$a$),
    pg_temp.fp_writer_probe($s$update public.estimate_items set fo_provision = 1.010
      where id = '53400000-0000-4000-8001-000000000110'$s$, '53400000-0000-4000-8001-000000000110'),
    pg_temp.fp_writer_probe($s$update public.estimate_items set fo_provision = 2.5
      where id = '53400000-0000-4000-8001-000000000111'$s$, '53400000-0000-4000-8001-000000000111'),
    pg_temp.fp_writer_probe($s$update public.estimate_items set fo_provision = 0.99
      where id = '53400000-0000-4000-8001-000000000111'$s$, '53400000-0000-4000-8001-000000000111')
  ],
  array[
    'ok:L1:1.010,L2:1.030,L3:1.010,L4:1.030,L5:1.030,Lot:1.000',
    '0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_provision_check"',
    '23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_provision_check"'
  ],
  'a new supply type provision changes no existing line; a section refuses a provision; a line stays within 1 and 2'
);

select is(
  pg_temp.fp_probe(array[$s$update public.estimate_items set supply_type_id = '53400000-0000-4000-8000-000000000041'
    where id = '53400000-0000-4000-8001-000000000111'$s$]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'outside the writer contract a supply type change of a v3 line is refused before any provision is derived'
);

-- ---------------------------------------------------------------------------
-- Copie de version : chaque ligne garde sa provision, même après un changement de celle de son type.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.fp_probe(
    array[
      $s$update public.supply_types set default_fo_provision = 1.050 where id = '53400000-0000-4000-8000-000000000041'$s$,
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '53400000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('fp_test.duplicate_id',
         public.duplicate_estimate_version('53400000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select concat_ws('|', pg_temp.fp_provisions(version.id), version.total_ht_cents)
       from public.estimate_versions version where version.id = current_setting('fp_test.duplicate_id')::uuid$a$
  ),
  'ok:L1:1.010,L2:1.030,L3:1.010,L4:1.030,L5:1.030,Lot:1.000|12200',
  'a duplicated v3 keeps the provision of each line and its amounts (no new derivation)'
);

-- TI-534 remaining lot: source conditions are captured, never inferred again on a save.
update public.tenant_memberships set role='admin' where user_id='53400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','53400000-0000-4000-8000-000000000001',true);
insert into public.products(id,tenant_id,designation,unit,unit_price_cents,product_type,reference_transport_mode) values
 ('53400000-0000-4000-8000-000000000051',current_setting('test.tenant_id')::uuid,'Tube PVC source','u',10000,'Tube','included');
insert into public.suppliers(id,tenant_id,name) values
 ('53400000-0000-4000-8000-000000000052',current_setting('test.tenant_id')::uuid,'Fournisseur FO');
insert into public.supplier_catalog_items(id,tenant_id,supplier_id,product_id,supplier_sku) values
 ('53400000-0000-4000-8000-000000000054',current_setting('test.tenant_id')::uuid,
 '53400000-0000-4000-8000-000000000052','53400000-0000-4000-8000-000000000051','FO534');
insert into public.supplier_pricebook(id,tenant_id,supplier_catalog_item_id,supplier_id,product_id,unit,unit_price_cents,currency,min_quantity,valid_from,transport_mode) values
 ('53400000-0000-4000-8000-000000000053',current_setting('test.tenant_id')::uuid,'53400000-0000-4000-8000-000000000054',
 '53400000-0000-4000-8000-000000000052','53400000-0000-4000-8000-000000000051','u',10000,'EUR',1,current_date,'included');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id='53400000-0000-4000-8000-000000000053',unit_price_ht_cents=10000 where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',supply_type_id,fo_provision,fo_price_origin->>'transport_mode',unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:53400000-0000-4000-8000-000000000041|1.010|included|10000','catalogue Tube is mapped by declared family and its included transport takes 1,01');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id='53400000-0000-4000-8000-000000000053',unit_price_ht_cents=10000 where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set unit_price_ht_cents=20000 where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_provision,fo_price_origin is null,product_id) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:1.030|t|53400000-0000-4000-8000-000000000051','manual cost drops included transport even when product_id remains');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id='53400000-0000-4000-8000-000000000053' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.supplier_pricebook set transport_mode='excluded' where id='53400000-0000-4000-8000-000000000053'$s$,
 $s$update public.estimate_items set quantity=10 where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_provision,fo_price_origin->>'transport_mode') from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:1.010|included','catalogue changes and quantity edits preserve the saved origin');

-- A sparse detach of the reference product clears its transport proof, as the TS writer does.
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id=null where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set product_id=null where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_provision,fo_price_origin is null,product_id is null) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:1.030|t|t','detaching a reference product clears included transport and rederives its tube provision');


-- ---------------------------------------------------------------------------
-- TI-541 : coût chantier. Un coût de fourniture saisi pour ce devis, avec sa source, est une troisième
-- origine « site ». Attendus écrits avant l'exécution ; chaque sonde pose le type Tube (1,030) sur la ligne ...111.
-- Isolation : le déclencheur et la contrainte ne s'observent pas depuis un parcours ; SC54101 couvre l'écran.
-- ---------------------------------------------------------------------------
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.030|900','a site cost keeps its source and the provision of its supply type');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.010|900','a site offer with transport included takes no second transport provision');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id=null where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',i.fo_price_origin->>'kind',i.product_id,i.unit_price_ht_cents,p.unit_price_cents,(select count(*) from public.supplier_pricebook s where s.product_id=p.id),(select unit_price_cents from public.supplier_pricebook where id='53400000-0000-4000-8000-000000000053')) from public.estimate_items i join public.products p on p.id=i.product_id where i.id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|53400000-0000-4000-8000-000000000051|900|10000|1|10000','a site cost on a catalogue line keeps the article and writes nothing to the catalogue');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id='53400000-0000-4000-8000-000000000053' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'22023 FO_PRICE_SOURCE_INVALID','a site cost cannot keep a catalogue offer selected');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id='53400000-0000-4000-8000-000000000053' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb,selected_supplier_price_id=null where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.030|900','a site cost replaces a retained catalogue offer');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set unit_price_ht_cents=910 where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin is null,fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:t|1.030|910','retyping the cost by hand drops the site source and its included transport');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set quantity=10,k_fo=0.9 where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.010|900','quantity and K FO edits keep the site source and its provision');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id='53400000-0000-4000-8000-000000000053',unit_price_ht_cents=10000 where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:supplier|1.010|10000','choosing a catalogue offer afterwards replaces the site cost');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with an empty supplier');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":" Comptoir","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a padded supplier');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Comptoir\nNord","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a supplier with a line break');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a supplier over 120 characters');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-13-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with an impossible date');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"03/11/2026","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a French date');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null,"catalogue":true}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with an extra source key');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000002","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a foreign source id');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a site kind without its source');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":"ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a document over 200 characters');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"reference","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'22023 FO_PRICE_SOURCE_INVALID','the site cost is refused with a catalogue kind carrying a site source, read as a catalogue selection without article');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',length(fo_price_origin#>>'{site,supplier}'),length(fo_price_origin#>>'{site,document}')) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|120|200','the site cost check accepts the longest supplier and document');
select is(
  pg_temp.fp_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
      $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
      $s$select set_config('miaouffrage.estimate_v3_writer','',true)$s$,
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '53400000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('fp_test.duplicate_id',
         public.duplicate_estimate_version('53400000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select string_agg(concat_ws('|',copy.fo_price_origin->>'kind',copy.fo_price_origin#>>'{site,supplier}',copy.fo_price_origin#>>'{site,offer_date}',
         copy.fo_provision,copy.unit_price_ht_cents,
         copy.fo_price_origin = (select source.fo_price_origin from public.estimate_items source where source.id = '53400000-0000-4000-8001-000000000111')),',')
       from public.estimate_items copy
       where copy.version_id = current_setting('fp_test.duplicate_id')::uuid and copy.fo_price_origin is not null$a$
  ),
  'ok:site|Négoce Fictif|2026-11-03|1.010|900|t',
  'a duplicated version keeps the site cost, its source and its provision verbatim'
);

-- TI-541, relecture indépendante : l'article détaché ou supprimé, la création d'une ligne, les identifiants et les longueurs.
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id=null where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set product_id=null where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents,product_id is null) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.010|900|t','detaching the article keeps the site source and its provision');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id=null where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$delete from public.supplier_pricebook where product_id='53400000-0000-4000-8000-000000000051'$s$,
 $s$delete from public.supplier_catalog_items where product_id='53400000-0000-4000-8000-000000000051'$s$,
 $s$delete from public.products where id='53400000-0000-4000-8000-000000000051'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents,product_id is null) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.010|900|t','deleting the article from the catalogue keeps the site source and its provision');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051' where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin->>'source_id',fo_price_origin ? 'site') from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:reference|53400000-0000-4000-8000-000000000051|f','choosing a catalogue article afterwards replaces the site cost by its reference');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000002","kind":"site","source_id":"54100000-0000-4000-8000-000000000002","transport_mode":"excluded","site":{"supplier":"Autre Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Autre Négoce Fictif|1.030|900','a site cost edited to another offer takes the new source and its transport');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set unit_price_ht_cents=880,fo_price_origin=jsonb_set(fo_price_origin,'{transport_mode}','"excluded"') where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|Négoce Fictif|1.030|880','a site source changed under the same selection is a new site cost, not a manual price');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, supply_type_id, product_id, selected_supplier_price_id, fo_price_origin) select '54100000-0000-4000-8001-000000000119', tenant_id, id, '53400000-0000-4000-8001-000000000110', 'line', 6, 'Coût chantier créé', 1, 900, 2000, 1, 1, 1, 'u', 'priced', 0, 909, 909, 182, 1091, '53400000-0000-4000-8000-000000000041', '53400000-0000-4000-8000-000000000051', null, '{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb from public.estimate_versions where id='53400000-0000-4000-8000-000000000110'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,product_id) from public.estimate_items where id='54100000-0000-4000-8001-000000000119'$a$),
'ok:site|Négoce Fictif|1.010|53400000-0000-4000-8000-000000000051','a line created with a site cost and an article keeps both and reads no catalogue price');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, supply_type_id, product_id, selected_supplier_price_id, fo_price_origin) select '54100000-0000-4000-8001-000000000119', tenant_id, id, '53400000-0000-4000-8001-000000000110', 'line', 6, 'Coût chantier créé', 1, 900, 2000, 1, 1, 1, 'u', 'priced', 0, 909, 909, 182, 1091, '53400000-0000-4000-8000-000000000041', '53400000-0000-4000-8000-000000000051', '53400000-0000-4000-8000-000000000053', '{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb from public.estimate_versions where id='53400000-0000-4000-8000-000000000110'$s$
],$a$select 'created'$a$),
'22023 FO_PRICE_SOURCE_INVALID','a line cannot be created with a site cost and a catalogue offer selected');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","kind":"site","source_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with an id the application cannot read back');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":123456789012345678901234567890123456,"kind":"site","source_id":123456789012345678901234567890123456,"transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with a numeric id');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":null,"kind":"site","source_id":null,"transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with null ids, which a bare check would let through');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',length(fo_price_origin#>>'{site,supplier}')) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|120','the supplier length is counted in characters, accents included');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',fo_price_origin#>>'{site,supplier}',fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'23514 new row for relation "estimate_items" violates check constraint "estimate_items_fo_price_origin_check"','the site cost is refused with 121 accented characters');

-- ---------------------------------------------------------------------------
-- TI-541, réponse de Maxime du 11/11/2026 : une ligne POSE SEULE ne prend ni pertes ni transport, même quand elle
-- porte une petite fourniture nécessaire à la pose. Sa provision vaut 1,000 tant qu'elle garde cette nature et se
-- redérive quand elle la quitte. Attendus écrits avant l'exécution ; L1 = ...111 sans type (1,010), L2 = ...112
-- Tube (1,030, P 1 000, PU 1 030). Isolation : le déclencheur ne s'observe pas depuis un parcours ; PS54102
-- couvre l'accord entre l'écran et le moteur SQL à l'enregistrement.
-- ---------------------------------------------------------------------------
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000112'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000112'$a$),
'ok:pose_only|1.000','a Tube line that becomes POSE SEULE takes neither losses nor transport');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000112'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000042' where id='53400000-0000-4000-8001-000000000112'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041' where id='53400000-0000-4000-8001-000000000112'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000112'$a$),
'ok:pose_only|1.000','changing the supply type of a POSE SEULE line keeps 1,000');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000112'$s$,
 $s$update public.estimate_items set line_nature='supply_and_labor' where id='53400000-0000-4000-8001-000000000112'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000112'$a$),
'ok:supply_and_labor|1.030','a line that leaves POSE SEULE takes back the provision of its supply type');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set line_nature='supply_only' where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:supply_only|1.010','a line without supply type that leaves POSE SEULE takes back 1,010');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',line_nature,fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|pose_only|1.000|900','a site cost on a POSE SEULE line keeps its source and takes no provision');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":null,"site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',line_nature,fo_provision,unit_price_ht_cents) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|pose_only|1.000|900','a line with a site cost that becomes POSE SEULE keeps the cost and its source');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000041',unit_price_ht_cents=900,fo_price_origin='{"selection_id":"54100000-0000-4000-8000-000000000001","kind":"site","source_id":"54100000-0000-4000-8000-000000000001","transport_mode":"included","site":{"supplier":"Négoce Fictif","offer_reference":"OF-2611-07","offer_date":"2026-11-03","document":null}}'::jsonb where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set line_nature='supply_and_labor' where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:site|supply_and_labor|1.010','leaving POSE SEULE with a site offer, transport included, takes the losses only');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000112'$s$,
 $s$update public.estimate_items set quantity=7,k_fo=1.2 where id='53400000-0000-4000-8001-000000000112'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000112'$a$),
'ok:pose_only|1.000','quantity and K FO edits keep a POSE SEULE line at 1,000');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.supply_types set default_fo_provision=1.050 where id='53400000-0000-4000-8000-000000000041'$s$,
 $s$update public.estimate_items set line_nature='supply_and_labor' where id='53400000-0000-4000-8001-000000000112'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000112'$a$),
'ok:supply_and_labor|1.030','a change between two other natures does not rederive the provision');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, supply_type_id, line_nature) select '54100000-0000-4000-8001-000000000129', tenant_id, id, '53400000-0000-4000-8001-000000000110', 'line', 6, 'Pose créée', 1, 900, 2000, 1, 1, 1, 'u', 'priced', 0, 900, 900, 180, 1080, '53400000-0000-4000-8000-000000000041', 'pose_only' from public.estimate_versions where id='53400000-0000-4000-8000-000000000110'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='54100000-0000-4000-8001-000000000129'$a$),
'ok:pose_only|1.000','a line created POSE SEULE with a Tube type and a small supply starts at 1,000');
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000112'$s$,
 $s$select private.estimate_v3_assert_draft('53400000-0000-4000-8000-000000000110')$s$
],$a$select 'kept'$a$),
'22023 ESTIMATE_V3_PROJECTION_MISMATCH','D12: the SQL engine reads 1,000 on a POSE SEULE line and refuses the amounts computed at 1,030');
select is(
  pg_temp.fp_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
      $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000112'$s$,
      $s$select set_config('miaouffrage.estimate_v3_writer','',true)$s$,
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', '53400000-0000-4000-8000-000000000001', true)$s$,
      $s$select set_config('fp_test.duplicate_id',
         public.duplicate_estimate_version('53400000-0000-4000-8000-000000000110', false)::text, true)$s$,
      'reset role'
    ],
    $a$select string_agg(concat_ws('|',copy.line_nature,copy.fo_provision),',')
       from public.estimate_items copy
       where copy.version_id = current_setting('fp_test.duplicate_id')::uuid and copy.title = 'L2'$a$
  ),
  'ok:pose_only|1.000',
  'a duplicated version keeps a POSE SEULE line and its provision of 1,000'
);
-- TI-541, relecture indépendante de la règle POSE SEULE : un article du catalogue choisi sur la ligne, et le moteur 2.
select is(pg_temp.fp_probe(array[
 $s$select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true)$s$,
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000111'$s$,
 $s$update public.estimate_items set product_id='53400000-0000-4000-8000-000000000051',selected_supplier_price_id=null where id='53400000-0000-4000-8001-000000000111'$s$
],$a$select concat_ws('|',fo_price_origin->>'kind',line_nature,fo_provision,supply_type_id) from public.estimate_items where id='53400000-0000-4000-8001-000000000111'$a$),
'ok:reference|pose_only|1.000|53400000-0000-4000-8000-000000000041','a catalogue tube chosen on a POSE SEULE line keeps its origin and its type, and takes no provision');
select is(pg_temp.fp_probe(array[
 $s$update public.estimate_items set line_nature='pose_only' where id='53400000-0000-4000-8001-000000000101'$s$,
 $s$update public.estimate_items set line_nature='supply_only' where id='53400000-0000-4000-8001-000000000101'$s$
],$a$select concat_ws('|',line_nature,fo_provision) from public.estimate_items where id='53400000-0000-4000-8001-000000000101'$a$),
'ok:supply_only|1.000','an engine 2 line keeps 1,000 when it enters and leaves POSE SEULE');
select * from finish();
rollback;
