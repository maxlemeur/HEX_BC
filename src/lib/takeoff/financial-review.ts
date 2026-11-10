import { financialReviewRecommended, quantitySourceComparison } from "@/lib/takeoff/quantity-review-policy";

type PricedItem = { id: string; parent_id: string | null; item_type: string; title: string;
  quantity: number | null; pricing_status: string | null };
type Match = { line_id: string; item_ids: string[]; delta_absolute: number | null };

/** Amounts come from the pinned engine, never directly from a v3 purchase price. */
export function buildFinancialReviewPosts(items: readonly PricedItem[], amounts: ReadonlyMap<string, number>, matches: readonly Match[],
  sourceComparisons: ReadonlyMap<string, NonNullable<ReturnType<typeof quantitySourceComparison>>> = new Map()) {
  const byId = new Map(items.map(item => [item.id, item]));
  const byMatch = new Map(matches.map(match => [match.line_id, match]));
  const lotOf = (id: string): string | null => {
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
