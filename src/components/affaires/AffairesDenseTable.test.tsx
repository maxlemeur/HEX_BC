import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AffaireListItem, AffaireManagerQueueSummary } from "./types";
import { AffairesDenseTable } from "./AffairesDenseTable";

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

vi.mock("@/components/ui/ConfirmModal", () => ({
  ConfirmModal: () => null,
}));

vi.mock("./AffaireStatusBadges", () => ({
  AffaireStatusBadges: () => <div data-testid="affaire-status-badges">Statut</div>,
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

  it("navigates to the affaire hub when the row body is clicked", () => {
    renderTable();

    fireEvent.click(screen.getByText("Affaire Alpha"));

    expect(pushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1");
  });

  it("supports keyboard navigation on the affaire row", () => {
    renderTable();

    fireEvent.keyDown(
      screen.getByRole("row", { name: "Ouvrir l’affaire Affaire Alpha" }),
      { key: "Enter" }
    );

    expect(pushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1");
  });

  it("uses a semantic hub link without triggering row navigation", () => {
    renderTable();

    const hubLink = screen.getByRole("link", {
      name: "Ouvrir le hub de l’affaire Affaire Alpha",
    });
    expect(hubLink).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1"
    );

    fireEvent.click(hubLink);

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps secondary version and DPGF information in the expanded summary", async () => {
    renderTable();

    expect(
      screen.queryByRole("columnheader", { name: "Versions" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "DPGF" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Version acceptée" })
    ).toHaveAttribute(
      "title",
      "Dernière version acceptée par le client, conservée comme référence commerciale."
    );
    expect(
      screen.getByRole("columnheader", { name: "Approbation" })
    ).toHaveAttribute(
      "title",
      "État de l’approbation interne requise avant l’envoi au client."
    );

    fireEvent.click(screen.getByRole("button", { name: "Déplier les détails de l’affaire Affaire Alpha" }));

    expect(await screen.findByText("Nombre de versions :")).toBeInTheDocument();
    expect(screen.getByText("Aucune DPGF importée")).toBeInTheDocument();
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

  it("allows manual selection only for draft affaires", () => {
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
      selectedProjectIds: ["project-1"],
      onToggleProjectSelection,
    });

    const draftCheckbox = screen.getByRole("checkbox", {
      name: "Sélectionner l'affaire Affaire Alpha",
    });
    expect(draftCheckbox).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Éditer l’affaire Affaire Alpha" })
    ).toHaveAttribute("href", "/dashboard/estimates/version-1/edit");
    expect(
      screen.getByRole("button", { name: "Supprimer l’affaire Affaire Alpha" })
    ).toBeInTheDocument();

    fireEvent.click(draftCheckbox);
    expect(onToggleProjectSelection).toHaveBeenCalledWith("project-1");
  });

  it("routes manager queue changes back to the page query", () => {
    const { onManagerFilterChange } = renderTable();

    fireEvent.click(
      screen.getByRole("button", { name: /À revoir sous réserves \(2\)/i })
    );

    expect(onManagerFilterChange).toHaveBeenCalledWith("reservations");
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
