import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AffairePageDataResult } from "./types";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let searchParamsValue = new URLSearchParams();
let isExpertValue = false;

vi.mock("next/dynamic", () => ({
  default: () => function MockDynamic(props: {
    onManagerFilterChange?: (next: "follow_up") => void;
    managerQueueSummaryState?: string;
  }) {
    return (
      <div data-testid="dense-table">
        <span>{`manager-state:${props.managerQueueSummaryState ?? "missing"}`}</span>
        <button
          type="button"
          onClick={() => props.onManagerFilterChange?.("follow_up")}
        >
          manager-follow-up
        </button>
      </div>
    );
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
    isExpert: isExpertValue,
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

vi.mock("@/app/dashboard/affaires/_actions/manager-queue", () => ({
  fetchAffaireManagerQueueSummaryAction: vi.fn().mockResolvedValue({
    counts: {
      followUp: 1,
      reservations: 0,
      revalidation: 0,
    },
    incompleteCount: 0,
  }),
}));

vi.mock("./QuickCreateAffaireDialog", () => ({
  QuickCreateAffaireDialog: () => null,
}));

vi.mock("./AffairesCardList", () => ({
  AffairesCardList: ({
    items,
    onToggleFavorite,
    favoritePendingIds,
  }: {
    items: Array<{
      projectId: string;
      projectName: string;
      isFavorite: boolean;
    }>;
    onToggleFavorite: (projectId: string, nextIsFavorite: boolean) => void;
    favoritePendingIds: string[];
  }) => (
    <div data-testid="card-list">
      {items.map((item) => (
        <div key={item.projectId}>
          <span>{`${item.projectName}:${item.isFavorite ? "favorite" : "not-favorite"}`}</span>
          <span>{favoritePendingIds.includes(item.projectId) ? "pending" : "idle"}</span>
          <button
            type="button"
            onClick={() => onToggleFavorite(item.projectId, !item.isFavorite)}
          >
            {`toggle-${item.projectName}`}
          </button>
        </div>
      ))}
    </div>
  ),
}));

import {
  AFFAIRE_SEARCH_DEBOUNCE_MS,
  AffairesPageClient,
} from "./AffairesPageClient";
import { toggleAffaireFavoriteAction } from "@/app/dashboard/affaires/_actions/favorites";
import { fetchAffaireManagerQueueSummaryAction } from "@/app/dashboard/affaires/_actions/manager-queue";

const initialData: AffairePageDataResult = {
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

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AffairesPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    searchParamsValue = new URLSearchParams();
    isExpertValue = false;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("syncs the favorites filter to the URL", async () => {
    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
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

  it("sorts affairs by name in ascending or descending order", async () => {
    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Trier par Date MAJ/i })
    );
    fireEvent.click(screen.getByRole("option", { name: "Nom" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/dashboard/affaires?sort=name&dir=asc",
        { scroll: false }
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Trier par Nom/i }));
    fireEvent.click(screen.getByRole("option", { name: "Nom" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/dashboard/affaires?sort=name",
        { scroll: false }
      );
    });
  });

  it("sorts affairs by current amount", async () => {
    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Trier par Date MAJ/i })
    );
    fireEvent.click(screen.getByRole("option", { name: "Montant" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/dashboard/affaires?sort=totalHtCents",
        { scroll: false }
      );
    });
  });

  it("debounces search navigation while the user is typing", async () => {
    vi.useFakeTimers();

    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    const searchInput = screen.getByPlaceholderText(
      "Rechercher par nom ou client..."
    );
    fireEvent.change(searchInput, { target: { value: "L" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AFFAIRE_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(replaceMock).not.toHaveBeenCalled();

    fireEvent.change(searchInput, { target: { value: "LL" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AFFAIRE_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/affaires?q=LL", {
      scroll: false,
    });
  });

  it("updates the favorites filter when navigation changes incoming props", async () => {
    searchParamsValue = new URLSearchParams("favorites=1");

    const { rerender } = render(
      <AffairesPageClient
        key="favorites-on"
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={true}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    const favoritesButton = screen.getByRole("button", { name: /favoris/i });
    expect(favoritesButton.getAttribute("aria-pressed")).toBe("true");

    replaceMock.mockClear();
    searchParamsValue = new URLSearchParams();

    rerender(
      <AffairesPageClient
        key="favorites-off"
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /favoris/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("keeps optimistic favorite overrides for rows still pending across refreshes", async () => {
    const firstToggle = createDeferred<{ ok: boolean }>();
    const secondToggle = createDeferred<{ ok: boolean }>();
    vi.mocked(toggleAffaireFavoriteAction)
      .mockReturnValueOnce(firstToggle.promise)
      .mockReturnValueOnce(secondToggle.promise);

    const twoAffairesData: AffairePageDataResult = {
      ...initialData,
      list: {
        ...initialData.list,
        items: [
          initialData.list.items[0],
          {
            ...initialData.list.items[0],
            projectId: "33333333-3333-4333-8333-333333333333",
            projectName: "Affaire Beta",
            projectReference: "REF-002",
          },
        ],
      },
      counters: {
        ...initialData.counters,
        totalCount: 2,
        filteredCount: 2,
        statusCounts: {
          ...initialData.counters.statusCounts,
          draft: 2,
        },
      },
    };

    const { rerender } = render(
      <AffairesPageClient
        initialData={twoAffairesData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle-Affaire Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-Affaire Beta" }));

    await waitFor(() => {
      expect(screen.getByText("Affaire Alpha:favorite")).toBeTruthy();
      expect(screen.getByText("Affaire Beta:favorite")).toBeTruthy();
      expect(screen.getAllByText("pending")).toHaveLength(2);
    });

    firstToggle.resolve({ ok: true });

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Affaire Beta:favorite")).toBeTruthy();
      expect(screen.getByText("pending")).toBeTruthy();
    });

    rerender(
      <AffairesPageClient
        initialData={{
          ...twoAffairesData,
          list: {
            ...twoAffairesData.list,
            items: twoAffairesData.list.items.map((item) =>
              item.projectId === "11111111-1111-4111-8111-111111111111"
                ? { ...item, isFavorite: true }
                : item
            ),
          },
        }}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Affaire Alpha:favorite")).toBeTruthy();
      expect(screen.getByText("Affaire Beta:favorite")).toBeTruthy();
      expect(screen.getByText("pending")).toBeTruthy();
      expect(screen.getByText("idle")).toBeTruthy();
    });
  });

  it("selects every displayed draft and confirms the exact bulk target count", () => {
    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    expect(screen.getByText("0 affaire selectionnee")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Selectionner les brouillons affiches (1)",
      })
    );

    expect(screen.getByText("1 affaire selectionnee")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Supprimer la selection (1)" })
    );

    expect(
      screen.getByRole("heading", { name: "Supprimer 1 affaire" })
    ).toBeInTheDocument();
  });

  it("syncs the manager queue filter to the URL", async () => {
    isExpertValue = true;

    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "manager-follow-up" }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/dashboard/affaires?manager=follow_up",
        { scroll: false }
      );
    });
  });

  it("falls back to an error state when the manager queue fetch stalls", async () => {
    vi.useFakeTimers();
    isExpertValue = true;
    const deferred = createDeferred<{
      counts: { followUp: number; reservations: number; revalidation: number };
      incompleteCount: number;
    }>();
    vi.mocked(fetchAffaireManagerQueueSummaryAction).mockReturnValueOnce(
      deferred.promise
    );

    render(
      <AffairesPageClient
        initialData={initialData}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    expect(screen.getByText("manager-state:loading")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.getByText("manager-state:error")).toBeInTheDocument();
  });

  it("does not start manager qualification for portfolios above the supported volume", async () => {
    isExpertValue = true;

    render(
      <AffairesPageClient
        initialData={{
          ...initialData,
          counters: {
            ...initialData.counters,
            totalCount: 997,
            filteredCount: 997,
          },
        }}
        initialQ=""
        initialStatuses={[]}
        initialFavoritesOnly={false}
        initialManager="all"
        initialCursor={null}
        initialSize={20}
        initialSort="updatedAt"
        initialDir="desc"
      />
    );

    expect(screen.getByText("manager-state:unavailable")).toBeInTheDocument();
    expect(fetchAffaireManagerQueueSummaryAction).not.toHaveBeenCalled();
  });
});
