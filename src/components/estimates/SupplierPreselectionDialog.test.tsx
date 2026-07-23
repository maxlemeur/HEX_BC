import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupplierPreselectionDialog } from "@/components/estimates/SupplierPreselectionDialog";

const REVIEW = {
  summary: {
    total_items: 3,
    proposed_items: 1,
    exception_items: 1,
    already_selected_items: 1,
    divergence_items: 1,
    stale_items: 0,
    ambiguous_items: 0,
    no_price_items: 0,
    currency_mismatch_items: 0,
  },
  proposals: [
    {
      item_id: "line-1",
      item_title: "Tube cuivre",
      current_alternative: null,
      proposed_alternative: {
        kind: "best_price" as const,
        supplier_price_id: "price-1",
        supplier_id: "supplier-1",
        supplier_name: "Best Supplier",
        adjusted_unit_price_cents: 1290,
        supplier_reference: "REF-1",
        catalogue_url: null,
        updated_at: "2026-03-11T09:00:00.000Z",
        is_stale: false,
        product_designation: "Tube cuivre DN20",
        is_selected: false,
      },
      patch: {
        description: "Tube cuivre DN20",
        unit_price_ht_cents: 1290,
        selected_supplier_price_id: "price-1",
      },
      reason: "single_clear_option" as const,
      explanation: "Une seule option fournisseur non obsolete couvre cette ligne.",
      is_reversible: true as const,
    },
  ],
  exceptions: [
    {
      item_id: "line-2",
      item_title: "Câble cuivre",
      reason: "divergence" as const,
      coverage_status: "covered" as const,
      risk_flags: ["selected_not_best_price" as const],
      selected_alternative: null,
      alternatives: [],
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe("SupplierPreselectionDialog", () => {
  it("renders proposals and exceptions and allows selection toggles", () => {
    const onToggleItem = vi.fn();
    const onToggleAll = vi.fn();

    render(
      <SupplierPreselectionDialog
        isOpen
        review={REVIEW}
        selectedItemIds={["line-1"]}
        isLoading={false}
        isApplying={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onToggleItem={onToggleItem}
        onToggleAll={onToggleAll}
      />
    );

    expect(screen.getByText("Présélection fournisseurs")).toBeInTheDocument();
    expect(screen.getByText("Tube cuivre")).toBeInTheDocument();
    expect(screen.getByText("Exceptions à arbitrer")).toBeInTheDocument();
    expect(screen.getByText("Arbitrage requis")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sélectionner toutes les préselections fournisseurs" })
    );
    expect(onToggleAll).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner Tube cuivre" }));
    expect(onToggleItem).toHaveBeenCalledWith("line-1", false);
  });

  it("disables confirm while loading", () => {
    render(
      <SupplierPreselectionDialog
        isOpen
        review={null}
        selectedItemIds={[]}
        isLoading
        isApplying={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onToggleItem={vi.fn()}
        onToggleAll={vi.fn()}
      />
    );

    expect(screen.getByText("Analyse fournisseurs en cours...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Appliquer la sélection" })
    ).toBeDisabled();
  });
});
