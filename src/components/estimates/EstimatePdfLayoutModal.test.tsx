import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach,describe,expect,it,vi } from "vitest";

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
});
