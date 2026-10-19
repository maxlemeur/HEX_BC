import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { AffairesDenseTable } from "./AffairesDenseTable";
import type { AffaireListItem,AffaireManagerQueueSummary } from "./types";

const pushMock = vi.fn();
const requestDeleteMock = vi.fn();
const fetchExpandDataMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    prefetch,
    children,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) {
    return (
      <a
        href={href}
        data-prefetch={prefetch}
        onClick={(event) => {
          event.preventDefault();
          onClick?.(event);
        }}
        {...props}
      >
        {children}
      </a>
    );
  },
}));

vi.mock("./AffaireConfirmDialog", () => ({
  AffaireConfirmDialog: () => null,
}));

vi.mock("./AffaireStatusBadges", () => ({
  AffaireStatusBadges: () => <div data-testid="affaire-status-badges">Statut</div>,
  AffaireApprovalBadge: () => null,
}));

vi.mock("./useDeleteAffaire", () => ({
  useDeleteAffaire: () => ({
    requestDelete: requestDeleteMock,
    modalProps: {
      open: false,
      title: "",
      message: "",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    },
  }),
}));

vi.mock("@/app/dashboard/affaires/_actions/dense-table-expand", () => ({
  fetchAffaireDenseExpandData: (...args: unknown[]) => fetchExpandDataMock(...args),
}));

const baseItem: AffaireListItem = {
  projectId: "project-1",
  projectName: "Affaire Alpha",
  projectReference: "REF-001",
  projectClient: "Client Demo",
  isFavorite: false,
  versionCount: 3,
  hasCurrentVersion: true,
  currentVersionId: "version-1",
  currentVersionNumber: 3,
  currentStatus: "sent",
  currentTotalHtCents: 125000,
  currentCurrency: "EUR",
  currentUpdatedAt: "2026-03-09T12:00:00.000Z",
  acceptedVersionId: null,
  acceptedVersionNumber: null,
  hasDpgf: true,
  currentApprovalStatus: null,
};

const defaultManagerQueueSummary: AffaireManagerQueueSummary = {
  counts: {
    followUp: 1,
    reservations: 2,
    revalidation: 1,
  },
  incompleteCount: 0,
};

function renderTable(
  overrides: Partial<React.ComponentProps<typeof AffairesDenseTable>> = {}
) {
  const onManagerFilterChange = vi.fn();

  render(
    <AffairesDenseTable
      items={[baseItem]}
      emptyVariant="filtered"
      onToggleFavorite={vi.fn()}
      favoritePendingIds={[]}
      managerFilter="all"
      onManagerFilterChange={onManagerFilterChange}
      managerQueueSummary={defaultManagerQueueSummary}
      managerQueueSummaryState="ready"
      {...overrides}
    />
  );

  return {
    onManagerFilterChange,
  };
}

describe("AffairesDenseTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchExpandDataMock.mockResolvedValue({
      summary: {
        currentVersion: null,
        acceptedVersion: null,
        lineCount: 0,
      },
      dpgfSource: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes the affaire as a real link and keeps the row click for the mouse", () => {
    renderTable();

    const nameLink = screen.getByRole("link", { name: "Affaire Alpha" });
    expect(nameLink).toHaveAttribute("href", "/dashboard/affaires/project-1");
    expect(nameLink.closest("tr")).not.toHaveAttribute("tabindex");

    fireEvent.click(screen.getByText("Client Demo"));
    expect(pushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1");
  });

  it("loads dense expansion data only when a row is expanded", () => {
    renderTable({
      items: [
        baseItem,
        {
          ...baseItem,
          projectId: "project-2",
          projectName: "Affaire Beta",
        },
      ],
    });

    expect(fetchExpandDataMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: /Déplier les détails de l’affaire/ })[0]!);

    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchExpandDataMock).toHaveBeenCalledTimes(1);
    expect(fetchExpandDataMock).toHaveBeenCalledWith("project-1");
  });

  it("does not trigger row navigation when the favorite toggle is clicked", () => {
    const onToggleFavorite = vi.fn();

    renderTable({
      onToggleFavorite,
    });

    fireEvent.click(screen.getByRole("button", { name: /ajouter aux favoris/i }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(onToggleFavorite).toHaveBeenCalledWith("project-1", true);
  });


  it("allows manual selection and deletion only for draft affaires", async () => {
    const onToggleProjectSelection = vi.fn();
    renderTable({
      items: [
        { ...baseItem, currentStatus: "draft" },
        {
          ...baseItem,
          projectId: "project-2",
          projectName: "Affaire envoyee",
        },
      ],
      selectedProjectIds: new Set(["project-1"]),
      onToggleProjectSelection,
    });

    const draftCheckbox = screen.getByRole("checkbox", {
      name: "Sélectionner l'affaire Affaire Alpha",
    });
    expect(draftCheckbox).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      screen.getByRole("link", {
        name: "Éditer le chiffrage de l’affaire Affaire Alpha",
      })
    ).toHaveAttribute("href", "/dashboard/estimates/version-1/edit");
    expect(
      screen.getByRole("link", {
        name: "Voir le chiffrage de l’affaire Affaire envoyee",
      })
    ).toHaveAttribute("href", "/dashboard/estimates/version-1");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Plus d’actions pour l’affaire Affaire Alpha",
      })
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Supprimer l’affaire" })
    );
    expect(requestDeleteMock).toHaveBeenCalledWith("project-1", "Affaire Alpha");
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(draftCheckbox);
    expect(onToggleProjectSelection).toHaveBeenCalledWith("project-1");
  });

  it("keeps manager filters disabled when the portfolio classification is incomplete", () => {
    renderTable({
      managerQueueSummary: {
        counts: {
          followUp: 1,
          reservations: 1,
          revalidation: 0,
        },
        incompleteCount: 1,
      },
    });

    expect(
      screen.getByRole("button", { name: /À relancer en priorité \(1\)/i })
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Qualification manager incomplète sur 1 affaire du portefeuille."
      )
    ).toBeInTheDocument();
  });

  it("explains immediately when the portfolio is too large to classify", () => {
    renderTable({
      managerQueueSummary: null,
      managerQueueSummaryState: "unavailable",
    });

    expect(
      screen.getByText(
        "Qualification indisponible pour ce volume, affinez les filtres."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /À relancer en priorité/i })
    ).toBeDisabled();
  });
});
