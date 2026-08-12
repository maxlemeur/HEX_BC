import { describe, expect, it } from "vitest";

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
  it("returns the upload decision without requiring intake queries", () => {
    const model = buildAffaireFlowPanelModel({
      projectId: "project-empty",
      currentVersion: null,
    });

    expect(model).toMatchObject({
      heroState: "processing",
      readinessLevel: "not_ready",
      showEmptyUploadCard: true,
      primaryAction: null,
      resultCard: null,
    });
  });

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

  it("normalises the manual continuation URL for an existing draft", () => {
    const model = buildAffaireFlowPanelModel({
      projectId: "project-draft",
      currentVersion: {
        id: "version-draft",
        projectId: "project-draft",
        versionNumber: 1,
        status: "draft",
        totalHtCents: 0,
        marginMultiplier: 1,
        marginPercent: 0,
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
      intakeWorkspace: {
        documents: [makeDocument()],
        missingPieces: [],
      },
    });

    expect(model.aides).toContainEqual(
      expect.objectContaining({
        key: "manual-estimate",
        kind: "href",
        href: "/dashboard/estimates/version-draft/edit?entry=manual",
      }),
    );
  });
});
