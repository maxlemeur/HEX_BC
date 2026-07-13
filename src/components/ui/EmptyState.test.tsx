import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

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

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/EmptyState", () => {
  it("renders icon, title, and description", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(EmptyState, {
          icon: createElement("svg", { "data-icon": "folder" }),
          title: "Creez votre premiere affaire",
          description: "Lancez votre premier chiffrage.",
        })
      );
    });

    const title = renderer!.root.findByType("h3");
    const description = renderer!.root.findByType("p");
    const root = renderer!.root.findByType("div");

    expect(title.children.join("")).toBe("Creez votre premiere affaire");
    expect(description.children.join("")).toBe("Lancez votre premier chiffrage.");
    expect(root.props.className).toContain("animate-fade-in");
  });

  it("renders button action when onAction is provided", async () => {
    const onAction = vi.fn();
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(EmptyState, {
          icon: createElement("svg"),
          title: "Aucune version encore",
          description: "Commencez le chiffrage.",
          actionLabel: "Demarrer",
          onAction,
        })
      );
    });

    const button = renderer!.root.findByType("button");
    expect(button.children.join("")).toBe("Demarrer");

    await act(async () => {
      button.props.onClick();
    });

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders link action when actionHref is provided", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(EmptyState, {
          icon: createElement("svg"),
          title: "Aucune commande",
          description: "Les commandes sont generees depuis un chiffrage accepte.",
          actionLabel: "Voir mes affaires",
          actionHref: "/dashboard/affaires",
        })
      );
    });

    const link = renderer!.root.findByType("a");
    expect(link.props.href).toBe("/dashboard/affaires");
    expect(link.children.join("")).toBe("Voir mes affaires");
  });

  it("supports a configurable semantic heading level", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(EmptyState, {
          icon: createElement("svg"),
          title: "Page introuvable",
          description: "Cette page n'existe pas.",
          headingLevel: 1,
        })
      );
    });

    expect(renderer!.root.findByType("h1").children.join("")).toBe(
      "Page introuvable"
    );
  });
});
