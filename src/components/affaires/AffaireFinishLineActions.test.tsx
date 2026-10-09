import { render,screen,waitFor,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,describe,expect,it,vi } from "vitest";

import { ToastProvider } from "@/components/ui-legacy/Toast";
import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { AffaireFinishLineActions } from "./AffaireFinishLineActions";

const {
  exportEstimateMock,
  routerRefreshMock,
  requestEstimatePdfGenerationMock,
  fetchEstimatePdfStatusMock,
  fetchEstimatePdfLayoutConfigurationMock,
} = vi.hoisted(() => ({
  exportEstimateMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  requestEstimatePdfGenerationMock: vi.fn(),
  fetchEstimatePdfStatusMock: vi.fn(),
  fetchEstimatePdfLayoutConfigurationMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/lib/estimates/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/estimates/client")>(
    "@/lib/estimates/client"
  );

  return {
    ...actual,
    exportEstimate: exportEstimateMock,
    requestEstimatePdfGeneration: requestEstimatePdfGenerationMock,
    fetchEstimatePdfStatus: fetchEstimatePdfStatusMock,
    fetchEstimatePdfLayoutConfiguration: fetchEstimatePdfLayoutConfigurationMock,
  };
});

vi.mock("./AffaireOrderDraftsPanel", () => ({
  AffaireOrderDraftsPanel: () => (
    <div data-testid="affaire-order-drafts-panel">finish-line-orders-panel</div>
  ),
}));

function makeFinishLineSummary(
  overrides?: Partial<AffaireHubFinishLineSummaryResult>
): AffaireHubFinishLineSummaryResult {
  return {
    versionId: "version-1",
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
          label: "Prix à revalider",
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
              label: "Prix à revalider",
              description: "Certains prix datent.",
            },
          ],
          blockerCount: 0,
          alertCount: 1,
        },
      ],
      checkedAt: "2026-03-11T09:00:00.000Z",
      stalePriceDays: 30,
      errorMessage: null,
    },
    readyToSend: {
      status: "warning",
      blockingFlags: [],
      warningFlags: [
        {
          key: "supplier_price_outdated",
          severity: "warning",
          count: 1,
          item_ids: [],
          label: "Prix à revalider",
          description: "Certains prix datent.",
        },
      ],
      checkedAt: "2026-03-11T09:00:00.000Z",
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
    ...overrides,
  };
}

function renderActions(
  props: Partial<Parameters<typeof AffaireFinishLineActions>[0]> = {}
) {
  return render(
    <ToastProvider>
      <AffaireFinishLineActions
        projectId="project-1"
        projectName="Affaire test"
        currentVersion={{
          id: "version-1",
          status: "draft",
          versionNumber: 1,
        }}
        finishLineSummary={makeFinishLineSummary()}
        {...props}
      />
    </ToastProvider>
  );
}

function getLatestByTestId(testId: string) {
  const matches = screen.getAllByTestId(testId);
  return matches[matches.length - 1]!;
}

describe("AffaireFinishLineActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    exportEstimateMock.mockReset();
    requestEstimatePdfGenerationMock.mockReset();
    fetchEstimatePdfStatusMock.mockReset();
    fetchEstimatePdfLayoutConfigurationMock.mockReset();
    fetchEstimatePdfLayoutConfigurationMock.mockResolvedValue({
      lineCount: 1,
      sectionCountsByLevel: { 1: 1, 2: 0, 3: 0, 4: 0 },
      hasConditions: true,
      terms: {
        available: false,
        policy: "optional",
        title: null,
        version: null,
      },
    });
    routerRefreshMock.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("keeps a queued sending dispatch resumable after reload", async () => {
    const user = userEvent.setup();
    renderActions({
      currentVersion: {
        id: "version-1",
        status: "sending",
        versionNumber: 1,
      },
      finishLineSummary: null,
    });

    expect(screen.getByText(/Version 1 · Envoi en cours/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Un envoi est déjà réservé/i).length
    ).toBeGreaterThan(0);

    const resumeButton = within(
      getLatestByTestId("affaire-finish-line-email")
    ).getByRole("button", { name: /Reprendre l'envoi/i });
    expect(resumeButton).not.toBeDisabled();

    await user.click(resumeButton);

    expect(
      screen.getAllByRole("heading", { name: /Envoyer le devis par email/i })
        .length
    ).toBeGreaterThan(0);
  });

  it("keeps email preparation disabled on finalized versions", () => {
    renderActions({
      currentVersion: {
        id: "version-1",
        status: "accepted",
        versionNumber: 1,
      },
      finishLineSummary: makeFinishLineSummary({
        readyToSend: {
          status: "ready",
          blockingFlags: [],
          warningFlags: [],
          checkedAt: "2026-03-11T09:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      }),
    });

    const button = within(
      getLatestByTestId("affaire-finish-line-email")
    ).getByRole("button", {
      name: /Préparer l'envoi/i,
    });

    expect(button).toBeDisabled();
    expect(
      screen.getAllByText(/L'envoi par email reste réservé aux versions brouillon ou envoyées/i)
        .length
    ).toBeGreaterThan(0);
  });

  it("keeps email preparation disabled while the finish line is blocked", () => {
    renderActions({
      finishLineSummary: makeFinishLineSummary({
        submissionReadiness: {
          status: "blocked",
          blockers: [
            {
              key: "no_pdf_generated",
              category: "pdf",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "PDF absent",
              description: "Aucun PDF genere.",
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
                  severity: "blocking",
                  count: 1,
                  item_ids: [],
                  label: "PDF absent",
                  description: "Aucun PDF genere.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
          ],
          checkedAt: "2026-03-11T09:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
        readyToSend: {
          status: "blocked",
          blockingFlags: [
            {
              key: "no_pdf_generated",
              category: "pdf",
              severity: "blocking",
              count: 1,
              item_ids: [],
              label: "PDF absent",
              description: "Aucun PDF genere.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T09:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      }),
    });

    expect(
      within(getLatestByTestId("affaire-finish-line-email")).getByRole("button", {
        name: /Préparer l'envoi/i,
      })
    ).toBeDisabled();
    expect(
      screen.getAllByText(/Générez d'abord le PDF ici, puis préparez l'email/i).length
    ).toBeGreaterThan(0);
  });

  it("keeps non-pdf blockers out of the pdf-specific guidance", () => {
    renderActions({
      finishLineSummary: makeFinishLineSummary({
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
              description: "Des pièces critiques restent manquantes.",
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
                  description: "Des pièces critiques restent manquantes.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
          ],
          checkedAt: "2026-03-11T09:00:00.000Z",
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
              description: "Des pièces critiques restent manquantes.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T09:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      }),
    });
    const emailCard = getLatestByTestId("affaire-finish-line-email").closest("article");

    expect(emailCard).not.toBeNull();
    expect(
      within(emailCard as HTMLElement).getByText(
        /1 blocage visible juste au-dessus avant l'envoi/i
      )
    ).toBeInTheDocument();
    expect(
      within(emailCard as HTMLElement).queryByText(
        /Générez d'abord le PDF ici, puis préparez l'email/i
      )
    ).not.toBeInTheDocument();
  });

  it("prioritizes submission readiness over the alias when email gating diverges", () => {
    renderActions({
      finishLineSummary: makeFinishLineSummary({
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
              label: "Prix à revalider",
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
                  label: "Prix à revalider",
                  description: "Certains prix datent.",
                },
              ],
              blockerCount: 0,
              alertCount: 1,
            },
          ],
          checkedAt: "2026-03-11T09:00:00.000Z",
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
          checkedAt: "2026-03-11T09:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      }),
    });

    expect(
      within(getLatestByTestId("affaire-finish-line-email")).getByRole("button", {
        name: /Préparer l'envoi/i,
      })
    ).not.toBeDisabled();
    expect(
      screen.getAllByText(/1 point reste à vérifier avant l'envoi final/i).length
    ).toBeGreaterThan(0);
    const emailCard = getLatestByTestId("affaire-finish-line-email").closest("article");
    expect(emailCard).not.toBeNull();
    expect(
      within(emailCard as HTMLElement).getByText("Qualité devis · 1 reserve")
    ).toBeInTheDocument();
  });

  it("shows canonical blocker categories in the email card", () => {
    renderActions({
      finishLineSummary: makeFinishLineSummary({
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
              description: "Aucun PDF genere.",
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
                  description: "Aucun PDF genere.",
                },
              ],
              alerts: [],
              blockerCount: 1,
              alertCount: 0,
            },
          ],
          checkedAt: "2026-03-11T09:00:00.000Z",
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
              description: "Aucun PDF genere.",
            },
          ],
          warningFlags: [],
          checkedAt: "2026-03-11T09:00:00.000Z",
          stalePriceDays: 30,
          errorMessage: null,
        },
      }),
    });

    const emailCard = getLatestByTestId("affaire-finish-line-email").closest("article");
    expect(emailCard).not.toBeNull();
    expect(
      within(emailCard as HTMLElement).getByText("Documents · 1 blocage")
    ).toBeInTheDocument();
    expect(
      within(emailCard as HTMLElement).getByText("PDF · 1 blocage")
    ).toBeInTheDocument();
  });

  it("shows a readable export error without hiding the finish line", async () => {
    const user = userEvent.setup();
    exportEstimateMock.mockRejectedValueOnce(new Error("Export indisponible"));

    renderActions();
    await user.click(
      within(getLatestByTestId("affaire-finish-line-bdc")).getByRole("button", {
        name: /Exporter le BDC/i,
      })
    );

    await waitFor(() => {
      expect(screen.getAllByRole("alert").some((element) => element.textContent?.includes("Export indisponible"))).toBe(true);
    });
    expect(screen.getAllByText("PDF, email et BDC depuis le même point").length).toBeGreaterThan(0);
  });
});
