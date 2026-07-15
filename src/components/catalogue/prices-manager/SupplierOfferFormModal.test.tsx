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

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: mocks.toastSuccess }),
}));

import { SupplierCatalogItemModal } from "@/components/catalogue/prices-manager/SupplierCatalogItemModal";
import { SupplierOfferFormModal } from "@/components/catalogue/prices-manager/SupplierOfferFormModal";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";

const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const CATALOG_ITEM_ID = "44444444-4444-4444-8444-444444444444";

const supplierOptions = [{ value: SUPPLIER_ID, label: "DJO" }];
const productOptions = [{ value: PRODUCT_ID, label: "Balle de tennis" }];

afterEach(cleanup);

function renderOffer(
  overrides: Partial<React.ComponentProps<typeof SupplierOfferFormModal>> = {},
) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();

  render(
    <SupplierOfferFormModal
      open
      item={null}
      supplierOptions={supplierOptions}
      productOptions={productOptions}
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />,
  );

  return { onClose, onSaved };
}

describe("SupplierOfferFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchApi.mockResolvedValue({ item: { id: "price-1" } });
  });

  it("stages a new supplier and article until the final atomic submission", async () => {
    const user = userEvent.setup();
    renderOffer();

    await user.click(
      screen.getByRole("button", { name: "Créer un nouvel article" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Créer un nouveau fournisseur" }),
    );
    await user.type(
      screen.getByLabelText("Désignation *"),
      "Balle de tennis pro",
    );
    await user.type(screen.getByLabelText("Nom *"), "Nouveau DJO");
    await user.type(screen.getByLabelText("Référence fournisseur"), "DJO-BT-1");
    await user.type(
      screen.getByLabelText("URL fournisseur"),
      "https://example.test/djo-bt-1",
    );
    await user.type(screen.getByLabelText("Prix unitaire HT *"), "15,00");

    expect(mocks.fetchApi).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Ajouter le fournisseur / tarif" }),
    );

    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));
    const [, request] = mocks.fetchApi.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;

    expect(payload).toMatchObject({
      action: "create",
      item: {
        new_supplier: { name: "Nouveau DJO" },
        new_product: { designation: "Balle de tennis pro" },
        supplier_sku: "DJO-BT-1",
        product_url: "https://example.test/djo-bt-1",
        unit_price_cents: 1500,
      },
    });
  });

  it("reuses and locks the existing article-supplier fiche", async () => {
    const user = userEvent.setup();
    mocks.fetchApi.mockImplementation(async (url: string) => {
      if (url.includes("view=supplier-item")) {
        return {
          item: {
            id: CATALOG_ITEM_ID,
            supplier_id: SUPPLIER_ID,
            product_id: PRODUCT_ID,
            supplier_sku: "DJO-BT-1",
            product_url: "https://example.test/djo-bt-1",
          },
        };
      }
      return { item: { id: "price-2" } };
    });
    renderOffer();

    await user.click(screen.getByLabelText("Article *"));
    await user.click(screen.getByRole("option", { name: "Balle de tennis" }));
    await user.click(screen.getByLabelText("Fournisseur *"));
    await user.click(screen.getByRole("option", { name: "DJO" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Référence fournisseur")).toHaveValue(
        "DJO-BT-1",
      );
    });
    expect(screen.getByLabelText("Référence fournisseur")).toBeDisabled();
    expect(screen.getByLabelText("URL fournisseur")).toBeDisabled();
    expect(
      screen.getByText(/Cette fiche article–fournisseur existe déjà/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Prix unitaire HT *"), "12,50");
    await user.click(
      screen.getByRole("button", { name: "Ajouter le fournisseur / tarif" }),
    );

    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(2));
    const postCall = mocks.fetchApi.mock.calls.find(
      ([url, request]) => url === "/api/prices" && request?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const payload = JSON.parse(String((postCall?.[1] as RequestInit).body));
    expect(payload).toMatchObject({
      action: "create",
      item: {
        supplier_id: SUPPLIER_ID,
        product_id: PRODUCT_ID,
        supplier_sku: "DJO-BT-1",
        product_url: "https://example.test/djo-bt-1",
        unit_price_cents: 1250,
      },
    });
  });
});

describe("SupplierCatalogItemModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchApi.mockResolvedValue({ item: { id: CATALOG_ITEM_ID } });
  });

  it("updates reference and URL through the dedicated fiche action", async () => {
    const user = userEvent.setup();
    const item: EnrichedPrice = {
      id: "price-1",
      supplier_catalog_item_id: CATALOG_ITEM_ID,
      supplier_id: SUPPLIER_ID,
      product_id: PRODUCT_ID,
      supplier_sku: "DJO-BT-1",
      product_url: "https://example.test/djo-bt-1",
      unit_price_cents: 1250,
      _supplierName: "DJO",
      _productName: "Balle de tennis",
      _freshnessLevel: "fresh",
      _ageDays: 1,
    };

    render(
      <SupplierCatalogItemModal
        item={item}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const skuInput = screen.getByLabelText("Référence fournisseur");
    const urlInput = screen.getByLabelText("URL fournisseur");
    await user.clear(skuInput);
    await user.type(skuInput, "DJO-BT-2");
    await user.clear(urlInput);
    await user.type(urlInput, "https://example.test/djo-bt-2");
    await user.click(
      screen.getByRole("button", { name: "Enregistrer la fiche" }),
    );

    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));
    const [, request] = mocks.fetchApi.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      action: "update-supplier-item",
      id: CATALOG_ITEM_ID,
      supplier_sku: "DJO-BT-2",
      product_url: "https://example.test/djo-bt-2",
    });
  });
});
