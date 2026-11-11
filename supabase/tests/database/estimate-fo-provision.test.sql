-- TI-534 11 November: one K FO; supersedes the October two-factor expectations.
-- Historical engine-2 protection remains below, while new-draft behavior has explicit counterexamples.
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
select col_type_is('public', 'supply_types', 'default_fo_provision', 'numeric(15,6)',
  'the unified company K FO retains six decimals');
select col_not_null('public', 'supply_types', 'default_fo_provision', 'a supply type always carries an FO provision');
select col_hasnt_default('public', 'supply_types', 'default_fo_provision',
  'the family trigger selects the current company coefficient');

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
  ('53400000-0000-4000-8000-000000000041', current_setting('test.tenant_id')::uuid, 'tube', 'Tube', 1.130),
  ('53400000-0000-4000-8000-000000000043', current_setting('test.tenant_id')::uuid, 'calorifuge', 'Calorifuge', 1.020);
insert into public.supply_types (id, tenant_id, code, name) values
  ('53400000-0000-4000-8000-000000000042', current_setting('test.tenant_id')::uuid, 'raccord', 'Raccord');

select is(
  array[
    (select trim_scale(default_fo_provision)::text from public.supply_types where id = '53400000-0000-4000-8000-000000000042'),
    pg_temp.fp_probe(array[$s$update public.supply_types set default_fo_provision = -0.000001
      where id = '53400000-0000-4000-8000-000000000042'$s$]),
    pg_temp.fp_probe(array[$s$update public.supply_types set default_fo_provision = 999999999.999001
      where id = '53400000-0000-4000-8000-000000000042'$s$])
  ],
  array['1.02',
    '23514 new row for relation "supply_types" violates check constraint "supply_types_default_fo_provision_check"',
    '23514 new row for relation "supply_types" violates check constraint "supply_types_default_fo_provision_check"'],
  'the company K FO defaults to 1.02 and refuses negative or overflowing coefficients'
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
-- Current v3 policy: no second provision, company/user/line precedence.
select set_config('role','service_role',true);
select public.set_tenant_calc_policy(p_tenant_id=>current_setting('test.tenant_id')::uuid,p_new_estimate_calc_engine=>3::smallint,p_default_sale_coefficient_fo=>1,p_default_sale_coefficient_mo=>1,p_allowed_tax_rates_bp=>null,p_change_reason=>'TI-534 current rule',p_actor_user_id=>'53400000-0000-4000-8000-000000000001');
select set_config('role','none',true);

create function pg_temp.current_lines(v uuid) returns jsonb language sql immutable as $$
 select jsonb_build_array(
 jsonb_build_object('id',pg_temp.fp_item(v,0),'item_type','section','parent_id',null,'position',1,'title','Lot'),
 pg_temp.fp_line(pg_temp.fp_item(v,1),pg_temp.fp_item(v,0),1,'Tube',1,1000,1130,'{"supply_type_id":"53400000-0000-4000-8000-000000000041"}'),
 pg_temp.fp_line(pg_temp.fp_item(v,2),pg_temp.fp_item(v,0),2,'Calorifuge',1,1000,1020,'{"supply_type_id":"53400000-0000-4000-8000-000000000043"}'),
 pg_temp.fp_line(pg_temp.fp_item(v,3),pg_temp.fp_item(v,0),3,'Volume',1,10000,10170,'{"k_fo":1.017,"supply_type_id":"53400000-0000-4000-8000-000000000041"}'),
 pg_temp.fp_line(pg_temp.fp_item(v,4),pg_temp.fp_item(v,0),4,'Sans type',1,1000,1020));
$$;
select is(pg_temp.fp_create(pg_temp.fp_version('53400000-0000-4000-8000-000000000110',3,13340,2668),pg_temp.current_lines('53400000-0000-4000-8000-000000000110')),'ok','one unified coefficient passes the exact canonical projection check');
select is((select string_agg(title||':'||trim_scale(k_fo)::text||':'||fo_provision::text,',' order by position) from public.estimate_items where version_id='53400000-0000-4000-8000-000000000110' and item_type='line'),'Tube:1.13:1.000,Calorifuge:1.02:1.000,Volume:1.017:1.000,Sans type:1.02:1.000','tube losses never spread to insulation or unknown families, and volume is included only once');
select is(pg_temp.fp_create(pg_temp.fp_version('53400000-0000-4000-8000-000000000120',3,13200,2640),pg_temp.current_lines('53400000-0000-4000-8000-000000000120')),'22023 ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS','wrong monetary projections are still rejected');
select ok((select k_fo_manual from public.estimate_items where title='Volume' and version_id='53400000-0000-4000-8000-000000000110'),'a supplied non-neutral line coefficient is preserved as manual');
select set_config('miaouffrage.estimate_v3_writer','53400000-0000-4000-8000-000000000110',true);
update public.estimate_items set k_fo=1,k_fo_manual=true where id='53400000-0000-4000-8001-000000000111';
update public.estimate_items set supply_type_id='53400000-0000-4000-8000-000000000042' where id='53400000-0000-4000-8001-000000000111';
select is((select k_fo from public.estimate_items where id='53400000-0000-4000-8001-000000000111'),1::numeric,'a manual neutral coefficient survives family changes');
insert into public.estimate_fo_preferences(tenant_id,user_id,supply_type_id,coefficient) values(current_setting('test.tenant_id')::uuid,'53400000-0000-4000-8000-000000000001','53400000-0000-4000-8000-000000000043',1.15);
update public.estimate_items set k_fo_manual=false,supply_type_id='53400000-0000-4000-8000-000000000043' where id='53400000-0000-4000-8001-000000000114';
select is((select k_fo from public.estimate_items where id='53400000-0000-4000-8001-000000000114'),1.15::numeric,'the project owner preference wins over the company default, also for collaborators');
update public.estimate_items set k_fo=1.0735,k_fo_manual=true where id='53400000-0000-4000-8001-000000000113';
select is((select k_fo from public.estimate_items where id='53400000-0000-4000-8001-000000000113'),1.0735::numeric,'a four-decimal volume adjustment is not rounded to three');
select is(pg_temp.fp_probe(array[$s$select set_config('miaouffrage.estimate_v3_writer','',true)$s$,$s$update public.estimate_items set k_fo=1.3 where id='53400000-0000-4000-8001-000000000113'$s$]),'0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED','coefficient writes outside the guarded writer remain refused');
select ok(not has_function_privilege('anon','private.estimate_kfo_base(uuid,uuid,uuid,jsonb)','execute'),'anonymous callers cannot execute the private coefficient resolver');
select ok(not has_table_privilege('anon','public.estimate_fo_preferences','insert'),'anonymous callers cannot write preferences');
select * from finish();
rollback;
