import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("motion/react", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
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

const baseItem: AffaireListItem = {
  projectId: "project-1",
  projectName: "Affaire Alpha",
  projectReference: "REF-001",
  projectClient: "Client Demo",
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
  it("keeps the card body as a primary link to the current estimate", () => {
    render(
      <AffairesCardList
        items={[baseItem]}
        emptyVariant="filtered"
      />
    );

    expect(
      screen.getByRole("link", { name: /affaire alpha/i })
    ).toHaveAttribute("href", "/dashboard/estimates/version-1");
  });

  it("routes draft cards to the estimate editor", () => {
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
      />
    );

    expect(
      screen.getByRole("link", { name: /affaire brouillon/i })
    ).toHaveAttribute("href", "/dashboard/estimates/version-draft/edit");
  });
});
