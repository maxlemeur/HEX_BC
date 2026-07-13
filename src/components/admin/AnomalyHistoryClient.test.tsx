import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { swrMock } = vi.hoisted(() => ({
  swrMock: vi.fn(),
}));

vi.mock("swr", () => ({
  default: swrMock,
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

import { AnomalyHistoryClient } from "@/app/dashboard/admin/anomaly-history/AnomalyHistoryClient";

beforeEach(() => {
  vi.clearAllMocks();
  swrMock.mockImplementation((key: readonly [string, string, string]) => ({
    data: key[0] === "anomaly-history-current" ? {
      summary: {
        totalAnomalies: 1,
        blockingCount: 1,
        warningCount: 0,
        estimatesAffected: 1,
        estimatesTotal: 1,
      },
      currentAnomalies: [
        {
          versionId: "version-1",
          versionLabel: "V2",
          projectName: "Affaire Alpha",
          ownerUserId: "owner-1",
          ownerName: "Camille Martin",
          flagKey: "missing_price",
          flagLabel: "Prix manquant",
          severity: "blocking",
          itemCount: 2,
        },
      ],
      ownerOptions: [{ id: "owner-1", name: "Camille Martin" }],
      pagination: {
        page: 1,
        size: 25,
        totalItems: 1,
        totalPages: 1,
      },
    } : {
      trend: [],
      avgResolution: [],
    },
    error: null,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AnomalyHistoryClient", () => {
  it("shows CSV export errors and keeps estimate navigation as a real link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      })
    );

    render(<AnomalyHistoryClient tenantId="tenant-1" />);

    const exportButton = screen.getByRole("button", { name: "Exporter CSV" });
    expect(exportButton).toHaveClass("w-full", "sm:w-auto");
    expect(screen.getAllByRole("link", { name: "V2" })[0]).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-1"
    );

    fireEvent.click(exportButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "L'export CSV a échoué."
    );
  });

  it("uses a named owner selector and renders mobile cards plus a desktop table", () => {
    render(<AnomalyHistoryClient tenantId="tenant-1" />);

    expect(screen.getByRole("combobox", { name: "Chiffreur" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "Camille Martin" })).toBeInTheDocument();
    expect(screen.queryByText("Chiffreur (user ID)")).not.toBeInTheDocument();

    const projectLabels = screen.getAllByText("Affaire Alpha");
    expect(projectLabels).toHaveLength(2);
    expect(projectLabels[0].closest("article")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Nombre d'anomalies par page" })).toHaveValue("25");
  });

  it("loads current anomalies and trends through independent views", () => {
    render(<AnomalyHistoryClient tenantId="tenant-1" />);

    const keys = swrMock.mock.calls.map(([key]) => key as readonly string[]);
    expect(keys).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          "anomaly-history-current",
          "tenant-1",
          expect.stringContaining("view=current"),
        ]),
        expect.arrayContaining([
          "anomaly-history-trend",
          "tenant-1",
          expect.stringContaining("view=trend"),
        ]),
      ])
    );
  });
});
