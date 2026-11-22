import { describe, expect, it } from "vitest";

import { parseTakeoffItemAnswer, parseTakeoffItemPlanReading, takeoffItemAnswersRefusal } from "./item-answers";

// An answer as private.takeoff_item_answer_document builds it (20261122080845_takeoff_item_answers.sql). Fictional values.
const uuid = (n: number) => `d5300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = (overrides: Record<string, unknown> = {}) => ({
  answer_id: uuid(1), job_id: uuid(2), item_id: uuid(3), list_revision_id: uuid(4), plan_file_id: uuid(5),
  plan_logical_id: uuid(6), plan_generation: null, outcome: "uncertain", quantity: null, unit: null, candidate_quantity: 1,
  candidate_unit: "u", searched_pages: [2], unreadable_pages: [7],
  reasons: [{ code: "QUALIFIER_UNREADABLE", by: "model", text: "Le diamètre est illisible (fictif).", chunk_id: "f1-b1" },
    { code: "PAGES_UNREADABLE", by: "worker", text: null, chunk_id: null }],
  reason_code: "QUALIFIER_UNREADABLE", reason_text: "Le diamètre est illisible (fictif).", revision: "a".repeat(64),
  reading_revision: 1, replaces_answer_id: null, published_at: "2026-11-22T09:00:00+00:00",
  observations: [{ observation_id: uuid(7), ordinal: 1, role: "candidate", source: "vector", page: 2, quantity: 4.5, unit: "m",
    measurement_basis: null, evidence: "Réseau EF fictif", confidence: 0.7, method: "vector_reading", chunk_id: null,
    vector_item_id: uuid(8), takeoff_item_id: null, occurrence_coverage: "page_total" }],
  ...overrides,
});

describe("parseTakeoffItemAnswer", () => {
  it("reads an uncertain answer: a candidate value, never a quantity, and its reasons in order", () => {
    const answer = parseTakeoffItemAnswer(document());
    expect(answer.quantity).toBeNull();
    expect(answer.candidate).toEqual({ value: 1, unit: "u" });
    expect(answer.reasons.map(({ code, by }) => `${by}:${code}`)).toEqual(["model:QUALIFIER_UNREADABLE", "worker:PAGES_UNREADABLE"]);
    expect(answer.reasonText).toBe("Le diamètre est illisible (fictif).");
    expect(answer.observations[0]).toMatchObject({ role: "candidate", source: "vector", takeoffItemId: null, vectorItemId: uuid(8) });
  });

  it("reads « not found » without any quantity: null, never 0", () => {
    const answer = parseTakeoffItemAnswer(document({ outcome: "not_found", candidate_quantity: null, candidate_unit: null,
      unreadable_pages: [], searched_pages: [2, 7], observations: [] }));
    expect(answer.quantity).toBeNull();
    expect(answer.candidate).toBeNull();
  });

  it("refuses an observation of an unknown role or without its identity", () => {
    expect(() => parseTakeoffItemAnswer(document({ observations: [{ ...document().observations[0], role: "measure" }] })))
      .toThrow(/rôle/);
    expect(() => parseTakeoffItemAnswer(document({ observations: [{ ...document().observations[0], observation_id: null }] })))
      .toThrow(/identifiant/);
  });

  it("refuses a quantity without its unit", () => {
    expect(() => parseTakeoffItemAnswer(document({ outcome: "measured", quantity: 3, unit: null }))).toThrow(/quantité/);
  });
});

describe("parseTakeoffItemPlanReading", () => {
  it("reads a plan being read before any answer exists", () => {
    expect(parseTakeoffItemPlanReading({ plan_logical_id: uuid(6), plan_file_id: uuid(5), plan_name: "plan-1.pdf",
      plan_generation: null, job_id: uuid(2), unit_state: "running", reading: "in_flight", answer: null }))
      .toEqual({ plan: { logicalId: uuid(6), fileId: uuid(5), name: "plan-1.pdf", generation: null }, jobId: uuid(2),
        unitState: "running", reading: "in_flight", answer: null });
  });

  it("refuses a unit state it does not know", () => {
    expect(() => parseTakeoffItemPlanReading({ plan_logical_id: uuid(6), job_id: uuid(2), unit_state: "paused",
      reading: "in_flight", answer: null })).toThrow(/état/);
  });
});

describe("takeoffItemAnswersRefusal", () => {
  it("names the publication's own refusals, and nothing else", () => {
    expect(takeoffItemAnswersRefusal("TAKEOFF_ANSWERS_MEASURED_INVALID")).toBe("TAKEOFF_ANSWERS_MEASURED_INVALID");
    expect(takeoffItemAnswersRefusal("duplicate key value violates unique constraint")).toBeNull();
    expect(takeoffItemAnswersRefusal(undefined)).toBeNull();
  });
});
