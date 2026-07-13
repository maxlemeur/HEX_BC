import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lastAffaireState } = vi.hoisted(() => ({
  lastAffaireState: { id: null as string | null },
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/hooks/useLastAffaireContext", () => ({
  useLastAffaireId: () => lastAffaireState.id,
}));

import { DashboardHomeResumeLink } from "./DashboardHomeResumeLink";

beforeEach(() => {
  lastAffaireState.id = null;
});

describe("DashboardHomeResumeLink", () => {
  it("shows a neutral state when no local affaire exists", () => {
    render(<DashboardHomeResumeLink />);

    expect(screen.getByText("Aucune affaire récente à reprendre")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("links to the last locally visited affaire", () => {
    lastAffaireState.id = "project-123";
    render(<DashboardHomeResumeLink />);

    expect(
      screen.getByRole("link", { name: "Reprendre la dernière affaire" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-123");
  });
});
