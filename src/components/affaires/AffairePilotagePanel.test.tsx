import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  AffairePilotagePanel,
  buildPilotageExceptions,
  buildPilotageSteps,
} from "./AffairePilotagePanel";

function makeIntakeWorkspace(overrides?: Partial<Parameters<typeof buildPilotageSteps>[0]["intakeWorkspace"]>) {
  const baseBriefDraft = {
    status: "confirme" as const,
    summary: "Synthese",
    projectObject: "Objet",
    scope: ["Lot 1"],
    lots: ["Lot 1"],
    receivedPieces: ["plans.pdf"],
    assumptions: [],
    vigilancePoints: [],
    missingElements: [],
    sources: [],
    uploadId: "upload-1",
    lastGeneratedAt: null,
    confirmedAt: "2026-03-10T08:00:00.000Z",
  };

  return {
    documents: [
      {
        documentId: "doc-1",
        fileName: "plans.pdf",
        detectedCategory: "plans" as const,
        confidence: 0.99,
        extractedMetadata: {
          projectName: null,
          clientName: null,
          deadlineAt: null,
          detectedLots: [],
          detectedVariants: [],
        },
        issues: [],
      },
    ],
    missingPieces: [],
    briefDraft: baseBriefDraft,
    ...overrides,
  };
}

describe("AffairePilotagePanel", () => {
  it("builds a blocked dossier step when intake still has review items", () => {
    const steps = buildPilotageSteps({
      intakeWorkspace: makeIntakeWorkspace({
        documents: [
          {
            documentId: "doc-review",
            fileName: "douteux.pdf",
            detectedCategory: "a_classer",
            confidence: 0.42,
            extractedMetadata: {
              projectName: null,
              clientName: null,
              deadlineAt: null,
              detectedLots: [],
              detectedVariants: [],
            },
            issues: ["Faible confiance"],
          },
        ],
        briefDraft: {
          ...makeIntakeWorkspace().briefDraft!,
          status: "a_confirmer",
        },
      }),
      dpgfSource: null,
      plansSummary: null,
      approvalSummary: null,
      currentVersion: null,
      lineCount: 0,
      takeoffEnabled: true,
    });

    expect(steps[0]).toMatchObject({
      key: "dossier",
      status: "blocked",
    });
    expect(steps[1]).toMatchObject({
      key: "brief",
      status: "blocked",
    });
    expect(steps[2]).toMatchObject({
      key: "devis",
      status: "waiting",
    });
  });

  it("prioritizes critical takeoff and register exceptions before warning items", () => {
    const exceptions = buildPilotageExceptions({
      projectId: "project-1",
      intakeWorkspace: makeIntakeWorkspace({
        briefDraft: {
          ...makeIntakeWorkspace().briefDraft!,
          status: "a_confirmer",
        },
      }),
      plansSummary: {
        defaultPlanSetId: "plan-set-1",
        planSetCount: 1,
        planFileCount: 2,
        totalSizeBytes: 2048,
        latestJob: {
          jobId: "job-1",
          status: "review_required",
          label: "Revue requise",
          reviewVersionId: "version-review",
        },
        coveragePercent: 82,
        exceptionCount: 3,
        openQuestionsCount: 0,
        failureReasonLabel: null,
      },
      registerSummary: {
        openQuestionsCount: 2,
        criticalOpenCount: 1,
        nonCriticalOpenCount: 1,
        clarifyWithClientCount: 0,
        openAssumptionCount: 1,
        openMissingPieceCount: 0,
      },
      approvalSummary: null,
    });

    expect(exceptions[0]?.id).toBe("register-critical");
    expect(exceptions[1]?.id).toBe("takeoff-exceptions");
    expect(exceptions[1]?.action).toMatchObject({
      kind: "href",
      href:
        "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-review&view=dpgf&dpgfView=exceptions_only",
    });
    expect(exceptions.some((exception) => exception.id === "brief-confirm")).toBe(true);
  });

  it("opens the intake upload surface from the exception queue", async () => {
    const user = userEvent.setup();
    const onOpenSurface = vi.fn();

    render(
      <AffairePilotagePanel
        projectId="project-1"
        intakeWorkspace={makeIntakeWorkspace({
          missingPieces: [
            {
              code: "cctp_missing",
              label: "CCTP manquant",
              severity: "critical",
            },
          ],
        })}
        dpgfSource={null}
        plansSummary={null}
        registerSummary={null}
        approvalSummary={null}
        currentVersion={null}
        lineCount={0}
        takeoffEnabled
        onOpenSurface={onOpenSurface}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ajouter des pieces/i }));

    expect(onOpenSurface).toHaveBeenCalledWith("intake-upload");
  });
});
