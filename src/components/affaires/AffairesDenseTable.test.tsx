import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AffaireListItem } from "./types";
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
    render(
      <AffairesDenseTable
        items={[baseItem]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    fireEvent.click(screen.getByText("Affaire Alpha"));

    expect(pushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1");
  });

  it("does not trigger row navigation when the hub action is clicked", () => {
    render(
      <AffairesDenseTable
        items={[baseItem]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Hub affaire" }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1");
  });

  it("does not trigger row navigation when the expand toggle is clicked", () => {
    render(
      <AffairesDenseTable
        items={[baseItem]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Deplier" }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchExpandDataMock).toHaveBeenCalledWith("project-1");
  });

  it("does not trigger row navigation when the favorite toggle is clicked", () => {
    const onToggleFavorite = vi.fn();

    render(
      <AffairesDenseTable
        items={[baseItem]}
        emptyVariant="filtered"
        onToggleFavorite={onToggleFavorite}
        favoritePendingIds={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /ajouter aux favoris/i }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(onToggleFavorite).toHaveBeenCalledWith("project-1", true);
  });

  it("filters the visible portfolio to not-ready or critical-missing dossiers for manager follow-up", async () => {
    fetchExpandDataMock.mockImplementation(async (projectId: string) => ({
      summary: {
        currentVersion: null,
        acceptedVersion: null,
        lineCount: 0,
        hubReadiness:
          projectId === "project-1"
            ? {
                status: "not_ready",
                workingBasis: "insufficient",
                allowsContinuation: false,
                briefStatus: "a_confirmer",
                drivers: [
                  {
                    code: "critical_missing_piece",
                    source: "register",
                    severity: "critical",
                    count: 1,
                  },
                ],
                intake: {
                  reviewDocumentsCount: 0,
                  confirmedMissingPiecesCount: 1,
                  confirmedCriticalMissingPiecesCount: 1,
                },
                register: {
                  criticalOpenCount: 1,
                  clarifyWithClientCount: 0,
                  continuedWithHypothesisCount: 0,
                  revalidationRequiredCount: 0,
                  criticalRevalidationRequiredCount: 0,
                },
              }
            : {
                status: "ready",
                workingBasis: "established",
                allowsContinuation: true,
                briefStatus: "confirme",
                drivers: [],
                intake: {
                  reviewDocumentsCount: 0,
                  confirmedMissingPiecesCount: 0,
                  confirmedCriticalMissingPiecesCount: 0,
                },
                register: {
                  criticalOpenCount: 0,
                  clarifyWithClientCount: 0,
                  continuedWithHypothesisCount: 0,
                  revalidationRequiredCount: 0,
                  criticalRevalidationRequiredCount: 0,
                },
              },
      },
      dpgfSource: null,
    }));

    render(
      <AffairesDenseTable
        items={[
          baseItem,
          {
            ...baseItem,
            projectId: "project-2",
            projectName: "Affaire Beta",
          },
        ]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /A relancer en priorite \(1\)/i })
      ).toBeEnabled();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /A relancer en priorite \(1\)/i })
    );

    expect(screen.getByText("Affaire Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Affaire Beta")).not.toBeInTheDocument();
    expect(screen.getByText("1 affaire a relancer en priorite sur cette page.")).toBeInTheDocument();
  });

  it("filters the visible portfolio to dossiers ready with reservations for targeted review", async () => {
    fetchExpandDataMock.mockImplementation(async (projectId: string) => ({
      summary: {
        currentVersion: null,
        acceptedVersion: null,
        lineCount: 0,
        hubReadiness:
          projectId === "project-1"
            ? {
                status: "ready_with_reservations",
                workingBasis: "established",
                allowsContinuation: true,
                briefStatus: "confirme",
                drivers: [
                  {
                    code: "continued_with_hypothesis",
                    source: "register",
                    severity: "warning",
                    count: 1,
                  },
                ],
                intake: {
                  reviewDocumentsCount: 0,
                  confirmedMissingPiecesCount: 0,
                  confirmedCriticalMissingPiecesCount: 0,
                },
                register: {
                  criticalOpenCount: 0,
                  clarifyWithClientCount: 0,
                  continuedWithHypothesisCount: 1,
                  revalidationRequiredCount: 0,
                  criticalRevalidationRequiredCount: 0,
                },
              }
            : {
                status: "ready",
                workingBasis: "established",
                allowsContinuation: true,
                briefStatus: "confirme",
                drivers: [],
                intake: {
                  reviewDocumentsCount: 0,
                  confirmedMissingPiecesCount: 0,
                  confirmedCriticalMissingPiecesCount: 0,
                },
                register: {
                  criticalOpenCount: 0,
                  clarifyWithClientCount: 0,
                  continuedWithHypothesisCount: 0,
                  revalidationRequiredCount: 0,
                  criticalRevalidationRequiredCount: 0,
                },
              },
      },
      dpgfSource: null,
    }));

    render(
      <AffairesDenseTable
        items={[
          baseItem,
          {
            ...baseItem,
            projectId: "project-2",
            projectName: "Affaire Beta",
          },
        ]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /A revoir sous reserves \(1\)/i })
      ).toBeEnabled();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /A revoir sous reserves \(1\)/i })
    );

    expect(screen.getByText("Affaire Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Affaire Beta")).not.toBeInTheDocument();
    expect(screen.getByText("1 affaire a revoir sous reserves sur cette page.")).toBeInTheDocument();
  });
});
