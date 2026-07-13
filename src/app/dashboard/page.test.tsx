import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AffaireListItem, AffairePageDataResult } from "@/lib/affaires/server";

const { fetchAffairePageDataMock, getUserContextMock } = vi.hoisted(() => ({
  fetchAffairePageDataMock: vi.fn(),
  getUserContextMock: vi.fn(),
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

vi.mock("@/components/dashboard/DashboardHomeResumeLink", () => ({
  DashboardHomeResumeLink: () => <span>Reprendre</span>,
}));

vi.mock("@/lib/affaires/server", () => ({
  fetchAffairePageData: fetchAffairePageDataMock,
}));

vi.mock("@/lib/auth/server", () => ({
  getUserContext: getUserContextMock,
}));

import { buildDashboardShortcuts } from "@/app/dashboard/dashboard-shortcuts";
import DashboardPage from "@/app/dashboard/page";

function makeAffaire(index: number): AffaireListItem {
  return {
    projectId: `project-${index}`,
    projectName: `Affaire ${index}`,
    projectReference: `REF-${index}`,
    projectClient: `Client ${index}`,
    isFavorite: false,
    versionCount: 1,
    hasCurrentVersion: true,
    currentVersionId: `version-${index}`,
    currentVersionNumber: 1,
    currentStatus: index % 2 === 0 ? "accepted" : "draft",
    currentTotalHtCents: 1000,
    currentUpdatedAt: `2026-07-${String(12 - index).padStart(2, "0")}T10:00:00.000Z`,
    acceptedVersionId: null,
    acceptedVersionNumber: null,
    hasDpgf: false,
    currentApprovalStatus: null,
  };
}

const data: AffairePageDataResult = {
  list: {
    items: Array.from({ length: 6 }, (_, index) => makeAffaire(index + 1)),
    pageSize: 20,
    nextCursor: null,
    hasNextPage: false,
  },
  counters: {
    totalCount: 18,
    filteredCount: 18,
    statusCounts: {
      draft: 7,
      sent: 4,
      accepted: 5,
      archived: 2,
    },
  },
  managerQueue: null,
};

beforeEach(() => {
  fetchAffairePageDataMock.mockResolvedValue(data);
  getUserContextMock.mockResolvedValue({
    userEmail: "admin@example.com",
    tenantId: "tenant-1",
    profile: { tenant_role: "admin", ui_mode: "expert" },
  });
});

describe("DashboardPage", () => {
  it("renders bounded current metrics and only five recent affaires", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());

    expect(fetchAffairePageDataMock).toHaveBeenCalledWith({
      size: 20,
      dir: "desc",
    });
    expect(markup).toContain("Vue d’ensemble");
    expect(markup).toContain("Affaires actives");
    expect(markup).toContain(">16<");
    expect(markup).toContain("Affaire 5");
    expect(markup).not.toContain("Affaire 6");
  });

  it("shows admin creation and role-specific shortcuts", async () => {
    const markup = renderToStaticMarkup(await DashboardPage());

    expect(markup).toContain('href="/dashboard/affaires/new"');
    expect(markup).toContain('href="/dashboard/approvals"');
    expect(markup).toContain('href="/dashboard/direction"');
    expect(markup).toContain('href="/dashboard/analytics"');
    expect(markup).toContain('href="/dashboard/admin"');
  });

  it("keeps viewer shortcuts within viewer permissions", async () => {
    getUserContextMock.mockResolvedValue({
      userEmail: "viewer@example.com",
      tenantId: "tenant-1",
      profile: { tenant_role: "viewer", ui_mode: "simplified" },
    });

    const markup = renderToStaticMarkup(await DashboardPage());

    expect(markup).toContain("Voir les affaires");
    expect(markup).not.toContain('href="/dashboard/affaires/new"');
    expect(markup).not.toContain('href="/dashboard/approvals"');
    expect(markup).not.toContain('href="/dashboard/direction"');
    expect(markup).not.toContain('href="/dashboard/analytics"');
    expect(markup).not.toContain('href="/dashboard/admin"');
  });
});

describe("buildDashboardShortcuts", () => {
  it("adds performances for expert engineers only", () => {
    expect(
      buildDashboardShortcuts("engineer", "simplified").some(
        (shortcut) => shortcut.href === "/dashboard/analytics"
      )
    ).toBe(false);
    expect(
      buildDashboardShortcuts("engineer", "expert").some(
        (shortcut) => shortcut.href === "/dashboard/analytics"
      )
    ).toBe(true);
  });
});
