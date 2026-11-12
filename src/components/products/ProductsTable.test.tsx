import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductsTable } from "@/components/products/ProductsTable";
import type { ProductView } from "@/components/products/product-view";

/**
 * Failure modes guarded here (TI-690, catalogue table):
 *  1. a draft looks like any other article: the operator cannot tell what is still to review;
 *  2. a draft cannot be validated from its row, or the action reports another article;
 *  3. a validated article is shown as a draft, or offers a validation that means nothing for it;
 *  4. the validation can be sent twice while the first request is still running;
 *  5. the supply type an article is classified under is not shown.
 */

function buildProduct(overrides: Partial<ProductView>): ProductView {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    created_at: "2026-11-10T08:00:00.000Z",
    updated_at: "2026-11-10T08:00:00.000Z",
    reference: "TE-RED-54",
    designation: "Té réduit inox serti 54-28",
    category: "Raccords",
    product_type: "Té réduit",
    material: "Inox 304L",
    grade: null,
    dimensions: null,
    standard: null,
    unit: "u",
    unit_price_cents: 0,
    reference_quantity: null,
    reference_transport_mode: null,
    reference_price_validation_id: null,
    is_active: true,
    catalogue_status: "validated",
    supply_type_id: null,
    reliability_score: null,
    _supplyTypeName: null,
    _status: "active",
    _priceStatus: "none",
    _supplierPriceCount: 0,
    _bestSupplierPriceCents: null,
    _bestSupplierName: null,
    _bestSupplierPriceUpdatedAt: null,
    _referencePriceSourceOrderId: null,
    _referencePriceSourceOrderReference: null,
    _referencePriceSourceSupplierName: null,
    _referencePriceSourceDate: null,
    ...overrides,
  };
}

const DRAFT = buildProduct({
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  designation: "Collier isophonique M8",
  reference: "COL-M8",
  catalogue_status: "draft",
  reliability_score: 7,
});

const VALIDATED = buildProduct({
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  designation: "Tube inox 304L DN50",
  reference: "TUB-DN50",
  supply_type_id: "22222222-2222-4222-8222-222222222222",
  _supplyTypeName: "Tuyauterie inox",
});

function renderTable(updatingStatusId: string | null = null) {
  const onValidate = vi.fn();
  render(
    <ProductsTable
      products={[DRAFT, VALIDATED]}
      isInitialLoading={false}
      isCatalogueEmpty={false}
      totalItems={2}
      updatingStatusId={updatingStatusId}
      onCreate={vi.fn()}
      onTemplateImport={vi.fn()}
      onEdit={vi.fn()}
      onReviewPrice={vi.fn()}
      onToggleArchive={vi.fn()}
      onValidate={onValidate}
    />,
  );
  return { onValidate };
}

function rowOf(product: ProductView) {
  const row = screen.getByText(product.designation).closest("tr");
  if (!row) throw new Error(`No row for ${product.designation}`);
  return within(row);
}

async function openActions(user: ReturnType<typeof userEvent.setup>, product: ProductView) {
  await user.click(screen.getByRole("button", { name: `Actions pour ${product.designation}` }));
  return within(await screen.findByRole("menu"));
}

describe("ProductsTable, drafts", () => {
  afterEach(cleanup);

  it("marks a draft and offers to validate it from its row", async () => {
    const user = userEvent.setup({ delay: null });
    const { onValidate } = renderTable();

    expect(rowOf(DRAFT).getByText("Brouillon")).toBeInTheDocument();

    const menu = await openActions(user, DRAFT);
    await user.click(menu.getByRole("menuitem", { name: "Valider" }));

    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(onValidate).toHaveBeenCalledWith(DRAFT);
  });

  it("shows a validated article without the draft mark or the validation action", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    expect(rowOf(VALIDATED).queryByText("Brouillon")).not.toBeInTheDocument();
    expect(rowOf(VALIDATED).getByText("Fourniture : Tuyauterie inox")).toBeInTheDocument();
    expect(rowOf(DRAFT).queryByText(/Fourniture :/)).not.toBeInTheDocument();

    const menu = await openActions(user, VALIDATED);
    // The menu is the article's own: its other actions are there, the validation is not.
    expect(menu.getByRole("menuitem", { name: "Modifier" })).toBeInTheDocument();
    expect(menu.queryByRole("menuitem", { name: "Valider" })).not.toBeInTheDocument();
  });

  it("does not send a second validation while the row is updating", async () => {
    const user = userEvent.setup({ delay: null });
    const { onValidate } = renderTable(DRAFT.id);

    const menu = await openActions(user, DRAFT);
    const validate = menu.getByRole("menuitem", { name: "Valider" });
    expect(validate).toHaveAttribute("aria-disabled", "true");
    await user.click(validate);

    expect(onValidate).not.toHaveBeenCalled();
  });
});
