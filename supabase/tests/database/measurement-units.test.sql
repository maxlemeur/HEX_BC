-- Lot 2, sous-lot 2.4 (piste B) : référentiel d'unités (migration M3, D9, D18, P-08, P-09).
-- Défaillances visées : docs/testing/estimate-engine-v3-2.4.md (U1 à U9).
--
-- Écrite rouge avant M3 : sans la migration, les tables, l'enum et les fonctions de normalisation
-- manquent. L'attendu de la table est généré depuis src/lib/units/units.json (bloc balisé
-- ci-dessous, contrôlé par npm run units:sql -- --check) ; les 40 vecteurs sont ceux de
-- src/lib/units/normalize.test.ts.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- <units.json:expected>
-- Généré par scripts/units/generate-units-sql.ts depuis src/lib/units/units.json : ne pas modifier à la main.
create temporary table expected_measurement_units (
  code text primary key,
  label text not null,
  symbol text not null,
  dimension text not null,
  sort_order integer not null,
  active boolean not null
) on commit drop;
insert into expected_measurement_units (code, label, symbol, dimension, sort_order, active)
values
  ('u', 'Unité', 'u', 'count', 10, true),
  ('ens', 'Ensemble', 'ens', 'set', 20, true),
  ('fft', 'Forfait', 'fft', 'lump_sum', 30, true),
  ('ml', 'Mètre linéaire', 'ml', 'length', 40, true),
  ('m2', 'Mètre carré', 'm²', 'area', 50, true),
  ('m3', 'Mètre cube', 'm³', 'volume', 60, true),
  ('kg', 'Kilogramme', 'kg', 'mass', 70, true),
  ('t', 'Tonne', 't', 'mass', 80, true),
  ('l', 'Litre', 'l', 'volume', 90, true),
  ('h', 'Heure', 'h', 'time', 100, true),
  ('j', 'Jour', 'j', 'time', 110, true),
  ('pouce', 'Pouce', '"', 'inch', 120, true);
create temporary table expected_measurement_unit_aliases (
  raw text primary key,
  token text not null,
  unit_code text,
  pricing_status text
) on commit drop;
insert into expected_measurement_unit_aliases (raw, token, unit_code, pricing_status)
values
  ('u', 'u', 'u', null),
  ('unité', 'unite', 'u', null),
  ('unités', 'unites', 'u', null),
  ('pièce', 'piece', 'u', null),
  ('pièces', 'pieces', 'u', null),
  ('pce', 'pce', 'u', null),
  ('pc', 'pc', 'u', null),
  ('pcs', 'pcs', 'u', null),
  ('ens', 'ens', 'ens', null),
  ('ensemble', 'ensemble', 'ens', null),
  ('ensembles', 'ensembles', 'ens', null),
  ('fft', 'fft', 'fft', null),
  ('forfait', 'forfait', 'fft', null),
  ('forfaits', 'forfaits', 'fft', null),
  ('ft', 'ft', 'fft', null),
  ('ml', 'ml', 'ml', null),
  ('ML', 'ml', 'ml', null),
  ('mL', 'ml', 'ml', null),
  ('Ml', 'ml', 'ml', null),
  ('m.l.', 'ml', 'ml', null),
  ('m', 'm', 'ml', null),
  ('mètre', 'metre', 'ml', null),
  ('mètres', 'metres', 'ml', null),
  ('mètre linéaire', 'metrelineaire', 'ml', null),
  ('mètres linéaires', 'metreslineaires', 'ml', null),
  ('m2', 'm2', 'm2', null),
  ('m²', 'm2', 'm2', null),
  ('M2', 'm2', 'm2', null),
  ('mètre carré', 'metrecarre', 'm2', null),
  ('mètres carrés', 'metrescarres', 'm2', null),
  ('m3', 'm3', 'm3', null),
  ('m³', 'm3', 'm3', null),
  ('M3', 'm3', 'm3', null),
  ('mètre cube', 'metrecube', 'm3', null),
  ('mètres cubes', 'metrescubes', 'm3', null),
  ('kg', 'kg', 'kg', null),
  ('kilogramme', 'kilogramme', 'kg', null),
  ('kilogrammes', 'kilogrammes', 'kg', null),
  ('kilo', 'kilo', 'kg', null),
  ('kilos', 'kilos', 'kg', null),
  ('t', 't', 't', null),
  ('tonne', 'tonne', 't', null),
  ('tonnes', 'tonnes', 't', null),
  ('l', 'l', 'l', null),
  ('litre', 'litre', 'l', null),
  ('litres', 'litres', 'l', null),
  ('h', 'h', 'h', null),
  ('heure', 'heure', 'h', null),
  ('heures', 'heures', 'h', null),
  ('j', 'j', 'j', null),
  ('jour', 'jour', 'j', null),
  ('jours', 'jours', 'j', null),
  ('pouce', 'pouce', 'pouce', null),
  ('"', '"', 'pouce', null),
  ('''''', '''''', 'pouce', null),
  ('pouces', 'pouces', 'pouce', null),
  ('inch', 'inch', 'pouce', null),
  ('inc', 'inc', null, 'included'),
  ('incl', 'incl', null, 'included'),
  ('CP', 'cp', null, 'included'),
  ('inclus', 'inclus', null, 'included'),
  ('compris', 'compris', null, 'included'),
  ('PM', 'pm', null, 'for_memory'),
  ('pour mémoire', 'pourmemoire', null, 'for_memory'),
  ('NC', 'nc', null, 'not_priced'),
  ('non chiffré', 'nonchiffre', null, 'not_priced'),
  ('HL', 'hl', null, 'out_of_scope'),
  ('hors lot', 'horslot', null, 'out_of_scope'),
  ('SO', 'so', null, 'not_applicable'),
  ('sans objet', 'sansobjet', null, 'not_applicable');
-- </units.json:expected>

-- ---------------------------------------------------------------------------
-- Schéma (D9, D18) : colonnes et types reportés dans src/types/database.ts.
-- ---------------------------------------------------------------------------
select has_table('public', 'measurement_units', 'U8 public.measurement_units exists');
select has_table('public', 'measurement_unit_aliases', 'U8 public.measurement_unit_aliases exists');

select has_column('public', 'measurement_units', column_name, format('U8 measurement_units.%s exists', column_name))
from unnest(array['code', 'label', 'symbol', 'dimension', 'sort_order', 'active']) as column_name;
select col_type_is('public', 'measurement_units', column_name, expected_type, format('U8 measurement_units.%s is %s', column_name, expected_type))
from (values
  ('code', 'text'),
  ('label', 'text'),
  ('symbol', 'text'),
  ('dimension', 'text'),
  ('sort_order', 'integer'),
  ('active', 'boolean')
) as expected(column_name, expected_type);
select col_not_null('public', 'measurement_units', column_name, format('U8 measurement_units.%s is not null', column_name))
from unnest(array['code', 'label', 'symbol', 'dimension', 'sort_order', 'active']) as column_name;
select col_is_pk('public', 'measurement_units', 'code', 'U8 measurement_units is keyed by code');

select has_column('public', 'measurement_unit_aliases', column_name, format('U8 measurement_unit_aliases.%s exists', column_name))
from unnest(array['token', 'unit_code', 'pricing_status']) as column_name;
select col_type_is('public', 'measurement_unit_aliases', column_name, expected_type, format('U8 measurement_unit_aliases.%s is %s', column_name, expected_type))
from (values
  ('token', 'text'),
  ('unit_code', 'text'),
  ('pricing_status', 'estimate_line_pricing_status')
) as expected(column_name, expected_type);
select col_is_pk('public', 'measurement_unit_aliases', 'token', 'U5 one alias row per normalized token');
select fk_ok(
  'public', 'measurement_unit_aliases', 'unit_code',
  'public', 'measurement_units', 'code',
  'U5 an alias unit_code references measurement_units.code'
);

select has_enum('public', 'estimate_line_pricing_status', 'U2 the line pricing status enum exists');
select enum_has_labels(
  'public',
  'estimate_line_pricing_status',
  array['priced', 'included', 'for_memory', 'not_priced', 'out_of_scope', 'not_applicable'],
  'U2 the pricing status enum carries the six statuses of D9 in order'
);

select throws_ok(
  $$insert into public.measurement_unit_aliases (token, unit_code, pricing_status)
    values ('zzboth', 'u', 'included')$$,
  '23514',
  null,
  'U2 an alias cannot target a unit and a status at once'
);
select throws_ok(
  $$insert into public.measurement_unit_aliases (token, unit_code, pricing_status)
    values ('zznone', null, null)$$,
  '23514',
  null,
  'U2 an alias must target a unit or a status'
);
select throws_ok(
  $$insert into public.measurement_unit_aliases (token, unit_code, pricing_status)
    values ('zzpriced', null, 'priced')$$,
  '23514',
  null,
  'U2 no alias maps to the priced status'
);
select throws_ok(
  $$insert into public.measurement_unit_aliases (token, unit_code, pricing_status)
    values ('Z Z', 'u', null)$$,
  '23514',
  null,
  'U5 a stored token is already normalized (no capital, space, dot or hyphen)'
);
select throws_ok(
  $$insert into public.measurement_unit_aliases (token, unit_code, pricing_status)
    values ('zzunknown', 'zz', null)$$,
  '23503',
  null,
  'U5 an alias cannot target an unknown unit'
);
select throws_ok(
  $$insert into public.measurement_units (code, label, symbol, dimension, sort_order)
    values ('Mm', 'Millimètre', 'mm', 'length', 999)$$,
  '23514',
  null,
  'U5 a unit code is its own normalized token'
);

-- ---------------------------------------------------------------------------
-- Données = units.json (U4) et jetons identiques TS/SQL (U3).
-- ---------------------------------------------------------------------------
select set_eq(
  'select code, label, symbol, dimension, sort_order, active from public.measurement_units',
  'select code, label, symbol, dimension, sort_order, active from expected_measurement_units',
  'U4 measurement_units equals units.json'
);
select set_eq(
  'select token, unit_code, pricing_status::text from public.measurement_unit_aliases',
  'select distinct token, unit_code, pricing_status from expected_measurement_unit_aliases',
  'U4 measurement_unit_aliases equals the aliases of units.json'
);
select is(
  (
    select string_agg(format('%s -> %s (TS %s)', expected.raw, private.unit_token(expected.raw), expected.token), '; ' order by expected.raw)
    from expected_measurement_unit_aliases as expected
    where private.unit_token(expected.raw) is distinct from expected.token
  ),
  null,
  'U3 private.unit_token gives, for every raw alias of units.json, the token computed in TypeScript'
);
select is(
  (
    select string_agg(alias.token, ', ' order by alias.token)
    from public.measurement_unit_aliases as alias
    where private.unit_token(alias.token) is distinct from alias.token
  ),
  null,
  'U5 every stored token is a fixed point of private.unit_token'
);
select is(
  (
    select string_agg(expected.raw, ', ' order by expected.raw)
    from expected_measurement_unit_aliases as expected
    cross join lateral private.normalize_unit(expected.raw) as resolved
    where resolved.unit_code is distinct from expected.unit_code
      or resolved.pricing_status::text is distinct from expected.pricing_status
  ),
  null,
  'U4 private.normalize_unit resolves every raw alias of units.json to its target'
);

-- ---------------------------------------------------------------------------
-- Les 40 vecteurs de src/lib/units/normalize.test.ts (U1, U2, U3, U7, U9).
-- ---------------------------------------------------------------------------
create temporary table unit_vectors (
  position integer primary key,
  raw text not null,
  token text not null,
  unit_code text,
  pricing_status text
) on commit drop;

insert into unit_vectors (position, raw, token, unit_code, pricing_status)
values
  (1, 'ML', 'ml', 'ml', null),
  (2, 'ml', 'ml', 'ml', null),
  (3, 'mL', 'ml', 'ml', null),
  (4, 'm.l.', 'ml', 'ml', null),
  (5, 'mètre linéaire', 'metrelineaire', 'ml', null),
  (6, 'm', 'm', 'ml', null),
  (7, '  Ml  ', 'ml', 'ml', null),
  (8, U&'m\00A0l', 'ml', 'ml', null),
  (9, 'm-l', 'ml', 'ml', null),
  (10, U&'me\0301tres line\0301aires', 'metreslineaires', 'ml', null),
  (11, U&'\FF2D\FF2C', 'ml', 'ml', null),
  (12, 'm²', 'm2', 'm2', null),
  (13, 'M2', 'm2', 'm2', null),
  (14, 'm 2', 'm2', 'm2', null),
  (15, 'Mètre carré', 'metrecarre', 'm2', null),
  (16, 'm³', 'm3', 'm3', null),
  (17, 'M3', 'm3', 'm3', null),
  (18, 'U', 'u', 'u', null),
  (19, 'unité', 'unite', 'u', null),
  (20, 'Pce', 'pce', 'u', null),
  (21, 'ENS', 'ens', 'ens', null),
  (22, 'Ensemble', 'ensemble', 'ens', null),
  (23, 'Fft', 'fft', 'fft', null),
  (24, 'forfait', 'forfait', 'fft', null),
  (25, 'KG', 'kg', 'kg', null),
  (26, 'Tonne', 'tonne', 't', null),
  (27, 'h', 'h', 'h', null),
  (28, 'Jours', 'jours', 'j', null),
  (29, '"', '"', 'pouce', null),
  (30, 'Pouces', 'pouces', 'pouce', null),
  (31, 'HL', 'hl', null, 'out_of_scope'),
  (32, 'h.l.', 'hl', null, 'out_of_scope'),
  (33, 'PM', 'pm', null, 'for_memory'),
  (34, 'NC', 'nc', null, 'not_priced'),
  (35, 'Inc.', 'inc', null, 'included'),
  (36, 'incl', 'incl', null, 'included'),
  (37, 'CP', 'cp', null, 'included'),
  (38, 'SO', 'so', null, 'not_applicable'),
  (39, 'millilitre', 'millilitre', null, null),
  (40, '', '', null, null);

select is((select count(*)::integer from unit_vectors), 40, 'the SQL suite carries the 40 normalizer vectors');

select is(
  private.unit_token(vector.raw),
  vector.token,
  format('U3 vector %s: token of %L', vector.position, vector.raw)
)
from unit_vectors as vector
order by vector.position;

select is(
  coalesce(resolved.unit_code, '-') || ' / ' || coalesce(resolved.pricing_status::text, '-'),
  coalesce(vector.unit_code, '-') || ' / ' || coalesce(vector.pricing_status, '-'),
  format('U1/U2 vector %s: %L resolves to unit %s / status %s', vector.position, vector.raw, vector.unit_code, vector.pricing_status)
)
from unit_vectors as vector
cross join lateral private.normalize_unit(vector.raw) as resolved
order by vector.position;

select is(private.unit_token(null), null, 'U9 the token of null is null');
select ok(
  (select resolved.unit_code is null and resolved.pricing_status is null from private.normalize_unit(null) as resolved),
  'U9 null resolves to no unit and no status'
);
select ok(
  not exists (
    select 1 from public.measurement_units as unit
    where unit.code like 'mil%' or lower(unit.label) like '%millilitre%'
  )
  and not exists (
    select 1 from public.measurement_unit_aliases as alias where alias.token like 'millilit%'
  ),
  'U7 the referential holds no millilitre (P-08)'
);
select is(
  (select array_agg(resolved.unit_code order by raw) from unnest(array['ens', 'fft']) as raw cross join lateral private.normalize_unit(raw) as resolved),
  array['ens', 'fft'],
  'P-08 ens and fft stay distinct units'
);

-- ---------------------------------------------------------------------------
-- RLS et privilèges (U6, I6) : lecture par authenticated, rien pour anon, aucune écriture
-- applicative ; service_role garde ses droits (security-invariants.test.sql).
-- ---------------------------------------------------------------------------
select ok(
  relation.relrowsecurity,
  format('U6 public.%I has row level security enabled', relation.relname)
)
from pg_class as relation
where relation.oid in ('public.measurement_units'::regclass, 'public.measurement_unit_aliases'::regclass);

select ok(
  not has_table_privilege('anon', table_name, privilege_name),
  format('U6 anon has no %s on %s', privilege_name, table_name)
)
from unnest(array['public.measurement_units', 'public.measurement_unit_aliases']) as table_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege_name;

select ok(
  has_table_privilege('authenticated', table_name, 'SELECT'),
  format('U6 authenticated can read %s', table_name)
)
from unnest(array['public.measurement_units', 'public.measurement_unit_aliases']) as table_name;

select ok(
  not has_table_privilege('authenticated', table_name, privilege_name),
  format('U6 authenticated has no %s on %s', privilege_name, table_name)
)
from unnest(array['public.measurement_units', 'public.measurement_unit_aliases']) as table_name
cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege_name;

select ok(
  not has_function_privilege(role_name, function_signature, 'EXECUTE'),
  format('U6 %s cannot execute %s', role_name, function_signature)
)
from unnest(array['private.unit_token(text)', 'private.normalize_unit(text)']) as function_signature
cross join unnest(array['public', 'anon', 'authenticated', 'service_role']) as role_name;

select ok(
  procedure.proconfig @> array['search_path=""'] and not procedure.prosecdef,
  format('F15 %s pins an empty search_path and runs as invoker', procedure.oid::regprocedure)
)
from pg_proc as procedure
where procedure.oid in ('private.unit_token(text)'::regprocedure, 'private.normalize_unit(text)'::regprocedure);

set local role anon;

select throws_ok(
  'select count(*) from public.measurement_units',
  '42501',
  'permission denied for table measurement_units',
  'U6 anon sees no unit row: reading is refused'
);
select throws_ok(
  'select count(*) from public.measurement_unit_aliases',
  '42501',
  'permission denied for table measurement_unit_aliases',
  'U6 anon sees no alias row: reading is refused'
);

reset role;
-- Les attendus générés sont des tables temporaires du propriétaire : authenticated les lit pour comparer.
grant select on expected_measurement_units, expected_measurement_unit_aliases to authenticated;
set local role authenticated;

select is(
  (select count(*)::integer from public.measurement_units),
  (select count(*)::integer from expected_measurement_units),
  'U6 authenticated reads every unit'
);
select is(
  (select count(*)::integer from public.measurement_unit_aliases),
  (select count(distinct token)::integer from expected_measurement_unit_aliases),
  'U6 authenticated reads every alias'
);
select throws_ok(
  $$insert into public.measurement_units (code, label, symbol, dimension, sort_order) values ('zz', 'Zz', 'zz', 'count', 999)$$,
  '42501',
  'permission denied for table measurement_units',
  'U6 authenticated cannot insert a unit'
);
select throws_ok(
  $$update public.measurement_units set label = 'Pièce' where code = 'u'$$,
  '42501',
  'permission denied for table measurement_units',
  'U6 authenticated cannot update a unit'
);
select throws_ok(
  $$delete from public.measurement_units where code = 'u'$$,
  '42501',
  'permission denied for table measurement_units',
  'U6 authenticated cannot delete a unit'
);
select throws_ok(
  $$insert into public.measurement_unit_aliases (token, unit_code) values ('zz', 'u')$$,
  '42501',
  'permission denied for table measurement_unit_aliases',
  'U6 authenticated cannot insert an alias'
);
select throws_ok(
  $$update public.measurement_unit_aliases set unit_code = 'u' where token = 'ml'$$,
  '42501',
  'permission denied for table measurement_unit_aliases',
  'U6 authenticated cannot update an alias'
);
select throws_ok(
  $$delete from public.measurement_unit_aliases where token = 'ml'$$,
  '42501',
  'permission denied for table measurement_unit_aliases',
  'U6 authenticated cannot delete an alias'
);
select throws_ok(
  $$select private.unit_token('ml')$$,
  '42501',
  null,
  'U6 authenticated cannot call the private normalizer'
);

reset role;

select * from finish();
rollback;
