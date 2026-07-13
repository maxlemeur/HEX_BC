import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyticsPayload } from "@/lib/analytics/server";

const { refreshMock, replaceMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
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

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/analytics",
  useRouter: () => ({
    refresh: refreshMock,
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ChiffreurDashboard } from "@/components/analytics/ChiffreurDashboard";

const INITIAL_DATA: AnalyticsPayload = {
  generatedAt: "2026-07-12T08:30:00.000Z",
  scope: {
    mode: "all",
    ownerUserId: null,
    isAdmin: true,
    viewerRole: "admin",
  },
  kpis: {
    activeAffaires: 2,
    acceptedRevenueCents: 1245000,
    acceptedVersions: 1,
    sentVersions: 1,
    acceptanceRate: 50,
    avgDaysToFirstAcceptance: 4,
  },
  trend: [
    {
      key: "2026-07",
      label: "juil. 2026",
      createdCount: 2,
      acceptedCount: 1,
    },
  ],
  topAffaires: [
    {
      projectId: "project-alpha",
      projectName: "Affaire Alpha",
      projectReference: "AFF-001",
      projectClient: "Client Alpha",
      versionCount: 2,
      hasCurrentVersion: true,
      currentVersionId: "version-alpha",
      currentVersionNumber: 2,
      currentStatus: "draft",
      currentTotalHtCents: 420000,
      currentUpdatedAt: "2026-07-11T10:00:00.000Z",
      acceptedVersionId: null,
      acceptedVersionNumber: null,
    },
    {
      projectId: "project-beta",
      projectName: "Affaire Beta",
      projectReference: "AFF-002",
      projectClient: null,
      versionCount: 0,
      hasCurrentVersion: false,
      currentVersionId: null,
      currentVersionNumber: null,
      currentStatus: null,
      currentTotalHtCents: null,
      currentUpdatedAt: "2026-07-10T10:00:00.000Z",
      acceptedVersionId: null,
      acceptedVersionNumber: null,
    },
  ],
  owners: [
    {
      ownerUserId: "owner-1",
      ownerName: "Camille Martin",
      ownerRole: "engineer",
      activeAffairesCount: 2,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChiffreurDashboard", () => {
  it("keeps the header and owner selector responsive", () => {
    render(<ChiffreurDashboard initialData={INITIAL_DATA} />);

    const title = screen.getByRole("heading", { name: "Tableau de bord" });
    expect(title.closest(".page-header")).toHaveClass("flex-col", "sm:flex-row");
    expect(screen.getByLabelText("Filtrer par chiffreur")).toHaveClass(
      "w-full",
      "sm:w-auto"
    );
    expect(screen.getByText("CA accepté")).toBeInTheDocument();
    expect(screen.getByText("Délai avant 1re acceptation")).toBeInTheDocument();
  });

  it("renders mobile cards and a desktop table with real navigation links", () => {
    render(<ChiffreurDashboard initialData={INITIAL_DATA} />);

    expect(screen.getByTestId("analytics-top-affaires-mobile")).toHaveClass(
      "md:hidden"
    );
    expect(screen.getByTestId("analytics-top-affaires-desktop")).toHaveClass(
      "hidden",
      "md:block"
    );

    const alphaLinks = screen.getAllByRole("link", { name: /Affaire Alpha/i });
    expect(alphaLinks).toHaveLength(2);
    alphaLinks.forEach((link) => {
      expect(link).toHaveAttribute(
        "href",
        "/dashboard/estimates/version-alpha/edit"
      );
    });

    const betaLinks = screen.getAllByRole("link", { name: /Affaire Beta/i });
    expect(betaLinks).toHaveLength(2);
    betaLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/dashboard/affaires/project-beta");
    });
  });
});
