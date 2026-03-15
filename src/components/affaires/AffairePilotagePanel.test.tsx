import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { ToastProvider } from "@/components/ui/Toast";
import { AffairePilotagePanel } from "./AffairePilotagePanel";
import {
  buildFinishLineCards,
  buildFinishLineReadiness,
  buildPilotageExceptions,
  buildReadyToSendAction,
  buildPilotageSteps,
} from "./AffairePilotagePanel.logic";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("./AffaireOrderDraftsPanel", () => ({
  AffaireOrderDraftsPanel: () => (
    <div data-testid="affaire-order-drafts-panel">finish-line-orders-panel</div>
  ),
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
    mappedRowCount: 42,
    ...overrides,
  };
}

function makeFinishLineSummary(): AffaireHubFinishLineSummaryResult {
  return {
    versionId: "version-1",
    submissionReadiness: {
      status: "blocked",
      blockers: [
        {
          key: "no_pdf_generated",
          category: "pdf",
          severity: "blocking" as const,
          count: 1,
          item_ids: [],
          label: "PDF absent",
          description: "Aucun document PDF n'est genere pour cette version.",
        },
      ],
      alerts: [],
      groups: [
        {
          category: "pdf",
          blockers: [
            {
              key: "no_pdf_generated",
              category: "pdf",
              severity: "blocking" as const,
              count: 1,
              item_ids: [],
              label: "PDF absent",
              description: "Aucun document PDF n'est genere pour cette version.",
            },
          ],
          alerts: [],
          blockerCount: 1,
          alertCount: 0,
        },
      ],
      checkedAt: "2026-03-11T08:00:00.000Z",
      stalePriceDays: 30,
      errorMessage: null,
    },
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

  it("keeps the devis step open in manual mode when no DPGF is linked", () => {
    const steps = buildPilotageSteps({
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: null,
      plansSummary: null,
      approvalSummary: null,
      currentVersion: {
        id: "version-manual",
        status: "draft",
        versionNumber: 1,
      },
      lineCount: 0,
      takeoffEnabled: true,
    });

    expect(steps[2]).toMatchObject({
      key: "devis",
      status: "in_progress",
      summary:
        "Le devis peut demarrer en manuel ou via une structure preliminaire, sans DPGF obligatoire.",
    });
  });

  it("recognises a manual devis structure even without linked DPGF", () => {
    const steps = buildPilotageSteps({
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: null,
      plansSummary: null,
      approvalSummary: null,
      currentVersion: {
        id: "version-manual-lines",
        status: "draft",
        versionNumber: 2,
      },
      lineCount: 4,
      takeoffEnabled: true,
    });

    expect(steps[2]).toMatchObject({
      key: "devis",
      status: "done",
      summary: "4 lignes de devis disponibles en mode manuel.",
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

  it("surfaces dedicated clarification exceptions when the register only carries client clarifications", () => {
    const exceptions = buildPilotageExceptions({
      projectId: "project-1",
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: null,
      plansSummary: null,
      registerSummary: {
        openQuestionsCount: 0,
        criticalOpenCount: 0,
        nonCriticalOpenCount: 0,
        clarifyWithClientCount: 1,
        criticalClarifyWithClientCount: 1,
        openAssumptionCount: 0,
        openMissingPieceCount: 0,
      },
      approvalSummary: null,
    });

    expect(exceptions[0]).toMatchObject({
      id: "register-clarify",
      title: "1 clarification client a porter",
      action: {
        kind: "href",
        label: "Voir les clarifications client",
        href: "/dashboard/affaires/project-1?registerStatus=clarify_with_client#register",
      },
    });
  });

  it("surfaces dedicated revalidation exceptions when the dossier must be reopened", () => {
    const exceptions = buildPilotageExceptions({
      projectId: "project-1",
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: null,
      plansSummary: null,
      registerSummary: {
        openQuestionsCount: 0,
        criticalOpenCount: 0,
        nonCriticalOpenCount: 0,
        clarifyWithClientCount: 0,
        openAssumptionCount: 0,
        openMissingPieceCount: 0,
        revalidationRequired: true,
        revalidationRequiredCount: 1,
        criticalRevalidationRequiredCount: 1,
        revalidationImpactedStages: ["document_review", "submission_readiness"],
      },
      approvalSummary: null,
    });

    expect(exceptions[0]).toMatchObject({
      id: "register-revalidation",
      title: "1 revalidation a relancer",
      action: {
        kind: "href",
        label: "Voir les revalidations",
        href:
          "/dashboard/affaires/project-1?registerSeverity=critical&registerRevalidation=required#register",
      },
    });
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

  it("groups send blockers by canonical category in finish-line cards", () => {
    const cards = buildFinishLineCards({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        ...makeFinishLineSummary(),
        submissionReadiness: {
          status: "blocked",
          blockers: [
            {
              key: "critical_missing_pieces",
              category: "documents",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Documents critiques manquants",
              description: "Des pieces critiques restent manquantes.",
            },
            {
              key: "no_pdf_generated",
              category: "pdf",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "PDF absent",
              description: "Aucun document PDF n'est genere pour cette version.",
            },
          ],
          alerts: [],
          groups: [
            {
              category: "documents",
              blockers: [
                {
                  key: "critical_missing_pieces",
                  category: "documents",
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "Documents critiques manquants",
                  description: "Des pieces critiques restent manquantes.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
            {
              category: "pdf",
              blockers: [
                {
                  key: "no_pdf_generated",
                  category: "pdf",
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "PDF absent",
                  description: "Aucun document PDF n'est genere pour cette version.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
          ],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "critical_missing_pieces",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Documents critiques manquants",
              description: "Des pieces critiques restent manquantes.",
            },
            {
              key: "no_pdf_generated",
              severity: "blocking",
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
      },
    });

    expect(cards[0]?.details).toEqual([
      "Documents · 1 blocage",
      "PDF · 1 blocage",
      "Documents critiques manquants",
    ]);
  });

  it("keeps one concrete send blocker label when multiple readiness groups are present", () => {
    const cards = buildFinishLineCards({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        ...makeFinishLineSummary(),
        submissionReadiness: {
          status: "blocked",
          blockers: [
            {
              key: "critical_missing_pieces",
              category: "documents",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Documents critiques manquants",
              description: "Des pieces critiques restent manquantes.",
            },
            {
              key: "no_pdf_generated",
              category: "pdf",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "PDF absent",
              description: "Aucun document PDF n'est genere pour cette version.",
            },
            {
              key: "rule_violation",
              category: "approvals",
              severity: "blocking",
              count: 1,
              item_ids: ["rule:approval"],
              label: "Validation interne requise",
              description: "Une validation interne reste necessaire.",
            },
          ],
          alerts: [],
          groups: [
            {
              category: "documents",
              blockers: [
                {
                  key: "critical_missing_pieces",
                  category: "documents",
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "Documents critiques manquants",
                  description: "Des pieces critiques restent manquantes.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
            {
              category: "pdf",
              blockers: [
                {
                  key: "no_pdf_generated",
                  category: "pdf",
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "PDF absent",
                  description: "Aucun document PDF n'est genere pour cette version.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
            {
              category: "approvals",
              blockers: [
                {
                  key: "rule_violation",
                  category: "approvals",
                  severity: "blocking",
                  count: 1,
                  item_ids: ["rule:approval"],
                  label: "Validation interne requise",
                  description: "Une validation interne reste necessaire.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
          ],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "critical_missing_pieces",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Documents critiques manquants",
              description: "Des pieces critiques restent manquantes.",
            },
            {
              key: "no_pdf_generated",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "PDF absent",
              description: "Aucun document PDF n'est genere pour cette version.",
            },
            {
              key: "rule_violation",
              severity: "blocking",
              count: 1,
              item_ids: ["rule:approval"],
              label: "Validation interne requise",
              description: "Une validation interne reste necessaire.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      },
    });

    expect(cards[0]?.details).toEqual([
      "Documents · 1 blocage",
      "PDF · 1 blocage",
      "Documents critiques manquants",
    ]);
  });

  it("prioritizes submission readiness over the ready-to-send alias in finish-line cards", () => {
    const cards = buildFinishLineCards({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        ...makeFinishLineSummary(),
        submissionReadiness: {
          status: "warning",
          blockers: [],
          alerts: [
            {
              key: "supplier_price_outdated",
              category: "estimate_quality",
              severity: "warning",
              count: 1,
              item_ids: [],
              label: "Prix a revalider",
              description: "Certains prix datent.",
            },
          ],
          groups: [
            {
              category: "estimate_quality",
              blockers: [],
              alerts: [
                {
                  key: "supplier_price_outdated",
                  category: "estimate_quality",
                  severity: "warning",
                  count: 1,
                  item_ids: [],
                  label: "Prix a revalider",
                  description: "Certains prix datent.",
                },
              ],
              blockerCount: 0,
              alertCount: 1,
            },
          ],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "critical_missing_pieces",
              category: "documents",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Documents critiques manquants",
              description: "Des pieces critiques restent manquantes.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      },
    });

    expect(cards[0]).toMatchObject({
      key: "send",
      status: "warning",
      summary: "1 point a verifier avant l'envoi.",
    });
    expect(cards[0]?.details).toEqual([
      "Qualite devis · 1 reserve",
      "Prix a revalider",
    ]);
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

  it("opens the commandes finish line directly when supplier groups are ready", () => {
    const cards = buildFinishLineCards({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        ...makeFinishLineSummary(),
        readyToOrder: {
          status: "ready",
          orderableLinesCount: 3,
          coveredLinesCount: 3,
          ambiguousLinesCount: 0,
          missingPriceLinesCount: 0,
          staleLinesCount: 0,
          errorMessage: null,
        },
      },
    });

    expect(cards[1]).toMatchObject({
      key: "order",
      status: "ready",
      action: {
        kind: "href",
        label: "Ouvrir la finish line commandes",
        href: "#finish-line-orders",
      },
    });
  });

  it("keeps finish-line outputs hidden until the dossier is mature enough", () => {
    const readiness = buildFinishLineReadiness({
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
      }),
      dpgfSource: null,
      currentVersion: null,
      lineCount: 0,
    });

    expect(readiness).toMatchObject({
      reveal: false,
      title: "Sortie devis masquee pour l'instant",
    });
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        "1 piece reste a confirmer dans le dossier.",
        "Importez puis validez le DPGF avant de preparer la sortie.",
        "Creez un premier devis brouillon pour materialiser la sortie.",
      ])
    );
  });

  it("renders finish-line cards ahead of the exception queue", { timeout: 10000 }, () => {
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

    expect(screen.getAllByText("Pret a envoyer").length).toBeGreaterThan(0);
    expect(screen.getByText("Pret a commander")).toBeInTheDocument();
    expect(screen.getByText("PDF absent")).toBeInTheDocument();
    expect(screen.getByText("1 ligne sans fournisseur retenu")).toBeInTheDocument();
    expect(
      screen.getByText("PDF, email et BDC depuis le meme point")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preparer l'envoi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exporter le BDC/i })).toBeInTheDocument();
    expect(screen.getByTestId("affaire-order-drafts-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Mettre a jour les prix fournisseurs/i })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/prices");
  });

  it("hides finish-line cards and actions when readiness cannot be loaded", () => {
    const { container } = render(
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
          finishLineSummary={null}
          takeoffEnabled
        />
      </ToastProvider>
    );
    const scope = within(container);

    expect(scope.queryByText("Indisponible")).not.toBeInTheDocument();
    expect(
      scope.queryByText("La verification de sortie devis est indisponible pour le moment.")
    ).not.toBeInTheDocument();
    expect(
      scope.queryByText("La verification achats est indisponible pour le moment.")
    ).not.toBeInTheDocument();
    expect(
      scope.queryByText("PDF, email et BDC depuis le meme point")
    ).not.toBeInTheDocument();
    expect(
      scope.queryByRole("button", { name: /Telecharger le PDF/i })
    ).not.toBeInTheDocument();
    expect(
      scope.queryByRole("button", { name: /Preparer l'envoi/i })
    ).not.toBeInTheDocument();
    expect(
      scope.queryByRole("button", { name: /Exporter le BDC/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the finish line visible when canonical submission readiness exists on an immature dossier", () => {
    render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet finish line"
          intakeWorkspace={makeIntakeWorkspace()}
          dpgfSource={null}
          plansSummary={null}
          registerSummary={null}
          approvalSummary={null}
          currentVersion={{
            id: "version-1",
            status: "draft",
            versionNumber: 1,
          }}
          lineCount={0}
          finishLineSummary={{
            ...makeFinishLineSummary(),
            submissionReadiness: {
              status: "blocked",
              blockers: [
                {
                  key: "critical_missing_pieces",
                  category: "documents",
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "Documents critiques manquants",
                  description: "Des pieces critiques restent manquantes.",
                },
              ],
              alerts: [],
              groups: [
                {
                  category: "documents",
                  blockers: [
                    {
                      key: "critical_missing_pieces",
                      category: "documents",
                      severity: "blocking",
                      count: 1,
                      item_ids: [],
                      label: "Documents critiques manquants",
                      description: "Des pieces critiques restent manquantes.",
                    },
                  ],
                  alerts: [],
                  blockerCount: 1,
                  alertCount: 0,
                },
              ],
              checkedAt: "2026-03-11T08:00:00.000Z",
              stalePriceDays: 30,
              errorMessage: null,
            },
            readyToSend: {
              status: "ready",
              blockingFlags: [],
              warningFlags: [],
              checkedAt: "2026-03-11T08:00:00.000Z",
              stalePriceDays: 30,
              errorMessage: null,
            },
          }}
          takeoffEnabled
        />
      </ToastProvider>
    );

    expect(screen.getAllByText("Pret a envoyer").length).toBeGreaterThan(0);
    expect(screen.getByText("Documents critiques manquants")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Ouvrir les documents manquants/i })
    ).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1?registerStatus=open&registerSeverity=critical&registerKind=missing_piece#register"
    );
  });

  it("does not duplicate a hidden finish-line readiness note on immature dossiers", () => {
    const { container } = render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet immature"
          intakeWorkspace={makeIntakeWorkspace()}
          dpgfSource={null}
          plansSummary={null}
          registerSummary={null}
          approvalSummary={null}
          currentVersion={null}
          lineCount={0}
          finishLineSummary={null}
          takeoffEnabled
        />
      </ToastProvider>
    );
    const scope = within(container);

    expect(scope.queryByText("Sortie devis masquee pour l'instant")).not.toBeInTheDocument();
    expect(scope.queryByText("Pas encore pertinent")).not.toBeInTheDocument();
    expect(
      scope.queryByText("Importez puis validez le DPGF avant de preparer la sortie.")
    ).not.toBeInTheDocument();
    expect(scope.queryByText("Pret a envoyer")).not.toBeInTheDocument();
    expect(
      scope.queryByText("PDF, email et BDC depuis le meme point")
    ).not.toBeInTheDocument();
  });

  it("renders finish-line cards without adding a competing summary badge", () => {
    const { container } = render(
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
    const scope = within(container);

    expect(scope.getByText("Pret a envoyer")).toBeInTheDocument();
    expect(scope.getByText("Pret a commander")).toBeInTheDocument();
    expect(scope.queryByText("2 points a traiter")).not.toBeInTheDocument();
    expect(scope.queryByText("Aucun blocage prioritaire")).not.toBeInTheDocument();
  });

  it("does not reintroduce a competing summary badge when register blockers are already surfaced", () => {
    render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet finish line"
          intakeWorkspace={makeIntakeWorkspace()}
          dpgfSource={makeDpgfSource()}
          plansSummary={null}
          registerSummary={{
            openQuestionsCount: 1,
            criticalOpenCount: 1,
            nonCriticalOpenCount: 0,
            clarifyWithClientCount: 0,
            openAssumptionCount: 1,
            openMissingPieceCount: 0,
          }}
          approvalSummary={null}
          currentVersion={{
            id: "version-1",
            status: "draft",
            versionNumber: 1,
          }}
          lineCount={12}
          finishLineSummary={{
            versionId: "version-1",
            readyToSend: {
              status: "blocked",
              blockingFlags: [
                {
                  key: "critical_open_questions",
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "Question critique ouverte",
                  description: "Une question critique reste ouverte.",
                },
              ],
              warningFlags: [],
              checkedAt: "2026-03-11T08:00:00.000Z",
              stalePriceDays: 30,
              errorMessage: null,
            },
            readyToOrder: {
              status: "ready",
              orderableLinesCount: 3,
              coveredLinesCount: 3,
              ambiguousLinesCount: 0,
              missingPriceLinesCount: 0,
              staleLinesCount: 0,
              errorMessage: null,
            },
          }}
          takeoffEnabled
        />
      </ToastProvider>
    );

    expect(screen.getAllByText("Exceptions a traiter").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 point a traiter")).not.toBeInTheDocument();
  });

  it("routes missing client documents to the document-filtered register view", () => {
    const action = buildReadyToSendAction({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        versionId: "version-1",
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "client_missing_documents_required",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Documents attendus du client",
              description: "Un document client reste attendu.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToOrder: {
          status: "waiting",
          orderableLinesCount: 0,
          coveredLinesCount: 0,
          ambiguousLinesCount: 0,
          missingPriceLinesCount: 0,
          staleLinesCount: 0,
          errorMessage: null,
        },
      },
    });

    expect(action).toEqual({
      kind: "href",
      label: "Ouvrir les documents attendus",
      href:
        "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=missing_piece#register",
    });
  });

  it("routes client clarifications to the register wording carried by the backend category", () => {
    const action = buildReadyToSendAction({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        versionId: "version-1",
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "client_clarification_required",
              category: "register",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "Clarification client requise",
              description: "Une hypothèse reste à clarifier avec le client.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToOrder: {
          status: "waiting",
          orderableLinesCount: 0,
          coveredLinesCount: 0,
          ambiguousLinesCount: 0,
          missingPriceLinesCount: 0,
          staleLinesCount: 0,
          errorMessage: null,
        },
      },
    });

    expect(action).toEqual({
      kind: "href",
      label: "Ouvrir les clarifications client",
      href:
        "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption#register",
    });
  });

  it("routes approval blockers to the validation section", () => {
    const action = buildReadyToSendAction({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        ...makeFinishLineSummary(),
        submissionReadiness: {
          status: "blocked",
          blockers: [
            {
              key: "rule_violation",
              category: "approvals",
              severity: "blocking",
              count: 1,
              item_ids: ["rule:approval"],
              label: "Validation interne requise",
              description: "Une validation interne reste necessaire.",
            },
          ],
          alerts: [],
          groups: [
            {
              category: "approvals",
              blockers: [
                {
                  key: "rule_violation",
                  category: "approvals",
                  severity: "blocking",
                  count: 1,
                  item_ids: ["rule:approval"],
                  label: "Validation interne requise",
                  description: "Une validation interne reste necessaire.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
          ],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "rule_violation",
              severity: "blocking",
              count: 1,
              item_ids: ["rule:approval"],
              label: "Validation interne requise",
              description: "Une validation interne reste necessaire.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      },
    });

    expect(action).toEqual({
      kind: "href",
      label: "Ouvrir la validation",
      href: "#approval",
    });
  });

  it("keeps approval-only warnings on the send finish line CTA", () => {
    const action = buildReadyToSendAction({
      projectId: "project-1",
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      finishLineSummary: {
        ...makeFinishLineSummary(),
        submissionReadiness: {
          status: "warning",
          blockers: [],
          alerts: [
            {
              key: "rule_violation",
              category: "approvals",
              severity: "warning",
              count: 1,
              item_ids: ["rule:approval"],
              label: "Validation interne a verifier",
              description: "Une reserve de validation interne reste a verifier.",
            },
          ],
          groups: [
            {
              category: "approvals",
              blockers: [],
              alerts: [
                {
                  key: "rule_violation",
                  category: "approvals",
                  severity: "warning",
                  count: 1,
                  item_ids: ["rule:approval"],
                  label: "Validation interne a verifier",
                  description: "Une reserve de validation interne reste a verifier.",
                },
              ],
              blockerCount: 0,
              alertCount: 1,
            },
          ],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToSend: {
          status: "warning",
          blockingFlags: [],
          warningFlags: [
            {
              key: "rule_violation",
              severity: "warning",
              count: 1,
              item_ids: ["rule:approval"],
              label: "Validation interne a verifier",
              description: "Une reserve de validation interne reste a verifier.",
            },
          ],
          checkedAt: "2026-03-11T08:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      },
    });

    expect(action).toEqual({
      kind: "href",
      label: "Ouvrir la sortie devis",
      href: "#finish-line-output",
    });
  });

  it("does not expose finish-line actions when the panel is rendered in ghost mode", () => {
    const { container } = render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId=""
          projectName="Projet ghost"
          intakeWorkspace={null}
          dpgfSource={null}
          plansSummary={null}
          registerSummary={null}
          approvalSummary={null}
          currentVersion={null}
          lineCount={0}
          finishLineSummary={null}
          takeoffEnabled
          ghost
        />
      </ToastProvider>,
    );

    expect(within(container).queryByRole("link", { name: /Creer un devis/i })).not.toBeInTheDocument();
    expect(
      within(container).queryByText("PDF, email et BDC depuis le meme point")
    ).not.toBeInTheDocument();
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

  it("can hide exceptions already carried by the flow hero", () => {
    render(
      <ToastProvider>
        <AffairePilotagePanel
          projectId="project-1"
          projectName="Projet test"
          intakeWorkspace={makeIntakeWorkspace()}
          dpgfSource={makeDpgfSource()}
          plansSummary={{
            defaultPlanSetId: "plan-set-1",
            planSetCount: 1,
            planFileCount: 1,
            totalSizeBytes: 1024,
            latestJob: null,
            coveragePercent: null,
            exceptionCount: null,
            openQuestionsCount: 0,
            failureReasonLabel: null,
          }}
          registerSummary={null}
          approvalSummary={null}
          currentVersion={null}
          lineCount={0}
          takeoffEnabled
          hiddenExceptionIds={["takeoff-launch"]}
          onOpenSurface={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.queryByRole("button", { name: /Demarrer l'analyse/i })).not.toBeInTheDocument();
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
