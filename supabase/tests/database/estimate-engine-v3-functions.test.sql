-- Lot 2, sous-lot 2.4 (piste B) : jumeau SQL pur du moteur de calcul 3 (migration M3).
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md, §4 (contrat),
-- §5 (oracle, scénarios, cas d'exigence ; tolérance 0 c), D7, D8, D12, D13.
-- Défaillances visées : docs/testing/estimate-engine-v3-2.4.md (F1 à F16).
--
-- Écrite rouge avant M3 : les fonctions private.estimate_round_half_up, estimate_allocate_exact,
-- estimate_v3_line et estimate_v3_compute_items n'existent pas encore.
-- Les nombres de l'oracle viennent seuls de reproductions/d4/D4-extraits.json (aucune désignation) ;
-- tous les attendus sont ceux de la conception (§5.1 à §5.3), sauf les coefficients réalisés des
-- scénarios S1 à S5, dérivés exactement de N / Σ D (demi supérieur à 6 décimales).
-- Les fonctions calculent sur des paramètres : la suite n'insère aucune ligne de devis.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Aides : JSON canonique d'entrée (contrat partagé TS/SQL) et lecture de la sortie.
-- ---------------------------------------------------------------------------
create function pg_temp.uid(p_position integer)
returns uuid
language sql
immutable
as $$ select format('00000000-0000-4000-8000-%s', lpad(p_position::text, 12, '0'))::uuid $$;

create function pg_temp.v3_params(
  p_sale_coefficient_fo numeric,
  p_sale_coefficient_mo numeric,
  p_discount_amount_cents bigint default null,
  p_discount_bp integer default 0,
  p_rounding_mode text default 'none',
  p_rounding_step_cents integer default 1,
  p_reverse_charge boolean default false,
  p_labor_split_enabled boolean default false
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'sale_coefficient_fo', p_sale_coefficient_fo,
    'sale_coefficient_mo', p_sale_coefficient_mo,
    'discount_amount_cents', p_discount_amount_cents,
    'discount_bp', p_discount_bp,
    'rounding_mode', p_rounding_mode,
    'rounding_step_cents', p_rounding_step_cents,
    'reverse_charge', p_reverse_charge,
    'labor_split_enabled', p_labor_split_enabled
  )
$$;

create function pg_temp.v3_line(
  p_id uuid,
  p_quantity numeric,
  p_unit_price_ht_cents bigint,
  p_h_mo_per_unit numeric default null,
  p_labor_rate_cents bigint default null,
  p_tax_rate_bp integer default 2000,
  p_pricing_status text default 'priced',
  p_unit_code text default 'u',
  p_k_fo numeric default 1,
  p_k_mo numeric default 1,
  p_h_mo_majoration numeric default 1
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_id,
    'item_type', 'line',
    'parent_id', null,
    'quantity', p_quantity,
    'unit_price_ht_cents', p_unit_price_ht_cents,
    'k_fo', p_k_fo,
    'h_mo_per_unit', p_h_mo_per_unit,
    'h_mo_atelier_per_unit', null,
    'h_mo_chantier_per_unit', null,
    'h_mo_majoration', p_h_mo_majoration,
    'k_mo', p_k_mo,
    'k_mo_atelier', null,
    'k_mo_chantier', null,
    'labor_rate_cents', p_labor_rate_cents,
    'labor_rate_atelier_cents', null,
    'labor_rate_chantier_cents', null,
    'pricing_status', p_pricing_status,
    'tax_rate_bp', p_tax_rate_bp,
    'unit_code', p_unit_code
  )
$$;

create function pg_temp.v3_lines(p_result jsonb)
returns table (
  id uuid,
  pu_ht_cents bigint,
  gross_ht_cents bigint,
  gross_fo_ht_cents bigint,
  gross_mo_ht_cents bigint,
  gross_mo_atelier_ht_cents bigint,
  gross_mo_chantier_ht_cents bigint,
  cost_ht_cents bigint,
  reduction_cents bigint,
  line_total_ht_cents bigint,
  snapshot_fo_ht_cents bigint,
  snapshot_mo_ht_cents bigint,
  snapshot_mo_atelier_ht_cents bigint,
  snapshot_mo_chantier_ht_cents bigint,
  line_tax_cents bigint,
  line_total_ttc_cents bigint,
  h_mo text,
  h_mo_atelier text,
  h_mo_chantier text
)
language sql
immutable
as $$
  select *
  from jsonb_to_recordset(p_result -> 'lines') as line(
    id uuid,
    pu_ht_cents bigint,
    gross_ht_cents bigint,
    gross_fo_ht_cents bigint,
    gross_mo_ht_cents bigint,
    gross_mo_atelier_ht_cents bigint,
    gross_mo_chantier_ht_cents bigint,
    cost_ht_cents bigint,
    reduction_cents bigint,
    line_total_ht_cents bigint,
    snapshot_fo_ht_cents bigint,
    snapshot_mo_ht_cents bigint,
    snapshot_mo_atelier_ht_cents bigint,
    snapshot_mo_chantier_ht_cents bigint,
    line_tax_cents bigint,
    line_total_ttc_cents bigint,
    h_mo text,
    h_mo_atelier text,
    h_mo_chantier text
  )
$$;

create function pg_temp.v3_totals(
  p_gross_ht_cents bigint,
  p_discount_applied_cents bigint,
  p_commercial_rounding_cents bigint,
  p_total_ht_cents bigint,
  p_total_tax_cents bigint,
  p_total_ttc_cents bigint,
  p_cost_subtotal_cents bigint,
  p_realized_sale_coefficient text,
  p_tax_breakdown jsonb
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'gross_ht_cents', p_gross_ht_cents,
    'discount_applied_cents', p_discount_applied_cents,
    'commercial_rounding_cents', p_commercial_rounding_cents,
    'total_ht_cents', p_total_ht_cents,
    'total_tax_cents', p_total_tax_cents,
    'total_ttc_cents', p_total_ttc_cents,
    'rounding_adjustment_cents', 0,
    'cost_subtotal_cents', p_cost_subtotal_cents,
    'realized_sale_coefficient', p_realized_sale_coefficient,
    'tax_breakdown', p_tax_breakdown
  )
$$;

-- Invariants du §4, vérifiés sur une sortie complète : Σ nets = HT, 0 ≤ net ≤ brut, parts FO/MO et
-- atelier/chantier exactes, Σ TVA de ligne = T_r par taux, TTC = HT + TVA.
create function pg_temp.v3_invariant_failures(p_result jsonb)
returns text
language sql
immutable
as $$
  select concat_ws('; ',
    case when (select coalesce(sum(line.line_total_ht_cents), 0) from pg_temp.v3_lines(p_result) as line)
      <> (p_result -> 'totals' ->> 'total_ht_cents')::bigint then 'sum of nets <> total_ht' end,
    case when (select coalesce(sum(line.gross_ht_cents), 0) from pg_temp.v3_lines(p_result) as line)
      <> (p_result -> 'totals' ->> 'gross_ht_cents')::bigint then 'sum of gross <> gross_ht' end,
    case when (select coalesce(sum(line.reduction_cents), 0) from pg_temp.v3_lines(p_result) as line)
      <> (p_result -> 'totals' ->> 'discount_applied_cents')::bigint
        + (p_result -> 'totals' ->> 'commercial_rounding_cents')::bigint then 'sum of reductions <> R + A' end,
    case when (select coalesce(sum(line.cost_ht_cents), 0) from pg_temp.v3_lines(p_result) as line)
      <> (p_result -> 'totals' ->> 'cost_subtotal_cents')::bigint then 'sum of costs <> cost_subtotal' end,
    case when (select coalesce(sum(line.line_tax_cents), 0) from pg_temp.v3_lines(p_result) as line)
      <> (p_result -> 'totals' ->> 'total_tax_cents')::bigint then 'sum of line taxes <> total_tax' end,
    case when (p_result -> 'totals' ->> 'total_ttc_cents')::bigint
      <> (p_result -> 'totals' ->> 'total_ht_cents')::bigint + (p_result -> 'totals' ->> 'total_tax_cents')::bigint
      then 'ttc <> ht + tax' end,
    case when (select coalesce(sum((entry ->> 'tax_cents')::bigint), 0) from jsonb_array_elements(p_result -> 'totals' -> 'tax_breakdown') as entry)
      <> (p_result -> 'totals' ->> 'total_tax_cents')::bigint then 'breakdown tax <> total_tax' end,
    case when (select coalesce(sum((entry ->> 'base_cents')::bigint), 0) from jsonb_array_elements(p_result -> 'totals' -> 'tax_breakdown') as entry)
      <> (p_result -> 'totals' ->> 'total_ht_cents')::bigint then 'breakdown bases <> total_ht' end,
    (
      select string_agg(format('line %s: %s', line.id, problem), ', ')
      from pg_temp.v3_lines(p_result) as line
      cross join lateral (values
        (case when line.line_total_ht_cents < 0 or line.line_total_ht_cents > line.gross_ht_cents then 'net out of [0, gross]' end),
        (case when line.gross_fo_ht_cents + line.gross_mo_ht_cents <> line.gross_ht_cents then 'gross fo + mo <> gross' end),
        (case when line.gross_mo_atelier_ht_cents + line.gross_mo_chantier_ht_cents <> line.gross_mo_ht_cents then 'gross atelier + chantier <> gross mo' end),
        (case when line.snapshot_fo_ht_cents + line.snapshot_mo_ht_cents <> line.line_total_ht_cents then 'net fo + mo <> net' end),
        (case when line.snapshot_mo_atelier_ht_cents + line.snapshot_mo_chantier_ht_cents <> line.snapshot_mo_ht_cents then 'net atelier + chantier <> net mo' end),
        (case when line.gross_ht_cents - line.reduction_cents <> line.line_total_ht_cents then 'gross - reduction <> net' end),
        (case when line.line_total_ht_cents + line.line_tax_cents <> line.line_total_ttc_cents then 'net + tax <> ttc' end)
      ) as check_row(problem)
      where problem is not null
    )
  )
$$;

-- Lignes-oracle O1 à O7 (§5.1) : nombres seuls de D4-extraits.json ; taux 40 €/h, k = maj = 1.
create temporary table v3_oracle (
  position integer primary key,
  quantity numeric not null,
  unit_price_ht_cents bigint not null,
  h_mo_per_unit numeric not null,
  unit_code text not null,
  pu_130_120 bigint not null,
  total_130_120 bigint not null,
  cost bigint not null,
  pu_130_130 bigint not null
) on commit drop;

insert into v3_oracle values
  (1, 20, 5466, 1.991, 'ml', 16663, 333260, 268600, 17459),
  (2, 3, 9563, 1.75, 'u', 20832, 62496, 49689, 21532),
  (3, 21, 5850, 0, 'm2', 7605, 159705, 122850, 7605),
  (4, 1139, 302, 0.2, 'ml', 1353, 1541067, 1255178, 1433),
  (5, 1, 2000, 6, 'u', 31400, 31400, 26000, 33800),
  (6, 282, 9186, 0.998, 'ml', 16732, 4718424, 3716196, 17131),
  (7, 8, 883, 1.30, 'ml', 7388, 59104, 48664, 7908);

create function pg_temp.oracle_items(p_low_rate_bp integer default 2000)
returns jsonb
language sql
stable
as $$
  select jsonb_agg(
    pg_temp.v3_line(
      pg_temp.uid(oracle.position),
      oracle.quantity,
      oracle.unit_price_ht_cents,
      oracle.h_mo_per_unit,
      4000,
      case when oracle.position <= 3 then p_low_rate_bp else 2000 end,
      'priced',
      oracle.unit_code
    )
    order by oracle.position
  )
  from v3_oracle as oracle
$$;

-- ---------------------------------------------------------------------------
-- F15 : fonctions présentes, pures, privées.
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure(signature) is not null,
  format('M3 defines %s', signature)
)
from unnest(array[
  'private.estimate_round_half_up(numeric)',
  'private.estimate_round_half_up(numeric,integer)',
  'private.estimate_allocate_exact(bigint,numeric[])',
  'private.estimate_allocate_exact(bigint,numeric[],uuid[])',
  'private.estimate_v3_line(jsonb,jsonb)',
  'private.estimate_v3_compute_items(jsonb,jsonb)'
]) as signature;

select ok(
  not has_function_privilege(role_name, procedure.oid, 'EXECUTE'),
  format('F15 %s cannot execute %s', role_name, procedure.oid::regprocedure)
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
cross join unnest(array['public', 'anon', 'authenticated', 'service_role']) as role_name
where namespace.nspname = 'private'
  and (procedure.proname like 'estimate\_v3\_%' or procedure.proname in ('estimate_round_half_up', 'estimate_allocate_exact'));

select ok(
  procedure.proconfig @> array['search_path=""'] and not procedure.prosecdef and procedure.provolatile = 'i',
  format('F15 %s is immutable, invoker and pins an empty search_path', procedure.oid::regprocedure)
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and (procedure.proname like 'estimate\_v3\_%' or procedure.proname in ('estimate_round_half_up', 'estimate_allocate_exact'));

-- ---------------------------------------------------------------------------
-- F1 : arrondi au demi supérieur, en décimal exact (D13).
-- ---------------------------------------------------------------------------
select is(private.estimate_round_half_up(0.5), 1::bigint, 'F1 0.5 rounds up to 1');
select is(private.estimate_round_half_up(1.5), 2::bigint, 'F1 1.5 rounds up to 2');
select is(private.estimate_round_half_up(2.5), 3::bigint, 'F1 2.5 rounds up to 3 (not to even)');
select is(private.estimate_round_half_up(100.4999999), 100::bigint, 'F1 100.4999999 rounds down to 100');
select is(private.estimate_round_half_up(0), 0::bigint, 'F1 0 stays 0');
select is(private.estimate_round_half_up(1.005 * 100), 101::bigint, 'F1 T-HALF3 1.005 x 100 rounds to 101');
select is(private.estimate_round_half_up(39.8195, 3)::text, '39.820', 'F1 39.8195 rounds to 39.820 at 3 decimals');
select is(private.estimate_round_half_up(1.2584715, 6)::text, '1.258472', 'F1 1.2584715 rounds to 1.258472 at 6 decimals');
select is(private.estimate_round_half_up(0.0005, 3)::text, '0.001', 'F1 0.0005 rounds to 0.001');
select throws_ok(
  'select private.estimate_round_half_up(-0.5)',
  '22023',
  'ESTIMATE_V3_INPUT_INVALID',
  'F12 a negative value is refused'
);

-- ---------------------------------------------------------------------------
-- F6 : répartition exacte au plus grand reste (D13).
-- ---------------------------------------------------------------------------
select is(
  private.estimate_allocate_exact(
    101,
    array[333260, 62496, 159705, 1541067, 31400, 4718424, 59104]::numeric[],
    array(select pg_temp.uid(position) from generate_series(1, 7) as position)
  ),
  array[5, 1, 2, 23, 0, 69, 1]::bigint[],
  'F6 S5 allocates the 101 c discount as [5, 1, 2, 23, 0, 69, 1]'
);
select is(
  private.estimate_allocate_exact(
    101,
    array[59104, 4718424, 31400, 1541067, 159705, 62496, 333260]::numeric[],
    array(select pg_temp.uid(position) from generate_series(7, 1, -1) as position)
  ),
  array[1, 69, 0, 23, 2, 1, 5]::bigint[],
  'F6 the allocation follows the keys, not the input order'
);
select is(
  private.estimate_allocate_exact(5, array[0, 0, 0]::numeric[], array[pg_temp.uid(3), pg_temp.uid(1), pg_temp.uid(2)]),
  array[1, 2, 2]::bigint[],
  'F6 W = 0 splits equally, the remainder going to the smallest keys'
);
select is(
  private.estimate_allocate_exact(1, array[1, 1]::numeric[], array[pg_temp.uid(2), pg_temp.uid(1)]),
  array[0, 1]::bigint[],
  'F6 a tie goes to the smallest uuid, whatever the display order'
);
select is(
  private.estimate_allocate_exact(1, array[1, 1]::numeric[]),
  array[1, 0]::bigint[],
  'F6 the index-keyed variant breaks a tie by position (fo before mo)'
);
select is(
  private.estimate_allocate_exact(3, array[0, 0]::numeric[]),
  array[2, 1]::bigint[],
  'F6 the index-keyed variant splits W = 0 equally, remainder first'
);
select is(
  private.estimate_allocate_exact(10, array[0.5, 1.5]::numeric[]),
  array[3, 7]::bigint[],
  'F6 decimal weights: 2.5 / 7.5, tied remainders resolved by position'
);
select is(
  private.estimate_allocate_exact(0, '{}'::numeric[], '{}'::uuid[]),
  '{}'::bigint[],
  'F6 nothing to allocate over nothing'
);

create function pg_temp.allocation_property_failures(p_draws integer)
returns text
language plpgsql
as $$
declare
  draw integer;
  item_count integer;
  amount bigint;
  weights numeric[];
  keys uuid[];
  allocation bigint[];
  permuted bigint[];
  weight_total numeric;
  failures text[] := '{}';
begin
  perform setseed(0.24);
  for draw in 1..p_draws loop
    item_count := 1 + floor(random() * 12)::integer;
    amount := floor(random() * 1000000)::bigint;
    select
      array_agg(case when random() < 0.2 then 0 else round((random() * 100000)::numeric, floor(random() * 5)::integer) end order by position),
      array_agg(md5(random()::text)::uuid order by position)
    into weights, keys
    from generate_series(1, item_count) as position;

    allocation := private.estimate_allocate_exact(amount, weights, keys);
    if (select sum(part) from unnest(allocation) as part) is distinct from amount::numeric then
      failures := failures || format('draw %s: sum', draw);
    end if;
    weight_total := (select sum(weight) from unnest(weights) as weight);
    if weight_total > 0 and exists (
      select 1
      from unnest(allocation, weights) as pair(part, weight)
      where pair.part < div(amount * pair.weight, weight_total)
        or pair.part > div(amount * pair.weight, weight_total) + 1
    ) then
      failures := failures || format('draw %s: part outside [floor, floor + 1]', draw);
    end if;
    permuted := private.estimate_allocate_exact(
      amount,
      array(select weights[position] from generate_series(item_count, 1, -1) as position),
      array(select keys[position] from generate_series(item_count, 1, -1) as position)
    );
    if array(select permuted[position] from generate_series(item_count, 1, -1) as position) is distinct from allocation then
      failures := failures || format('draw %s: permutation changed the allocation', draw);
    end if;
  end loop;
  return array_to_string(failures, '; ');
end;
$$;

select is(
  pg_temp.allocation_property_failures(1000),
  '',
  'F6 1 000 seeded draws: exact sum, parts within [floor, floor + 1], stable under permutation'
);

select throws_ok(
  'select private.estimate_allocate_exact(null::bigint, array[1]::numeric[], array[gen_random_uuid()])',
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses a null amount'
);
select throws_ok(
  'select private.estimate_allocate_exact(-1, array[1]::numeric[], array[gen_random_uuid()])',
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses a negative amount'
);
select throws_ok(
  'select private.estimate_allocate_exact(1, array[-1, 2]::numeric[], array[gen_random_uuid(), gen_random_uuid()])',
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses a negative weight'
);
select throws_ok(
  'select private.estimate_allocate_exact(1, array[1, null]::numeric[], array[gen_random_uuid(), gen_random_uuid()])',
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses a null weight'
);
select throws_ok(
  'select private.estimate_allocate_exact(1, array[1, 2]::numeric[], array[gen_random_uuid()])',
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses weights and keys of different lengths'
);
select throws_ok(
  $$select private.estimate_allocate_exact(1, array[1, 2]::numeric[], array['00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid])$$,
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses duplicate keys'
);
select throws_ok(
  'select private.estimate_allocate_exact(1, array[1, 2]::numeric[], array[gen_random_uuid(), null])',
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses a null key'
);
select throws_ok(
  $$select private.estimate_allocate_exact(5, '{}'::numeric[], '{}'::uuid[])$$,
  '22023', 'ESTIMATE_V3_INPUT_INVALID', 'F12 allocation refuses a positive amount over no weight'
);

-- ---------------------------------------------------------------------------
-- F2, F3 : PU des lignes-oracle par private.estimate_v3_line (§5.1).
-- ---------------------------------------------------------------------------
select is(
  (
    select array_agg((private.estimate_v3_line(item, pg_temp.v3_params(1.30, 1.20)) ->> 'pu_ht_cents')::bigint order by ordinality)
    from jsonb_array_elements(pg_temp.oracle_items()) with ordinality as entry(item, ordinality)
  ),
  (select array_agg(oracle.pu_130_120 order by oracle.position) from v3_oracle as oracle),
  'F2 O1-O7 PU at 1.30 / 1.20: 16 663, 20 832, 7 605, 1 353, 31 400, 16 732, 7 388 c'
);
select is(
  (
    select array_agg((private.estimate_v3_line(item, pg_temp.v3_params(1.3, 1.3)) ->> 'pu_ht_cents')::bigint order by ordinality)
    from jsonb_array_elements(pg_temp.oracle_items()) with ordinality as entry(item, ordinality)
  ),
  (select array_agg(oracle.pu_130_130 order by oracle.position) from v3_oracle as oracle),
  'F2 O1-O7 PU at 1.3 / 1.3: 17 459, 21 532, 7 605, 1 433, 33 800, 17 131, 7 908 c'
);
select is(
  (
    select array_agg((private.estimate_v3_line(item, pg_temp.v3_params(1.30, 1.20)) ->> 'gross_ht_cents')::bigint order by ordinality)
    from jsonb_array_elements(pg_temp.oracle_items()) with ordinality as entry(item, ordinality)
  ),
  (select array_agg(oracle.total_130_120 order by oracle.position) from v3_oracle as oracle),
  'F3 O1-O7 gross = Q x PU: 333 260, 62 496, 159 705, 1 541 067, 31 400, 4 718 424, 59 104 c'
);
select is(
  (
    select array_agg((private.estimate_v3_line(item, pg_temp.v3_params(1.30, 1.20)) ->> 'cost_ht_cents')::bigint order by ordinality)
    from jsonb_array_elements(pg_temp.oracle_items()) with ordinality as entry(item, ordinality)
  ),
  (select array_agg(oracle.cost order by oracle.position) from v3_oracle as oracle),
  'F3 O1-O7 cost = Q x (FO_u + MO_u): 268 600, 49 689, 122 850, 1 255 178, 26 000, 3 716 196, 48 664 c'
);

-- ---------------------------------------------------------------------------
-- Scénarios S1 à S5 (§5.2) par private.estimate_v3_compute_items.
-- ---------------------------------------------------------------------------
create temporary table v3_results (
  name text primary key,
  result jsonb not null
) on commit drop;

insert into v3_results (name, result)
values
  ('S1', private.estimate_v3_compute_items(pg_temp.oracle_items(), pg_temp.v3_params(1.30, 1.20))),
  ('S2', private.estimate_v3_compute_items(pg_temp.oracle_items(), pg_temp.v3_params(1.30, 1.20, 101))),
  ('S3', private.estimate_v3_compute_items(pg_temp.oracle_items(), pg_temp.v3_params(1.30, 1.20, null, 1000))),
  ('S4', private.estimate_v3_compute_items(pg_temp.oracle_items(), pg_temp.v3_params(1.30, 1.20, 101, 0, 'down', 10000))),
  ('S5', private.estimate_v3_compute_items(pg_temp.oracle_items(1000), pg_temp.v3_params(1.30, 1.20, 101))),
  ('S1-reverse-charge', private.estimate_v3_compute_items(pg_temp.oracle_items(), pg_temp.v3_params(1.30, 1.20, null, 0, 'none', 1, true)));

select is(
  (select result -> 'totals' from v3_results where name = 'S1'),
  pg_temp.v3_totals(6905456, 0, 0, 6905456, 1381091, 8286547, 5487177, '1.258472',
    '[{"rate_bp": 2000, "base_cents": 6905456, "tax_cents": 1381091}]'),
  'S1 no discount: HT 6 905 456, VAT 1 381 091, TTC 8 286 547, cost 5 487 177'
);
select is(
  (select result -> 'totals' from v3_results where name = 'S2'),
  pg_temp.v3_totals(6905456, 101, 0, 6905355, 1381071, 8286426, 5487177, '1.258453',
    '[{"rate_bp": 2000, "base_cents": 6905355, "tax_cents": 1381071}]'),
  'S2 discount 1.01 EUR: HT 6 905 355, VAT 1 381 071, TTC 8 286 426'
);
select is(
  (select result -> 'totals' from v3_results where name = 'S3'),
  pg_temp.v3_totals(6905456, 690546, 0, 6214910, 1242982, 7457892, 5487177, '1.132624',
    '[{"rate_bp": 2000, "base_cents": 6214910, "tax_cents": 1242982}]'),
  'S3 discount 10 %: 690 546, HT 6 214 910, VAT 1 242 982, TTC 7 457 892'
);
select is(
  (select result -> 'totals' from v3_results where name = 'S4'),
  pg_temp.v3_totals(6905456, 101, 5355, 6900000, 1380000, 8280000, 5487177, '1.257477',
    '[{"rate_bp": 2000, "base_cents": 6900000, "tax_cents": 1380000}]'),
  'S4 commercial rounding down to 100 EUR: 5 355, HT 6 900 000, VAT 1 380 000, TTC 8 280 000'
);
select is(
  (select result -> 'totals' from v3_results where name = 'S5'),
  pg_temp.v3_totals(6905456, 101, 0, 6905355, 1325525, 8230880, 5487177, '1.258453',
    '[{"rate_bp": 1000, "base_cents": 555453, "tax_cents": 55545}, {"rate_bp": 2000, "base_cents": 6349902, "tax_cents": 1269980}]'),
  'S5 per-rate VAT: 55 545 + 1 269 980 = 1 325 525 (not 1 325 527), TTC 8 230 880'
);
select is(
  (select array_agg(line.reduction_cents order by line.id) from v3_results, pg_temp.v3_lines(result) as line where name = 'S5'),
  array[5, 1, 2, 23, 0, 69, 1]::bigint[],
  'S5 line reductions [5, 1, 2, 23, 0, 69, 1]'
);
select is(
  (select result -> 'totals' from v3_results where name = 'S1-reverse-charge'),
  pg_temp.v3_totals(6905456, 0, 0, 6905456, 0, 6905456, 5487177, '1.258472',
    '[{"rate_bp": 2000, "base_cents": 6905456, "tax_cents": 0}]'),
  'F9 reverse charge: no VAT, TTC = HT'
);
select is(
  (select array_agg(line.pu_ht_cents order by line.id) from v3_results, pg_temp.v3_lines(result) as line where name = 'S1'),
  (select array_agg(oracle.pu_130_120 order by oracle.position) from v3_oracle as oracle),
  'S1 lines publish the oracle PU'
);
select is(
  (select array_agg(line.gross_ht_cents order by line.id) from v3_results, pg_temp.v3_lines(result) as line where name = 'S1'),
  (select array_agg(oracle.total_130_120 order by oracle.position) from v3_oracle as oracle),
  'S1 lines publish the oracle gross totals'
);
select is(
  (select line.h_mo from v3_results, pg_temp.v3_lines(result) as line where name = 'S1' and line.id = pg_temp.uid(1)),
  '39.820',
  'A1 O1 line hours = round(20 x 1.991, 3) = 39.820'
);
select is(
  (select array_agg(line.id order by ordinality) from v3_results, jsonb_array_elements(result -> 'lines') with ordinality as entry(line_json, ordinality), lateral (select (line_json ->> 'id')::uuid as id) as line where name = 'S1'),
  array(select pg_temp.uid(position) from generate_series(1, 7) as position),
  'lines come back in input order'
);
select is(pg_temp.v3_invariant_failures(result), '', format('§4 invariants hold for %s', name))
from v3_results
order by name;
select is(
  (
    select jsonb_agg(line order by line ->> 'id')
    from jsonb_array_elements(private.estimate_v3_compute_items(
      (select jsonb_agg(item order by ordinality desc) from jsonb_array_elements(pg_temp.oracle_items(1000)) with ordinality as entry(item, ordinality)),
      pg_temp.v3_params(1.30, 1.20, 101)
    ) -> 'lines') as line
  ),
  (select jsonb_agg(line order by line ->> 'id') from v3_results, jsonb_array_elements(result -> 'lines') as line where name = 'S5'),
  'F6 S5 is stable when the lines are permuted'
);

-- ---------------------------------------------------------------------------
-- Cas d'exigence du §5.3 (moteur pur).
-- ---------------------------------------------------------------------------
insert into v3_results (name, result)
values
  ('T-HMO', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 10, 1000, 0.5, 4500)), pg_temp.v3_params(1, 1))),
  ('T-HMO-Q', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 20, 1000, 0.5, 4500)), pg_temp.v3_params(1, 1))),
  ('T-Q0', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 0, 1000, 0.5, 4500)), pg_temp.v3_params(1, 1))),
  ('T-PU', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 3, 1001)), pg_temp.v3_params(1.6, 1))),
  ('T-HALF3', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1.005, 100)), pg_temp.v3_params(1, 1))),
  ('A-05', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 7, 999)), pg_temp.v3_params(1.6, 1))),
  ('EU01', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 1995450)), pg_temp.v3_params(1, 1, 101))),
  ('EU01-b', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 1995450)), pg_temp.v3_params(1, 1, 99))),
  ('EUHIST-1', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 200)), pg_temp.v3_params(1, 1, null, 1000))),
  ('EUHIST-2', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 200)), pg_temp.v3_params(2, 1, null, 1000))),
  ('CAP', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 40000)), pg_temp.v3_params(1, 1, 50000))),
  ('T-TVA1', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 1, 10000, null, null, 2000),
    pg_temp.v3_line(pg_temp.uid(2), 1, 10000, null, null, 550)), pg_temp.v3_params(1, 1))),
  ('T-TVA-ARR', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 1, 33),
    pg_temp.v3_line(pg_temp.uid(2), 1, 33),
    pg_temp.v3_line(pg_temp.uid(3), 1, 33)), pg_temp.v3_params(1, 1))),
  ('T-TAXSNAP', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 76063)), pg_temp.v3_params(1, 1, null, 0, 'down', 100))),
  ('R1-ARR', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 1234567)), pg_temp.v3_params(1, 1, null, 0, 'down', 100))),
  ('T-MONO-1', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 9999999)), pg_temp.v3_params(1.6, 1.6))),
  ('T-MONO-2', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 10000000)), pg_temp.v3_params(1.6, 1.6))),
  ('T-MARG', private.estimate_v3_compute_items(jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 10000)), pg_temp.v3_params(1.25, 1.25, null, 2000))),
  ('T-STAT', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 1, 50000, 1, 4000, 2000, 'out_of_scope', 'fft'),
    pg_temp.v3_line(pg_temp.uid(2), 1, 10000)), pg_temp.v3_params(1, 1))),
  ('STATUSES', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 1, 50000, 1, 4000, 2000, 'included'),
    pg_temp.v3_line(pg_temp.uid(2), 1, 50000, 1, 4000, 2000, 'for_memory'),
    pg_temp.v3_line(pg_temp.uid(3), 1, 50000, 1, 4000, 2000, 'not_priced'),
    pg_temp.v3_line(pg_temp.uid(4), 1, 50000, 1, 4000, 2000, 'out_of_scope'),
    pg_temp.v3_line(pg_temp.uid(5), 1, 50000, 1, 4000, 1000, 'not_applicable'),
    pg_temp.v3_line(pg_temp.uid(6), 1, 10000)), pg_temp.v3_params(1, 1, 100))),
  ('SECTION', private.estimate_v3_compute_items(jsonb_build_array(
    jsonb_build_object('id', pg_temp.uid(9), 'item_type', 'section', 'parent_id', null),
    pg_temp.v3_line(pg_temp.uid(1), 2, 1000) || jsonb_build_object('parent_id', pg_temp.uid(9))), pg_temp.v3_params(1, 1))),
  ('SPLIT', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 2, 0) || jsonb_build_object(
      'h_mo_atelier_per_unit', 1, 'h_mo_chantier_per_unit', 0.5,
      'labor_rate_atelier_cents', 4000, 'labor_rate_chantier_cents', 5000)), pg_temp.v3_params(1, 1.2, null, 0, 'none', 1, false, true))),
  ('SPLIT-OFF', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 2, 1000) || jsonb_build_object(
      'h_mo_atelier_per_unit', 1, 'labor_rate_atelier_cents', 4000)), pg_temp.v3_params(1, 1.2))),
  ('MAJORATION', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 1, 0, 1, 4000, 2000, 'priced', 'u', 1, 1, 1.1)), pg_temp.v3_params(1, 1))),
  ('K-FO-HALF', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(1), 1, 3470, null, null, 2000, 'priced', 'ml', 1.75)), pg_temp.v3_params(1, 1))),
  ('TIE', private.estimate_v3_compute_items(jsonb_build_array(
    pg_temp.v3_line(pg_temp.uid(2), 1, 100),
    pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1, 1))),
  ('EMPTY', private.estimate_v3_compute_items('[]'::jsonb, pg_temp.v3_params(1, 1)));

create function pg_temp.v3_line_of(p_name text, p_position integer default 1)
returns jsonb
language sql
stable
as $$
  select line
  from v3_results, jsonb_array_elements(result -> 'lines') as line
  where name = p_name and (line ->> 'id')::uuid = pg_temp.uid(p_position)
$$;

select is(
  pg_temp.v3_line_of('T-HMO') - 'id',
  jsonb_build_object(
    'pu_ht_cents', 3250, 'gross_ht_cents', 32500, 'gross_fo_ht_cents', 10000, 'gross_mo_ht_cents', 22500,
    'gross_mo_atelier_ht_cents', 0, 'gross_mo_chantier_ht_cents', 22500, 'cost_ht_cents', 32500,
    'reduction_cents', 0, 'line_total_ht_cents', 32500, 'snapshot_fo_ht_cents', 10000,
    'snapshot_mo_ht_cents', 22500, 'snapshot_mo_atelier_ht_cents', 0, 'snapshot_mo_chantier_ht_cents', 22500,
    'line_tax_cents', 6500, 'line_total_ttc_cents', 39000,
    'h_mo', '5.000', 'h_mo_atelier', null, 'h_mo_chantier', null),
  'T-HMO PU 3 250, total 32 500, MO 22 500 (v2: 12 250), hours 5.000'
);
select is(
  (select array[(pg_temp.v3_line_of('T-HMO-Q') ->> 'gross_ht_cents')::bigint, (pg_temp.v3_line_of('T-HMO-Q') ->> 'gross_mo_ht_cents')::bigint]),
  array[65000, 45000]::bigint[],
  'T-HMO-Q Q 10 -> 20: total 65 000, MO 45 000 (labour follows the quantity)'
);
select is(pg_temp.v3_line_of('T-HMO-Q') ->> 'h_mo', '10.000', 'T-HMO-Q line hours 10.000');
select is(
  (select array[(pg_temp.v3_line_of('T-Q0') ->> 'pu_ht_cents')::bigint, (pg_temp.v3_line_of('T-Q0') ->> 'gross_ht_cents')::bigint, (pg_temp.v3_line_of('T-Q0') ->> 'gross_mo_ht_cents')::bigint]),
  array[3250, 0, 0]::bigint[],
  'T-Q0 Q 0: PU 3 250 shown, total 0, MO 0'
);
select is(
  (select array[(pg_temp.v3_line_of('T-PU') ->> 'pu_ht_cents')::bigint, (pg_temp.v3_line_of('T-PU') ->> 'gross_ht_cents')::bigint]),
  array[1602, 4806]::bigint[],
  'T-PU PR 1 001 x 1.6 -> PU 1 602, Q 3 -> 4 806'
);
select is((pg_temp.v3_line_of('T-HALF3') ->> 'gross_ht_cents')::bigint, 101::bigint, 'T-HALF3 Q 1.005 x PU 100 -> 101');
select is(
  (select array[(pg_temp.v3_line_of('A-05') ->> 'pu_ht_cents')::bigint, (pg_temp.v3_line_of('A-05') ->> 'gross_ht_cents')::bigint]),
  array[1598, 11186]::bigint[],
  'A-05 PR 999 x 1.6 -> PU 1 598, Q 7 -> 11 186'
);
select is(
  (select result -> 'totals' from v3_results where name = 'EU01'),
  pg_temp.v3_totals(1995450, 101, 0, 1995349, 399070, 2394419, 1995450, '0.999949',
    '[{"rate_bp": 2000, "base_cents": 1995349, "tax_cents": 399070}]'),
  'EU01 amount 101: HT 1 995 349, VAT 399 070, TTC 2 394 419, realized 0.999949 (§6.5)'
);
select is(
  (select result -> 'totals' from v3_results where name = 'EU01-b'),
  pg_temp.v3_totals(1995450, 99, 0, 1995351, 399070, 2394421, 1995450, '0.999950',
    '[{"rate_bp": 2000, "base_cents": 1995351, "tax_cents": 399070}]'),
  'EU01-b amount 99: HT 1 995 351, VAT 399 070, TTC 2 394 421'
);
select is(
  (select result -> 'totals' from v3_results where name = 'EUHIST-1'),
  pg_temp.v3_totals(200, 20, 0, 180, 36, 216, 200, '0.900000',
    '[{"rate_bp": 2000, "base_cents": 180, "tax_cents": 36}]'),
  'EUHIST c_FO 1: gross 200, discount 20, HT 180, VAT 36, TTC 216'
);
select is(
  (select result -> 'totals' from v3_results where name = 'EUHIST-2'),
  pg_temp.v3_totals(400, 40, 0, 360, 72, 432, 200, '1.800000',
    '[{"rate_bp": 2000, "base_cents": 360, "tax_cents": 72}]'),
  'EUHIST c_FO 2: the 10 % intent gives gross 400, discount 40, HT 360, VAT 72, TTC 432'
);
select is(
  (select result -> 'totals' from v3_results where name = 'CAP'),
  pg_temp.v3_totals(40000, 40000, 0, 0, 0, 0, 40000, '0.000000',
    '[{"rate_bp": 2000, "base_cents": 0, "tax_cents": 0}]'),
  'CAP 500 EUR requested on a 400 EUR base: 400 EUR applied, HT 0'
);
select is(
  (select result -> 'totals' from v3_results where name = 'T-TVA1'),
  pg_temp.v3_totals(20000, 0, 0, 20000, 2550, 22550, 20000, '1.000000',
    '[{"rate_bp": 550, "base_cents": 10000, "tax_cents": 550}, {"rate_bp": 2000, "base_cents": 10000, "tax_cents": 2000}]'),
  'T-TVA1 20 % + 5.5 %: VAT 2 550, breakdown on two rates sorted by rate'
);
select is(
  (select (result -> 'totals' ->> 'total_tax_cents')::bigint from v3_results where name = 'T-TVA-ARR'),
  20::bigint,
  'T-TVA-ARR 3 lines of 33 c at 20 %: VAT 20 c (v2: 21 c)'
);
select is(
  (select result -> 'totals' from v3_results where name = 'T-TAXSNAP'),
  pg_temp.v3_totals(76063, 0, 63, 76000, 15200, 91200, 76063, '0.999172',
    '[{"rate_bp": 2000, "base_cents": 76000, "tax_cents": 15200}]'),
  'T-TAXSNAP rounding down to 1 EUR: 63, HT 76 000, VAT 15 200, TTC 91 200, adjustment 0'
);
select is(
  (select result -> 'totals' from v3_results where name = 'R1-ARR'),
  pg_temp.v3_totals(1234567, 0, 67, 1234500, 246900, 1481400, 1234567, '0.999946',
    '[{"rate_bp": 2000, "base_cents": 1234500, "tax_cents": 246900}]'),
  'R1-ARR step 100 c: A = 67, HT 1 234 500, VAT 246 900, TTC 1 481 400'
);
select is(
  (select array_agg((result -> 'totals' ->> 'total_ht_cents')::bigint order by name) from v3_results where name in ('T-MONO-1', 'T-MONO-2')),
  array[15999998, 16000000]::bigint[],
  'T-MONO cost 9 999 999 then 10 000 000 at 1.6: HT 15 999 998 then 16 000 000, no tier'
);
select is(
  (select result -> 'totals' ->> 'realized_sale_coefficient' from v3_results where name = 'T-MARG'),
  '1.000000',
  'T-MARG 1.25 / 1.25 with 20 % off: realized coefficient 1.000000 (net margin 0 %)'
);
select is(
  pg_temp.v3_line_of('T-STAT') - 'id',
  jsonb_build_object(
    'pu_ht_cents', null, 'gross_ht_cents', 0, 'gross_fo_ht_cents', 0, 'gross_mo_ht_cents', 0,
    'gross_mo_atelier_ht_cents', 0, 'gross_mo_chantier_ht_cents', 0, 'cost_ht_cents', 0,
    'reduction_cents', 0, 'line_total_ht_cents', 0, 'snapshot_fo_ht_cents', 0,
    'snapshot_mo_ht_cents', 0, 'snapshot_mo_atelier_ht_cents', 0, 'snapshot_mo_chantier_ht_cents', 0,
    'line_tax_cents', 0, 'line_total_ttc_cents', 0,
    'h_mo', '0.000', 'h_mo_atelier', null, 'h_mo_chantier', null),
  'T-STAT an out-of-scope line priceable at 500 EUR contributes 0 everywhere, PU null'
);
select is(
  (select result -> 'totals' from v3_results where name = 'T-STAT'),
  pg_temp.v3_totals(10000, 0, 0, 10000, 2000, 12000, 10000, '1.000000',
    '[{"rate_bp": 2000, "base_cents": 10000, "tax_cents": 2000}]'),
  'T-STAT the total only counts the priced line'
);
select is(
  (
    select string_agg(line.id::text, ', ')
    from v3_results, pg_temp.v3_lines(result) as line
    where name = 'STATUSES'
      and line.id <> pg_temp.uid(6)
      and (line.pu_ht_cents is not null or line.gross_ht_cents <> 0 or line.cost_ht_cents <> 0
        or line.reduction_cents <> 0 or line.line_total_ht_cents <> 0 or line.line_tax_cents <> 0
        or line.line_total_ttc_cents <> 0 or line.h_mo <> '0.000')
  ),
  null,
  'F10 included, for_memory, not_priced, out_of_scope and not_applicable lines contribute 0 and take no discount'
);
select is(
  (select result -> 'totals' from v3_results where name = 'STATUSES'),
  pg_temp.v3_totals(10000, 100, 0, 9900, 1980, 11880, 10000, '0.990000',
    '[{"rate_bp": 2000, "base_cents": 9900, "tax_cents": 1980}]'),
  'F10 the discount and the VAT groups only see priced lines'
);
select is(
  (select jsonb_array_length(result -> 'lines') from v3_results where name = 'SECTION'),
  1,
  'F10 a section carries no amount and is not a line of the output'
);
select is(
  (select (result -> 'totals' ->> 'total_ht_cents')::bigint from v3_results where name = 'SECTION'),
  2000::bigint,
  'F10 the child line of a section is priced normally'
);
select is(
  pg_temp.v3_line_of('SPLIT') - 'id',
  jsonb_build_object(
    'pu_ht_cents', 7800, 'gross_ht_cents', 15600, 'gross_fo_ht_cents', 0, 'gross_mo_ht_cents', 15600,
    'gross_mo_atelier_ht_cents', 9600, 'gross_mo_chantier_ht_cents', 6000, 'cost_ht_cents', 13000,
    'reduction_cents', 0, 'line_total_ht_cents', 15600, 'snapshot_fo_ht_cents', 0,
    'snapshot_mo_ht_cents', 15600, 'snapshot_mo_atelier_ht_cents', 9600, 'snapshot_mo_chantier_ht_cents', 6000,
    'line_tax_cents', 3120, 'line_total_ttc_cents', 18720,
    'h_mo', null, 'h_mo_atelier', '2.000', 'h_mo_chantier', '1.000'),
  'F5 labour split: MO_u = 1 h x 40 EUR + 0.5 h x 50 EUR, PU 7 800 at c_MO 1.2, atelier 9 600 / chantier 6 000'
);
select is(
  (select array[(pg_temp.v3_line_of('SPLIT-OFF') ->> 'pu_ht_cents')::bigint, (pg_temp.v3_line_of('SPLIT-OFF') ->> 'gross_mo_ht_cents')::bigint]),
  array[1000, 0]::bigint[],
  'F5 with the version split disabled, the atelier payload is ignored'
);
select is(
  (select array[(pg_temp.v3_line_of('MAJORATION') ->> 'pu_ht_cents')::bigint, (pg_temp.v3_line_of('MAJORATION') ->> 'cost_ht_cents')::bigint]),
  array[4400, 4400]::bigint[],
  'F4 majoration 1.1 x 1 h x 40 EUR -> PU 4 400'
);
select is((pg_temp.v3_line_of('K-FO-HALF') ->> 'pu_ht_cents')::bigint, 6073::bigint, 'F1 PR 3 470 x k_fo 1.75 = 6 072.5 -> PU 6 073 (half up)');
select is(
  (select array[(pg_temp.v3_line_of('TIE', 1) ->> 'reduction_cents')::bigint, (pg_temp.v3_line_of('TIE', 2) ->> 'reduction_cents')::bigint]),
  array[1, 0]::bigint[],
  'F6 a 1 c discount over two equal lines goes to the smaller uuid, not to the first line shown'
);
select is(
  (select result from v3_results where name = 'EMPTY'),
  jsonb_build_object('lines', '[]'::jsonb, 'totals', pg_temp.v3_totals(0, 0, 0, 0, 0, 0, 0, '1.000000', '[]')),
  'an empty estimate totals 0 with a neutral realized coefficient'
);
select is(pg_temp.v3_invariant_failures(result), '', format('§4 invariants hold for %s', name))
from v3_results
where name not like 'S%'
order by name;

-- A-06 : 1 004 lignes, une remise de 200 c réduit la TVA de 40 c exactement.
select is(
  (
    select (without_discount.result -> 'totals' ->> 'total_tax_cents')::bigint
      - (with_discount.result -> 'totals' ->> 'total_tax_cents')::bigint
    from (
      select jsonb_agg(pg_temp.v3_line(pg_temp.uid(position), 1, 333) order by position) as items
      from generate_series(1, 1004) as position
    ) as source
    cross join lateral (select private.estimate_v3_compute_items(source.items, pg_temp.v3_params(1, 1)) as result) as without_discount
    cross join lateral (select private.estimate_v3_compute_items(source.items, pg_temp.v3_params(1, 1, 200)) as result) as with_discount
  ),
  40::bigint,
  'A-06 1 004 lines: a 200 c discount lowers the VAT by exactly 40 c'
);
select is(
  (
    select pg_temp.v3_invariant_failures(private.estimate_v3_compute_items(jsonb_agg(pg_temp.v3_line(pg_temp.uid(position), 1, 333) order by position), pg_temp.v3_params(1, 1, 200)))
    from generate_series(1, 1004) as position
  ),
  '',
  'A-06 invariants hold on 1 004 lines'
);

-- ---------------------------------------------------------------------------
-- F11 : dépassement levé, jamais écrêté (22003).
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select private.estimate_v3_compute_items(%L::jsonb, %L::jsonb)',
    jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 2000000000)), pg_temp.v3_params(1.6, 1)),
  '22003', 'ESTIMATE_AMOUNT_OVERFLOW',
  'T-CAP PR 2 000 000 000 c at 1.6 overflows the PU'
);
select throws_ok(
  format('select private.estimate_v3_line(%L::jsonb, %L::jsonb)',
    pg_temp.v3_line(pg_temp.uid(1), 1, 2000000000), pg_temp.v3_params(1.6, 1)),
  '22003', 'ESTIMATE_AMOUNT_OVERFLOW',
  'T-CAP the line function overflows too'
);
select throws_ok(
  format('select private.estimate_v3_compute_items(%L::jsonb, %L::jsonb)',
    jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 1500000000), pg_temp.v3_line(pg_temp.uid(2), 1, 1500000000)), pg_temp.v3_params(1, 1)),
  '22003', 'ESTIMATE_AMOUNT_OVERFLOW',
  'F11 a gross total above 2 147 483 647 c overflows'
);
select throws_ok(
  format('select private.estimate_v3_compute_items(%L::jsonb, %L::jsonb)',
    jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 2000000000)), pg_temp.v3_params(1, 1)),
  '22003', 'ESTIMATE_AMOUNT_OVERFLOW',
  'F11 a TTC above 2 147 483 647 c overflows'
);
select throws_ok(
  format('select private.estimate_v3_compute_items(%L::jsonb, %L::jsonb)',
    jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 2000000000, null, null, 2000, 'priced', 'u', 1.5)), pg_temp.v3_params(0.5, 1)),
  '22003', 'ESTIMATE_AMOUNT_OVERFLOW',
  'F11 a cost above 2 147 483 647 c overflows even when the sale does not'
);

-- ---------------------------------------------------------------------------
-- Intégration 2.4 (I-04 à I-06) : mêmes règles que le moteur TS, tranchées à l'intégration
-- (docs/testing/estimate-engine-v3-2.4.md).
-- ---------------------------------------------------------------------------
select is(
  (
    select jsonb_agg(jsonb_build_array(line -> 'h_mo', line -> 'h_mo_atelier', line -> 'h_mo_chantier') order by position)
    from jsonb_array_elements(private.estimate_v3_compute_items(jsonb_build_array(
      pg_temp.v3_line(pg_temp.uid(1), 2, 100),
      pg_temp.v3_line(pg_temp.uid(2), 2, 0, 1.5, 4000, 2000, 'for_memory')), pg_temp.v3_params(1, 1)) -> 'lines')
      with ordinality as entry(line, position)
  ),
  '[[null, null, null], ["0.000", null, null]]'::jsonb,
  'I-04 a null hours-per-unit column gives null line hours; a non-priced line with hours per unit gives 0.000'
);
select throws_ok(
  format('select private.estimate_v3_compute_items(%L::jsonb, %L::jsonb)',
    jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 999999999.999, 0, 2, 0)), pg_temp.v3_params(1, 1)),
  '22003', 'ESTIMATE_AMOUNT_OVERFLOW',
  'I-06 derived line hours beyond numeric(12,3) overflow, even at no cost'
);

-- ---------------------------------------------------------------------------
-- F12 : entrée invalide refusée par son nom (22023).
-- ---------------------------------------------------------------------------
create temporary table v3_invalid_inputs (
  label text primary key,
  items jsonb not null,
  params jsonb not null
) on commit drop;

insert into v3_invalid_inputs (label, items, params)
select label, items, params
from (values
  ('quantity with 4 decimals', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1.0005, 100)), pg_temp.v3_params(1, 1)),
  ('negative quantity', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), -1, 100)), pg_temp.v3_params(1, 1)),
  ('quantity beyond numeric(12,3)', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1000000000, 100)), pg_temp.v3_params(1, 1)),
  ('quantity as a string', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100) || '{"quantity": "1"}'), pg_temp.v3_params(1, 1)),
  ('fractional unit price', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100) || '{"unit_price_ht_cents": 10.5}'), pg_temp.v3_params(1, 1)),
  ('negative unit price', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, -100)), pg_temp.v3_params(1, 1)),
  ('k_fo with 4 decimals', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100, null, null, 2000, 'priced', 'u', 1.0001)), pg_temp.v3_params(1, 1)),
  ('hours per unit with 5 decimals', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100, 0.12345, 4000)), pg_temp.v3_params(1, 1)),
  ('negative labour rate', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100, 1, -4000)), pg_temp.v3_params(1, 1)),
  ('tax rate missing on a line', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100) || '{"tax_rate_bp": null}'), pg_temp.v3_params(1, 1)),
  ('tax rate above 10000', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100, null, null, 10001)), pg_temp.v3_params(1, 1)),
  ('unknown pricing status', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100, null, null, 2000, 'free')), pg_temp.v3_params(1, 1)),
  ('unknown item type', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100) || '{"item_type": "group"}'), pg_temp.v3_params(1, 1)),
  ('duplicate ids', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100), pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1)),
  ('id that is not a uuid', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100) || '{"id": "line-1"}'), pg_temp.v3_params(1, 1)),
  ('items that are not an array', '{"id": "00000000-0000-4000-8000-000000000001"}'::jsonb, pg_temp.v3_params(1, 1)),
  ('sale coefficient 0', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(0, 1)),
  ('sale coefficient above 10', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 10.0001)),
  ('sale coefficient with 5 decimals', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1.23456, 1)),
  ('two discount intents', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1, 100, 500)),
  ('discount rate above 10000', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1, null, 10001)),
  ('v2 rounding mode', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1, null, 0, 'nearest', 100)),
  ('rounding down with a step of 0', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1, null, 0, 'down', 0)),
  ('rounding none with a step of 0', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1, null, 0, 'none', 0)),
  ('missing parameter', jsonb_build_array(pg_temp.v3_line(pg_temp.uid(1), 1, 100)), pg_temp.v3_params(1, 1) - 'reverse_charge')
) as invalid(label, items, params);

select is((select count(*)::integer from v3_invalid_inputs), 25, 'the suite carries 25 invalid inputs');

select throws_ok(
  format('select private.estimate_v3_compute_items(%L::jsonb, %L::jsonb)', invalid.items, invalid.params),
  '22023',
  'ESTIMATE_V3_INPUT_INVALID',
  format('F12 %s is refused as ESTIMATE_V3_INPUT_INVALID', invalid.label)
)
from v3_invalid_inputs as invalid
order by invalid.label;

select * from finish();
rollback;
