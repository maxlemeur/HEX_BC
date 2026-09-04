import { describe, expect, it } from "vitest";

import {
  catalogueListQuerySchema,
  cataloguePageQuerySchema,
  createCatalogueItemSchema,
  createSupplierPriceSchema,
  priceLookupsQuerySchema,
  pricesPageQuerySchema,
  updateCatalogueItemSchema,
  updateSupplierCatalogItemSchema,
  updateSupplierPriceSchema,
} from "@/lib/catalogue/schemas";

const ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

describe("catalogue list query schema", () => {
  it("accepts an exact product id and rejects malformed identifiers", () => {
    expect(catalogueListQuerySchema.safeParse({ id: PRODUCT_ID }).success).toBe(true);
    expect(catalogueListQuerySchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("catalogue update schemas", () => {
  it("does not materialize is_active default when updating catalogue item", () => {
    const parsed = updateCatalogueItemSchema.safeParse({
      action: "update",
      id: ID,
      item: {
        designation: "Article revise",
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.item).not.toHaveProperty("is_active");
  });

  it("rejects empty catalogue item update payload", () => {
    const parsed = updateCatalogueItemSchema.safeParse({
      action: "update",
      id: ID,
      item: {},
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ"),
      ),
    ).toBe(true);
  });

  it("keeps create default for catalogue is_active", () => {
    const parsed = createCatalogueItemSchema.safeParse({
      action: "create",
      item: {
        reference: "REF-001",
        designation: "Article",
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.item.is_active).toBe(true);
    expect(parsed.data.item.notes).toBeNull();
  });
});

describe("supplier price update schemas", () => {
  it("does not materialize currency default when updating supplier price", () => {
    const parsed = updateSupplierPriceSchema.safeParse({
      action: "update",
      id: ID,
      item: {
        unit_price_cents: 1299,
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.item).not.toHaveProperty("currency");
  });

  it("rejects empty supplier price update payload", () => {
    const parsed = updateSupplierPriceSchema.safeParse({
      action: "update",
      id: ID,
      item: {},
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ"),
      ),
    ).toBe(true);
  });

  it("keeps create default for supplier currency", () => {
    const parsed = createSupplierPriceSchema.safeParse({
      action: "create",
      item: {
        supplier_id: SUPPLIER_ID,
        product_id: PRODUCT_ID,
        unit_price_cents: 1299,
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.item.currency).toBe("EUR");
    expect(parsed.data.item.catalogue_item_id).toBeUndefined();
    expect(parsed.data.item.valid_from).toBeNull();
  });
});

describe("supplier catalogue item price creation", () => {
  it("accepts a new supplier and a new article staged in the same creation", () => {
    const parsed = createSupplierPriceSchema.safeParse({
      action: "create",
      item: {
        new_supplier: { name: "Nouveau fournisseur" },
        new_product: { designation: "Nouvel article" },
        supplier_sku: "REF-FOURN-1",
        product_url: "https://example.test/article",
        unit_price_cents: 1299,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects ambiguous existing and new supplier selections", () => {
    const parsed = createSupplierPriceSchema.safeParse({
      action: "create",
      item: {
        supplier_id: SUPPLIER_ID,
        new_supplier: { name: "Doublon" },
        product_id: PRODUCT_ID,
        unit_price_cents: 1299,
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("exactement un fournisseur"),
      ),
    ).toBe(true);
  });

  it("rejects ambiguous existing and new article selections", () => {
    const parsed = createSupplierPriceSchema.safeParse({
      action: "create",
      item: {
        supplier_id: SUPPLIER_ID,
        product_id: PRODUCT_ID,
        new_product: { designation: "Doublon" },
        unit_price_cents: 1299,
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("exactement un article"),
      ),
    ).toBe(true);
  });

  it("rejects non HTTP(S) supplier URLs", () => {
    const parsed = createSupplierPriceSchema.safeParse({
      action: "create",
      item: {
        supplier_id: SUPPLIER_ID,
        product_id: PRODUCT_ID,
        product_url: "javascript:alert(1)",
        unit_price_cents: 1299,
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) => issue.path.includes("product_url")),
    ).toBe(true);
  });

  it("validates the dedicated supplier catalogue item update", () => {
    const parsed = updateSupplierCatalogItemSchema.safeParse({
      action: "update-supplier-item",
      id: ID,
      supplier_sku: "REF-2",
      product_url: "https://example.test/ref-2",
    });

    expect(parsed.success).toBe(true);
  });

  it("keeps supplier identity fields out of price updates", () => {
    const parsed = updateSupplierPriceSchema.parse({
      action: "update",
      id: ID,
      item: {
        unit_price_cents: 1299,
        supplier_id: SUPPLIER_ID,
        product_id: PRODUCT_ID,
      },
    });

    expect(parsed.item).not.toHaveProperty("supplier_id");
    expect(parsed.item).not.toHaveProperty("product_id");
  });
});
describe("catalogue and price pagination schemas", () => {
  it("accepts repeated product filters and the supported page sizes", () => {
    const parsed = cataloguePageQuerySchema.parse({
      q: " acier ",
      material: ["Acier", "Inox"],
      category: [],
      unit: ["ml"],
      price_status: ["fresh", "none"],
      status: ["active"],
      sort: "best_supplier_price_cents",
      dir: "desc",
      page: 3,
      size: 100,
    });

    expect(parsed).toMatchObject({
      q: "acier",
      material: ["Acier", "Inox"],
      page: 3,
      size: 100,
    });
  });

  it("rejects unsupported page sizes", () => {
    expect(
      pricesPageQuerySchema.safeParse({
        freshness: [],
        supplier_id: null,
        product_id: null,
        page: 1,
        size: 10,
      }).success,
    ).toBe(false);
  });

  it("caps remote price lookups at 50 suggestions", () => {
    expect(
      priceLookupsQuerySchema.safeParse({
        kind: "supplier",
        q: "arc",
        selected_id: null,
        limit: 51,
      }).success,
    ).toBe(false);
  });
});
