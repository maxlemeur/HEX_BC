import { describe, expect, it } from "vitest";

import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";
import { applyTakeoffPreparationProposal, createTakeoffPreparationQuestion, orderTakeoffPreparationQuestions, preparationProposalFieldSchema, type TakeoffPreparationProposal } from "@/lib/takeoff/preparation-assistance";

function draft() {
  const preparation = createEmptyTakeoffPreparation();
  preparation.sources = [{ document_id: "plan-a", document_name: "Plan R+1.pdf", source_version: "hash-a", revision: "A",
    kind: "plan", pages: [], active: true, confirmed: false, plan_set_id: null, file_path: null, page_count: 2, logical_document_id: null, content_hash: null, source_updated_at: null, mime_type: "application/pdf" }];
  return preparation;
}
const proposal: TakeoffPreparationProposal = { id: "proposal:a", field: "scope.levels", values: ["R+1"],
  source_document_ids: ["plan-a"], explanation: "Niveau proposé à partir de la pièce", status: "proposed" };

describe("explicit acceptance of preparation proposals", () => {
  it("orders known questions without removing low-scored blockers or unranked points", () => {
    const questions = [{ id: "blocking", impact: "blocking" }, { id: "optional", impact: "reservation" }, { id: "unranked", impact: "blocking" }];
    expect(orderTakeoffPreparationQuestions(questions, ["optional", "blocking"]).map((question) => question.id))
      .toEqual(["optional", "blocking", "unranked"]);
    expect(questions[0].id).toBe("blocking");
  });
  it("adds sourced scope content without deleting existing input or confirming it", () => {
    const preparation = draft();
    preparation.scope.levels = ["RDC"];
    preparation.processing = { level: "C", provider: "chatgpt" };
    const result = applyTakeoffPreparationProposal(preparation, proposal);
    expect(result.scope.levels).toEqual(["RDC", "R+1"]);
    expect(result.scope.confirmed).toBe(false);
    expect(preparation.scope.levels).toEqual(["RDC"]);
    expect(result.processing).toEqual({ level: "C", provider: "chatgpt" });
    expect(preparationProposalFieldSchema.safeParse("processing.provider").success).toBe(false);
    expect(preparationProposalFieldSchema.safeParse("processing.level").success).toBe(false);
  });

  it("never overwrites confirmed scope, an existing objective or a recorded unit", () => {
    const preparation = draft();
    preparation.scope.confirmed = true;
    preparation.objective = "count";
    preparation.conventions.unit = "u";
    expect(applyTakeoffPreparationProposal(preparation, proposal)).toBe(preparation);
    expect(applyTakeoffPreparationProposal(preparation, { ...proposal, field: "objective", values: ["estimate"] })).toBe(preparation);
    expect(applyTakeoffPreparationProposal(preparation, { ...proposal, field: "conventions.unit", values: ["m"] })).toBe(preparation);
  });

  it("rejects ungrounded and stale source references", () => {
    const preparation = draft();
    expect(applyTakeoffPreparationProposal(preparation, { ...proposal, source_document_ids: [] })).toBe(preparation);
    expect(applyTakeoffPreparationProposal(preparation, { ...proposal, source_document_ids: ["other-tenant-file"] })).toBe(preparation);
  });

  it("records an unanswered clarification with no invented responsible person or answer", () => {
    const preparation = draft();
    const result = createTakeoffPreparationQuestion(preparation, { id: "question:a", question: "La zone terrasse est-elle incluse ?",
      source_document_ids: ["plan-a"], explanation: "Périmètre à préciser", status: "proposed" });
    expect(result.unknowns[0]).toMatchObject({ status: "open", answer: null, responsible: null, source_document_id: "plan-a" });
    expect(result.sources[0].confirmed).toBe(false);
  });
});
