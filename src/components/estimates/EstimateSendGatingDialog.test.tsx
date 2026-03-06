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
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onForceConfirm={vi.fn()}
        blockingFlags={[
          {
            key: "critical_open_questions",
            severity: "blocking",
            count: 2,
            itemIds: [],
            label: "Questions critiques ouvertes",
            description: "Le registre affaire contient des questions critiques ouvertes.",
            details: {
              total_ht_cents: 125000,
              budget_ceiling_ht_cents: 100000,
              register_entries: [
                {
                  scopeLabel: "Lot CFO",
                  text: "Verifier la variante",
                },
              ],
            },
          },
        ]}
        warningFlags={[
          {
            key: "open_questions_pending",
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
        "Traitez ces points critiques dans le registre affaire avant de reprendre l'envoi."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ces signaux n'interdisent pas toujours l'envoi, mais ils doivent etre assumes explicitement."
      )
    ).toBeInTheDocument();
  });
});
