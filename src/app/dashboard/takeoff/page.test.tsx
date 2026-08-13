import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AffaireListItem, AffaireListPageResult } from "@/lib/affaires/server";

const mocks = vi.hoisted(() => ({
  fetchAffaireList: vi.fn(),
  getUserContext: vi.fn(),
  isTakeoffEnabled: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    prefetch,
    className,
    children,
  }: {
    href: string;
    prefetch?: boolean;
    className?: string;
    children: React.ReactNode;
  }) {
    return (
      <a href={href} data-prefetch={String(prefetch)} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/lib/affaires/server", () => ({
  fetchAffaireList: mocks.fetchAffaireList,
}));

vi.mock("@/lib/auth/server", () => ({
  getUserContext: mocks.getUserContext,
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: mocks.isTakeoffEnabled,
}));

import TakeoffPage from "@/app/dashboard/takeoff/page";

function makeAffaire(index: number, withVersion = true): AffaireListItem {
  return {
    projectId: `project-${index}`,
    projectName: `Affaire ${index}`,
    projectReference: `REF-${index}`,
    projectClient: `Client ${index}`,
    isFavorite: false,
    versionCount: withVersion ? 1 : 0,
    hasCurrentVersion: withVersion,
    currentVersionId: withVersion ? `version-${index}` : null,
    currentVersionNumber: withVersion ? 1 : null,
    currentStatus: withVersion ? "draft" : null,
    currentTotalHtCents: withVersion ? 1000 : null,
    currentUpdatedAt: "2026-08-12T10:00:00.000Z",
    acceptedVersionId: null,
    acceptedVersionNumber: null,
    hasDpgf: false,
    currentApprovalStatus: null,
  };
}

const pageData: AffaireListPageResult = {
  items: [makeAffaire(1), makeAffaire(2, false)],
  pageSize: 20,
  nextCursor: "cursor-next",
  hasNextPage: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserContext.mockResolvedValue({ tenantId: "tenant-1" });
  mocks.isTakeoffEnabled.mockResolvedValue(true);
  mocks.fetchAffaireList.mockResolvedValue(pageData);
});

describe("TakeoffPage", () => {
  it("loads one bounded cursor page and disables link prefetch", async () => {
    const markup = renderToStaticMarkup(
      await TakeoffPage({ searchParams: Promise.resolve({ cursor: "cursor-in" }) })
    );

    expect(mocks.fetchAffaireList).toHaveBeenCalledWith({
      size: 20,
      cursor: "cursor-in",
      sort: "updatedAt",
      dir: "desc",
    });
    expect(markup).toContain("Affaire 1");
    expect(markup).toContain('href="/dashboard/estimates/version-1/takeoff"');
    expect(markup).toContain('href="/dashboard/affaires/project-2"');
    expect(markup).toContain('href="/dashboard/takeoff?cursor=cursor-next"');
    expect(markup).toContain('data-prefetch="false"');
  });
});
