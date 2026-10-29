import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  listEstimateItems: vi.fn(),
  getEstimateSupplierComparisons: vi.fn(),
}));
vi.mock("@/lib/auth/tenant-context", () => ({
  readAuthenticatedUser: vi.fn(),
  readActiveTenantMembership: vi.fn(),
}));

import { readActiveTenantMembership, readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { getEstimatePurchaseOrderDraftPreparation } from "@/lib/estimates/purchase-order-drafts";
import { getEstimateSupplierComparisons, listEstimateItems } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_SUPPLIER_ID = "66666666-6666-4666-8666-666666666666";
const LINE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function thenable<T>(result: () => T) {
  const builder = {
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then<TResult1 = T, TResult2 = never>(
      fulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) { return Promise.resolve(result()).then(fulfilled, rejected); },
  };
  return builder;
}

function coveredSnapshot() {
  const line = {
    id: LINE_ID, item_type: "line", title: "Coût négocié à conserver", description: "u",
    quantity: 2, unit_price_ht_cents: 1200, tax_rate_bp: 2000,
    supply_type_id: "supply-1", selected_supplier_price_id: "price-1",
  };
  const alternative = {
    kind: "selected_current", supplier_price_id: "price-1", supplier_id: SUPPLIER_ID,
    supplier_name: "Supplier A", adjusted_unit_price_cents: 1800,
    supplier_reference: "REF-1", catalogue_url: null, updated_at: new Date().toISOString(),
    is_stale: false, product_designation: "Produit A", is_selected: true,
    unit: "u", min_quantity: 1, currency: "EUR", is_active: true,
    valid_from: "2000-01-01", valid_to: "2099-12-31", unit_price_cents: 1800,
  };
  vi.mocked(listEstimateItems).mockResolvedValue({ items: [line] } as never);
  vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
    stale_price_days: 90,
    comparisons: [{ item_id: LINE_ID, coverage_status: "covered", risk_flags: [],
      selected_alternative: alternative, alternatives: [alternative] }],
  } as never);
  const review = {
    item_id: LINE_ID, item_title: line.title, quantity: 2,
    unit_price_ht_cents: 1200, tax_rate_bp: 2000, unit: "u",
    selected_supplier_price_id: "price-1", supplier_id: SUPPLIER_ID,
    supplier_name: "Supplier A", supplier_reference: "REF-1", review_fingerprint: "a".repeat(64),
    ordered_quantity: 2, ordered_unit: "u", ordered_unit_price_ht_cents: 1200,
  };
  return { line, review, offer: { ...alternative, id: "price-1", supplier_id: SUPPLIER_ID } };
}

function installDatabase(snapshot: ReturnType<typeof coveredSnapshot>, options: {
  currentOffers?: () => Record<string, unknown>[];
  supplierActive?: boolean;
  currency?: string;
  offerReadError?: { code: string; message: string };
  reviewLines?: Array<Record<string, unknown>>;
} = {}) {
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "estimate_versions") {
        const builder = {
          eq: vi.fn(() => builder),
          single: vi.fn().mockResolvedValue({ data: { currency: options.currency ?? "EUR" }, error: null }),
        };
        return { select: vi.fn(() => builder) };
      }
      if (table === "supplier_pricebook") return { select: vi.fn(() => thenable(() => ({
        data: options.currentOffers?.() ?? [snapshot.offer], error: options.offerReadError ?? null,
      }))) };
      if (table === "suppliers") return { select: vi.fn(() => thenable(() => ({
        data: [{ id: SUPPLIER_ID, is_active: options.supplierActive ?? true }], error: null,
      }))) };
      // This empty legacy read lets the RED run exercise its old preparation
      // behavior. The replacement reads the authenticated transfer projection.
      if (table === "purchase_orders") return { select: vi.fn(() => thenable(() => ({ data: [], error: null }))) };
      throw new Error(`Unexpected read ${table}`);
    }),
    rpc: vi.fn(async (name: string) => {
      if (name === "get_estimate_purchase_order_transfers") return { data: { lines: [] }, error: null };
      if (name === "get_estimate_purchase_order_review") return { data: { lines: options.reviewLines ?? [snapshot.review] }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    }),
  };
  vi.mocked(readAuthenticatedUser).mockResolvedValue({ supabase, user: { id: USER_ID }, error: null } as never);
  vi.mocked(readActiveTenantMembership).mockResolvedValue({
    membership: { tenant_id: TENANT_ID, role: "engineer" }, error: null,
  } as never);
  return supabase;
}

describe("purchase preparation coherent review", () => {
  beforeEach(() => vi.clearAllMocks());

  // Failure plan and E2E gap precede implementation in
  // docs/testing/purchase-preparation.md: force the two internal reads to
  // disagree without installing a timing hook in the application.
  it.each([
    { label: "quantity", change: { quantity: 3 } },
    { label: "negotiated cost", change: { unit_price_ht_cents: 1300 } },
    { label: "tax", change: { tax_rate_bp: 1000 } },
    { label: "line title", change: { item_title: "Different article" } },
    { label: "unit", change: { unit: "m" } },
    { label: "selected offer", change: { selected_supplier_price_id: "price-2" } },
    { label: "supplier identity", change: { supplier_id: SECOND_SUPPLIER_ID } },
    { label: "supplier name", change: { supplier_name: "Renamed supplier" } },
    { label: "supplier reference", change: { supplier_reference: "REF-2" } },
    // Second review of 2.9: an offer converted or repriced between the two reads (factor 3 → 2:
    // 94 bars shown, 141 created) must not be ordered on the values shown.
    { label: "ordered quantity", change: { ordered_quantity: 3 } },
    { label: "ordered unit", change: { ordered_unit: "barre" } },
    { label: "ordered price", change: { ordered_unit_price_ht_cents: 3600 } },
  ])("rejects a mixed snapshot when the canonical $label changes", async ({ change }) => {
    const snapshot = coveredSnapshot();
    installDatabase(snapshot, { reviewLines: [{ ...snapshot.review, ...change }] });
    await expect(getEstimatePurchaseOrderDraftPreparation(VERSION_ID)).rejects.toMatchObject({
      code: "ORDER_DRAFT_PREPARATION_STALE", status: 409,
    });
  });

  it("rejects a prepared line missing from the canonical review", async () => {
    const snapshot = coveredSnapshot();
    installDatabase(snapshot, { reviewLines: [] });
    await expect(getEstimatePurchaseOrderDraftPreparation(VERSION_ID)).rejects.toMatchObject({
      code: "ORDER_DRAFT_PREPARATION_STALE", status: 409,
    });
  });

  it.each([
    { label: "validity missing", change: { valid_to: null }, message: "Validité de l'offre à préciser" },
    { label: "price became stale", change: { updated_at: "2000-01-01T00:00:00Z" }, message: "Prix à revalider" },
  ])("blocks a covered comparison when the current $label", async ({ change, message }) => {
    const snapshot = coveredSnapshot();
    const unchanged = structuredClone(snapshot.line);
    let current: Record<string, unknown> = snapshot.offer;
    installDatabase(snapshot, { currentOffers: () => [current] });
    const before = await getEstimatePurchaseOrderDraftPreparation(VERSION_ID);
    expect(before.summary.draftable_lines).toBe(1);
    current = { ...snapshot.offer, ...change };
    const result = await getEstimatePurchaseOrderDraftPreparation(VERSION_ID);
    expect(result.groups).toEqual([]);
    expect(result.blocked_lines).toEqual([expect.objectContaining({
      item_id: LINE_ID, reason: "supplier_offer_ineligible", reason_detail: message,
    })]);
    expect(snapshot.line).toEqual(unchanged);
  });

  it.each([
    { label: "offer disappeared", missing: true, active: true, currency: "EUR", message: "Offre retenue introuvable ou inaccessible" },
    { label: "non-EUR estimate", missing: false, active: true, currency: "USD", message: "Conversion vers EUR requise avant commande" },
  ])("blocks the older comparison: $label", async ({ missing, active, currency, message }) => {
    const snapshot = coveredSnapshot();
    installDatabase(snapshot, { currency, supplierActive: active, currentOffers: () => missing ? [] : [snapshot.offer] });
    const result = await getEstimatePurchaseOrderDraftPreparation(VERSION_ID);
    expect(result.groups).toEqual([]);
    expect(result.blocked_lines).toEqual([expect.objectContaining({
      item_id: LINE_ID, reason: "supplier_offer_ineligible", reason_detail: message,
    })]);
  });

  it("fails closed when current offer conditions cannot be read", async () => {
    const snapshot = coveredSnapshot();
    installDatabase(snapshot, { offerReadError: { code: "XX000", message: "unavailable" } });
    await expect(getEstimatePurchaseOrderDraftPreparation(VERSION_ID)).rejects.toThrow();
  });
});
