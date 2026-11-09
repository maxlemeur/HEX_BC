import { describe, expect, it } from "vitest";
import { affaireIntakeClassificationAiResultSchema, createEmptyAffaireIntakeExtractedMetadata, normalizeAffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";
import { withAffaireAiCategoryProposal } from "@/lib/affaires/intake-reanalysis";
import { buildIntakeAnalysisFeedback } from "@/lib/affaires/intake-analysis-feedback";

describe("server-owned AI proposal", () => {
  it("survives reading storage while keeping nature and extraction", () => {
    const result = withAffaireAiCategoryProposal({ documentKind: "plans", confidence: 0.93, issues: [], extractedMetadata: {
      ...createEmptyAffaireIntakeExtractedMetadata(), documentNature: "Vue isométrique", clientName: "Client fictif",
    } }, "2026-11-09T12:00:00.000Z");
    expect(normalizeAffaireIntakeExtractedMetadata(result.extractedMetadata)).toEqual(result.extractedMetadata);
    expect(result.extractedMetadata.aiCategoryProposal).toMatchObject({ category: "plans", nature: "Vue isométrique", confidence: 0.93 });
  });
  it("does not let a provider invent the server proposal date or discard facts when a stored proposal is invalid", () => {
    const facts = { ...createEmptyAffaireIntakeExtractedMetadata(), clientName: "Client conservé" };
    const forged = { ...facts, aiCategoryProposal: { category: "plans", confidence: 1, analyzedAt: "inventé", nature: null } };
    expect(affaireIntakeClassificationAiResultSchema.safeParse({ documentKind: "plans", confidence: 1, issues: [], extractedMetadata: forged }).success).toBe(false);
    expect(normalizeAffaireIntakeExtractedMetadata(forged)).toEqual(facts);
  });
});

describe("per-file analysis feedback", () => {
  it("identifies the failed filename and reason without claiming that a nonexistent remainder was skipped", () => {
    const result = buildIntakeAnalysisFeedback([
      { fileName: "premier.pdf", succeeded: true, manualPreserved: true },
      { fileName: "second.docx", succeeded: false, manualPreserved: true, reason: "Le fichier Word est protégé." },
      { fileName: "dernier.doc", succeeded: true, manualPreserved: true },
    ], []);
    expect(result.message).toContain("2 pièces analysées. 1 pièce non analysée.");
    expect(result.failures).toEqual(["second.docx : Le fichier Word est protégé."]);
    expect(result.failures.join(" ")).not.toContain("restante");
  });
  it("names unstarted files after a provider failure", () => {
    const result = buildIntakeAnalysisFeedback([{ fileName: "source.pdf", succeeded: false, manualPreserved: true, reason: "Connexion expirée." }], ["suivant.docx"]);
    expect(result.failures).toEqual(["source.pdf : Connexion expirée.", "suivant.docx : analyse non lancée après l’interruption précédente."]);
  });
});
