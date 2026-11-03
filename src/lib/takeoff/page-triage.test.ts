// Ways the page triage rules can fail, written before the code (AGENTS.md).
// The army journey covers one accepted proposal and one reintegration; these
// cases cover what a browser run cannot reach reliably:
// - a level/zone token read inside another word, a spelling variant offered twice,
//   a two-digit level cut, a decimal coordinate read as a zone (A1-A3, A6);
// - `inconnu` missing, the question asked when it is the only candidate, too many
//   or duplicate choices (A4, A5);
// - an exclusion proposed when the type is not answered, under the threshold, at
//   null confidence, on a partial/failed call, after an exception or without a
//   thumbnail, or for a kept type; a threshold lowered below 0.8 (B1-B4, B6);
// - all pages excluded written as `pages: []` instead of `active: false` (B5);
// - a user correction overwritten by a new acceptance (E5);
// - a page_triage with unknown keys, duplicate pages or a partial page list (E2).
import { describe, expect, it } from "vitest";

import {
  acceptTakeoffPageTriage,
  buildTakeoffPageTriageQuestions,
  decideTakeoffPageTriage,
  extractTakeoffLevelZoneCandidates,
  normalizeTakeoffLevel,
  normalizeTakeoffZone,
  reconcileTakeoffPageTriageStatuses,
  setTakeoffSourcePageRetained,
  TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD,
  takeoffPageTriageSchema,
  type TakeoffPageTriage,
} from "@/lib/takeoff/page-triage";
import type { TakeoffPreparationSource } from "@/lib/takeoff/preparation";

const typeAnswer = (value: string, confidence: number | null, status: "answered" | "refused" | "missing" | "invalid" = "answered") =>
  ({ status, value: status === "answered" ? value : null, confidence });

function triage(pages: Array<{ page: number; proposal: "exclude" | "keep" | "review"; status?: "proposed" | "to_review" | "corrected" }>, accepted = false): TakeoffPageTriage {
  return {
    source_version: "v1", page_count: pages.length, questions_fingerprint: "a".repeat(64), model: "gpt-6-luna",
    prompt_version: "takeoff-page-triage-v1", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    generated_at: "2026-11-03T10:00:00.000Z", accepted,
    pages: pages.map((entry) => ({
      page: entry.page, request_fingerprint: "b".repeat(64), type: entry.proposal === "exclude" ? "facade" : "reseau",
      level: null, zone: null, confidence: entry.proposal === "review" ? 0.4 : 0.95, proposal: entry.proposal,
      status: entry.status ?? (entry.proposal === "review" ? "to_review" : "proposed"),
      reason: entry.proposal === "review" ? "low_confidence" : null,
    })),
  };
}

function source(page_triage: TakeoffPageTriage | null, patch: Partial<TakeoffPreparationSource> = {}): TakeoffPreparationSource {
  return {
    document_id: "file-a", document_name: "Façade et plan.pdf", kind: "plan", revision: "A", source_version: "v1",
    pages: [], active: true, confirmed: true, plan_set_id: "set-a", file_path: "tenant/set/file.pdf",
    page_count: page_triage?.page_count ?? 2, logical_document_id: null, content_hash: null, source_updated_at: null,
    mime_type: "application/pdf", page_triage, ...patch,
  };
}

describe("level and zone candidates", () => {
  it("normalises spelling variants to one token", () => {
    expect(["R + 4", "r+04", "Niveau R+4", "R+4"].map(normalizeTakeoffLevel)).toEqual(["R+4", "R+4", "R+4", "R+4"]);
    expect(["R+10", "R -2", "R-1", "rdc", "Rez-de-chaussée", "SS1", "SS 2", "SS-3", "Sous-sol 4"].map(normalizeTakeoffLevel))
      .toEqual(["R+10", "R-2", "R-1", "RDC", "RDC", "SS1", "SS2", "SS3", "SS4"]);
    expect(["Zone 1", "ZONE 2", "z3", "Z 4", "Z-5"].map(normalizeTakeoffZone)).toEqual(["Z1", "Z2", "Z3", "Z4", "Z5"]);
    expect(["Tous", "L00", "GANTRY", "Zone A", ""].map((value) => [normalizeTakeoffLevel(value), normalizeTakeoffZone(value)]))
      .toEqual([[null, null], [null, null], [null, null], [null, null], [null, null]]);
  });

  it("reads tokens on word boundaries only and never a decimal coordinate", () => {
    const text = "PLAN PLB-R+4-Z1 DN 22 DZ12 RDCH ZONE1A Axe Z 2,96 m Z=3 cote Z 1.50 R+10 Sous-sol 2 SS-1 Zone 1 rdc R + 4";
    expect(extractTakeoffLevelZoneCandidates(text)).toEqual({ levels: ["SS2", "SS1", "RDC", "R+4", "R+10"], zones: ["Z1"] });
  });

  it("adds normalised scope entries, drops unreadable ones and deduplicates", () => {
    expect(extractTakeoffLevelZoneCandidates("R+2 Z2", { levels: ["R+2", "Niveau R+3", "Tous"], zones: ["Zone 2", "Z3", "aile nord"] }))
      .toEqual({ levels: ["R+2", "R+3"], zones: ["Z2", "Z3"] });
  });

  it("asks only the type when no level or zone is readable, and always offers inconnu otherwise", () => {
    const typeOnly = buildTakeoffPageTriageQuestions({ levels: [], zones: [] });
    expect(typeOnly.map((question) => question.name)).toEqual(["page_type"]);
    const full = buildTakeoffPageTriageQuestions({ levels: ["R+4"], zones: ["Z1", "Z2"] });
    expect(full.map((question) => question.name)).toEqual(["page_type", "page_level", "page_zone"]);
    const values = (name: string) => {
      const question = full.find((entry) => entry.name === name);
      return question?.type === "choice" ? question.choices.map((choice) => choice.value) : [];
    };
    expect(values("page_level")).toEqual(["R+4", "inconnu"]);
    expect(values("page_zone")).toEqual(["Z1", "Z2", "inconnu"]);
  });

  it("caps the choices under the Decisions limit with unique values", () => {
    const text = Array.from({ length: 99 }, (_, index) => `R+${index + 1} R-${index + 1} SS${index + 1} Z${index + 1}`).join(" ");
    const questions = buildTakeoffPageTriageQuestions(extractTakeoffLevelZoneCandidates(text));
    for (const question of questions) {
      if (question.type !== "choice") continue;
      const values = question.choices.map((choice) => choice.value);
      expect(values.length).toBeLessThanOrEqual(255);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("proposal rule", () => {
  const ok = { callStatus: "available" as const, thumbnail: true };

  it("proposes an exclusion only for an answered excluded type at or above the threshold", () => {
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("coupe", TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD) })).toEqual({ proposal: "exclude", reason: null });
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("facade", 0.79) })).toEqual({ proposal: "review", reason: "low_confidence" });
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("facade", null) })).toEqual({ proposal: "review", reason: "low_confidence" });
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("toiture", 0.99, "refused") })).toEqual({ proposal: "review", reason: "not_answered" });
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("masse", 0.99, "invalid") })).toEqual({ proposal: "review", reason: "not_answered" });
  });

  it("keeps a confident kept type and never excludes after a failure", () => {
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("reseau", 0.99) })).toEqual({ proposal: "keep", reason: null });
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("autre", 0.99) })).toEqual({ proposal: "keep", reason: null });
    expect(decideTakeoffPageTriage({ ...ok, callStatus: "partial", type: typeAnswer("coupe", 0.99) })).toEqual({ proposal: "review", reason: "partial_answer" });
    expect(decideTakeoffPageTriage({ ...ok, callStatus: "failed", type: null })).toEqual({ proposal: "review", reason: "call_failed" });
    expect(decideTakeoffPageTriage({ ...ok, callStatus: "exception", type: null })).toEqual({ proposal: "review", reason: "exception" });
    expect(decideTakeoffPageTriage({ ...ok, thumbnail: false, type: typeAnswer("coupe", 0.99) })).toEqual({ proposal: "review", reason: "thumbnail_missing" });
  });

  it("cannot lower the threshold below the named constant", () => {
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("coupe", 0.6), threshold: 0.5 })).toEqual({ proposal: "review", reason: "low_confidence" });
    expect(decideTakeoffPageTriage({ ...ok, type: typeAnswer("coupe", 0.85), threshold: 0.9 })).toEqual({ proposal: "review", reason: "low_confidence" });
  });
});

describe("acceptance and corrections", () => {
  it("writes the kept pages, reopens the source confirmation and marks the triage accepted", () => {
    const accepted = acceptTakeoffPageTriage(source(triage([{ page: 1, proposal: "exclude" }, { page: 2, proposal: "keep" }])));
    expect(accepted).toMatchObject({ active: true, pages: [2], confirmed: false });
    expect(accepted.page_triage?.accepted).toBe(true);
  });

  it("deactivates a document whose pages are all excluded instead of writing all pages", () => {
    const accepted = acceptTakeoffPageTriage(source(triage([{ page: 1, proposal: "exclude" }, { page: 2, proposal: "exclude" }]), { pages: [] }));
    expect(accepted).toMatchObject({ active: false, pages: [], confirmed: false });
  });

  it("keeps pages to review and writes all pages as the empty list", () => {
    const accepted = acceptTakeoffPageTriage(source(triage([{ page: 1, proposal: "review" }, { page: 2, proposal: "keep" }]), { pages: [2] }));
    expect(accepted).toMatchObject({ active: true, pages: [] });
  });

  it("marks a reintegrated page corrected and never overwrites the correction on a new acceptance", () => {
    const accepted = acceptTakeoffPageTriage(source(triage([{ page: 1, proposal: "exclude" }, { page: 2, proposal: "keep" }])));
    const corrected = setTakeoffSourcePageRetained(accepted, 1, true);
    expect(corrected).toMatchObject({ active: true, pages: [], confirmed: false });
    expect(corrected.page_triage?.pages.map((page) => page.status)).toEqual(["corrected", "proposed"]);
    expect(reconcileTakeoffPageTriageStatuses(corrected)).toEqual(corrected);
    const again = acceptTakeoffPageTriage(corrected);
    expect(again).toMatchObject({ active: true, pages: [] });
    expect(again.page_triage?.pages[0].status).toBe("corrected");
  });

  it("deactivates the document when the last retained page is removed", () => {
    const accepted = acceptTakeoffPageTriage(source(triage([{ page: 1, proposal: "exclude" }, { page: 2, proposal: "keep" }])));
    expect(setTakeoffSourcePageRetained(accepted, 2, false)).toMatchObject({ active: false });
  });

  it("does not mark corrections before the proposal is accepted", () => {
    const proposed = source(triage([{ page: 1, proposal: "exclude" }, { page: 2, proposal: "keep" }]));
    expect(reconcileTakeoffPageTriageStatuses(proposed).page_triage?.pages.map((page) => page.status)).toEqual(["proposed", "proposed"]);
  });
});

describe("page_triage contract", () => {
  it("rejects unknown keys, duplicate pages and a partial page list", () => {
    const valid = triage([{ page: 1, proposal: "exclude" }, { page: 2, proposal: "keep" }]);
    expect(takeoffPageTriageSchema.safeParse(valid).success).toBe(true);
    expect(takeoffPageTriageSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
    expect(takeoffPageTriageSchema.safeParse({ ...valid, pages: [valid.pages[0], valid.pages[0]] }).success).toBe(false);
    expect(takeoffPageTriageSchema.safeParse({ ...valid, pages: [valid.pages[0]] }).success).toBe(false);
    expect(takeoffPageTriageSchema.safeParse({ ...valid, pages: valid.pages.map((page) => ({ ...page, page: page.page + 1 })) }).success).toBe(false);
  });
});
