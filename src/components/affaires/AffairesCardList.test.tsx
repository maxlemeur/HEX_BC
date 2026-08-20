import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffaireListItem } from "./types";
import { AffairesCardList } from "./AffairesCardList";

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
  useRouter: () => ({
    push: vi.fn(),
  }),
}));


vi.mock("@/components/ui-legacy/ConfirmModal", () => ({
  ConfirmModal: () => null,
}));

vi.mock("./AffaireStatusBadges", () => ({
  AffaireStatusBadges: () => <div data-testid="affaire-status-badges">Statut</div>,
}));

vi.mock("./useDeleteAffaire", () => ({
  useDeleteAffaire: () => ({
    requestDelete: vi.fn(),
    modalProps: {
      open: false,
      title: "",
      message: "",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    },
  }),
}));

afterEach(() => {
  cleanup();
});

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

describe("AffairesCardList", () => {
  it("keeps the card body as a primary link to the affaire hub", () => {
    render(
      <AffairesCardList
        items={[baseItem]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    expect(
      screen.getByRole("link", { name: /affaire alpha/i })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1");
    expect(
      screen.getByRole("link", { name: /affaire alpha/i }).closest(
        ".dashboard-card"
      )
    ).toHaveClass("animate-fade-in");
  });

  it("keeps draft cards pointed at the affaire hub", () => {
    render(
      <AffairesCardList
        items={[
          {
            ...baseItem,
            projectId: "project-2",
            projectName: "Affaire Brouillon",
            currentVersionId: "version-draft",
            currentStatus: "draft",
          },
        ]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    expect(
      screen.getByRole("link", { name: /affaire brouillon/i })
    ).toHaveAttribute("href", "/dashboard/affaires/project-2");
  });

  it("renders a favorite toggle with the proper label", () => {
    render(
      <AffairesCardList
        items={[{ ...baseItem, isFavorite: true }]}
        emptyVariant="filtered"
        onToggleFavorite={vi.fn()}
        favoritePendingIds={[]}
      />
    );

    expect(
      screen.getByRole("button", { name: /retirer des favoris/i })
    ).toBeInTheDocument();
  });

  it("forwards favorite toggles without affecting the primary link", () => {
    const onToggleFavorite = vi.fn();

    render(
      <AffairesCardList
        items={[baseItem]}
        emptyVariant="filtered"
        onToggleFavorite={onToggleFavorite}
        favoritePendingIds={[]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /ajouter aux favoris/i })[0]!);

    expect(onToggleFavorite).toHaveBeenCalledWith("project-1", true);
    expect(
      screen.getByRole("link", { name: /affaire alpha/i })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1");
  });
});
