import { render,screen,within } from "@testing-library/react";
import { describe,expect,it,vi } from "vitest";

import { ToastProvider } from "@/components/ui-legacy/Toast";
import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { AffairePilotagePanel } from "./AffairePilotagePanel";
import {
buildFinishLineCards,
buildPilotageExceptions,
buildPilotageSteps,
buildReadyToSendAction
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

  it("keeps the devis step done on locked versions even when hybrid import remains technically possible", () => {
    const steps = buildPilotageSteps({
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: makeDpgfSource(),
      plansSummary: null,
      approvalSummary: null,
      currentVersion: {
        id: "version-manual-sent",
        status: "sent",
        versionNumber: 2,
      },
      lineCount: 4,
      structureMode: {
        mode: "manual",
        lineCount: 4,
        importedLineCount: 0,
        manualLineCount: 4,
        canImportLinkedDpgfIntoCurrentStructure: true,
        linkedDpgfMappedRowCount: 18,
      },
      takeoffEnabled: true,
    });

    expect(steps[2]).toMatchObject({
      key: "devis",
      status: "done",
      summary: "4 lignes de devis disponibles en mode manuel.",
    });
  });

  it("makes a structure cleanup explicit when the visible mode needs an update", () => {
    const steps = buildPilotageSteps({
      intakeWorkspace: makeIntakeWorkspace(),
      dpgfSource: makeDpgfSource(),
      plansSummary: null,
      approvalSummary: null,
      currentVersion: {
        id: "version-needs-update",
        status: "draft",
        versionNumber: 3,
      },
      lineCount: 12,
      structureMode: {
        mode: "needs_update",
        lineCount: 12,
        importedLineCount: 6,
        manualLineCount: 3,
        unsupportedLineCount: 3,
        canImportLinkedDpgfIntoCurrentStructure: false,
        linkedDpgfMappedRowCount: 0,
      },
      takeoffEnabled: true,
    });

    expect(steps[2]).toMatchObject({
      key: "devis",
      status: "in_progress",
      summary:
        "12 lignes de devis existent deja, dont 3 a revoir avant de poursuivre la structure.",
    });
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
      scope.queryByRole("button", { name: /Préparer le PDF/i })
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

  it("reuses the focused register href from gating details when available", () => {
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
              details: {
                register_entries: [
                  {
                    id: "reg-clarify-1",
                    text: "Clarifier la variante retenue",
                    scope_label: "Dossier",
                    source_file_name: "courrier-client.eml",
                    href: "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption&registerFocus=reg-clarify-1",
                  },
                ],
              },
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
        "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption&registerFocus=reg-clarify-1#register",
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
