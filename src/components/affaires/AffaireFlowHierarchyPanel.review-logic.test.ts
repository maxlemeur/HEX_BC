import { describe, expect, it } from "vitest";

import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";

import {
  getFileIllustrationTone,
  getReviewChoiceConsequence,
  getReviewChoiceSecondaryBadge,
  getReviewEvidenceHints,
  getReviewProbableCategories,
  sortReviewDocuments,
} from "./AffaireFlowHierarchyPanel.review-logic";

type ReviewDocument = AffaireIntakeWorkspace["documents"][number];

function buildReviewDocument(
  input: Partial<ReviewDocument> & Pick<ReviewDocument, "documentId" | "fileName">,
): ReviewDocument {
  return {
    detectedCategory: "a_classer",
    classificationStatus: "ambiguous",
    classificationSource: "heuristic",
    documentPriority: null,
    confidence: 0.5,
    extractedMetadata: {
      projectName: null,
      clientName: null,
      deadlineAt: null,
      detectedLots: [],
      detectedVariants: [],
    },
    issues: [],
    ...input,
  };
}

describe("AffaireFlowHierarchyPanel review logic", () => {
  it("keeps file presentation and probable categories aligned by extension", () => {
    expect(getFileIllustrationTone("bordereau.XLSX")).toEqual({
      label: "XLS",
      accent: "text-emerald-700",
      frame: "border-emerald-200 bg-emerald-50/90",
    });
    expect(
      getReviewProbableCategories(
        buildReviewDocument({
          documentId: "document-spreadsheet",
          fileName: "bordereau.XLSX",
        }),
      ),
    ).toEqual(["dpgf", "bpu_dqe", "annexes"]);
  });

  it("prioritises a review document that can lift a missing category", () => {
    const lowConfidenceSpreadsheet = buildReviewDocument({
      documentId: "document-spreadsheet",
      fileName: "prix.xlsx",
      confidence: 0.1,
    });
    const possiblePlans = buildReviewDocument({
      documentId: "document-plans",
      fileName: "plans.pdf",
      confidence: 0.8,
    });

    expect(
      sortReviewDocuments(
        [lowConfidenceSpreadsheet, possiblePlans],
        [
          {
            code: "missing_plans",
            label: "Plans manquants",
            severity: "critical",
          },
        ],
      ).map((document) => document.documentId),
    ).toEqual(["document-plans", "document-spreadsheet"]);
  });

  it("uses confidence and file name as stable review tie-breakers", () => {
    const documents = [
      buildReviewDocument({
        documentId: "document-b",
        fileName: "b.pdf",
        confidence: 0.4,
      }),
      buildReviewDocument({
        documentId: "document-c",
        fileName: "c.pdf",
        confidence: 0.2,
      }),
      buildReviewDocument({
        documentId: "document-a",
        fileName: "a.pdf",
        confidence: 0.4,
      }),
    ];

    expect(
      sortReviewDocuments(documents, []).map((document) => document.documentId),
    ).toEqual(["document-c", "document-a", "document-b"]);
  });

  it("summarises evidence and the impact of choosing a secondary source", () => {
    const document = buildReviewDocument({
      documentId: "document-dpgf",
      fileName: "prix.xlsx",
      confidence: 0.4,
      issues: ["Colonnes non reconnues"],
    });

    expect(
      getReviewEvidenceHints(document, [
        {
          code: "missing_dpgf",
          label: "DPGF manquant",
          severity: "critical",
        },
      ]),
    ).toEqual([
      "Tableur recu",
      "40% de confiance",
      "Aucune categorie certaine",
      "Peut lever: DPGF manquant",
      "Colonnes non reconnues",
    ]);
    expect(
      getReviewChoiceSecondaryBadge({
        category: "dpgf",
        hasPrimaryDpgf: true,
        hasPrimaryCctp: false,
      }),
    ).toBe("Complementaire");
    expect(
      getReviewChoiceConsequence({
        category: "dpgf",
        hasPrimaryDpgf: true,
        hasPrimaryCctp: false,
      }),
    ).toBe(
      "La piece sera ajoutee comme DPGF complementaire sans remplacer le principal.",
    );
  });
});
