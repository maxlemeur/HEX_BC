import { describe,expect,it } from "vitest";

import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";

import {
sortReviewDocuments
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
});
