import { describe, expect, it } from "vitest";

import {
  buildAffaireIntakeMissingPieces,
  deriveAffaireIntakeUploadStatusFromDocuments,
  getHeuristicAffaireDocumentClassification,
  mergeAffaireDocumentClassificationWithHeuristic,
} from "@/lib/affaires/intake";

describe("affaire intake helpers", () => {
  it("classifies email files strongly from filename", () => {
    const result = getHeuristicAffaireDocumentClassification({
      fileName: "courrier-client.eml",
      mimeType: "message/rfc822",
    });

    expect(result.documentKind).toBe("emails");
    expect(result.confidence).toBeGreaterThan(0.95);
  });

  it("keeps a strong filename signal when AI falls back to a_classer", () => {
    const merged = mergeAffaireDocumentClassificationWithHeuristic({
      aiResult: {
        documentKind: "a_classer",
        confidence: 0.31,
        issues: ["Document peu lisible."],
        extractedMetadata: {
          projectName: null,
          clientName: null,
          deadlineAt: null,
          detectedLots: [],
          detectedVariants: [],
        },
      },
      heuristicResult: {
        documentKind: "dpgf",
        confidence: 0.92,
        issues: [],
        extractedMetadata: {
          projectName: null,
          clientName: null,
          deadlineAt: null,
          detectedLots: [],
          detectedVariants: [],
        },
      },
    });

    expect(merged.documentKind).toBe("dpgf");
    expect(merged.confidence).toBeGreaterThanOrEqual(0.92);
    expect(merged.issues).toContain(
      "Le nom du fichier a ete retenu comme signal principal pour la categorie."
    );
  });

  it("computes a partial failure when at least one uploaded document stays ambiguous", () => {
    const status = deriveAffaireIntakeUploadStatusFromDocuments([
      {
        uploadStatus: "uploaded",
        classificationStatus: "classified",
        documentKind: "dpgf",
      },
      {
        uploadStatus: "uploaded",
        classificationStatus: "ambiguous",
        documentKind: "a_classer",
      },
    ]);

    expect(status).toBe("partial_failure");
  });

  it("flags the expected missing pieces for an incomplete dossier", () => {
    const missingPieces = buildAffaireIntakeMissingPieces([
      {
        uploadStatus: "uploaded",
        classificationStatus: "classified",
        documentKind: "plans",
      },
      {
        uploadStatus: "uploaded",
        classificationStatus: "classified",
        documentKind: "emails",
      },
    ]);

    expect(missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_dpgf",
          severity: "critical",
        }),
        expect.objectContaining({
          code: "missing_cctp",
          severity: "warning",
        }),
        expect.objectContaining({
          code: "missing_bpu_dqe",
          severity: "warning",
        }),
      ])
    );
    expect(missingPieces).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_plans",
        }),
      ])
    );
  });
});
