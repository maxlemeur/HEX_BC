import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({ Resend: class { emails = { send: provider }; } }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase/service-role")>(),
  createServiceRoleClient: vi.fn(),
}));

import * as sendRoute from "@/app/api/purchase-orders/[id]/send/route";
import {
  createFakeSupabase,
  fakeMembership,
  type FakeRpcHandler,
  type FakeTables,
} from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Failure modes of the send of a purchase order to its supplier by e-mail, written before the route. Members, orders,
 * suppliers and addresses are fictional; the two database functions are played as pgTAP proves them
 * (purchase-order-sends.test.sql: rights, claim, settlement, lifecycle), the e-mail provider is played at its SDK.
 *  1. Body: a call without a revision or a key, with an unknown field, two recipients, a line break in the subject or
 *     an overlong message reaches the database or the provider.
 *  2. Scope: an order the caller cannot read is reached instead of answering 404; a signed-out call is not 401.
 *  3. Configuration: without a provider key, a sender, a readable routing or a test mailbox, something is claimed or
 *     sent, or the refusal does not say what to fix.
 *  4. Recipient: a supplier without address and no recipient typed is sent somewhere, or refused without saying why.
 *  5. A screen older than the order sends the newer content, or claims anything.
 *  6. Redirect mode (the default): the supplier receives the message; the test mailbox does not, or without the
 *     supplier named in its subject; the send is not recorded as written and as redirected; the test mailbox is
 *     answered to the browser. Live mode: the supplier does not receive it as written.
 *  7. The message leaves without the order as a PDF, without the idempotency key of its claim, or without the issuer
 *     as reply address.
 *  8. A replayed request, a send in flight or an unconfirmed earlier send calls the provider again.
 *  9. A refusal of the provider marks the order sent or leaves the claim open; a transient refusal is not tried again
 *     with the same key, or sends twice; a provider that does not answer is recorded as refused (the message may have
 *     left) or as sent.
 * 10. The acceptance is not settled by the application server's own client, or a settlement that fails is answered
 *     as a success or as a plain failure (the message left).
 * 11. A refusal of the database answers its raw message.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const AUTHOR = "20000000-0000-4000-8000-000000000001";
const ADMIN = "20000000-0000-4000-8000-000000000002";
const ORDER = "50000000-0000-4000-8000-000000000001";
const NO_EMAIL_ORDER = "50000000-0000-4000-8000-000000000003";
const HIDDEN_ORDER = "50000000-0000-4000-8000-000000000002";
const KEY = "60000000-0000-4000-8000-000000000001";
const VARIABLES = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_DELIVERY_MODE", "EMAIL_REDIRECT_TO", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"] as const;

function order(id: string, supplierEmail: string | null) {
  return {
    id, tenant_id: TENANT, user_id: AUTHOR, status: "draft", edit_revision: 4, reference: "C-2611-007", order_number: 7,
    order_date: "2026-11-14", expected_delivery_date: "2026-11-20", notes: "Livrer avant 10 h.",
    total_ht_cents: 4936, total_tax_cents: 987, total_ttc_cents: 5923, currency: "EUR",
    project_id: "30000000-0000-4000-8000-000000000001", delivery_mode: "site",
    estimate_projects: { name: "Affaire inventée", site_address: "1 rue de l'Essai, 75000 Paris" },
    suppliers: { name: "Fournisseur Alpha", address: "2 rue du Test", city: "Lyon", postal_code: "69000", email: supplierEmail,
      phone: null, contact_name: "Camille Essai" },
    delivery_sites: null,
    profiles: { full_name: "Dominique Auteur", job_title: "Chargé d'affaires", phone: null, work_email: "auteur@entreprise.invalid" },
    purchase_order_items: [{
      id: "52000000-0000-4000-8000-000000000001", designation: "Coude 90° inox DN 50", reference: "ALP-501", quantity: 4,
      unit: "u", price_unit: "u", unit_price_ht_cents: 1234, tax_rate_bp: 2000, line_total_ht_cents: 4936, position: 1,
      line_kind: "article", price_per: 1,
    }],
  };
}

function tables(): FakeTables {
  return {
    tenant_memberships: [fakeMembership(AUTHOR, TENANT, "engineer"), fakeMembership(ADMIN, TENANT, "admin")],
    profiles: [
      { id: AUTHOR, full_name: "Dominique Auteur", work_email: "auteur@entreprise.invalid" },
      { id: ADMIN, full_name: "Claude Admin", work_email: "admin@entreprise.invalid" },
    ],
    purchase_orders: [order(ORDER, "commandes@alpha.invalid"), order(NO_EMAIL_ORDER, null)],
    purchase_order_items: [
      { id: "52000000-0000-4000-8000-000000000001", purchase_order_id: ORDER },
      { id: "52000000-0000-4000-8000-000000000002", purchase_order_id: NO_EMAIL_ORDER },
    ],
  };
}

function sendRow(args: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  const send = args.p_send as Record<string, unknown>;
  return {
    id: send.id, purchase_order_id: args.p_order_id, order_revision: args.p_expected_revision, recipient: send.recipient,
    subject: send.subject, message: send.message, redirected: send.redirected, status: "sending", provider_message_id: null,
    failure_code: null, requested_by: AUTHOR, requested_by_name: "Dominique Auteur", requested_at: "2026-11-14T09:30:00+00:00",
    settled_at: null, ...patch,
  };
}

const claim: FakeRpcHandler = (args) => ({ data: { state: "claimed", send: sendRow(args) } });
const settle: FakeRpcHandler = (args) => {
  const outcome = args.p_outcome as { status: string; provider_message_id?: string; failure_code?: string };
  return { data: {
    send: { id: args.p_send_id, purchase_order_id: ORDER, order_revision: 4, recipient: "commandes@alpha.invalid",
      subject: "Bon de commande C-2611-007", message: "Bonjour", redirected: true, status: outcome.status,
      provider_message_id: outcome.provider_message_id ?? null, failure_code: outcome.failure_code ?? null, requested_by: AUTHOR,
      requested_by_name: "Dominique Auteur", requested_at: "2026-11-14T09:30:00+00:00", settled_at: "2026-11-14T09:30:02+00:00" },
    order: { id: ORDER, status: outcome.status === "sent" ? "sent" : "draft", edit_revision: outcome.status === "sent" ? 5 : 4 },
  } };
};

function signIn(userId: string | null, options: { begin?: unknown; finish?: unknown } = {}) {
  const member = createFakeSupabase({ userId, tables: tables(), rpc: { begin_purchase_order_send: options.begin ?? claim } });
  const server = createFakeSupabase({ userId: null, tables: {}, rpc: { finish_purchase_order_send: options.finish ?? settle } });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(member.supabase as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(server.supabase as never);
  return { member, server };
}

function post(orderId: string, body: unknown) {
  return sendRoute.POST(
    new Request(`http://localhost/api/purchase-orders/${orderId}/send`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: orderId }) },
  );
}

const request = {
  expected_revision: 4,
  idempotency_key: KEY,
  recipient: "commandes@alpha.invalid",
  subject: "Bon de commande C-2611-007",
  message: "Bonjour,\n\nVeuillez trouver notre bon de commande.",
};

async function refusal(response: Response) {
  const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } };
  return { status: response.status, code: body.error.code, message: body.error.message };
}

describe("POST /api/purchase-orders/{id}/send", () => {
  beforeEach(() => {
    provider.mockReset().mockResolvedValue({ data: { id: "re_accepted_1" }, error: null });
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "Achats <achats@entreprise.invalid>";
    delete process.env.EMAIL_DELIVERY_MODE;
    process.env.EMAIL_REDIRECT_TO = "recette@test.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });
  afterEach(() => {
    for (const name of VARIABLES) delete process.env[name];
    vi.useRealTimers();
  });

  it.each([
    ["no revision", { ...request, expected_revision: undefined }],
    ["no key", { ...request, idempotency_key: undefined }],
    ["a key that is no UUID", { ...request, idempotency_key: "abc" }],
    ["an unknown field", { ...request, cc: "copie@alpha.invalid" }],
    ["two recipients", { ...request, recipient: "a@alpha.invalid, b@alpha.invalid" }],
    ["a line break in the subject", { ...request, subject: "Bon\nBcc: b@alpha.invalid" }],
    ["an empty subject", { ...request, subject: "   " }],
    ["an overlong message", { ...request, message: "a".repeat(5001) }],
  ])("1 refuses a body with %s before anything is claimed or sent", async (_label, body) => {
    const { member } = signIn(AUTHOR);
    const response = await post(ORDER, body);
    expect(response.status).toBe(400);
    expect(member.rpcCalls).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("2 answers 404 for an order the caller cannot read, and 401 signed out", async () => {
    const { member } = signIn(AUTHOR);
    expect((await post(HIDDEN_ORDER, request)).status).toBe(404);
    expect(member.rpcCalls).toEqual([]);
    signIn(null);
    expect((await post(ORDER, request)).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ["RESEND_API_KEY", () => { delete process.env.RESEND_API_KEY; }, "EMAIL_PROVIDER_NOT_CONFIGURED"],
    ["EMAIL_FROM", () => { delete process.env.EMAIL_FROM; }, "EMAIL_PROVIDER_NOT_CONFIGURED"],
    // Without it the provider's acceptance could not be recorded: the message would leave at every try.
    ["SUPABASE_SERVICE_ROLE_KEY", () => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; }, "EMAIL_PROVIDER_NOT_CONFIGURED"],
    ["EMAIL_REDIRECT_TO", () => { delete process.env.EMAIL_REDIRECT_TO; }, "EMAIL_REDIRECT_NOT_CONFIGURED"],
    ["EMAIL_DELIVERY_MODE", () => { process.env.EMAIL_DELIVERY_MODE = "prod"; }, "EMAIL_DELIVERY_MODE_INVALID"],
  ])("3 names %s when it keeps the order from being sent, and claims nothing", async (variable, breakIt, code) => {
    breakIt();
    const { member } = signIn(AUTHOR);
    const answer = await refusal(await post(ORDER, request));
    expect(answer).toMatchObject({ status: 503, code });
    expect(answer.message).toContain(variable);
    expect(answer.message).toContain("brouillon");
    expect(member.rpcCalls).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("4 says to give the supplier an address when none is typed and its record has none", async () => {
    const { member } = signIn(AUTHOR);
    const answer = await refusal(await post(NO_EMAIL_ORDER, { ...request, recipient: "" }));
    expect(answer).toMatchObject({ status: 422, code: "PURCHASE_ORDER_SEND_NO_RECIPIENT" });
    expect(answer.message).toContain("Fournisseur Alpha");
    expect(answer.message).toContain("adresse e-mail");
    expect(member.rpcCalls).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("4 sends to the supplier's own address when none is typed", async () => {
    process.env.EMAIL_DELIVERY_MODE = "live";
    const { member } = signIn(AUTHOR);
    const response = await post(ORDER, { ...request, recipient: undefined });
    expect(response.status).toBe(200);
    expect(member.rpcArgs[0]!.args.p_send).toMatchObject({ recipient: "commandes@alpha.invalid" });
    expect(provider.mock.calls[0]![0]).toMatchObject({ to: "commandes@alpha.invalid" });
  });

  it("5 lets the database refuse a screen older than the order, and sends nothing", async () => {
    const { member, server } = signIn(AUTHOR, { begin: (() => ({ data: null,
      error: { code: "40001", message: "PURCHASE_ORDER_REVISION_CONFLICT" } })) satisfies FakeRpcHandler });
    const answer = await refusal(await post(ORDER, { ...request, expected_revision: 3 }));
    expect(answer).toMatchObject({ status: 409, code: "PURCHASE_ORDER_REVISION_CONFLICT" });
    expect(member.rpcCalls).toEqual(["begin_purchase_order_send"]);
    expect(provider).not.toHaveBeenCalled();
    expect(server.rpcCalls).toEqual([]);
  });

  it("5 sends nothing, and closes its claim, when the order changes between its reading and its claim", async () => {
    // The screen is older than the order (revision 3 against 4), yet the database claims: the order moved in between.
    const { server } = signIn(AUTHOR);
    const answer = await refusal(await post(ORDER, { ...request, expected_revision: 3 }));
    expect(answer).toMatchObject({ status: 409, code: "PURCHASE_ORDER_REVISION_CONFLICT" });
    expect(provider).not.toHaveBeenCalled();
    expect(server.rpcArgs).toEqual([{ name: "finish_purchase_order_send", args: {
      p_send_id: KEY, p_outcome: { status: "failed", failure_code: "order_changed_before_claim" } } }]);
  });

  it("8 answers a request replayed from a screen older than the sent order", async () => {
    // The answer of the first request was lost: the screen still holds the draft's revision, the order is sent since.
    const { member } = signIn(AUTHOR, { begin: ((args) => ({ data: { state: "sent", send: sendRow(args, {
      status: "sent", provider_message_id: "re_accepted_1", settled_at: "2026-11-14T09:30:02+00:00" }) } })) satisfies FakeRpcHandler });
    Object.assign(member.tables.purchase_orders![0]!, { status: "sent", edit_revision: 5 });
    const response = await post(ORDER, request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { replayed: true, order: { id: ORDER, status: "sent", edit_revision: 5 } } });
    expect(provider).not.toHaveBeenCalled();
  });

  it("6 redirects to the test mailbox by default, the supplier named in the subject, and records the send as written", async () => {
    const { member, server } = signIn(AUTHOR);
    const response = await post(ORDER, request);

    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    const [message, options] = provider.mock.calls[0]! as [Record<string, unknown>, Record<string, unknown>];
    expect(message).toMatchObject({
      from: "Achats <achats@entreprise.invalid>",
      to: "recette@test.invalid",
      subject: "[TEST → commandes@alpha.invalid] Bon de commande C-2611-007",
      replyTo: "auteur@entreprise.invalid",
    });
    expect(message.cc).toBeUndefined();
    expect(JSON.stringify(message)).not.toContain("\"to\":\"commandes@alpha.invalid\"");
    // 7. The order as a PDF, and the key of the claim.
    const attachments = message.attachments as Array<{ filename: string; content: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toBe("Bon_de_commande_C-2611-007.pdf");
    expect(Buffer.from(attachments[0]!.content, "base64").subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(options).toEqual({ idempotencyKey: `purchase-order-send/${KEY}` });
    expect(String(message.text)).toContain("Veuillez trouver notre bon de commande.");
    expect(String(message.html)).toContain("Veuillez trouver notre bon de commande.");

    // The claim, by the member: what the user wrote, and that it is redirected.
    expect(member.rpcArgs).toEqual([{ name: "begin_purchase_order_send", args: {
      p_order_id: ORDER, p_expected_revision: 4,
      p_send: { id: KEY, recipient: "commandes@alpha.invalid", subject: "Bon de commande C-2611-007",
        message: "Bonjour,\n\nVeuillez trouver notre bon de commande.", redirected: true },
    } }]);
    // 10. The settlement, by the application server.
    expect(server.rpcArgs).toEqual([{ name: "finish_purchase_order_send", args: {
      p_send_id: KEY, p_outcome: { status: "sent", provider_message_id: "re_accepted_1" },
    } }]);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: {
      replayed: false,
      order: { id: ORDER, status: "sent", edit_revision: 5 },
      send: { id: KEY, status: "sent", recipient: "commandes@alpha.invalid", subject: "Bon de commande C-2611-007",
        redirected: true, requested_by_name: "Dominique Auteur", requested_at: "2026-11-14T09:30:00+00:00",
        settled_at: "2026-11-14T09:30:02+00:00" },
    } });
    expect(JSON.stringify(body)).not.toContain("recette@test.invalid");
  });

  it("6 reaches the supplier as written when delivery is live", async () => {
    process.env.EMAIL_DELIVERY_MODE = "live";
    delete process.env.EMAIL_REDIRECT_TO;
    const { member } = signIn(AUTHOR);
    expect((await post(ORDER, request)).status).toBe(200);
    expect(provider.mock.calls[0]![0]).toMatchObject({ to: "commandes@alpha.invalid", subject: "Bon de commande C-2611-007" });
    expect(member.rpcArgs[0]!.args.p_send).toMatchObject({ redirected: false });
  });

  it("8 answers a replayed request with what was sent, without calling the provider", async () => {
    const { server } = signIn(AUTHOR, { begin: ((args) => ({ data: { state: "sent", send: sendRow(args, {
      status: "sent", provider_message_id: "re_accepted_1", settled_at: "2026-11-14T09:30:02+00:00" }) } })) satisfies FakeRpcHandler });
    const response = await post(ORDER, request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { replayed: true, send: { id: KEY, status: "sent" } } });
    expect(provider).not.toHaveBeenCalled();
    expect(server.rpcCalls).toEqual([]);
  });

  it("8 refuses a second request while a send is in flight", async () => {
    const { server } = signIn(AUTHOR, { begin: (() => ({ data: null,
      error: { code: "55006", message: "PURCHASE_ORDER_SEND_IN_PROGRESS" } })) satisfies FakeRpcHandler });
    const answer = await refusal(await post(ORDER, request));
    expect(answer).toMatchObject({ status: 409, code: "PURCHASE_ORDER_SEND_IN_PROGRESS" });
    expect(answer.message).toContain("en cours");
    expect(provider).not.toHaveBeenCalled();
    expect(server.rpcCalls).toEqual([]);
  });

  it("8 names an earlier send that was never confirmed instead of sending again", async () => {
    signIn(AUTHOR, { begin: ((args) => ({ data: { state: "unconfirmed", send: sendRow(args, {
      id: "60000000-0000-4000-8000-000000000009", status: "unconfirmed", failure_code: "SEND_ABANDONED",
      recipient: "ancien@alpha.invalid", requested_at: "2026-11-14T08:05:00+00:00", settled_at: "2026-11-14T09:30:00+00:00" }) } })) satisfies FakeRpcHandler });
    const answer = await refusal(await post(ORDER, request));
    expect(answer).toMatchObject({ status: 409, code: "PURCHASE_ORDER_SEND_UNCONFIRMED" });
    expect(answer.message).toContain("ancien@alpha.invalid");
    expect(answer.message).toContain("14/11/2026 à 09:05");
    expect(provider).not.toHaveBeenCalled();
  });

  it("9 records a refusal of the provider as failed and leaves the order a draft", async () => {
    provider.mockResolvedValue({ data: null, error: { name: "validation_error", message: "The from address is not verified.", statusCode: 422 } });
    const { server } = signIn(AUTHOR);
    const answer = await refusal(await post(ORDER, request));
    expect(answer).toMatchObject({ status: 503, code: "PURCHASE_ORDER_SEND_REFUSED" });
    expect(answer.message).toContain("brouillon");
    expect(answer.message).not.toContain("not verified");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(server.rpcArgs).toEqual([{ name: "finish_purchase_order_send", args: {
      p_send_id: KEY, p_outcome: { status: "failed", failure_code: "validation_error" } } }]);
  });

  it("9 tries a transient refusal again with the same key, and records one send", async () => {
    vi.useFakeTimers();
    provider.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 } });
    const { server } = signIn(AUTHOR);
    const pending = post(ORDER, request);
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[0]![1]).toEqual(provider.mock.calls[1]![1]);
    expect(provider.mock.calls[0]![0]).toEqual(provider.mock.calls[1]![0]);
    expect(server.rpcArgs).toHaveLength(1);
    expect(server.rpcArgs[0]!.args.p_outcome).toEqual({ status: "sent", provider_message_id: "re_accepted_1" });
  });

  it("9 records a provider that keeps refusing for its rate as failed: nothing left", async () => {
    vi.useFakeTimers();
    provider.mockResolvedValue({ data: null, error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 } });
    const { server } = signIn(AUTHOR);
    const pending = post(ORDER, request);
    await vi.runAllTimersAsync();
    expect(await refusal(await pending)).toMatchObject({ status: 503, code: "PURCHASE_ORDER_SEND_REFUSED" });
    expect(provider).toHaveBeenCalledTimes(3);
    expect(server.rpcArgs[0]!.args.p_outcome).toEqual({ status: "failed", failure_code: "rate_limit_exceeded" });
  });

  it("7 gives the supplier the member who sends to answer, not the order's author", async () => {
    signIn(ADMIN);
    expect((await post(ORDER, request)).status).toBe(200);
    expect(provider.mock.calls[0]![0]).toMatchObject({ replyTo: "admin@entreprise.invalid" });
    expect(String(provider.mock.calls[0]![0].text)).toContain("Claude Admin (admin@entreprise.invalid)");
  });

  it("9 records as unconfirmed a refusal that follows an attempt without answer", async () => {
    vi.useFakeTimers();
    provider.mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue({ data: null, error: { name: "validation_error", message: "Invalid", statusCode: 422 } });
    const { server } = signIn(AUTHOR);
    const pending = post(ORDER, request);
    await vi.runAllTimersAsync();
    expect(await refusal(await pending)).toMatchObject({ status: 503, code: "PURCHASE_ORDER_SEND_UNCONFIRMED" });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(server.rpcArgs[0]!.args.p_outcome).toEqual({ status: "unconfirmed", failure_code: "validation_error" });
  });

  it("9 records as unconfirmed a provider that never answers", async () => {
    vi.useFakeTimers();
    provider.mockReturnValue(new Promise(() => undefined));
    const { server } = signIn(AUTHOR);
    const pending = post(ORDER, request);
    await vi.runAllTimersAsync();
    expect(await refusal(await pending)).toMatchObject({ status: 503, code: "PURCHASE_ORDER_SEND_UNCONFIRMED" });
    expect(provider).toHaveBeenCalledTimes(3);
    expect(server.rpcArgs[0]!.args.p_outcome).toEqual({ status: "unconfirmed", failure_code: "provider_unreachable" });
  });

  it.each([
    ["answers nothing usable", () => provider.mockResolvedValue({ data: null, error: { name: "application_error", message: "Unable to fetch data.", statusCode: null } }), 3, "application_error"],
    ["throws", () => provider.mockRejectedValue(new Error("socket hang up")), 3, "provider_unreachable"],
    ["refuses the key for another content", () => provider.mockResolvedValue({ data: null, error: { name: "invalid_idempotent_request", message: "Same key, other payload", statusCode: 409 } }), 1, "invalid_idempotent_request"],
  ])("9 records a provider that %s as unconfirmed: the message may have left", async (_label, arrange, calls, code) => {
    vi.useFakeTimers();
    arrange();
    const { server } = signIn(AUTHOR);
    const pending = post(ORDER, request);
    await vi.runAllTimersAsync();
    const answer = await refusal(await pending);
    expect(answer).toMatchObject({ status: 503, code: "PURCHASE_ORDER_SEND_UNCONFIRMED" });
    expect(answer.message).toContain("commandes@alpha.invalid");
    expect(provider).toHaveBeenCalledTimes(calls);
    expect(server.rpcArgs[0]!.args.p_outcome).toEqual({ status: "unconfirmed", failure_code: code });
  });

  it("10 says the message left when its acceptance cannot be recorded", async () => {
    vi.useFakeTimers();
    const { server } = signIn(AUTHOR, { finish: (() => ({ data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" } })) satisfies FakeRpcHandler });
    const pending = post(ORDER, request);
    await vi.runAllTimersAsync();
    const answer = await refusal(await pending);
    expect(answer).toMatchObject({ status: 500, code: "PURCHASE_ORDER_SEND_RECORD_FAILED" });
    expect(answer.message).toContain("parti");
    expect(answer.message).toContain("Ne le renvoyez pas");
    expect(answer.message).not.toContain("statement");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(server.rpcCalls.length).toBeGreaterThan(1);
  });

  it.each([
    ["PURCHASE_ORDER_ACCESS_DENIED", "42501", 403, "FORBIDDEN"],
    ["PURCHASE_ORDER_SEND_NOT_DRAFT", "55000", 409, "PURCHASE_ORDER_SEND_NOT_DRAFT"],
    ["PURCHASE_ORDER_REVISION_CONFLICT", "40001", 409, "PURCHASE_ORDER_REVISION_CONFLICT"],
    ["PURCHASE_ORDER_SEND_EMPTY", "22023", 422, "PURCHASE_ORDER_SEND_EMPTY"],
    ["PURCHASE_ORDER_SEND_KEY_SPENT", "23505", 409, "PURCHASE_ORDER_SEND_KEY_SPENT"],
    ["relation \"public.secret\" does not exist", "42P01", 500, "INTERNAL_ERROR"],
  ])("11 answers the database refusal %s with a sentence of its own", async (message, sqlstate, status, code) => {
    signIn(AUTHOR, { begin: (() => ({ data: null, error: { code: sqlstate, message } })) satisfies FakeRpcHandler });
    const answer = await refusal(await post(ORDER, request));
    expect(answer).toMatchObject({ status, code });
    expect(answer.message).not.toContain("PURCHASE_ORDER");
    expect(answer.message).not.toContain("secret");
    expect(provider).not.toHaveBeenCalled();
  });
});
