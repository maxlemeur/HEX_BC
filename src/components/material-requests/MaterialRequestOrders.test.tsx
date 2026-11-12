import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MaterialRequest, MaterialRequestLine } from "@/lib/material-requests/contracts";
import { formatEUR } from "@/lib/money";

/** The amount as the screen writes it, spaces as the queries read them (no-break spaces normalised). */
const euros = (cents: number) => formatEUR(cents).replace(/\s/g, " ");

/**
 * Failure modes, written before the screen (TI-691, lot 2 « l'achat », delivery 3a « bons de commande depuis les
 * demandes »). The office turns the lines priced by a retained quote into one draft purchase order per supplier.
 * Each of these would order twice, order what is not ready, or hide what was ordered:
 *  1. a click sends no key, or a double click, a second click while the first is on its way, sends a second
 *     creation; a creation whose answer never came is retried under another key (the server would create again);
 *  2. a refusal (nothing ready) is silent or keeps its key, so a later creation replays the refusal;
 *  3. the button counts other lines than the ready ones, or is offered when none is ready;
 *  4. a line that cannot be ordered is not said apart, or its reason is said in code words;
 *  5. the drafts created are not listed with their reference, supplier, status in words, total and lines, or
 *     do not open the purchase order;
 *  6. an ordered line does not say so in the lines table, or still offers to be reopened;
 *  7. a reader is offered the creation;
 *  8. a line priced after the page was read is not counted until the page is reloaded.
 */

vi.mock("@/lib/material-requests/source-text", () => ({ splitSourceText: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ storage: { from: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { MaterialRequestEditor } from "@/components/material-requests/MaterialRequestEditor";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const LINE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LINE_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LINE_F = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ALPHA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BETA = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const QUOTE_A = "9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a";
const QUOTE_B = "9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b";
const ORDER_A = "0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a";
const ORDER_B = "0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests/${REQUEST_ID}`;
const ORDERS = `${BASE}/orders`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Line = MaterialRequestLine;

function line(partial: Partial<Line> = {}): Line {
  return {
    id: LINE_A,
    request_id: REQUEST_ID,
    position: 1,
    original_text: null,
    quantity: 20,
    quantity_doubtful: false,
    unit: "u",
    dimension: "DN 50",
    no_dimension: false,
    product_type: "Coude 90°",
    material: "Inox 316L",
    material_precision: null,
    reference: null,
    supplier_id: ALPHA,
    zone: null,
    imputation: "project",
    overhead_category: null,
    duplicate_acknowledged: false,
    status: "validated",
    validated_at: "2026-11-12T09:00:00.000Z",
    product_id: null,
    product_match: null,
    unit_price_ht_cents: 1150,
    price_per: 1,
    price_quote_id: QUOTE_A,
    ...partial,
  };
}

/** Two suppliers' retained quotes, the screws priced for 100, gloves for overhead, three lines not ready. */
const LINES: Line[] = [
  line(),
  line({ id: LINE_B, position: 2, product_type: "Vis tête hexagonale", dimension: "M10", quantity: 250, supplier_id: BETA, unit_price_ht_cents: 340, price_per: 100, price_quote_id: QUOTE_B }),
  line({ id: LINE_C, position: 3, product_type: "Gants de manutention", dimension: null, no_dimension: true, imputation: "overhead", overhead_category: "EPI", quantity: 10, unit: "paire", unit_price_ht_cents: 420 }),
  line({ id: LINE_D, position: 4, product_type: "Té égal", status: "draft", validated_at: null, unit_price_ht_cents: null, price_quote_id: null }),
  line({ id: LINE_E, position: 5, product_type: "Bride plate", unit_price_ht_cents: null, price_quote_id: null }),
  line({ id: LINE_F, position: 6, product_type: "Manchon", supplier_id: null, unit_price_ht_cents: null, price_quote_id: null }),
];

const NOT_READY = [
  { line_id: LINE_D, reason: "not_validated" },
  { line_id: LINE_E, reason: "not_priced" },
  { line_id: LINE_F, reason: "no_supplier" },
];

const CREATED = [
  { id: ORDER_A, reference: "C-2026-0041", supplier_name: "Négoce Alpha", status: "draft", total_ht_cents: 27200, line_count: 2 },
  { id: ORDER_B, reference: "C-2026-0042", supplier_name: "Comptoir Bêta", status: "draft", total_ht_cents: 850, line_count: 1 },
];

/** POST answers the drafts it made, without their status (they are drafts). */
const CREATED_ANSWER = {
  orders: CREATED.map((order) => ({
    id: order.id,
    reference: order.reference,
    supplier_name: order.supplier_name,
    line_count: order.line_count,
    total_ht_cents: order.total_ht_cents,
  })),
  replayed: false,
};

function summary(stage: "before" | "after") {
  return stage === "before"
    ? { ready_line_ids: [LINE_A, LINE_B, LINE_C], not_ready: NOT_READY, ordered: [], orders: [], can_create: true }
    : {
        ready_line_ids: [],
        not_ready: NOT_READY,
        ordered: [
          { line_id: LINE_A, purchase_order_id: ORDER_A, purchase_order_reference: "C-2026-0041", status: "draft" },
          { line_id: LINE_B, purchase_order_id: ORDER_B, purchase_order_reference: "C-2026-0042", status: "draft" },
          { line_id: LINE_C, purchase_order_id: ORDER_A, purchase_order_reference: "C-2026-0041", status: "draft" },
        ],
        orders: CREATED,
        can_create: true,
      };
}

function request(): MaterialRequest {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    technician_id: null,
    requested_on: "2026-11-12",
    needed_on: null,
    delivery_place: "site",
    is_urgent: false,
    presumed_material: null,
    material_confirmed: false,
    presumed_supplier_id: null,
    supplier_confirmed: false,
    source_text: null,
    note: null,
    created_at: "2026-11-12T08:00:00.000Z",
    updated_at: "2026-11-12T08:00:00.000Z",
  };
}

function detail(lines: Line[], canWrite = true) {
  return {
    request: request(),
    technician: null,
    files: [],
    lines,
    articles: {},
    canWrite,
    materialOptions: [],
    supplierOptions: [
      { id: ALPHA, name: "Négoce Alpha" },
      { id: BETA, name: "Comptoir Bêta" },
    ],
  };
}

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string } } | "network";
type Route = Reply | ((body: unknown) => Reply | Promise<Reply>);
type Call = { method: string; path: string; body: unknown };

let calls: Call[] = [];

function mockApi(routes: Record<string, Route>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      const reply: Reply =
        route === undefined
          ? { status: 404, error: { code: "NOT_FOUND", message: `Route absente du test : ${method} ${path}` } }
          : typeof route === "function"
            ? await route(body)
            : route;
      // The answer never came: the server may or may not have created the drafts.
      if (reply === "network") throw new TypeError("Failed to fetch");
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload, blob: async () => new Blob([]) };
    }),
  );
}

function creations(): Call[] {
  return calls.filter((call) => call.method === "POST" && call.path === ORDERS);
}

async function openEditor(routes: Record<string, Route>) {
  mockApi({
    "GET /api/material-request-technicians": { data: { items: [] } },
    [`GET ${BASE}/candidates`]: { data: { lines: {} } },
    [`GET ${BASE}/supplier-proposals`]: { data: { lines: {}, references: {} } },
    [`GET ${BASE}/quotes`]: { data: { items: [] } },
    ...routes,
  });
  const user = userEvent.setup();
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} affaireName="Résidence des Tilleuls" />);
  const heading = await screen.findByRole("heading", { name: "Commandes" });
  return { user, section: () => heading.closest("section") as HTMLElement };
}

describe("purchase orders from a request", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates the drafts once per click, and sends the same key again when the answer never came (1, 5, 6)", async () => {
    let stage: "before" | "after" = "before";
    let attempts = 0;
    let answer!: (reply: Reply) => void;
    const { user, section } = await openEditor({
      [`GET ${BASE}`]: { data: detail(LINES) },
      [`GET ${ORDERS}`]: () => ({ data: summary(stage) }),
      [`POST ${ORDERS}`]: () => {
        attempts += 1;
        // The first answer is lost on the way back; the second is held until the test lets it go.
        if (attempts === 1) return "network";
        return new Promise<Reply>((resolve) => (answer = resolve));
      },
    });

    const create = await within(section()).findByRole("button", { name: "Créer les brouillons de commande (3)" });
    expect(within(section()).getByText("3 lignes prêtes à commander.")).toBeVisible();
    await user.click(create);

    expect(await within(section()).findByRole("alert")).toHaveTextContent(
      "La réponse n’est pas arrivée : les brouillons ont peut-être été créés. Réessayez, rien ne sera créé deux fois.",
    );
    const [first] = creations();
    expect(first.body).toEqual({ idempotency_key: expect.stringMatching(UUID) });

    // The summary is read again (still 3 ready: nothing was created), then the retry is offered.
    const retry = within(section()).getByRole("button", { name: "Créer les brouillons de commande (3)" });
    await waitFor(() => expect(retry).toBeEnabled());
    // The retry, clicked twice in a row while it is on its way: one request, under the first key.
    await user.dblClick(retry);
    await waitFor(() => expect(creations()).toHaveLength(2));
    expect(within(section()).getByRole("button", { name: "Créer les brouillons de commande (3)" })).toBeDisabled();
    await user.click(within(section()).getByRole("button", { name: "Créer les brouillons de commande (3)" }));
    expect(creations()).toHaveLength(2);
    expect(creations()[1].body).toEqual(first.body);

    stage = "after";
    answer({ status: 201, data: CREATED_ANSWER });

    // The drafts, each opening its purchase order.
    const list = await within(section()).findByRole("list", { name: "Bons de commande de la demande" });
    const alpha = within(list).getByRole("link", { name: "C-2026-0041" }).closest("li") as HTMLElement;
    expect(within(list).getByRole("link", { name: "C-2026-0041" })).toHaveAttribute("href", `/dashboard/orders/${ORDER_A}`);
    expect(within(alpha).getByText("Négoce Alpha")).toBeVisible();
    expect(within(alpha).getByText("Brouillon")).toBeVisible();
    expect(within(alpha).getByText(`${euros(27200)} HT`)).toBeVisible();
    expect(within(alpha).getByText("2 lignes")).toBeVisible();
    const beta = within(list).getByRole("link", { name: "C-2026-0042" }).closest("li") as HTMLElement;
    expect(within(beta).getByText("Comptoir Bêta")).toBeVisible();
    expect(within(beta).getByText(`${euros(850)} HT`)).toBeVisible();
    expect(within(beta).getByText("1 ligne")).toBeVisible();

    // Read again once created: nothing is left to order, and each ordered line says where it went.
    expect(await within(section()).findByText("Aucune ligne prête à commander.")).toBeVisible();
    expect(within(section()).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(section()).getByRole("button", { name: "Créer les brouillons de commande (0)" })).toBeDisabled();
    const table = screen.getByRole("region", { name: "Tableau des lignes" });
    const marks = within(table).getAllByRole("link", { name: "Commandé : C-2026-0041" });
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveAttribute("href", `/dashboard/orders/${ORDER_A}`);
    expect(within(table).getByRole("link", { name: "Commandé : C-2026-0042" })).toHaveAttribute("href", `/dashboard/orders/${ORDER_B}`);
    // An ordered line is not reopened from the request; a validated line not ordered still is.
    expect(within(table).queryByRole("button", { name: "Rouvrir la ligne 1" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Rouvrir la ligne 3" })).not.toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Rouvrir la ligne 5" })).toBeVisible();
    expect(creations()).toHaveLength(2);
  });

  it("drops the key of a refusal: the next creation is a new one (2)", async () => {
    let refuse = true;
    const { user, section } = await openEditor({
      [`GET ${BASE}`]: { data: detail(LINES) },
      [`GET ${ORDERS}`]: () => ({ data: summary(refuse ? "before" : "after") }),
      [`POST ${ORDERS}`]: () =>
        refuse
          ? { status: 422, error: { code: "MATERIAL_REQUEST_ORDER_NOTHING_READY", message: "Aucune ligne n’est prête à commander." } }
          : { status: 201, data: CREATED_ANSWER },
    });

    await user.click(await within(section()).findByRole("button", { name: "Créer les brouillons de commande (3)" }));
    expect(await within(section()).findByRole("alert")).toHaveTextContent("Non créé : Aucune ligne n’est prête à commander.");

    // Read again after the refusal, then offered again.
    const again = within(section()).getByRole("button", { name: "Créer les brouillons de commande (3)" });
    await waitFor(() => expect(again).toBeEnabled());
    refuse = false;
    await user.click(again);
    await within(section()).findByRole("list", { name: "Bons de commande de la demande" });
    const [refused, created] = creations();
    expect(created.body).toEqual({ idempotency_key: expect.stringMatching(UUID) });
    expect(created.body).not.toEqual(refused.body);
  });

  it("says why each line is not ready, in words, and offers nothing when none is (3, 4)", async () => {
    const { section } = await openEditor({
      [`GET ${BASE}`]: { data: detail(LINES.slice(3)) },
      [`GET ${ORDERS}`]: { data: { ready_line_ids: [], not_ready: NOT_READY, ordered: [], orders: [], can_create: true } },
    });

    const reasons = await within(section()).findByRole("list", { name: "Lignes pas encore à commander" });
    expect(within(reasons).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Ligne 4 · Té égal DN 50 : pas validée",
      "Ligne 5 · Bride plate DN 50 : sans devis retenu",
      "Ligne 6 · Manchon DN 50 : sans fournisseur",
    ]);
    expect(within(section()).getByText("Aucune ligne prête à commander.")).toBeVisible();
    expect(within(section()).getByRole("button", { name: "Créer les brouillons de commande (0)" })).toBeDisabled();
    expect(within(section()).getByText("Aucun bon de commande pour le moment.")).toBeVisible();
    expect(creations()).toEqual([]);
  });

  it("shows a reader the orders and the reasons, and nothing that creates (7)", async () => {
    const { section } = await openEditor({
      [`GET ${BASE}`]: { data: detail(LINES, false) },
      [`GET ${ORDERS}`]: { data: { ...summary("after"), can_create: false } },
    });

    const list = await within(section()).findByRole("list", { name: "Bons de commande de la demande" });
    expect(within(list).getByRole("link", { name: "C-2026-0041" })).toHaveAttribute("href", `/dashboard/orders/${ORDER_A}`);
    expect(within(section()).getByRole("list", { name: "Lignes pas encore à commander" })).toBeVisible();
    expect(within(section()).queryByRole("button", { name: /Créer les brouillons de commande/ })).not.toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Tableau des lignes" });
    expect(within(table).getAllByRole("link", { name: "Commandé : C-2026-0041" })).toHaveLength(2);
    expect(creations()).toEqual([]);
  });

  it("offers no creation to a writer of the request who may not buy, as the server says (7)", async () => {
    const { section } = await openEditor({
      [`GET ${BASE}`]: { data: detail(LINES, true) },
      [`GET ${ORDERS}`]: { data: { ...summary("before"), can_create: false } },
    });

    expect(await within(section()).findByText("3 lignes prêtes à commander.")).toBeVisible();
    expect(within(section()).getByText("Les bons de commande faits depuis cette demande.")).toBeVisible();
    expect(within(section()).queryByRole("button", { name: /Créer les brouillons de commande/ })).not.toBeInTheDocument();
    expect(creations()).toEqual([]);
  });

  it("reads the summary again when a line gets its price, and counts it at once (8)", async () => {
    let ready = [LINE_A];
    const unpriced = LINES.map((entry) =>
      entry.id === LINE_B ? { ...entry, unit_price_ht_cents: null, price_per: 1 as const, price_quote_id: null } : entry,
    );
    const quote = {
      id: QUOTE_B,
      request_id: REQUEST_ID,
      supplier_id: BETA,
      supplier_name: "Comptoir Bêta",
      status: "received",
      with_references: true,
      message: "Bonjour",
      requested_at: "2026-11-12T09:00:00.000Z",
      received_at: "2026-11-12T10:00:00.000Z",
      amount_ht_cents: null,
      notes: null,
      retained_at: null,
      closed_at: null,
      lines: [{ line_id: LINE_B, unit_price_ht_cents: 340, price_per: 100 }],
      files: [],
    };
    const { user, section } = await openEditor({
      [`GET ${BASE}`]: { data: detail(unpriced.slice(0, 2)) },
      [`GET ${BASE}/quotes`]: { data: { items: [quote] } },
      [`GET ${ORDERS}`]: () => ({ data: { ready_line_ids: ready, not_ready: [], ordered: [], orders: [], can_create: true } }),
      [`POST ${BASE}/quotes/${QUOTE_B}/retain`]: () => {
        ready = [LINE_A, LINE_B];
        return {
          data: {
            item: { ...quote, status: "retained", retained_at: "2026-11-12T11:00:00.000Z" },
            lines: [LINES[1]],
            closed_quote_ids: [],
          },
        };
      },
    });

    expect(await within(section()).findByRole("button", { name: "Créer les brouillons de commande (1)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retenir ce devis (Comptoir Bêta)" }));

    expect(await within(section()).findByRole("button", { name: "Créer les brouillons de commande (2)" })).toBeEnabled();
    expect(within(section()).getByText("2 lignes prêtes à commander.")).toBeVisible();
  });
});
