import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EstimatePdfLayoutModal } from "./EstimatePdfLayoutModal";

const { fetchConfigurationMock } = vi.hoisted(() => ({
  fetchConfigurationMock: vi.fn(),
}));

vi.mock("@/lib/estimates/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/estimates/client")>(
    "@/lib/estimates/client"
  );

  return {
    ...actual,
    fetchEstimatePdfLayoutConfiguration: fetchConfigurationMock,
  };
});

describe("EstimatePdfLayoutModal", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    fetchConfigurationMock.mockReset();
    fetchConfigurationMock.mockResolvedValue({
      lineCount: 26,
      sectionCountsByLevel: { 1: 2, 2: 4, 3: 3, 4: 1 },
      hasConditions: true,
      terms: {
        available: true,
        policy: "required",
        title: "Conditions generales de vente",
        version: 3,
      },
    });
  });

  it("applique les choix de presentation et la politique CGV du locataire", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <EstimatePdfLayoutModal
        open
        onOpenChange={vi.fn()}
        versionId="version-1"
        onConfirm={onConfirm}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Préparer le devis PDF" })
    ).toBeInTheDocument();

    const termsCheckbox = await screen.findByRole("checkbox", {
      name: /Joindre les CGV/i,
    });
    await waitFor(() => {
      expect(termsCheckbox).toBeChecked();
      expect(termsCheckbox).toBeDisabled();
    });

    await user.click(
      screen.getByText("Personnaliser le contenu et la présentation")
    );
    await user.selectOptions(screen.getByLabelText("Contenu visible"), "3");
    await user.selectOptions(
      screen.getByLabelText("Colonnes de prix"),
      "fo_mo_and_total"
    );
    await user.selectOptions(screen.getByLabelText("Confort de lecture"), "compact");
    await user.click(
      screen.getByRole("checkbox", { name: /Précisions sur une page séparée/i })
    );
    await user.click(screen.getByRole("button", { name: /Générer le PDF/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          detailLevel: 3,
          priceMode: "fo_mo_and_total",
          density: "compact",
          conditionsPlacement: "new_page",
          includeTerms: true,
        })
      );
    });
  });

  it("conserve les pages complémentaires lors d'un changement de préréglage", async () => {
    fetchConfigurationMock.mockResolvedValue({
      lineCount: 26,
      sectionCountsByLevel: { 1: 2, 2: 4, 3: 3, 4: 1 },
      hasConditions: true,
      terms: {
        available: true,
        policy: "optional",
        title: "Conditions générales de vente",
        version: 3,
      },
    });
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <EstimatePdfLayoutModal
        open
        onOpenChange={vi.fn()}
        versionId="version-1"
        onConfirm={onConfirm}
      />
    );

    const termsCheckbox = await screen.findByRole("checkbox", {
      name: /Joindre les CGV/i,
    });
    await waitFor(() => expect(termsCheckbox).toBeEnabled());
    await user.click(termsCheckbox);
    await user.click(
      screen.getByRole("checkbox", { name: /Précisions sur une page séparée/i })
    );
    await user.click(
      screen.getByRole("button", { name: /Devis synthétique/i })
    );
    await user.click(screen.getByRole("button", { name: /Générer le PDF/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: "decision_summary",
          detailLevel: 2,
          priceMode: "total_only",
          conditionsPlacement: "new_page",
          includeTerms: true,
        })
      );
    });
  });

  it("indique un réglage personnalisé sans laisser un préréglage sélectionné", async () => {
    const user = userEvent.setup();

    render(
      <EstimatePdfLayoutModal
        open
        onOpenChange={vi.fn()}
        versionId="version-1"
        onConfirm={vi.fn()}
      />
    );

    const detailedPreset = screen.getByRole("button", {
      name: /Devis détaillé/i,
    });
    expect(detailedPreset).toHaveAttribute("aria-pressed", "true");

    await user.click(
      screen.getByText("Personnaliser le contenu et la présentation")
    );
    await user.selectOptions(screen.getByLabelText("Confort de lecture"), "compact");

    expect(detailedPreset).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Personnalisé")).toBeInTheDocument();
  });

  it("se ferme avec Echap", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <EstimatePdfLayoutModal
        open
        onOpenChange={onOpenChange}
        versionId="version-1"
        onConfirm={vi.fn()}
      />
    );

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
