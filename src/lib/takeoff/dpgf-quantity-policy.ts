import { compareQuantityPairs, surfaceBasis } from "@/lib/takeoff/quantity-policy";
import { lengthFactor, roundedMeasure } from "@/lib/takeoff/page-replacement";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

/**
 * The DPGF total is one real pair. Known printed/measured sub-pairs may reveal errors its total would cancel.
 * TI-682 D4: `earlier` is what the target keeps of the other takeoffs (its measure, the part its printed surfaces protect
 * and their gap): the pair is then judged on the total the target will hold. Without it, this takeoff's own pair (what
 * the application authorizes for its lines).
 */
export function dpgfQuantityPolicy(row: Pick<TakeoffDpgfComparisonRow, "dpgf_quantity" | "takeoff_quantity" | "linked_takeoff_items">,
  earlier?: { measured: number; protective: number; printed_gap: number }) {
  if (row.takeoff_quantity === null) return null;
  const measured = row.takeoff_quantity + (earlier?.measured ?? 0);
  const pairs = row.linked_takeoff_items.flatMap(item => {
    const inputs = readRuleInputs(item.metadata);
    return inputs?.source === "vector" && inputs.kind === "surface" && surfaceBasis(inputs.room ?? "") === "net_floor"
      && typeof inputs.printed_m2 === "number" && inputs.printed_m2 > 0
      ? [{ reference: inputs.printed_m2, measured: inputs.model_quantity }] : [];
  });
  const printed = compareQuantityPairs(pairs);
  // Keep the other measured contributions, without assigning them invented printed references.
  const protectiveMeasured = measured + (printed ? printed.priced - printed.measured : 0) + (earlier?.protective ?? 0);
  if (row.dpgf_quantity === null) return { reference: null, measured, priced: protectiveMeasured,
    absoluteGap: null, percentGap: null, requiresReview: false };
  const total = compareQuantityPairs([{ reference: row.dpgf_quantity, measured }])!;
  const absoluteGap = Math.max(total.absoluteGap, (printed?.absoluteGap ?? 0) + (earlier?.printed_gap ?? 0));
  return { ...total, priced: Math.max(total.priced, protectiveMeasured), absoluteGap,
    percentGap: total.reference > 0 ? absoluteGap / total.reference * 100 : null,
    requiresReview: absoluteGap > total.reference / 100 + 1e-9 };
}

type ReviewedRow = Pick<TakeoffDpgfComparisonRow, "dpgf_quantity" | "takeoff_quantity" | "linked_takeoff_items" | "composition">
  & { dpgf: Pick<TakeoffDpgfComparisonRow["dpgf"], "unit" | "description" | "length_factor">;
    applied_decision?: Pick<NonNullable<TakeoffDpgfComparisonRow["applied_decision"]>, "decision"> | null };

const round4 = (value: number) => Number(value.toFixed(4));

/**
 * TI-696: a reconciliation row's pair on the total its DPGF line will hold, the other takeoffs it keeps and this one, as
 * the proposal judges it (computeTakeoffDpgfRows).
 */
export function dpgfRowQuantityPolicy(row: ReviewedRow) {
  return dpgfQuantityPolicy(row, row.composition ? { measured: row.composition.earlier_quantity,
    protective: row.composition.earlier_protective, printed_gap: row.composition.earlier_printed_gap } : undefined);
}

/** The factor the application rounds the row's line with: the line's own unit; the DPGF source unit for an older row. */
function rowLengthFactor(row: ReviewedRow) {
  return row.dpgf.length_factor !== undefined ? row.dpgf.length_factor : lengthFactor({ unit_code: row.dpgf.unit, description: row.dpgf.description });
}

/**
 * TI-696: the quantity the application writes on a reconciliation row's DPGF line, as it writes it: rounded to four
 * decimals, a length rounded up once to the line's own unit. Fed by this takeoff (a comparable measure, not decided out
 * of scope: feedsDpgfRow): the protective maximum on its total. Otherwise what the line keeps of the other takeoffs (the
 * maximum with its reference), or its DPGF reference when no other takeoff feeds it. Every figure the review states as
 * retained reads it.
 */
/** Before a length's rounding: fed, the protective maximum on the total; unfed, what the line keeps with its reference. */
function rowUnrounded(row: ReviewedRow) {
  const fed = row.linked_takeoff_items.length > 0 && row.applied_decision?.decision !== "out_of_scope";
  const policy = fed ? dpgfRowQuantityPolicy(row) : null;
  if (policy) return round4(policy.priced);
  if (fed && row.takeoff_quantity === null && !row.composition) return null;
  if (row.composition) {
    const kept = (row.composition.unfed_quantity ?? row.composition.earlier_quantity)
      + (row.composition.unfed_protective ?? row.composition.earlier_protective);
    return round4(Math.max(row.dpgf_quantity ?? 0, kept));
  }
  return undefined;
}

export function dpgfRowRetainedQuantity(row: ReviewedRow) {
  const before = rowUnrounded(row);
  if (before === undefined) return row.dpgf_quantity;
  return before === null ? null : roundedMeasure(before, rowLengthFactor(row));
}

/** TI-696: the value before a length's rounding, when rounding moves it (the review says so); null otherwise. */
export function dpgfRowUnroundedQuantity(row: ReviewedRow) {
  const before = rowUnrounded(row);
  const retained = dpgfRowRetainedQuantity(row);
  return typeof before === "number" && retained !== null && retained !== before ? before : null;
}
