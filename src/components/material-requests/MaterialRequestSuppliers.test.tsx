import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MaterialRequest,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
} from "@/lib/material-requests/contracts";
import type { LineSupplierProposal, LineSupplierReference } from "@/lib/material-requests/supplier-contracts";

/**
 * Failure modes, written before the screen (TI-691, lot 2 « l'achat », delivery 1 « fournisseurs des
 * lignes »). Each line with an article gets a proposed supplier and its reason; each of these would buy
 * from the wrong supplier, or lose the office's work:
 *  1. a line with an article and no supplier shows no proposal, or not why it is proposed (named by the
 *     technician, confirmed or still to confirm, exception of the article, preferred supplier of its supply
 *     type, last purchase), or not the article's reference at that supplier;
 *  2. « Retenir » sets another supplier than the one shown, or anything before the office's gesture, or
 *     is sent ahead of a change made earlier on the line;
 *  3. « Retenir les fournisseurs proposés » takes a line without a proposal or one that already has a
 *     supplier, announces another count than what it sends, overwrites a supplier choice still on its way,
 *     or is silent about lines the server left alone because they had a supplier meanwhile;
 *  4. a reader is offered « Retenir » or the bulk gesture, or a proposal;
 *  5. a refused save shows the supplier as chosen, says nothing, or holds the line back from validation
 *     although nothing unsaved is on screen;
 *  6. a line with a supplier does not show it with its reference at that supplier, or the screen reads the
 *     article's suppliers itself (one request per article, up to 300 per page) instead of the proposals'
 *     answer;
 *  7. the proposals are read once per line, or not again after a change that makes them stale (article
 *     linked or unlinked, supplier chosen, removed or retained, supplier named on the request changed);
 *  8. a validated line cannot get its supplier, or is shown back in draft once it has one;
 *  9. an address that is not a web address is turned into a link.
 * (Independent review of delivery 1: 3 « skipped », 4 readers read the references, 6 per-article reads,
 * 7 refresh after retains, 1 technician's supplier still to confirm.)
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
const RETAIN = `${BASE}/lines/retain-suppliers`;
const SUPPLIERS = [
  { id: ALPHA, name: "Négoce Alpha", label: "Négoce Alpha" },
  { id: BETA, name: "Comptoir Bêta", label: "Comptoir Bêta" },
  { id: GAMMA, name: "Dépôt Gamma", label: "Dépôt Gamma" },
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
    unit_price_ht_cents: null,
    price_per: 1,
    price_quote_id: null,
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

type Proposal = LineSupplierProposal;

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    supplier_id: ALPHA,
    supplier_name: "Négoce Alpha",
    reason: "supply_type",
    confirmed: true,
    supplier_sku: "NA-4471",
    product_url: null,
    ...partial,
  };
}

/** The proposals route's answer: proposals for lines without a supplier, references for the others. */
function proposals(
  lines: Record<string, Proposal | null>,
  references: Record<string, LineSupplierReference> = {},
) {
  return { data: { lines, references } };
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

/** The retain route's answer: the lines it wrote, and those it left alone because they had a supplier. */
function retained(lines: MaterialRequestLine[], skipped: string[] = []): Reply {
  return { data: { lines, skipped } };
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
    [`GET ${BASE}/quotes`]: { data: { items: [] } },
    ...routes,
  });
  const user = userEvent.setup();
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} />);
  await screen.findByRole("heading", { name: "Lignes" });
  return user;
}

const unsavedNotice = "Une modification de cette ligne n’est pas enregistrée : elle ne peut pas être validée en l’état.";

/** A supplier picked in the searchable field (TI-691): its list opened, then the entry chosen. */
async function pickSupplier(user: ReturnType<typeof userEvent.setup>, field: string, option: string) {
  const input = screen.getByLabelText(field);
  const group = input.closest<HTMLElement>('[data-slot="combobox"]');
  if (!group) throw new Error(`${field} is not a searchable field.`);
  await user.click(within(group).getByRole("button", { name: "Afficher les suggestions" }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("suppliers of request lines", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the proposed supplier with its reason and reference, and retains it in one click (1, 2, 7)", async () => {
    let reads_ = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: () => {
        reads_ += 1;
        return reads_ === 1
          ? proposals({ [LINE_A]: proposal() })
          : proposals({}, { [LINE_A]: { supplier_sku: "NA-4471", product_url: null } });
      },
      [`POST ${RETAIN}`]: retained([line({ supplier_id: ALPHA })]),
    });

    const retain = await screen.findByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" });
    expect(screen.getByText("Négoce Alpha · fournisseur du type Inox")).toBeVisible();
    expect(retain).toHaveAccessibleDescription(expect.stringContaining("Réf. fournisseur : NA-4471"));
    // Shown is not chosen: nothing was written before the gesture.
    expect(writes()).toEqual([]);
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("");

    await user.click(retain);

    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Négoce Alpha"));
    expect(writes()).toEqual([
      { method: "POST", path: RETAIN, body: { choices: [{ line_id: LINE_A, supplier_id: ALPHA }] } },
    ]);
    expect(screen.queryByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" })).not.toBeInTheDocument();
    // Read again once retained: the reference now comes from the answer for lines with a supplier.
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(2));
    expect(await screen.findByText("Réf. fournisseur : NA-4471")).toBeVisible();
  });

  it("says why each supplier is proposed, and when the technician's is still to confirm (1)", async () => {
    const lines = [
      line(),
      line({ id: LINE_B, position: 2 }),
      line({ id: LINE_C, position: 3 }),
      line({ id: LINE_D, position: 4 }),
      line({ id: LINE_E, position: 5 }),
    ];
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`GET ${PROPOSALS}`]: proposals({
        [LINE_A]: proposal({ reason: "technician", supplier_sku: null }),
        [LINE_B]: proposal({ reason: "article", supplier_id: BETA, supplier_name: "Comptoir Bêta", supplier_sku: null }),
        [LINE_C]: proposal({ reason: "supply_type", supplier_sku: null }),
        [LINE_D]: proposal({ reason: "last_purchase", supplier_id: GAMMA, supplier_name: "Dépôt Gamma", supplier_sku: null }),
        [LINE_E]: proposal({ reason: "technician", confirmed: false, supplier_sku: null }),
      }),
    });

    expect(await screen.findByText("Négoce Alpha · nommé par le technicien")).toBeVisible();
    expect(screen.getByText("Négoce Alpha · nommé par le technicien, à confirmer")).toBeVisible();
    expect(screen.getByText("Comptoir Bêta · exception de l’article")).toBeVisible();
    expect(screen.getByText("Négoce Alpha · fournisseur du type Inox")).toBeVisible();
    expect(screen.getByText("Dépôt Gamma · dernier achat")).toBeVisible();
    expect(screen.queryByText(/Réf\. fournisseur/)).not.toBeInTheDocument();
  });

  it("retains in bulk only the lines that have a proposal, in one request (3, 7)", async () => {
    const lines = [
      line(),
      line({ id: LINE_B, position: 2 }),
      line({ id: LINE_C, position: 3, product_id: ARTICLE_2 }),
      line({ id: LINE_D, position: 4, supplier_id: GAMMA }),
      line({ id: LINE_E, position: 5, product_id: null, product_match: null }),
    ];
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines, articles: { [ARTICLE_1]: article(), [ARTICLE_2]: article({ id: ARTICLE_2 }) } }),
      },
      [`GET ${PROPOSALS}`]: proposals(
        {
          [LINE_A]: proposal(),
          [LINE_B]: proposal({ reason: "article", supplier_id: BETA, supplier_name: "Comptoir Bêta" }),
          [LINE_C]: proposal(),
          // A stale entry for a line that already has a supplier is never used.
          [LINE_D]: proposal(),
        },
        { [LINE_D]: { supplier_sku: null, product_url: null } },
      ),
      [`POST ${RETAIN}`]: (body) => {
        const { choices } = body as { choices: Array<{ line_id: string; supplier_id: string }> };
        return retained(
          choices.map((choice) => ({ ...lines.find((entry) => entry.id === choice.line_id)!, supplier_id: choice.supplier_id })),
        );
      },
    });

    const bulk = await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (3)" });
    await user.click(bulk);

    expect(await screen.findByText("3 fournisseurs retenus.")).toBeVisible();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: RETAIN,
        body: {
          choices: [
            { line_id: LINE_A, supplier_id: ALPHA },
            { line_id: LINE_B, supplier_id: BETA },
            { line_id: LINE_C, supplier_id: ALPHA },
          ],
        },
      },
    ]);
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Négoce Alpha");
    expect(screen.getByLabelText("Fournisseur, ligne 2")).toHaveValue("Comptoir Bêta");
    expect(screen.getByLabelText("Fournisseur, ligne 3")).toHaveValue("Négoce Alpha");
    expect(screen.getByLabelText("Fournisseur, ligne 4")).toHaveValue("Dépôt Gamma");
    expect(screen.getByLabelText("Fournisseur, ligne 5")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Retenir les fournisseurs proposés \(\d+\)$/ })).toBeDisabled();
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(2));
  });

  it("says which lines the server left alone because they had a supplier meanwhile, and shows it (3)", async () => {
    let requestReads = 0;
    const lines = [line(), line({ id: LINE_B, position: 2 })];
    const user = await openEditor({
      [`GET ${BASE}`]: () => {
        requestReads += 1;
        // Line 2 was set from another session meanwhile: the request read again shows it.
        return {
          data: detail({
            lines: requestReads === 1 ? lines : [{ ...lines[0], supplier_id: ALPHA }, { ...lines[1], supplier_id: GAMMA }],
          }),
        };
      },
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal(), [LINE_B]: proposal() }),
      [`POST ${RETAIN}`]: retained([{ ...lines[0], supplier_id: ALPHA }], [LINE_B]),
    });

    await user.click(await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (2)" }));

    expect(await screen.findByText("1 fournisseur retenu.")).toBeVisible();
    expect(screen.getByText("1 ligne avait déjà un fournisseur : non modifiée.")).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 2")).toHaveValue("Dépôt Gamma"));
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Négoce Alpha");
  });

  it("says so when a single retain finds the line already has a supplier (3)", async () => {
    let requestReads = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: () => {
        requestReads += 1;
        return { data: detail({ lines: [line(requestReads === 1 ? {} : { supplier_id: GAMMA })] }) };
      },
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal() }),
      [`POST ${RETAIN}`]: retained([], [LINE_A]),
    });

    await user.click(await screen.findByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" }));

    expect(await screen.findByText("La ligne avait déjà un fournisseur : non modifiée.")).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Dépôt Gamma"));
  });

  it("leaves out of the bulk gesture a line whose supplier choice is still on its way (3)", async () => {
    let answerChoice: (reply: Reply) => void = () => undefined;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line({ id: LINE_B, position: 2 })] }) },
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal(), [LINE_B]: proposal() }),
      [`PATCH ${BASE}/lines/${LINE_A}`]: () => new Promise<Reply>((resolve) => { answerChoice = resolve; }),
      [`POST ${RETAIN}`]: retained([line({ id: LINE_B, position: 2, supplier_id: ALPHA })]),
    });

    await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (2)" });
    await pickSupplier(user, "Fournisseur, ligne 1", "Dépôt Gamma");
    await user.click(screen.getByRole("button", { name: "Retenir les fournisseurs proposés (2)" }));
    answerChoice({ data: { line: line({ supplier_id: GAMMA }) } });

    expect(await screen.findByText("1 fournisseur retenu.")).toBeVisible();
    expect(writes()).toEqual([
      { method: "PATCH", path: `${BASE}/lines/${LINE_A}`, body: { supplier_id: GAMMA } },
      { method: "POST", path: RETAIN, body: { choices: [{ line_id: LINE_B, supplier_id: ALPHA }] } },
    ]);
    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Dépôt Gamma"));
    expect(screen.getByText(/La ligne 1 n’a pas été modifiée/)).toBeVisible();
  });

  it("shows a reader each supplier with its reference, from the proposals' answer, and no control (4, 6)", async () => {
    await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ canWrite: false, lines: [line(), line({ id: LINE_B, position: 2, supplier_id: BETA })] }),
      },
      [`GET ${PROPOSALS}`]: proposals(
        { [LINE_A]: proposal() },
        { [LINE_B]: { supplier_sku: "CB-90-50", product_url: null } },
      ),
    });

    expect(await screen.findByText("Réf. fournisseur : CB-90-50")).toBeVisible();
    const rows = screen.getAllByRole("rowgroup").filter((group) => group.tagName === "TBODY");
    expect(within(rows[1]).getByText("Comptoir Bêta")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Retenir/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Négoce Alpha ·/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fournisseur, ligne 1")).not.toBeInTheDocument();
    expect(calls.some((call) => call.path.includes("/supplier-items"))).toBe(false);
  });

  it("keeps the line as it was and says so when the save is refused (5)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal() }),
      [`POST ${RETAIN}`]: { status: 500, error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." } },
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
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal(), [LINE_B]: proposal() }),
      [`POST ${RETAIN}`]: { status: 500, error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." } },
    });

    await user.click(await screen.findByRole("button", { name: "Retenir les fournisseurs proposés (2)" }));

    expect(
      await screen.findByText("2 lignes n’ont pas reçu leur fournisseur : Enregistrement impossible pour le moment."),
    ).toBeVisible();
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("");
    expect(screen.getByLabelText("Fournisseur, ligne 2")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Retenir les fournisseurs proposés (2)" })).toBeEnabled();
  });

  it("shows the supplier of a line with its reference there, from the proposals' answer (6, 9)", async () => {
    const lines = [
      line({ supplier_id: BETA }),
      line({ id: LINE_B, position: 2, supplier_id: BETA }),
      line({ id: LINE_C, position: 3, supplier_id: ALPHA }),
    ];
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`GET ${PROPOSALS}`]: proposals({}, {
        [LINE_A]: { supplier_sku: "CB-90-50", product_url: "https://fournisseur.example/coude-50" },
        [LINE_B]: { supplier_sku: "CB-90-50", product_url: "https://fournisseur.example/coude-50" },
        [LINE_C]: { supplier_sku: "NA-1", product_url: "javascript:alert(1)" },
      }),
    });

    const rows = screen.getAllByRole("rowgroup").filter((group) => group.tagName === "TBODY");
    expect(await within(rows[0]).findByText("Réf. fournisseur : CB-90-50")).toBeVisible();
    expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Comptoir Bêta");
    const sheet = within(rows[0]).getByRole("link", { name: "Fiche chez Comptoir Bêta" });
    expect(sheet).toHaveAttribute("href", "https://fournisseur.example/coude-50");
    expect(sheet).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(rows[1]).getByText("Réf. fournisseur : CB-90-50")).toBeVisible();
    expect(within(rows[2]).getByText("Réf. fournisseur : NA-1")).toBeVisible();
    expect(within(rows[2]).queryByRole("link")).not.toBeInTheDocument();
    // One read for the whole page, never one per article.
    expect(reads(PROPOSALS)).toHaveLength(1);
    expect(calls.some((call) => call.path.includes("/supplier-items"))).toBe(false);
  });

  it("reads the proposals again after a link, an unlink, a supplier chosen or removed, or the request's supplier changed (7)", async () => {
    const linkedLine = line({ id: LINE_B, position: 2, supplier_id: ALPHA });
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines: [line(), linkedLine] }),
      },
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal() }),
      [`DELETE ${BASE}/lines/${LINE_A}/article`]: {
        data: { line: line({ product_id: null, product_match: null }) },
      },
      [`PATCH ${BASE}/lines/${LINE_B}`]: (body) => ({ data: { line: { ...linkedLine, ...(body as object) } } }),
      [`PATCH ${BASE}`]: { data: { request: request({ presumed_supplier_id: GAMMA }), reopened_line_ids: [] } },
    });

    await screen.findByText("Négoce Alpha · fournisseur du type Inox");
    expect(reads(PROPOSALS)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Délier l’article de la ligne 1" }));
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(2));

    await pickSupplier(user, "Fournisseur, ligne 2", "—");
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(3));

    // Another supplier chosen: its reference is read again with the proposals.
    await pickSupplier(user, "Fournisseur, ligne 2", "Comptoir Bêta");
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(4));

    await pickSupplier(user, "Fournisseur présumé", "Dépôt Gamma");
    await waitFor(() => expect(reads(PROPOSALS)).toHaveLength(5));
  });

  it("retains the supplier of a validated line and keeps it validated (8)", async () => {
    const validated = line({ status: "validated", validated_at: "2026-11-12T09:00:00.000Z" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [validated] }) },
      [`GET ${PROPOSALS}`]: proposals({ [LINE_A]: proposal({ reason: "article" }) }),
      [`POST ${RETAIN}`]: retained([{ ...validated, supplier_id: ALPHA }]),
    });

    await user.click(await screen.findByRole("button", { name: "Retenir le fournisseur proposé, ligne 1" }));

    await waitFor(() => expect(screen.getByLabelText("Fournisseur, ligne 1")).toHaveValue("Négoce Alpha"));
    expect(writes()).toEqual([
      { method: "POST", path: RETAIN, body: { choices: [{ line_id: LINE_A, supplier_id: ALPHA }] } },
    ]);
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
          : proposals({ [LINE_A]: proposal() });
      },
    });

    await user.click(await screen.findByRole("button", { name: "Recharger les fournisseurs proposés" }));

    expect(await screen.findByText("Négoce Alpha · fournisseur du type Inox")).toBeVisible();
    expect(screen.queryByText("Fournisseurs proposés indisponibles.")).not.toBeInTheDocument();
  });
});
