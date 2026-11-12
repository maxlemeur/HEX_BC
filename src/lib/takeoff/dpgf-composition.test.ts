import { describe, expect, it } from "vitest";

import { buildDpgfApplyQuantityPolicy } from "@/lib/takeoff/dpgf-apply-quantities";
import type { TakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { normalizeTakeoffComparisonItems } from "@/lib/takeoff/dpgf-comparison-preparation";
import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";
import {
  composeDpgfTarget,
  dpgfLineContribution,
  readStoredDpgfComposition,
  removeDpgfParts,
  upgradeDpgfComposition,
  type DpgfContribution,
} from "@/lib/takeoff/dpgf-composition";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

// TI-682 lot D4: a DPGF target sums what the takeoffs it keeps bring to it. Written before the application sums (the
// module did not exist). Fictional identifiers and quantities.

const versionId = "11111111-1111-4111-8111-111111111111";
const jobOne = "22222222-2222-4222-8222-222222222221";
const jobTwo = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333";
const itemId = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

/** A deterministic sequence (no flaky draw): a linear congruential generator. */
function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

type Kind = "length" | "surface";
const DPGF = { length: { title: "EF cuivre DN 22", unit: "ml" }, surface: { title: "Revêtement de sol", unit: "m2" } } as const;

/** Frozen takeoff lines as the database returns them (quantity numeric(12,3)); a vector surface carries its model reading. */
function frozenLines(kind: Kind, draw: () => number, count: number, offset: number): TakeoffJobItem[] {
  return Array.from({ length: count }, (_, index) => {
    const quantity = Math.round(draw() * 40_000) / 1000;
    const model = kind === "surface" ? Math.round(draw() * 40_000_000) / 1_000_000 : quantity;
    const printed = kind === "surface" && draw() < 0.6 ? Math.round(draw() * 40_000) / 1000 : null;
    return { id: itemId(offset + index), job_id: jobOne, designation: DPGF[kind].title, quantity, unit: DPGF[kind].unit,
      confidence: 0.95, evidence: "Mesure fictive", source_file_name: "plan-fictif.pdf", source_page: index + 1,
      is_excluded: false, updated_at: "2026-11-12T08:00:00Z",
      metadata: kind === "surface" ? { rule_inputs: { version: 1, source: "vector", kind: "surface", model_quantity: model,
        room: draw() < 0.8 ? "Local sol net" : "Local", printed_m2: printed, network: null, material: null, dn: null,
        non_observable: null } } : {} } as unknown as TakeoffJobItem;
  });
}

/** The version 1 policy the application wrote before D4, from the same frozen lines (buildDpgfApplyQuantityPolicy). */
function versionOnePolicy(kind: Kind, reference: number | null, items: TakeoffJobItem[]) {
  const comparisonInput = { versionId, jobId: jobOne,
    dpgfLines: [{ estimate_item_id: target, title: DPGF[kind].title, description: null, quantity: reference,
      unit: DPGF[kind].unit, source_page: 1, source_file_name: "dpgf-fictif.xlsx", position: 1 }],
    takeoffLines: normalizeTakeoffComparisonItems(items),
    manualLinks: items.map((item, index) => ({ id: itemId(900 + index), estimate_item_id: target, takeoff_item_id: item.id })),
  } as unknown as Parameters<typeof buildTakeoffDpgfComparison>[0];
  const context = { comparisonInput, estimateItems: [{ id: target, updated_at: "2026-11-12T08:00:00Z", source_provider: "dpgf",
    source_metadata: {} }], takeoffItems: items } as unknown as TakeoffDpgfComparisonContext;
  const [line] = buildDpgfApplyQuantityPolicy(context, buildTakeoffDpgfComparison(comparisonInput).rows);
  if (!line) return null;
  // As 20261112025548 (and 20261110094503 before it) stored it on the target.
  return { takeoff_quantity_policy: { version: 1, job_id: jobOne, reference_quantity: line.reference_quantity,
    measured_quantity: line.measured_quantity, priced_quantity: line.priced_quantity, absolute_gap: line.absolute_gap,
    reviewed: line.reviewed, item_ids: line.takeoff_items.map((item) => item.id).sort() } };
}

const contributing = (items: TakeoffJobItem[]) =>
  normalizeTakeoffComparisonItems(items).map((line) => ({ item_id: line.item_id, quantity: line.quantity, metadata: line.metadata }));

describe("a version 1 policy read as a composition", () => {
  it("splits line by line, giving back exactly the measure and the price the application wrote", () => {
    const draw = sequence(682);
    const checked = { length: 0, surface: 0, protected: 0 };
    for (let round = 0; round < 400; round += 1) {
      const kind: Kind = round % 2 === 0 ? "length" : "surface";
      const items = frozenLines(kind, draw, 1 + Math.floor(draw() * 6), round * 10);
      const reference = draw() < 0.2 ? null : Math.round(draw() * 120_000) / 1000;
      const metadata = versionOnePolicy(kind, reference, items);
      if (!metadata) continue;
      const stored = readStoredDpgfComposition(metadata);
      expect(stored.version).toBe(1);
      if (stored.version !== 1) continue;
      const upgraded = upgradeDpgfComposition(stored, contributing(items));
      expect({ round, split: upgraded.split }).toEqual({ round, split: true });
      const total = composeDpgfTarget(stored.reference, upgraded.contributions);
      expect({ round, measured: total.measured, priced: total.priced })
        .toEqual({ round, measured: stored.measured, priced: Number(stored.priced.toFixed(4)) });
      checked[kind] += 1;
      if (upgraded.contributions.some((entry) => entry.protective > 0)) checked.protected += 1;
    }
    // Both kinds are read, surfaces with and without a printed basis that protects them.
    expect(checked.length).toBeGreaterThan(150);
    expect(checked.surface).toBeGreaterThan(150);
    expect(checked.protected).toBeGreaterThan(50);
  });

  it("keeps one block, never a guessed part, when its lines no longer give back what it wrote", () => {
    const items = frozenLines("length", sequence(7), 2, 0);
    const metadata = versionOnePolicy("length", 50, items)!;
    const stored = readStoredDpgfComposition({ takeoff_quantity_policy: { ...metadata.takeoff_quantity_policy,
      measured_quantity: metadata.takeoff_quantity_policy.measured_quantity + 1 } });
    if (stored.version !== 1) throw new Error("version 1 expected");
    const upgraded = upgradeDpgfComposition(stored, contributing(items));
    expect(upgraded.split).toBe(false);
    expect(upgraded.contributions).toEqual([expect.objectContaining({ job_id: jobOne, item_ids: stored.item_ids,
      quantity: stored.measured })]);
    // A block mixing a removed line and a kept one cannot be cut.
    expect(removeDpgfParts(upgraded.contributions, new Set([stored.item_ids[0]])).indivisible).toHaveLength(1);
  });

  it("reads a target no policy fed as an empty composition", () => {
    expect(readStoredDpgfComposition({ dpgf_source_quantity: 30 })).toEqual({ version: 0 });
  });
});

describe("the composition of a DPGF target", () => {
  const line = (job: string, n: number, quantity: number): DpgfContribution =>
    ({ job_id: job, item_ids: [itemId(n)], quantity, protective: 0, printed_gap: 0 });

  it("sums the takeoffs it keeps, raw, then takes the maximum with the DPGF reference", () => {
    expect(composeDpgfTarget(30, [line(jobOne, 1, 12.4), line(jobTwo, 2, 10.2)]))
      .toEqual({ measured: 22.6, protective: 0, priced: 30, absolute_gap: 7.4 });
    expect(composeDpgfTarget(30, [line(jobOne, 1, 20.004), line(jobTwo, 2, 20.004)]))
      .toEqual({ measured: 40.008, protective: 0, priced: 40.008, absolute_gap: 10.008 });
    expect(composeDpgfTarget(null, [line(jobOne, 1, 4), line(jobTwo, 2, 3)]))
      .toEqual({ measured: 7, protective: 0, priced: 7, absolute_gap: null });
  });

  it("adds what each printed surface protects, line by line", () => {
    const surface = (n: number, measured: number, printed: number) => dpgfLineContribution(jobOne, { item_id: itemId(n),
      quantity: measured, metadata: { rule_inputs: { version: 1, source: "vector", kind: "surface", model_quantity: measured,
        room: "Local sol net", printed_m2: printed, network: null, material: null, dn: null, non_observable: null } } });
    expect(composeDpgfTarget(100, [surface(1, 60, 50), surface(2, 40, 50)]))
      .toEqual({ measured: 100, protective: 10, priced: 110, absolute_gap: 20 });
  });

  it("takes out the page a replacement removes, and only it", () => {
    const parts = [line(jobOne, 1, 10.2), line(jobOne, 2, 5.3), line(jobTwo, 3, 7)];
    const { kept, removed, indivisible } = removeDpgfParts(parts, new Set([itemId(1)]));
    expect(kept.map((entry) => entry.quantity)).toEqual([5.3, 7]);
    expect(removed.map((entry) => entry.quantity)).toEqual([10.2]);
    expect(indivisible).toEqual([]);
  });
});
