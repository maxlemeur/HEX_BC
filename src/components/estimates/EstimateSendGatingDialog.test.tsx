import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";

describe("EstimateSendGatingDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders register-focused guidance and readable monetary details", () => {
    render(
      <EstimateSendGatingDialog
        isOpen
        isSubmitting={false}
        phaseLabel={null}
        canForce
        projectId="project-1"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onForceConfirm={vi.fn()}
        blockingFlags={[
          {
            key: "critical_missing_pieces",
            category: "documents",
            severity: "blocking",
            count: 2,
            itemIds: [],
            label: "Documents critiques manquants",
            description: "Des pieces critiques restent manquantes dans le registre affaire.",
            details: {
              total_ht_cents: 125000,
              budget_ceiling_ht_cents: 100000,
              register_entries: [
                {
                  kind: "missing_piece",
                  scopeLabel: "Lot CFO",
                  text: "Verifier la variante",
                  href: "/dashboard/affaires/project-1?registerStatus=open&registerSeverity=critical&registerKind=missing_piece&registerFocus=9c5d3dc3-5ef4-4d61-88e6-0911c8d6ed6f",
                },
              ],
            },
          },
        ]}
        warningFlags={[
          {
            key: "open_questions_pending",
            category: "register",
            severity: "warning",
            count: 1,
            itemIds: [],
            label: "Questions ouvertes a traiter",
            description: "Des points du registre restent ouverts.",
            details: {},
          },
        ]}
      />
    );

    expect(screen.getByText("2 points a traiter")).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.startsWith("Total HT courant: 1"))
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.startsWith("Plafond budget HT: 1"))
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Recuperez ou requalifiez ces pieces critiques avant de reprendre l'envoi."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Registre").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Ces signaux n'interdisent pas toujours l'envoi, mais ils doivent etre assumes explicitement."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Documents: Lot CFO: Verifier la variante" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1?registerStatus=open&registerSeverity=critical&registerKind=missing_piece&registerFocus=9c5d3dc3-5ef4-4d61-88e6-0911c8d6ed6f"
    );
    const registerLinks = screen.getAllByRole("link", {
      name: "Ouvrir le registre affaire",
    });
    expect(registerLinks).toHaveLength(1);
    expect(registerLinks[0]).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1?registerStatus=open&registerKind=assumption"
    );
  });

  it("keeps clarify-with-client register links focusable for non-critical entries", () => {
    render(
      <EstimateSendGatingDialog
        isOpen
        isSubmitting={false}
        phaseLabel={null}
        canForce
        projectId="project-1"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onForceConfirm={vi.fn()}
        blockingFlags={[
          {
            key: "client_clarification_required",
            category: "register",
            severity: "blocking",
            count: 1,
            itemIds: [],
            label: "Clarification client requise",
            description: "Une clarification client reste ouverte.",
            details: {
              register_entries: [
                {
                  kind: "assumption",
                  scopeLabel: "Lot CFO",
                  text: "Valider la variante",
                  href: "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption&registerFocus=5bc9244d-cf64-4d86-bf86-f5d9d2f203d6",
                },
              ],
            },
          },
        ]}
        warningFlags={[]}
      />
    );

    expect(
      screen.queryByRole("link", { name: "Ouvrir le registre affaire" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Registre: Lot CFO: Valider la variante" })
    ).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1?registerStatus=clarify_with_client&registerKind=assumption&registerFocus=5bc9244d-cf64-4d86-bf86-f5d9d2f203d6"
    );
  });
});
