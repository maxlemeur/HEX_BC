import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";

import { fetchApi } from "@/components/catalogue/api";
import { EstimateArticleSheet } from "@/components/estimates/EstimateArticleSheet";
import { fetchCatalogueSuggestions } from "@/components/estimates/components/estimate-editor-row/shared";
import type { CataloguePriceSuggestion } from "@/lib/estimates/catalogue-suggestions";

vi.mock("@/components/catalogue/api", () => ({
  fetchApi: vi.fn(),
}));

vi.mock("@/components/estimates/components/estimate-editor-row/shared", () => ({
  fetchCatalogueSuggestions: vi.fn(),
}));

const suggestion: CataloguePriceSuggestion = {
  price_source: "supplier",
  supplier_price_id: "44444444-4444-4444-8444-444444444444",
  product_id: "33333333-3333-4333-8333-333333333333",
  product_designation: "Plateau mélaminé blanc",
  product_reference: "PLAT-001",
  supplier_id: "22222222-2222-4222-8222-222222222222",
  supplier_name: "Bois Pro",
  supplier_reference: "BP-001",
  unit: "u",
  unit_price_cents: 4200,
  adjusted_unit_price_cents: 4200,
  currency: "EUR",
  updated_at: "2026-08-20T08:00:00.000Z",
  is_stale: false,
  stale_days: 0,
  relevance_score: 1000,
  has_material_index_adjustment: false,
  material_index_code: null,
  material_index_value: null,
  catalogue_url: null,
  supplier_offer_count: 1,
  alternatives: [],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("EstimateArticleSheet", () => {

  it("loads the linked article, including archived records", async () => {
    vi.mocked(fetchApi).mockResolvedValue({
      items: [
        {
          id: suggestion.product_id,
          reference: "PLAT-001",
          designation: "Plateau mélaminé blanc",
          unit: "u",
          unit_price_cents: 4200,
          is_active: false,
          material: "Mélaminé",
        },
      ],
    });

    render(
      <EstimateArticleSheet
        isOpen
        mode="view"
        versionId="version-1"
        lineTitle="Plateau"
        productId={suggestion.product_id}
        currency="EUR"
        isReadOnly={false}
        onClose={vi.fn()}
        onAssociate={vi.fn()}
        onDetach={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Plateau mélaminé blanc")).toBeInTheDocument();
    });
    expect(fetchApi).toHaveBeenCalledWith(
      `/api/catalogue?id=${suggestion.product_id}&include_inactive=true&limit=1`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText("Article archivé")).toBeInTheDocument();
  });

  // TI-690. Failure modes: the deliberate search does not ask for drafts, so an imported article cannot be
  // linked to a line at all; or it returns a draft without saying so.
  it("asks for drafts in the deliberate search and labels them", async () => {
    vi.mocked(fetchCatalogueSuggestions).mockResolvedValue([
      { ...suggestion, product_catalogue_status: "draft" },
      {
        ...suggestion,
        product_id: "55555555-5555-4555-8555-555555555555",
        product_designation: "Plateau chêne",
        product_catalogue_status: "validated",
      },
    ]);

    render(
      <EstimateArticleSheet
        isOpen
        mode="associate"
        versionId="version-1"
        lineTitle="Plateau"
        productId={null}
        currency="EUR"
        isReadOnly={false}
        onClose={vi.fn()}
        onAssociate={vi.fn()}
        onDetach={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Rechercher dans le catalogue"), {
      target: { value: "plateau" },
    });

    await waitFor(() => {
      expect(screen.getByText("Plateau chêne")).toBeInTheDocument();
    });
    expect(fetchCatalogueSuggestions).toHaveBeenCalledWith(
      "version-1",
      "plateau",
      expect.any(AbortSignal),
      { includeDrafts: true },
    );
    const draftRow = screen.getByText("Plateau mélaminé blanc").closest("button");
    const validatedRow = screen.getByText("Plateau chêne").closest("button");
    expect(draftRow).toHaveTextContent("Brouillon");
    expect(validatedRow).not.toHaveTextContent("Brouillon");
  });
});
