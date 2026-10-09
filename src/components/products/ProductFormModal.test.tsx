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
    const user = userEvent.setup();
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

    await user.type(screen.getByLabelText("Référence"), "Tub.I4S.50");
    await user.type(screen.getByLabelText("Désignation *"), "Tube inox 304L DN50");
    await user.type(screen.getByLabelText("Famille"), "Tuyauterie");
    await user.type(screen.getByLabelText("Matière"), "Inox");
    await user.selectOptions(screen.getByLabelText("Unité"), "ml");
    await user.type(screen.getByLabelText("Prix de référence HT"), "9,90");

    // Les attributs secondaires vivent derriere le repli "Details techniques".
    await user.click(screen.getByText(TECHNICAL_DETAILS_SUMMARY));
    await user.type(screen.getByLabelText("Type d’article"), "Tube");
    await user.type(screen.getByLabelText("Nuance"), "304L");
    await user.type(screen.getByLabelText("Dimensions"), "DN50 · 60,3 × 2");
    await user.type(screen.getByLabelText("Norme"), "EN 10217-7");

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

  it("creates a product from the designation alone", async () => {
    const user = userEvent.setup();
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

    expect(screen.getByLabelText("Prix de référence HT")).toHaveValue("");

    await user.type(screen.getByLabelText("Désignation *"), "Tube inox 304L DN50");
    await user.click(screen.getByRole("button", { name: "Ajouter le produit" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        reference: null,
        designation: "Tube inox 304L DN50",
        category: null,
        product_type: null,
        material: null,
        grade: null,
        dimensions: null,
        standard: null,
        unit: "u",
        unit_price_cents: 0,
        is_active: true,
      });
    });
  });
});
