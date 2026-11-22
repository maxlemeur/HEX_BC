import { describe, expect, it } from "vitest";

import { isAffaireIntakeBriefAwaited } from "@/lib/affaires/intake";

// The analysis marks a dossier's document classified, then writes its brief (intake-analysis-server.ts): a page that
// stopped reading the dossier when the document settled would never show the brief the member is to confirm.
const piece = (classificationStatus: "queued" | "processing" | "classified" | "ambiguous" | "failed", extra: Record<string, unknown> = {}) => ({
  documentId: "aaaaaaaa-0000-4000-8000-000000000060", fileName: "Plan RDC.pdf", uploadStatus: "uploaded" as const,
  detectedCategory: "plans" as const, classificationStatus, confidence: 0.9, issues: [], ...extra,
});
const brief = { status: "a_confirmer" };

describe("isAffaireIntakeBriefAwaited", () => {
  it("awaits the first brief of a dossier whose piece is analysed or being analysed", () => {
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("classified")], briefDraft: null })).toBe(true);
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("ambiguous")], briefDraft: null })).toBe(true);
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("processing")], briefDraft: null })).toBe(true);
  });

  it("awaits nothing once the brief is there", () => {
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("classified")], briefDraft: brief })).toBe(false);
  });

  it("awaits nothing for a dossier without any piece the analysis could write a brief from", () => {
    expect(isAffaireIntakeBriefAwaited({ documents: [], briefDraft: null })).toBe(false);
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("failed")], briefDraft: null })).toBe(false);
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("classified", { uploadStatus: "rejected" })], briefDraft: null })).toBe(false);
    expect(isAffaireIntakeBriefAwaited({ documents: [piece("classified", { isBeingDeleted: true })], briefDraft: null })).toBe(false);
  });

  it("awaits nothing when the dossier could not be read", () => {
    expect(isAffaireIntakeBriefAwaited(null)).toBe(false);
    expect(isAffaireIntakeBriefAwaited(undefined)).toBe(false);
  });
});
