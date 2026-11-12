import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as requestRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/route";
import * as completeRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/complete/route";
import * as fileRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/[fileId]/route";
import * as filesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/route";
import * as lineArticleRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/article/route";
import * as lineRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/route";
import * as linesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/route";
import * as closeRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/quotes/[quoteId]/close/route";
import * as retainRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/quotes/[quoteId]/retain/route";
import * as quoteRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/quotes/[quoteId]/route";
import * as quotesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/quotes/route";
import type { MaterialRequestFile } from "@/lib/material-requests/contracts";
import {
  MATERIAL_REQUEST_QUOTE_MAX_FILES,
  type MaterialRequestQuote,
  type MaterialRequestQuoteRetained,
} from "@/lib/material-requests/quote-contracts";
import {
  createFakeSupabase,
  fakeMembership,
  type FakeRow,
  type FakeRpcHandler,
  type FakeTables,
} from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of consulting suppliers for a material request (TI-691, lot 2 « l'achat », delivery 2
 * « consultation »), written before the routes. Members, suppliers, lines and prices are fictional.
 *  1. Rights: a viewer, an engineer who does not own the affaire or a member of another tenant lists, records, prices,
 *     closes or retains a quote, or attaches its files; a director (who reads the affaire) writes; the owner and an
 *     admin cannot.
 *  2. Scope: a request of another affaire, a quote of another request, a line of another request or a supplier of
 *     another tenant is reached through this URL instead of answering 404; an archived supplier is consulted.
 *  3. One quote in progress per supplier: a second quote of a supplier whose quote is requested or received is
 *     recorded instead of a 409 in French; a retained or closed one keeps the supplier from being consulted again
 *     (coordinator's decision: lines added later can go to the same supplier).
 *  4. Retaining: a requested quote, or one with an unpriced line, is retained, or the refusal does not say which line
 *     (by its number); the lines do not take the quote's supplier, price and id; a quote sharing a line is left open,
 *     or one sharing none is closed; a validated line returns to draft; the answer does not name what was closed.
 *  5. Read-only: a retained or closed quote is priced, noted, closed, retained again or takes a file; a file of a
 *     retained quote is deleted.
 *  6. Changes: a key left out is cleared, `received` does not mark the quote received, a line the quote does not ask
 *     for is priced, a fraction of a cent or a negative amount reaches the database.
 *  7. Files: a quote's PDF does not pass the content check, a fake PDF does, an original may be a PDF, a quote keeps
 *     more than its cap, or its files are listed among the request's originals.
 *  8. The list: closed quotes are missing, the newest is not first, a quote's lines are not in the request's order,
 *     the supplier's name or the files are missing, or it costs one query per quote.
 *  9. Lines: the supplier of a line priced by a retained quote is changed (alone or in a selection), or the line is
 *     deleted alone; a line already priced is consulted again.
 * Independent review of the delivery:
 * 10. A priced line changes what it orders and keeps its price (DN 50 priced, then DN 65): its article (linked,
 *     changed, created or unlinked), type, dimension, material, precision, reference, unit or quantity; or its zone
 *     and imputation can no longer be edited.
 * 11. A price below one cent (0,034 € a screw) cannot be recorded: a price is for 1, 10, 100 or 1 000 units, kept
 *     with its quantity on the quote and on the line it prices; another quantity reaches the database.
 * 12. A file of a retained or closed quote is turned, or completed after the retaining (its upload began while the
 *     quote was open), and the leftover stays; a quote's PDF (a supplier's document) is served inline.
 * 13. A deadlock during a quote write answers a bare 400 instead of « réessayez »; a message of 300 lines (more
 *     than 4 000 characters) is refused.
 * 14. (Codex review of #279) A project line without its own material, quoted in the request's presumed material, is
 *     retained without it (a later header change would turn it into another material at the same price), or retained
 *     while that material is not confirmed; an overhead line takes the request's material.
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
const GAMMA = "40000000-0000-4000-8000-000000000003";
const DELTA = "40000000-0000-4000-8000-000000000004";
const ARCHIVED_SUPPLIER = "40000000-0000-4000-8000-000000000005";
const FOREIGN_SUPPLIER = "40000000-0000-4000-8000-000000000009";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const OTHER_REQUEST = "60000000-0000-4000-8000-000000000002";
const LINE_ELBOW = "70000000-0000-4000-8000-000000000001";
const LINE_TEE = "70000000-0000-4000-8000-000000000002";
const LINE_TUBE = "70000000-0000-4000-8000-000000000003";
const LINE_VALVE = "70000000-0000-4000-8000-000000000004";
const OTHER_LINE = "70000000-0000-4000-8000-000000000009";
const QUOTE_ALPHA = "c0000000-0000-4000-8000-000000000001";
const QUOTE_BETA = "c0000000-0000-4000-8000-000000000002";
const QUOTE_GAMMA = "c0000000-0000-4000-8000-000000000003";
const QUOTE_CLOSED = "c0000000-0000-4000-8000-000000000004";
const QUOTE_OTHER = "c0000000-0000-4000-8000-000000000009";
const ELBOW_ARTICLE = "90000000-0000-4000-8000-000000000001";
const SUPPLY_TYPE = "a0000000-0000-4000-8000-000000000001";
const ORIGINAL = "80000000-0000-4000-8000-000000000001";
const ALPHA_PDF = "80000000-0000-4000-8000-000000000002";
const VALIDATED_AT = "2026-11-11T10:00:00.000Z";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âã\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const ORIGINAL_PATH = `${TENANT}/${PROJECT}/${REQUEST}/${ORIGINAL}/demande.jpg`;
const ALPHA_PDF_PATH = `${TENANT}/${PROJECT}/${REQUEST}/${ALPHA_PDF}/devis-alpha.pdf`;

type Role = "admin" | "engineer" | "viewer" | "director";

function line(id: string, requestId: string, position: number, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: requestId === OTHER_REQUEST ? OTHER_PROJECT : PROJECT, request_id: requestId,
    position, original_text: null, quantity: 4, quantity_doubtful: false, unit: "u", dimension: "DN 50",
    no_dimension: false, product_type: "Coude 90°", material: "Inox 304L", material_precision: null, reference: null,
    supplier_id: null, zone: null, imputation: "project", overhead_category: null, duplicate_acknowledged: false,
    status: "draft", validated_at: null, validated_by: null, product_id: null, product_match: null, pre_link_wording: null,
    unit_price_ht_cents: null, price_per: 1, price_quote_id: null,
    created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

function quote(id: string, supplierId: string, status: string, requestedAt: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, supplier_id: supplierId, status, with_references: false,
    message: "Bonjour, pouvez-vous chiffrer ces articles ?", requested_at: requestedAt,
    received_at: status === "requested" ? null : "2026-11-12T14:00:00.000Z", amount_ht_cents: null, notes: null,
    retained_at: null, retained_by: null, closed_at: status === "closed" ? "2026-11-12T15:00:00.000Z" : null,
    created_by: OWNER, created_at: requestedAt, updated_at: requestedAt, ...extra,
  };
}

const quoteLine = (quoteId: string, lineId: string, price: number | null, projectId = PROJECT, pricePer = 1): FakeRow => ({
  quote_id: quoteId, line_id: lineId, tenant_id: TENANT, project_id: projectId, unit_price_ht_cents: price, price_per: pricePer,
  created_at: "2026-11-12T09:00:00.000Z", updated_at: "2026-11-12T09:00:00.000Z",
});

function file(id: string, path: string, quoteId: string | null, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, quote_id: quoteId, storage_path: path,
    file_name: path.slice(path.lastIndexOf("/") + 1), mime_type: quoteId ? "application/pdf" : "image/jpeg",
    byte_size: quoteId ? PDF.byteLength : JPEG.byteLength, rotation: 0, created_by: OWNER,
    created_at: "2026-11-12T14:05:00.000Z", stored_at: "2026-11-12T14:05:02.000Z", removed_at: null, ...extra,
  };
}

const OPEN = ["requested", "received"];
const now = () => new Date().toISOString();

/** public.create_material_request_quote, as pgTAP proves it: one quote and its lines, all or nothing. */
function createQuoteInDatabase(): FakeRpcHandler {
  let created = 0;
  return (args, tables) => {
    const lineIds = args.p_line_ids as string[];
    const quotes = (tables.material_request_quotes ??= []);
    if (quotes.some((row) => row.request_id === args.p_request_id && row.supplier_id === args.p_supplier_id && OPEN.includes(String(row.status)))) {
      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"material_request_quotes_open_supplier_key\"" } };
    }
    const lines = (tables.material_request_lines ?? []).filter((row) => lineIds.includes(String(row.id)) && row.request_id === args.p_request_id);
    if (lines.length !== lineIds.length) return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_REQUEST" } };
    if (lines.some((row) => row.price_quote_id !== null)) {
      return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED" } };
    }
    created += 1;
    const id = `c9000000-0000-4000-8000-${String(created).padStart(12, "0")}`;
    const at = now();
    quotes.push(quote(id, String(args.p_supplier_id), "requested", at, {
      with_references: args.p_with_references, message: args.p_message, created_by: OWNER,
    }));
    (tables.material_request_quote_lines ??= []).push(...[...lineIds].sort().map((lineId) => quoteLine(id, lineId, null)));
    return { data: id };
  };
}

/** public.update_material_request_quote, as pgTAP proves it: keys left out are left alone, all or nothing. */
const updateQuoteInDatabase: FakeRpcHandler = (args, tables) => {
  const target = (tables.material_request_quotes ?? []).find((row) => row.id === args.p_quote_id);
  if (!target) return { data: null, error: { code: "P0002", message: "MATERIAL_REQUEST_QUOTE_NOT_FOUND" } };
  if (!OPEN.includes(String(target.status))) return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_READ_ONLY" } };
  const changes = args.p_changes as { amount_ht_cents?: number | null; notes?: string | null; received?: true;
    lines?: Array<{ line_id: string; unit_price_ht_cents: number | null; price_per?: number }> };
  const mine = (tables.material_request_quote_lines ?? []).filter((row) => row.quote_id === target.id);
  if (changes.lines?.some((entry) => !mine.some((row) => row.line_id === entry.line_id))) {
    return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE" } };
  }
  for (const entry of changes.lines ?? []) {
    const row = mine.find((candidate) => candidate.line_id === entry.line_id);
    if (row) Object.assign(row, { unit_price_ht_cents: entry.unit_price_ht_cents, price_per: entry.price_per ?? row.price_per });
  }
  if ("amount_ht_cents" in changes) target.amount_ht_cents = changes.amount_ht_cents;
  if ("notes" in changes) target.notes = changes.notes;
  if (changes.received && target.status === "requested") Object.assign(target, { status: "received", received_at: now() });
  return { data: null };
};

/**
 * public.retain_material_request_quote, as pgTAP proves it: a received quote with every line priced becomes retained,
 * its lines take its supplier, price and id, and the open quotes sharing a line are closed and answered.
 */
function retainQuoteInDatabase(actor: string): FakeRpcHandler {
  return (args, tables) => {
    const quotes = tables.material_request_quotes ?? [];
    const target = quotes.find((row) => row.id === args.p_quote_id);
    if (!target) return { data: null, error: { code: "P0002", message: "MATERIAL_REQUEST_QUOTE_NOT_FOUND" } };
    if (target.status !== "received") {
      return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_NOT_RECEIVED", details: String(target.status) } };
    }
    const quoteLines = tables.material_request_quote_lines ?? [];
    const lines = tables.material_request_lines ?? [];
    const mine = quoteLines.filter((row) => row.quote_id === target.id);
    const positionOf = (lineId: unknown) => Number(lines.find((row) => row.id === lineId)?.position);
    const unpriced = mine.filter((row) => row.unit_price_ht_cents === null).map((row) => positionOf(row.line_id)).sort((a, b) => a - b);
    if (unpriced.length > 0) {
      return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_LINES_UNPRICED", details: JSON.stringify(unpriced) } };
    }
    // A project line without its own material takes the request's presumed material, which must be confirmed.
    const request = (tables.material_requests ?? []).find((row) => row.id === target.request_id);
    const unmaterialized = mine.map((row) => lines.find((entry) => entry.id === row.line_id))
      .filter((entry) => entry?.imputation === "project" && !String(entry.material ?? "").trim());
    if (unmaterialized.length > 0 && (!String(request?.presumed_material ?? "").trim() || request?.material_confirmed !== true)) {
      return { data: null, error: { code: "23514", message: "MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED",
        details: JSON.stringify(unmaterialized.map((entry) => Number(entry?.position)).sort((a, b) => a - b)) } };
    }
    Object.assign(target, { status: "retained", retained_at: now(), retained_by: actor });
    for (const row of mine) {
      const entry = lines.find((candidate) => candidate.id === row.line_id);
      Object.assign(entry ?? {}, {
        supplier_id: target.supplier_id, unit_price_ht_cents: row.unit_price_ht_cents, price_per: row.price_per, price_quote_id: target.id,
        ...(unmaterialized.includes(entry) ? { material: request?.presumed_material } : {}),
      });
    }
    const shared = new Set(mine.map((row) => row.line_id));
    const closed = quotes.filter((other) => other.request_id === target.request_id && other.id !== target.id
      && OPEN.includes(String(other.status))
      && quoteLines.some((row) => row.quote_id === other.id && shared.has(row.line_id)));
    for (const other of closed) Object.assign(other, { status: "closed", closed_at: now() });
    return { data: closed.map((other) => ({ closed_quote_id: other.id })).sort((a, b) => String(a.closed_quote_id).localeCompare(String(b.closed_quote_id))) };
  };
}

function seed(actor: string, role: Role, overrides: { tables?: Partial<FakeTables>; objects?: Record<string, Uint8Array> } = {}) {
  const fake = createFakeSupabase({
    userId: actor,
    rpc: {
      material_request_material_options: ["Inox 304L"],
      create_material_request_quote: createQuoteInDatabase(),
      update_material_request_quote: updateQuoteInDatabase,
      retain_material_request_quote: retainQuoteInDatabase(actor),
    },
    objects: overrides.objects ?? { [ORIGINAL_PATH]: JPEG, [ALPHA_PDF_PATH]: PDF },
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      estimate_projects: [
        { id: PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Affaire 1", is_archived: false },
        { id: OTHER_PROJECT, tenant_id: TENANT, user_id: ENGINEER, name: "Affaire 2", is_archived: false },
      ],
      suppliers: [
        { id: ALPHA, tenant_id: TENANT, name: "Négoce Alpha", is_active: true },
        { id: BETA, tenant_id: TENANT, name: "Négoce Beta", is_active: true },
        { id: GAMMA, tenant_id: TENANT, name: "Négoce Gamma", is_active: true },
        { id: DELTA, tenant_id: TENANT, name: "Négoce Delta", is_active: true },
        { id: ARCHIVED_SUPPLIER, tenant_id: TENANT, name: "Négoce archivé", is_active: false },
        { id: FOREIGN_SUPPLIER, tenant_id: OTHER_TENANT, name: "Négoce d'ailleurs", is_active: true },
      ],
      material_requests: [
        { id: REQUEST, tenant_id: TENANT, project_id: PROJECT, technician_id: null, requested_on: "2026-11-10", needed_on: null,
          delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false, presumed_supplier_id: null,
          supplier_confirmed: false, source_text: null, note: null, created_by: OWNER,
          created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z" },
        { id: OTHER_REQUEST, tenant_id: TENANT, project_id: OTHER_PROJECT, technician_id: null, requested_on: "2026-11-10",
          needed_on: null, delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false,
          presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null, created_by: ENGINEER,
          created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z" },
      ],
      material_request_lines: [
        line(LINE_ELBOW, REQUEST, 1, { status: "validated", validated_at: VALIDATED_AT, validated_by: OWNER }),
        line(LINE_TEE, REQUEST, 2, { product_type: "Té égal" }),
        line(LINE_TUBE, REQUEST, 3, { product_type: "Tube", unit: "m" }),
        line(LINE_VALVE, REQUEST, 4, { product_type: "Vanne" }),
        line(OTHER_LINE, OTHER_REQUEST, 1),
      ],
      // Alpha (lines 1, 2) and Beta (lines 2, 3) answered; Gamma (line 3) was asked; a closed one asked line 1.
      material_request_quotes: [
        quote(QUOTE_ALPHA, ALPHA, "received", "2026-11-12T09:00:00.000Z", { with_references: true, amount_ht_cents: 11800 }),
        quote(QUOTE_BETA, BETA, "received", "2026-11-12T10:00:00.000Z"),
        quote(QUOTE_GAMMA, GAMMA, "requested", "2026-11-12T11:00:00.000Z"),
        quote(QUOTE_CLOSED, DELTA, "closed", "2026-11-12T08:00:00.000Z"),
        quote(QUOTE_OTHER, ALPHA, "received", "2026-11-12T09:00:00.000Z", { project_id: OTHER_PROJECT, request_id: OTHER_REQUEST }),
      ],
      material_request_quote_lines: [
        quoteLine(QUOTE_ALPHA, LINE_TEE, 3400),
        quoteLine(QUOTE_ALPHA, LINE_ELBOW, 1250),
        quoteLine(QUOTE_BETA, LINE_TEE, 3300),
        quoteLine(QUOTE_BETA, LINE_TUBE, null),
        quoteLine(QUOTE_GAMMA, LINE_TUBE, null),
        quoteLine(QUOTE_CLOSED, LINE_ELBOW, 1500),
        quoteLine(QUOTE_OTHER, OTHER_LINE, 900, OTHER_PROJECT),
      ],
      material_request_files: [
        file(ORIGINAL, ORIGINAL_PATH, null),
        file(ALPHA_PDF, ALPHA_PDF_PATH, QUOTE_ALPHA),
      ],
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
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  const payload = isJson
    ? ((await response.clone().json()) as { ok: boolean; data?: never; error?: { code: string; message: string; details?: never } })
    : null;
  return { status: response.status, data: payload?.data as never, error: payload?.error, response };
}

const inRequest = { projectId: PROJECT, requestId: REQUEST };
const ofQuote = (quoteId: string) => ({ ...inRequest, quoteId });
const createBody = (extra: FakeRow = {}) => ({
  supplier_id: DELTA, line_ids: [LINE_VALVE, LINE_TUBE], with_references: false,
  message: "Bonjour, pouvez-vous chiffrer : 1 vanne inox DN 50, 6 m de tube inox 304L DN 50 ?", ...extra,
});
const listQuotes = async () => {
  const answer = await call(quotesRoute.GET, "GET", inRequest);
  expect(answer.status).toBe(200);
  return (answer.data as { items: MaterialRequestQuote[] }).items;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("who consults suppliers", () => {
  /** Every quote route, with a body it would accept from someone allowed to, and the status it then answers. */
  const ROUTES: Array<[string, "read" | "write", number, () => Promise<{ status: number }>]> = [
    ["list the quotes", "read", 200, () => call(quotesRoute.GET, "GET", inRequest)],
    ["record a quote", "write", 201, () => call(quotesRoute.POST, "POST", inRequest, createBody())],
    ["price a quote", "write", 200, () => call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_GAMMA), { notes: "Délai 48 h" })],
    ["close a quote", "write", 200, () => call(closeRoute.POST, "POST", ofQuote(QUOTE_GAMMA))],
    ["retain a quote", "write", 200, () => call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA))],
    ["attach a file to a quote", "write", 201, () => call(filesRoute.POST, "POST", inRequest, {
      quote_id: QUOTE_GAMMA, files: [{ name: "devis.pdf", mime_type: "application/pdf", byte_size: PDF.byteLength }],
    })],
  ];

  it.each<[string, string, Role, number, number]>([
    ["a viewer", VIEWER, "viewer", 403, 403],
    ["an engineer who does not own the affaire", ENGINEER, "engineer", 403, 403],
    ["a member of another tenant", OUTSIDER, "admin", 404, 404],
    ["a director", DIRECTOR, "director", 200, 403],
  ])("%s is refused what the affaire does not let them do, and nothing is written", async (_label, actor, role, readStatus, writeStatus) => {
    for (const [name, mode, , run] of ROUTES) {
      const fake = seed(actor, role);
      const { status } = await run();
      expect([name, status]).toEqual([name, mode === "read" ? readStatus : writeStatus]);
      expect([name, fake.writes, fake.rpcCalls.filter((rpc) => rpc !== "material_request_material_options")]).toEqual([name, [], []]);
    }
  });

  it.each<[string, string, Role]>([
    ["the engineer who owns the affaire", OWNER, "engineer"],
    ["an admin", ADMIN, "admin"],
  ])("%s does every one of them", async (_label, actor, role) => {
    for (const [name, , allowed, run] of ROUTES) {
      seed(actor, role);
      const { status } = await run();
      expect([name, status]).toEqual([name, allowed]);
    }
  });
});

describe("what one URL reaches", () => {
  it.each<[string, () => Promise<{ status: number }>]>([
    ["the quotes of a request of another affaire", () => call(quotesRoute.GET, "GET", { projectId: PROJECT, requestId: OTHER_REQUEST })],
    ["a quote of another request, to price", () => call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_OTHER), { notes: "Vu" })],
    ["a quote of another request, to close", () => call(closeRoute.POST, "POST", ofQuote(QUOTE_OTHER))],
    ["a quote of another request, to retain", () => call(retainRoute.POST, "POST", ofQuote(QUOTE_OTHER))],
    ["a line of another request, in a new quote", () => call(quotesRoute.POST, "POST", inRequest, createBody({ line_ids: [LINE_VALVE, OTHER_LINE] }))],
    ["a line of another request, in a price", () => call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_GAMMA), { lines: [{ line_id: OTHER_LINE, unit_price_ht_cents: 100 }] })],
    ["a supplier of another tenant", () => call(quotesRoute.POST, "POST", inRequest, createBody({ supplier_id: FOREIGN_SUPPLIER }))],
    ["a quote of another request, for a file", () => call(filesRoute.POST, "POST", inRequest, {
      quote_id: QUOTE_OTHER, files: [{ name: "devis.pdf", mime_type: "application/pdf", byte_size: PDF.byteLength }],
    })],
  ])("answers 404 for %s, and writes nothing", async (_label, run) => {
    const fake = seed(ADMIN, "admin");
    expect((await run()).status).toBe(404);
    expect(fake.writes).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("does not consult an archived supplier", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(quotesRoute.POST, "POST", inRequest, createBody({ supplier_id: ARCHIVED_SUPPLIER }));
    expect([status, error?.message]).toEqual([400, "Ce fournisseur est archivé : réactivez-le avant de le consulter."]);
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("recording a quote", () => {
  it("records the message as copied, in one database call, and answers the quote as the list shows it", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(quotesRoute.POST, "POST", inRequest, createBody());
    expect(status).toBe(201);
    expect(fake.rpcArgs.filter((entry) => entry.name === "create_material_request_quote")).toEqual([{
      name: "create_material_request_quote",
      args: { p_request_id: REQUEST, p_supplier_id: DELTA, p_with_references: false, p_message: createBody().message, p_line_ids: [LINE_VALVE, LINE_TUBE] },
    }]);
    const item = (data as { item: MaterialRequestQuote }).item;
    expect(item).toEqual({
      id: expect.any(String), request_id: REQUEST, supplier_id: DELTA, supplier_name: "Négoce Delta", status: "requested",
      with_references: false, message: createBody().message, requested_at: expect.any(String), received_at: null,
      amount_ht_cents: null, notes: null, retained_at: null, closed_at: null,
      // In the order of the request, whatever the order given.
      lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: null, price_per: 1 }, { line_id: LINE_VALVE, unit_price_ht_cents: null, price_per: 1 }],
      files: [],
    } satisfies MaterialRequestQuote);
    expect((await listQuotes())[0]).toEqual(item);
  });

  it.each<[string, string, string]>([
    ["requested", GAMMA, "Une consultation de ce fournisseur est déjà en cours pour cette demande : clôturez-la avant d’en ouvrir une autre."],
    ["received", BETA, "Une consultation de ce fournisseur est déjà en cours pour cette demande : clôturez-la avant d’en ouvrir une autre."],
  ])("refuses a second quote of a supplier whose quote is %s, with a sentence and a code", async (_label, supplierId, message) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(quotesRoute.POST, "POST", inRequest, createBody({ supplier_id: supplierId }));
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN", message]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("consults again a supplier whose quote is retained, for lines it was not asked", async () => {
    seed(OWNER, "engineer", {
      tables: {
        material_request_quotes: [quote(QUOTE_ALPHA, ALPHA, "retained", "2026-11-12T09:00:00.000Z", { retained_at: "2026-11-12T16:00:00.000Z" })],
        material_request_quote_lines: [quoteLine(QUOTE_ALPHA, LINE_ELBOW, 1250)],
      },
    });
    const { status, data } = await call(quotesRoute.POST, "POST", inRequest, createBody({ supplier_id: ALPHA }));
    expect(status).toBe(201);
    expect((data as { item: MaterialRequestQuote }).item).toMatchObject({ supplier_id: ALPHA, status: "requested" });
    expect((await listQuotes()).map((entry) => [entry.supplier_id, entry.status])).toEqual([[ALPHA, "requested"], [ALPHA, "retained"]]);
  });

  it("answers the same 409 when the database refuses it, another session having consulted the supplier meanwhile", async () => {
    const fake = seed(OWNER, "engineer");
    // The early check found no open quote of Delta; another session records one before the database call.
    const create = createQuoteInDatabase();
    fake.supabase.rpc = (async (name: string, args: Record<string, unknown> = {}) => {
      fake.tables.material_request_quotes.push(quote("c0000000-0000-4000-8000-000000000005", DELTA, "requested", now()));
      const { data, error } = create(args, fake.tables);
      return { data: error ? null : data, error: error ? { details: null, hint: null, ...error } : null };
    }) as typeof fake.supabase.rpc;
    const answer = await call(quotesRoute.POST, "POST", inRequest, createBody());
    expect([answer.status, answer.error?.code, answer.error?.message]).toEqual([409, "MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN",
      "Une consultation de ce fournisseur est déjà en cours pour cette demande : clôturez-la avant d’en ouvrir une autre."]);
  });

  it("consults again a supplier whose quote is closed", async () => {
    seed(OWNER, "engineer");
    const { status, data } = await call(quotesRoute.POST, "POST", inRequest, createBody({ supplier_id: DELTA, line_ids: [LINE_VALVE] }));
    expect(status).toBe(201);
    expect((data as { item: MaterialRequestQuote }).item).toMatchObject({ supplier_id: DELTA, status: "requested" });
  });

  it("does not consult a line already priced by a retained quote, and names it by its number", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: {
        material_request_lines: [
          line(LINE_ELBOW, REQUEST, 1, { supplier_id: ALPHA, unit_price_ht_cents: 1250, price_quote_id: QUOTE_ALPHA }),
          line(LINE_VALVE, REQUEST, 4),
        ],
      },
    });
    const { status, error } = await call(quotesRoute.POST, "POST", inRequest, createBody({ line_ids: [LINE_VALVE, LINE_ELBOW] }));
    expect([status, error?.code, error?.message, error?.details]).toEqual([422, "MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED",
      "La ligne 1 a déjà un devis retenu : elle n’est plus à consulter.", { positions: [1], line_ids: [LINE_ELBOW] }]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it.each<[string, FakeRow]>([
    ["no line", { line_ids: [] }],
    ["a line twice", { line_ids: [LINE_VALVE, LINE_VALVE] }],
    ["a blank message", { message: "   " }],
    ["a message of 20 001 characters", { message: "x".repeat(20_001) }],
    ["no variant", { with_references: undefined }],
  ])("refuses a quote with %s before the database is called", async (_label, extra) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(quotesRoute.POST, "POST", inRequest, createBody(extra));
    expect([status, error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("pricing a quote", () => {
  it("writes only what was sent, in one database call, and marks it received when asked", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_GAMMA), {
      received: true, lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: 1890 }],
    });
    expect(status).toBe(200);
    expect(fake.rpcArgs.filter((entry) => entry.name === "update_material_request_quote")).toEqual([{
      name: "update_material_request_quote",
      args: { p_quote_id: QUOTE_GAMMA, p_changes: { received: true, lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: 1890 }] } },
    }]);
    expect((data as { item: MaterialRequestQuote }).item).toMatchObject({
      id: QUOTE_GAMMA, status: "received", received_at: expect.any(String), amount_ht_cents: null, notes: null,
      lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: 1890 }],
    });
  });

  it("clears with null, trims the notes, and leaves the rest alone", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_ALPHA), { amount_ht_cents: null, notes: "  Franco de port  " });
    expect(status).toBe(200);
    expect(fake.rpcArgs.find((entry) => entry.name === "update_material_request_quote")?.args.p_changes).toEqual({
      amount_ht_cents: null, notes: "Franco de port",
    });
    expect((data as { item: MaterialRequestQuote }).item).toMatchObject({
      amount_ht_cents: null, notes: "Franco de port", status: "received",
      lines: [{ line_id: LINE_ELBOW, unit_price_ht_cents: 1250 }, { line_id: LINE_TEE, unit_price_ht_cents: 3400 }],
    });
  });

  it.each<[string, unknown]>([
    ["a fraction of a cent", { amount_ht_cents: 1250.5 }],
    ["a negative price", { lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: -1 }] }],
    ["a price in euros as text", { lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: "18,90" }] }],
    ["received: false", { received: false }],
    ["a status", { status: "retained" }],
    ["nothing", {}],
    ["notes of 2 001 characters", { notes: "x".repeat(2001) }],
    ["a price for 7 units", { lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: 34, price_per: 7 }] }],
  ])("refuses %s before the database is called", async (_label, body) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_GAMMA), body);
    expect([status, error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("records a price below one cent as a price for 100 or 1 000 units, and keeps the quantity of a line left out", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: { material_request_quote_lines: [quoteLine(QUOTE_ALPHA, LINE_ELBOW, 1250, PROJECT, 10), quoteLine(QUOTE_ALPHA, LINE_TEE, 3400)] },
    });
    // 0,034 € a screw: 340 cents for 100.
    const { status, data } = await call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_ALPHA), {
      lines: [{ line_id: LINE_TEE, unit_price_ht_cents: 340, price_per: 100 }, { line_id: LINE_ELBOW, unit_price_ht_cents: 1300 }],
    });
    expect(status).toBe(200);
    expect(fake.rpcArgs.find((entry) => entry.name === "update_material_request_quote")?.args.p_changes).toEqual({
      lines: [{ line_id: LINE_TEE, unit_price_ht_cents: 340, price_per: 100 }, { line_id: LINE_ELBOW, unit_price_ht_cents: 1300 }],
    });
    expect((data as { item: MaterialRequestQuote }).item.lines).toEqual([
      { line_id: LINE_ELBOW, unit_price_ht_cents: 1300, price_per: 10 },
      { line_id: LINE_TEE, unit_price_ht_cents: 340, price_per: 100 },
    ]);
  });

  it("answers 404 for a line of the request that the quote does not ask for", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_GAMMA), {
      lines: [{ line_id: LINE_TUBE, unit_price_ht_cents: 1890 }, { line_id: LINE_VALVE, unit_price_ht_cents: 9900 }],
    });
    expect([status, error?.message]).toEqual([404, "La ligne 4 n’est pas demandée dans ce devis."]);
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("retaining a quote", () => {
  it("prices its lines with its supplier, closes the quotes sharing a line, and keeps a validated line validated", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA));
    expect(status).toBe(200);
    const answer = data as MaterialRequestQuoteRetained;
    expect(fake.rpcArgs.filter((entry) => entry.name === "retain_material_request_quote")).toEqual([
      { name: "retain_material_request_quote", args: { p_quote_id: QUOTE_ALPHA } },
    ]);
    expect(answer.item).toMatchObject({ id: QUOTE_ALPHA, status: "retained", retained_at: expect.any(String), closed_at: null });
    expect(answer.lines.map((entry) => [entry.id, entry.supplier_id, entry.unit_price_ht_cents, entry.price_quote_id, entry.status, entry.validated_at]))
      .toEqual([
        [LINE_ELBOW, ALPHA, 1250, QUOTE_ALPHA, "validated", VALIDATED_AT],
        [LINE_TEE, ALPHA, 3400, QUOTE_ALPHA, "draft", null],
      ]);
    // Beta shares the tee; Gamma asked only the tube; the closed one was already closed.
    expect(answer.closed_quote_ids).toEqual([QUOTE_BETA]);
    expect((await listQuotes()).map((entry) => [entry.id, entry.status])).toEqual([
      [QUOTE_GAMMA, "requested"], [QUOTE_BETA, "closed"], [QUOTE_ALPHA, "retained"], [QUOTE_CLOSED, "closed"],
    ]);
    // Nothing but the database function wrote the lines and the quotes.
    expect(fake.writes).toEqual([]);
  });

  it("refuses a requested quote with a sentence and a code", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_GAMMA));
    expect([status, error?.code, error?.message]).toEqual([422, "MATERIAL_REQUEST_QUOTE_NOT_RECEIVED",
      "Ce devis n’est pas encore reçu : enregistrez la réponse du fournisseur avant de le retenir."]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a quote with an unpriced line, naming it by its number", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_BETA));
    expect([status, error?.code, error?.message, error?.details]).toEqual([422, "MATERIAL_REQUEST_QUOTE_LINES_UNPRICED",
      "La ligne 3 de ce devis n’a pas de prix : chiffrez-la avant de le retenir.", { positions: [3], line_ids: [LINE_TUBE] }]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("gives each line the quantity its price is for", async () => {
    seed(OWNER, "engineer", {
      tables: { material_request_quote_lines: [quoteLine(QUOTE_ALPHA, LINE_ELBOW, 1250), quoteLine(QUOTE_ALPHA, LINE_TEE, 340, PROJECT, 100)] },
    });
    const { data } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA));
    expect((data as MaterialRequestQuoteRetained).lines.map((entry) => [entry.id, entry.unit_price_ht_cents, entry.price_per]))
      .toEqual([[LINE_ELBOW, 1250, 1], [LINE_TEE, 340, 100]]);
  });

  it.each<[string, () => Promise<{ status: number; error?: { code: string; message: string } }>]>([
    ["retaining", () => call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA))],
    ["recording", () => call(quotesRoute.POST, "POST", inRequest, createBody())],
    ["pricing", () => call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_GAMMA), { notes: "Délai 48 h" })],
  ])("answers « réessayez » when the database ends a deadlock while %s", async (_label, run) => {
    const fake = seed(OWNER, "engineer");
    fake.supabase.rpc = (async () => ({ data: null, error: { code: "40P01", message: "deadlock detected", details: null, hint: null } })) as typeof fake.supabase.rpc;
    const { status, error } = await run();
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_QUOTE_BUSY", "Une autre modification était en cours : réessayez."]);
  });

  const inPresumedMaterial = (confirmed: boolean, presumed: string | null = "Inox 304L") => seed(OWNER, "engineer", {
    tables: {
      material_requests: [{
        id: REQUEST, tenant_id: TENANT, project_id: PROJECT, technician_id: null, requested_on: "2026-11-10", needed_on: null,
        delivery_place: null, is_urgent: false, presumed_material: presumed, material_confirmed: confirmed, presumed_supplier_id: null,
        supplier_confirmed: false, source_text: null, note: null, created_by: OWNER,
        created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z",
      }],
      material_request_lines: [
        line(LINE_ELBOW, REQUEST, 1, { material: null, status: "validated", validated_at: VALIDATED_AT, validated_by: OWNER }),
        line(LINE_TEE, REQUEST, 2, { material: null, imputation: "overhead", overhead_category: "EPI" }),
      ],
    },
  });

  it("writes the request's confirmed material on a project line priced without one, never on an overhead line", async () => {
    inPresumedMaterial(true);
    const { status, data } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA));
    expect(status).toBe(200);
    expect((data as MaterialRequestQuoteRetained).lines.map((entry) => [entry.id, entry.material, entry.status, entry.unit_price_ht_cents]))
      .toEqual([[LINE_ELBOW, "Inox 304L", "validated", 1250], [LINE_TEE, null, "draft", 3400]]);
  });

  it.each<[string, string | null]>([
    ["not confirmed", "Inox 304L"],
    ["missing", null],
  ])("refuses to retain a quote asked in the request's material while that material is %s", async (_label, presumed) => {
    const fake = inPresumedMaterial(false, presumed);
    const { status, error } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA));
    expect([status, error?.code, error?.message, error?.details]).toEqual([422, "MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED",
      "La ligne 1 n’a pas de matière propre et la matière présumée de la demande n’est pas confirmée : confirmez-la avant de retenir ce devis.",
      { positions: [1], line_ids: [LINE_ELBOW] }]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("names every unpriced line when there are several", async () => {
    seed(OWNER, "engineer", {
      tables: {
        material_request_quote_lines: [quoteLine(QUOTE_BETA, LINE_TEE, null), quoteLine(QUOTE_BETA, LINE_TUBE, null)],
      },
    });
    const { error } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_BETA));
    expect([error?.message, error?.details]).toEqual([
      "Les lignes 2 et 3 de ce devis n’ont pas de prix : chiffrez-les avant de le retenir.",
      { positions: [2, 3], line_ids: [LINE_TEE, LINE_TUBE] },
    ]);
  });

  it("answers the same refusal when the database finds an unpriced line another session cleared meanwhile", async () => {
    const fake = seed(OWNER, "engineer");
    // The early check sees Alpha fully priced; the database sees the tee unpriced.
    const retain = retainQuoteInDatabase(OWNER);
    fake.supabase.rpc = (async (name: string, args: Record<string, unknown> = {}) => {
      if (name !== "retain_material_request_quote") return { data: null, error: null };
      const row = fake.tables.material_request_quote_lines.find((entry) => entry.quote_id === QUOTE_ALPHA && entry.line_id === LINE_TEE);
      if (row) row.unit_price_ht_cents = null;
      const { data, error } = retain(args, fake.tables);
      return { data: error ? null : data, error: error ? { details: null, hint: null, ...error } : null };
    }) as typeof fake.supabase.rpc;
    const { status, error } = await call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA));
    expect([status, error?.code, error?.details]).toEqual([422, "MATERIAL_REQUEST_QUOTE_LINES_UNPRICED", { positions: [2], line_ids: [LINE_TEE] }]);
  });
});

describe("retained and closed quotes are read-only", () => {
  const retained = () => seed(OWNER, "engineer", {
    tables: {
      material_request_quotes: [
        quote(QUOTE_ALPHA, ALPHA, "retained", "2026-11-12T09:00:00.000Z", { retained_at: "2026-11-12T16:00:00.000Z" }),
        quote(QUOTE_CLOSED, DELTA, "closed", "2026-11-12T08:00:00.000Z"),
      ],
    },
  });

  it.each<[string, string, () => Promise<{ status: number; error?: { code: string; message: string } }>]>([
    ["priced, when retained", "Ce devis est retenu : il ne se modifie plus.", () => call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_ALPHA), { notes: "Après coup" })],
    ["priced, when closed", "Ce devis est clos : il ne se modifie plus.", () => call(quoteRoute.PATCH, "PATCH", ofQuote(QUOTE_CLOSED), { amount_ht_cents: 1 })],
    ["closed, when retained", "Ce devis est retenu : il ne se modifie plus.", () => call(closeRoute.POST, "POST", ofQuote(QUOTE_ALPHA))],
    ["retained again", "Ce devis est retenu : il ne se modifie plus.", () => call(retainRoute.POST, "POST", ofQuote(QUOTE_ALPHA))],
    ["retained, when closed", "Ce devis est clos : il ne se modifie plus.", () => call(retainRoute.POST, "POST", ofQuote(QUOTE_CLOSED))],
    ["given a file, when retained", "Ce devis est retenu : il ne se modifie plus.", () => call(filesRoute.POST, "POST", inRequest, {
      quote_id: QUOTE_ALPHA, files: [{ name: "devis.pdf", mime_type: "application/pdf", byte_size: PDF.byteLength }],
    })],
    ["given a file, when closed", "Ce devis est clos : il ne se modifie plus.", () => call(filesRoute.POST, "POST", inRequest, {
      quote_id: QUOTE_CLOSED, files: [{ name: "devis.pdf", mime_type: "application/pdf", byte_size: PDF.byteLength }],
    })],
    ["deprived of its file, when retained", "Ce devis est retenu : il ne se modifie plus.", () => call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: ALPHA_PDF })],
    ["given a turned file, when retained", "Ce devis est retenu : il ne se modifie plus.", () => call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: ALPHA_PDF }, { rotation: 90 })],
  ])("a quote is not %s", async (_label, message, run) => {
    const fake = retained();
    const { status, error } = await run();
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_QUOTE_READ_ONLY", message]);
    expect(fake.writes).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
  });

  it("closes a requested or received quote by hand, and a closed one again without writing", async () => {
    const fake = seed(OWNER, "engineer");
    const closed = await call(closeRoute.POST, "POST", ofQuote(QUOTE_BETA));
    expect([closed.status, (closed.data as { item: MaterialRequestQuote }).item.status]).toEqual([200, "closed"]);
    expect((closed.data as { item: MaterialRequestQuote }).item.closed_at).toEqual(expect.any(String));
    expect(fake.writes).toEqual([{ table: "material_request_quotes", operation: "update", values: { status: "closed" }, ids: [QUOTE_BETA] }]);
    fake.writes.length = 0;
    const again = await call(closeRoute.POST, "POST", ofQuote(QUOTE_CLOSED));
    expect([again.status, (again.data as { item: MaterialRequestQuote }).item.status]).toEqual([200, "closed"]);
    expect(fake.writes).toEqual([]);
  });

  it("keeps closed quotes readable, with their prices and files", async () => {
    seed(DIRECTOR, "director");
    const items = await listQuotes();
    expect(items.find((entry) => entry.id === QUOTE_CLOSED)).toMatchObject({ status: "closed", lines: [{ line_id: LINE_ELBOW, unit_price_ht_cents: 1500 }] });
  });
});

describe("the list of quotes", () => {
  it("lists every quote of the request, closed included, newest first, with its supplier, lines in the request's order and files", async () => {
    seed(DIRECTOR, "director");
    const items = await listQuotes();
    expect(items.map((entry) => entry.id)).toEqual([QUOTE_GAMMA, QUOTE_BETA, QUOTE_ALPHA, QUOTE_CLOSED]);
    expect(items.find((entry) => entry.id === QUOTE_ALPHA)).toEqual({
      id: QUOTE_ALPHA, request_id: REQUEST, supplier_id: ALPHA, supplier_name: "Négoce Alpha", status: "received", with_references: true,
      message: "Bonjour, pouvez-vous chiffrer ces articles ?", requested_at: "2026-11-12T09:00:00.000Z", received_at: "2026-11-12T14:00:00.000Z",
      amount_ht_cents: 11800, notes: null, retained_at: null, closed_at: null,
      lines: [{ line_id: LINE_ELBOW, unit_price_ht_cents: 1250, price_per: 1 }, { line_id: LINE_TEE, unit_price_ht_cents: 3400, price_per: 1 }],
      files: [{
        id: ALPHA_PDF, request_id: REQUEST, quote_id: QUOTE_ALPHA, file_name: "devis-alpha.pdf", mime_type: "application/pdf",
        byte_size: PDF.byteLength, rotation: 0, created_at: "2026-11-12T14:05:00.000Z",
      }],
    } satisfies MaterialRequestQuote);
  });

  it("reads a request's quotes in a bounded number of queries, whatever their number", async () => {
    const small = seed(OWNER, "engineer");
    await listQuotes();
    const many = Array.from({ length: 30 }, (_, index) =>
      quote(`c1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, BETA, "closed", `2026-11-1${index % 2}T09:00:00.000Z`));
    const large = seed(OWNER, "engineer", {
      tables: {
        material_request_quotes: many,
        material_request_quote_lines: many.map((entry) => quoteLine(String(entry.id), LINE_TEE, 100)),
      },
    });
    expect(await listQuotes()).toHaveLength(30);
    expect(large.reads.length).toBe(small.reads.length);
  });

  it("does not list a quote's files among the request's originals", async () => {
    seed(OWNER, "engineer");
    const { data } = await call(requestRoute.GET, "GET", inRequest);
    expect((data as { files: MaterialRequestFile[] }).files.map((entry) => [entry.id, entry.quote_id])).toEqual([[ORIGINAL, null]]);
  });
});

describe("the files of a quote", () => {
  type Upload = { file: { id: string; mime_type: string }; path: string; token: string };
  /** For the quote named (Gamma's by default), or for the request's originals with null. */
  const prepare = (files: Array<{ name: string; mime_type: string; byte_size: number }>, quoteId: string | null = QUOTE_GAMMA) =>
    call(filesRoute.POST, "POST", inRequest, quoteId ? { quote_id: quoteId, files } : { files });
  const complete = (ids: string[]) => call(completeRoute.POST, "POST", inRequest, { ids });

  it("takes a PDF whose bytes are a PDF, and lists it with its quote, not among the originals", async () => {
    const fake = seed(OWNER, "engineer");
    const prepared = await prepare([{ name: "Devis Gamma.pdf", mime_type: "application/pdf", byte_size: PDF.byteLength }]);
    expect(prepared.status).toBe(201);
    const [upload] = (prepared.data as { uploads: Upload[] }).uploads;
    expect(upload.file.mime_type).toBe("application/pdf");
    expect(fake.writes[0].values).toMatchObject({ quote_id: QUOTE_GAMMA, mime_type: "application/pdf", request_id: REQUEST });
    fake.objects.set(upload.path, PDF);
    const completed = await complete([upload.file.id]);
    expect(completed.status).toBe(200);
    expect((completed.data as { files: MaterialRequestFile[] }).files).toEqual([expect.objectContaining({
      id: upload.file.id, quote_id: QUOTE_GAMMA, mime_type: "application/pdf", file_name: "Devis Gamma.pdf",
    })]);
    expect((await listQuotes()).find((entry) => entry.id === QUOTE_GAMMA)?.files.map((entry) => entry.id)).toEqual([upload.file.id]);
    const detail = await call(requestRoute.GET, "GET", inRequest);
    expect((detail.data as { files: MaterialRequestFile[] }).files.map((entry) => entry.id)).toEqual([ORIGINAL]);
  });

  it.each<[string, Uint8Array]>([
    ["JPEG bytes", JPEG],
    ["text that only looks like one", new TextEncoder().encode("%PDX-1.7 pas un vrai devis")],
  ])("discards a PDF that holds %s", async (_label, bytes) => {
    const fake = seed(OWNER, "engineer");
    const prepared = await prepare([{ name: "faux.pdf", mime_type: "application/pdf", byte_size: bytes.byteLength }]);
    const [upload] = (prepared.data as { uploads: Upload[] }).uploads;
    fake.objects.set(upload.path, bytes);
    const { status, error } = await complete([upload.file.id]);
    expect([status, error?.code, error?.details]).toEqual([422, "MATERIAL_REQUEST_FILE_REJECTED", { rejected: [{ id: upload.file.id, reason: "type" }] }]);
    expect(fake.tables.material_request_files.some((row) => row.id === upload.file.id)).toBe(false);
  });

  it("serves a quote's PDF through the file route as a download (a supplier's document), an original inline", async () => {
    seed(DIRECTOR, "director");
    const { status, response } = await call(fileRoute.GET, "GET", { ...inRequest, fileId: ALPHA_PDF });
    expect([status, response.headers.get("content-type")]).toEqual([200, "application/pdf"]);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="devis-alpha\.pdf"/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    const original = await call(fileRoute.GET, "GET", { ...inRequest, fileId: ORIGINAL });
    expect(original.response.headers.get("content-disposition")).toMatch(/^inline; /);
  });

  it("does not complete a file whose quote was retained while it was being sent, and takes it back", async () => {
    const fake = seed(OWNER, "engineer");
    const prepared = await prepare([{ name: "page-2.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength }], QUOTE_GAMMA);
    const [upload] = (prepared.data as { uploads: Upload[] }).uploads;
    fake.objects.set(upload.path, JPEG);
    Object.assign(fake.tables.material_request_quotes.find((row) => row.id === QUOTE_GAMMA) ?? {}, { status: "retained", retained_at: now() });
    const { status, error } = await complete([upload.file.id]);
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_QUOTE_READ_ONLY", "Ce devis est retenu : il ne se modifie plus."]);
    expect(fake.tables.material_request_files.some((row) => row.id === upload.file.id)).toBe(false);
    expect(fake.objects.has(upload.path)).toBe(false);
  });

  it("removes a file attached by mistake while the quote is in progress", async () => {
    const fake = seed(OWNER, "engineer");
    const { status } = await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: ALPHA_PDF });
    expect(status).toBe(200);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([ORIGINAL]);
    expect([...fake.objects.keys()]).toEqual([ORIGINAL_PATH]);
  });

  it("takes photos of a paper quote too", async () => {
    const fake = seed(OWNER, "engineer");
    const prepared = await prepare([{ name: "page-1.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength }]);
    const [upload] = (prepared.data as { uploads: Upload[] }).uploads;
    fake.objects.set(upload.path, JPEG);
    expect((await complete([upload.file.id])).status).toBe(200);
  });

  it("keeps an original an image: a PDF is refused without a quote", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await prepare([{ name: "bon.pdf", mime_type: "application/pdf", byte_size: PDF.byteLength }], null);
    expect([status, error?.message]).toEqual([400, "« bon.pdf » n’est pas une image JPEG, PNG ou WebP."]);
    expect(fake.writes).toEqual([]);
  });

  it("refuses a file that is neither a PDF nor an image, for a quote", async () => {
    seed(OWNER, "engineer");
    const { status, error } = await prepare([{ name: "devis.docx", mime_type: "application/msword", byte_size: 100 }]);
    expect([status, error?.message]).toEqual([400, "« devis.docx » n’est pas un PDF ni une image JPEG, PNG ou WebP."]);
  });

  it(`keeps ${MATERIAL_REQUEST_QUOTE_MAX_FILES} files per quote, apart from the request's originals`, async () => {
    const fake = seed(OWNER, "engineer");
    const page = (index: number) => ({ name: `page-${index}.jpg`, mime_type: "image/jpeg", byte_size: JPEG.byteLength });
    // Alpha holds its PDF: ten more would make eleven.
    const full = await prepare(Array.from({ length: MATERIAL_REQUEST_QUOTE_MAX_FILES }, (_, index) => page(index)), QUOTE_ALPHA);
    expect([full.status, full.error?.code]).toEqual([422, "MATERIAL_REQUEST_QUOTE_FILE_LIMIT"]);
    expect(fake.writes).toEqual([]);
    expect((await prepare(Array.from({ length: MATERIAL_REQUEST_QUOTE_MAX_FILES - 1 }, (_, index) => page(index)), QUOTE_ALPHA)).status).toBe(201);
    // The request's own original does not count against a quote, nor the quote's files against the originals.
    expect((await prepare(Array.from({ length: 11 }, (_, index) => page(index)), null)).status).toBe(201);
  });
});

describe("lines priced by a retained quote", () => {
  const priced = () => seed(OWNER, "engineer", {
    tables: {
      material_request_quotes: [quote(QUOTE_ALPHA, ALPHA, "retained", "2026-11-12T09:00:00.000Z", { retained_at: "2026-11-12T16:00:00.000Z" })],
      material_request_quote_lines: [quoteLine(QUOTE_ALPHA, LINE_ELBOW, 1250)],
      material_request_lines: [
        line(LINE_ELBOW, REQUEST, 1, { status: "validated", validated_at: VALIDATED_AT, validated_by: OWNER, supplier_id: ALPHA,
          unit_price_ht_cents: 1250, price_quote_id: QUOTE_ALPHA, product_id: ELBOW_ARTICLE, product_match: "manual" }),
        line(LINE_TEE, REQUEST, 2),
      ],
      products: [{ id: ELBOW_ARTICLE, tenant_id: TENANT, reference: null, designation: "Coude 90° inox DN 65", product_type: "Coude 90°",
        material: "Inox 304L", dimensions: "DN 65", unit: "u", is_active: true, catalogue_status: "validated", supply_type_id: null,
        created_from_material_request: false, created_by: null }],
      supply_types: [{ id: SUPPLY_TYPE, tenant_id: TENANT, code: "raccords", name: "Raccords" }],
    },
  });
  const ordered = "La ligne 1 a un devis retenu : ce qu’elle commande (article, désignation, dimension, matière, référence, unité, quantité) ne change plus.";

  it.each<[string, FakeRow]>([
    ["its dimension (DN 50 priced, DN 65 ordered)", { dimension: "DN 65" }],
    ["whether it has a dimension", { no_dimension: true }],
    ["its quantity", { quantity: 40 }],
    ["its unit", { unit: "m" }],
    ["its type", { product_type: "Coude 45°" }],
    ["its material", { material: "Inox 316L" }],
    ["its precision", { material_precision: "PN16" }],
    ["its reference", { reference: "CO-65" }],
  ])("refuses to change what a priced line orders: %s", async (_label, patch) => {
    const fake = priced();
    const { status, error } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_ELBOW }, patch);
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_LINE_PRICED", ordered]);
    expect(fake.writes).toEqual([]);
  });

  it("refuses the same in a selection, writing none of it, and applies a zone to it", async () => {
    const fake = priced();
    const refused = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_TEE, LINE_ELBOW], patch: { material: "Inox 316L" } });
    expect([refused.status, refused.error?.code]).toEqual([409, "MATERIAL_REQUEST_LINE_PRICED"]);
    expect(fake.writes).toEqual([]);
    const zoned = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_TEE, LINE_ELBOW], patch: { zone: "R+2", imputation: "overhead" } });
    expect(zoned.status).toBe(200);
  });

  it.each<[string, () => Promise<{ status: number; error?: { code: string; message: string } }>]>([
    ["linked to another article", () => call(lineArticleRoute.PUT, "PUT", { ...inRequest, lineId: LINE_ELBOW }, { product_id: ELBOW_ARTICLE, via: "manual" })],
    ["unlinked from its article", () => call(lineArticleRoute.DELETE, "DELETE", { ...inRequest, lineId: LINE_ELBOW })],
    ["given a new article", () => call(lineArticleRoute.POST, "POST", { ...inRequest, lineId: LINE_ELBOW }, {
      product_type: "Coude 90°", material: "Inox 304L", unit: "u", supply_type_id: SUPPLY_TYPE,
    })],
  ])("refuses a priced line %s", async (_label, run) => {
    const fake = priced();
    const { status, error } = await run();
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_LINE_PRICED", ordered]);
    expect(fake.writes).toEqual([]);
  });

  it("refuses to change the supplier of a priced line, alone or in a selection, and writes none of the selection", async () => {
    const fake = priced();
    const alone = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_ELBOW }, { supplier_id: BETA });
    expect([alone.status, alone.error?.code, alone.error?.message]).toEqual([409, "MATERIAL_REQUEST_LINE_PRICED",
      "La ligne 1 a un devis retenu : son fournisseur est celui du devis."]);
    const selection = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_TEE, LINE_ELBOW], patch: { supplier_id: BETA } });
    expect([selection.status, selection.error?.code]).toEqual([409, "MATERIAL_REQUEST_LINE_PRICED"]);
    expect(fake.writes).toEqual([]);
  });

  it("still edits what else a priced line says, and answers its price", async () => {
    priced();
    const { status, data } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_ELBOW }, { zone: "R+1", supplier_id: ALPHA });
    expect(status).toBe(200);
    expect((data as { line: FakeRow }).line).toMatchObject({ zone: "R+1", supplier_id: ALPHA, unit_price_ht_cents: 1250, price_quote_id: QUOTE_ALPHA });
  });

  it("refuses to delete a priced line alone", async () => {
    const fake = priced();
    const { status, error } = await call(lineRoute.DELETE, "DELETE", { ...inRequest, lineId: LINE_ELBOW });
    expect([status, error?.code, error?.message]).toEqual([409, "MATERIAL_REQUEST_LINE_PRICED",
      "La ligne 1 a un devis retenu : elle ne se supprime plus seule."]);
    expect(fake.writes).toEqual([]);
    expect((await call(lineRoute.DELETE, "DELETE", { ...inRequest, lineId: LINE_TEE })).status).toBe(200);
  });
});
