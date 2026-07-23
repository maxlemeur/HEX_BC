import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SupplierComparisonPanel,
  type SupplierComparisonAlternative,
} from "@/components/estimates/SupplierComparisonPanel";

const alternatives: SupplierComparisonAlternative[] = [
  {
    kind: "best_price",
    supplier_price_id: "price-best",
    supplier_id: "supplier-best",
    supplier_name: "Best Supplier",
    adjusted_unit_price_cents: 900,
    currency: "EUR",
    supplier_reference: "BEST-1",
    updated_at: "2026-02-20T00:00:00.000Z",
    is_stale: false,
    catalogue_url: "https://example.com/best",
    product_designation: "Faux plafond acoustique",
    is_selected: false,
  },
  {
    kind: "most_recent",
    supplier_price_id: "price-recent",
    supplier_id: "supplier-recent",
    supplier_name: "Recent Supplier",
    adjusted_unit_price_cents: 1200,
    currency: "EUR",
    supplier_reference: "RECENT-1",
    updated_at: "2026-03-05T00:00:00.000Z",
    is_stale: false,
    catalogue_url: "https://example.com/recent",
    product_designation: "Faux plafond acoustique",
    is_selected: false,
  },
  {
    kind: "preferred_supplier",
    supplier_price_id: "price-preferred",
    supplier_id: "supplier-preferred",
    supplier_name: "Preferred Supplier",
    adjusted_unit_price_cents: 1000,
    currency: "EUR",
    supplier_reference: "PREF-1",
    updated_at: "2026-02-10T00:00:00.000Z",
    is_stale: false,
    catalogue_url: "https://example.com/preferred",
    product_designation: "Faux plafond acoustique",
    is_selected: false,
  },
  {
    kind: "selected_current",
    supplier_price_id: "price-old",
    supplier_id: "supplier-old",
    supplier_name: "Old Supplier",
    adjusted_unit_price_cents: 1100,
    currency: "EUR",
    supplier_reference: "OLD-1",
    updated_at: "2025-10-01T00:00:00.000Z",
    is_stale: true,
    catalogue_url: "https://example.com/old",
    product_designation: "Faux plafond acoustique",
    is_selected: true,
  },
];

describe("SupplierComparisonPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders every returned alternative and keeps the current selection visible", () => {
    render(
      <SupplierComparisonPanel
        isOpen
        itemTitle="Faux plafond acoustique"
        alternatives={alternatives}
        bestSupplierPriceId="price-best"
        isLoading={false}
        error={null}
        isReadOnly={false}
        onClose={vi.fn()}
        onSelectAlternative={vi.fn()}
      />
    );

    expect(screen.getByText("Best Supplier")).toBeInTheDocument();
    expect(screen.getByText("Recent Supplier")).toBeInTheDocument();
    expect(screen.getByText("Preferred Supplier")).toBeInTheDocument();
    expect(screen.getByText("Old Supplier")).toBeInTheDocument();
    expect(screen.getByText("Meilleur prix")).toBeInTheDocument();
    expect(screen.getByText("Prix le plus recent")).toBeInTheDocument();
    expect(screen.getByText("Fournisseur prefere")).toBeInTheDocument();
    expect(screen.getByText("Selection actuelle")).toBeInTheDocument();
    expect(screen.getByText("Prix ancien")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deja selectionne" })
    ).toBeDisabled();
  });

  it("keeps selection actionable for non-selected alternatives", () => {
    const onSelectAlternative = vi.fn();

    render(
      <SupplierComparisonPanel
        isOpen
        itemTitle="Faux plafond acoustique"
        alternatives={alternatives}
        bestSupplierPriceId="price-best"
        isLoading={false}
        error={null}
        isReadOnly={false}
        onClose={vi.fn()}
        onSelectAlternative={onSelectAlternative}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Selectionner" })[1]!);

    expect(onSelectAlternative).toHaveBeenCalledWith(
      expect.objectContaining({
        supplier_price_id: "price-recent",
        kind: "most_recent",
      })
    );
  });

  it("affiche un prix fournisseur dans sa devise, jamais en euros", () => {
    const { container } = render(
      <SupplierComparisonPanel
        isOpen
        itemTitle="Faux plafond acoustique"
        alternatives={[
          {
            ...alternatives[0]!,
            currency: "USD",
            adjusted_unit_price_cents: 100000,
          },
        ]}
        bestSupplierPriceId="price-best"
        isLoading={false}
        error={null}
        isReadOnly={false}
        onClose={vi.fn()}
        onSelectAlternative={vi.fn()}
      />
    );

    const priceText =
      container.querySelector(".estimate-supplier-comparison-option__price")
        ?.textContent ?? "";
    expect(priceText).not.toContain("€");
    expect(priceText).toMatch(/\$|USD/);
  });

  it("se ferme à la touche Échap", () => {
    const onClose = vi.fn();
    render(
      <SupplierComparisonPanel
        isOpen
        itemTitle="Faux plafond acoustique"
        alternatives={alternatives}
        bestSupplierPriceId="price-best"
        isLoading={false}
        error={null}
        isReadOnly={false}
        onClose={onClose}
        onSelectAlternative={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
