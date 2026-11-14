import { financialReviewRecommended, quantitySourceComparison } from "@/lib/takeoff/quantity-review-policy";

type PricedItem = { id: string; parent_id: string | null; item_type: string; title: string;
  quantity: number | null; pricing_status: string | null };
type Match = { line_id: string; item_ids: string[]; delta_absolute: number | null };

/** The lot of an estimate item: its root section, null outside any section (or under a broken parent chain). */
function lotResolver(byId: ReadonlyMap<string, PricedItem>) {
  return (id: string): string | null => {
    const seen = new Set<string>();
    let item = byId.get(id), root: string | null = null;
    while (item?.parent_id) {
      if (seen.has(item.id)) return null;
      seen.add(item.id);
      item = byId.get(item.parent_id);
      if (!item || item.item_type !== "section") return null;
      root = item.id;
    }
    return root;
  };
}

/** Amounts come from the pinned engine, never directly from a v3 purchase price. */
export function buildFinancialReviewPosts(items: readonly PricedItem[], amounts: ReadonlyMap<string, number>, matches: readonly Match[],
  sourceComparisons: ReadonlyMap<string, NonNullable<ReturnType<typeof quantitySourceComparison>>> = new Map()) {
  const byId = new Map(items.map(item => [item.id, item]));
  const byMatch = new Map(matches.map(match => [match.line_id, match]));
  const lotOf = lotResolver(byId);
  const lots = new Map<string, number>();
  for (const item of items) {
    const amount = amounts.get(item.id), lot = lotOf(item.id);
    if (lot && amount !== undefined) lots.set(lot, (lots.get(lot) ?? 0) + amount);
  }
  return items.filter(item => item.item_type === "line").map(item => {
    const match = byMatch.get(item.id), lot = lotOf(item.id);
    const amount = item.pricing_status && item.pricing_status !== "priced" ? null : amounts.get(item.id) ?? null;
    const lotAmount = lot ? lots.get(lot) ?? null : null;
    const groups = new Map((match?.item_ids ?? []).flatMap(id => {
      const comparison = sourceComparisons.get(id);
      return comparison ? [[comparison.group, Math.abs(comparison.delta)] as const] : [];
    }));
    const alternativeDelta = groups.size ? [...groups.values()].reduce((sum, delta) => sum + delta, 0) : null;
    // The two gaps can describe the same doubt; show the larger estimate, never add them twice.
    const delta = match?.delta_absolute === null || match?.delta_absolute === undefined ? alternativeDelta
      : Math.max(Math.abs(match.delta_absolute), alternativeDelta ?? 0);
    const impact = amount !== null && item.quantity && delta !== null
      ? Math.round(delta * amount / item.quantity) : null;
    return { line_id: item.id, title: item.title, lot_id: lot, amount_cents: amount, lot_amount_cents: lotAmount,
      impact_cents: impact !== null && Number.isSafeInteger(impact) ? impact : null,
      recommend_review: financialReviewRecommended(amount, lotAmount), item_ids: match?.item_ids ?? [] };
  });
}

/**
 * TI-701 (D13): the estimate line each linked takeoff line is priced at, its unit price from the pinned engine (null
 * when the line is not « Chiffrée », whatever its engine computes), and the line's lot. A takeoff line linked twice
 * keeps its best link, the first among equals: a unit price above zero, else a price left out on purpose (« Inclus »,
 * « Pour mémoire »…), else a price of zero or below, else none (« Non chiffrée »). So it is unpriced only when every
 * line that holds it is, whatever the order of the links.
 */
export function buildTakeoffItemPricing(items: readonly PricedItem[], unitPrices: ReadonlyMap<string, number | null>, matches: readonly Match[]) {
  const byId = new Map(items.map(item => [item.id, item]));
  const lotOf = lotResolver(byId);
  const pricing = new Map<string, { rank: number; entry: { item_id: string; line_id: string; pricing_status: string | null;
    unit_price_cents: number | null; lot: { id: string; title: string } | null } }>();
  for (const match of matches) {
    const line = byId.get(match.line_id);
    if (!line || line.item_type !== "line") continue;
    const priced = !line.pricing_status || line.pricing_status === "priced";
    const price = priced ? unitPrices.get(line.id) ?? null : null;
    const unitPrice = price !== null && Number.isSafeInteger(price) ? price : null;
    const rank = unitPrice !== null && unitPrice > 0 ? 3 : !priced && line.pricing_status !== "not_priced" ? 2 : unitPrice !== null ? 1 : 0;
    const lotId = lotOf(line.id);
    const lot = lotId ? byId.get(lotId) ?? null : null;
    for (const itemId of match.item_ids) {
      if ((pricing.get(itemId)?.rank ?? -1) >= rank) continue;
      pricing.set(itemId, { rank, entry: { item_id: itemId, line_id: line.id, pricing_status: line.pricing_status,
        unit_price_cents: unitPrice, lot: lot ? { id: lot.id, title: lot.title } : null } });
    }
  }
  return [...pricing.values()].map(({ entry }) => entry);
}

/**
 * An engine 2 line's unit price: its net sale divided by its quantity (puNetHtCents), so none without a quantity
 * (the engine then gives 0, which would read as a free line). Engine 2 has no « Non chiffrée » status: every line
 * reads « Chiffrée ».
 */
export function engineTwoUnitPrice(quantity: number | null, puNetHtCents: number): number | null {
  return quantity !== null && quantity > 0 ? puNetHtCents : null;
}
