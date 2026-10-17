import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/components/catalogue/api", () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => ({ success: mocks.toastSuccess }),
}));

import { SupplierOfferFormModal } from "@/components/catalogue/prices-manager/SupplierOfferFormModal";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";

// Review of 2.9 (finding 7). Isolation exception: clearing a declared conversion is a form-state rule
// (one select resets two other fields) that PU01 does not exercise; the E2E journey covers declaring it.
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

const convertedBar: EnrichedPrice = {
  id: "55555555-5555-4555-8555-555555555555",
  supplier_id: SUPPLIER_ID,
  supplier_catalog_item_id: "44444444-4444-4444-8444-444444444444",
  product_id: PRODUCT_ID,
  supplier_sku: "FONTE-BARRE-3M",
  unit: "barre",
  unit_price_cents: 26245,
  currency: "EUR",
  valid_from: "2026-10-01",
  valid_to: "2027-03-31",
  is_active: true,
  estimate_unit_code: "ml",
  estimate_units_per_purchase_unit: 3,
  purchase_rounding: "ceil",
  _supplierName: "DJO",
  _productName: "Tube fonte DN100",
  _freshnessLevel: "fresh",
  _ageDays: 1,
};

afterEach(cleanup);

describe("SupplierOfferFormModal conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchApi.mockResolvedValue({ item: { id: convertedBar.id } });
  });

  it("clears the whole conversion when the estimate unit is set back to none", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <SupplierOfferFormModal
        open
        item={convertedBar}
        supplierOptions={[{ value: SUPPLIER_ID, label: "DJO" }]}
        productOptions={[{ value: PRODUCT_ID, label: "Tube fonte DN100" }]}
        onClose={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Unité du devis"), "");
    expect(screen.getByLabelText("Quantité par unité d'achat")).toHaveValue("");
    expect(screen.getByLabelText("Arrondi à l'unité d'achat")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Enregistrer l’offre" }));

    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalled());
    const [, request] = mocks.fetchApi.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      action: "update-offer",
      item: { estimate_unit_code: null, estimate_units_per_purchase_unit: null, purchase_rounding: null },
    });
  });
});
