import { render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,describe,expect,it,vi } from "vitest";

import { ToastProvider } from "@/components/ui-legacy/Toast";
import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { AffaireFinishLineActions } from "./AffaireFinishLineActions";

const {
  routerRefreshMock,
  requestEstimatePdfGenerationMock,
  fetchEstimatePdfStatusMock,
  fetchEstimatePdfLayoutConfigurationMock,
} = vi.hoisted(() => ({
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
      counts: {
        totalSupplierLines: 3,
        draftableLines: 3,
        transferredLines: 0,
        blockedLines: 0,
      },
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
});
