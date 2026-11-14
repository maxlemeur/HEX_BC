import Decimal from "decimal.js";
import { isKitSection } from "@/lib/estimates/kit-presentation";

type Node = { id: string; parent_id: string | null; item_type: string; source_metadata?: unknown;
  quantity?: number | null; h_mo?: number | null; h_mo_atelier?: number | null; h_mo_chantier?: number | null };
type Basis = Record<string, { base: number; applied: number; factor: number }>;
export function ouvrageMetadata(item: { source_metadata?: unknown }): Record<string, unknown> {
  const meta = item.source_metadata;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
}
export function ouvrageQuantity(item: { source_metadata?: unknown }): number {
  const quantity = ouvrageMetadata(item).ouvrage_quantity;
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0 ? quantity : 1;
}

/** Quantity is local to each ouvrage. Components alone enter the pinned engine.
 * Composition lives on each leaf, without UUID references, so zero, nested edits and
 * copies retain the unrounded quantities. Editing an effective value rebases that field.
 */
export function resizeOuvrage<T extends Node>(items: readonly T[], rootId: string, quantity: number, perUnitLabor: boolean): T[] {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity >= 1e9) throw new Error("Quantité d’ouvrage invalide.");
  quantity = new Decimal(quantity).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
  if (quantity >= 1e9) throw new Error("Quantité d’ouvrage invalide.");
  const byId = new Map(items.map(item => [item.id, item]));
  const root = byId.get(rootId);
  if (!root || root.item_type !== "section" || !isKitSection(root)) throw new Error("Cette ligne n’est pas un ouvrage.");
  const factors = (item: T): { before: Decimal; after: Decimal; contained: boolean } => {
    let before = new Decimal(1), after = new Decimal(1), contained = false;
    let cursor = item.parent_id ? byId.get(item.parent_id) : undefined;
    const visited = new Set<string>([item.id]);
    while (cursor) {
      if (visited.has(cursor.id)) throw new Error("Hiérarchie d’ouvrage invalide.");
      visited.add(cursor.id);
      if (isKitSection(cursor)) {
        before = before.mul(ouvrageQuantity(cursor));
        after = after.mul(cursor.id === rootId ? quantity : ouvrageQuantity(cursor));
      }
      if (cursor.id === rootId) contained = true;
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    return { before, after, contained };
  };
  const fields = perUnitLabor ? ["quantity"] as const : ["quantity", "h_mo", "h_mo_atelier", "h_mo_chantier"] as const;
  return items.map(item => {
    if (item.id === rootId) return { ...item, source_metadata: { ...ouvrageMetadata(item), ouvrage_quantity: quantity } };
    if (item.item_type !== "line") return item;
    const factor = factors(item);
    if (!factor.contained) return item;
    const oldBasis = ouvrageMetadata(item).ouvrage_composition as Basis | undefined;
    const basis: Basis = { ...oldBasis };
    const patch: Record<string, unknown> = {};
    for (const field of fields) {
      const value = item[field];
      if (value == null) continue;
      const saved = oldBasis?.[field];
      const base = saved && saved.applied === value && saved.factor === factor.before.toNumber() ? saved.base : new Decimal(value).div(factor.before.isZero() ? 1 : factor.before).toNumber();
      const applied = new Decimal(base).mul(factor.after).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
      if (applied >= 1e9) throw new Error("La quantité ou les heures de l’ouvrage dépassent la limite autorisée.");
      basis[field] = { base, applied, factor: factor.after.toNumber() };
      patch[field] = applied;
    }
    return { ...item, ...patch, source_metadata: { ...ouvrageMetadata(item), ouvrage_composition: basis } };
  });
}
