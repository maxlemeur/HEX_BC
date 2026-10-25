-- Métré M2 v0.1 : application d'un métré revu à un brouillon du moteur 3
-- (migration 20261025134000_takeoff_apply_engine_v3.sql). Les cas passent par la RPC réelle,
-- public.apply_takeoff_job_guarded_atomic, sous le rôle authenticated d'un ingénieur du tenant.
-- Isolation justifiée : l'écriture sous contrat d'écrivain, l'atomicité avec le passage du job à
-- « applied », le refus sans écriture partielle et les montants du moteur 3 ne sont pas tous observables
-- depuis un parcours. Chaque appel passe par un bloc qui consigne son issue, pour qu'avant la migration ce
-- fichier échoue sur des assertions nommées au lieu de s'interrompre.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '8d000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'takeoff-apply-v3@example.test',
   crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  -- Utilisateur d'un autre tenant : il ne doit rien appliquer ni écrire.
  ('00000000-0000-0000-0000-000000000000', '8d000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'takeoff-apply-v3-other@example.test',
   crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = '8d000000-0000-4000-8000-000000000001';

select set_config(
  'test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '8d000000-0000-4000-8000-000000000001' limit 1),
  true
);

create temporary table m2_outcome (case_name text primary key, outcome text) on commit drop;
grant all on m2_outcome to authenticated;

-- Une affaire et six brouillons v3 (coefficients de vente 1,3 FO et 1,2 MO, TVA 20 %), semés par le
-- propriétaire natif sans contrat comme les autres fixtures v3 :
--   ...101 ajout (A), ...102 fusion (M), ...103 remplacement (R), ...104 unité inconnue (U),
--   ...106 remplacement refusé (RU), ...107 fusion sur une autre unité (MU) et ajout à la racine (A-root).
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('8d000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '8d000000-0000-4000-8000-000000000001', 'M2 affaire v3');

insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select fixture.id, current_setting('test.tenant_id')::uuid, '8d000000-0000-4000-8000-000000000010',
  fixture.version_number, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0
from (values
  ('8d000000-0000-4000-8000-000000000101'::uuid, 1),
  ('8d000000-0000-4000-8000-000000000102'::uuid, 2),
  ('8d000000-0000-4000-8000-000000000103'::uuid, 3),
  ('8d000000-0000-4000-8000-000000000104'::uuid, 4),
  ('8d000000-0000-4000-8000-000000000106'::uuid, 6),
  ('8d000000-0000-4000-8000-000000000107'::uuid, 7)
) as fixture(id, version_number);

-- Une v3 archivée (...105) : un métré ne s'applique qu'à un brouillon.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values ('8d000000-0000-4000-8000-000000000105', current_setting('test.tenant_id')::uuid, '8d000000-0000-4000-8000-000000000010',
  5, 3, 3, 'EUR', 'archived', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0);

-- Sections cibles, et le contenu existant des cas fusion et remplacement, écrits sous le contrat
-- d'écrivain de leur version puis chiffrés par le moteur 3.
do $seed$
declare
  seeded record;
begin
  for seeded in
    select * from (values
      ('8d000000-0000-4000-8000-000000000101'::uuid, '8d000000-0000-4000-8000-000000000111'::uuid, 'M2 lot ajout'),
      ('8d000000-0000-4000-8000-000000000102'::uuid, '8d000000-0000-4000-8000-000000000112'::uuid, 'M2 lot fusion'),
      ('8d000000-0000-4000-8000-000000000103'::uuid, '8d000000-0000-4000-8000-000000000113'::uuid, 'M2 lot remplacé'),
      ('8d000000-0000-4000-8000-000000000104'::uuid, '8d000000-0000-4000-8000-000000000114'::uuid, 'M2 lot refusé'),
      ('8d000000-0000-4000-8000-000000000103'::uuid, '8d000000-0000-4000-8000-000000000115'::uuid, 'M2 autre lot'),
      ('8d000000-0000-4000-8000-000000000106'::uuid, '8d000000-0000-4000-8000-000000000116'::uuid, 'M2 lot gardé'),
      ('8d000000-0000-4000-8000-000000000107'::uuid, '8d000000-0000-4000-8000-000000000117'::uuid, 'M2 lot unités')
    ) as section(version_id, id, title)
  loop
    perform set_config('miaouffrage.estimate_v3_writer', seeded.version_id::text, true);
    insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
    values (seeded.id, current_setting('test.tenant_id')::uuid, seeded.version_id, 'section',
      case when seeded.id = '8d000000-0000-4000-8000-000000000115' then 2 else 1 end, seeded.title);
  end loop;

  perform set_config('miaouffrage.estimate_v3_writer', '8d000000-0000-4000-8000-000000000102', true);
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
    line_total_ttc_cents, h_mo_per_unit)
  values ('8d000000-0000-4000-8000-000000000122', current_setting('test.tenant_id')::uuid,
    '8d000000-0000-4000-8000-000000000102', '8d000000-0000-4000-8000-000000000112', 'line', 1,
    'M2 Tube cuivre 22', null, 1, 'ml', 1000, 2000, 1, 0, 1, 0, 0, 0, 0, 0.5);
  perform public.estimate_v3_complete_entry_for_writer('8d000000-0000-4000-8000-000000000102',
    array['8d000000-0000-4000-8000-000000000122'::uuid]);

  perform set_config('miaouffrage.estimate_v3_writer', '8d000000-0000-4000-8000-000000000103', true);
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
    line_total_ttc_cents)
  values
    ('8d000000-0000-4000-8000-000000000123', current_setting('test.tenant_id')::uuid,
     '8d000000-0000-4000-8000-000000000103', '8d000000-0000-4000-8000-000000000113', 'line', 1,
     'M2 Ancienne ligne de section', null, 2, 'u', 500, 2000, 1, 0, 1, 0, 0, 0, 0),
    ('8d000000-0000-4000-8000-000000000124', current_setting('test.tenant_id')::uuid,
     '8d000000-0000-4000-8000-000000000103', '8d000000-0000-4000-8000-000000000115', 'line', 1,
     'M2 Ligne d''une autre section', null, 1, 'u', 700, 2000, 1, 0, 1, 0, 0, 0, 0);
  perform public.estimate_v3_complete_entry_for_writer('8d000000-0000-4000-8000-000000000103',
    array['8d000000-0000-4000-8000-000000000123'::uuid, '8d000000-0000-4000-8000-000000000124'::uuid]);

  perform set_config('miaouffrage.estimate_v3_writer', '8d000000-0000-4000-8000-000000000106', true);
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
    line_total_ttc_cents)
  values ('8d000000-0000-4000-8000-000000000125', current_setting('test.tenant_id')::uuid,
    '8d000000-0000-4000-8000-000000000106', '8d000000-0000-4000-8000-000000000116', 'line', 1,
    'M2 Ligne gardée', null, 2, 'u', 300, 2000, 1, 0, 1, 0, 0, 0, 0);
  perform public.estimate_v3_complete_entry_for_writer('8d000000-0000-4000-8000-000000000106',
    array['8d000000-0000-4000-8000-000000000125'::uuid]);

  perform set_config('miaouffrage.estimate_v3_writer', '8d000000-0000-4000-8000-000000000107', true);
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
    line_total_ttc_cents)
  values ('8d000000-0000-4000-8000-000000000126', current_setting('test.tenant_id')::uuid,
    '8d000000-0000-4000-8000-000000000107', '8d000000-0000-4000-8000-000000000117', 'line', 1,
    'M2 Tube cuivre 22', null, 1, 'ml', 1000, 2000, 1, 0, 1, 0, 0, 0, 0);
  perform public.estimate_v3_complete_entry_for_writer('8d000000-0000-4000-8000-000000000107',
    array['8d000000-0000-4000-8000-000000000126'::uuid]);

  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end
$seed$;

-- Jobs de métré terminés et revus, un par cas (et un second sur la version d'ajout pour un ouvrage).
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.version_id, 'A', 'completed', fixture.file_name,
  '8d000000-0000-4000-8000-000000000001'
from (values
  ('8d000000-0000-4000-8000-000000000201'::uuid, '8d000000-0000-4000-8000-000000000101'::uuid, 'PLB R+1 indice B.pdf'),
  ('8d000000-0000-4000-8000-000000000202'::uuid, '8d000000-0000-4000-8000-000000000102'::uuid, 'fusion.pdf'),
  ('8d000000-0000-4000-8000-000000000203'::uuid, '8d000000-0000-4000-8000-000000000103'::uuid, 'remplacement.pdf'),
  ('8d000000-0000-4000-8000-000000000204'::uuid, '8d000000-0000-4000-8000-000000000104'::uuid, 'unite-inconnue.pdf'),
  ('8d000000-0000-4000-8000-000000000205'::uuid, '8d000000-0000-4000-8000-000000000101'::uuid, 'ouvrage.pdf'),
  ('8d000000-0000-4000-8000-000000000206'::uuid, '8d000000-0000-4000-8000-000000000105'::uuid, 'archive.pdf'),
  ('8d000000-0000-4000-8000-000000000207'::uuid, '8d000000-0000-4000-8000-000000000106'::uuid, 'remplacement-refuse.pdf'),
  ('8d000000-0000-4000-8000-000000000208'::uuid, '8d000000-0000-4000-8000-000000000107'::uuid, 'autre-unite.pdf'),
  ('8d000000-0000-4000-8000-000000000209'::uuid, '8d000000-0000-4000-8000-000000000107'::uuid, 'racine.pdf')
) as fixture(id, version_id, file_name);

-- Items : created_at croissant pour fixer l'ordre source (row_number par created_at, id).
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence,
  source_file_name, source_page, is_excluded, exclusion_reason, created_at)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.job_id, fixture.designation, fixture.quantity,
  fixture.unit, 0.95, 'Repère localisé', fixture.file_name, fixture.page, fixture.excluded,
  case when fixture.excluded then 'Hors périmètre' end, now() + fixture.rank * interval '1 second'
from (values
  -- A : ml, u avec prix de mapping, « PM » (statut pour mémoire), et un item exclu dont l'unité est inconnue.
  ('8d000000-0000-4000-8000-000000000301'::uuid, '8d000000-0000-4000-8000-000000000201'::uuid, 'M2 Tube cuivre 22', 12.5::numeric, 'ml', 'PLB R+1 indice B.pdf', 3, false, 1),
  ('8d000000-0000-4000-8000-000000000302'::uuid, '8d000000-0000-4000-8000-000000000201'::uuid, 'M2 Coude cuivre', 4::numeric, 'u', 'PLB R+1 indice B.pdf', 3, false, 2),
  ('8d000000-0000-4000-8000-000000000303'::uuid, '8d000000-0000-4000-8000-000000000201'::uuid, 'M2 Robinetterie existante', 1::numeric, 'PM', 'PLB R+1 indice B.pdf', 4, false, 3),
  ('8d000000-0000-4000-8000-000000000304'::uuid, '8d000000-0000-4000-8000-000000000201'::uuid, 'M2 Barre exclue', 2::numeric, 'barre', 'PLB R+1 indice B.pdf', 4, true, 4),
  -- M : rapproché de la ligne existante (même désignation à la casse et aux espaces près, « m » = ml), et une ligne neuve.
  ('8d000000-0000-4000-8000-000000000311'::uuid, '8d000000-0000-4000-8000-000000000202'::uuid, 'm2  tube CUIVRE 22', 7::numeric, 'm', 'fusion.pdf', 1, false, 1),
  ('8d000000-0000-4000-8000-000000000312'::uuid, '8d000000-0000-4000-8000-000000000202'::uuid, 'M2 Vanne 1/4 tour', 2::numeric, 'u', 'fusion.pdf', 1, false, 2),
  -- R : remplace le contenu de la section.
  ('8d000000-0000-4000-8000-000000000321'::uuid, '8d000000-0000-4000-8000-000000000203'::uuid, 'M2 Gaine', 3::numeric, 'ml', 'remplacement.pdf', 2, false, 1),
  -- U : « barre » n'est pas au référentiel ; « u » l'est.
  ('8d000000-0000-4000-8000-000000000331'::uuid, '8d000000-0000-4000-8000-000000000204'::uuid, 'M2 Tube acier', 2::numeric, 'barre', 'unite-inconnue.pdf', 1, false, 1),
  ('8d000000-0000-4000-8000-000000000332'::uuid, '8d000000-0000-4000-8000-000000000204'::uuid, 'M2 Collier', 3::numeric, 'u', 'unite-inconnue.pdf', 1, false, 2),
  -- O : un item remplacé par un ouvrage de bibliothèque (10 ml pour 5 h, soit 0,5 h/u).
  ('8d000000-0000-4000-8000-000000000341'::uuid, '8d000000-0000-4000-8000-000000000205'::uuid, 'M2 Ensemble de distribution', 1::numeric, 'ens', 'ouvrage.pdf', 5, false, 1),
  -- S : la version cible est archivée.
  ('8d000000-0000-4000-8000-000000000351'::uuid, '8d000000-0000-4000-8000-000000000206'::uuid, 'M2 Tube archivé', 1::numeric, 'ml', 'archive.pdf', 1, false, 1),
  -- RU : un remplacement de section refusé pour une unité inconnue ne supprime rien.
  ('8d000000-0000-4000-8000-000000000361'::uuid, '8d000000-0000-4000-8000-000000000207'::uuid, 'M2 Gaine refusée', 3::numeric, 'barre', 'remplacement-refuse.pdf', 1, false, 1),
  -- MU : même désignation que la ligne existante, autre unité (u au lieu de ml).
  ('8d000000-0000-4000-8000-000000000371'::uuid, '8d000000-0000-4000-8000-000000000208'::uuid, 'M2 Tube cuivre 22', 5::numeric, 'u', 'autre-unite.pdf', 1, false, 1),
  -- A-root : un ajout sans section cible.
  ('8d000000-0000-4000-8000-000000000381'::uuid, '8d000000-0000-4000-8000-000000000209'::uuid, 'M2 Ligne racine', 1::numeric, 'ml', 'racine.pdf', 1, false, 1)
) as fixture(id, job_id, designation, quantity, unit, file_name, page, excluded, rank);

insert into public.estimate_assemblies (id, tenant_id, created_by, name) values
  ('8d000000-0000-4000-8000-000000000401', current_setting('test.tenant_id')::uuid,
   '8d000000-0000-4000-8000-000000000001', 'M2 ouvrage distribution');
insert into public.estimate_assembly_items (id, tenant_id, assembly_id, title, unit, default_quantity, h_mo, position,
  cost_type, unit_cost_ht_cents)
values ('8d000000-0000-4000-8000-000000000411', current_setting('test.tenant_id')::uuid,
  '8d000000-0000-4000-8000-000000000401', 'M2 Tube distribution', 'ml', 10, 5, 1, 'material', 500);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id, '8d000000-0000-4000-8000-000000000001', version.tenant_id,
  statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version
where version.project_id = '8d000000-0000-4000-8000-000000000010'
  and version.status = 'draft';

-- Les cas, sous le rôle authenticated -----------------------------------------------------------

create or replace function pg_temp.m2_plan(p_job_id uuid, p_overrides jsonb default '{}'::jsonb)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_id', item.id,
      'source_order', item.source_order,
      'rule_id', null,
      'action', coalesce(p_overrides -> item.id::text ->> 'action', 'none'),
      'designation', btrim(item.designation),
      'unit_price_cents', (p_overrides -> item.id::text ->> 'unit_price_cents')::integer,
      'category_id', null,
      'assembly_id', (p_overrides -> item.id::text ->> 'assembly_id')::uuid
    )
    order by item.source_order
  ), '[]'::jsonb)
  from (
    select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti
    where ti.job_id = p_job_id
  ) as item
$$;

grant execute on function pg_temp.m2_plan(uuid, jsonb) to authenticated;

create or replace function pg_temp.m2_apply(
  p_case text, p_job_id uuid, p_strategy text, p_section_id uuid, p_overrides jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  failure_detail text;
  result_row record;
begin
  begin
    select * into result_row
    from public.apply_takeoff_job_guarded_atomic(p_job_id, p_strategy, p_section_id, pg_temp.m2_plan(p_job_id, p_overrides));
    insert into m2_outcome values (p_case, format('ok created=%s updated=%s ignored=%s scope=%s links=%s',
      result_row.created_count, result_row.updated_count, result_row.ignored_count, result_row.scope,
      jsonb_array_length(result_row.item_links)));
  exception when others then
    get stacked diagnostics failure_detail = pg_exception_detail;
    insert into m2_outcome values (p_case, sqlstate || ' ' || sqlerrm || coalesce(' | ' || nullif(failure_detail, ''), ''));
  end;
end;
$$;

grant execute on function pg_temp.m2_apply(text, uuid, text, uuid, jsonb) to authenticated;

select set_config('request.jwt.claim.sub', '8d000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '8d000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select pg_temp.m2_apply('A', '8d000000-0000-4000-8000-000000000201', 'append', '8d000000-0000-4000-8000-000000000111',
  '{"8d000000-0000-4000-8000-000000000302": {"action": "set_price", "unit_price_cents": 250}}');
select pg_temp.m2_apply('A-replay', '8d000000-0000-4000-8000-000000000201', 'append', '8d000000-0000-4000-8000-000000000111',
  '{"8d000000-0000-4000-8000-000000000302": {"action": "set_price", "unit_price_cents": 250}}');
select pg_temp.m2_apply('M', '8d000000-0000-4000-8000-000000000202', 'merge', '8d000000-0000-4000-8000-000000000112');
select pg_temp.m2_apply('R', '8d000000-0000-4000-8000-000000000203', 'replace', '8d000000-0000-4000-8000-000000000113');
select pg_temp.m2_apply('R-root', '8d000000-0000-4000-8000-000000000204', 'replace', null);
select pg_temp.m2_apply('U', '8d000000-0000-4000-8000-000000000204', 'append', '8d000000-0000-4000-8000-000000000114');
select pg_temp.m2_apply('S-archived', '8d000000-0000-4000-8000-000000000206', 'append', null);
select pg_temp.m2_apply('O', '8d000000-0000-4000-8000-000000000205', 'append', '8d000000-0000-4000-8000-000000000111',
  '{"8d000000-0000-4000-8000-000000000341": {"action": "apply_assembly", "assembly_id": "8d000000-0000-4000-8000-000000000401"}}');
select pg_temp.m2_apply('RU', '8d000000-0000-4000-8000-000000000207', 'replace', '8d000000-0000-4000-8000-000000000116');
select pg_temp.m2_apply('MU', '8d000000-0000-4000-8000-000000000208', 'merge', '8d000000-0000-4000-8000-000000000117');
select pg_temp.m2_apply('A-root', '8d000000-0000-4000-8000-000000000209', 'append', null);

select is(
  coalesce(current_setting('miaouffrage.estimate_v3_writer', true), ''),
  '',
  'the v3 writer contract is restored once each apply returns'
);

reset role;
select set_config('request.jwt.claim.sub', '8d000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '8d000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.m2_apply('X-other-tenant', '8d000000-0000-4000-8000-000000000204', 'append', '8d000000-0000-4000-8000-000000000114');
reset role;

select results_eq(
  $$select case_name, outcome from m2_outcome order by case_name$$,
  $$values
    ('A'::text, 'ok created=3 updated=0 ignored=1 scope=section links=3'::text),
    ('A-replay', 'P0001 TAKEOFF_JOB_COMPLETED_REQUIRED'),
    ('A-root', 'P0001 Une ligne doit etre rattachee a une section.'),
    ('M', 'ok created=1 updated=1 ignored=0 scope=section links=2'),
    ('MU', 'ok created=1 updated=0 ignored=0 scope=section links=1'),
    ('O', 'ok created=2 updated=0 ignored=0 scope=section links=0'),
    ('R', 'ok created=1 updated=0 ignored=0 scope=section links=1'),
    ('R-root', '22023 TAKEOFF_ROOT_REPLACE_DISABLED'),
    ('RU', '22023 TAKEOFF_V3_UNIT_UNRESOLVED | {"items": [{"unit": "barre", "designation": "M2 Gaine refusée", "takeoff_item_id": "8d000000-0000-4000-8000-000000000361"}]}'),
    ('S-archived', 'P0001 TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED'),
    ('U', '22023 TAKEOFF_V3_UNIT_UNRESOLVED | {"items": [{"unit": "barre", "designation": "M2 Tube acier", "takeoff_item_id": "8d000000-0000-4000-8000-000000000331"}]}'),
    ('X-other-tenant', '42501 TAKEOFF_APPLY_OPERATOR_REQUIRED')$$,
  'a v3 draft takes a reviewed takeoff (append, merge, section replace, ouvrage); a replay, a root replacement or append (a line needs a section, as for every engine), an archived v3, an unknown unit and another tenant are refused by name'
);

-- A : lignes v3, unité par le référentiel partagé, provenance et lien item → ligne -------------------

select results_eq(
  $$select item.title, item.description, item.unit_code, item.pricing_status::text, item.quantity,
      item.unit_price_ht_cents, item.h_mo, item.h_mo_per_unit, item.source_provider, item.source_file_name,
      item.source_page, item.source_metadata ->> 'takeoff_item_id'
    from public.estimate_items item
    where item.source_job_id = '8d000000-0000-4000-8000-000000000201'
    order by item.position$$,
  $$values
    ('M2 Tube cuivre 22'::text, 'ml'::text, 'ml'::text, 'priced'::text, 12.5::numeric, 0, 0::numeric, null::numeric,
     'takeoff'::text, 'PLB R+1 indice B.pdf'::text, 3, '8d000000-0000-4000-8000-000000000301'::text),
    ('M2 Coude cuivre', 'u', 'u', 'priced', 4::numeric, 250, 0::numeric, null::numeric,
     'takeoff', 'PLB R+1 indice B.pdf', 3, '8d000000-0000-4000-8000-000000000302'),
    ('M2 Robinetterie existante', 'PM', null, 'for_memory', 1::numeric, 0, 0::numeric, null::numeric,
     'takeoff', 'PLB R+1 indice B.pdf', 4, '8d000000-0000-4000-8000-000000000303')$$,
  'the included items become v3 lines in source order: unit code or status from the shared referential, exact quantity, mapping price, no hours, provenance and takeoff item on the line'
);

select ok(
  (select bool_and(item.parent_id = '8d000000-0000-4000-8000-000000000111')
   from public.estimate_items item where item.source_job_id = '8d000000-0000-4000-8000-000000000201'),
  'the lines are written under the target section'
);

select is(
  (select item.source_job_id::text from public.estimate_items item
   where item.source_metadata ->> 'takeoff_item_id' = '8d000000-0000-4000-8000-000000000304'),
  null,
  'an excluded item writes no line, whatever its unit'
);

-- Montants : ceux du moteur 3, stockés pour chaque ligne et pour la version, et vérifiés.
select results_eq(
  $$select item.title, item.pu_ht_cents, item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents
    from public.estimate_items item
    where item.source_job_id = '8d000000-0000-4000-8000-000000000201'
    order by item.position$$,
  $$select item.title, (line.value ->> 'pu_ht_cents')::integer,
      (line.value ->> 'line_total_ht_cents')::integer, (line.value ->> 'line_tax_cents')::integer,
      (line.value ->> 'line_total_ttc_cents')::integer
    from jsonb_array_elements(private.estimate_v3_compute('8d000000-0000-4000-8000-000000000101') -> 'lines') as line(value)
    join public.estimate_items item on item.id = (line.value ->> 'id')::uuid
    where item.source_job_id = '8d000000-0000-4000-8000-000000000201'
    order by item.position$$,
  'every applied line stores the amounts of the v3 engine'
);

select results_eq(
  $$select item.title, item.pu_ht_cents, item.line_total_ht_cents
    from public.estimate_items item
    where item.source_job_id = '8d000000-0000-4000-8000-000000000201'
    order by item.position$$,
  $$values ('M2 Tube cuivre 22'::text, 0, 0), ('M2 Coude cuivre', 328, 1312), ('M2 Robinetterie existante', null::integer, 0)$$,
  'a line without price stays at 0 €, the mapping price is sold through the FO provision and coefficient (2,50 € × 1,010 × 1,3 = 3,28 €, × 4), a « PM » line has no PU'
);

select lives_ok(
  $$select private.estimate_v3_assert_draft('8d000000-0000-4000-8000-000000000101')$$,
  'the version after the takeoff passes the v3 save-time projection check'
);

select results_eq(
  $$select version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents
    from public.estimate_versions version where version.id = '8d000000-0000-4000-8000-000000000101'$$,
  $$select (computed -> 'totals' ->> 'total_ht_cents')::integer, (computed -> 'totals' ->> 'total_tax_cents')::integer,
      (computed -> 'totals' ->> 'total_ttc_cents')::integer
    from (select private.estimate_v3_compute('8d000000-0000-4000-8000-000000000101') as computed) as engine$$,
  'the version totals are the v3 engine totals'
);

select results_eq(
  $$select job.status::text from public.takeoff_jobs job
    where job.id in ('8d000000-0000-4000-8000-000000000201', '8d000000-0000-4000-8000-000000000202',
      '8d000000-0000-4000-8000-000000000203', '8d000000-0000-4000-8000-000000000205')$$,
  $$values ('applied'::text), ('applied'), ('applied'), ('applied')$$,
  'each applied job becomes applied in the transaction of its lines'
);

select is(
  (select count(*)::integer from public.estimate_items item
   where item.version_id = '8d000000-0000-4000-8000-000000000101' and item.source_job_id = '8d000000-0000-4000-8000-000000000201'),
  3,
  'the replay adds no line'
);

-- M : la fusion garde le chiffrage de la ligne existante ---------------------------------------------

select results_eq(
  $$select item.id = '8d000000-0000-4000-8000-000000000122', item.title, item.quantity, item.unit_code, item.unit_price_ht_cents, item.h_mo_per_unit, item.h_mo,
      item.source_job_id::text, item.source_metadata ->> 'takeoff_item_id'
    from public.estimate_items item
    where item.version_id = '8d000000-0000-4000-8000-000000000102' and item.item_type = 'line'
    order by item.position$$,
  $$values
    (true, 'm2  tube CUIVRE 22'::text, 7::numeric, 'ml'::text, 1000, 0.5::numeric,
     3.5::numeric, '8d000000-0000-4000-8000-000000000202'::text, '8d000000-0000-4000-8000-000000000311'::text),
    (false, 'M2 Vanne 1/4 tour', 2::numeric, 'u', 0, null::numeric,
     0::numeric, '8d000000-0000-4000-8000-000000000202', '8d000000-0000-4000-8000-000000000312')$$,
  'merge matches the existing line by designation and resolved unit, keeps its price and hours per unit, takes the quantity (hours follow it) and adds the other line'
);

select is(
  (select item.line_total_ht_cents from public.estimate_items item where item.id = '8d000000-0000-4000-8000-000000000122'),
  (select (line.value ->> 'line_total_ht_cents')::integer
   from jsonb_array_elements(private.estimate_v3_compute('8d000000-0000-4000-8000-000000000102') -> 'lines') as line(value)
   where line.value ->> 'id' = '8d000000-0000-4000-8000-000000000122'),
  'the merged line is recomputed by the v3 engine for its new quantity'
);

-- R : le remplacement se limite à la section ------------------------------------------------------

select results_eq(
  $$select item.title, item.parent_id::text from public.estimate_items item
    where item.version_id = '8d000000-0000-4000-8000-000000000103' and item.item_type = 'line'
    order by item.title$$,
  $$values ('M2 Gaine'::text, '8d000000-0000-4000-8000-000000000113'::text),
           ('M2 Ligne d''une autre section', '8d000000-0000-4000-8000-000000000115')$$,
  'section replace deletes only the content of its section and keeps the other sections'
);

select results_eq(
  $$select version.total_ht_cents from public.estimate_versions version where version.id = '8d000000-0000-4000-8000-000000000103'$$,
  $$select (private.estimate_v3_compute('8d000000-0000-4000-8000-000000000103') -> 'totals' ->> 'total_ht_cents')::integer$$,
  'after the replacement the version total follows the remaining lines'
);

-- U : une unité inconnue refuse tout, sans écriture partielle ------------------------------------

select is(
  (select count(*)::integer from public.estimate_items item where item.version_id = '8d000000-0000-4000-8000-000000000104'
     and item.item_type = 'line'),
  0,
  'an unknown unit writes no line, not even for the item whose unit is known'
);

select is(
  (select job.status::text from public.takeoff_jobs job where job.id = '8d000000-0000-4000-8000-000000000204'),
  'completed',
  'the refused job stays completed: the unit can be corrected in the review and the job applied again'
);

select results_eq(
  $$select item.id::text, item.parent_id::text, item.quantity, item.line_total_ht_cents, job.status::text
    from public.estimate_items item
    cross join public.takeoff_jobs job
    where item.version_id = '8d000000-0000-4000-8000-000000000106' and item.item_type = 'line'
      and job.id = '8d000000-0000-4000-8000-000000000207'$$,
  $$select '8d000000-0000-4000-8000-000000000125'::text, '8d000000-0000-4000-8000-000000000116'::text, 2::numeric,
      (private.estimate_v3_compute('8d000000-0000-4000-8000-000000000106') -> 'totals' ->> 'total_ht_cents')::integer,
      'completed'::text$$,
  'a section replace refused for an unknown unit rolls back its delete: the section keeps its line and the job stays completed'
);

-- MU : la fusion ne rapproche pas une ligne d'une autre unité -------------------------------------

select results_eq(
  $$select item.id = '8d000000-0000-4000-8000-000000000126', item.unit_code, item.quantity, item.unit_price_ht_cents,
      item.source_job_id::text
    from public.estimate_items item
    where item.version_id = '8d000000-0000-4000-8000-000000000107' and item.item_type = 'line'
      and item.parent_id = '8d000000-0000-4000-8000-000000000117'
    order by item.position$$,
  $$values (true, 'ml'::text, 1::numeric, 1000, null::text),
           (false, 'u', 5::numeric, 0, '8d000000-0000-4000-8000-000000000208')$$,
  'merge with the same designation but another unit leaves the existing line untouched and adds a new one'
);

-- O : un ouvrage entre par l'écrivain v3 existant (heures par unité) -----------------------------

select results_eq(
  $$select item.item_type::text, item.title, item.unit_code, item.quantity, item.h_mo_per_unit, item.source_provider,
      item.source_metadata ->> 'mapping_action'
    from public.estimate_items item
    where item.source_job_id = '8d000000-0000-4000-8000-000000000205'
    order by item.item_type::text desc, item.title$$,
  $$values ('section'::text, 'M2 ouvrage distribution'::text, null::text, null::numeric, null::numeric, 'takeoff'::text, 'apply_assembly'::text),
           ('line', 'M2 Tube distribution', 'ml', 10::numeric, 0.5::numeric, 'takeoff', 'apply_assembly')$$,
  'an ouvrage chosen by mapping enters through the v3 assembly writer: hours per unit, unit resolved, takeoff provenance'
);

select lives_ok(
  $$select private.estimate_v3_assert_draft('8d000000-0000-4000-8000-000000000101')$$,
  'the version still passes the v3 projection check after the ouvrage'
);

-- Droits ------------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'private.takeoff_apply_v3_lines(uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'private.takeoff_apply_v3_lines(uuid,text,uuid)', 'EXECUTE'),
  'the v3 line writer is reachable only through the atomic apply'
);

select ok(
  not has_function_privilege('authenticated', 'public.apply_takeoff_job_atomic(uuid,text,uuid,jsonb)', 'EXECUTE'),
  'the atomic apply stays behind its guarded wrapper'
);

select * from finish();
rollback;
