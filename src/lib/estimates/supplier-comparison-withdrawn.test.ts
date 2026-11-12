import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlagValueForTenant: vi.fn().mockResolvedValue(null),
  getStalePriceDaysForTenant: vi.fn().mockResolvedValue(90),
}));

import { getEstimateSupplierComparisons, suggestEstimateCataloguePrices } from "@/lib/estimates/supplier-comparison-server";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes (TI-691, Codex review of #274). Withdrawing a supplier from an article (supplier_catalog_items.is_active
 * false) keeps its price rows, which stay active: the screen says they are no longer proposed.
 *  1. The catalogue suggestion of an estimate line still offers the withdrawn supplier's price (here, the cheapest).
 *  2. The alternatives of a line whose selected offer is that withdrawn price rank it as the best price.
 *  3. Once the supplier is restored to the article (item active again), its price is not suggested again.
 *  4. Counterexample: an article without any supplier item (no offer at all) is no longer suggested by its reference
 *     price, or an offer whose item is active disappears.
 * The fake applies equality filters, embedded ones included; it does not run text searches (every row matches).
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const VERSION = "50000000-0000-4000-8000-000000000001";
const KEPT_SUPPLIER = "40000000-0000-4000-8000-000000000001";
const WITHDRAWN_SUPPLIER = "40000000-0000-4000-8000-000000000002";
const ELBOW = "90000000-0000-4000-8000-000000000001";
const ELBOW_REFERENCE_ONLY = "90000000-0000-4000-8000-000000000002";
const KEPT_ITEM = "b0000000-0000-4000-8000-000000000001";
const WITHDRAWN_ITEM = "b0000000-0000-4000-8000-000000000002";
const KEPT_PRICE = "c0000000-0000-4000-8000-000000000001";
const WITHDRAWN_PRICE = "c0000000-0000-4000-8000-000000000002";
const LINE = "d0000000-0000-4000-8000-000000000001";

function product(id: string, designation: string, unitPriceCents: number): FakeRow {
  return {
    id, tenant_id: TENANT, designation, reference: null, category: null, product_type: "Coude", material: "Inox 304L",
    grade: null, dimensions: "DN 50", standard: null, unit: "u", unit_price_cents: unitPriceCents,
    updated_at: "2026-11-01T08:00:00.000Z", reference_transport_mode: null, catalogue_status: "validated", is_active: true,
  };
}

function price(id: string, supplierId: string, itemId: string, cents: number, itemActive: boolean): FakeRow {
  return {
    id, tenant_id: TENANT, supplier_id: supplierId, product_id: ELBOW, supplier_catalog_item_id: itemId,
    supplier_sku: `SKU-${cents}`, unit: "u", unit_price_cents: cents, zero_price_kind: null, transport_mode: null,
    estimate_unit_code: null, estimate_units_per_purchase_unit: null, purchase_rounding: null, currency: "EUR",
    min_quantity: 1, valid_from: "2026-11-01", valid_to: "2027-04-30", notes: null,
    updated_at: "2026-11-10T08:00:00.000Z", created_at: "2026-11-10T08:00:00.000Z",
    // The price row stays active when its supplier is withdrawn from the article: only the item says it.
    is_active: true,
    supplier_catalog_items: { supplier_sku: `SKU-${cents}`, product_url: null, is_active: itemActive },
    products: { catalogue_status: "validated" },
  };
}

function seed(withdrawn: boolean) {
  const fake = createFakeSupabase({
    userId: ADMIN,
    tables: {
      tenant_memberships: [fakeMembership(ADMIN, TENANT, "admin")],
      estimate_versions: [{
        id: VERSION, tenant_id: TENANT, project_id: PROJECT, status: "draft", currency: "EUR", max_section_depth: 2,
        estimate_projects: { id: PROJECT, tenant_id: TENANT, user_id: ADMIN, name: "Affaire fictive", is_archived: false },
      }],
      estimate_items: [{
        id: LINE, tenant_id: TENANT, version_id: VERSION, item_type: "line", title: "Coude 90° inox DN 50", quantity: 4,
        description: "u", unit_code: null, selected_supplier_price_id: WITHDRAWN_PRICE, fo_price_origin: null,
      }],
      products: [
        product(ELBOW, "Coude 90° inox DN 50", 1200),
        // No supplier item at all: suggested by its reference price only.
        product(ELBOW_REFERENCE_ONLY, "Coude 90° inox DN 50 soudé", 2000),
      ],
      suppliers: [
        { id: KEPT_SUPPLIER, tenant_id: TENANT, name: "Fournisseur Gardé", is_active: true },
        { id: WITHDRAWN_SUPPLIER, tenant_id: TENANT, name: "Fournisseur Retiré", is_active: true },
      ],
      supplier_catalog_items: [
        { id: KEPT_ITEM, tenant_id: TENANT, product_id: ELBOW, supplier_id: KEPT_SUPPLIER, is_active: true },
        { id: WITHDRAWN_ITEM, tenant_id: TENANT, product_id: ELBOW, supplier_id: WITHDRAWN_SUPPLIER, is_active: !withdrawn },
      ],
      supplier_pricebook: [
        price(KEPT_PRICE, KEPT_SUPPLIER, KEPT_ITEM, 1500, true),
        // The cheapest offer: the one a suggestion would take first.
        price(WITHDRAWN_PRICE, WITHDRAWN_SUPPLIER, WITHDRAWN_ITEM, 900, !withdrawn),
      ],
      dpgf_catalogue_links: [],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("suggested prices of a supplier withdrawn from the article", () => {
  it("are not suggested, while the other supplier's price and an article without supplier items still are", async () => {
    seed(true);
    const result = await suggestEstimateCataloguePrices(VERSION, "coude");
    expect(JSON.stringify(result)).not.toContain(WITHDRAWN_PRICE);
    const elbow = result.suggestions.find((suggestion) => suggestion.product_id === ELBOW);
    expect(elbow).toMatchObject({ supplier_price_id: KEPT_PRICE, supplier_offer_count: 1 });
    expect(result.suggestions.find((suggestion) => suggestion.product_id === ELBOW_REFERENCE_ONLY)).toMatchObject({
      supplier_price_id: null, price_source: "reference",
    });
  });

  it("are suggested again once the supplier is restored to the article", async () => {
    seed(false);
    const result = await suggestEstimateCataloguePrices(VERSION, "coude");
    const elbow = result.suggestions.find((suggestion) => suggestion.product_id === ELBOW);
    expect(elbow).toMatchObject({ supplier_offer_count: 2 });
    expect(JSON.stringify(elbow)).toContain(WITHDRAWN_PRICE);
    expect(result.suggestions.find((suggestion) => suggestion.product_id === ELBOW_REFERENCE_ONLY)).toMatchObject({
      price_source: "reference",
    });
  });

  it("never rank as the best price beside a line that had selected one of them, which stays its selection", async () => {
    seed(true);
    const { comparisons } = await getEstimateSupplierComparisons(VERSION, [LINE]);
    expect(comparisons[0]).toMatchObject({ selected_supplier_price_id: WITHDRAWN_PRICE, best_supplier_price_id: KEPT_PRICE });
    expect(comparisons[0]?.alternatives
      .filter((alternative) => alternative.supplier_price_id === WITHDRAWN_PRICE)
      .every((alternative) => alternative.is_selected)).toBe(true);
  });

  it("counterexample: rank as the best price again once the supplier is restored", async () => {
    seed(false);
    const { comparisons } = await getEstimateSupplierComparisons(VERSION, [LINE]);
    expect(comparisons[0]).toMatchObject({ selected_supplier_price_id: WITHDRAWN_PRICE, best_supplier_price_id: WITHDRAWN_PRICE });
  });
});
