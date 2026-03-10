import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/dynamic", () => ({
  default: () => function MockDynamic() {
    return <div data-testid="dense-table" />;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires",
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: () => ({
    isExpert: false,
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

vi.mock("@/app/dashboard/affaires/_actions/favorites", () => ({
  toggleAffaireFavoriteAction: vi.fn(),
}));

vi.mock("./QuickCreateAffaireDialog", () => ({
  QuickCreateAffaireDialog: () => null,
}));

vi.mock("./AffairesCardList", () => ({
  AffairesCardList: () => <div data-testid="card-list" />,
}));

import { AffairesPageClient } from "./AffairesPageClient";

const initialData = {
  list: {
    items: [
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        projectName: "Affaire Alpha",
        projectReference: "REF-001",
        projectClient: "Client Demo",
        isFavorite: false,
        versionCount: 1,
        hasCurrentVersion: true,
        currentVersionId: "22222222-2222-4222-8222-222222222222",
        currentVersionNumber: 1,
        currentStatus: "draft" as const,
        currentTotalHtCents: 125000,
        currentUpdatedAt: "2026-03-10T10:00:00.000Z",
        acceptedVersionId: null,
        acceptedVersionNumber: null,
        hasDpgf: false,
        currentApprovalStatus: null,
      },
    ],
    pageSize: 20 as const,
    nextCursor: null,
    hasNextPage: false,
  },
  counters: {
    totalCount: 1,
    filteredCount: 1,
    statusCounts: {
      draft: 1,
      sent: 0,
      accepted: 0,
      archived: 0,
    },
  },
};

describe("AffairesPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = new URLSearchParams();
    window.localStorage.clear();
  });

  it("syncs the favorites filter to the URL", async () => {
    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialCursor={null}
        initialSize={20}
        initialDir="desc"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /favoris/i }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/dashboard/affaires?favorites=1",
        { scroll: false }
      );
    });
  });
});
