import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

import { POST } from "@/app/api/purchase-orders/route";
import { PUT } from "@/app/api/purchase-orders/[id]/route";
import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";

/**
 * TI-691, delivery 3a: the draft edit of an order made from a material request, and shipping and discount lines on any
 * draft, written before the change. Fictional ids. Failure modes:
 *  1. a draft edit sends request fields (request line, imputation, affaire) the client could forge, or an existing
 *     article line gains keys it did not send (line_kind, price_per): the database would no longer keep what it had;
 *  2. shipping and discount lines lose their kind on the way, keep an empty name or no unit, or carry an article;
 *  3. a price given for a lot is not passed on, or a lot other than 1, 10, 100 or 1 000 reaches the database;
 *  4. a discount larger than the order reaches the database, or is refused as an amount out of range;
 *  5. an order without a site must send one to be saved;
 *  6. the database's refusals of a request order (its supplier, its negative total) answer a bare 500.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TENANT_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const PRODUCT_ID = "77777777-7777-4777-8777-777777777777";
const SUPPLIER_ID = "88888888-8888-4888-8888-888888888888";
const SITE_ID = "99999999-9999-4999-8999-999999999999";

function supabaseMock(rpcAnswer: { data: unknown; error: unknown } = { data: { id: ORDER_ID, edit_revision: 2 }, error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcAnswer);
  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return { select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [{ tenant_id: TENANT_ID, role: "engineer" }], error: null }) }) }) }) };
      }
      if (table === "purchase_orders") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: ORDER_ID, tenant_id: TENANT_ID, status: "draft" }, error: null }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
    supabase, userId: USER_ID, tenantId: TENANT_ID, tenantRole: "engineer", isTenantAdmin: false,
    membership: { id: "membership-1", tenant_id: TENANT_ID, user_id: USER_ID, role: "engineer", is_default: true,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  } as unknown as AuthenticatedTenantContext);
  return rpc;
}

async function put(body: unknown) {
  const response = await PUT(new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: ORDER_ID }) });
  return { status: response.status, body: await response.json() as { error?: string; code?: string } };
}

const requestLine = { id: ITEM_ID, productId: PRODUCT_ID, reference: "ALPHA-501", designation: "Coude 90°, DN 50, Inox 304L",
  quantity: 5, unit: "u", unitPriceCents: 1234, taxRateBp: 2000 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("draft edit of an order made from a material request", () => {
  it("1 sends a request line as the client gave it, nothing it did not send", async () => {
    const rpc = supabaseMock();
    const answer = await put({ expectedRevision: 1, supplierId: SUPPLIER_ID, items: [requestLine] });
    expect(answer.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("replace_purchase_order_draft", {
      p_order_id: ORDER_ID,
      p_header_patch: { supplier_id: SUPPLIER_ID },
      p_items: [{ id: ITEM_ID, product_id: PRODUCT_ID, reference: "ALPHA-501", unit: "u", designation: "Coude 90°, DN 50, Inox 304L",
        quantity: 5, unit_price_ht_cents: 1234, tax_rate_bp: 2000 }],
      p_expected_revision: 1,
    });
  });

  it("1 refuses request fields in the payload", async () => {
    const rpc = supabaseMock();
    for (const forged of [{ materialRequestLineId: ITEM_ID }, { imputation: "overhead" }, { projectId: ORDER_ID }]) {
      const answer = await put({ expectedRevision: 1, items: [{ ...requestLine, ...forged }] });
      expect([answer.status, answer.body.error]).toEqual([400, "Ligne 1 : Champ inconnu ou non modifiable."]);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("2 and 3 pass shipping, a discount and a lot, with their usual name and a lump-sum unit", async () => {
    const rpc = supabaseMock();
    const answer = await put({ expectedRevision: 1, items: [
      requestLine,
      { designation: "", quantity: 1, unitPriceCents: 1500, taxRateBp: 2000, lineKind: "shipping" },
      { designation: "Remise fidélité", quantity: 1, unitPriceCents: 10, taxRateBp: 500, lineKind: "discount" },
      { designation: "Rondelles", quantity: 3, unit: "u", unitPriceCents: 50, taxRateBp: 2000, pricePer: 100 },
    ] });
    expect(answer.status).toBe(200);
    expect((rpc.mock.calls[0][1] as { p_items: unknown[] }).p_items.slice(1)).toEqual([
      { unit: "forfait", designation: "Port", quantity: 1, unit_price_ht_cents: 1500, tax_rate_bp: 2000, line_kind: "shipping" },
      { unit: "forfait", designation: "Remise fidélité", quantity: 1, unit_price_ht_cents: 10, tax_rate_bp: 500, line_kind: "discount" },
      { unit: "u", designation: "Rondelles", quantity: 3, unit_price_ht_cents: 50, tax_rate_bp: 2000, price_per: 100 },
    ]);
  });

  it("2 refuses an article on a discount, and 3 a lot of 7 units", async () => {
    const rpc = supabaseMock();
    const withArticle = await put({ expectedRevision: 1, items: [{ ...requestLine, id: undefined, lineKind: "discount" }] });
    expect([withArticle.status, withArticle.body.error]).toEqual([400, "Ligne 1 : Un port ou une remise ne porte pas d'article."]);
    const oddLot = await put({ expectedRevision: 1, items: [{ ...requestLine, pricePer: 7 }] });
    expect([oddLot.status, oddLot.body.error]).toEqual([400, "Ligne 1 : Le prix s'entend pour 1, 10, 100 ou 1 000 unités."]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("4 refuses a discount larger than the order before the database", async () => {
    const rpc = supabaseMock();
    const answer = await put({ expectedRevision: 1, items: [
      { designation: "Tube", quantity: 1, unit: "u", unitPriceCents: 1000, taxRateBp: 2000 },
      { designation: "Remise", quantity: 1, unitPriceCents: 1001, taxRateBp: 2000, lineKind: "discount" },
    ] });
    expect([answer.status, answer.body.error]).toEqual([400, "La remise dépasse le montant de la commande."]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("5 saves an order without a site when none is sent", async () => {
    const rpc = supabaseMock();
    expect((await put({ expectedRevision: 3, notes: "Retrait au comptoir" })).status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_header_patch: { notes: "Retrait au comptoir" } });
  });

  it.each([
    ["PURCHASE_ORDER_REQUEST_SUPPLIER_IMMUTABLE", "Le fournisseur vient du devis retenu de la demande de matériel : il ne change pas sur cette commande."],
    ["PURCHASE_ORDER_TOTAL_NEGATIVE", "La remise dépasse le montant de la commande."],
  ])("6 answers %s in French", async (message, sentence) => {
    supabaseMock({ data: null, error: { code: "22023", message } });
    const answer = await put({ expectedRevision: 1, supplierId: SUPPLIER_ID });
    expect([answer.status, answer.body.error, answer.body.code]).toEqual([400, sentence, message]);
  });
});

describe("manual creation with shipping and a discount", () => {
  it("passes the kinds to the database and refuses a discount larger than the order", async () => {
    const rpc = supabaseMock({ data: { id: ORDER_ID, reference: "C-2611-001", edit_revision: 1 }, error: null });
    const create = (items: unknown[]) => POST(new Request("http://localhost/api/purchase-orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ supplierId: SUPPLIER_ID, deliverySiteId: SITE_ID, items }),
    }));
    const refused = await create([
      { designation: "Tube", quantity: 1, unit: "u", unitPriceCents: 1000, taxRateBp: 2000 },
      { designation: "Remise", quantity: 1, unitPriceCents: 2000, taxRateBp: 2000, lineKind: "discount" },
    ]);
    expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([400, "La remise dépasse le montant de la commande."]);
    expect(rpc).not.toHaveBeenCalled();
    const created = await create([
      { designation: "Tube", quantity: 1, unit: "u", unitPriceCents: 1000, taxRateBp: 2000 },
      { designation: "", quantity: 1, unitPriceCents: 500, taxRateBp: 2000, lineKind: "shipping" },
    ]);
    expect(created.status).toBe(200);
    expect((rpc.mock.calls[0][1] as { p_items: unknown[] }).p_items).toEqual([
      { unit: "u", designation: "Tube", quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000 },
      { unit: "forfait", designation: "Port", quantity: 1, unit_price_ht_cents: 500, tax_rate_bp: 2000, line_kind: "shipping" },
    ]);
  });
});
