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

  it("does not trigger row navigation when the hub action is clicked", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Hub affaire" }));

    expect(pushMock).toHaveBeenCalledTimes(1);
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

    fireEvent.click(screen.getAllByRole("button", { name: "Deplier" })[0]!);

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

  it("routes manager queue changes back to the page query", () => {
    const { onManagerFilterChange } = renderTable();

    fireEvent.click(
      screen.getByRole("button", { name: /A revoir sous reserves \(2\)/i })
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
      screen.getByRole("button", { name: /A relancer en priorite \(1\)/i })
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Qualification manager incomplete sur 1 affaire du portefeuille."
      )
    ).toBeInTheDocument();
  });
});
