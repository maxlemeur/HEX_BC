import { describe,expect,it } from "vitest";

import {
buildAffaireFlowPanelModel,
type AffaireFlowHierarchyPanelProps,
} from "./AffaireFlowHierarchyPanel.model";

type IntakeDocument = NonNullable<
  AffaireFlowHierarchyPanelProps["intakeWorkspace"]
>["documents"][number];

function makeDocument(
  overrides: Partial<IntakeDocument> = {},
): IntakeDocument {
  return {
    documentId: "document-1",
    fileName: "plans.pdf",
    detectedCategory: "plans",
    confidence: 0.99,
    extractedMetadata: {
      projectName: null,
      clientName: null,
      deadlineAt: null,
      detectedLots: [],
      detectedVariants: [],
    },
    issues: [],
    ...overrides,
  };
}

describe("buildAffaireFlowPanelModel", () => {

  it("prioritises an ambiguous document that can resolve a critical missing piece", () => {
    const model = buildAffaireFlowPanelModel({
      projectId: "project-review",
      currentVersion: null,
      intakeWorkspace: {
        documents: [
          makeDocument({
            detectedCategory: "a_classer",
            confidence: 0.2,
            issues: ["Classification incertaine"],
          }),
        ],
        missingPieces: [
          {
            code: "missing_plans",
            label: "Plans manquants",
            severity: "critical",
          },
        ],
      },
    });

    expect(model.heroState).toBe("review");
    expect(model.reviewImpact).toBe("critical_missing");
    expect(model.resultCard?.kind).toBe("review");
    expect(model.primaryAction).toMatchObject({
      kind: "href",
      href: "/dashboard/affaires/project-review?intakeFilter=a_revoir#intake",
    });
  });
});
