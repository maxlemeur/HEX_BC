import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as confirmationRoute from "@/app/api/purchase-orders/[id]/confirmation/route";
import * as receptionRoute from "@/app/api/purchase-orders/[id]/reception/route";
import {
  createFakeSupabase,
  fakeMembership,
  type FakeRpcHandler,
  type FakeTables,
} from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the confirmation and the reception of an order of an affaire (TI-691, lot 2 « l'achat », delivery
 * 3b-1), written before the routes. Members, orders, lines and prices are fictional; the database functions are played
 * as pgTAP proves them (material-request-order-confirmation.test.sql: rights, proof, dates, prices, lifecycle).
 *  1. Body: a call without a revision, with an unknown field, a price that is not whole cents, an unknown lot, a proof
 *     that is not a UUID or a date that is not AAAA-MM-JJ reaches the database.
 *  2. Scope: an order the caller cannot read is reached instead of answering 404; a signed-out call is not 401.
 *  3. The function is not given exactly the order, the revision and the confirmation (a supplier reference left blank
 *     is not null, a delivery date not given is sent and so cleared).
 *  4. A refusal of the database answers a bare 400 or 500, or its raw code, instead of its status and a sentence.
 *  5. A confirmed or received answer leaks more than the contract, or a malformed one is passed on as complete.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const AUTHOR = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const ORDER = "50000000-0000-4000-8000-000000000001";
const HIDDEN_ORDER = "50000000-0000-4000-8000-000000000002";
const DOCUMENT = "51000000-0000-4000-8000-000000000001";
const ITEM_SCREWS = "52000000-0000-4000-8000-000000000001";
const ITEM_ELBOWS = "52000000-0000-4000-8000-000000000002";

const confirmed = {
  id: ORDER, status: "confirmed", edit_revision: 7, order_date: "2026-11-12", expected_delivery_date: "2026-11-19",
  total_ht_cents: 10216, total_tax_cents: 2043, total_ttc_cents: 12259,
};

function tables(): FakeTables {
  return {
    tenant_memberships: [fakeMembership(AUTHOR, TENANT, "engineer"), fakeMembership(OTHER, TENANT, "engineer")],
    // Only the author's order is visible: the order policy shows a member their own orders (an admin all of them).
    purchase_orders: [{ id: ORDER, tenant_id: TENANT, user_id: AUTHOR, status: "draft", project_id: "30000000-0000-4000-8000-000000000001" }],
  };
}

function signIn(userId: string | null, rpc: Record<string, unknown> = {}) {
  const fake = createFakeSupabase({ userId, tables: tables(), rpc });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

function post(route: typeof confirmationRoute | typeof receptionRoute, orderId: string, body: unknown) {
  return route.POST(
    new Request(`http://localhost/api/purchase-orders/${orderId}/x`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: orderId }) },
  );
}

const confirmation = {
  expected_revision: 4,
  ordered_on: "2026-11-12",
  expected_delivery_date: "2026-11-19",
  supplier_reference: "  AR-4471 ",
  document_id: DOCUMENT,
  lines: [
    { id: ITEM_SCREWS, unit_price_ht_cents: 352, price_per: 100 },
    { id: ITEM_ELBOWS, unit_price_ht_cents: 1234, price_per: 1 },
  ],
};

function refusing(code: string, message: string): FakeRpcHandler {
  return () => ({ data: null, error: { code, message } });
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

describe("POST /api/purchase-orders/[id]/confirmation", () => {
  it.each([
    ["without a revision", { ...confirmation, expected_revision: undefined }],
    ["with an unknown field", { ...confirmation, surprise: true }],
    ["with a price that is not whole cents", { ...confirmation, lines: [{ id: ITEM_SCREWS, unit_price_ht_cents: 35.2, price_per: 100 }] }],
    ["with an unknown lot", { ...confirmation, lines: [{ id: ITEM_SCREWS, unit_price_ht_cents: 352, price_per: 7 }] }],
    ["with a negative price", { ...confirmation, lines: [{ id: ITEM_SCREWS, unit_price_ht_cents: -1, price_per: 1 }] }],
    ["with a proof that is not a UUID", { ...confirmation, document_id: "facture.pdf" }],
    ["without a proof", { ...confirmation, document_id: undefined }],
    ["with a date that is not AAAA-MM-JJ", { ...confirmation, ordered_on: "12/11/2026" }],
    ["with an overlong supplier reference", { ...confirmation, supplier_reference: "R".repeat(121) }],
  ])("refuses a body %s before the database (400)", async (_case, body) => {
    const fake = signIn(AUTHOR, { confirm_material_request_purchase_order: confirmed });
    const response = await post(confirmationRoute, ORDER, body);
    expect(response.status).toBe(400);
    expect(fake.rpcCalls).not.toContain("confirm_material_request_purchase_order");
  });

  it("answers 401 to a signed-out call", async () => {
    const fake = signIn(null, { confirm_material_request_purchase_order: confirmed });
    const response = await post(confirmationRoute, ORDER, confirmation);
    expect(response.status).toBe(401);
    expect(fake.rpcCalls).not.toContain("confirm_material_request_purchase_order");
  });

  it("answers 404 for an order the caller cannot read, without calling the function", async () => {
    const fake = signIn(AUTHOR, { confirm_material_request_purchase_order: confirmed });
    const response = await post(confirmationRoute, HIDDEN_ORDER, confirmation);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { message: "Bon de commande introuvable." } });
    expect(fake.rpcCalls).not.toContain("confirm_material_request_purchase_order");
  });

  it("gives the function the order, the revision and the confirmation, the reference trimmed", async () => {
    const fake = signIn(AUTHOR, { confirm_material_request_purchase_order: confirmed });
    const response = await post(confirmationRoute, ORDER, confirmation);
    expect(response.status).toBe(200);
    expect(fake.rpcArgs.find((call) => call.name === "confirm_material_request_purchase_order")?.args).toEqual({
      p_order_id: ORDER,
      p_expected_revision: 4,
      p_confirmation: {
        ordered_on: "2026-11-12",
        expected_delivery_date: "2026-11-19",
        supplier_reference: "AR-4471",
        document_id: DOCUMENT,
        lines: confirmation.lines,
      },
    });
  });

  it("sends a blank supplier reference as null and leaves out a delivery date not given", async () => {
    const fake = signIn(AUTHOR, { confirm_material_request_purchase_order: confirmed });
    await post(confirmationRoute, ORDER, { ...confirmation, supplier_reference: "   ", expected_delivery_date: undefined });
    const sent = fake.rpcArgs.find((call) => call.name === "confirm_material_request_purchase_order")?.args.p_confirmation;
    expect(sent).toEqual({ ordered_on: "2026-11-12", supplier_reference: null, document_id: DOCUMENT, lines: confirmation.lines });
  });

  it("answers the confirmed order with the contract's fields only", async () => {
    signIn(AUTHOR, { confirm_material_request_purchase_order: { ...confirmed, internal: "x" } });
    const response = await post(confirmationRoute, ORDER, confirmation);
    expect(await response.json()).toEqual({ ok: true, data: confirmed });
  });

  // Review: the delivery date column holds text, and the draft editor writes « TBD » for « À déterminer ».
  it("answers a confirmed order whose delivery date is still to be determined", async () => {
    signIn(AUTHOR, { confirm_material_request_purchase_order: { ...confirmed, expected_delivery_date: "TBD" } });
    const response = await post(confirmationRoute, ORDER, { ...confirmation, expected_delivery_date: undefined });
    expect([response.status, await response.json()]).toEqual([200, { ok: true, data: { ...confirmed, expected_delivery_date: "TBD" } }]);
  });

  it("does not pass on a malformed answer as complete (500)", async () => {
    signIn(AUTHOR, { confirm_material_request_purchase_order: { id: ORDER, status: "confirmed" } });
    const response = await post(confirmationRoute, ORDER, confirmation);
    expect(response.status).toBe(500);
  });

  it.each([
    ["42501", "PURCHASE_ORDER_ACCESS_DENIED", 403, "FORBIDDEN",
      "Seuls l’auteur du bon et les administrateurs peuvent le confirmer."],
    ["22023", "PURCHASE_ORDER_AFFAIRE_ONLY", 422, "PURCHASE_ORDER_AFFAIRE_ONLY",
      "Seul un bon de commande d’une affaire se confirme ainsi : changez le statut de ce bon."],
    ["55000", "PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT", 409, "PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT",
      "Ce bon n’est plus un brouillon : rechargez la page."],
    ["40001", "PURCHASE_ORDER_REVISION_CONFLICT", 409, "PURCHASE_ORDER_REVISION_CONFLICT",
      "Ce bon a été modifié entre-temps : rechargez la page, puis confirmez de nouveau."],
    ["22023", "PURCHASE_ORDER_CONFIRMATION_DATE_INVALID", 422, "PURCHASE_ORDER_CONFIRMATION_DATE_INVALID",
      "La commande ne peut pas être passée dans le futur, ni livrée avant d’être passée."],
    ["22023", "PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED", 422, "PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED",
      "Joignez la confirmation du fournisseur (bon, e-mail ou capture) pour confirmer la commande."],
    ["22023", "PURCHASE_ORDER_ITEMS_INVALID", 409, "PURCHASE_ORDER_ITEMS_INVALID",
      "Une ligne n’appartient plus à ce bon : rechargez la page."],
    ["22023", "PURCHASE_ORDER_CONFIRMATION_EMPTY", 422, "PURCHASE_ORDER_CONFIRMATION_EMPTY",
      "Ce bon n’a aucun article à commander."],
    ["23514", "PURCHASE_ORDER_TOTAL_NEGATIVE", 422, "PURCHASE_ORDER_TOTAL_NEGATIVE",
      "Les remises dépassent le montant des articles : vérifiez les prix."],
    ["22023", "PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE", 422, "PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE",
      "Le montant d’une ligne dépasse la capacité d’une commande : vérifiez sa quantité et son prix."],
  ])("answers %s %s with its status and a sentence", async (sqlstate, message, status, code, sentence) => {
    signIn(AUTHOR, { confirm_material_request_purchase_order: refusing(sqlstate, message) });
    const response = await post(confirmationRoute, ORDER, confirmation);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, error: { code, message: sentence } });
  });

  it("never shows an unknown database message", async () => {
    signIn(AUTHOR, { confirm_material_request_purchase_order: refusing("XX000", "secret internal detail") });
    const response = await post(confirmationRoute, ORDER, confirmation);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("secret internal detail");
  });
});

describe("POST /api/purchase-orders/[id]/reception", () => {
  const reception = { expected_revision: 7, received_on: "2026-11-18", note: "  Reliquat : 500 vis à suivre " };
  const received = { id: ORDER, status: "received", edit_revision: 8 };

  it.each([
    ["without a revision", { received_on: "2026-11-18" }],
    ["without a date", { expected_revision: 7 }],
    ["with a date that is not AAAA-MM-JJ", { ...reception, received_on: "18/11/2026" }],
    ["with an overlong note", { ...reception, note: "n".repeat(2001) }],
    ["with an unknown field", { ...reception, partial: true }],
  ])("refuses a body %s before the database (400)", async (_case, body) => {
    const fake = signIn(AUTHOR, { receive_material_request_purchase_order: received });
    const response = await post(receptionRoute, ORDER, body);
    expect(response.status).toBe(400);
    expect(fake.rpcCalls).not.toContain("receive_material_request_purchase_order");
  });

  it("answers 404 for an order the caller cannot read", async () => {
    const fake = signIn(AUTHOR, { receive_material_request_purchase_order: received });
    const response = await post(receptionRoute, HIDDEN_ORDER, reception);
    expect(response.status).toBe(404);
    expect(fake.rpcCalls).not.toContain("receive_material_request_purchase_order");
  });

  it("gives the function the date and the trimmed note, and answers the received order", async () => {
    const fake = signIn(AUTHOR, { receive_material_request_purchase_order: received });
    const response = await post(receptionRoute, ORDER, reception);
    expect(fake.rpcArgs.find((call) => call.name === "receive_material_request_purchase_order")?.args).toEqual({
      p_order_id: ORDER, p_expected_revision: 7, p_reception: { received_on: "2026-11-18", note: "Reliquat : 500 vis à suivre" },
    });
    expect([response.status, await response.json()]).toEqual([200, { ok: true, data: received }]);
  });

  it("sends a blank note as null", async () => {
    const fake = signIn(AUTHOR, { receive_material_request_purchase_order: received });
    await post(receptionRoute, ORDER, { ...reception, note: "  " });
    expect(fake.rpcArgs.find((call) => call.name === "receive_material_request_purchase_order")?.args.p_reception)
      .toEqual({ received_on: "2026-11-18", note: null });
  });

  it.each([
    ["55000", "PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED", 409, "PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED",
      "Seul un bon confirmé peut être reçu : rechargez la page."],
    ["22023", "PURCHASE_ORDER_RECEPTION_DATE_INVALID", 422, "PURCHASE_ORDER_RECEPTION_DATE_INVALID",
      "La réception se date entre le jour de la commande et aujourd’hui."],
    ["40001", "PURCHASE_ORDER_REVISION_CONFLICT", 409, "PURCHASE_ORDER_REVISION_CONFLICT",
      "Ce bon a été modifié entre-temps : rechargez la page, puis enregistrez de nouveau la réception."],
    ["42501", "PURCHASE_ORDER_ACCESS_DENIED", 403, "FORBIDDEN",
      "Seuls l’auteur du bon et les administrateurs peuvent enregistrer sa réception."],
  ])("answers %s %s with its status and a sentence", async (sqlstate, message, status, code, sentence) => {
    signIn(AUTHOR, { receive_material_request_purchase_order: refusing(sqlstate, message) });
    const response = await post(receptionRoute, ORDER, reception);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, error: { code, message: sentence } });
  });
});
