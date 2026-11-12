import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MaterialRequest,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
} from "@/lib/material-requests/contracts";
import type { ArticleSupplierItem, LineSupplierProposal } from "@/lib/material-requests/supplier-contracts";

/**
 * Failure modes, written before the screen (TI-691, lot 2 « l'achat », delivery 1 « fournisseurs des
 * lignes »). Each line with an article gets a proposed supplier and its reason; each of these would buy
 * from the wrong supplier, or lose the office's work:
 *  1. a line with an article and no supplier shows no proposal, or not why it is proposed (named by the
 *     technician, exception of the article, preferred supplier of its supply type, last purchase), or not
 *     the article's reference at that supplier;
 *  2. « Retenir » sets another supplier than the one shown, or anything before the office's gesture, or
 *     is sent ahead of a change made earlier on the line;
 *  3. « Retenir les fournisseurs proposés » takes a line without a proposal or one that already has a
 *     supplier, announces another count than what it sends, or overwrites a supplier choice still on its
 *     way;
 *  4. a reader is offered « Retenir » or the bulk gesture, or is sent for proposals;
 *  5. a refused save shows the supplier as chosen, says nothing, or holds the line back from validation
 *     although nothing unsaved is on screen;
 *  6. a line with a supplier does not show it with its reference at that supplier, or the article's
 *     suppliers are read once per line;
 *  7. the proposals are read once per line, or not again after a change that makes them stale (article
 *     linked or unlinked, supplier removed, supplier named on the request changed);
 *  8. a validated line cannot get its supplier, or is shown back in draft once it has one;
 *  9. an address that is not a web address is turned into a link.
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
const ARTICLE_1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ARTICLE_2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const ALPHA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BETA = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const GAMMA = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests/${REQUEST_ID}`;
const PROPOSALS = `${BASE}/supplier-proposals`;
const SUPPLIERS = [
  { id: ALPHA, name: "Négoce Alpha" },
  { id: BETA, name: "Comptoir Bêta" },
  { id: GAMMA, name: "Dépôt Gamma" },
];

function line(partial: Partial<MaterialRequestLine> = {}): MaterialRequestLine {
  return {
    id: LINE_A,
    request_id: REQUEST_ID,
    position: 1,
    original_text: "20 coudes inox 50",
    quantity: 20,
    quantity_doubtful: false,
    unit: "u",
    dimension: "DN 50",
    no_dimension: false,
    product_type: "Coude 90°",
    material: "Inox 316L",
    material_precision: null,
    reference: null,
    supplier_id: null,
    zone: null,
    imputation: "project",
    overhead_category: null,
    duplicate_acknowledged: false,
    status: "draft",
    validated_at: null,
    product_id: ARTICLE_1,
    product_match: "reference",
    ...partial,
  };
}

function request(partial: Partial<MaterialRequest> = {}): MaterialRequest {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    technician_id: null,
    requested_on: "2026-11-12",
    needed_on: null,
    delivery_place: null,
    is_urgent: false,
    presumed_material: null,
    material_confirmed: false,
    presumed_supplier_id: null,
    supplier_confirmed: false,
    source_text: null,
    note: null,
    created_at: "2026-11-12T08:00:00.000Z",
    updated_at: "2026-11-12T08:00:00.000Z",
    ...partial,
  };
}

function article(partial: Partial<MaterialRequestArticleSummary> = {}): MaterialRequestArticleSummary {
  return {
    id: ARTICLE_1,
    reference: "CD-I316-50",
    designation: "Coude 90° inox 316L DN 50",
    product_type: "Coude 90°",
    material: "Inox 316L",
    dimensions: "DN 50",
    unit: "u",
    catalogue_status: "validated",
    created_from_material_request: false,
    supply_type_name: "Inox",
    ...partial,
  };
}

function proposal(partial: Partial<LineSupplierProposal> = {}): LineSupplierProposal {
  return {
    supplier_id: ALPHA,
    supplier_name: "Négoce Alpha",
    reason: "supply_type",
    supplier_sku: "NA-4471",
    product_url: null,
    ...partial,
  };
}

function item(partial: Partial<ArticleSupplierItem> = {}): ArticleSupplierItem {
  return {
    id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
    supplier_id: BETA,
    supplier_name: "Comptoir Bêta",
    supplier_sku: "CB-90-50",
    product_url: null,
    is_active: true,
    has_price: false,
    ...partial,
  };
}

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };
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
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload, blob: async () => new Blob([]) };
    }),
  );
}

function detail(options: {
  lines: MaterialRequestLine[];
  request?: Partial<MaterialRequest>;
  articles?: Record<string, MaterialRequestArticleSummary>;
  canWrite?: boolean;
}) {
  return {
    request: request(options.request),
    technician: null,
    files: [],
    lines: options.lines,
    articles: options.articles ?? { [ARTICLE_1]: article() },
    canWrite: options.canWrite ?? true,
    materialOptions: ["Inox 316L"],
    supplierOptions: SUPPLIERS,
  };
}

function writes(): Call[] {
  return calls.filter((call) => call.method !== "GET");
}

function reads(path: string): Call[] {
  return calls.filter((call) => call.method === "GET" && call.path === path);
}

async function openEditor(routes: Record<string, Route>) {
  mockApi({
    "GET /api/material-request-technicians": { data: { items: [] } },
    [`GET ${BASE}/candidates`]: { data: { lines: {} } },
    ...routes,
  });
  const user = userEvent.setup();
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} />);
  await screen.findByRole("heading", { name: "Lignes" });
  return user;
}

const unsavedNotice = "Une modification de cette ligne n’est pas enregistrée : elle ne peut pas être validée en l’état.";

describe("suppliers of request lines", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the proposed supplier with its reason and reference, and retains it in one click (1, 2)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal() } } },
      [`PATCH ${BASE}/lines/${LINE_A}`]: { data: { line: line({ supplier_id: ALPHA }) } },
    });

    const retain = await screen.findByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" });
    expect(screen.getByText("Négoce Alpha · fournisseur du type Inox")).toBeVisible();
    expect(retain).toHaveAccessibleDescription(expect.stringContaining("Réf. fournisseur : NA-4471"));
    // Shown is not chosen: nothing was written before the gesture.
    expect(writes()).toEqual([]);
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("");

    await user.click(retain);

    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue(ALPHA));
    expect(writes()).toEqual([{ method: "PATCH", path: `${BASE}/lines/${LINE_A}`, body: { supplier_id: ALPHA } }]);
    expect(screen.queryByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" })).not.toBeInTheDocument();
    // Read once for the page: setting a supplier hides the proposal, it does not read them all again.
    expect(reads(PROPOSALS)).toHaveLength(1);
  });

  it("says why each supplier is proposed (1)", async () => {
    const lines = [
      line(),
      line({ id: LINE_B, position: 2 }),
      line({ id: LINE_C, position: 3 }),
      line({ id: LINE_D, position: 4 }),
    ];
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`GET ${PROPOSALS}`]: {
        data: {
          lines: {
            [LINE_A]: proposal({ reason: "technician", supplier_sku: null }),
            [LINE_B]: proposal({ reason: "article", supplier_id: BETA, supplier_name: "Comptoir Bêta", supplier_sku: null }),
            [LINE_C]: proposal({ reason: "supply_type", supplier_sku: null }),
            [LINE_D]: proposal({ reason: "last_purchase", supplier_id: GAMMA, supplier_name: "Dépôt Gamma", supplier_sku: null }),
          },
        },
      },
    });

    expect(await screen.findByText("Négoce Alpha · nommé par le technicien")).toBeVisible();
    expect(screen.getByText("Comptoir Bêta · exception de l’article")).toBeVisible();
    expect(screen.getByText("Négoce Alpha · fournisseur du type Inox")).toBeVisible();
    expect(screen.getByText("Dépôt Gamma · dernier achat")).toBeVisible();
    expect(screen.queryByText(/Réf\. fournisseur/)).not.toBeInTheDocument();
  });

  it("retains in bulk only the lines that have a proposal, one request per supplier (3)", async () => {
    const lines = [
      line(),
      line({ id: LINE_B, position: 2 }),
      line({ id: LINE_C, position: 3, product_id: ARTICLE_2 }),
      line({ id: LINE_D, position: 4, supplier_id: GAMMA }),
      line({ id: LINE_E, position: 5, product_id: null, product_match: null }),
    ];
    const answer = (ids: string[], supplierId: string) =>
      lines.filter((entry) => ids.includes(entry.id)).map((entry) => ({ ...entry, supplier_id: supplierId }));
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines, articles: { [ARTICLE_1]: article(), [ARTICLE_2]: article({ id: ARTICLE_2 }) } }),
      },
      [`GET ${PROPOSALS}`]: {
        data: {
          lines: {
            [LINE_A]: proposal(),
            [LINE_B]: proposal({ reason: "article", supplier_id: BETA, supplier_name: "Comptoir Bêta" }),
            [LINE_C]: proposal(),
            // A stale entry for a line that already has a supplier is never used.
            [LINE_D]: proposal(),
          },
        },
      },
      [`GET /api/products/${ARTICLE_1}/supplier-items`]: { data: { items: [] } },
      [`PATCH ${BASE}/lines`]: (body) => {
        const { ids, patch } = body as { ids: string[]; patch: { supplier_id: string } };
        return { data: { lines: answer(ids, patch.supplier_id) } };
      },
    });

    const bulk = await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (3)" });
    await user.click(bulk);

    expect(await screen.findByText("3 fournisseurs retenus.")).toBeVisible();
    expect(writes()).toEqual([
      { method: "PATCH", path: `${BASE}/lines`, body: { ids: [LINE_A, LINE_C], patch: { supplier_id: ALPHA } } },
      { method: "PATCH", path: `${BASE}/lines`, body: { ids: [LINE_B], patch: { supplier_id: BETA } } },
    ]);
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue(ALPHA);
    expect(screen.getByLabelText("Fournisseur, ligne 2")).toHaveValue(BETA);
    expect(screen.getByLabelText("Fournisseur, ligne 3")).toHaveValue(ALPHA);
    expect(screen.getByLabelText("Fournisseur, ligne 4")).toHaveValue(GAMMA);
    expect(screen.getByLabelText("Fournisseur, ligne 5")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Retenir les fournisseurs proposés \(\d+\)$/ })).toBeDisabled();
  });

  it("leaves out of the bulk gesture a line whose supplier choice is still on its way (3)", async () => {
    let answerChoice: (reply: Reply) => void = () => undefined;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line({ id: LINE_B, position: 2 })] }) },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal(), [LINE_B]: proposal() } } },
      [`PATCH ${BASE}/lines/${LINE_A}`]: () => new Promise<Reply>((resolve) => { answerChoice = resolve; }),
      [`PATCH ${BASE}/lines`]: { data: { lines: [line({ id: LINE_B, position: 2, supplier_id: ALPHA })] } },
    });

    await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (2)" });
    await user.selectOptions(screen.getByLabelText("Fournisseur, ligne 1"), GAMMA);
    await user.click(screen.getByRole("button", { name: "Retenir les fournisseurs proposés (2)" }));
    answerChoice({ data: { line: line({ supplier_id: GAMMA }) } });

    expect(await screen.findByText("1 fournisseur retenu.")).toBeVisible();
    expect(writes()).toEqual([
      { method: "PATCH", path: `${BASE}/lines/${LINE_A}`, body: { supplier_id: GAMMA } },
      { method: "PATCH", path: `${BASE}/lines`, body: { ids: [LINE_B], patch: { supplier_id: ALPHA } } },
    ]);
    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue(GAMMA));
    expect(screen.getByText(/La ligne 1 n’a pas été modifiée/)).toBeVisible();
  });

  it("offers no supplier control to a reader and does not ask for proposals (4, 6)", async () => {
    await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ canWrite: false, lines: [line(), line({ id: LINE_B, position: 2, supplier_id: BETA })] }),
      },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal() } } },
      [`GET /api/products/${ARTICLE_1}/supplier-items`]: { data: { items: [item()] } },
    });

    expect(await screen.findByText("Réf. fournisseur : CB-90-50")).toBeVisible();
    const rows = screen.getAllByRole("rowgroup").filter((group) => group.tagName === "TBODY");
    expect(within(rows[1]).getByText("Comptoir Bêta")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Retenir/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fournisseur, ligne 1")).not.toBeInTheDocument();
    expect(reads(PROPOSALS)).toEqual([]);
  });

  it("keeps the line as it was and says so when the save is refused (5)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal() } } },
      [`PATCH ${BASE}/lines/${LINE_A}`]: {
        status: 500,
        error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Non enregistré : Enregistrement impossible pour le moment.");
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" })).toBeEnabled();
    // Nothing unsaved is on screen: the line can still be validated.
    expect(screen.queryByText(unsavedNotice)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Valider la ligne 1" })).toBeEnabled();
  });

  it("keeps the lines as they were and says so when the bulk save is refused (5)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line({ id: LINE_B, position: 2 })] }) },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal(), [LINE_B]: proposal() } } },
      [`PATCH ${BASE}/lines`]: { status: 500, error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." } },
    });

    await user.click(await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (2)" }));

    expect(
      await screen.findByText("2 lignes n’ont pas reçu leur fournisseur : Enregistrement impossible pour le moment."),
    ).toBeVisible();
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("");
    expect(screen.getByLabelText("Fournisseur, ligne 2")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Retenir les fournisseurs proposés (2)" })).toBeEnabled();
  });

  it("shows the supplier of a line with its reference there, reading each article once (6, 9)", async () => {
    const lines = [
      line({ supplier_id: BETA }),
      line({ id: LINE_B, position: 2, supplier_id: BETA }),
      line({ id: LINE_C, position: 3, supplier_id: ALPHA }),
    ];
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`GET ${PROPOSALS}`]: { data: { lines: {} } },
      [`GET /api/products/${ARTICLE_1}/supplier-items`]: {
        data: {
          items: [
            item({ product_url: "https://fournisseur.example/coude-50" }),
            item({ id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2", supplier_id: ALPHA, supplier_name: "Négoce Alpha", supplier_sku: "NA-1", product_url: "javascript:alert(1)" }),
          ],
        },
      },
    });

    const rows = screen.getAllByRole("rowgroup").filter((group) => group.tagName === "TBODY");
    expect(await within(rows[0]).findByText("Réf. fournisseur : CB-90-50")).toBeVisible();
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue(BETA);
    const sheet = within(rows[0]).getByRole("link", { name: "Fiche chez Comptoir Bêta" });
    expect(sheet).toHaveAttribute("href", "https://fournisseur.example/coude-50");
    expect(sheet).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(rows[1]).getByText("Réf. fournisseur : CB-90-50")).toBeVisible();
    expect(within(rows[2]).getByText("Réf. fournisseur : NA-1")).toBeVisible();
    expect(within(rows[2]).queryByRole("link")).not.toBeInTheDocument();
    expect(reads(`/api/products/${ARTICLE_1}/supplier-items`)).toHaveLength(1);
  });

  it("reads the proposals again after a link, an unlink, a supplier removed or the request's supplier changed (7)", async () => {
    const linkedLine = line({ id: LINE_B, position: 2, supplier_id: ALPHA });
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines: [line(), linkedLine] }),
      },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal() } } },
      [`GET /api/products/${ARTICLE_1}/supplier-items`]: { data: { items: [] } },
      [`DELETE ${BASE}/lines/${LINE_A}/article`]: {
        data: { line: line({ product_id: null, product_match: null }) },
      },
      [`PATCH ${BASE}/lines/${LINE_B}`]: { data: { line: { ...linkedLine, supplier_id: null } } },
      [`PATCH ${BASE}`]: { data: { request: request({ presumed_supplier_id: GAMMA }), reopened_line_ids: [] } },
    });

    await screen.findByText("Négoce Alpha · fournisseur du type Inox");
    expect(reads(PROPOSALS)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Délier l’article de la ligne 1" }));
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(2));

    await user.selectOptions(screen.getByLabelText("Fournisseur, ligne 2"), "");
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(3));

    await user.selectOptions(screen.getByLabelText("Fournisseur présumé"), GAMMA);
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(4));
  });

  it("retains the supplier of a validated line and keeps it validated (8)", async () => {
    const validated = line({ status: "validated", validated_at: "2026-11-12T09:00:00.000Z" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [validated] }) },
      [`GET ${PROPOSALS}`]: { data: { lines: { [LINE_A]: proposal({ reason: "article" }) } } },
      [`GET /api/products/${ARTICLE_1}/supplier-items`]: { data: { items: [] } },
      [`PATCH ${BASE}/lines/${LINE_A}`]: { data: { line: { ...validated, supplier_id: ALPHA } } },
    });

    await user.click(await screen.findByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" }));

    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue(ALPHA));
    expect(writes()).toEqual([{ method: "PATCH", path: `${BASE}/lines/${LINE_A}`, body: { supplier_id: ALPHA } }]);
    expect(screen.getByText("Validée")).toBeVisible();
    expect(screen.queryByText("Brouillon")).not.toBeInTheDocument();
  });

  it("says the proposals could not be read and reads them again on request (7)", async () => {
    let attempts = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: () => {
        attempts += 1;
        return attempts === 1
          ? { status: 500, error: { code: "INTERNAL", message: "Erreur." } }
          : { data: { lines: { [LINE_A]: proposal() } } };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Recharger les fournisseurs proposés" }));

    expect(await screen.findByText("Négoce Alpha · fournisseur du type Inox")).toBeVisible();
    expect(screen.queryByText("Fournisseurs proposés indisponibles.")).not.toBeInTheDocument();
  });
});
