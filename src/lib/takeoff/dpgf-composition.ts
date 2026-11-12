import { compareQuantityPairs, surfaceBasis } from "@/lib/takeoff/quantity-policy";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";

// TI-682 lot D4: a DPGF target sums the measures it keeps. Its composition is the list of what each takeoff line still
// brings to it, stored on the target (`source_metadata.takeoff_quantity_policy`, version 2) by the application, which
// owns the arithmetic (SQL twin: private.takeoff_compose_dpgf_targets). This module is the same arithmetic for the
// screens and the apply permit: what a frozen takeoff line brings, how a version 1 policy (one takeoff, written before
// D4) reads as a composition, what replacing a page removes, and the quantity a composition writes.
//
// - A contribution is in the target's unit and raw (never rounded: a length is rounded once, on the sum, as
//   finalize_takeoff_lengths rounds it). It names the frozen takeoff lines it comes from: one line, or a block of several
//   lines when an earlier policy could not be split line by line.
// - The written quantity stays the protective maximum: max(DPGF reference, Σ measured + Σ protective), the protective
//   part being what the printed surfaces of a line add above its measure (dpgfQuantityPolicy).

export type DpgfContribution = {
  job_id: string;
  item_ids: string[];
  /** The measure the lines bring, in the target's unit. */
  quantity: number;
  /** What their printed surfaces add above that measure (0 when none). */
  protective: number;
  /** The gap between their printed and measured surfaces (0 when none). */
  printed_gap: number;
};

/** A takeoff line as the reconciliation reads it (quantity already the one it compares: a vector surface's model). */
export type DpgfContributingLine = { item_id: string; quantity: number; metadata: Record<string, unknown> | null };

const round4 = (value: number) => Number(value.toFixed(4));

/** What one takeoff line brings to a DPGF target it feeds. */
export function dpgfLineContribution(jobId: string, line: DpgfContributingLine): DpgfContribution {
  const inputs = readRuleInputs(line.metadata);
  const printed = inputs?.source === "vector" && inputs.kind === "surface" && surfaceBasis(inputs.room ?? "") === "net_floor"
    && typeof inputs.printed_m2 === "number" && inputs.printed_m2 > 0
    ? compareQuantityPairs([{ reference: inputs.printed_m2, measured: inputs.model_quantity }]) : null;
  return { job_id: jobId, item_ids: [line.item_id], quantity: line.quantity,
    protective: printed ? printed.priced - printed.measured : 0, printed_gap: printed ? printed.absoluteGap : 0 };
}

export type StoredDpgfComposition =
  | { version: 2; reference: number | null; contributions: DpgfContribution[] }
  | { version: 1; reference: number | null; job_id: string; item_ids: string[]; measured: number; priced: number }
  | { version: 0 };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const ids = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value as string[] : null;

/** The composition a target holds: version 2, a version 1 policy (one takeoff), or none (never fed by a policy). */
export function readStoredDpgfComposition(sourceMetadata: unknown): StoredDpgfComposition {
  const policy = record(record(sourceMetadata)?.takeoff_quantity_policy);
  if (!policy) return { version: 0 };
  const reference = finite(policy.reference_quantity);
  if (policy.version === 2 && Array.isArray(policy.contributions)) {
    const contributions = policy.contributions.flatMap((entry) => {
      const value = record(entry);
      const itemIds = ids(value?.item_ids);
      const quantity = finite(value?.quantity);
      return value && typeof value.job_id === "string" && itemIds && itemIds.length > 0 && quantity !== null
        ? [{ job_id: value.job_id, item_ids: itemIds, quantity, protective: finite(value.protective) ?? 0,
          printed_gap: finite(value.printed_gap) ?? 0 }] : [];
    });
    return { version: 2, reference, contributions };
  }
  const itemIds = ids(policy.item_ids);
  const measured = finite(policy.measured_quantity);
  const priced = finite(policy.priced_quantity);
  return typeof policy.job_id === "string" && itemIds && measured !== null && priced !== null
    ? { version: 1, reference, job_id: policy.job_id, item_ids: itemIds, measured, priced } : { version: 0 };
}

/**
 * A version 1 policy as a composition, from its frozen takeoff lines. Split line by line only when the lines give back
 * exactly the measure and the price the policy wrote (same lines, same arithmetic); otherwise one block of the whole
 * takeoff, which a page replacement may remove only whole (never a part guessed).
 */
export function upgradeDpgfComposition(stored: Extract<StoredDpgfComposition, { version: 1 }>,
  lines: readonly DpgfContributingLine[]): { contributions: DpgfContribution[]; split: boolean } {
  const byId = new Map(lines.map((line) => [line.item_id, line]));
  const found = stored.item_ids.map((id) => byId.get(id));
  if (found.every((line): line is DpgfContributingLine => line !== undefined) && found.length > 0) {
    const contributions = found.map((line) => dpgfLineContribution(stored.job_id, line));
    const total = composeDpgfTarget(stored.reference, contributions);
    if (total.measured === round4(stored.measured) && total.priced === round4(stored.priced)) {
      return { contributions, split: true };
    }
  }
  const protective = stored.priced > Math.max(stored.reference ?? 0, stored.measured) ? stored.priced - stored.measured : 0;
  return { split: false, contributions: [{ job_id: stored.job_id, item_ids: [...stored.item_ids], quantity: stored.measured,
    protective, printed_gap: 0 }] };
}

/** What a composition writes: the measure, its protective part and the maximum with the DPGF reference. */
export function composeDpgfTarget(reference: number | null, contributions: readonly DpgfContribution[]) {
  const measured = round4(contributions.reduce((sum, entry) => sum + entry.quantity, 0));
  const protective = round4(contributions.reduce((sum, entry) => sum + entry.protective, 0));
  const printedGap = contributions.reduce((sum, entry) => sum + entry.printed_gap, 0);
  const priced = round4(Math.max(reference ?? 0, measured + protective));
  return { measured, protective, priced,
    absolute_gap: reference === null ? null : round4(Math.max(Math.abs(measured - reference), printedGap)) };
}

/**
 * The composition once the pages replaced are taken out: the contributions of these takeoff lines go. A block that
 * mixes removed and kept lines cannot be cut: `indivisible` names it (the application refuses the replacement).
 */
export function removeDpgfParts(contributions: readonly DpgfContribution[], removedItemIds: ReadonlySet<string>) {
  const kept: DpgfContribution[] = [];
  const removed: DpgfContribution[] = [];
  const indivisible: DpgfContribution[] = [];
  for (const entry of contributions) {
    const gone = entry.item_ids.filter((id) => removedItemIds.has(id)).length;
    if (gone === 0) kept.push(entry);
    else if (gone === entry.item_ids.length) removed.push(entry);
    else indivisible.push(entry);
  }
  return { kept, removed, indivisible };
}

/** Where a composition's line was read, as the screens name it. */
export type DpgfComposedLinePlace = { job_id: string; source_file_name: string | null; source_page: number | null };

export type DpgfEarlierEntry = {
  job_id: string;
  quantity: number;
  /** On a page the takeoff being applied reads again: replaced, or kept with it, by the page's decision. */
  read_again: boolean;
  /** Per page; quantity null for the pages of a block whose part per page is unknown. */
  pages: Array<{ source_file_name: string | null; source_page: number | null; quantity: number | null }>;
};

/**
 * What a DPGF target holds of the other takeoffs, seen from the takeoff being applied: by takeoff and page, the part it
 * keeps whatever the page decisions (`kept`, on pages this takeoff does not read) and the part on pages it reads again.
 */
export function earlierDpgfParts(contributions: readonly DpgfContribution[], input: {
  jobId: string;
  readAgainItemIds: ReadonlySet<string>;
  lines: ReadonlyMap<string, DpgfComposedLinePlace>;
}) {
  const others = contributions.filter((entry) => entry.job_id !== input.jobId);
  const isReadAgain = (entry: DpgfContribution) => entry.item_ids.some((id) => input.readAgainItemIds.has(id));
  const kept = others.filter((entry) => !isReadAgain(entry));
  const entries = new Map<string, DpgfEarlierEntry>();
  for (const entry of others) {
    const readAgain = isReadAgain(entry);
    const key = `${entry.job_id}:${readAgain}`;
    const current = entries.get(key) ?? { job_id: entry.job_id, quantity: 0, read_again: readAgain, pages: [] };
    current.quantity = round4(current.quantity + entry.quantity);
    const split = entry.item_ids.length === 1;
    for (const id of entry.item_ids) {
      const place = input.lines.get(id);
      const page = current.pages.find((known) => known.source_file_name === (place?.source_file_name ?? null)
        && known.source_page === (place?.source_page ?? null));
      if (page && split && page.quantity !== null) page.quantity = round4(page.quantity + entry.quantity);
      else if (page) page.quantity = null;
      else current.pages.push({ source_file_name: place?.source_file_name ?? null, source_page: place?.source_page ?? null,
        quantity: split ? entry.quantity : null });
    }
    entries.set(key, current);
  }
  const sum = (key: "quantity" | "protective" | "printed_gap") => round4(kept.reduce((total, entry) => total + entry[key], 0));
  return { kept, measured: sum("quantity"), protective: sum("protective"), printed_gap: sum("printed_gap"),
    entries: [...entries.values()].sort((left, right) => Number(left.read_again) - Number(right.read_again)
      || left.job_id.localeCompare(right.job_id)) };
}
