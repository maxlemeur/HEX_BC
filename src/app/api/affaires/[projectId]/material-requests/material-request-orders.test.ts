import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as ordersRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/orders/route";
import * as lineRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/route";
import * as reopenRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/reopen/route";
import * as requestRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/route";
import {
  MATERIAL_REQUEST_LINE_ALREADY_ORDERED,
  MATERIAL_REQUEST_LINE_ORDERED,
  MATERIAL_REQUEST_ORDER_BUSY,
  MATERIAL_REQUEST_ORDER_KEY_TAKEN,
  MATERIAL_REQUEST_ORDER_NOTHING_READY,
  MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE,
  MATERIAL_REQUEST_ORDERED,
  type MaterialRequestOrdersCreated,
  type MaterialRequestOrdersSummary,
} from "@/lib/material-requests/order-contracts";
import {
  createFakeSupabase,
  fakeMembership,
  type FakeRow,
  type FakeRpcHandler,
  type FakeTables,
} from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the purchase orders made from a material request (TI-691, lot 2 « l'achat », delivery 3a), written
 * before the routes. Members, suppliers, lines and prices are fictional; the database functions are played as pgTAP
 * proves them (material-request-purchase-orders.test.sql: grouping, overhead, money, idempotency, a line ordered once).
 *  1. Rights: a viewer, an engineer who does not own the affaire or a member of another tenant reads the summary or
 *     creates orders; a director (who reads the affaire) creates them; the owner and an admin cannot. A refusal still
 *     calls the database function.
 *  2. Scope: a request of another affaire is reached through this URL instead of answering 404.
 *  3. Body: a call without a key, with a key that is not a UUID or with another field reaches the database.
 *  4. Summary: the answer is not the database's (ready, not ready and why, ordered and where, the orders), or a
 *     malformed answer is passed on as if it were complete.
 *  5. Creation: the drafts are not answered with their reference, supplier, number of lines and total, the answer
 *     leaks more than the contract, or a created answer is not 201.
 *  6. Idempotency: the same key sent again creates twice, or is not answered 200 with the same drafts (`replayed`).
 *  7. Nothing ready answers anything but 422 in French; a line ordered meanwhile, a key of another member or a deadlock
 *     answer a bare 400 or 500; an archived supplier is refused without its name.
 *  8. A request whose lines are in an order that stands is deleted, or its originals are removed before the refusal.
 *  9. Coordinator's decision: a line in an order that stands returns to draft, reopened alone or in a selection, or by
 *     an edit of what it says (its zone); the refusal does not name the line and the order; a line whose order is
 *     canceled cannot be reopened; a reopening refused by the database (ordered meanwhile) answers a bare 400.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const ENGINEER = "20000000-0000-4000-8000-000000000003";
const VIEWER = "20000000-0000-4000-8000-000000000004";
const DIRECTOR = "20000000-0000-4000-8000-000000000005";
const OUTSIDER = "20000000-0000-4000-8000-000000000006";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const OTHER_PROJECT = "30000000-0000-4000-8000-000000000002";
const ALPHA = "40000000-0000-4000-8000-000000000001";
const BETA = "40000000-0000-4000-8000-000000000002";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const OTHER_REQUEST = "60000000-0000-4000-8000-000000000002";
const LINE_ELBOW = "70000000-0000-4000-8000-000000000001";
const LINE_SCREWS = "70000000-0000-4000-8000-000000000002";
const LINE_GLOVES = "70000000-0000-4000-8000-000000000003";
const LINE_TUBE = "70000000-0000-4000-8000-000000000004";
const LINE_DRAFT = "70000000-0000-4000-8000-000000000005";
const LINE_NO_SUPPLIER = "70000000-0000-4000-8000-000000000006";
const LINE_UNPRICED = "70000000-0000-4000-8000-000000000007";
const QUOTE_ALPHA = "c0000000-0000-4000-8000-000000000001";
const QUOTE_BETA = "c0000000-0000-4000-8000-000000000002";
const ORIGINAL = "80000000-0000-4000-8000-000000000001";
const KEY = "d0000000-0000-4000-8000-000000000001";
const OTHER_KEY = "d0000000-0000-4000-8000-000000000002";
const ORIGINAL_PATH = `${TENANT}/${PROJECT}/${REQUEST}/${ORIGINAL}/demande.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);

type Role = "admin" | "engineer" | "viewer" | "director";

function line(id: string, position: number, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, position, original_text: null, quantity: 4,
    quantity_doubtful: false, unit: "u", dimension: "DN 50", no_dimension: false, product_type: "Coude 90°",
    material: "Inox 304L", material_precision: null, reference: null, supplier_id: ALPHA, zone: null, imputation: "project",
    overhead_category: null, duplicate_acknowledged: false, status: "validated", validated_at: "2026-11-11T10:00:00.000Z",
    validated_by: OWNER, product_id: null, product_match: null, pre_link_wording: null, unit_price_ht_cents: 1234,
    price_per: 1, price_quote_id: QUOTE_ALPHA, created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z",
    ...extra,
  };
}

const isReady = (row: FakeRow) => row.status === "validated" && row.supplier_id !== null && row.price_quote_id !== null;
const amountOf = (row: FakeRow) => {
  const exact = (Number(row.quantity) * Number(row.unit_price_ht_cents)) / Number(row.price_per);
  return Math.sign(exact) * Math.round(Math.abs(exact));
};

/** Request lines held by an order that is not canceled, with that order (private.material_request_line_orders). */
function heldLines(tables: FakeTables) {
  const orders = new Map((tables.purchase_orders ?? []).map((order) => [order.id, order]));
  return new Map((tables.purchase_order_items ?? [])
    .filter((item) => item.material_request_line_id && orders.get(item.purchase_order_id)?.status !== "canceled")
    .map((item) => [String(item.material_request_line_id), orders.get(item.purchase_order_id) as FakeRow]));
}

/** public.material_request_order_summary, as pgTAP proves it; can_create: a writer of the request who may buy. */
function summaryInDatabase(actor: string): FakeRpcHandler {
  return (args, tables) => {
  const lines = (tables.material_request_lines ?? []).filter((row) => row.request_id === args.p_request_id)
    .sort((left, right) => Number(left.position) - Number(right.position));
  const held = heldLines(tables);
  const reason = (row: FakeRow) => row.status !== "validated" ? "not_validated" : row.supplier_id === null ? "no_supplier" : "not_priced";
  const suppliers = new Map((tables.suppliers ?? []).map((row) => [row.id, row.name]));
  const mine = new Set(lines.map((row) => row.id));
  const orders = (tables.purchase_orders ?? []).filter((order) => (tables.purchase_order_items ?? [])
    .some((item) => item.purchase_order_id === order.id && mine.has(item.material_request_line_id)));
  return {
    data: {
      ready_line_ids: lines.filter((row) => !held.has(String(row.id)) && isReady(row)).map((row) => row.id),
      not_ready: lines.filter((row) => !held.has(String(row.id)) && !isReady(row)).map((row) => ({ line_id: row.id, reason: reason(row) })),
      ordered: lines.filter((row) => held.has(String(row.id))).map((row) => {
        const order = held.get(String(row.id)) as FakeRow;
        return { line_id: row.id, purchase_order_id: order.id, purchase_order_reference: order.reference, status: order.status };
      }),
      orders: orders.map((order) => ({
        id: order.id, reference: order.reference, supplier_name: suppliers.get(order.supplier_id) ?? "", status: order.status,
        total_ht_cents: order.total_ht_cents,
        line_count: (tables.purchase_order_items ?? []).filter((item) => item.purchase_order_id === order.id
          && mine.has(item.material_request_line_id)).length,
      })),
      can_create: canCreate(actor, tables, args.p_request_id),
    },
  };
  };
}

function canCreate(actor: string, tables: FakeTables, requestId: unknown): boolean {
  const role = (tables.tenant_memberships ?? []).find((row) => row.user_id === actor)?.role;
  const request = (tables.material_requests ?? []).find((row) => row.id === requestId);
  const project = (tables.estimate_projects ?? []).find((row) => row.id === request?.project_id);
  return (role === "admin" || (role === "engineer" && project?.user_id === actor));
}

/** public.create_material_request_purchase_orders, as pgTAP proves it: one draft per supplier, idempotent per key. */
function createInDatabase(actor: string): FakeRpcHandler {
  let created = 0;
  const receipts = new Map<string, { actor: string; result: FakeRow }>();
  return (args, tables) => {
    const key = `${args.p_request_id}|${args.p_idempotency_key}`;
    const receipt = receipts.get(key);
    if (receipt) {
      if (receipt.actor !== actor) return { data: null, error: { code: "23505", message: MATERIAL_REQUEST_ORDER_KEY_TAKEN } };
      return { data: { ...receipt.result, replayed: true } };
    }
    const held = heldLines(tables);
    const ready = (tables.material_request_lines ?? [])
      .filter((row) => row.request_id === args.p_request_id && !held.has(String(row.id)) && isReady(row))
      .sort((left, right) => Number(left.position) - Number(right.position));
    if (ready.length === 0) return { data: null, error: { code: "22023", message: MATERIAL_REQUEST_ORDER_NOTHING_READY } };
    const suppliers = (tables.suppliers ?? []).filter((row) => ready.some((entry) => entry.supplier_id === row.id))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
    const archived = suppliers.filter((row) => !row.is_active).map((row) => row.name);
    if (archived.length > 0) {
      return { data: null, error: { code: "23514", message: MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE, details: JSON.stringify(archived) } };
    }
    const orders = suppliers.map((supplier) => {
      created += 1;
      const id = `e0000000-0000-4000-8000-${String(created).padStart(12, "0")}`;
      const lines = ready.filter((row) => row.supplier_id === supplier.id);
      const total = lines.reduce((sum, row) => sum + amountOf(row), 0);
      (tables.purchase_orders ??= []).push({ id, tenant_id: TENANT, reference: `C-2611-${String(100 + created)}`,
        supplier_id: supplier.id, project_id: PROJECT, status: "draft", total_ht_cents: total });
      (tables.purchase_order_items ??= []).push(...lines.map((row) => ({ purchase_order_id: id, material_request_line_id: row.id })));
      return { id, reference: `C-2611-${String(100 + created)}`, supplier_id: supplier.id, supplier_name: supplier.name, status: "draft",
        line_count: lines.length, line_ids: lines.map((row) => row.id), total_ht_cents: total, total_tax_cents: Math.round(total / 5),
        total_ttc_cents: total + Math.round(total / 5) };
    });
    const result = { request_id: args.p_request_id, idempotency_key: args.p_idempotency_key, replayed: false, orders };
    receipts.set(key, { actor, result });
    return { data: result };
  };
}

function seed(actor: string, role: Role, overrides: { rpc?: Record<string, unknown>; tables?: Partial<FakeTables> } = {}) {
  const fake = createFakeSupabase({
    userId: actor,
    rpc: {
      material_request_order_summary: summaryInDatabase(actor),
      create_material_request_purchase_orders: createInDatabase(actor),
      withdraw_material_request_files_for_deletion: ((args, tables) => {
        const rows = (tables.material_request_files ?? []).filter((row) => row.request_id === args.p_request_id);
        for (const row of rows) row.removed_at ??= new Date().toISOString();
        return { data: rows.map((row) => ({ storage_path: row.storage_path })) };
      }) satisfies FakeRpcHandler,
      ...overrides.rpc,
    },
    objects: { [ORIGINAL_PATH]: JPEG },
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      estimate_projects: [
        { id: PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Affaire 1", is_archived: false },
        { id: OTHER_PROJECT, tenant_id: TENANT, user_id: ENGINEER, name: "Affaire 2", is_archived: false },
      ],
      suppliers: [
        { id: ALPHA, tenant_id: TENANT, name: "Négoce Alpha", is_active: true },
        { id: BETA, tenant_id: TENANT, name: "Négoce Beta", is_active: true },
      ],
      material_requests: [
        { id: REQUEST, tenant_id: TENANT, project_id: PROJECT, technician_id: null, requested_on: "2026-11-10", needed_on: null,
          delivery_place: "counter", is_urgent: false, presumed_material: null, material_confirmed: false,
          presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null, created_by: OWNER,
          created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z" },
        { id: OTHER_REQUEST, tenant_id: TENANT, project_id: OTHER_PROJECT, technician_id: null, requested_on: "2026-11-10",
          needed_on: null, delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false,
          presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null, created_by: ENGINEER,
          created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z" },
      ],
      material_request_lines: [
        line(LINE_ELBOW, 1),
        line(LINE_SCREWS, 2, { product_type: "Vis", quantity: 1500, unit_price_ht_cents: 340, price_per: 100 }),
        line(LINE_GLOVES, 3, { product_type: "Gants", imputation: "overhead", overhead_category: "EPI", quantity: 5,
          unit_price_ht_cents: 5, price_per: 10 }),
        line(LINE_TUBE, 4, { product_type: "Tube", quantity: 2.5, unit: "m", supplier_id: BETA, unit_price_ht_cents: 1000,
          price_quote_id: QUOTE_BETA }),
        line(LINE_DRAFT, 5, { status: "draft", validated_at: null, validated_by: null }),
        line(LINE_NO_SUPPLIER, 6, { supplier_id: null, unit_price_ht_cents: null, price_quote_id: null }),
        line(LINE_UNPRICED, 7, { unit_price_ht_cents: null, price_quote_id: null }),
      ],
      material_request_files: [
        { id: ORIGINAL, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, quote_id: null, storage_path: ORIGINAL_PATH,
          file_name: "demande.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_by: OWNER,
          created_at: "2026-11-10T09:05:00.000Z", stored_at: "2026-11-10T09:05:02.000Z", removed_at: null },
      ],
      purchase_orders: [],
      purchase_order_items: [],
      ...overrides.tables,
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await (handler as Handler)(new Request("http://localhost/api/test", init), {
    params: Promise.resolve(params as never),
  });
  const payload = (await response.clone().json()) as { ok: boolean; data?: never; error?: { code: string; message: string; details?: never } };
  return { status: response.status, data: payload?.data as never, error: payload?.error };
}

const inRequest = { projectId: PROJECT, requestId: REQUEST };
const orderFunctions = ["material_request_order_summary", "create_material_request_purchase_orders"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("1. rights and 2. scope", () => {
  it.each([
    ["a viewer", VIEWER, "viewer" as Role, 403],
    ["an engineer who does not own the affaire", ENGINEER, "engineer" as Role, 403],
    ["a member of another tenant", OUTSIDER, "admin" as Role, 404],
  ])("%s neither reads the summary nor creates orders, and no function is called", async (_name, actor, role, status) => {
    const fake = seed(actor, role);
    expect((await call(ordersRoute.GET, "GET", inRequest)).status).toBe(status);
    expect((await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY })).status).toBe(status);
    expect(fake.rpcCalls.filter((name) => orderFunctions.includes(name))).toEqual([]);
  });

  it("a director reads the summary, is told it may not create, and creates nothing", async () => {
    const fake = seed(DIRECTOR, "director");
    const summary = await call(ordersRoute.GET, "GET", inRequest);
    expect([summary.status, (summary.data as MaterialRequestOrdersSummary).can_create]).toEqual([200, false]);
    const created = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    expect([created.status, created.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(fake.rpcCalls).not.toContain("create_material_request_purchase_orders");
  });

  it.each([["the owner", OWNER, "engineer" as Role], ["an admin", ADMIN, "admin" as Role]])("%s creates the drafts", async (_name, actor, role) => {
    seed(actor, role);
    expect((await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY })).status).toBe(201);
  });

  it("a request of another affaire is not found through this URL", async () => {
    const fake = seed(ADMIN, "admin");
    const foreign = { projectId: PROJECT, requestId: OTHER_REQUEST };
    expect((await call(ordersRoute.GET, "GET", foreign)).status).toBe(404);
    expect((await call(ordersRoute.POST, "POST", foreign, { idempotency_key: KEY })).status).toBe(404);
    expect(fake.rpcCalls.filter((name) => orderFunctions.includes(name))).toEqual([]);
  });
});

describe("3. body", () => {
  it.each([
    ["without a key", {}],
    ["with a key that is not a UUID", { idempotency_key: "clic-1" }],
    ["with another field", { idempotency_key: KEY, line_ids: [LINE_ELBOW] }],
  ])("refuses a call %s before the database", async (_name, body) => {
    const fake = seed(OWNER, "engineer");
    const answer = await call(ordersRoute.POST, "POST", inRequest, body);
    expect([answer.status, answer.error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(fake.rpcCalls).not.toContain("create_material_request_purchase_orders");
  });
});

describe("4. summary", () => {
  it("answers where each line stands, in the request's order", async () => {
    const fake = seed(OWNER, "engineer");
    const answer = await call(ordersRoute.GET, "GET", inRequest);
    expect(answer.status).toBe(200);
    expect(answer.data as MaterialRequestOrdersSummary).toEqual({
      ready_line_ids: [LINE_ELBOW, LINE_SCREWS, LINE_GLOVES, LINE_TUBE],
      not_ready: [
        { line_id: LINE_DRAFT, reason: "not_validated" },
        { line_id: LINE_NO_SUPPLIER, reason: "no_supplier" },
        { line_id: LINE_UNPRICED, reason: "not_priced" },
      ],
      ordered: [],
      orders: [],
      can_create: true,
    });
    expect(fake.rpcArgs.find((entry) => entry.name === "material_request_order_summary")?.args).toEqual({ p_request_id: REQUEST });
  });

  it("names the order of each ordered line once the drafts exist", async () => {
    seed(OWNER, "engineer");
    await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    const summary = (await call(ordersRoute.GET, "GET", inRequest)).data as MaterialRequestOrdersSummary;
    expect(summary.ready_line_ids).toEqual([]);
    expect(summary.ordered.map((entry) => [entry.line_id, entry.purchase_order_reference, entry.status])).toEqual([
      [LINE_ELBOW, "C-2611-101", "draft"], [LINE_SCREWS, "C-2611-101", "draft"], [LINE_GLOVES, "C-2611-101", "draft"],
      [LINE_TUBE, "C-2611-102", "draft"],
    ]);
    expect(summary.orders.map((order) => [order.reference, order.supplier_name, order.line_count, order.total_ht_cents])).toEqual([
      ["C-2611-101", "Négoce Alpha", 3, 10039], ["C-2611-102", "Négoce Beta", 1, 2500],
    ]);
  });

  it("does not pass on a malformed answer", async () => {
    seed(OWNER, "engineer", { rpc: { material_request_order_summary: { ready_line_ids: "all" } } });
    expect((await call(ordersRoute.GET, "GET", inRequest)).status).toBe(500);
  });
});

describe("5. creation and 6. idempotency", () => {
  it("creates one draft per supplier and answers exactly the contract, 201", async () => {
    const fake = seed(OWNER, "engineer");
    const answer = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    expect(answer.status).toBe(201);
    expect(answer.data as MaterialRequestOrdersCreated).toEqual({
      replayed: false,
      orders: [
        { id: "e0000000-0000-4000-8000-000000000001", reference: "C-2611-101", supplier_name: "Négoce Alpha", status: "draft",
          line_count: 3, total_ht_cents: 10039 },
        { id: "e0000000-0000-4000-8000-000000000002", reference: "C-2611-102", supplier_name: "Négoce Beta", status: "draft",
          line_count: 1, total_ht_cents: 2500 },
      ],
    });
    expect(fake.rpcArgs.find((entry) => entry.name === "create_material_request_purchase_orders")?.args)
      .toEqual({ p_request_id: REQUEST, p_idempotency_key: KEY });
  });

  it("answers the same drafts, 200 and replayed, when the same key comes again", async () => {
    const fake = seed(OWNER, "engineer");
    const first = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    const again = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    expect(again.status).toBe(200);
    expect(again.data).toEqual({ ...(first.data as MaterialRequestOrdersCreated), replayed: true });
    expect(fake.tables.purchase_orders).toHaveLength(2);
  });
});

describe("7. refusals in French", () => {
  it("answers 422 when no line is ready", async () => {
    seed(OWNER, "engineer");
    await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    const answer = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: OTHER_KEY });
    expect([answer.status, answer.error?.code]).toEqual([422, MATERIAL_REQUEST_ORDER_NOTHING_READY]);
    expect(answer.error?.message).toMatch(/^Aucune ligne de cette demande n’est prête à commander/);
  });

  it("names an archived supplier", async () => {
    seed(OWNER, "engineer", { tables: { suppliers: [
      { id: ALPHA, tenant_id: TENANT, name: "Négoce Alpha", is_active: true },
      { id: BETA, tenant_id: TENANT, name: "Négoce Beta", is_active: false },
    ] } });
    const answer = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    expect([answer.status, answer.error?.code, answer.error?.details]).toEqual([
      422, MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE, { supplier_names: ["Négoce Beta"] },
    ]);
    expect(answer.error?.message).toBe("Le fournisseur Négoce Beta est archivé : réactivez-le avant de commander ses lignes.");
  });

  it.each([
    ["a line ordered meanwhile", { code: "23505", message: MATERIAL_REQUEST_LINE_ALREADY_ORDERED }, 409, MATERIAL_REQUEST_LINE_ALREADY_ORDERED],
    ["a key of another member", { code: "23505", message: MATERIAL_REQUEST_ORDER_KEY_TAKEN }, 409, MATERIAL_REQUEST_ORDER_KEY_TAKEN],
    ["a deadlock", { code: "40P01", message: "deadlock detected" }, 409, MATERIAL_REQUEST_ORDER_BUSY],
    ["a lock wait", { code: "40001", message: "PURCHASE_ORDER_REVISION_CONFLICT" }, 409, MATERIAL_REQUEST_ORDER_BUSY],
    ["a request deleted meanwhile", { code: "P0002", message: "MATERIAL_REQUEST_ORDER_NOT_FOUND" }, 404, "NOT_FOUND"],
    ["rights withdrawn meanwhile", { code: "42501", message: "MATERIAL_REQUEST_ORDER_WRITERS_ONLY" }, 403, "FORBIDDEN"],
  ])("answers %s with a status and a sentence", async (_name, error, status, code) => {
    seed(OWNER, "engineer", { rpc: { create_material_request_purchase_orders: (() => ({ data: null, error })) satisfies FakeRpcHandler } });
    const answer = await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    expect([answer.status, answer.error?.code]).toEqual([status, code]);
    expect(answer.error?.message).not.toMatch(/MATERIAL_REQUEST|PURCHASE_ORDER|deadlock/);
  });
});

describe("8. deleting a request that was ordered", () => {
  it("refuses while an order holds its lines, and keeps its originals", async () => {
    const fake = seed(OWNER, "engineer");
    await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    const answer = await call(requestRoute.DELETE, "DELETE", inRequest);
    expect([answer.status, answer.error?.code]).toEqual([409, MATERIAL_REQUEST_ORDERED]);
    expect(answer.error?.message).toBe("Des lignes de cette demande sont dans les bons de commande C-2611-101, C-2611-102 : annulez-les ou supprimez le brouillon avant de supprimer la demande.");
    expect(fake.storageCalls).toEqual([]);
    expect(fake.tables.material_requests.map((row) => row.id)).toContain(REQUEST);
  });

  it("deletes it once its orders are canceled", async () => {
    const fake = seed(OWNER, "engineer");
    await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    for (const order of fake.tables.purchase_orders) order.status = "canceled";
    expect((await call(requestRoute.DELETE, "DELETE", inRequest)).status).toBe(200);
  });
});

describe("9. an ordered line does not return to draft", () => {
  async function ordered() {
    const fake = seed(OWNER, "engineer");
    await call(ordersRoute.POST, "POST", inRequest, { idempotency_key: KEY });
    return fake;
  }

  it("refuses to reopen it, naming the line and its order", async () => {
    const fake = await ordered();
    const answer = await call(reopenRoute.POST, "POST", inRequest, { ids: [LINE_ELBOW] });
    expect([answer.status, answer.error?.code, answer.error?.message]).toEqual([
      409, MATERIAL_REQUEST_LINE_ORDERED, "La ligne 1 est dans le bon C-2611-101 : elle ne peut plus être rouverte.",
    ]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)?.status).toBe("validated");
  });

  it("refuses a selection holding ordered lines as a whole", async () => {
    const fake = await ordered();
    const answer = await call(reopenRoute.POST, "POST", inRequest, { ids: [LINE_UNPRICED, LINE_TUBE, LINE_ELBOW] });
    expect([answer.status, answer.error?.message, answer.error?.details]).toEqual([
      409, "Les lignes 1 et 4 sont dans les bons C-2611-101, C-2611-102 : elles ne peuvent plus être rouvertes.",
      { line_ids: [LINE_ELBOW, LINE_TUBE], positions: [1, 4], references: ["C-2611-101", "C-2611-102"] },
    ]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_UNPRICED)?.status).toBe("validated");
  });

  it("refuses an edit that would return it to draft", async () => {
    await ordered();
    const answer = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_ELBOW }, { zone: "Chaufferie" });
    expect([answer.status, answer.error?.code]).toEqual([409, MATERIAL_REQUEST_LINE_ORDERED]);
  });

  it("reopens it once its order is canceled", async () => {
    const fake = await ordered();
    for (const order of fake.tables.purchase_orders) order.status = "canceled";
    const answer = await call(reopenRoute.POST, "POST", inRequest, { ids: [LINE_ELBOW] });
    expect(answer.status).toBe(200);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)?.status).toBe("draft");
  });

  it("answers the database's refusal (ordered meanwhile) with the same code", async () => {
    // The summary read before the write sees no order; another session orders the line before the write lands.
    const { tables } = seed(OWNER, "engineer");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(createFakeSupabase({
      userId: OWNER,
      rpc: { material_request_order_summary: { ready_line_ids: [], not_ready: [], ordered: [], orders: [], can_create: true } },
      tables,
      refuseUpdate: (table, values) => table === "material_request_lines" && values.status === "draft" ? MATERIAL_REQUEST_LINE_ORDERED : false,
    }).supabase as never);
    const answer = await call(reopenRoute.POST, "POST", inRequest, { ids: [LINE_ELBOW] });
    expect([answer.status, answer.error?.code]).toEqual([409, MATERIAL_REQUEST_LINE_ORDERED]);
  });
});
