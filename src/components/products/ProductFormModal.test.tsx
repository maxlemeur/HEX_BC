import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,describe,expect,it,vi } from "vitest";

import {
ProductFormModal
} from "@/app/dashboard/products/ProductFormModal";

const TECHNICAL_DETAILS_SUMMARY = "Détails techniques (optionnel)";

describe("ProductFormModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("captures the structured product attributes and reference price", async () => {
    const user = userEvent.setup({ delay: null });
    // Typed key by key, this flow passed the 5 s default on loaded CI runners
    // (17/10/2026): paste sends one input event per field instead of one form
    // re-render per key. The price keeps its typed decimal comma.
    const fill = async (label: string, value: string) => {
      await user.click(screen.getByLabelText(label));
      await user.paste(value);
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ProductFormModal
        open
        product={null}
        isSaving={false}
        error={null}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await fill("Référence", "Tub.I4S.50");
    await fill("Désignation *", "Tube inox 304L DN50");
    await fill("Famille", "Tuyauterie");
    await fill("Matière", "Inox");
    await user.selectOptions(screen.getByLabelText("Unité"), "ml");
    await user.type(screen.getByLabelText("Prix de référence HT"), "9,90");

    // Les attributs secondaires vivent derriere le repli "Details techniques".
    await user.click(screen.getByText(TECHNICAL_DETAILS_SUMMARY));
    await fill("Type d’article", "Tube");
    await fill("Nuance", "304L");
    await fill("Dimensions", "DN50 · 60,3 × 2");
    await fill("Norme", "EN 10217-7");

    await user.click(screen.getByRole("button", { name: "Ajouter le produit" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        reference: "Tub.I4S.50",
        designation: "Tube inox 304L DN50",
        category: "Tuyauterie",
        product_type: "Tube",
        material: "Inox",
        grade: "304L",
        dimensions: "DN50 · 60,3 × 2",
        standard: "EN 10217-7",
        unit: "ml",
        unit_price_cents: 990,
        is_active: true,
      });
    });
  });
});
