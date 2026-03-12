import { describe, expect, it } from "vitest";

import {
  affaireIntakeBriefDraftSchema,
  affaireIntakeExtractedMetadataSchema,
  buildAffaireIntakeMissingPieces,
  deriveAffaireIntakeUploadStatusFromDocuments,
  getDefaultAffaireIntakeDocumentPriority,
  getHeuristicAffaireDocumentClassification,
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeDocumentProcessing,
  isAffaireIntakePrimaryEligibleKind,
  mergeAffaireDocumentClassificationWithHeuristic,
  normalizeAffaireIntakeTextList,
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

  it("allows only DPGF and CCTP to be primary categories", () => {
    expect(isAffaireIntakePrimaryEligibleKind("dpgf")).toBe(true);
    expect(isAffaireIntakePrimaryEligibleKind("cctp")).toBe(true);
    expect(isAffaireIntakePrimaryEligibleKind("plans")).toBe(false);
  });

  it("defaults the first DPGF to primary and later ones to secondary", () => {
    expect(
      getDefaultAffaireIntakeDocumentPriority({
        documentKind: "dpgf",
        hasExistingPrimary: false,
      })
    ).toBe("primary");
    expect(
      getDefaultAffaireIntakeDocumentPriority({
        documentKind: "dpgf",
        hasExistingPrimary: true,
      })
    ).toBe("secondary");
    expect(
      getDefaultAffaireIntakeDocumentPriority({
        documentKind: "plans",
        hasExistingPrimary: false,
      })
    ).toBe("secondary");
  });

  it("treats queued and processing documents as still processing", () => {
    expect(
      isAffaireIntakeDocumentProcessing({
        classificationStatus: "queued",
        detectedCategory: "a_classer",
        confidence: 0,
        issues: [],
      })
    ).toBe(true);
    expect(
      isAffaireIntakeDocumentProcessing({
        classificationStatus: "processing",
        detectedCategory: "plans",
        confidence: 0.92,
        issues: ["Analyse en cours"],
      })
    ).toBe(true);
  });

  it("prefers the persisted classification status over local confidence heuristics", () => {
    expect(
      isAffaireIntakeDocumentNeedingReview({
        classificationStatus: "classified",
        detectedCategory: "annexes",
        confidence: 0.24,
        issues: ["Faible confiance initiale"],
      })
    ).toBe(false);

    expect(
      isAffaireIntakeDocumentNeedingReview({
        classificationStatus: "failed",
        detectedCategory: "plans",
        confidence: 0.98,
        issues: ["OCR indisponible"],
      })
    ).toBe(true);
  });

  it("normalizes and deduplicates editable brief lists", () => {
    expect(
      normalizeAffaireIntakeTextList(
        ["  Lot gros oeuvre  ", "", "LOT GROS OEUVRE", "Facade"],
        {
          maxItems: 5,
          maxLength: 40,
        }
      )
    ).toEqual(["Lot gros oeuvre", "Facade"]);
  });

  it("accepts postgres timestamps with timezone offsets in brief payloads", () => {
    expect(
      affaireIntakeExtractedMetadataSchema.safeParse({
        projectName: null,
        clientName: null,
        deadlineAt: "2026-03-06T21:33:39.288+00:00",
        detectedLots: [],
        detectedVariants: [],
      }).success
    ).toBe(true);

    expect(
      affaireIntakeBriefDraftSchema.safeParse({
        status: "a_confirmer",
        summary: "Brief provisoire.",
        projectObject: "Projet a confirmer",
        scope: ["Lot plomberie"],
        lots: ["Plomberie"],
        receivedPieces: ["Plans · sample-plan.pdf"],
        assumptions: ["Client a confirmer"],
        vigilancePoints: ["Verifier le perimetre"],
        missingElements: ["DPGF manquant"],
        sources: [
          {
            blockKey: "summary",
            entryIndex: 0,
            sourceDocumentId: "8ce5d0a8-8e1d-4a68-9e04-1248c8a34d27",
            sourceFileName: "sample-plan.pdf",
            rationale: null,
          },
        ],
        uploadId: "c4afc8ca-f94e-43e3-9780-7ee807e0e9be",
        lastGeneratedAt: "2026-03-06T21:33:39.288+00:00",
        confirmedAt: "2026-03-06T21:34:39.288+00:00",
      }).success
    ).toBe(true);
  });
});
