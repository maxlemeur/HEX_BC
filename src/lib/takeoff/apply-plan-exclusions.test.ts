import { describe, expect, it } from "vitest";

import { excludeDpgfOutOfScope, readAgainLeavingOutOfScope } from "@/lib/takeoff/apply-plan-exclusions";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/types";

// TI-696 (Codex review of PR 288): the DPGF reconciliation leaves out of a line's total the earlier parts of the pages
// this takeoff reads again. At the application and at « Pages déjà au devis », the mapping plan leaves lines out
// (skipped, folded into an assembly, decided out of scope): a page whose only line it leaves out is not read again, and
// its earlier part stays in the total the application writes. Fictional identifiers.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const onPageOne = id(201);
const onPageTwo = id(202);
const earlierOnPageOne = id(101);

function context() {
  return {
    comparisonInput: { versionId: id(1), jobId: id(2), dpgfLines: [], reviewDecisions: [],
      takeoffLines: [onPageOne, onPageTwo].map((itemId) => ({ item_id: itemId, designation: "WC suspendu", quantity: 5, unit: "u",
        confidence: 0.9, source_page: itemId === onPageOne ? 1 : 2, source_file_name: "plan.pdf", evidence: null, metadata: {} })),
      readAgainItemIds: new Set([earlierOnPageOne]) as ReadonlySet<string> },
    // The pages read again by the lines left in: page 1 only through its line.
    readAgainItemIdsOf: (leftOut: ReadonlySet<string>) => new Set(leftOut.has(onPageOne) ? [] : [earlierOnPageOne]),
  };
}
const preview = (skipped: string[]) => ({ items: [onPageOne, onPageTwo].map((itemId) => ({ item_id: itemId,
  action: skipped.includes(itemId) ? "skip" : "create", transformed: { is_excluded: false } })) }) as unknown as TakeoffPreviewConversionResponse;

describe("the lines the application leaves out", () => {
  it("read no page again: the earlier part of a page whose only line the plan skips stays in the total", () => {
    const input = context();
    excludeDpgfOutOfScope(preview([onPageOne]), input as never);
    expect([input.comparisonInput.takeoffLines.map((line) => line.item_id), [...input.comparisonInput.readAgainItemIds]])
      .toEqual([[onPageTwo], []]);
  });

  it("leave the pages of the lines it brings read again", () => {
    const input = context();
    excludeDpgfOutOfScope(preview([]), input as never);
    expect([...input.comparisonInput.readAgainItemIds]).toEqual([earlierOnPageOne]);
  });
});

describe("the pages a review reads again (TI-696)", () => {
  // Page 1's only line is linked to a DPGF line decided out of scope: the mapping plan skips it at the application, so the
  // review does not read page 1 again either, and the earlier part on it stays in the totals it states.
  it("leaves out the lines of a row decided out of scope", () => {
    const target = id(300);
    const input = { comparisonInput: { versionId: id(1), jobId: id(2), manualLinks: [],
      dpgfLines: [{ estimate_item_id: target, title: "Regard de visite", description: null, quantity: 1, unit: "u", source_page: 1,
        source_file_name: "dpgf.xlsx", position: 1 }],
      takeoffLines: [{ item_id: onPageOne, designation: "Regard de visite", quantity: 1, unit: "u", confidence: 0.9, source_page: 1,
        source_file_name: "plan.pdf", evidence: null, metadata: {} }],
      reviewDecisions: [{ id: id(500), tenant_id: id(3), version_id: id(1), takeoff_job_id: id(2), estimate_item_id: target,
        decision: "out_of_scope", reason: "Hors lot (fictif)", review_reference: "ref", line_label: "Regard de visite", line_position: 1,
        source_file_name: "dpgf.xlsx", source_page: 1, decided_at: "2026-11-12T08:00:00Z", updated_at: "2026-11-12T08:00:00Z",
        decided_by: id(4), quantity_snapshot: {}, source: "current_version", carried_over_from_version_id: null,
        carried_over_from_version_number: null }],
      readAgainItemIds: new Set([earlierOnPageOne]) as ReadonlySet<string> },
      readAgainItemIdsOf: (leftOut: ReadonlySet<string>) => new Set(leftOut.has(onPageOne) ? [] : [earlierOnPageOne]),
    };
    readAgainLeavingOutOfScope(input as never);
    const read = input.comparisonInput as typeof input.comparisonInput & { readAgainIfFed?: ReadonlyMap<string, ReadonlySet<string>> };
    expect([[...read.readAgainItemIds], [...(read.readAgainIfFed?.get(target) ?? [])]]).toEqual([[], [earlierOnPageOne]]);
  });
});
