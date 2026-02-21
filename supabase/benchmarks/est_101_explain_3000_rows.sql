-- EST-101 benchmark: EXPLAIN ANALYZE on fetch tree, bulk update (100 rows), and reorder.
-- Safety: this script runs in a transaction and finishes with ROLLBACK.

begin;

set local statement_timeout = '0';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '10min';

create temporary table _est101_benchmark_context (
  source_version_id uuid not null,
  benchmark_version_id uuid not null,
  tenant_id uuid not null
) on commit drop;

do $$
declare
  source_version public.estimate_versions%rowtype;
  benchmark_version_id uuid;
  next_version_number integer;
begin
  select ev.*
    into source_version
  from public.estimate_versions ev
  where ev.status = 'draft'
  order by ev.updated_at desc
  limit 1;

  if not found then
    select ev.*
      into source_version
    from public.estimate_versions ev
    order by ev.updated_at desc
    limit 1;
  end if;

  if not found then
    raise exception
      using
        message = 'EST101_BENCHMARK_PRECONDITION_MISSING',
        detail = 'No estimate_versions row found to clone for the benchmark.';
  end if;

  select coalesce(max(ev.version_number), 0) + 1
    into next_version_number
  from public.estimate_versions ev
  where ev.project_id = source_version.project_id;

  insert into public.estimate_versions (
    id,
    project_id,
    tenant_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    gen_random_uuid(),
    source_version.project_id,
    source_version.tenant_id,
    next_version_number,
    'draft'::public.estimate_status,
    '[EST-101 BENCHMARK] 3000 rows',
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    0,
    0,
    0
  )
  returning id into benchmark_version_id;

  insert into _est101_benchmark_context (
    source_version_id,
    benchmark_version_id,
    tenant_id
  )
  values (
    source_version.id,
    benchmark_version_id,
    source_version.tenant_id
  );
end;
$$;

insert into public.estimate_items (
  id,
  version_id,
  tenant_id,
  parent_id,
  item_type,
  position,
  title,
  description,
  quantity,
  unit_price_ht_cents,
  tax_rate_bp,
  k_fo,
  h_mo,
  k_mo,
  pu_ht_cents,
  labor_role_id,
  category_id,
  line_total_ht_cents,
  line_tax_cents,
  line_total_ttc_cents
)
select
  gen_random_uuid(),
  ctx.benchmark_version_id,
  ctx.tenant_id,
  null,
  'line'::public.estimate_item_type,
  line_idx.position,
  format('EST-101 bench line %s', line_idx.position),
  null,
  1::numeric(12,3),
  10000,
  2000,
  1::numeric(12,3),
  1::numeric(12,3),
  1::numeric(12,3),
  10000,
  null,
  null,
  10000,
  2000,
  12000
from _est101_benchmark_context ctx
cross join generate_series(1, 3000) as line_idx(position);

update public.estimate_versions ev
set
  total_ht_cents = totals.total_ht_cents,
  total_tax_cents = totals.total_tax_cents,
  total_ttc_cents = totals.total_ttc_cents
from (
  select
    item.version_id,
    coalesce(sum(item.line_total_ht_cents), 0)::integer as total_ht_cents,
    coalesce(sum(item.line_tax_cents), 0)::integer as total_tax_cents,
    coalesce(sum(item.line_total_ttc_cents), 0)::integer as total_ttc_cents
  from public.estimate_items item
  join _est101_benchmark_context ctx
    on ctx.benchmark_version_id = item.version_id
  group by item.version_id
) totals
where ev.id = totals.version_id;

-- 1) Fetch tree query used by the editor.
explain (analyze, buffers, verbose)
select item.*
from public.estimate_items item
join _est101_benchmark_context ctx
  on ctx.benchmark_version_id = item.version_id
where item.tenant_id = ctx.tenant_id
order by item.position asc, item.id asc;

-- 2) Bulk update on 100 rows + version totals patch in the same RPC call.
explain (analyze, buffers, verbose)
with target_items as (
  select
    item.id,
    row_number() over (order by item.position asc, item.id asc) as row_num
  from public.estimate_items item
  join _est101_benchmark_context ctx
    on ctx.benchmark_version_id = item.version_id
  where item.parent_id is null
  order by item.position asc, item.id asc
  limit 100
),
payload as (
  select jsonb_agg(
    jsonb_build_object(
      'id', target_items.id,
      'position', 101 - target_items.row_num
    )
  ) as item_updates
  from target_items
),
version_patch as (
  select jsonb_build_object(
    'total_ht_cents', ev.total_ht_cents,
    'total_tax_cents', ev.total_tax_cents,
    'total_ttc_cents', ev.total_ttc_cents
  ) as payload
  from public.estimate_versions ev
  join _est101_benchmark_context ctx
    on ctx.benchmark_version_id = ev.id
)
select public.bulk_update_estimate_items(
  (select benchmark_version_id from _est101_benchmark_context limit 1),
  coalesce((select item_updates from payload), '[]'::jsonb),
  (select payload from version_patch),
  (
    select ev.updated_at
    from public.estimate_versions ev
    join _est101_benchmark_context ctx
      on ctx.benchmark_version_id = ev.id
  )
);

-- 3) Reorder root siblings on all 3000 rows.
explain (analyze, buffers, verbose)
with reorder_payload as (
  select array_agg(item.id order by item.position desc, item.id desc) as ordered_item_ids
  from public.estimate_items item
  join _est101_benchmark_context ctx
    on ctx.benchmark_version_id = item.version_id
  where item.parent_id is null
)
select public.reorder_estimate_items(
  (select benchmark_version_id from _est101_benchmark_context limit 1),
  null::uuid,
  (select ordered_item_ids from reorder_payload)
);

rollback;
