import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { ToastProvider } from "@/components/ui/Toast";
import {
  AffairePilotagePanel,
  buildFinishLineCards,
  buildPilotageExceptions,
  buildPilotageSteps,
} from "./AffairePilotagePanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

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

function makeDpgfSource(
  overrides?: Partial<NonNullable<Parameters<typeof buildPilotageSteps>[0]["dpgfSource"]>>,
) {
  return {
    importId: "import-1",
    filename: "dpgf.xlsx",
    sourceFormat: "xlsx",
    importStatus: "completed",
    mappingStatus: "validated",
    importedAt: "2026-03-10T08:00:00.000Z",
    mappingUpdatedAt: "2026-03-10T08:05:00.000Z",
    parseMode: "spreadsheet",
    rowCount: 42,
    ...overrides,
  };
}

function makeFinishLineSummary(): AffaireHubFinishLineSummaryResult {
  return {
    versionId: "version-1",
    readyToSend: {
      status: "blocked" as const,
      blockingFlags: [
        {
          key: "no_pdf_generated",
          severity: "blocking" as const,
          count: 1,
          item_ids: [],
          label: "PDF absent",
          description: "Aucun document PDF n'est genere pour cette version.",
        },
      ],
      warningFlags: [],
      checkedAt: "2026-03-11T08:00:00.000Z",
      stalePriceDays: 30,
      errorMessage: null,
    },
    readyToOrder: {
      status: "blocked" as const,
      orderableLinesCount: 3,
      coveredLinesCount: 1,
      ambiguousLinesCount: 1,
      missingPriceLinesCount: 1,
      staleLinesCount: 0,
      errorMessage: null,
    },
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
      dpgfSource: null,
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

  it("surfaces DPGF mapping blockers in the exception queue", () => {
    const exceptions = buildPilotageExceptions({
      projectId: "project-1",
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: makeDpgfSource({
        mappingStatus: "mapped",
      }),
      plansSummary: null,
      registerSummary: null,
      approvalSummary: null,
    });

    expect(exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dpgf-mapping-pending",
          severity: "warning",
          action: {
            kind: "href",
            label: "Verifier le DPGF",
            href: "#dpgf",
          },
        }),
      ]),
    );
  });

  it("keeps degraded review_required takeoff jobs blocked and actionable", () => {
    const steps = buildPilotageSteps({
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: makeDpgfSource(),
      plansSummary: {
        defaultPlanSetId: "plan-set-1",
        planSetCount: 1,
        planFileCount: 1,
        totalSizeBytes: 1024,
        latestJob: {
          jobId: "job-1",
          status: "review_required",
          label: "Revue requise",
          reviewVersionId: "version-review",
        },
        coveragePercent: null,
        exceptionCount: null,
        openQuestionsCount: 0,
        failureReasonLabel: null,
      },
      approvalSummary: null,
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      lineCount: 12,
      takeoffEnabled: true,
    });
    const exceptions = buildPilotageExceptions({
      projectId: "project-1",
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: makeDpgfSource(),
      plansSummary: {
        defaultPlanSetId: "plan-set-1",
        planSetCount: 1,
        planFileCount: 1,
        totalSizeBytes: 1024,
        latestJob: {
          jobId: "job-1",
          status: "review_required",
          label: "Revue requise",
          reviewVersionId: "version-review",
        },
        coveragePercent: null,
        exceptionCount: null,
        openQuestionsCount: 0,
        failureReasonLabel: null,
      },
      registerSummary: null,
      approvalSummary: null,
    });

    expect(steps.find((step) => step.key === "metre")).toMatchObject({
      status: "blocked",
    });
    expect(exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "takeoff-review-required",
          action: {
            kind: "href",
            label: "Ouvrir la revue",
            href:
              "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-review&view=dpgf&dpgfView=exceptions_only",
          },
        }),
      ]),
    );
  });

  it("builds two finish-line statuses with explicit next steps", () => {
    const cards = buildFinishLineCards({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: makeFinishLineSummary(),
    });

    expect(cards[0]).toMatchObject({
      key: "send",
      status: "blocked",
      action: {
        kind: "href",
        label: "Ouvrir la sortie devis",
        href: "#finish-line-output",
      },
    });
    expect(cards[0]?.details).toContain("PDF absent");
    expect(cards[1]).toMatchObject({
      key: "order",
      status: "blocked",
      action: {
        kind: "href",
        label: "Mettre a jour les prix fournisseurs",
        href: "/dashboard/affaires/project-1/prices",
      },
    });
    expect(cards[1]?.details).toContain("1 ligne sans fournisseur retenu");
  });

  it("exposes supplier price import from the affaire when no estimate exists yet", () => {
    const cards = buildFinishLineCards({
      projectId: "project-1",
      currentVersion: null,
      finishLineSummary: null,
    });

    expect(cards[1]).toMatchObject({
      key: "order",
      status: "waiting",
      action: {
        kind: "href",
        label: "Importer des prix fournisseurs",
        href: "/dashboard/affaires/project-1/prices",
      },
    });
  });

  it("renders finish-line cards ahead of the exception queue", () => {
    render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet finish line"
          intakeWorkspace={makeIntakeWorkspace()}
          dpgfSource={makeDpgfSource()}
          plansSummary={null}
          registerSummary={null}
          approvalSummary={null}
          currentVersion={{
            id: "version-1",
            status: "draft",
            versionNumber: 1,
          }}
          lineCount={12}
          finishLineSummary={makeFinishLineSummary()}
          takeoffEnabled
        />
      </ToastProvider>
    );

    expect(screen.getByText("Pret a envoyer")).toBeInTheDocument();
    expect(screen.getByText("Pret a commander")).toBeInTheDocument();
    expect(screen.getByText("PDF absent")).toBeInTheDocument();
    expect(screen.getByText("1 ligne sans fournisseur retenu")).toBeInTheDocument();
    expect(
      screen.getByText("PDF, email et BDC depuis le meme point")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preparer l'envoi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exporter le BDC/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Mettre a jour les prix fournisseurs/i })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/prices");
  });

  it("counts blocked finish-line cards in the cockpit summary badge", () => {
    render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet finish line"
          intakeWorkspace={makeIntakeWorkspace()}
          dpgfSource={makeDpgfSource()}
          plansSummary={null}
          registerSummary={null}
          approvalSummary={null}
          currentVersion={{
            id: "version-1",
            status: "draft",
            versionNumber: 1,
          }}
          lineCount={12}
          finishLineSummary={makeFinishLineSummary()}
          takeoffEnabled
        />
      </ToastProvider>
    );

    expect(screen.getAllByText("2 points a traiter").length).toBeGreaterThan(0);
    expect(screen.queryByText("Aucun blocage prioritaire")).not.toBeInTheDocument();
  });

  it("opens the intake upload surface from the exception queue", async () => {
    const user = userEvent.setup();
    const onOpenSurface = vi.fn();

    render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet test"
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
        />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Ajouter des pieces/i }));

    expect(onOpenSurface).toHaveBeenCalledWith("intake-upload");
  });

  it("omits surface-based exceptions when no surface opener is available", () => {
    const exceptions = buildPilotageExceptions({
      projectId: "project-1",
      intakeWorkspace: makeIntakeWorkspace({
        missingPieces: [
          {
            code: "cctp_missing",
            label: "CCTP manquant",
            severity: "critical",
          },
        ],
      }),
      dpgfSource: null,
      plansSummary: null,
      registerSummary: null,
      approvalSummary: null,
      allowSurfaceActions: false,
    });

    expect(exceptions.some((exception) => exception.id === "missing-pieces")).toBe(false);
  });
});
