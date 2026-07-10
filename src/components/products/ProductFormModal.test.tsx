import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductFormModal,
  type ProductRecord,
} from "@/app/dashboard/products/ProductFormModal";

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
    await user.type(screen.getByLabelText("Type d’article"), "Tube");
    await user.type(screen.getByLabelText("Matière"), "Inox");
    await user.type(screen.getByLabelText("Nuance"), "304L");
    await user.type(screen.getByLabelText("Dimensions"), "DN50 · 60,3 × 2");
    await user.type(screen.getByLabelText("Norme"), "EN 10217-7");
    await user.selectOptions(screen.getByLabelText("Unité *"), "ml");
    await user.clear(screen.getByLabelText("Prix de référence HT *"));
    await user.type(screen.getByLabelText("Prix de référence HT *"), "9,90");
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
        tax_rate_bp: 2000,
        is_active: true,
      });
    });
  });

  it("hydrates the edit form and exposes the active status", () => {
    const product: ProductRecord = {
      id: "product-1",
      created_at: "2026-07-10T00:00:00.000Z",
      reference: "C90.I4S.50",
      designation: "Coude inox 304L DN50",
      category: "Raccords",
      product_type: "Coude",
      material: "Inox",
      grade: "304L",
      dimensions: "DN50",
      standard: "EN 10253-4",
      unit: "u",
      unit_price_cents: 290,
      tax_rate_bp: 2000,
      is_active: false,
    };

    render(
      <ProductFormModal
        open
        product={product}
        isSaving={false}
        error={null}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Modifier le produit" })).toBeInTheDocument();
    expect(screen.getByLabelText("Désignation *")).toHaveValue("Coude inox 304L DN50");
    expect(screen.getByLabelText(/Produit actif/)).not.toBeChecked();
  });
});
