import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: ReactNode;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

import { EmptyState } from "@/components/ui/EmptyState";

describe("ui/EmptyState", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders icon, title, and description", () => {
    render(
      createElement(EmptyState, {
        icon: createElement("svg", { "data-icon": "folder" }),
        title: "Creez votre premiere affaire",
        description: "Lancez votre premier chiffrage.",
      })
    );

    const title = screen.getByRole("heading", {
      level: 3,
      name: "Creez votre premiere affaire",
    });

    expect(screen.getByText("Lancez votre premier chiffrage.")).toBeInTheDocument();
    expect(title.closest("div")).toHaveClass("animate-fade-in");
  });

  it("renders button action when onAction is provided", () => {
    const onAction = vi.fn();
    render(
      createElement(EmptyState, {
        icon: createElement("svg"),
        title: "Aucune version encore",
        description: "Commencez le chiffrage.",
        actionLabel: "Demarrer",
        onAction,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Demarrer" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders link action when actionHref is provided", () => {
    render(
      createElement(EmptyState, {
        icon: createElement("svg"),
        title: "Aucune commande",
        description: "Les commandes sont generees depuis un chiffrage accepte.",
        actionLabel: "Voir mes affaires",
        actionHref: "/dashboard/affaires",
      })
    );

    expect(screen.getByRole("link", { name: "Voir mes affaires" })).toHaveAttribute(
      "href",
      "/dashboard/affaires"
    );
  });

  it("supports a configurable semantic heading level", () => {
    render(
      createElement(EmptyState, {
        icon: createElement("svg"),
        title: "Page introuvable",
        description: "Cette page n'existe pas.",
        headingLevel: 1,
      })
    );

    expect(screen.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeInTheDocument();
  });
});
