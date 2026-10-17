-- Lot 2, sous-lot 2.4 (M3) : référentiel d'unités et jumeau SQL pur du moteur de calcul 3.
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md (§4, D7 à D9,
-- D12, D13, §6.1 « M3 », §14 « 2.4 ») ; preuves : docs/testing/estimate-engine-v3-2.4-sql-units.md,
-- supabase/tests/database/measurement-units.test.sql et estimate-engine-v3-functions.test.sql.
--
-- Code inerte : aucune RPC, aucun déclencheur, aucun écrivain n'appelle ces fonctions, et aucune v3
-- ne peut être créée par l'application. Aucune table existante n'est modifiée ; aucune ligne
-- existante n'est réécrite.
--
-- 1. public.estimate_line_pricing_status : les six statuts de ligne (D9). Placé ici et non en M4 :
--    les alias d'import (HL, PM, NC, inc, incl, CP, SO) en ont besoin (écart consigné).
-- 2. public.measurement_units et public.measurement_unit_aliases : référentiel global, RLS active,
--    lecture par authenticated, rien pour anon, aucune écriture applicative ; données générées
--    depuis src/lib/units/units.json (bloc balisé, contrôlé par npm run units:sql -- --check).
-- 3. private.unit_token / private.normalize_unit : même algorithme que measurementUnitToken et
--    normalizeMeasurementUnit (src/lib/units/normalize.ts).
-- 4. Fonctions pures du moteur 3 (contrat du §4, entrées et sorties JSON canoniques partagées avec
--    src/lib/estimates/engine-v3) : private.estimate_round_half_up, private.estimate_allocate_exact,
--    private.estimate_v3_line, private.estimate_v3_compute_items et leurs aides. Décimal exact
--    (numeric), demi supérieur, répartition au plus grand reste ; erreurs nommées
--    ESTIMATE_V3_INPUT_INVALID (22023) et ESTIMATE_AMOUNT_OVERFLOW (22003). Toutes immuables,
--    security invoker, search_path vide, révoquées pour tous sauf le propriétaire.

do $preflight$
begin
  if to_regnamespace('private') is null then
    raise exception 'LOT2_2_4_PREFLIGHT: the private schema is missing';
  end if;
  if to_regclass('public.measurement_units') is not null
    or to_regclass('public.measurement_unit_aliases') is not null
    or to_regtype('public.estimate_line_pricing_status') is not null then
    raise exception 'LOT2_2_4_PREFLIGHT: the measurement unit referential already exists';
  end if;
  if (select pg_catalog.pg_encoding_to_char(database.encoding) from pg_catalog.pg_database as database
      where database.datname = pg_catalog.current_database()) <> 'UTF8' then
    raise exception 'LOT2_2_4_PREFLIGHT: private.unit_token needs a UTF8 database (normalize NFKD)';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Statut de ligne (D9).
-- ---------------------------------------------------------------------------
create type public.estimate_line_pricing_status as enum (
  'priced',
  'included',
  'for_memory',
  'not_priced',
  'out_of_scope',
  'not_applicable'
);

comment on type public.estimate_line_pricing_status is
  'Line pricing status (lot 2, D9). Only priced lines enter the v3 sums; any other status contributes 0 everywhere. Column use arrives with M4.';

-- ---------------------------------------------------------------------------
-- 2. Référentiel d'unités (D9, P-08, P-09).
-- ---------------------------------------------------------------------------
create function private.unit_token(p_raw text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.lower(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.regexp_replace(normalize(p_raw, nfkd), '[̀-ͯ]', '', 'g'),
          '²', '2'),
        '³', '3')
      collate pg_catalog."C"),
    '[ \t\n\r\f\v.-]', '', 'g');
$$;

comment on function private.unit_token(text) is
  'Unit token (D9): NFKD, diacritics removed, superscript 2/3 to digits, ASCII lowercase (collation C), spaces, dots and hyphens removed. Mirrors measurementUnitToken (src/lib/units/normalize.ts).';

create table public.measurement_units (
  code text primary key,
  label text not null,
  symbol text not null,
  dimension text not null,
  sort_order integer not null,
  active boolean not null default true,
  constraint measurement_units_code_check
    check (code ~ '^[a-z][a-z0-9]*$' and char_length(code) <= 16),
  constraint measurement_units_label_check
    check (char_length(btrim(label)) between 1 and 80),
  constraint measurement_units_symbol_check
    check (char_length(btrim(symbol)) between 1 and 16),
  constraint measurement_units_dimension_check
    check (dimension in ('count', 'set', 'lump_sum', 'length', 'area', 'volume', 'mass', 'time', 'inch')),
  constraint measurement_units_sort_order_check
    check (sort_order >= 0)
);

comment on table public.measurement_units is
  'Global measurement unit referential (lot 2, D9). Generated from src/lib/units/units.json; ml is the linear metre and no millilitre exists (P-08). Read by authenticated, written by migrations only.';

create table public.measurement_unit_aliases (
  token text primary key,
  unit_code text references public.measurement_units (code) on update restrict on delete restrict,
  pricing_status public.estimate_line_pricing_status,
  constraint measurement_unit_aliases_token_check
    check (char_length(token) between 1 and 64 and token !~ '[A-Z[:space:].-]'),
  constraint measurement_unit_aliases_target_check
    check ((unit_code is null) <> (pricing_status is null)),
  constraint measurement_unit_aliases_status_check
    check (pricing_status is distinct from 'priced')
);

comment on table public.measurement_unit_aliases is
  'Normalized unit token to exactly one unit code or one line pricing status (lot 2, D9, P-09: HL, PM, NC, inc, incl, CP, SO). Generated from src/lib/units/units.json.';

create index measurement_unit_aliases_unit_code_idx
  on public.measurement_unit_aliases (unit_code);

alter table public.measurement_units enable row level security;
alter table public.measurement_unit_aliases enable row level security;

create policy "Authenticated users read measurement units"
  on public.measurement_units
  for select
  to authenticated
  using (true);

create policy "Authenticated users read measurement unit aliases"
  on public.measurement_unit_aliases
  for select
  to authenticated
  using (true);

revoke all on table public.measurement_units from public, anon, authenticated;
revoke all on table public.measurement_unit_aliases from public, anon, authenticated;
grant select on table public.measurement_units to authenticated;
grant select on table public.measurement_unit_aliases to authenticated;
grant select, insert, update, delete on table public.measurement_units to service_role;
grant select, insert, update, delete on table public.measurement_unit_aliases to service_role;

-- <units.json:data>
-- Généré par scripts/units/generate-units-sql.ts depuis src/lib/units/units.json : ne pas modifier à la main.
insert into public.measurement_units (code, label, symbol, dimension, sort_order, active)
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
insert into public.measurement_unit_aliases (token, unit_code, pricing_status)
values
  ('"', 'pouce', null),
  ('''''', 'pouce', null),
  ('compris', null, 'included'::public.estimate_line_pricing_status),
  ('cp', null, 'included'::public.estimate_line_pricing_status),
  ('ens', 'ens', null),
  ('ensemble', 'ens', null),
  ('ensembles', 'ens', null),
  ('fft', 'fft', null),
  ('forfait', 'fft', null),
  ('forfaits', 'fft', null),
  ('ft', 'fft', null),
  ('h', 'h', null),
  ('heure', 'h', null),
  ('heures', 'h', null),
  ('hl', null, 'out_of_scope'::public.estimate_line_pricing_status),
  ('horslot', null, 'out_of_scope'::public.estimate_line_pricing_status),
  ('inc', null, 'included'::public.estimate_line_pricing_status),
  ('inch', 'pouce', null),
  ('incl', null, 'included'::public.estimate_line_pricing_status),
  ('inclus', null, 'included'::public.estimate_line_pricing_status),
  ('j', 'j', null),
  ('jour', 'j', null),
  ('jours', 'j', null),
  ('kg', 'kg', null),
  ('kilo', 'kg', null),
  ('kilogramme', 'kg', null),
  ('kilogrammes', 'kg', null),
  ('kilos', 'kg', null),
  ('l', 'l', null),
  ('litre', 'l', null),
  ('litres', 'l', null),
  ('m', 'ml', null),
  ('m2', 'm2', null),
  ('m3', 'm3', null),
  ('metre', 'ml', null),
  ('metrecarre', 'm2', null),
  ('metrecube', 'm3', null),
  ('metrelineaire', 'ml', null),
  ('metres', 'ml', null),
  ('metrescarres', 'm2', null),
  ('metrescubes', 'm3', null),
  ('metreslineaires', 'ml', null),
  ('ml', 'ml', null),
  ('nc', null, 'not_priced'::public.estimate_line_pricing_status),
  ('nonchiffre', null, 'not_priced'::public.estimate_line_pricing_status),
  ('pc', 'u', null),
  ('pce', 'u', null),
  ('pcs', 'u', null),
  ('piece', 'u', null),
  ('pieces', 'u', null),
  ('pm', null, 'for_memory'::public.estimate_line_pricing_status),
  ('pouce', 'pouce', null),
  ('pouces', 'pouce', null),
  ('pourmemoire', null, 'for_memory'::public.estimate_line_pricing_status),
  ('sansobjet', null, 'not_applicable'::public.estimate_line_pricing_status),
  ('so', null, 'not_applicable'::public.estimate_line_pricing_status),
  ('t', 't', null),
  ('tonne', 't', null),
  ('tonnes', 't', null),
  ('u', 'u', null),
  ('unite', 'u', null),
  ('unites', 'u', null);
-- </units.json:data>

create function private.normalize_unit(
  p_raw text,
  out unit_code text,
  out pricing_status public.estimate_line_pricing_status
)
returns record
language sql
stable
parallel safe
set search_path = ''
as $$
  select alias.unit_code, alias.pricing_status
  from public.measurement_unit_aliases as alias
  left join public.measurement_units as unit on unit.code = alias.unit_code
  where alias.token = private.unit_token(p_raw)
    and (alias.pricing_status is not null or unit.active);
$$;

comment on function private.normalize_unit(text) is
  'Resolves a raw unit cell to an active unit code or a line pricing status (D9); both null when unknown, empty or null. Mirrors normalizeMeasurementUnit (src/lib/units/normalize.ts).';

revoke all on function private.unit_token(text) from public, anon, authenticated, service_role;
revoke all on function private.normalize_unit(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Arithmétique exacte (D13).
-- ---------------------------------------------------------------------------
create function private.estimate_round_half_up(p_value numeric)
returns bigint
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  rounded numeric;
begin
  if p_value < 0 then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('half-up rounding is defined for non-negative values (D13), got %s', p_value);
  end if;
  rounded := floor(p_value + 0.5);
  if rounded > 9223372036854775807 then
    raise exception using errcode = '22003', message = 'ESTIMATE_AMOUNT_OVERFLOW',
      detail = format('%s does not fit a bigint', rounded);
  end if;
  return rounded::bigint;
end;
$$;

create function private.estimate_round_half_up(p_value numeric, p_scale integer)
returns numeric
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  factor numeric;
begin
  if p_value < 0 or p_scale < 0 or p_scale > 12 then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('half-up rounding of %s at scale %s is not defined (D13)', p_value, p_scale);
  end if;
  factor := power(10::numeric, p_scale);
  return round(floor(p_value * factor + 0.5) / factor, p_scale);
end;
$$;

comment on function private.estimate_round_half_up(numeric) is
  'Round half up to the integer (D13): floor(x + 1/2) for x >= 0, the cent rounding of engine 3.';
comment on function private.estimate_round_half_up(numeric, integer) is
  'Round half up at a decimal scale (D13): hours at 3 decimals, realized coefficient at 6.';

-- Répartition au plus grand reste, ex aequo départagés par position (composants d'une ligne :
-- fo puis mo, atelier puis chantier). W = 0 : parts égales, le reste aux premières positions.
create function private.estimate_allocate_exact(p_amount bigint, p_weights numeric[])
returns bigint[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  weight_count integer := coalesce(cardinality(p_weights), 0);
  weight_total numeric;
  allocation bigint[];
begin
  if p_amount is null or p_amount < 0 or p_weights is null
    or array_position(p_weights, null) is not null
    or exists (select 1 from unnest(p_weights) as weight where weight < 0) then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'allocation needs a non-negative amount and non-negative, non-null weights';
  end if;
  if weight_count = 0 then
    if p_amount = 0 then
      return '{}'::bigint[];
    end if;
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('cannot allocate %s over no weight', p_amount);
  end if;
  weight_total := (select sum(weight) from unnest(p_weights) as weight);

  select array_agg(ranked.base + case when ranked.rank <= ranked.leftover then 1 else 0 end order by ranked.item_position)
  into allocation
  from (
    select
      parts.item_position,
      parts.base,
      row_number() over (order by parts.remainder desc, parts.item_position) as rank,
      p_amount - sum(parts.base) over () as leftover
    from (
      select
        entry.item_position,
        case when weight_total = 0 then p_amount / weight_count
          else div(p_amount * entry.weight, weight_total)::bigint end as base,
        case when weight_total = 0 then 0
          else mod(p_amount * entry.weight, weight_total) end as remainder
      from unnest(p_weights) with ordinality as entry(weight, item_position)
    ) as parts
  ) as ranked;
  return allocation;
end;
$$;

-- Même répartition, ex aequo départagés par clé uuid croissante (ordre uuid de PostgreSQL = ordre
-- lexical de l'hexadécimal en minuscules) : le résultat, rendu dans l'ordre d'entrée, ne dépend pas
-- de l'ordre d'affichage.
create function private.estimate_allocate_exact(p_amount bigint, p_weights numeric[], p_keys uuid[])
returns bigint[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  weight_count integer := coalesce(cardinality(p_weights), 0);
  weight_total numeric;
  allocation bigint[];
begin
  if p_amount is null or p_amount < 0 or p_weights is null or p_keys is null
    or array_position(p_weights, null) is not null
    or array_position(p_keys, null) is not null
    or cardinality(p_keys) <> weight_count
    or exists (select 1 from unnest(p_weights) as weight where weight < 0)
    or (select count(distinct key) from unnest(p_keys) as key) <> weight_count then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'allocation needs a non-negative amount, non-negative weights and as many distinct keys';
  end if;
  if weight_count = 0 then
    if p_amount = 0 then
      return '{}'::bigint[];
    end if;
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('cannot allocate %s over no weight', p_amount);
  end if;
  weight_total := (select sum(weight) from unnest(p_weights) as weight);

  select array_agg(ranked.base + case when ranked.rank <= ranked.leftover then 1 else 0 end order by ranked.item_position)
  into allocation
  from (
    select
      parts.item_position,
      parts.base,
      row_number() over (order by parts.remainder desc, parts.key) as rank,
      p_amount - sum(parts.base) over () as leftover
    from (
      select
        entry.item_position,
        entry.key,
        case when weight_total = 0 then p_amount / weight_count
          else div(p_amount * entry.weight, weight_total)::bigint end as base,
        case when weight_total = 0 then 0
          else mod(p_amount * entry.weight, weight_total) end as remainder
      from unnest(p_weights, p_keys) with ordinality as entry(weight, key, item_position)
    ) as parts
  ) as ranked;
  return allocation;
end;
$$;

comment on function private.estimate_allocate_exact(bigint, numeric[]) is
  'Exact largest-remainder allocation (D13), ties by position: part_i = floor(A w_i / W), leftover units to the largest remainders; W = 0 splits equally.';
comment on function private.estimate_allocate_exact(bigint, numeric[], uuid[]) is
  'Exact largest-remainder allocation (D13), ties by ascending uuid key; the result follows the input order and is stable under permutation.';

-- ---------------------------------------------------------------------------
-- 4. Moteur 3 pur (§4) : lecture stricte des entrées, ligne, devis.
-- ---------------------------------------------------------------------------
create type private.estimate_v3_params_input as (
  sale_coefficient_fo numeric,
  sale_coefficient_mo numeric,
  discount_amount_cents bigint,
  discount_bp integer,
  rounding_mode text,
  rounding_step_cents bigint,
  reverse_charge boolean,
  labor_split_enabled boolean
);

create type private.estimate_v3_item_input as (
  id uuid,
  item_type text,
  parent_id uuid,
  pricing_status text,
  tax_rate_bp integer,
  unit_code text,
  quantity numeric,
  unit_price_ht_cents numeric,
  k_fo numeric,
  h_mo_per_unit numeric,
  h_mo_atelier_per_unit numeric,
  h_mo_chantier_per_unit numeric,
  h_mo_majoration numeric,
  k_mo numeric,
  k_mo_atelier numeric,
  k_mo_chantier numeric,
  labor_rate_cents numeric,
  labor_rate_atelier_cents numeric,
  labor_rate_chantier_cents numeric
);

create type private.estimate_v3_line_gross as (
  id uuid,
  pricing_status text,
  tax_rate_bp integer,
  pu_ht_cents bigint,
  gross_ht_cents bigint,
  gross_fo_ht_cents bigint,
  gross_mo_ht_cents bigint,
  gross_mo_atelier_ht_cents bigint,
  gross_mo_chantier_ht_cents bigint,
  cost_ht_cents bigint,
  h_mo text,
  h_mo_atelier text,
  h_mo_chantier text
);

-- Nombre JSON exact, positif ou nul, au plus p_max et à au plus p_scale décimales (échelle de la
-- colonne). Absent ou null : p_default s'il est donné, sinon null si p_nullable, sinon refus.
create function private.estimate_v3_input_number(
  p_object jsonb,
  p_key text,
  p_scale integer,
  p_max numeric,
  p_default numeric,
  p_nullable boolean
)
returns numeric
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  raw_value jsonb := p_object -> p_key;
  number_value numeric;
begin
  if raw_value is null or jsonb_typeof(raw_value) = 'null' then
    if p_default is not null then
      return p_default;
    end if;
    if p_nullable then
      return null;
    end if;
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('%s is required', p_key);
  end if;
  if jsonb_typeof(raw_value) <> 'number' then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('%s must be a JSON number', p_key);
  end if;
  number_value := raw_value::numeric;
  if number_value < 0 or number_value > p_max or min_scale(number_value) > p_scale then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('%s = %s must lie in [0, %s] with at most %s decimals', p_key, number_value, p_max, p_scale);
  end if;
  return number_value;
end;
$$;

create function private.estimate_v3_amount(p_value numeric, p_field text)
returns bigint
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
begin
  if p_value > 2147483647 then
    raise exception using errcode = '22003', message = 'ESTIMATE_AMOUNT_OVERFLOW',
      detail = format('%s = %s exceeds 2147483647 cents and is never clamped', p_field, p_value);
  end if;
  return p_value::bigint;
end;
$$;

create function private.estimate_v3_read_params(p_params jsonb)
returns private.estimate_v3_params_input
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  params private.estimate_v3_params_input;
begin
  if jsonb_typeof(p_params) is distinct from 'object'
    or not (p_params ?& array[
      'sale_coefficient_fo', 'sale_coefficient_mo', 'discount_amount_cents', 'discount_bp',
      'rounding_mode', 'rounding_step_cents', 'reverse_charge', 'labor_split_enabled'
    ]) then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'params carry the eight keys of the canonical contract';
  end if;
  params.sale_coefficient_fo := private.estimate_v3_input_number(p_params, 'sale_coefficient_fo', 4, 10, null, false);
  params.sale_coefficient_mo := private.estimate_v3_input_number(p_params, 'sale_coefficient_mo', 4, 10, null, false);
  if params.sale_coefficient_fo = 0 or params.sale_coefficient_mo = 0 then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'sale coefficients lie in ]0, 10] (D5)';
  end if;
  params.discount_amount_cents := private.estimate_v3_input_number(p_params, 'discount_amount_cents', 0, 2147483647, null, true);
  params.discount_bp := private.estimate_v3_input_number(p_params, 'discount_bp', 0, 10000, null, false);
  if params.discount_amount_cents is not null and params.discount_bp <> 0 then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'a discount intent is an amount or a rate, never both (D6)';
  end if;
  if jsonb_typeof(p_params -> 'rounding_mode') is distinct from 'string'
    or (p_params ->> 'rounding_mode') not in ('none', 'down') then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'rounding_mode is none or down (D7)';
  end if;
  params.rounding_mode := p_params ->> 'rounding_mode';
  params.rounding_step_cents := private.estimate_v3_input_number(p_params, 'rounding_step_cents', 0, 2147483647, null, false);
  if params.rounding_mode = 'down' and params.rounding_step_cents < 1 then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'rounding down needs a step of at least 1 cent';
  end if;
  if jsonb_typeof(p_params -> 'reverse_charge') is distinct from 'boolean'
    or jsonb_typeof(p_params -> 'labor_split_enabled') is distinct from 'boolean' then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'reverse_charge and labor_split_enabled are JSON booleans';
  end if;
  params.reverse_charge := (p_params ->> 'reverse_charge')::boolean;
  params.labor_split_enabled := (p_params ->> 'labor_split_enabled')::boolean;
  return params;
end;
$$;

create function private.estimate_v3_read_item(p_item jsonb)
returns private.estimate_v3_item_input
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  item private.estimate_v3_item_input;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if jsonb_typeof(p_item) is distinct from 'object'
    or jsonb_typeof(p_item -> 'id') is distinct from 'string'
    or (p_item ->> 'id') !~ uuid_pattern
    or jsonb_typeof(p_item -> 'item_type') is distinct from 'string'
    or (p_item ->> 'item_type') not in ('section', 'line')
    or coalesce(jsonb_typeof(p_item -> 'parent_id'), 'null') not in ('null', 'string')
    or (jsonb_typeof(p_item -> 'parent_id') = 'string' and (p_item ->> 'parent_id') !~ uuid_pattern) then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'every item is an object with a uuid id, an item_type section or line and a null or uuid parent_id';
  end if;
  item.id := (p_item ->> 'id')::uuid;
  item.item_type := p_item ->> 'item_type';
  item.parent_id := (p_item ->> 'parent_id')::uuid;
  if item.item_type = 'section' then
    return item;
  end if;

  if jsonb_typeof(p_item -> 'pricing_status') is distinct from 'string'
    or (p_item ->> 'pricing_status') not in ('priced', 'included', 'for_memory', 'not_priced', 'out_of_scope', 'not_applicable')
    or coalesce(jsonb_typeof(p_item -> 'unit_code'), 'null') not in ('null', 'string') then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('line %s needs one of the six pricing statuses and a null or text unit_code', item.id);
  end if;
  item.pricing_status := p_item ->> 'pricing_status';
  item.unit_code := p_item ->> 'unit_code';
  item.tax_rate_bp := private.estimate_v3_input_number(p_item, 'tax_rate_bp', 0, 10000, null, false);
  item.quantity := private.estimate_v3_input_number(p_item, 'quantity', 3, 999999999.999, 0, false);
  item.unit_price_ht_cents := private.estimate_v3_input_number(p_item, 'unit_price_ht_cents', 0, 2147483647, 0, false);
  item.k_fo := private.estimate_v3_input_number(p_item, 'k_fo', 3, 999999999.999, 1, false);
  item.h_mo_per_unit := private.estimate_v3_input_number(p_item, 'h_mo_per_unit', 4, 99999999.9999, 0, false);
  item.h_mo_atelier_per_unit := private.estimate_v3_input_number(p_item, 'h_mo_atelier_per_unit', 4, 99999999.9999, 0, false);
  item.h_mo_chantier_per_unit := private.estimate_v3_input_number(p_item, 'h_mo_chantier_per_unit', 4, 99999999.9999, 0, false);
  item.h_mo_majoration := private.estimate_v3_input_number(p_item, 'h_mo_majoration', 4, 99999999.9999, 1, false);
  item.k_mo := private.estimate_v3_input_number(p_item, 'k_mo', 3, 999999999.999, 1, false);
  item.k_mo_atelier := private.estimate_v3_input_number(p_item, 'k_mo_atelier', 3, 999999999.999, 1, false);
  item.k_mo_chantier := private.estimate_v3_input_number(p_item, 'k_mo_chantier', 3, 999999999.999, 1, false);
  item.labor_rate_cents := private.estimate_v3_input_number(p_item, 'labor_rate_cents', 0, 2147483647, 0, false);
  item.labor_rate_atelier_cents := private.estimate_v3_input_number(p_item, 'labor_rate_atelier_cents', 0, 2147483647, null, true);
  item.labor_rate_chantier_cents := private.estimate_v3_input_number(p_item, 'labor_rate_chantier_cents', 0, 2147483647, null, true);
  return item;
end;
$$;

-- Ligne (§4, étapes 1 à 5) : PU = ⌈FO_u × c_FO + MO_u × c_MO⌋ (un seul arrondi), B = ⌈Q × PU⌋,
-- FO/MO bruts répartis selon (FO_u × c_FO, MO_u × c_MO), atelier/chantier selon (MO_at_u, MO_ch_u),
-- D = ⌈Q × (FO_u + MO_u)⌋, heures de ligne = round(Q × h/u, 3). Sans ventilation, toute la MO est
-- « chantier » (convention v2). Une ligne non chiffrée contribue 0 partout et n'a pas de PU.
create function private.estimate_v3_line_values(
  p_item private.estimate_v3_item_input,
  p_params private.estimate_v3_params_input
)
returns private.estimate_v3_line_gross
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  line private.estimate_v3_line_gross;
  uses_split boolean;
  fo_unit numeric;
  mo_atelier_unit numeric;
  mo_chantier_unit numeric;
  fo_weight numeric;
  mo_weight numeric;
  parts bigint[];
begin
  if p_item.item_type is distinct from 'line' then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'only a line is priced; a section carries no amount';
  end if;
  line.id := p_item.id;
  line.pricing_status := p_item.pricing_status;
  line.tax_rate_bp := p_item.tax_rate_bp;
  if p_item.pricing_status <> 'priced' then
    line.pu_ht_cents := null;
    line.gross_ht_cents := 0;
    line.gross_fo_ht_cents := 0;
    line.gross_mo_ht_cents := 0;
    line.gross_mo_atelier_ht_cents := 0;
    line.gross_mo_chantier_ht_cents := 0;
    line.cost_ht_cents := 0;
    line.h_mo := '0.000';
    line.h_mo_atelier := '0.000';
    line.h_mo_chantier := '0.000';
    return line;
  end if;

  uses_split := p_params.labor_split_enabled and (
    p_item.h_mo_atelier_per_unit > 0
    or p_item.labor_rate_atelier_cents is not null
    or p_item.h_mo_chantier_per_unit > 0
    or p_item.labor_rate_chantier_cents is not null
    or p_item.k_mo_atelier <> 1
    or p_item.k_mo_chantier <> 1
  );
  fo_unit := p_item.unit_price_ht_cents * p_item.k_fo;
  if uses_split then
    mo_atelier_unit := p_item.h_mo_majoration * p_item.h_mo_atelier_per_unit
      * coalesce(p_item.labor_rate_atelier_cents, 0) * p_item.k_mo_atelier;
    mo_chantier_unit := p_item.h_mo_majoration * p_item.h_mo_chantier_per_unit
      * coalesce(p_item.labor_rate_chantier_cents, 0) * p_item.k_mo_chantier;
  else
    mo_atelier_unit := 0;
    mo_chantier_unit := p_item.h_mo_majoration * p_item.h_mo_per_unit * p_item.labor_rate_cents * p_item.k_mo;
  end if;
  fo_weight := fo_unit * p_params.sale_coefficient_fo;
  mo_weight := (mo_atelier_unit + mo_chantier_unit) * p_params.sale_coefficient_mo;

  line.pu_ht_cents := private.estimate_v3_amount(private.estimate_round_half_up(fo_weight + mo_weight), 'pu_ht_cents');
  line.gross_ht_cents := private.estimate_v3_amount(
    private.estimate_round_half_up(p_item.quantity * line.pu_ht_cents), 'gross_ht_cents');
  parts := private.estimate_allocate_exact(line.gross_ht_cents, array[fo_weight, mo_weight]);
  line.gross_fo_ht_cents := parts[1];
  line.gross_mo_ht_cents := parts[2];
  parts := private.estimate_allocate_exact(line.gross_mo_ht_cents, array[mo_atelier_unit, mo_chantier_unit]);
  line.gross_mo_atelier_ht_cents := parts[1];
  line.gross_mo_chantier_ht_cents := parts[2];
  line.cost_ht_cents := private.estimate_v3_amount(
    private.estimate_round_half_up(p_item.quantity * (fo_unit + mo_atelier_unit + mo_chantier_unit)), 'cost_ht_cents');
  line.h_mo := private.estimate_round_half_up(p_item.quantity * p_item.h_mo_per_unit, 3)::text;
  line.h_mo_atelier := private.estimate_round_half_up(p_item.quantity * p_item.h_mo_atelier_per_unit, 3)::text;
  line.h_mo_chantier := private.estimate_round_half_up(p_item.quantity * p_item.h_mo_chantier_per_unit, 3)::text;
  return line;
end;
$$;

create function private.estimate_v3_line(p_item jsonb, p_params jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  return to_jsonb(private.estimate_v3_line_values(
    private.estimate_v3_read_item(p_item),
    private.estimate_v3_read_params(p_params)
  ));
end;
$$;

comment on function private.estimate_v3_line(jsonb, jsonb) is
  'Engine 3 gross line (§4 steps 1-5) from one canonical item and the canonical params: PU, gross, FO/MO and atelier/chantier gross parts, cost, line hours.';

-- Devis (§4, étapes 6 à 12) sur le JSON canonique partagé avec le moteur TS : toutes les entrées
-- sont validées avant tout calcul, puis brut, remise exclusive, arrondi commercial traité en remise,
-- nets répartis selon les bruts, TVA par taux sur la base nette, pied et coefficient réalisé.
create function private.estimate_v3_compute_items(p_items jsonb, p_params jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  params private.estimate_v3_params_input;
  item_json jsonb;
  item private.estimate_v3_item_input;
  line private.estimate_v3_line_gross;
  line_inputs private.estimate_v3_item_input[] := '{}';
  all_ids uuid[] := '{}';
  line_ids uuid[] := '{}';
  line_priced boolean[] := '{}';
  line_rates integer[] := '{}';
  line_pu bigint[] := '{}';
  line_gross bigint[] := '{}';
  line_gross_fo bigint[] := '{}';
  line_gross_mo bigint[] := '{}';
  line_gross_atelier bigint[] := '{}';
  line_gross_chantier bigint[] := '{}';
  line_cost bigint[] := '{}';
  line_h_mo text[] := '{}';
  line_h_atelier text[] := '{}';
  line_h_chantier text[] := '{}';
  line_reduction bigint[];
  line_net bigint[] := '{}';
  line_net_fo bigint[] := '{}';
  line_net_mo bigint[] := '{}';
  line_net_atelier bigint[] := '{}';
  line_net_chantier bigint[] := '{}';
  line_tax bigint[] := '{}';
  line_ttc bigint[] := '{}';
  line_count integer;
  line_index integer;
  member_index integer;
  parts bigint[];
  gross_total bigint;
  cost_total bigint;
  discount_applied bigint;
  commercial_rounding bigint;
  net_total bigint;
  tax_total bigint := 0;
  rate_bp integer;
  rate_base numeric;
  rate_tax bigint;
  group_positions integer[];
  group_nets numeric[];
  group_ids uuid[];
  tax_breakdown jsonb := '[]'::jsonb;
  realized_coefficient text;
  lines_json jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'items is a JSON array';
  end if;
  params := private.estimate_v3_read_params(p_params);

  for item_json in
    select entry.value from jsonb_array_elements(p_items) with ordinality as entry(value, item_position)
    order by entry.item_position
  loop
    item := private.estimate_v3_read_item(item_json);
    all_ids := array_append(all_ids, item.id);
    if item.item_type = 'line' then
      line_inputs := array_append(line_inputs, item);
    end if;
  end loop;
  if (select count(distinct entry_id) from unnest(all_ids) as entry_id) <> cardinality(all_ids) then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'item ids are unique';
  end if;

  foreach item in array line_inputs loop
    line := private.estimate_v3_line_values(item, params);
    line_ids := array_append(line_ids, line.id);
    line_priced := array_append(line_priced, line.pricing_status = 'priced');
    line_rates := array_append(line_rates, line.tax_rate_bp);
    line_pu := array_append(line_pu, line.pu_ht_cents);
    line_gross := array_append(line_gross, line.gross_ht_cents);
    line_gross_fo := array_append(line_gross_fo, line.gross_fo_ht_cents);
    line_gross_mo := array_append(line_gross_mo, line.gross_mo_ht_cents);
    line_gross_atelier := array_append(line_gross_atelier, line.gross_mo_atelier_ht_cents);
    line_gross_chantier := array_append(line_gross_chantier, line.gross_mo_chantier_ht_cents);
    line_cost := array_append(line_cost, line.cost_ht_cents);
    line_h_mo := array_append(line_h_mo, line.h_mo);
    line_h_atelier := array_append(line_h_atelier, line.h_mo_atelier);
    line_h_chantier := array_append(line_h_chantier, line.h_mo_chantier);
  end loop;
  line_count := cardinality(line_ids);

  gross_total := private.estimate_v3_amount(
    coalesce((select sum(value) from unnest(line_gross) as value), 0), 'gross_ht_cents');
  cost_total := private.estimate_v3_amount(
    coalesce((select sum(value) from unnest(line_cost) as value), 0), 'cost_subtotal_cents');
  if params.discount_amount_cents is not null then
    discount_applied := least(params.discount_amount_cents, gross_total);
  else
    discount_applied := least(div(2::numeric * gross_total * params.discount_bp + 10000, 20000)::bigint, gross_total);
  end if;
  commercial_rounding := case
    when params.rounding_mode = 'down' then (gross_total - discount_applied) % params.rounding_step_cents
    else 0
  end;
  net_total := gross_total - discount_applied - commercial_rounding;

  line_reduction := private.estimate_allocate_exact(discount_applied + commercial_rounding, line_gross::numeric[], line_ids);
  for line_index in 1..line_count loop
    line_net := array_append(line_net, line_gross[line_index] - line_reduction[line_index]);
    parts := private.estimate_allocate_exact(
      line_net[line_index], array[line_gross_fo[line_index], line_gross_mo[line_index]]::numeric[]);
    line_net_fo := array_append(line_net_fo, parts[1]);
    line_net_mo := array_append(line_net_mo, parts[2]);
    parts := private.estimate_allocate_exact(
      parts[2], array[line_gross_atelier[line_index], line_gross_chantier[line_index]]::numeric[]);
    line_net_atelier := array_append(line_net_atelier, parts[1]);
    line_net_chantier := array_append(line_net_chantier, parts[2]);
    line_tax := array_append(line_tax, 0::bigint);
  end loop;

  for rate_bp in
    select distinct entry.rate from unnest(line_rates, line_priced) as entry(rate, priced)
    where entry.priced
    order by entry.rate
  loop
    select
      array_agg(entry.item_position::integer order by entry.item_position),
      array_agg(entry.net order by entry.item_position),
      array_agg(entry.id order by entry.item_position),
      coalesce(sum(entry.net), 0)
    into group_positions, group_nets, group_ids, rate_base
    from unnest(line_net, line_ids, line_rates, line_priced) with ordinality
      as entry(net, id, rate, priced, item_position)
    where entry.priced and entry.rate = rate_bp;
    rate_tax := case
      when params.reverse_charge then 0
      else private.estimate_v3_amount(div(2 * rate_base * rate_bp + 10000, 20000), 'total_tax_cents')
    end;
    parts := private.estimate_allocate_exact(rate_tax, group_nets, group_ids);
    for member_index in 1..cardinality(group_positions) loop
      line_tax[group_positions[member_index]] := parts[member_index];
    end loop;
    tax_total := private.estimate_v3_amount(tax_total::numeric + rate_tax, 'total_tax_cents');
    tax_breakdown := tax_breakdown || jsonb_build_array(jsonb_build_object(
      'rate_bp', rate_bp, 'base_cents', rate_base, 'tax_cents', rate_tax));
  end loop;

  for line_index in 1..line_count loop
    line_ttc := array_append(line_ttc, private.estimate_v3_amount(
      line_net[line_index]::numeric + line_tax[line_index], 'line_total_ttc_cents'));
  end loop;
  perform private.estimate_v3_amount(net_total::numeric + tax_total, 'total_ttc_cents');

  if cost_total = 0 then
    realized_coefficient := case when net_total = 0 then '1.000000' end;
  else
    realized_coefficient := round(
      div(2::numeric * net_total * 1000000 + cost_total, 2::numeric * cost_total) / 1000000, 6)::text;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', entry.id,
      'pu_ht_cents', entry.pu,
      'gross_ht_cents', entry.gross,
      'gross_fo_ht_cents', entry.gross_fo,
      'gross_mo_ht_cents', entry.gross_mo,
      'gross_mo_atelier_ht_cents', entry.gross_atelier,
      'gross_mo_chantier_ht_cents', entry.gross_chantier,
      'cost_ht_cents', entry.cost,
      'reduction_cents', entry.reduction,
      'line_total_ht_cents', entry.net,
      'snapshot_fo_ht_cents', entry.net_fo,
      'snapshot_mo_ht_cents', entry.net_mo,
      'snapshot_mo_atelier_ht_cents', entry.net_atelier,
      'snapshot_mo_chantier_ht_cents', entry.net_chantier,
      'line_tax_cents', entry.tax,
      'line_total_ttc_cents', entry.ttc,
      'h_mo', entry.h_mo,
      'h_mo_atelier', entry.h_atelier,
      'h_mo_chantier', entry.h_chantier
    ) order by entry.item_position), '[]'::jsonb)
  into lines_json
  from unnest(
    line_ids, line_pu, line_gross, line_gross_fo, line_gross_mo, line_gross_atelier, line_gross_chantier,
    line_cost, line_reduction, line_net, line_net_fo, line_net_mo, line_net_atelier, line_net_chantier,
    line_tax, line_ttc, line_h_mo, line_h_atelier, line_h_chantier
  ) with ordinality as entry(
    id, pu, gross, gross_fo, gross_mo, gross_atelier, gross_chantier,
    cost, reduction, net, net_fo, net_mo, net_atelier, net_chantier,
    tax, ttc, h_mo, h_atelier, h_chantier, item_position
  );

  return jsonb_build_object(
    'lines', lines_json,
    'totals', jsonb_build_object(
      'gross_ht_cents', gross_total,
      'discount_applied_cents', discount_applied,
      'commercial_rounding_cents', commercial_rounding,
      'total_ht_cents', net_total,
      'total_tax_cents', tax_total,
      'total_ttc_cents', net_total + tax_total,
      'rounding_adjustment_cents', 0,
      'cost_subtotal_cents', cost_total,
      'realized_sale_coefficient', realized_coefficient,
      'tax_breakdown', tax_breakdown
    )
  );
end;
$$;

comment on function private.estimate_v3_compute_items(jsonb, jsonb) is
  'Engine 3 full computation (§4) on the canonical items/params JSON shared with the TS engine; returns {lines, totals}. Pure: reads no row. Errors: ESTIMATE_V3_INPUT_INVALID (22023), ESTIMATE_AMOUNT_OVERFLOW (22003).';

revoke all on function private.estimate_round_half_up(numeric) from public, anon, authenticated, service_role;
revoke all on function private.estimate_round_half_up(numeric, integer) from public, anon, authenticated, service_role;
revoke all on function private.estimate_allocate_exact(bigint, numeric[]) from public, anon, authenticated, service_role;
revoke all on function private.estimate_allocate_exact(bigint, numeric[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_input_number(jsonb, text, integer, numeric, numeric, boolean) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_amount(numeric, text) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_read_params(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_read_item(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_line_values(private.estimate_v3_item_input, private.estimate_v3_params_input) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_line(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_compute_items(jsonb, jsonb) from public, anon, authenticated, service_role;
