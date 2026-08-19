import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductFormModal,
  type ProductRecord,
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

  it("suggests the families and materials already used in the directory", () => {
    render(
      <ProductFormModal
        open
        product={null}
        isSaving={false}
        error={null}
        categorySuggestions={["Tuyauterie", "Raccords"]}
        materialSuggestions={["Inox"]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Famille")).toHaveAttribute(
      "list",
      "product-category-options"
    );
    expect(screen.getByLabelText("Matière")).toHaveAttribute(
      "list",
      "product-material-options"
    );
    expect(
      document.querySelector("#product-category-options")?.children
    ).toHaveLength(2);
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
    expect(screen.getByLabelText("Prix de référence HT")).toHaveValue("2,90");
    expect(screen.getByLabelText(/Produit actif/)).not.toBeChecked();
    // Le repli s'ouvre d'emblee quand le produit porte deja des details.
    expect(screen.getByText(TECHNICAL_DETAILS_SUMMARY).closest("details")).toHaveAttribute(
      "open"
    );
    expect(screen.getByLabelText("Nuance")).toHaveValue("304L");
  });

  it("keeps the technical details collapsed when the product has none", () => {
    const product: ProductRecord = {
      id: "product-2",
      created_at: "2026-07-10T00:00:00.000Z",
      reference: "DIV.001",
      designation: "Article divers",
      unit: "u",
      unit_price_cents: 0,
      is_active: true,
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

    expect(
      screen.getByText(TECHNICAL_DETAILS_SUMMARY).closest("details")
    ).not.toHaveAttribute("open");
  });
});
