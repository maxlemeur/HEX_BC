import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { ToastProvider } from "@/components/ui/Toast";
import { AffaireFinishLineActions } from "./AffaireFinishLineActions";

const {
  exportEstimateMock,
  routerRefreshMock,
  requestEstimatePdfGenerationMock,
  fetchEstimatePdfStatusMock,
} = vi.hoisted(() => ({
  exportEstimateMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  requestEstimatePdfGenerationMock: vi.fn(),
  fetchEstimatePdfStatusMock: vi.fn(),
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
  };
});

function makeFinishLineSummary(
  overrides?: Partial<AffaireHubFinishLineSummaryResult>
): AffaireHubFinishLineSummaryResult {
  return {
    versionId: "version-1",
    readyToSend: {
      status: "warning",
      blockingFlags: [],
      warningFlags: [
        {
          key: "supplier_price_outdated",
          severity: "warning",
          count: 1,
          item_ids: [],
          label: "Prix a revalider",
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
    routerRefreshMock.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("renders the three finish-line outputs in a single zone", () => {
    renderActions();

    expect(screen.getByText("PDF, email et BDC depuis le meme point")).toBeInTheDocument();
    expect(screen.getByText(/Version 1 · Brouillon/i)).toBeInTheDocument();
    expect(screen.getByText("PDF du devis")).toBeInTheDocument();
    expect(screen.getByText("Email client")).toBeInTheDocument();
    expect(screen.getByText("Export BDC")).toBeInTheDocument();
  });

  it("opens the send modal from the finish line", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(
      within(getLatestByTestId("affaire-finish-line-email")).getByRole("button", {
        name: /Preparer l'envoi/i,
      })
    );

    expect(
      screen.getByRole("heading", { name: /Envoyer le devis par email/i })
    ).toBeInTheDocument();
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
      name: /Preparer l'envoi/i,
    });

    expect(button).toBeDisabled();
    expect(
      screen.getAllByText(/L'envoi email reste reserve aux versions brouillon ou envoyee/i)
        .length
    ).toBeGreaterThan(0);
  });

  it("keeps email preparation disabled while the finish line is blocked", () => {
    renderActions({
      finishLineSummary: makeFinishLineSummary({
        readyToSend: {
          status: "blocked",
          blockingFlags: [
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

    expect(
      within(getLatestByTestId("affaire-finish-line-email")).getByRole("button", {
        name: /Preparer l'envoi/i,
      })
    ).toBeDisabled();
    expect(
      screen.getAllByText(/Generez d'abord le PDF ici, puis preparez l'email/i).length
    ).toBeGreaterThan(0);
  });

  it("generates the PDF from the affaire finish line and refreshes the hub", async () => {
    const user = userEvent.setup();
    requestEstimatePdfGenerationMock.mockResolvedValueOnce({
      status: "ready",
      downloadUrl: "https://example.test/devis-v1.pdf",
    });

    renderActions();

    await user.click(
      within(getLatestByTestId("affaire-finish-line-pdf")).getByRole("button", {
        name: /Telecharger le PDF/i,
      })
    );

    await waitFor(() => {
      expect(requestEstimatePdfGenerationMock).toHaveBeenCalledWith("version-1");
    });
    expect(window.open).toHaveBeenCalledWith(
      "https://example.test/devis-v1.pdf",
      "_blank",
      "noopener,noreferrer"
    );
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("exports the BDC from the finish line", async () => {
    const user = userEvent.setup();
    exportEstimateMock.mockResolvedValueOnce({
      filename: "devis-v1-bdc.xlsx",
      size: 1024,
    });

    renderActions();
    await user.click(
      within(getLatestByTestId("affaire-finish-line-bdc")).getByRole("button", {
        name: /Exporter le BDC/i,
      })
    );

    await waitFor(() => {
      expect(exportEstimateMock).toHaveBeenCalledWith("version-1", "xlsx", {
        mode: "bdc",
      });
    });
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
    expect(screen.getAllByText("PDF, email et BDC depuis le meme point").length).toBeGreaterThan(0);
  });

  it("guides back to version creation when no estimate exists yet", () => {
    renderActions({
      currentVersion: null,
      finishLineSummary: null,
    });

    expect(screen.getByText(/Creez d'abord une version de devis/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Creer un devis/i })).toHaveAttribute(
      "href",
      "/dashboard/estimates/new?projectId=project-1"
    );
  });
});
