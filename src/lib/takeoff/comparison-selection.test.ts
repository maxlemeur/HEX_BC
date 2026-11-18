import { describe, expect, it } from "vitest";

import { comparisonSelectionPatches, exclusionReasonText } from "@/lib/takeoff/comparison-selection";

// The independent review of eea9e030: the reason « Appliquer la sélection » writes on a line not retained when two
// extractions are compared changed on 2026-11-18 from « Cherry-pick diff TKF-032 » to « Non retenue à la comparaison des
// extractions ». The rows written before still showed the old text, and applying the same selection again rewrote each
// of them although nothing changed. Written before the fix.

const line = (id: string, is_excluded: boolean, exclusion_reason: string | null) => ({ id, updated_at: "2026-11-04T10:00:00.000Z",
  is_excluded, exclusion_reason });

describe("comparisonSelectionPatches", () => {
  it("leaves a line already left out by an earlier selection as it is, whichever wording it was stored with", () => {
    const items = [line("a", false, null), line("b", true, "Cherry-pick diff TKF-032"),
      line("c", true, "Non retenue à la comparaison des extractions")];
    expect(comparisonSelectionPatches(items, new Set(["a"]))).toEqual([]);
  });

  it("writes the selection's change only: a line brought back, a line left out with the current wording", () => {
    const items = [line("a", true, "Cherry-pick diff TKF-032"), line("b", false, null), line("c", true, "Hors lot.")];
    expect(comparisonSelectionPatches(items, new Set(["a"]))).toEqual([
      { item_id: "a", updated_at: "2026-11-04T10:00:00.000Z", fields: { is_excluded: false, exclusion_reason: null } },
      { item_id: "b", updated_at: "2026-11-04T10:00:00.000Z",
        fields: { is_excluded: true, exclusion_reason: "Non retenue à la comparaison des extractions" } },
      // A reason the reviewer wrote is the selection's to replace, as before.
      { item_id: "c", updated_at: "2026-11-04T10:00:00.000Z",
        fields: { is_excluded: true, exclusion_reason: "Non retenue à la comparaison des extractions" } },
    ]);
  });
});

describe("exclusionReasonText", () => {
  it("shows the French wording for a line stored with the old one, any other reason as written", () => {
    expect(exclusionReasonText("Cherry-pick diff TKF-032")).toBe("Non retenue à la comparaison des extractions");
    expect(exclusionReasonText("Hors lot.")).toBe("Hors lot.");
  });
});
