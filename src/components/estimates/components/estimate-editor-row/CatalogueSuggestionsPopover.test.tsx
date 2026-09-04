import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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
  price_source: "supplier",
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

const referenceSuggestion: CataloguePriceSuggestion = {
  ...suggestion,
  price_source: "reference",
  supplier_price_id: null,
  product_id: "product-reference",
  product_designation: "Rouge",
  product_reference: null,
  supplier_id: null,
  supplier_name: null,
  supplier_reference: null,
  unit: "u",
  unit_price_cents: 2000,
  adjusted_unit_price_cents: 2000,
  currency: null,
  updated_at: "2026-08-20T19:34:27.442333Z",
  supplier_offer_count: 0,
  alternatives: [],
};

const redundantSuggestion: CataloguePriceSuggestion = {
  ...suggestion,
  product_id: "product-redundant",
  product_designation: "Vanne RBS rouge rallonge MF 25b DN15 21,3x1,6",
  product_reference: "Var.ral.15",
  product_category: "Robinetterie",
  product_type: "Vanne RBS rouge rallonge MF 25b",
  product_material: "Autre",
  product_grade: null,
  product_dimensions: "DN15 — 21,3x1,6",
  product_standard: "ACS",
  supplier_name: "SOFINTHER",
  supplier_reference: "41483",
  unit: "u",
  unit_price_cents: 464,
  adjusted_unit_price_cents: 464,
  supplier_offer_count: 1,
  alternatives: [],
};

function renderPopover(
  onApplySuggestion = vi.fn<
    (
      selected: CataloguePriceSuggestion,
      selectedAlternative?: SupplierAlternative,
    ) => void
  >(),
  catalogueSuggestions: CataloguePriceSuggestion[] = [suggestion],
  query = "tube inox",
) {
  function PopoverFixture() {
    const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

    return (
      <div data-testid="clipped-container" style={{ overflow: "hidden" }}>
        <div ref={setAnchor}>
          {anchor ? (
            <CatalogueSuggestionsPopover
              anchor={anchor}
              itemId="item-1"
              query={query}
              estimateCurrency="EUR"
              catalogueListboxId="catalogue-listbox"
              isCatalogueLoading={false}
              catalogueError={null}
              catalogueSuggestions={catalogueSuggestions}
              activeCatalogueSuggestionIndex={0}
              isReadOnly={false}
              onApplySuggestion={onApplySuggestion}
            />
          ) : null}
        </div>
      </div>
    );
  }

  const rendered = render(
    <PopoverFixture />,
  );

  return { ...rendered, onApplySuggestion };
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
    const dimensionsTag = screen.getByText("18,0 × 1,0");
    const standardTag = screen.getByText("NF EN 10312");
    expect(dimensionsTag.parentElement).toBe(standardTag.parentElement);
    expect(
      screen.queryByText("Tube · Inox 304L · 18,0 × 1,0 · NF EN 10312"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("TUB-I4S-15")).toBeInTheDocument();
    expect(screen.getByText("Tuyauterie")).toBeInTheDocument();
    expect(screen.getByText(/2,24/)).toHaveTextContent("/ml");
    expect(screen.getByText("ARCUS").parentElement).toHaveTextContent(
      "ARCUS · réf. TSP04L 18X1 · prix du 14/07/2026",
    );
    expect(screen.getByText("Prix à jour")).toBeInTheDocument();
    expect(screen.getByText("2 offres")).toBeInTheDocument();
  });

  it("retire les caractéristiques déjà lisibles dans la désignation", () => {
    renderPopover(undefined, [redundantSuggestion], "rouge");

    expect(
      screen.getByText("Vanne RBS rouge rallonge MF 25b DN15 21,3x1,6"),
    ).toBeInTheDocument();
    const metadataRow = screen.getByText("ACS").parentElement;
    expect(metadataRow).toHaveClass("estimate-catalogue-suggestion__tags");
    expect(screen.queryByText("Autre")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Vanne RBS rouge rallonge MF 25b · Autre · DN15 — 21,3x1,6 · ACS",
      ),
    ).not.toBeInTheDocument();
    expect(metadataRow).toContainElement(screen.getByText("Var.ral.15"));
    expect(metadataRow).toContainElement(screen.getByText("Robinetterie"));
    expect(screen.getByText("SOFINTHER").parentElement).toHaveTextContent(
      "SOFINTHER · réf. 41483 · prix du 14/07/2026",
    );
  });

  it("rend la liste dans un portail pour échapper aux overflows du tableau", () => {
    const { container } = renderPopover();
    const popover = screen.getByRole("listbox").parentElement;

    expect(popover).not.toBeNull();
    expect(container).not.toContainElement(popover);
    expect(document.body).toContainElement(popover);
    expect(popover).toHaveStyle({ position: "fixed" });
    expect(popover).toHaveAttribute("data-placement", "bottom");
  });

  it("affiche et permet de choisir un produit sans offre fournisseur", () => {
    const { onApplySuggestion } = renderPopover(
      undefined,
      [referenceSuggestion],
      "rouge",
    );

    expect(screen.getByText("Rouge")).toBeInTheDocument();
    expect(screen.getByText(/20,00/)).toBeInTheDocument();
    expect(screen.getByText("Prix de référence produit")).toBeInTheDocument();
    expect(screen.getByText("Sans offre fournisseur")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Rouge/ }));
    expect(onApplySuggestion).toHaveBeenCalledWith(referenceSuggestion);
  });

  it("insère l'offre principale ou une offre alternative", () => {
    const { onApplySuggestion } = renderPopover();

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
