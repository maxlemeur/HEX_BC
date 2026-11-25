import { describe, expect, it } from "vitest";

import {
  AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE,
  getAffaireDossierState,
  type AffaireIntakeReviewableDocument,
  buildAffaireIntakeReadinessSnapshot,
  buildAffaireIntakeMissingPieces,
  buildAffaireIntakeStoragePath,
  isAffaireIntakeDocumentNeedingReview,
  isAffaireIntakeStorageKey,
  mergeAffaireDocumentClassificationWithHeuristic,
  normalizeAffaireIntakeExtractedMetadata,
  resolveAffairePreliminaryStructureCapability,
} from "@/lib/affaires/intake";

describe("affaire intake helpers", () => {
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

  it("keeps absent documents advisory even when an ambiguous spreadsheet needs review", () => {
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
          severity: "warning",
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

    missingPieces.find((piece) => piece.code === "missing_dpgf")!.severity = "critical";

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
      criticalMissingPiecesCount: 0,
      provisionalMissingPiecesCount: 1,
      provisionalCriticalMissingPiecesCount: 0,
      confirmedMissingPiecesCount: 2,
      confirmedCriticalMissingPiecesCount: 0,
      reviewCouldLiftCriticalMissing: false,
      reviewBeforeMissing: false,
      dominantAction: "review",
      hubReadinessImpact: "warning",
    });
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

  it("completes model deadlines given to the minute instead of dropping the metadata", () => {
    expect(
      normalizeAffaireIntakeExtractedMetadata({
        projectName: "Ecole Jules Ferry",
        clientName: null,
        deadlineAt: "2026-11-15T12:00+01:00",
        detectedLots: ["Plomberie"],
        detectedVariants: [],
      })
    ).toEqual({
      projectName: "Ecole Jules Ferry",
      clientName: null,
      deadlineAt: "2026-11-15T12:00:00+01:00",
      detectedLots: ["Plomberie"],
      detectedVariants: [],
    });
  });
});

describe("getAffaireDossierState", () => {
  it("keeps a deposited piece waiting even when an older brief was confirmed", () => {
    expect(getAffaireDossierState({ documents: [{ uploadStatus: "uploaded", classificationStatus: "awaiting_launch" }], briefStatus: "confirme" })).toBe("awaiting_launch");
  });
  const classified = { classificationStatus: "classified" as const, documentKind: "plans" as const, confidence: 0.9 };
  it.each([
    ["no piece", [], "confirme", "empty"],
    ["a piece being classified", [{ ...classified, classificationStatus: "processing" as const }], "confirme", "processing"],
    ["a queued piece", [{ ...classified, classificationStatus: "queued" as const }], "confirme", "processing"],
    ["a pending reanalysis", [{ ...classified, issues: [AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE] as string[] }], "confirme", "processing"],
    ["a former piece without category, confidence or issue", [{ documentKind: "a_classer" as const, confidence: 0 }], "confirme", "processing"],
    ["an ambiguous piece", [{ ...classified, classificationStatus: "ambiguous" as const }], "confirme", "to_review"],
    ["a failed piece", [{ ...classified, classificationStatus: "failed" as const }], "confirme", "to_review"],
    ["a former piece of low confidence", [{ documentKind: "plans" as const, confidence: 0.5 }], "confirme", "to_review"],
    ["a review and a classification at once", [{ ...classified, classificationStatus: "ambiguous" as const },
      { ...classified, classificationStatus: "processing" as const }], "confirme", "to_review"],
    ["classified pieces and a brief to confirm", [classified], "a_confirmer", "brief_to_confirm"],
    ["classified pieces and a confirmed brief", [classified], "confirme", "confirmed"],
  ] as const)("reads %s", (_case, documents, briefStatus, expected) => {
    expect(getAffaireDossierState({ documents: documents as ReadonlyArray<AffaireIntakeReviewableDocument>, briefStatus })).toBe(expected);
  });
});

describe("isAffaireIntakeStorageKey", () => {
  const ids = { tenantId: "aaaaaaaa-1111-4111-8111-111111111111", projectId: "bbbbbbbb-2222-4222-8222-222222222222",
    uploadId: "cccccccc-3333-4333-8333-333333333333", documentId: "dddddddd-4444-4444-8444-444444444444" };
  const key = buildAffaireIntakeStoragePath({ ...ids, fileName: "CCTP lot plomberie.pdf" });

  it("accepts the key the dossier wrote for the piece, its file renamed since included", () => {
    expect(isAffaireIntakeStorageKey(key, ids)).toBe(true);
    expect(isAffaireIntakeStorageKey(`${ids.tenantId}/${ids.projectId}/${ids.uploadId}/${ids.documentId}/renomme.pdf`, ids)).toBe(true);
  });

  // A request may name the affaire with an upper-case identifier; the keys hold the database's lower-case text.
  it("accepts the piece's key whatever the case of the identifiers it is checked against", () => {
    expect(isAffaireIntakeStorageKey(key, { tenantId: ids.tenantId.toUpperCase(), projectId: ids.projectId.toUpperCase(),
      uploadId: ids.uploadId.toUpperCase(), documentId: ids.documentId.toUpperCase() })).toBe(true);
  });

  it.each([
    ["another affaire's object", `${ids.tenantId}/55555555-5555-4555-8555-555555555555/${ids.uploadId}/${ids.documentId}/cctp.pdf`],
    ["another piece's object", `${ids.tenantId}/${ids.projectId}/${ids.uploadId}/66666666-6666-4666-8666-666666666666/cctp.pdf`],
    ["a key outside the dossier's layout", `e2e/intake/${ids.documentId}.pdf`],
    ["a key one folder deeper", `${ids.tenantId}/${ids.projectId}/${ids.uploadId}/${ids.documentId}/copie/cctp.pdf`],
  ])("refuses %s", (_case, path) => {
    expect(isAffaireIntakeStorageKey(path, ids)).toBe(false);
  });

  it("refuses a piece without an upload", () => {
    expect(isAffaireIntakeStorageKey(key, { ...ids, uploadId: null })).toBe(false);
  });
});
