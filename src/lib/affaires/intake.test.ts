import { describe, expect, it } from "vitest";

import {
  affaireIntakeBriefDraftSchema,
  affaireIntakeExtractedMetadataSchema,
  buildAffaireIntakeReadinessSnapshot,
  buildAffaireIntakeMissingPieces,
  deriveAffaireIntakeUploadStatusFromDocuments,
  getDefaultAffaireIntakeDocumentPriority,
  getHeuristicAffaireDocumentClassification,
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeDocumentProcessing,
  isAffaireIntakePrimaryEligibleKind,
  mergeAffaireDocumentClassificationWithHeuristic,
  normalizeAffaireIntakeTextList,
  resolveAffairePreliminaryStructureCapability,
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
      "Le nom du fichier a été retenu comme signal principal pour la catégorie."
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

  it("does not let an ambiguous spreadsheet satisfy a critical missing piece", () => {
    const missingPieces = buildAffaireIntakeMissingPieces([
      {
        uploadStatus: "uploaded",
        classificationStatus: "ambiguous",
        documentKind: "dpgf",
      },
      {
        uploadStatus: "uploaded",
        classificationStatus: "classified",
        documentKind: "plans",
      },
    ]);

    expect(missingPieces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_dpgf",
          severity: "critical",
        }),
      ])
    );
  });

  it("marks critical missing pieces as provisional when an active review could lift them", () => {
    const missingPieces = buildAffaireIntakeMissingPieces([
      {
        uploadStatus: "uploaded",
        classificationStatus: "ambiguous",
        documentKind: "dpgf",
      },
      {
        uploadStatus: "uploaded",
        classificationStatus: "classified",
        documentKind: "plans",
      },
    ]);

    const snapshot = buildAffaireIntakeReadinessSnapshot({
      documents: [
        {
          fileName: "bordereau.xlsx",
          uploadStatus: "uploaded",
          classificationStatus: "ambiguous",
          detectedCategory: "dpgf",
          confidence: 0.41,
          issues: ["Categorie a confirmer"],
        },
        {
          fileName: "plans.pdf",
          uploadStatus: "uploaded",
          classificationStatus: "classified",
          detectedCategory: "plans",
          confidence: 0.98,
          issues: [],
        },
      ],
      missingPieces,
    });

    expect(snapshot).toMatchObject({
      reviewDocumentsCount: 1,
      missingPiecesCount: 3,
      criticalMissingPiecesCount: 1,
      provisionalMissingPiecesCount: 1,
      provisionalCriticalMissingPiecesCount: 1,
      confirmedMissingPiecesCount: 2,
      confirmedCriticalMissingPiecesCount: 0,
      reviewCouldLiftCriticalMissing: true,
      reviewBeforeMissing: true,
      dominantAction: "review",
      hubReadinessImpact: "critical",
    });
  });

  it("treats a generic PDF under review as a provisional plan or CCTP candidate", () => {
    const snapshot = buildAffaireIntakeReadinessSnapshot({
      documents: [
        {
          fileName: "A101.pdf",
          uploadStatus: "uploaded",
          classificationStatus: "ambiguous",
          detectedCategory: "a_classer",
          confidence: 0.34,
          issues: ["Categorie a confirmer"],
        },
        {
          fileName: "bordereau.xlsx",
          uploadStatus: "uploaded",
          classificationStatus: "classified",
          detectedCategory: "dpgf",
          confidence: 0.98,
          issues: [],
        },
      ],
    });

    expect(snapshot).toMatchObject({
      reviewDocumentsCount: 1,
      missingPiecesCount: 3,
      criticalMissingPiecesCount: 1,
      provisionalMissingPiecesCount: 1,
      provisionalCriticalMissingPiecesCount: 1,
      confirmedMissingPiecesCount: 2,
      confirmedCriticalMissingPiecesCount: 0,
      reviewCouldLiftCriticalMissing: true,
      reviewBeforeMissing: true,
      dominantAction: "review",
      hubReadinessImpact: "critical",
    });
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

  it("opens a preliminary structure from a confirmed brief even without a CCTP", () => {
    const capability = resolveAffairePreliminaryStructureCapability({
      briefDraft: {
        status: "confirme",
        lots: ["Electricite", "CVC"],
      },
      documents: [],
    });

    expect(capability).toMatchObject({
      canOpen: true,
      primarySourceKind: "confirmed_brief",
      availableLots: ["Electricite", "CVC"],
    });
    expect(capability.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "confirmed_brief",
          availability: "ready",
        }),
      ])
    );
  });

  it("opens a preliminary structure from the canonical primary CCTP when lots are detected", () => {
    const capability = resolveAffairePreliminaryStructureCapability({
      briefDraft: null,
      documents: [
        {
          documentId: "cctp-secondary",
          fileName: "cctp-v2.pdf",
          detectedCategory: "cctp",
          uploadStatus: "uploaded",
          classificationStatus: "classified",
          documentPriority: "secondary",
          extractedMetadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: ["Plomberie"],
            detectedVariants: [],
          },
        },
        {
          documentId: "cctp-primary",
          fileName: "cctp-v3.pdf",
          detectedCategory: "cctp",
          uploadStatus: "uploaded",
          classificationStatus: "classified",
          documentPriority: "primary",
          extractedMetadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: ["Electricite", "CVC"],
            detectedVariants: [],
          },
        },
      ],
    });

    expect(capability).toMatchObject({
      canOpen: true,
      primarySourceKind: "primary_cctp",
      availableLots: ["Electricite", "CVC"],
    });
    expect(capability.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "primary_cctp",
          availability: "ready",
          documentId: "cctp-primary",
          fileName: "cctp-v3.pdf",
        }),
      ])
    );
  });

  it("keeps the primary CCTP visible as a limited capability when no defendable lot is detected", () => {
    const capability = resolveAffairePreliminaryStructureCapability({
      briefDraft: null,
      documents: [
        {
          documentId: "cctp-primary",
          fileName: "cctp.pdf",
          detectedCategory: "cctp",
          uploadStatus: "uploaded",
          classificationStatus: "classified",
          documentPriority: "primary",
          extractedMetadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: [],
            detectedVariants: [],
          },
        },
      ],
    });

    expect(capability).toMatchObject({
      canOpen: false,
      primarySourceKind: null,
      availableLots: [],
    });
    expect(capability.sources).toEqual([
      expect.objectContaining({
        kind: "primary_cctp",
        availability: "limited",
      }),
    ]);
  });

  it("ignores unreviewed CCTP classifications for preliminary structure access", () => {
    const capability = resolveAffairePreliminaryStructureCapability({
      briefDraft: null,
      documents: [
        {
          documentId: "cctp-ambiguous",
          fileName: "cctp-a-revoir.pdf",
          detectedCategory: "cctp",
          uploadStatus: "uploaded",
          classificationStatus: "ambiguous",
          documentPriority: "primary",
          extractedMetadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: ["Electricite"],
            detectedVariants: [],
          },
        },
        {
          documentId: "cctp-processing",
          fileName: "cctp-en-cours.pdf",
          detectedCategory: "cctp",
          uploadStatus: "uploaded",
          classificationStatus: "processing",
          documentPriority: "secondary",
          extractedMetadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: ["CVC"],
            detectedVariants: [],
          },
        },
      ],
    });

    expect(capability).toMatchObject({
      canOpen: false,
      primarySourceKind: null,
      availableLots: [],
      sources: [],
    });
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
