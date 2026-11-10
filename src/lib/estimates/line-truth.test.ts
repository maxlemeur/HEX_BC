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
  // H8 after TI-681 (D23): low confidence no longer blocks, so a forced line need not be an unverified quantity. The
  // detail names what an override lifts (no localized proof or page, results to compute again, a blocking rule), never
  // « Quantité non vérifiée » for every forced line. Internal only: the client documents print the ordinary line.
  it("shows a forced takeoff line as an internal provision to review, naming what the override lifted", () => {
    const truth = resolveEstimateLineTruth(line("takeoff", marked(FORCED)));
    expect(truth?.qtyStatus).toEqual({
      code: "internal_provision",
      label: "Provision interne",
      detail: "Ligne forcée à l’application du métré : un administrateur a levé ce qui la bloquait (preuve localisée ou "
        + "page source manquante, règles à recalculer, ou règle bloquante en échec, comme un matériau interdit). Son montant "
        + "est une provision interne ; le client voit une ligne ordinaire.",
    });
    expect(truth?.qtyStatus.detail).not.toMatch(/non vérifiée/);
    expect(truth?.needsReview).toBe(true);
    expect(truth?.source.kind).toBe("plan");
  });

  // TI-686 D10 (M4): the marker carries each forced line's coded reason; the internal detail names it.
  it("names the coded reason of a forced line, once per reason", () => {
    const evidence = { ...FORCED, forced_reason: "additional_evidence" };
    const falsePositive = { ...FORCED, takeoff_item_id: "c3000000-0000-4000-8000-000000000302", forced_reason: "rule_false_positive" };
    expect(resolveEstimateLineTruth(line("takeoff", marked(evidence)))?.qtyStatus.detail).toBe(
      "Ligne forcée à l’application du métré (motif : Preuve complémentaire) : un administrateur a levé ce qui la bloquait "
      + "(preuve localisée ou page source manquante, règles à recalculer, ou règle bloquante en échec, comme un matériau "
      + "interdit). Son montant est une provision interne ; le client voit une ligne ordinaire.");
    expect(resolveEstimateLineTruth(line("takeoff", marked(evidence, falsePositive, { ...evidence,
      takeoff_item_id: "c3000000-0000-4000-8000-000000000304" })))?.qtyStatus.detail)
      .toMatch(/^Ligne forcée à l’application du métré \(motifs : Preuve complémentaire, Faux positif de règle\) : /);
  });

  // The marker stores the reason as any text: only the six codes have a label, never a key every object inherits (it
  // would print a function or an object in the detail).
  it("names no reason for a stored code that is not one of the six, inherited keys included", () => {
    const withoutReason = resolveEstimateLineTruth(line("takeoff", marked(FORCED)))?.qtyStatus.detail;
    for (const forced_reason of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "trust_me"]) {
      expect(resolveEstimateLineTruth(line("takeoff", marked({ ...FORCED, forced_reason })))?.qtyStatus.detail, forced_reason)
        .toBe(withoutReason);
    }
  });

  it("says a line forced as a priced hypothesis was forced, not entered", () => {
    const truth = resolveEstimateLineTruth(line("takeoff", marked({ ...FORCED, forced_reason: "priced_hypothesis" })));
    expect(truth?.qtyStatus).toEqual({
      code: "hypothesis",
      label: "Hypothèse",
      detail: "Ligne forcée à l’application du métré comme hypothèse chiffrée : provision à confirmer ; le client voit une "
        + "ligne ordinaire.",
    });
  });

  it("shows a quantity entered as a hypothesis as a hypothesis, forced or not", () => {
    for (const metadata of [marked(HYPOTHESIS), marked(FORCED, HYPOTHESIS), marked({ ...FORCED, forced_reason: "priced_hypothesis" },
      HYPOTHESIS)]) {
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
