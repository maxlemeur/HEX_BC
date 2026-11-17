-- TI-714: read estimate-origin orders through their stored version in the active tenant.
-- Preserve the accepted-version budget and the amounts already written to each order line.
-- Old orders need no backfill. A deleted or contradictory source never falls back to a direct link.

-- A version FK alone does not authorize a new purchase association. Reuse the estimate purchase write
-- scope for new or changed source references, while preserving FK detachment and historical transfers.
create or replace function private.guard_estimate_purchase_source_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is not distinct from old.tenant_id
      and new.source_estimate_version_id is not distinct from old.source_estimate_version_id then
      return new;
    end if;
    -- Even orders that predate the transfer ledger keep the provenance recorded on the header.
    if (old.source_estimate_version_id is not null and (select auth.uid()) is not null)
      or exists (select 1 from private.estimate_purchase_transfers transfer where transfer.purchase_order_id = old.id) then
      if new.tenant_id = old.tenant_id and new.source_estimate_version_id is null
        and old.source_estimate_version_id is not null
        and not exists (select 1 from public.estimate_versions version where version.id = old.source_estimate_version_id) then
        return new;
      end if;
      raise exception using errcode = '23514', message = 'ORDER_DRAFT_SOURCE_SCOPE_INVALID';
    end if;
  end if;

  if new.source_estimate_version_id is not null and (select auth.uid()) is not null then
    if private.estimate_purchase_access(new.source_estimate_version_id, true) is distinct from new.tenant_id then
      raise exception using errcode = '42501', message = 'ORDER_DRAFT_ACCESS_DENIED';
    end if;
    if new.project_id is not null and not exists (select 1 from public.estimate_versions version
      where version.id = new.source_estimate_version_id and version.tenant_id = new.tenant_id
        and version.project_id = new.project_id) then
      raise exception using errcode = '23514', message = 'ORDER_DRAFT_SOURCE_SCOPE_INVALID';
    end if;
  end if;
  return new;
end;
$$;

drop trigger guard_estimate_purchase_source_header on public.purchase_orders;
-- Run after set_purchase_orders_tenant_id on insert.
create trigger zy_guard_estimate_purchase_source_header
  before insert or update of tenant_id, source_estimate_version_id on public.purchase_orders
  for each row execute function private.guard_estimate_purchase_source_header();

-- This existing SECURITY DEFINER returns aggregate order costs to affaire readers, including directors.
-- Only readers of an individual order may see it reflected in the unresolved count.

create or replace function public.affaire_supply_cost(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tenant_value uuid := public.current_tenant_id();
  actor uuid := (select auth.uid());
  can_read_all_orders boolean;
  accepted_total integer;
  budget_id uuid;
  budget_number integer;
  budget_variant text;
  budget_title text;
  budget_engine smallint;
begin
  if actor is null or tenant_value is null then
    raise exception using errcode = '42501', message = 'AFFAIRE_SUPPLY_COST_ACCESS_DENIED';
  end if;
  if not exists (select 1 from public.estimate_projects project
    where project.id = p_project_id and project.tenant_id = tenant_value and not coalesce(project.is_archived, false)) then
    raise exception using errcode = 'P0002', message = 'AFFAIRE_SUPPLY_COST_NOT_FOUND';
  end if;
  if not public.can_read_affaire_intake_project(p_project_id, tenant_value) then
    raise exception using errcode = '42501', message = 'AFFAIRE_SUPPLY_COST_ACCESS_DENIED';
  end if;

  can_read_all_orders := public.has_tenant_role(tenant_value, array['admin'::public.tenant_role]);

  select pg_catalog.count(*)::integer into accepted_total
  from public.estimate_versions version
  where version.project_id = p_project_id and version.tenant_id = tenant_value
    and version.status = 'accepted'::public.estimate_status;
  select version.id, version.version_number, version.variant_label, version.title, version.calc_engine_version
    into budget_id, budget_number, budget_variant, budget_title, budget_engine
  from public.estimate_versions version
  where version.project_id = p_project_id and version.tenant_id = tenant_value
    and version.status = 'accepted'::public.estimate_status
  order by version.version_number desc, version.created_at desc, version.id desc
  limit 1;

  return (
    with budget_lines as (
      select case when item.supply_type_id is null then 'unclassified' else 'supply_type' end as kind,
        item.supply_type_id,
        pg_catalog.round(item.quantity * item.unit_price_ht_cents
          * case when budget_engine = 3 then coalesce(item.fo_provision, 1) else 1 end
          * coalesce(item.k_fo, 1))::bigint as cents
      from public.estimate_items item
      where budget_id is not null and item.version_id = budget_id and item.tenant_id = tenant_value
        and item.item_type = 'line'::public.estimate_item_type
        and item.pricing_status = 'priced'::public.estimate_line_pricing_status
        and item.quantity is not null and item.unit_price_ht_cents is not null
    ),
    order_ids as (
      -- Start from the two indexed links. UNION collapses matching origins before looking at order lines.
      select po.id
      from public.purchase_orders po
      where po.tenant_id = tenant_value and po.project_id = p_project_id and po.status <> 'canceled'
      union
      select po.id
      from public.estimate_versions version
      join public.purchase_orders po on po.source_estimate_version_id = version.id and po.tenant_id = version.tenant_id
      where version.project_id = p_project_id and version.tenant_id = tenant_value and po.status <> 'canceled'
    ),
    scoped_orders as (
      select po.id, po.user_id, po.status, po.source_estimate_version_id,
        case
          when po.source_estimate_version_id is not null then
            source.project_id = p_project_id and (po.project_id is null or po.project_id = p_project_id)
          else po.project_id = p_project_id and not exists (
            -- A durable transfer survives deletion of its version. A cleared source FK is missing provenance.
            select 1 from private.estimate_purchase_transfers transfer
            where transfer.purchase_order_id = po.id and transfer.tenant_id = tenant_value)
            and not exists (
              select 1 from public.purchase_order_items item
              where item.purchase_order_id = po.id and item.tenant_id = tenant_value and item.is_source_linked)
        end as attributable
      from order_ids candidate
      join public.purchase_orders po on po.id = candidate.id and po.tenant_id = tenant_value
      left join public.estimate_versions source on source.id = po.source_estimate_version_id
        and source.tenant_id = tenant_value
    ),
    priced_order_lines as (
      select oi.line_kind, po.status,
        coalesce(oi.supply_type_id, source_line.supply_type_id, product.supply_type_id) as supply_type_id,
        oi.line_total_ht_cents::bigint as cents
      from scoped_orders po
      join public.purchase_order_items oi on oi.purchase_order_id = po.id and oi.tenant_id = tenant_value
      -- Prefer the order's stored supply type. Older estimate orders may need the verified source line or article.
      left join public.estimate_items source_line on oi.supply_type_id is null and oi.line_kind = 'article'
        and source_line.id = oi.source_estimate_item_id and source_line.tenant_id = tenant_value
        and source_line.version_id = po.source_estimate_version_id and source_line.item_type = 'line'
      left join public.products product on oi.supply_type_id is null and source_line.supply_type_id is null
        and po.source_estimate_version_id is not null and oi.line_kind = 'article'
        and product.id = oi.product_id and product.tenant_id = tenant_value
      where po.attributable and oi.imputation is distinct from 'overhead'
    ),
    order_lines as (
      select case
          when line.line_kind in ('shipping', 'discount') then 'shipping_discount'
          when supply.id is null then 'unclassified'
          else 'supply_type' end as kind,
        case when line.line_kind in ('shipping', 'discount') then null else supply.id end as supply_type_id,
        line.status in ('confirmed', 'received') as ordered,
        line.cents
      from priced_order_lines line
      left join public.supply_types supply on supply.id = line.supply_type_id and supply.tenant_id = tenant_value
    ),
    keys as (
      select kind, supply_type_id from budget_lines
      union
      select kind, supply_type_id from order_lines
    ),
    budget_sums as (
      select line.kind, line.supply_type_id, pg_catalog.sum(line.cents) as cents
      from budget_lines line group by line.kind, line.supply_type_id
    ),
    order_sums as (
      select line.kind, line.supply_type_id,
        pg_catalog.sum(line.cents) filter (where line.ordered) as ordered,
        pg_catalog.sum(line.cents) filter (where not line.ordered) as pending
      from order_lines line group by line.kind, line.supply_type_id
    ),
    sums as (
      select key.kind, key.supply_type_id, supply.code, supply.name,
        case when budget_id is null then null else coalesce(budget.cents, 0) end as budget_cents,
        coalesce(ordered.ordered, 0) as ordered_cents,
        coalesce(ordered.pending, 0) as pending_cents
      from keys key
      left join budget_sums budget on budget.kind = key.kind
        and budget.supply_type_id is not distinct from key.supply_type_id
      left join order_sums ordered on ordered.kind = key.kind
        and ordered.supply_type_id is not distinct from key.supply_type_id
      left join public.supply_types supply on supply.id = key.supply_type_id and supply.tenant_id = tenant_value
    )
    select pg_catalog.jsonb_build_object(
      'budget_version', case when budget_id is null then null else pg_catalog.jsonb_build_object('id', budget_id,
        'version_number', budget_number, 'variant_label', budget_variant, 'title', budget_title,
        'accepted_count', accepted_total) end,
      'rows', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', sum_row.kind,
          'supply_type_id', sum_row.supply_type_id, 'code', sum_row.code, 'name', sum_row.name,
          'budget_cents', sum_row.budget_cents, 'ordered_cents', sum_row.ordered_cents,
          'pending_cents', sum_row.pending_cents)
        order by case sum_row.kind when 'supply_type' then 0 when 'unclassified' then 1 else 2 end, sum_row.name,
          sum_row.supply_type_id)
        from sums sum_row), '[]'::jsonb),
      'totals', pg_catalog.jsonb_build_object(
        'budget_cents', case when budget_id is null then null
          else coalesce((select pg_catalog.sum(line.cents) from budget_lines line), 0) end,
        'ordered_cents', coalesce((select pg_catalog.sum(line.cents) from order_lines line where line.ordered), 0),
        'pending_cents', coalesce((select pg_catalog.sum(line.cents) from order_lines line where not line.ordered), 0)),
      'not_counted', pg_catalog.jsonb_build_object(
        -- Keep the old field at zero for clients that still parse the previous response shape.
        'estimate_orders', 0,
        'unresolved_orders', (select pg_catalog.count(*)::integer from scoped_orders po
          where po.attributable is not true and (po.user_id = actor or can_read_all_orders)))
    )
  );
end;
$$;

comment on function public.affaire_supply_cost(uuid) is
  'TI-714: accepted-version supply budget and stored HT order costs by supply type. Orders with a verified same-tenant direct affaire or estimate version contribute once. Draft and sent are pending, confirmed and received are ordered. Canceled orders and overhead are excluded. not_counted.unresolved_orders is a count of excluded unresolved orders visible to the caller under the purchase order read contract. estimate_orders is a compatibility field set to zero.';

revoke all on function public.affaire_supply_cost(uuid) from public, anon;
grant execute on function public.affaire_supply_cost(uuid) to authenticated;
