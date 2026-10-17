-- Lot 2, sous-lot 2.1 : socle fermé par défaut du moteur de calcul 3 (migration M1).
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md, D2, §6.4, §7, §14 (2.1).
-- Défaillances visées : docs/testing/estimate-engine-v3-2.1.md (F-SQL-01 à F-SQL-14).
--
-- Écrite rouge avant M1. Étapes attendues :
--   1. sans M1 : les contrôles structurels échouent, puis l'insertion de la fixture v3
--      échoue sur ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED (le moteur 3 n'est pas admis) ;
--   2. moteur 3 seulement admis (CHECK et déclencheur d'insertion élargis, étape locale non
--      conservée) : les gardes héritées, l'émission, le contrat d'écrivain, la duplication,
--      la file d'approbation et la garde prosrc échouent ;
--   3. avec M1 : tout passe.
--
-- Chaque sonde d'écriture passe par pg_temp.v3_probe : elle exécute ses instructions dans un
-- sous-bloc, renvoie « SQLSTATE MESSAGE » au premier refus, ou « ok[:valeur] », puis annule
-- toujours ce qu'elle a écrit. Une sonde qui réussit à l'étape 2 ne pollue donc pas la suite.
-- La fixture v3 est insérée par postgres sous le contrat d'écrivain
-- (miaouffrage.estimate_v3_writer = id de version), seul chemin de création d'une v3 en 2.1.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

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

-- ---------------------------------------------------------------------------
-- F-SQL-14 : garde structurelle. Toute fonction de public/private qui compare un
-- *engine_version à un littéral (=, <>, !=, is [not] distinct from, [not] in (…), = any(…))
-- figure dans cette liste revue, avec son motif.
-- ---------------------------------------------------------------------------
create temporary table v3_engine_literal_whitelist (
  function_name text primary key,
  reason text not null
) on commit drop;

insert into v3_engine_literal_whitelist (function_name, reason)
values
  ('public.enforce_estimate_calc_engine_on_insert', 'contrats d''insertion : admission 1-3, coercition canonical_v2 -> 2 et legacy_v1 -> 1, refus de 3 hors fixture'),
  ('public.persist_estimate_creation_atomic', 'création canonique : charge utile au moteur 2 uniquement jusqu''au contrat canonical_v3 (M4)'),
  ('public.list_approval_queue', 'marge v1 lue en margin_bp (texte = 1 conservé) ; v3 -> NULL depuis M1, marque v3 en M4'),
  ('public.estimate_offer_client_items_match', 'branche v1/v2 inchangée ; faux pour tout moteur hors {1,2} depuis M1'),
  ('public.require_fresh_v2_snapshot_for_publication', 'refus nommé ESTIMATE_V3_EMISSION_NOT_READY (retiré en M5)'),
  ('public.freeze_estimate_v2_snapshot_without_explicit_rounding', 'gel v2 : refuse tout moteur autre que 2 (inchangé)'),
  ('public.freeze_estimate_v2_document_snapshot', 'gel documentaire v2 : refuse tout moteur autre que 2 (inchangé)'),
  ('public.save_estimate_settings_atomic', 'branches v1/v2 ; le contrat d''écrivain refuse la v3 jusqu''à M4'),
  ('public.commit_estimate_batch', 'branches v1/v2 ; le contrat d''écrivain refuse la v3 jusqu''à M4'),
  ('public.atomic_create_estimate_item', 'branches v1/v2 ; le contrat d''écrivain refuse la v3 jusqu''à M4'),
  ('public.finalize_estimate_assembly_calculation', 'branches v1/v2 ; le contrat d''écrivain refuse la v3 jusqu''à M6'),
  ('public.commit_generated_ouvrages', 'branches v1/v2 ; le contrat d''écrivain refuse la v3 jusqu''à M6'),
  ('public.recalculate_takeoff_estimate_version', 'métré v1/v2 inchangé ; le contrat d''écrivain refuse la v3 (P-19)'),
  ('public.guard_estimate_item_engine_columns', 'contrat d''écrivain v3 sur les lignes (M1)'),
  ('public.guard_estimate_version_engine_v3_writer', 'contrat d''écrivain v3 sur les versions (M1)'),
  ('public.guard_estimate_document_engine_v3', 'refus des documents v3 (M1, remplacé en M5)'),
  ('private.calc_engine_freezes_snapshot', 'prédicat d''héritage de la gouvernance v2 (M1)'),
  ('public.guard_estimate_v2_snapshot_columns', 'prédicat d''héritage en ligne in (2, 3) : garde security invoker, schéma private fermé à authenticated/service_role (M1)'),
  ('public.guard_estimate_project_v2_owner_change', 'prédicat d''héritage en ligne in (2, 3) : garde security invoker, schéma private fermé à authenticated/service_role (M1)'),
  ('public.guard_labor_role_v2_owner_change', 'prédicat d''héritage en ligne in (2, 3) : garde security invoker, schéma private fermé à authenticated/service_role (M1)'),
  ('public.open_estimate_review_cycle', 'prédicat d''héritage en ligne in (2, 3) : security invoker, schéma private fermé à authenticated/service_role (M1)');

select is(
  array(
    select format('%s.%s', namespace.nspname, procedure.proname)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prosrc ~* 'engine_version\y[^;]{0,40}?(=|<>|!=|is (not )?distinct from|(not\s+)?in\s*\(|=\s*any\s*\(\s*(array\s*\[)?)\s*[0-9]'
      and not exists (
        select 1
        from v3_engine_literal_whitelist whitelisted
        where whitelisted.function_name = format('%s.%s', namespace.nspname, procedure.proname)
      )
    order by 1
  ),
  '{}'::text[],
  'F-SQL-14 every function comparing an engine version to a literal is on the reviewed whitelist'
);

select diag(
  'Entrées de la liste blanche sans comparaison littérale (à retirer après revue) : ' ||
  coalesce((
    select string_agg(whitelisted.function_name, ', ' order by whitelisted.function_name)
    from v3_engine_literal_whitelist whitelisted
    where not exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where format('%s.%s', namespace.nspname, procedure.proname) = whitelisted.function_name
        and procedure.prosrc ~* 'engine_version\y[^;]{0,40}?(=|<>|!=|is (not )?distinct from|(not\s+)?in\s*\(|=\s*any\s*\(\s*(array\s*\[)?)\s*[0-9]'
    )
  ), 'aucune')
);

select is(
  (
    select pg_get_constraintdef(constraint_row.oid)
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.estimate_versions'::regclass
      and constraint_row.conname = 'estimate_versions_calc_engine_version_check'
  ),
  'CHECK ((calc_engine_version = ANY (ARRAY[1, 2, 3])))',
  'F-SQL-01 the engine CHECK admits exactly the engines 1, 2 and 3'
);

select is(
  pg_temp.v3_probe(
    null,
    $a$select array_agg(private.calc_engine_freezes_snapshot(engine::smallint) order by engine)::text from generate_series(1, 3) engine$a$
  ),
  'ok:{f,t,t}',
  'F-SQL-03 the inheritance predicate freezes snapshots for engines 2 and 3 only'
);

-- ---------------------------------------------------------------------------
-- Comptes, entreprise, projet et rôles (aucune v3 à ce stade).
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
    ('a3210000-0000-4000-8000-000000000001'::uuid, 'v3-guards-owner@example.test'),
    ('a3210000-0000-4000-8000-000000000002'::uuid, 'v3-guards-candidate-owner@example.test'),
    ('a3210000-0000-4000-8000-000000000003'::uuid, 'v3-guards-reviewer@example.test')
) as fixture(id, email);

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = 'a3210000-0000-4000-8000-000000000001';

update public.tenant_memberships
set is_default = false
where user_id = 'a3210000-0000-4000-8000-000000000003';

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select
  fixture.id,
  owner_membership.tenant_id,
  fixture.user_id,
  fixture.role,
  fixture.is_default
from public.tenant_memberships owner_membership
cross join (
  values
    ('a3210000-0000-4000-8000-000000000004'::uuid, 'a3210000-0000-4000-8000-000000000002'::uuid, 'engineer'::public.tenant_role, false),
    ('a3210000-0000-4000-8000-000000000005'::uuid, 'a3210000-0000-4000-8000-000000000003'::uuid, 'admin'::public.tenant_role, true)
) as fixture(id, user_id, role, is_default)
where owner_membership.user_id = 'a3210000-0000-4000-8000-000000000001';

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select
  'a3210000-0000-4000-8000-000000000010',
  membership.tenant_id,
  membership.user_id,
  'Projet garde v3',
  false
from public.tenant_memberships membership
where membership.user_id = 'a3210000-0000-4000-8000-000000000001';

insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position)
select
  fixture.id,
  project.tenant_id,
  fixture.user_id,
  fixture.name,
  fixture.rate,
  true,
  fixture.position
from public.estimate_projects project
cross join (
  values
    ('a3210000-0000-4000-8000-000000000020'::uuid, 'a3210000-0000-4000-8000-000000000001'::uuid, 'Rôle v3 R1', 5000, 1),
    ('a3210000-0000-4000-8000-000000000021'::uuid, 'a3210000-0000-4000-8000-000000000001'::uuid, 'Rôle v3 R2', 4000, 2),
    ('a3210000-0000-4000-8000-000000000022'::uuid, 'a3210000-0000-4000-8000-000000000001'::uuid, 'Rôle v3 R3', 4500, 3),
    ('a3210000-0000-4000-8000-000000000023'::uuid, 'a3210000-0000-4000-8000-000000000002'::uuid, 'Rôle autre propriétaire', 3000, 1)
) as fixture(id, user_id, name, rate, position)
where project.id = 'a3210000-0000-4000-8000-000000000010';

-- ---------------------------------------------------------------------------
-- F-SQL-01 et F-SQL-02 : admission du moteur et contrats d'insertion.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version)
       select 'a3210000-0000-4000-8000-000000000550', tenant_id, id, 50, 'draft', 4
       from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'$s$
  ]),
  '23514 ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED',
  'F-SQL-01 engine 4 is refused'
);

select is(
  pg_temp.v3_probe(
    array[
      $s$select set_config('miaouffrage.estimate_version_insert_contract', 'canonical_v2', true)$s$,
      $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version)
         select 'a3210000-0000-4000-8000-000000000551', tenant_id, id, 51, 'draft', 3
         from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'$s$
    ],
    $a$select calc_engine_version::text from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000551'$a$
  ),
  'ok:2',
  'F-SQL-02 the canonical_v2 insertion contract always produces engine 2, even when 3 is requested'
);

select is(
  pg_temp.v3_probe(
    array[
      $s$select set_config('miaouffrage.estimate_version_insert_contract', 'legacy_v1', true)$s$,
      $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version)
         select 'a3210000-0000-4000-8000-000000000552', tenant_id, id, 52, 'draft', 3
         from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'$s$
    ],
    $a$select calc_engine_version::text from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000552'$a$
  ),
  'ok:1',
  'F-SQL-02 the legacy_v1 insertion contract always produces engine 1, even when 3 is requested'
);

select is(
  pg_temp.v3_probe(array[
    $s$select set_config('miaouffrage.estimate_version_insert_contract', 'duplicate_source', true)$s$,
    $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version)
       select 'a3210000-0000-4000-8000-000000000553', tenant_id, id, 53, 'draft', 3
       from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-02 the duplicate_source insertion contract cannot produce engine 3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select public.persist_estimate_creation_atomic(
         (select tenant_id from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'),
         'a3210000-0000-4000-8000-000000000001',
         'a3210000-0000-4000-8000-000000000010',
         null,
         '{"calc_engine_version":3}'::jsonb,
         '[]'::jsonb,
         null
       )$s$
  ]),
  '22023 ESTIMATE_VERSION_PAYLOAD_INVALID',
  'F-SQL-02 the canonical creation RPC refuses a requested engine 3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version)
       values ('a3210000-0000-4000-8000-000000000554', public.current_tenant_id(), 'a3210000-0000-4000-8000-000000000010', 54, 'draft', 3)$s$
  ]),
  '42501 permission denied for table estimate_versions',
  'F-SQL-02 an authenticated caller cannot insert a version directly'
);

select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version)
       select 'a3210000-0000-4000-8000-000000000555', tenant_id, id, 55, 'draft', 3
       from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'$s$
  ]),
  'ok',
  'F-SQL-02 only a contract-less postgres fixture can insert an engine 3 version'
);

-- ---------------------------------------------------------------------------
-- Fixture v3 (postgres, contrat d'écrivain par version). Sans M1, l'insertion échoue ici.
-- ---------------------------------------------------------------------------
insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status,
  calc_engine_version,
  title
)
select
  fixture.id,
  project.tenant_id,
  project.id,
  fixture.version_number,
  fixture.status,
  fixture.calc_engine_version,
  fixture.title
from public.estimate_projects project
cross join (
  values
    ('a3210000-0000-4000-8000-000000000101'::uuid, 1, 'draft'::public.estimate_status, 3::smallint, 'V3 brouillon (écrivains)'),
    ('a3210000-0000-4000-8000-000000000102'::uuid, 2, 'sent'::public.estimate_status, 3::smallint, 'V3 envoyée (historique synthétique)'),
    ('a3210000-0000-4000-8000-000000000103'::uuid, 3, 'draft'::public.estimate_status, 3::smallint, 'V3 figée (invalidation)'),
    ('a3210000-0000-4000-8000-000000000104'::uuid, 4, 'draft'::public.estimate_status, 3::smallint, 'V3 non figée (revue)'),
    ('a3210000-0000-4000-8000-000000000105'::uuid, 5, 'draft'::public.estimate_status, 3::smallint, 'V3 en revue (file)'),
    ('a3210000-0000-4000-8000-000000000106'::uuid, 6, 'draft'::public.estimate_status, 3::smallint, 'V3 émission'),
    ('a3210000-0000-4000-8000-000000000107'::uuid, 7, 'draft'::public.estimate_status, 3::smallint, 'V3 réglages'),
    ('a3210000-0000-4000-8000-000000000108'::uuid, 8, 'draft'::public.estimate_status, 3::smallint, 'V3 vide (version zéro)'),
    ('a3210000-0000-4000-8000-000000000109'::uuid, 9, 'draft'::public.estimate_status, 2::smallint, 'V2 témoin')
) as fixture(id, version_number, status, calc_engine_version, title)
where project.id = 'a3210000-0000-4000-8000-000000000010';

-- Historique synthétique : les lignes d'une version envoyée ne peuvent être insérées que
-- déclencheur de révision suspendu (il refuse toute ligne d'une version finalisée).
alter table public.estimate_items
  disable trigger bump_estimate_content_revision_from_item;

create function pg_temp.v3_fixture_items(p_version_id uuid, p_items jsonb)
returns void
language plpgsql
as $fixture$
begin
  perform set_config('miaouffrage.estimate_v3_writer', p_version_id::text, true);
  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    aid,
    labor_role_id,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    pu_ht_cents,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    entry.id,
    version.tenant_id,
    version.id,
    entry.parent_id,
    entry.item_type,
    entry.position,
    entry.title,
    case when entry.item_type = 'line' then 'u' end,
    null,
    entry.labor_role_id,
    case when entry.item_type = 'line' then 2 end,
    case when entry.item_type = 'line' then 1000 end,
    case when entry.item_type = 'line' then 2000 end,
    case when entry.item_type = 'line' then 1 end,
    case when entry.item_type = 'line' then coalesce(entry.h_mo, 0) end,
    1,
    case when entry.item_type = 'line' then 1 end,
    case when entry.item_type = 'line' then 1000 end,
    case when entry.item_type = 'line' then 2000 end,
    case when entry.item_type = 'line' then 400 end,
    case when entry.item_type = 'line' then 2400 end
  from public.estimate_versions version
  cross join jsonb_to_recordset(p_items) as entry(
    id uuid,
    parent_id uuid,
    item_type public.estimate_item_type,
    position integer,
    title text,
    labor_role_id uuid,
    h_mo numeric
  )
  where version.id = p_version_id;
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end;
$fixture$;

select pg_temp.v3_fixture_items('a3210000-0000-4000-8000-000000000101', '[
  {"id":"a3210000-0000-4000-8000-000000000201","parent_id":null,"item_type":"section","position":1,"title":"Lot v3"},
  {"id":"a3210000-0000-4000-8000-000000000202","parent_id":"a3210000-0000-4000-8000-000000000201","item_type":"line","position":1,"title":"Ligne v3 avec main-d''oeuvre","labor_role_id":"a3210000-0000-4000-8000-000000000020","h_mo":1},
  {"id":"a3210000-0000-4000-8000-000000000203","parent_id":"a3210000-0000-4000-8000-000000000201","item_type":"line","position":2,"title":"Ligne v3 sans rôle"},
  {"id":"a3210000-0000-4000-8000-000000000212","parent_id":null,"item_type":"section","position":2,"title":"Lot v3 bis"}
]');
select pg_temp.v3_fixture_items('a3210000-0000-4000-8000-000000000102', '[
  {"id":"a3210000-0000-4000-8000-000000000204","parent_id":null,"item_type":"section","position":1,"title":"Lot v3 envoyé"},
  {"id":"a3210000-0000-4000-8000-000000000205","parent_id":"a3210000-0000-4000-8000-000000000204","item_type":"line","position":1,"title":"Ligne v3 envoyée","labor_role_id":"a3210000-0000-4000-8000-000000000022","h_mo":1}
]');
select pg_temp.v3_fixture_items('a3210000-0000-4000-8000-000000000103', '[
  {"id":"a3210000-0000-4000-8000-000000000213","parent_id":null,"item_type":"section","position":1,"title":"Lot v3 figé"},
  {"id":"a3210000-0000-4000-8000-000000000206","parent_id":"a3210000-0000-4000-8000-000000000213","item_type":"line","position":1,"title":"Ligne v3 figée","labor_role_id":"a3210000-0000-4000-8000-000000000021","h_mo":1}
]');
select pg_temp.v3_fixture_items('a3210000-0000-4000-8000-000000000104', '[
  {"id":"a3210000-0000-4000-8000-000000000214","parent_id":null,"item_type":"section","position":1,"title":"Lot v3 non figé"},
  {"id":"a3210000-0000-4000-8000-000000000207","parent_id":"a3210000-0000-4000-8000-000000000214","item_type":"line","position":1,"title":"Ligne v3 non figée"}
]');
select pg_temp.v3_fixture_items('a3210000-0000-4000-8000-000000000105', '[
  {"id":"a3210000-0000-4000-8000-000000000215","parent_id":null,"item_type":"section","position":1,"title":"Lot v3 en revue"},
  {"id":"a3210000-0000-4000-8000-000000000208","parent_id":"a3210000-0000-4000-8000-000000000215","item_type":"line","position":1,"title":"Ligne v3 en revue"}
]');
select pg_temp.v3_fixture_items('a3210000-0000-4000-8000-000000000106', '[
  {"id":"a3210000-0000-4000-8000-000000000209","parent_id":null,"item_type":"section","position":1,"title":"Lot émission"},
  {"id":"a3210000-0000-4000-8000-000000000210","parent_id":"a3210000-0000-4000-8000-000000000209","item_type":"line","position":1,"title":"Ligne émission"}
]');

-- La clé parente différée de ces insertions doit être vérifiée avant de modifier la table.
set constraints public.estimate_items_parent_id_fkey immediate;
set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items
  enable trigger bump_estimate_content_revision_from_item;

-- Le témoin v2 n'a pas besoin du contrat : la garde ne vise que le moteur 3.
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select 'a3210000-0000-4000-8000-000000000216', version.tenant_id, version.id, 'section', 1, 'Lot v2 témoin'
from public.estimate_versions version
where version.id = 'a3210000-0000-4000-8000-000000000109';

insert into public.estimate_items (
  id, tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
)
select
  'a3210000-0000-4000-8000-000000000211', version.tenant_id, version.id, 'a3210000-0000-4000-8000-000000000216',
  'line', 1, 'Ligne v2 témoin', 'u', 1, 100, 2000, 1, 0, 1, 1, 100, 100, 20, 120
from public.estimate_versions version
where version.id = 'a3210000-0000-4000-8000-000000000109';

-- Gels synthétiques des v3 103 et 105 (contexte contenant un multiplicateur v2 que la file
-- d'approbation ne doit jamais exploiter pour une v3).
set local role service_role;
select set_config('miaouffrage.estimate_v2_snapshot_freeze', 'on', true);
select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000103', true);
update public.estimate_versions
set calc_snapshot_context = '{"engine":3,"effective_margin_multiplier":1.25}'::jsonb
where id = 'a3210000-0000-4000-8000-000000000103';
update public.estimate_versions
set calc_snapshot_content_revision = content_revision
where id = 'a3210000-0000-4000-8000-000000000103';
select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000105', true);
update public.estimate_versions
set calc_snapshot_context = '{"engine":3,"effective_margin_multiplier":1.25}'::jsonb
where id = 'a3210000-0000-4000-8000-000000000105';
update public.estimate_versions
set calc_snapshot_content_revision = content_revision
where id = 'a3210000-0000-4000-8000-000000000105';
select set_config('miaouffrage.estimate_v3_writer', '', true);
select set_config('miaouffrage.estimate_v2_snapshot_freeze', 'off', true);
reset role;

select is(
  (
    select array_agg(
      (version.calc_snapshot_content_revision = version.content_revision and version.calc_snapshot_context is not null)
      order by version.id
    )
    from public.estimate_versions version
    where version.id in ('a3210000-0000-4000-8000-000000000103', 'a3210000-0000-4000-8000-000000000105')
  ),
  array[true, true],
  'fixture: the trusted freeze path under the writer contract leaves both v3 snapshots fresh'
);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select
  version.id,
  'a3210000-0000-4000-8000-000000000001',
  version.tenant_id,
  statement_timestamp() + interval '30 minutes',
  fixture.session_id
from public.estimate_versions version
join (
  values
    ('a3210000-0000-4000-8000-000000000101'::uuid, 'a3210000-0000-4000-8000-000000000301'::uuid),
    ('a3210000-0000-4000-8000-000000000107'::uuid, 'a3210000-0000-4000-8000-000000000302'::uuid),
    ('a3210000-0000-4000-8000-000000000106'::uuid, 'a3210000-0000-4000-8000-000000000303'::uuid)
) as fixture(version_id, session_id) on fixture.version_id = version.id;

insert into public.estimate_rules (id, tenant_id, rule_type, scope_type, threshold_value, action, is_active)
select
  'a3210000-0000-4000-8000-000000000410',
  project.tenant_id,
  'require_approval'::public.estimate_rule_type,
  'global'::public.estimate_rule_scope_type,
  0,
  'require_approval'::public.estimate_rule_action,
  true
from public.estimate_projects project
where project.id = 'a3210000-0000-4000-8000-000000000010';

insert into public.estimate_templates (id, tenant_id, created_by, name)
select 'a3210000-0000-4000-8000-000000000401', project.tenant_id, project.user_id, 'Modèle garde v3'
from public.estimate_projects project
where project.id = 'a3210000-0000-4000-8000-000000000010';

insert into public.estimate_template_items (id, tenant_id, template_id, item_type, position, title)
select 'a3210000-0000-4000-8000-000000000417', template.tenant_id, template.id, 'section', 1, 'Lot de modèle'
from public.estimate_templates template
where template.id = 'a3210000-0000-4000-8000-000000000401';

insert into public.estimate_template_items (
  id, tenant_id, template_id, parent_id, item_type, position, title, description, quantity, unit_price_ht_cents,
  tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
)
select
  'a3210000-0000-4000-8000-000000000402', template.tenant_id, template.id, 'a3210000-0000-4000-8000-000000000417',
  'line', 1, 'Ligne de modèle', 'u', 1, 1000, 2000, 1, 0, 1, 1000, 1000, 200, 1200
from public.estimate_templates template
where template.id = 'a3210000-0000-4000-8000-000000000401';

insert into public.estimate_assemblies (id, tenant_id, created_by, name)
select 'a3210000-0000-4000-8000-000000000403', project.tenant_id, project.user_id, 'Ouvrage garde v3'
from public.estimate_projects project
where project.id = 'a3210000-0000-4000-8000-000000000010';

insert into public.estimate_assembly_items (
  id, tenant_id, assembly_id, title, unit, default_quantity, position, cost_type, unit_cost_ht_cents
)
select 'a3210000-0000-4000-8000-000000000404', assembly.tenant_id, assembly.id, 'Robinet', 'u', 1, 1, 'material', 500
from public.estimate_assemblies assembly
where assembly.id = 'a3210000-0000-4000-8000-000000000403';

insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select
  'a3210000-0000-4000-8000-000000000405',
  version.tenant_id,
  version.id,
  'A'::public.takeoff_job_level,
  'completed'::public.takeoff_job_status,
  'garde-v3.pdf',
  'a3210000-0000-4000-8000-000000000001'
from public.estimate_versions version
where version.id = 'a3210000-0000-4000-8000-000000000101';

insert into public.takeoff_items (
  id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page
)
select 'a3210000-0000-4000-8000-000000000406', job.tenant_id, job.id, 'Tube cuivre', 2, 'ml', 0.95, 'Repère localisé', job.source_file_name, 1
from public.takeoff_jobs job
where job.id = 'a3210000-0000-4000-8000-000000000405';

insert into public.estimate_structure_drafts (id, tenant_id, project_id, target_version_id, created_by, status)
select 'a3210000-0000-4000-8000-000000000407', version.tenant_id, version.project_id, version.id, 'a3210000-0000-4000-8000-000000000001', 'pending'
from public.estimate_versions version
where version.id = 'a3210000-0000-4000-8000-000000000101';

insert into public.estimate_version_zero_drafts (id, tenant_id, project_id, version_id, created_by, status)
select 'a3210000-0000-4000-8000-000000000408', version.tenant_id, version.project_id, version.id, 'a3210000-0000-4000-8000-000000000001', 'ia_a_revoir'
from public.estimate_versions version
where version.id = 'a3210000-0000-4000-8000-000000000108';

insert into public.estimate_generated_ouvrage_drafts (id, tenant_id, project_id, target_version_id, created_by, source_kind, status)
select 'a3210000-0000-4000-8000-000000000409', version.tenant_id, version.project_id, version.id, 'a3210000-0000-4000-8000-000000000001', 'free_text', 'pending'
from public.estimate_versions version
where version.id = 'a3210000-0000-4000-8000-000000000101';

-- La v3 105 entre en revue par le chemin applicatif (gel frais exigé, M1 compris).
set local role service_role;
select public.open_estimate_review_cycle(
  'a3210000-0000-4000-8000-000000000105',
  (select tenant_id from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'),
  'a3210000-0000-4000-8000-000000000001',
  'a3210000-0000-4000-8000-000000000003',
  array['a3210000-0000-4000-8000-000000000410'::uuid],
  null,
  '{}'::jsonb
);
reset role;

-- ---------------------------------------------------------------------------
-- F-SQL-04 à F-SQL-07 : gouvernance v2 héritée par la v3.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_items set title = 'Titre modifié' where id = 'a3210000-0000-4000-8000-000000000205'$s$
  ]),
  '42501 ESTIMATE_VERSION_READ_ONLY',
  'F-SQL-04 a line of a sent v3 is immutable, even for a neutral column'
);

select is(
  pg_temp.v3_probe(array[
    $s$delete from public.estimate_items where id = 'a3210000-0000-4000-8000-000000000205'$s$
  ]),
  '42501 ESTIMATE_VERSION_READ_ONLY',
  'F-SQL-04 a line of a sent v3 cannot be deleted'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000102', true)$s$,
    $s$update public.estimate_items set quantity = 3 where id = 'a3210000-0000-4000-8000-000000000205'$s$
  ]),
  '42501 ESTIMATE_VERSION_READ_ONLY',
  'F-SQL-04 the writer contract never reopens a sent v3'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_projects set user_id = 'a3210000-0000-4000-8000-000000000002' where id = 'a3210000-0000-4000-8000-000000000010'$s$
  ]),
  '23503 ESTIMATE_PROJECT_OWNER_LABOR_ROLE_MISMATCH',
  'F-SQL-05 a project owner change is refused while a v3 line uses a role of the current owner'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.labor_roles set user_id = 'a3210000-0000-4000-8000-000000000002' where id = 'a3210000-0000-4000-8000-000000000020'$s$
  ]),
  '23503 ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE',
  'F-SQL-05 a labor role used by a v3 line cannot move to another owner'
);

select is(
  pg_temp.v3_probe(array[
    $s$delete from public.labor_roles where id = 'a3210000-0000-4000-8000-000000000020'$s$
  ]),
  '23503 ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE',
  'F-SQL-05 a labor role used by a v3 line cannot be deleted'
);

select is(
  pg_temp.v3_probe(array[
    $s$select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000101', true)$s$,
    $s$insert into public.estimate_items (
         id, tenant_id, version_id, parent_id, item_type, position, title, labor_role_id,
         quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
         pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
       )
       select 'a3210000-0000-4000-8000-000000000560', tenant_id, id, 'a3210000-0000-4000-8000-000000000201', 'line', 9,
         'Ligne au rôle étranger', 'a3210000-0000-4000-8000-000000000023', 1, 0, 2000, 1, 1, 1, 1, 0, 0, 0, 0
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  '23503 ESTIMATE_LABOR_ROLE_OWNER_MISMATCH',
  'F-SQL-05 a v3 line cannot reference a labor role of another owner, even under the writer contract'
);

select is(
  pg_temp.v3_probe(
    array[$s$update public.labor_roles set hourly_rate_cents = 4100 where id = 'a3210000-0000-4000-8000-000000000021'$s$],
    $a$select (calc_snapshot_content_revision is null and calc_snapshot_context is null)::text
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000103'$a$
  ),
  'ok:true',
  'F-SQL-06 an hourly-rate change invalidates the frozen snapshot of a v3 draft'
);

select is(
  pg_temp.v3_probe(
    array[$s$insert into public.feature_flags (tenant_id, flag_key, enabled)
             select tenant_id, 'EST_031_LABOR_SPLIT', true from public.estimate_projects
             where id = 'a3210000-0000-4000-8000-000000000010'$s$],
    $a$select (calc_snapshot_content_revision is null and calc_snapshot_context is null)::text
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000103'$a$
  ),
  'ok:true',
  'F-SQL-06 a labor-split flag change invalidates the frozen snapshot of a v3 draft'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select public.open_estimate_review_cycle(
         'a3210000-0000-4000-8000-000000000104',
         (select tenant_id from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'),
         'a3210000-0000-4000-8000-000000000001',
         'a3210000-0000-4000-8000-000000000003',
         array['a3210000-0000-4000-8000-000000000410'::uuid],
         null,
         '{}'::jsonb
       )$s$
  ]),
  '40001 ESTIMATE_V2_SNAPSHOT_STALE',
  'F-SQL-07 a review cannot open on a v3 draft without a fresh snapshot'
);

select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_review_cycles (tenant_id, version_id, cycle_number, requested_by)
       select tenant_id, id, 1, 'a3210000-0000-4000-8000-000000000001'
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000104'$s$
  ]),
  '40001 ESTIMATE_V2_SNAPSHOT_STALE',
  'F-SQL-07 a review cycle row cannot capture a v3 draft without a fresh snapshot'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_versions set calc_engine_version = 2 where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  '42501 ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE',
  'F-SQL-02 the engine of a v3 version is immutable'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000101', true)$s$,
    $s$update public.estimate_versions set calc_engine_version = 2 where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  '42501 ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE',
  'F-SQL-02 the writer contract cannot downgrade a v3 to engine 2'
);

-- ---------------------------------------------------------------------------
-- F-SQL-08 et F-SQL-09 : émission fermée, de façon explicite et nommée.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_documents (
         tenant_id, version_id, status, generation_token, generation_purpose,
         generation_content_revision, generation_started_at
       )
       select tenant_id, id, 'processing', gen_random_uuid(), 'manual', content_revision, now()
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'$s$
  ]),
  '0A000 ESTIMATE_V3_EMISSION_NOT_READY',
  'F-SQL-09 no document can be prepared for a v3'
);

select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_documents (tenant_id, version_id, status, last_error)
       select tenant_id, id, 'failed', 'essai'
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'$s$
  ]),
  '0A000 ESTIMATE_V3_EMISSION_NOT_READY',
  'F-SQL-09 no document row of any status can exist for a v3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_versions set status = 'sending' where id = 'a3210000-0000-4000-8000-000000000106'$s$
  ]),
  '0A000 ESTIMATE_V3_EMISSION_NOT_READY',
  'F-SQL-08 a v3 draft cannot move to sending'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_versions set status = 'sent' where id = 'a3210000-0000-4000-8000-000000000106'$s$
  ]),
  '0A000 ESTIMATE_V3_EMISSION_NOT_READY',
  'F-SQL-08 a v3 draft cannot move to sent'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_versions set status = 'sending' where id = 'a3210000-0000-4000-8000-000000000103'$s$
  ]),
  '0A000 ESTIMATE_V3_EMISSION_NOT_READY',
  'F-SQL-08 even a freshly frozen v3 cannot be published before the v3 emission contract'
);

select is(
  pg_temp.v3_probe(
    null,
    $a$select public.estimate_offer_client_items_match(
         '{"rows":[
           {"id":"a3210000-0000-4000-8000-000000000209","kind":"section","parentId":null,"position":1,"title":"Lot émission"},
           {"id":"a3210000-0000-4000-8000-000000000210","kind":"line","parentId":"a3210000-0000-4000-8000-000000000209","position":1,"title":"Ligne émission","quantity":2,"unit":"u"}
         ]}'::jsonb,
         version
       )::text
       from public.estimate_versions version where version.id = 'a3210000-0000-4000-8000-000000000106'$a$
  ),
  'ok:false',
  'F-SQL-09 the client-contract item match is false for a v3, even when the rows match'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select public.freeze_estimate_v2_snapshot(
         'a3210000-0000-4000-8000-000000000106',
         (select tenant_id from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'),
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'),
         (select content_revision from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'),
         'a3210000-0000-4000-8000-000000000001',
         'approval',
         '{}'::jsonb,
         '[]'::jsonb,
         '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"rounding_adjustment_cents":0}'::jsonb
       )$s$
  ]),
  '42501 ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT',
  'F-SQL-12 the v2 snapshot freeze still refuses a v3 (unchanged)'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select public.freeze_estimate_v2_document_snapshot(
         'a3210000-0000-4000-8000-000000000106',
         (select tenant_id from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'),
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'),
         (select content_revision from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000106'),
         'a3210000-0000-4000-8000-000000000001',
         'a3210000-0000-4000-8000-000000000303',
         '{}'::jsonb,
         '[]'::jsonb,
         '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"rounding_adjustment_cents":0}'::jsonb
       )$s$
  ]),
  '42501 ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT',
  'F-SQL-12 the v2 document snapshot freeze still refuses a v3 (unchanged)'
);

-- ---------------------------------------------------------------------------
-- F-SQL-10 : contrat d'écrivain, écritures directes.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_items (
         id, tenant_id, version_id, parent_id, item_type, position, title, description,
         quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
         pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
       )
       select 'a3210000-0000-4000-8000-000000000561', tenant_id, id, 'a3210000-0000-4000-8000-000000000201', 'line', 9,
         'Ligne directe', 'u', 1, 100, 2000, 1, 0, 1, 1, 100, 100, 20, 120
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a direct line insertion into a v3 without the writer contract is refused'
);

select is(
  pg_temp.v3_probe(array[
    $s$insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
       select 'a3210000-0000-4000-8000-000000000562', tenant_id, id, 'section', 9, 'Section directe'
       from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a direct section insertion into a v3 without the writer contract is refused'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_items set quantity = 5 where id = 'a3210000-0000-4000-8000-000000000202'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a calculation column of a v3 line cannot change without the writer contract (postgres)'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$update public.estimate_items set unit_price_ht_cents = 1500 where id = 'a3210000-0000-4000-8000-000000000202'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a direct authenticated update of a v3 line price is refused'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_items set k_fo = 1.5 where id = 'a3210000-0000-4000-8000-000000000202'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a service-role update of a v3 line coefficient is refused without the writer contract'
);

select is(
  pg_temp.v3_probe(array[
    $s$select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000107', true)$s$,
    $s$update public.estimate_items set h_mo = 2 where id = 'a3210000-0000-4000-8000-000000000202'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a writer contract bound to another version does not open this v3'
);

select is(
  pg_temp.v3_probe(
    array[
      $s$select set_config('miaouffrage.estimate_v3_writer', 'a3210000-0000-4000-8000-000000000101', true)$s$,
      $s$update public.estimate_items set quantity = 5 where id = 'a3210000-0000-4000-8000-000000000202'$s$
    ],
    $a$select quantity::text from public.estimate_items where id = 'a3210000-0000-4000-8000-000000000202'$a$
  ),
  'ok:5.000',
  'F-SQL-10 the writer contract bound to this version allows a calculation write'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_items set title = 'Ligne renommée', position = 7, aid = 'V3-AID' where id = 'a3210000-0000-4000-8000-000000000202'$s$
  ]),
  'ok',
  'F-SQL-10 neutral line columns (title, position, aid) stay writable without the contract'
);

select is(
  pg_temp.v3_probe(array[
    $s$update public.estimate_items set parent_id = 'a3210000-0000-4000-8000-000000000212', position = 1 where id = 'a3210000-0000-4000-8000-000000000203'$s$
  ]),
  'ok',
  'F-SQL-10 moving a v3 line to another section (parent_id) stays writable without the contract'
);

select is(
  pg_temp.v3_probe(array[
    $s$delete from public.estimate_items where id = 'a3210000-0000-4000-8000-000000000203'$s$
  ]),
  'ok',
  'F-SQL-10 deleting a line of a v3 draft stays possible without the contract'
);

select is(
  array[
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set margin_bp = 1500 where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set margin_multiplier = 1.3 where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set global_coefficient = 1.1 where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set discount_bp = 500 where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set discount_amount_cents = 101 where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set tax_rate_bp = 1000 where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set rounding_mode = 'down' where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set contractor_role = 'subcontractor' where id = 'a3210000-0000-4000-8000-000000000101'$s$]),
    pg_temp.v3_probe(array['set local role service_role', $s$update public.estimate_versions set total_ht_cents = 100, total_tax_cents = 20, total_ttc_cents = 120 where id = 'a3210000-0000-4000-8000-000000000101'$s$])
  ],
  array_fill('0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED'::text, array[9]),
  'F-SQL-10 margins, coefficient, discount, tax, rounding, contractor role and totals of a v3 need the writer contract'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select set_config('miaouffrage.estimate_v2_snapshot_freeze', 'on', true)$s$,
    $s$update public.estimate_versions set calc_snapshot_context = '{"engine":3}'::jsonb where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 the v2 freeze marker alone cannot write a v3 snapshot'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$update public.estimate_versions set title = 'V3 renommée', validite_jours = 45 where id = 'a3210000-0000-4000-8000-000000000101'$s$
  ]),
  'ok',
  'F-SQL-10 non-calculation version columns stay writable without the contract'
);

select is(
  array[
    pg_temp.v3_probe(array[
      $s$insert into public.estimate_items (
           id, tenant_id, version_id, parent_id, item_type, position, title, description,
           quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
           pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
         )
         select 'a3210000-0000-4000-8000-000000000563', tenant_id, id, 'a3210000-0000-4000-8000-000000000216',
           'line', 2, 'Ligne v2 libre', 'u', 1, 100, 2000, 1, 0, 1, 1, 100, 100, 20, 120
         from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000109'$s$
    ]),
    pg_temp.v3_probe(array[
      $s$update public.estimate_items set quantity = 4 where id = 'a3210000-0000-4000-8000-000000000211'$s$
    ]),
    pg_temp.v3_probe(array[
      'set local role service_role',
      $s$update public.estimate_versions set margin_bp = 1500 where id = 'a3210000-0000-4000-8000-000000000109'$s$
    ])
  ],
  array['ok', 'ok', 'ok'],
  'F-SQL-10 the writer contract does not touch a v2 draft'
);

-- ---------------------------------------------------------------------------
-- F-SQL-10 : écrivains applicatifs non adaptés (RPC). Le propriétaire détient le verrou.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(
    array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
      $s$create temporary table v3_batch_result on commit drop as
         select public.commit_estimate_batch(
           'a3210000-0000-4000-8000-000000000101',
           gen_random_uuid(),
           (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'),
           'a3210000-0000-4000-8000-000000000301',
           '[{"op":"create","data":{"item_type":"section","title":"Lot par lot"}}]'::jsonb,
           '[{"index":0,"id":"a3210000-0000-4000-8000-000000000570"}]'::jsonb,
           '[]'::jsonb,
           '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
           jsonb_build_object(
             'labor_roles', jsonb_build_array(jsonb_build_object(
               'id', 'a3210000-0000-4000-8000-000000000020',
               'tenant_id', (select tenant_id from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'),
               'user_id', 'a3210000-0000-4000-8000-000000000001',
               'hourly_rate_cents', 5000)),
             'margin_tiers', '[]'::jsonb,
             'labor_split_flag', null),
           null
         ) as response$s$
    ],
    $a$select (response->>'committed') || ' ' ||
         coalesce((select result->>'code' from jsonb_array_elements(response->'results') result where result->>'status' = 'error' limit 1), '-') || ' ' ||
         (select count(*) from public.estimate_items where version_id = 'a3210000-0000-4000-8000-000000000101')::text
       from v3_batch_result$a$
  ),
  'ok:false ESTIMATE_BATCH_INVALID_INPUT 4',
  'F-SQL-10 commit_estimate_batch cannot create an item in a v3 and writes nothing'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select public.atomic_create_estimate_item(
         'a3210000-0000-4000-8000-000000000101',
         '{"id":"a3210000-0000-4000-8000-000000000571","parent_id":"a3210000-0000-4000-8000-000000000201","item_type":"line","position":3,"title":"Ligne atomique"}'::jsonb,
         '[
           {"id":"a3210000-0000-4000-8000-000000000202","pu_ht_cents":1000,"line_total_ht_cents":2000,"line_tax_cents":400,"line_total_ttc_cents":2400},
           {"id":"a3210000-0000-4000-8000-000000000203","pu_ht_cents":1000,"line_total_ht_cents":2000,"line_tax_cents":400,"line_total_ttc_cents":2400},
           {"id":"a3210000-0000-4000-8000-000000000571","pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}
         ]'::jsonb,
         '{"total_ht_cents":4000,"total_tax_cents":800,"total_ttc_cents":4800}'::jsonb,
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'),
         'a3210000-0000-4000-8000-000000000301',
         jsonb_build_object(
           'labor_roles', jsonb_build_array(jsonb_build_object(
             'id', 'a3210000-0000-4000-8000-000000000020',
             'tenant_id', (select tenant_id from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'),
             'user_id', 'a3210000-0000-4000-8000-000000000001',
             'hourly_rate_cents', 5000)),
           'margin_tiers', '[]'::jsonb,
           'labor_split_flag', null)
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 atomic_create_estimate_item cannot create a v3 line'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select public.bulk_update_estimate_items(
         'a3210000-0000-4000-8000-000000000101',
         '[{"id":"a3210000-0000-4000-8000-000000000202","pu_ht_cents":1100,"line_total_ht_cents":2200,"line_tax_cents":440,"line_total_ttc_cents":2640}]'::jsonb,
         '{"total_ht_cents":4200,"total_tax_cents":840,"total_ttc_cents":5040}'::jsonb,
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101')
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 bulk_update_estimate_items cannot write v3 amounts'
);

select is(
  pg_temp.v3_probe(array[
    'set local role service_role',
    $s$select public.save_estimate_settings_atomic(
         'a3210000-0000-4000-8000-000000000107',
         (select tenant_id from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000107'),
         'a3210000-0000-4000-8000-000000000001',
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000107'),
         (select content_revision from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000107'),
         'a3210000-0000-4000-8000-000000000302',
         '{"margin_bp":1500}'::jsonb,
         '[]'::jsonb,
         '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"rounding_adjustment_cents":0}'::jsonb,
         '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 save_estimate_settings_atomic cannot change v3 settings'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select public.commit_generated_ouvrages(
         'a3210000-0000-4000-8000-000000000101',
         'a3210000-0000-4000-8000-000000000409',
         gen_random_uuid(),
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'),
         'a3210000-0000-4000-8000-000000000301',
         '[{"candidateId":"a3210000-0000-4000-8000-000000000580","designation":"Ouvrage généré","unit":"u","quantity":1,"lotId":null,"reviewToken":"0000000000000000000000000000000000000000000000000000000000000000"}]'::jsonb,
         '[{"candidateId":"a3210000-0000-4000-8000-000000000580","subdetailId":"a3210000-0000-4000-8000-000000000586","estimateItemId":"a3210000-0000-4000-8000-000000000581","assemblyId":"a3210000-0000-4000-8000-000000000582","applicationId":"a3210000-0000-4000-8000-000000000583","snapshotId":"a3210000-0000-4000-8000-000000000584","resolvedLotId":"a3210000-0000-4000-8000-000000000585","placementMode":"fallback_unclassified","estimateItemMapping":{},"componentProjections":[],"item":{}}]'::jsonb,
         '{"id":"a3210000-0000-4000-8000-000000000585","created":true}'::jsonb,
         '[]'::jsonb,
         '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
         '{}'::jsonb,
         (select jsonb_build_object('id', id, 'name', name, 'hourly_rate_cents', hourly_rate_cents, 'is_active', is_active, 'position', position)
          from public.labor_roles where id = 'a3210000-0000-4000-8000-000000000020')
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 commit_generated_ouvrages cannot write into a v3 (fallback section first)'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select public.finalize_estimate_assembly_calculation(
         'a3210000-0000-4000-8000-000000000101',
         (select updated_at from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'),
         (select content_revision from public.estimate_versions where id = 'a3210000-0000-4000-8000-000000000101'),
         'a3210000-0000-4000-8000-000000000301',
         array['a3210000-0000-4000-8000-000000000202'::uuid],
         '[
           {"id":"a3210000-0000-4000-8000-000000000202","pu_ht_cents":1200,"line_total_ht_cents":2400,"line_tax_cents":480,"line_total_ttc_cents":2880},
           {"id":"a3210000-0000-4000-8000-000000000203","pu_ht_cents":1000,"line_total_ht_cents":2000,"line_tax_cents":400,"line_total_ttc_cents":2400}
         ]'::jsonb,
         '{"total_ht_cents":4400,"total_tax_cents":880,"total_ttc_cents":5280}'::jsonb,
         jsonb_build_object(
           'labor_roles', jsonb_build_array(jsonb_build_object(
             'id', 'a3210000-0000-4000-8000-000000000020',
             'tenant_id', (select tenant_id from public.estimate_projects where id = 'a3210000-0000-4000-8000-000000000010'),
             'user_id', 'a3210000-0000-4000-8000-000000000001',
             'hourly_rate_cents', 5000)),
           'margin_tiers', '[]'::jsonb,
           'labor_split_flag', null)
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 finalize_estimate_assembly_calculation cannot write v3 amounts'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select count(*) from public.insert_estimate_assembly_into_version(
         'a3210000-0000-4000-8000-000000000101',
         'a3210000-0000-4000-8000-000000000403',
         null
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a library assembly cannot be inserted into a v3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select count(*) from public.apply_takeoff_job_guarded_atomic(
         'a3210000-0000-4000-8000-000000000405',
         'append',
         'a3210000-0000-4000-8000-000000000201',
         '[{"item_id":"a3210000-0000-4000-8000-000000000406","source_order":0,"rule_id":null,"action":"set_price","designation":"Tube cuivre","unit_price_cents":2500,"category_id":null,"assembly_id":null}]'::jsonb
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a takeoff job cannot be applied to a v3 (apply then recalculation)'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select count(*) from public.insert_estimate_template_into_version(
         'a3210000-0000-4000-8000-000000000101',
         'a3210000-0000-4000-8000-000000000401',
         null
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a template cannot be inserted into a v3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select * from public.apply_estimate_structure_draft(
         'a3210000-0000-4000-8000-000000000407',
         'a3210000-0000-4000-8000-000000000101',
         'a3210000-0000-4000-8000-000000000001',
         '[{"id":"a3210000-0000-4000-8000-000000000590","parent_id":null,"item_type":"section","position":9,"title":"Structure IA"}]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         now()
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 an AI structure draft cannot be applied to a v3'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select * from public.materialize_estimate_version_zero_draft(
         'a3210000-0000-4000-8000-000000000408',
         'a3210000-0000-4000-8000-000000000108',
         'a3210000-0000-4000-8000-000000000001',
         '[{"id":"a3210000-0000-4000-8000-000000000591","position":1,"title":"Lot version zéro"}]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         '[]'::jsonb,
         now()
       )$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-10 a version-zero draft cannot be materialized into a v3'
);

-- ---------------------------------------------------------------------------
-- F-SQL-11 : duplication d'une v3.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select public.duplicate_estimate_version('a3210000-0000-4000-8000-000000000101', false)$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-11 a v3 cannot be duplicated before the v3 duplication contract'
);

select is(
  pg_temp.v3_probe(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000001', true)$s$,
    $s$select public.duplicate_estimate_version('a3210000-0000-4000-8000-000000000101', true)$s$
  ]),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'F-SQL-11 a v3 cannot be duplicated as a variant either'
);

-- ---------------------------------------------------------------------------
-- F-SQL-13 : la file d'approbation n'applique jamais la formule de marge v2 à une v3.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.v3_probe(
    array[
      'set local role authenticated',
      $s$select set_config('request.jwt.claim.sub', 'a3210000-0000-4000-8000-000000000003', true)$s$
    ],
    $a$select coalesce(queue.margin_bp::text, 'null')
       from public.list_approval_queue('priority') queue
       where queue.version_id = 'a3210000-0000-4000-8000-000000000105'$a$
  ),
  'ok:null',
  'F-SQL-13 the approval queue reports an unavailable (NULL) margin for a v3 under review'
);

select * from finish();
rollback;
