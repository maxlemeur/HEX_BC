import { describe, expect, it } from "vitest";

import { excludeDpgfOutOfScope } from "@/lib/takeoff/apply-plan-exclusions";
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
