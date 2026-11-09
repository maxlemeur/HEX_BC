import { describe, expect, it } from "vitest";

import { resolveEstimateLineTruth } from "@/lib/estimates/line-truth";

// TI-686 D10/D12: in the internal estimate, a line the takeoff application marked (forced line, hypothesis) says its
// amount is a provision; the client sees an ordinary priced line (H9).
const JOB_ID = "c3000000-0000-4000-8000-000000000201";
const FORCED = { takeoff_item_id: "c3000000-0000-4000-8000-000000000301", forced: true, forced_reason: null, entry_category: null };
const HYPOTHESIS = {
  takeoff_item_id: "c3000000-0000-4000-8000-000000000303", forced: false, forced_reason: null, entry_category: "hypothesis",
};
const line = (provider: string, sourceMetadata: unknown) => ({
  item_type: "line" as const, quantity: 12.5, source_provider: provider, source_file_name: "plan-fictif.pdf",
  source_level: "C", source_metadata: sourceMetadata,
});
const marked = (...sources: unknown[]) => ({ takeoff_item_id: FORCED.takeoff_item_id,
  takeoff_provision: { version: 1, job_id: JOB_ID, sources } });

describe("resolveEstimateLineTruth, takeoff provisions", () => {
  it("shows a forced takeoff line as an internal provision to review", () => {
    const truth = resolveEstimateLineTruth(line("takeoff", marked(FORCED)));
    expect(truth?.qtyStatus).toEqual({
      code: "internal_provision",
      label: "Provision interne",
      detail: "Ligne forcée à l’application du métré. Quantité non vérifiée : son montant est une provision interne ; le client voit une ligne ordinaire.",
    });
    expect(truth?.needsReview).toBe(true);
    expect(truth?.source.kind).toBe("plan");
  });

  it("shows a quantity entered as a hypothesis, or forced as a priced hypothesis, as a hypothesis", () => {
    for (const metadata of [marked(HYPOTHESIS), marked(FORCED, HYPOTHESIS), marked({ ...FORCED, forced_reason: "priced_hypothesis" })]) {
      const truth = resolveEstimateLineTruth(line("takeoff", metadata));
      expect(truth?.qtyStatus).toEqual({
        code: "hypothesis",
        label: "Hypothèse",
        detail: "Quantité saisie sur hypothèse au métré : provision à confirmer ; le client voit une ligne ordinaire.",
      });
      expect(truth?.needsReview).toBe(true);
    }
  });

  it("marks a DPGF line reconciled from a forced run the same way, keeping its DPGF source", () => {
    const truth = resolveEstimateLineTruth(line("dpgf", { dpgf_source_quantity: 30, takeoff_quantity_policy: { version: 1 },
      takeoff_provision: { version: 1, job_id: JOB_ID, sources: [FORCED] } }));
    expect(truth?.qtyStatus.code).toBe("internal_provision");
    expect(truth?.source.kind).toBe("dpgf");
  });

  it("keeps a takeoff line without marker measured", () => {
    expect(resolveEstimateLineTruth(line("takeoff", { takeoff_item_id: FORCED.takeoff_item_id }))?.qtyStatus.code).toBe("measured");
  });

  it("counts an unreadable marker as an internal provision", () => {
    const truth = resolveEstimateLineTruth(line("takeoff", { takeoff_provision: { version: 1, sources: "?" } }));
    expect(truth?.qtyStatus).toEqual({
      code: "internal_provision",
      label: "Provision interne",
      detail: "Marqueur de provision illisible : la ligne est traitée comme une provision interne ; le client voit une ligne ordinaire.",
    });
    expect(truth?.needsReview).toBe(true);
  });
});
