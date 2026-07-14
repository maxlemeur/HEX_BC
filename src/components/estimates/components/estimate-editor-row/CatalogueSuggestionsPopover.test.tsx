import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CatalogueSuggestionsPopover } from "@/components/estimates/components/estimate-editor-row/CatalogueSuggestionsPopover";
import type {
  CataloguePriceSuggestion,
  SupplierAlternative,
} from "@/components/estimates/components/estimate-editor-row/shared";

const alternative: SupplierAlternative = {
  kind: "best_price",
  supplier_price_id: "price-2",
  supplier_id: "supplier-2",
  supplier_name: "Téréva",
  unit_price_cents: 215,
  adjusted_unit_price_cents: 215,
  currency: "EUR",
  supplier_reference: "TER-INOX-15",
  unit: "ml",
  updated_at: "2026-07-12T08:00:00.000Z",
  is_stale: false,
  catalogue_url: null,
};

const suggestion: CataloguePriceSuggestion = {
  supplier_price_id: "price-1",
  product_id: "product-1",
  product_designation: "Tube inox 304L à sertir — DN15",
  product_reference: "TUB-I4S-15",
  product_category: "Tuyauterie",
  product_type: "Tube",
  product_material: "Inox",
  product_grade: "304L",
  product_dimensions: "18,0 × 1,0",
  product_standard: "NF EN 10312",
  supplier_id: "supplier-1",
  supplier_name: "ARCUS",
  supplier_reference: "TSP04L 18X1",
  unit: "ml",
  unit_price_cents: 224,
  adjusted_unit_price_cents: 224,
  currency: "EUR",
  updated_at: "2026-07-14T08:00:00.000Z",
  is_stale: false,
  stale_days: 90,
  relevance_score: 80,
  has_material_index_adjustment: false,
  material_index_code: null,
  material_index_value: null,
  catalogue_url: null,
  supplier_offer_count: 2,
  alternatives: [alternative],
};

function renderPopover(
  onApplySuggestion = vi.fn<
    (
      selected: CataloguePriceSuggestion,
      selectedAlternative?: SupplierAlternative,
    ) => void
  >(),
) {
  render(
    <CatalogueSuggestionsPopover
      itemId="item-1"
      query="tube inox"
      estimateCurrency="EUR"
      catalogueListboxId="catalogue-listbox"
      isCatalogueLoading={false}
      catalogueError={null}
      catalogueSuggestions={[suggestion]}
      activeCatalogueSuggestionIndex={0}
      isReadOnly={false}
      onApplySuggestion={onApplySuggestion}
    />,
  );

  return onApplySuggestion;
}

describe("CatalogueSuggestionsPopover", () => {
  afterEach(cleanup);
  it("affiche d'abord l'article, puis ses caractéristiques et son offre fournisseur", () => {
    renderPopover();

    expect(
      screen.getByText("1 résultat pour « tube inox »"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tube inox 304L à sertir — DN15"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tube · Inox 304L · 18,0 × 1,0 · NF EN 10312"),
    ).toBeInTheDocument();
    expect(screen.getByText("TUB-I4S-15")).toBeInTheDocument();
    expect(screen.getByText("Tuyauterie")).toBeInTheDocument();
    expect(screen.getByText(/2,24/)).toHaveTextContent("/ml");
    expect(screen.getByText("ARCUS").parentElement).toHaveTextContent(
      "ARCUS · réf. TSP04L 18X1 · prix du 14/07/2026",
    );
    expect(screen.getByText("Prix à jour")).toBeInTheDocument();
    expect(screen.getByText("2 offres")).toBeInTheDocument();
  });

  it("insère l'offre principale ou une offre alternative", () => {
    const onApplySuggestion = renderPopover();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Tube inox 304L à sertir — DN15/,
      }),
    );
    expect(onApplySuggestion).toHaveBeenLastCalledWith(suggestion);

    fireEvent.click(screen.getByText(/Meilleur prix:/));
    expect(onApplySuggestion).toHaveBeenLastCalledWith(suggestion, alternative);
  });
});
