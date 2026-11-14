-- TI-691, lot 2 « l'achat », delivery 4: the supply cost of an affaire. Per supply type, the supply budget of the
-- version its client accepted, face to what its orders cost. Rules fixed by the owner on 13/11/2026:
-- - the budget is the accepted version's, whichever variant it is; with several accepted versions, the highest number
--   (as public.list_affaires_page keeps it), and the answer says how many there are; with none, there is no budget
--   (null), only the ordered cost: never the last version, a sent one or a sum of variants;
-- - the budget of a line is its supply cost as the engine computes it, rounded once per line (round = half up on these
--   non-negative amounts): Q × P × FO provision × K FO on engine 3, Q × P × K FO on engines 1 and 2, for the priced
--   lines only (every other pricing status counts 0, as in the estimate); a line without supply type goes to
--   « non classé »;
-- - the ordered cost is the orders of the affaire (purchase_orders.project_id) at their real price: confirmed or
--   received orders are « commandé », drafts and sent orders « en cours » (at their retained quote's price), canceled
--   orders nothing; the frais généraux of an order (imputation overhead) are outside the affaire; shipping and discounts
--   are a row of their own (a discount carries a negative total); an article line without supply type (no article, or
--   an article without one) goes to « non classé »;
-- - the orders made from an estimate of the affaire (create_estimate_purchase_order_drafts, still offered on the
--   affaire's estimate) carry no affaire: they are not counted, and the answer gives their number, whatever their status
--   but canceled (not_counted.estimate_orders).
-- SECURITY DEFINER: an order is otherwise visible to its author and the admins only; the function reads for the readers
-- of the affaire (public.can_read_affaire_intake_project: its owner, an admin, a director of the active tenant). An
-- archived affaire is not found, as the API does not find it.
-- Regression: supabase/tests/database/affaire-supply-cost.test.sql.

create function public.affaire_supply_cost(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tenant_value uuid := public.current_tenant_id();
  accepted_total integer;
  budget_id uuid;
  budget_number integer;
  budget_variant text;
  budget_title text;
  budget_engine smallint;
begin
  if (select auth.uid()) is null or tenant_value is null then
    raise exception using errcode = '42501', message = 'AFFAIRE_SUPPLY_COST_ACCESS_DENIED';
  end if;
  if not exists (select 1 from public.estimate_projects project
    where project.id = p_project_id and project.tenant_id = tenant_value and not coalesce(project.is_archived, false)) then
    raise exception using errcode = 'P0002', message = 'AFFAIRE_SUPPLY_COST_NOT_FOUND';
  end if;
  if not public.can_read_affaire_intake_project(p_project_id, tenant_value) then
    raise exception using errcode = '42501', message = 'AFFAIRE_SUPPLY_COST_ACCESS_DENIED';
  end if;

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
    order_lines as (
      select case
          when oi.line_kind in ('shipping', 'discount') then 'shipping_discount'
          when oi.supply_type_id is null then 'unclassified'
          else 'supply_type' end as kind,
        case when oi.line_kind in ('shipping', 'discount') then null else oi.supply_type_id end as supply_type_id,
        po.status in ('confirmed'::public.purchase_order_status, 'received'::public.purchase_order_status) as ordered,
        coalesce(oi.line_total_ht_cents, 0)::bigint as cents
      from public.purchase_orders po
      join public.purchase_order_items oi on oi.purchase_order_id = po.id and oi.tenant_id = tenant_value
      where po.tenant_id = tenant_value and po.project_id = p_project_id
        and po.status <> 'canceled'::public.purchase_order_status
        and oi.imputation is distinct from 'overhead'
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
        'estimate_orders', (select pg_catalog.count(*)::integer from public.purchase_orders po
          join public.estimate_versions version on version.id = po.source_estimate_version_id
            and version.tenant_id = tenant_value and version.project_id = p_project_id
          where po.tenant_id = tenant_value and po.project_id is null
            and po.status <> 'canceled'::public.purchase_order_status))
    )
  );
end;
$$;

comment on function public.affaire_supply_cost(uuid) is
  'TI-691 delivery 4: the supply cost of an affaire. budget_version: the accepted version whose lines make the budget (the highest number, with accepted_count), or null when none is accepted (no budget). rows: per supply type (kind supply_type, code, name), « non classé » (unclassified) and shipping and discounts (shipping_discount): budget_cents (null without accepted version; a priced line counts Q × P × FO provision × K FO on engine 3, Q × P × K FO before, rounded per line), ordered_cents (confirmed and received orders of the affaire, at their real price) and pending_cents (drafts and sent orders), frais généraux and canceled orders left out. totals: the same sums. not_counted.estimate_orders: orders made from an estimate of the affaire, canceled ones excepted, which carry no affaire and are not counted. For the readers of the affaire: AFFAIRE_SUPPLY_COST_NOT_FOUND (also archived), _ACCESS_DENIED. Security definer: an order is otherwise visible to its author and the admins only.';

revoke all on function public.affaire_supply_cost(uuid) from public, anon;
grant execute on function public.affaire_supply_cost(uuid) to authenticated;
