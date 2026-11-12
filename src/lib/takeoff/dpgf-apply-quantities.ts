import { dpgfQuantityPolicy } from "@/lib/takeoff/dpgf-quantity-policy";
import type { TakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";
import { haveComparableQuantities } from "@/lib/takeoff/quantity-compatibility";

/** Stored in the service-only, single-use apply permit; never accepted from a browser request. */
export type DpgfApplyQuantityLine = {
  target_id: string;
  expected_updated_at: string;
  reference_quantity: number | null;
  measured_quantity: number;
  priced_quantity: number;
  absolute_gap: number | null;
  reviewed: boolean;
  review_decision_id: string | null;
  review_updated_at: string | null;
  source_file_name: string | null;
  source_page: number | null;
  source_metadata: Record<string, unknown>;
  takeoff_items: Array<{ id: string; quantity: number; updated_at: string }>;
};

/**
 * Whether the application feeds this DPGF row from the takeoff: linked lines, a quantity the reconciliation can compare
 * (same unit and quantity identity), not decided out of scope. TI-682 lot D: « Pages déjà au devis » reads the DPGF
 * lines a takeoff feeds again with this very rule (dpgfTargetsFedAgain), so that it never offers a page as replaced that
 * the application leaves unfed.
 */
function feedsDpgfRow(row: TakeoffDpgfComparisonRow) {
  return row.linked_takeoff_items.length > 0 && row.applied_decision?.decision !== "out_of_scope" && dpgfQuantityPolicy(row) !== null;
}

/** The DPGF line each takeoff line feeds again (by the application's rule), keyed by takeoff line. */
export function dpgfTargetsFedAgain(rows: readonly TakeoffDpgfComparisonRow[]) {
  return new Map(rows.filter(feedsDpgfRow).flatMap(row => row.linked_takeoff_items.map(item => [item.item_id, row.dpgf.estimate_item_id] as const)));
}

export function buildDpgfApplyQuantityPolicy(context: TakeoffDpgfComparisonContext, rows: readonly TakeoffDpgfComparisonRow[]): DpgfApplyQuantityLine[] {
  const targets = new Map(context.estimateItems.map(item => [item.id, item]));
  const sources = new Map(context.takeoffItems.map(item => [item.id, item]));
  return rows.flatMap(row => {
    const policy = dpgfQuantityPolicy(row);
    const target = targets.get(row.line_id);
    if (!target || !policy || !feedsDpgfRow(row)) return [];
    if (row.linked_takeoff_items.some(item => !haveComparableQuantities(
      { designation: row.dpgf.title, description: row.dpgf.description, quantity: row.dpgf_quantity ?? 0, unit: row.dpgf.unit ?? "" }, item
    ))) throw new Error("Les quantités reliées ne sont pas comparables : vérifiez matériau, diamètre et base de surface.");
    return [{ target_id: target.id, expected_updated_at: target.updated_at,
      reference_quantity: policy.reference, measured_quantity: policy.measured,
      priced_quantity: policy.priced,
      absolute_gap: policy.absoluteGap, reviewed: row.applied_decision !== null,
      review_decision_id: row.applied_decision?.id ?? null, review_updated_at: row.applied_decision?.updated_at ?? null,
      source_file_name: row.dpgf.source_file_name, source_page: row.dpgf.source_page,
      source_metadata: { ...target.source_metadata, dpgf_source_quantity: policy.reference, dpgf_source_unit: row.dpgf.unit },
      takeoff_items: row.linked_takeoff_items.map(item => {
        const source = sources.get(item.item_id);
        if (!source) throw new Error("Source du métré absente de la révision examinée.");
        return { id: source.id, quantity: source.quantity, updated_at: source.updated_at };
      }),
    }];
  });
}
