import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MaterialRequest,
  MaterialRequestArticleCandidate,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
} from "@/lib/material-requests/contracts";

/**
 * Failure modes, written before the screen (TI-690, delivery 3, « le rapprochement »). Each line of a
 * request gets linked to a catalogue article; each of these would order the wrong article, or lose the
 * operator's work:
 *  1. a proposal is linked without the operator's gesture, or the gesture links another article than the
 *     one shown, or the line still reads with the technician's words once linked (the catalogue's wording
 *     must fill its columns), or the usual name the server learned is not told;
 *  2. a proposal's warning (another size than the reference written, a draft article, another unit) is
 *     only shown after the click, or such a line is linked by the bulk gesture;
 *  3. « Rattacher les références et noms connus » links a ranked proposal, a line already linked, or
 *     announces another count than what it sends, or does not say how many lines are left;
 *  4. « Délier » leaves the article on screen, or the line comes back without its proposals;
 *  5. « Créer l'article » sends other values than the line's, or without the supply type chosen, or does
 *     not link the created article; a draft created from a request does not read as new;
 *  6. a refusal of the creation (409 reference taken, 403) throws away what was typed or is silent;
 *  7. the proposals are fetched once per line (a request per row), or not again after a link, so the
 *     usual name just learned is not used;
 *  8. a reader without write access is offered a control that would link, unlink or create;
 *  9. a line whose last change was not saved is linked: the link overwrites its columns and the typed
 *     value with its error disappears;
 * 10. a search by hand is sent without the operator's words, or its pick is recorded as a proposal;
 * 11. the creation form offers a supply type that does not exist, or says nothing when there is none;
 * 12. a link or unlink refused because the line changed since it was read (409) is silent, or leaves the
 *     old line on screen, so the operator decides again on values that are no longer stored;
 * 13. an unlink keeps the article's wording on screen although the server gave the line back its
 *     technician's words;
 * 14. a link that replaced the unit by the article's (the quantity was counted in another unit) does not
 *     say the quantity is to check.
 * 15. (Codex review of #263) a change of imputation keeps the proposals computed with the request's presumed
 *     material, which only holds for the affaire, so a stale safe proposal stays in the bulk link; a link does
 *     not tell the server which version of the line the office chose it for.
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
const ARTICLE_1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ARTICLE_2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const ARTICLE_3 = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const CREATED = "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4";
const SUPPLY_A = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
const SUPPLY_B = "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests/${REQUEST_ID}`;

function line(partial: Partial<MaterialRequestLine> = {}): MaterialRequestLine {
  return {
    id: LINE_A,
    request_id: REQUEST_ID,
    position: 1,
    original_text: "10 tiges M10",
    quantity: 10,
    quantity_doubtful: false,
    unit: "u",
    dimension: "M10",
    no_dimension: false,
    product_type: "Tige",
    material: "Acier",
    material_precision: null,
    reference: null,
    supplier_id: null,
    zone: null,
    imputation: "project",
    overhead_category: null,
    duplicate_acknowledged: false,
    status: "draft",
    validated_at: null,
    product_id: null,
    product_match: null,
    unit_price_ht_cents: null,
    price_quote_id: null,
    ...partial,
  };
}

function request(): MaterialRequest {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    technician_id: null,
    requested_on: "2026-11-10",
    needed_on: null,
    delivery_place: null,
    is_urgent: false,
    presumed_material: null,
    material_confirmed: false,
    presumed_supplier_id: null,
    supplier_confirmed: false,
    source_text: null,
    note: null,
    created_at: "2026-11-10T08:00:00.000Z",
    updated_at: "2026-11-10T08:00:00.000Z",
  };
}

function article(partial: Partial<MaterialRequestArticleSummary> = {}): MaterialRequestArticleSummary {
  return {
    id: ARTICLE_1,
    reference: "TF-M10-1M",
    designation: "Tige filetée acier zingué M10 1 m",
    product_type: "Tige filetée",
    material: "Acier zingué",
    dimensions: "M10",
    unit: "u",
    catalogue_status: "validated",
    created_from_material_request: false,
    supply_type_name: "Fixation",
    ...partial,
  };
}

function candidate(partial: Partial<MaterialRequestArticleCandidate> = {}): MaterialRequestArticleCandidate {
  return {
    article: article(),
    score: 90,
    via: "reference",
    reasons: ["Référence écrite par le technicien"],
    warnings: [],
    ...partial,
  };
}

/** The line as the server answers it once linked: the article's wording fills its columns. */
function linked(base: MaterialRequestLine, summary: MaterialRequestArticleSummary, via: MaterialRequestLine["product_match"]) {
  return {
    ...base,
    product_id: summary.id,
    product_match: via,
    product_type: summary.product_type,
    material: summary.material,
    dimension: summary.dimensions,
    unit: summary.unit,
  };
}

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };
type Route = Reply | ((body: unknown, path: string) => Reply | Promise<Reply>);
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
            ? await route(body, path)
            : route;
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload, blob: async () => new Blob([]) };
    }),
  );
}

function detail(options: {
  lines: MaterialRequestLine[];
  articles?: Record<string, MaterialRequestArticleSummary>;
  canWrite?: boolean;
}) {
  return {
    request: request(),
    technician: null,
    files: [],
    lines: options.lines,
    articles: options.articles ?? {},
    canWrite: options.canWrite ?? true,
    materialOptions: ["Acier", "Laiton brut"],
    supplierOptions: [],
  };
}

function writes(): Call[] {
  return calls.filter((call) => call.method !== "GET");
}

/** The line as the office saw it when choosing: the server refuses the link if it changed since. */
function seen(of: MaterialRequestLine) {
  const { reference, product_type, material, material_precision, dimension, unit, imputation } = of;
  return { reference, product_type, material, material_precision, dimension, unit, imputation };
}

function candidateReads(): Call[] {
  return calls.filter((call) => call.method === "GET" && call.path === `${BASE}/candidates`);
}

async function openEditor(routes: Record<string, Route>) {
  mockApi({
    "GET /api/material-request-technicians": { data: { items: [] } },
    [`GET ${BASE}/quotes`]: { data: { items: [] } },
    ...routes,
  });
  const user = userEvent.setup();
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} />);
  await screen.findByRole("heading", { name: "Lignes" });
  return user;
}

const BULK = /^Rattacher les références et noms connus \(\d+\)$/;

describe("linking request lines to catalogue articles", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("links the first proposal in one click, fills the columns with the article's wording and tells the usual name learned (1)", async () => {
    const result = linked(line(), article(), "reference");
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate()] } } },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: { data: { line: result, article: article(), alias_learned: "tige" } },
    });

    const link = await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" });
    expect(screen.getByText("Tige filetée acier zingué M10 1 m")).toBeVisible();
    expect(screen.getByText("Référence écrite par le technicien")).toBeVisible();
    // Shown is not linked: nothing was written before the gesture.
    expect(writes()).toEqual([]);

    await user.click(link);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: `${BASE}/lines/${LINE_A}/article`,
      body: { product_id: ARTICLE_1, via: "reference", expected_line: seen(line()) },
    });
    expect(await screen.findByText("Nom usuel retenu : « tige »")).toBeVisible();
    expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Tige filetée");
    expect(screen.getByLabelText("Matière, ligne 1")).toHaveValue("Acier zingué");
    expect(screen.getByText("TF-M10-1M")).toBeVisible();
    expect(screen.getByText("par la référence")).toBeVisible();
    // The technician's own words stay beside the rewritten columns.
    expect(screen.getByText("« 10 tiges M10 »")).toBeVisible();
    expect(screen.getByRole("button", { name: "Délier l’article de la ligne 1" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Rattacher l’article proposé à la ligne 1" })).not.toBeInTheDocument();
  });

  it("shows a proposal's warning before the click and keeps that line out of the bulk link (2)", async () => {
    const lineB = line({ id: LINE_B, position: 2, original_text: "4 tiges M12 ref TF-M10" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), lineB] }) },
      [`GET ${BASE}/candidates`]: {
        data: {
          lines: {
            [LINE_A]: [candidate()],
            [LINE_B]: [candidate({ warnings: ["La ligne indique une autre dimension que la référence (M12)."] })],
          },
        },
      },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: { data: { line: linked(line(), article(), "reference"), article: article(), alias_learned: null } },
    });

    const warning = await screen.findByText("À vérifier : La ligne indique une autre dimension que la référence (M12).");
    expect(warning).toBeVisible();
    expect(screen.getByRole("button", { name: "Rattacher l’article proposé à la ligne 2" })).toHaveAccessibleDescription(
      expect.stringContaining("autre dimension"),
    );

    await user.click(screen.getByRole("button", { name: "Rattacher les références et noms connus (1)" }));

    expect(await screen.findByText("1 ligne rattachée · 1 reste sans article, à choisir une par une.")).toBeVisible();
    expect(writes().map((call) => call.path)).toEqual([`${BASE}/lines/${LINE_A}/article`]);
    expect(screen.getByRole("button", { name: "Rattacher l’article proposé à la ligne 2" })).toBeEnabled();
  });

  it("links in bulk only reference and usual-name proposals without a warning, and reports the counts (3)", async () => {
    const lines = [
      line(),
      line({ id: LINE_B, position: 2, product_type: "Écrou" }),
      line({ id: LINE_C, position: 3, product_type: "Rondelle" }),
      line({ id: LINE_D, position: 4, product_type: "Cheville" }),
    ];
    const answers: Record<string, MaterialRequestArticleSummary> = {
      [LINE_A]: article({ id: ARTICLE_1 }),
      [LINE_C]: article({ id: ARTICLE_3, designation: "Rondelle plate M10", reference: "RP-M10" }),
    };
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`GET ${BASE}/candidates`]: {
        data: {
          lines: {
            [LINE_A]: [candidate({ via: "alias", reasons: ["Nom usuel appris : « tige »"] })],
            [LINE_B]: [candidate({ via: "ranked", article: article({ id: ARTICLE_2, designation: "Écrou hexagonal M10" }) })],
            [LINE_C]: [candidate({ article: answers[LINE_C] })],
            [LINE_D]: [],
          },
        },
      },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: { data: { line: linked(lines[0], answers[LINE_A], "alias"), article: answers[LINE_A], alias_learned: null } },
      [`PUT ${BASE}/lines/${LINE_C}/article`]: { data: { line: linked(lines[2], answers[LINE_C], "reference"), article: answers[LINE_C], alias_learned: "rondelle" } },
    });

    expect(await screen.findByRole("button", { name: "Rattacher les références et noms connus (2)" })).toBeEnabled();
    expect(screen.getByText("Aucun article proposé.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Rattacher les références et noms connus (2)" }));

    expect(await screen.findByText("2 lignes rattachées · 2 restent sans article, à choisir une par une.")).toBeVisible();
    expect(writes()).toEqual([
      { method: "PUT", path: `${BASE}/lines/${LINE_A}/article`, body: { product_id: ARTICLE_1, via: "alias", expected_line: seen(lines[0]) } },
      { method: "PUT", path: `${BASE}/lines/${LINE_C}/article`, body: { product_id: ARTICLE_3, via: "reference", expected_line: seen(lines[2]) } },
    ]);
    expect(screen.getByText("Nom usuel retenu : « rondelle »")).toBeVisible();
    expect(screen.getByRole("button", { name: "Rattacher l’article proposé à la ligne 2" })).toBeEnabled();
    expect(screen.getByRole("button", { name: BULK })).toBeDisabled();
  });

  it("unlinks an article and shows the line's proposals again (4)", async () => {
    const linkedLine = linked(line(), article(), "reference");
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [linkedLine], articles: { [ARTICLE_1]: article() } }) },
      [`GET ${BASE}/candidates`]: () => ({
        data: { lines: candidateReads().length > 1 ? { [LINE_A]: [candidate()] } : {} },
      }),
      // The server gives the line back the technician's words it had before its first link.
      [`DELETE ${BASE}/lines/${LINE_A}/article`]: { data: { line: line() } },
    });

    expect(await screen.findByText("Tige filetée acier zingué M10 1 m")).toBeVisible();
    expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Tige filetée");
    await user.click(screen.getByRole("button", { name: "Délier l’article de la ligne 1" }));

    await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", path: `${BASE}/lines/${LINE_A}/article`, body: null }]));
    expect(await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Délier l’article de la ligne 1" })).not.toBeInTheDocument();
    expect(candidateReads()).toHaveLength(2);
    // (13) The columns read the technician's words again, as the server answered.
    expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Tige");
    expect(screen.getByLabelText("Matière, ligne 1")).toHaveValue("Acier");
  });

  it("keeps a line whose proposal ties with another article out of the bulk link (2)", async () => {
    const lineB = line({ id: LINE_B, position: 2, product_type: "Écrou" });
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), lineB] }) },
      [`GET ${BASE}/candidates`]: {
        data: {
          lines: {
            [LINE_A]: [candidate()],
            [LINE_B]: [
              candidate({
                via: "reference",
                article: article({ id: ARTICLE_2, designation: "Écrou hexagonal M10" }),
                warnings: ["Plusieurs articles portent cette référence : choisissez."],
              }),
              candidate({
                via: "reference",
                article: article({ id: ARTICLE_3, designation: "Écrou frein M10" }),
                warnings: ["Plusieurs articles portent cette référence : choisissez."],
              }),
            ],
          },
        },
      },
    });

    expect(
      await screen.findByText("À vérifier : Plusieurs articles portent cette référence : choisissez."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Rattacher les références et noms connus (1)" })).toBeEnabled();
  });

  it("shows the server's sentence on the line and reads the request again when the line changed meanwhile (12)", async () => {
    const changedElsewhere = line({ product_type: "Tige inox", material: "Inox A2" });
    let reads = 0;
    const sentence = "La ligne a changé entre-temps : rechargez la demande, puis rattachez-la à nouveau.";
    const user = await openEditor({
      [`GET ${BASE}`]: () => {
        reads += 1;
        return { data: detail({ lines: [reads === 1 ? line() : changedElsewhere] }) };
      },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate()] } } },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: {
        status: 409,
        error: { code: "MATERIAL_REQUEST_LINE_CHANGED", message: sentence },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" }));

    expect(await screen.findByText(sentence)).toBeVisible();
    expect(screen.getAllByText(sentence)).toHaveLength(1);
    await waitFor(() => expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Tige inox"));
    expect(reads).toBe(2);
    expect(screen.getByLabelText("Matière, ligne 1")).toHaveValue("Inox A2");
    expect(screen.queryByRole("button", { name: "Délier l’article de la ligne 1" })).not.toBeInTheDocument();
    // Its proposals are read again for the line as it now is.
    await waitFor(() => expect(candidateReads()).toHaveLength(2));
  });

  it("says the quantity is to check when the link replaced the unit by the article's (14)", async () => {
    const inMetres = line({ unit: "m", quantity: 3 });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [inMetres] }) },
      [`GET ${BASE}/candidates`]: {
        data: { lines: { [LINE_A]: [candidate({ warnings: ["Unité différente : l’article se compte en u."] })] } },
      },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: {
        data: {
          line: { ...linked(inMetres, article(), "reference"), quantity_doubtful: true },
          article: article(),
          alias_learned: null,
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" }));

    expect(await screen.findByText("Unité changée pour celle de l’article : vérifiez la quantité.")).toBeVisible();
    expect(screen.getByLabelText("Unité, ligne 1")).toHaveValue("u");
    expect(screen.getByLabelText("Quantité à vérifier, ligne 1")).toBeChecked();
    expect(screen.queryByText(/Nom usuel retenu/)).not.toBeInTheDocument();
  });

  describe("creating the article a line names", () => {
    const created = article({
      id: CREATED,
      reference: null,
      designation: "Tige acier M10",
      product_type: "Tige",
      material: "Acier",
      catalogue_status: "draft",
      created_from_material_request: true,
      supply_type_name: "Fixation",
    });
    const supplyTypes: Route = {
      data: {
        items: [
          { id: SUPPLY_A, code: "FIX", name: "Fixation" },
          { id: SUPPLY_B, code: "ROB", name: "Robinetterie" },
        ],
      },
    };

    async function openCreation(routes: Record<string, Route>) {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [] } } },
        "GET /api/catalogue/supply-types": supplyTypes,
        ...routes,
      });
      await user.click(await screen.findByRole("button", { name: "Chercher ou créer l’article, ligne 1" }));
      const panel = await screen.findByRole("dialog", { name: "Article de la ligne 1" });
      await user.click(within(panel).getByRole("button", { name: "Créer l’article" }));
      await within(panel).findByRole("option", { name: "Robinetterie" });
      return { user, panel };
    }

    it("sends the line's values and the chosen supply type, then links the new draft, shown as new (5)", async () => {
      const { user, panel } = await openCreation({
        [`POST ${BASE}/lines/${LINE_A}/article`]: {
          status: 201,
          data: { line: linked(line(), created, "created"), article: created, alias_learned: null },
        },
      });

      expect(within(panel).getByLabelText("Type d’article *")).toHaveValue("Tige");
      expect(within(panel).getByLabelText("Matière *")).toHaveValue("Acier");
      expect(within(panel).getByLabelText("Dimension")).toHaveValue("M10");
      expect(within(panel).getByLabelText("Unité *")).toHaveValue("u");
      expect(within(panel).getByLabelText("Désignation")).toHaveValue("");
      // The supply type is the operator's choice: nothing is chosen for them.
      expect(within(panel).getByLabelText("Type de fourniture *")).toHaveValue("");

      await user.selectOptions(within(panel).getByLabelText("Type de fourniture *"), "Fixation");
      await user.click(within(panel).getByRole("button", { name: "Créer et rattacher" }));

      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]).toEqual({
        method: "POST",
        path: `${BASE}/lines/${LINE_A}/article`,
        body: { product_type: "Tige", material: "Acier", dimensions: "M10", unit: "u", supply_type_id: SUPPLY_A },
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByText("Tige acier M10")).toBeVisible();
      expect(screen.getByText("Nouveau")).toBeVisible();
      expect(screen.getByText("créé depuis cette ligne")).toBeVisible();
    });

    it("keeps what was typed and shows the server's sentence when the reference is taken (6)", async () => {
      const { user, panel } = await openCreation({
        [`POST ${BASE}/lines/${LINE_A}/article`]: {
          status: 409,
          error: { code: "CONFLICT", message: "La référence « TG-10 » est déjà utilisée par un autre article." },
        },
      });

      await user.type(within(panel).getByLabelText("Référence"), "TG-10");
      await user.type(within(panel).getByLabelText("Désignation"), "Tige acier M10 longue");
      await user.selectOptions(within(panel).getByLabelText("Type de fourniture *"), "Robinetterie");
      await user.click(within(panel).getByRole("button", { name: "Créer et rattacher" }));

      expect(await within(panel).findByRole("alert")).toHaveTextContent(
        "La référence « TG-10 » est déjà utilisée par un autre article.",
      );
      expect(writes()[0].body).toEqual({
        designation: "Tige acier M10 longue",
        product_type: "Tige",
        material: "Acier",
        dimensions: "M10",
        unit: "u",
        supply_type_id: SUPPLY_B,
        reference: "TG-10",
      });
      expect(within(panel).getByLabelText("Référence")).toHaveValue("TG-10");
      expect(within(panel).getByLabelText("Désignation")).toHaveValue("Tige acier M10 longue");
      expect(within(panel).getByLabelText("Type de fourniture *")).toHaveValue(SUPPLY_B);
      // Nothing was linked: the line still offers its search, behind the open panel.
      expect(screen.getByRole("button", { name: "Chercher ou créer l’article, ligne 1", hidden: true })).toBeInTheDocument();
    });

    it("says there is no supply type yet and points to the catalogue (11)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [] } } },
        "GET /api/catalogue/supply-types": { data: { items: [] } },
      });
      await user.click(await screen.findByRole("button", { name: "Chercher ou créer l’article, ligne 1" }));
      const panel = await screen.findByRole("dialog", { name: "Article de la ligne 1" });
      await user.click(within(panel).getByRole("button", { name: "Créer l’article" }));

      expect(await within(panel).findByText(/Aucun type de fourniture n’existe encore/)).toBeVisible();
      expect(within(panel).getByRole("link", { name: "Ouvrir le catalogue" })).toHaveAttribute("href", "/dashboard/products");
      expect(within(panel).getByRole("button", { name: "Créer et rattacher" })).toBeDisabled();
    });
  });

  it("fetches the proposals once for the whole page, and again after a link (7)", async () => {
    const lines = [line(), line({ id: LINE_B, position: 2, product_type: "Écrou" })];
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate()], [LINE_B]: [] } } },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: { data: { line: linked(lines[0], article(), "reference"), article: article(), alias_learned: null } },
    });

    await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" });
    expect(candidateReads()).toHaveLength(1);
    expect(calls.filter((call) => call.path.includes("/candidates?") || call.path.endsWith(`/lines/${LINE_A}/candidates`))).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Rattacher l’article proposé à la ligne 1" }));

    await waitFor(() => expect(candidateReads()).toHaveLength(2));
    // A zone tells nothing about the article: changing it does not ask for proposals again.
    await user.type(screen.getByLabelText("Repère, ligne 2"), "R+1");
    await user.tab();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(candidateReads()).toHaveLength(2);
  });

  it("asks for proposals again once the line's imputation changes: the presumed material only holds for the affaire (15)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line({ material: null })] }) },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate({ via: "alias" })] } } },
      [`PATCH ${BASE}/lines/${LINE_A}`]: { data: { line: line({ material: null, imputation: "overhead" }) } },
    });
    await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" });
    expect(candidateReads()).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText("Imputation, ligne 1"), "Frais généraux");

    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(candidateReads()).toHaveLength(2));
  });

  it("offers no control that links, unlinks or creates to a reader (8)", async () => {
    await openEditor({
      [`GET ${BASE}`]: {
        data: detail({
          canWrite: false,
          lines: [linked(line(), article(), "alias"), line({ id: LINE_B, position: 2 })],
          articles: { [ARTICLE_1]: article() },
        }),
      },
    });

    expect(screen.getByText("Tige filetée acier zingué M10 1 m")).toBeVisible();
    expect(screen.getByText("par un nom usuel")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Rattacher|Délier|Autres propositions|Chercher ou créer/ })).not.toBeInTheDocument();
    expect(candidateReads()).toEqual([]);
  });

  it("does not link a line whose last change could not be saved, and says why (9)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate()] } } },
      [`PATCH ${BASE}/lines/${LINE_A}`]: { status: 500, error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." } },
    });
    expect(await screen.findByRole("button", { name: "Rattacher les références et noms connus (1)" })).toBeEnabled();

    await user.type(screen.getByLabelText("Repère, ligne 1"), "Chaufferie");
    await user.tab();
    await screen.findByRole("alert");

    const link = screen.getByRole("button", { name: "Rattacher l’article proposé à la ligne 1" });
    expect(link).toBeDisabled();
    expect(link).toHaveAccessibleDescription(expect.stringContaining("Une modification de cette ligne n’est pas enregistrée"));
    expect(screen.getByRole("button", { name: "Rattacher les références et noms connus (0)" })).toBeDisabled();
    expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("Chaufferie");
    expect(writes().map((call) => call.method)).toEqual(["PATCH"]);
  });

  it("searches the catalogue with the operator's words and records the pick as chosen by hand (10)", async () => {
    const found = article({ id: ARTICLE_2, reference: "GJ-M10", designation: "Goujon d’ancrage M10" });
    const searchPath = `${BASE}/lines/${LINE_A}/candidates?q=goujon`;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate(), candidate({ via: "ranked", article: article({ id: ARTICLE_3, designation: "Tige filetée inox M10" }) })] } } },
      [`GET ${searchPath}`]: { data: { candidates: [candidate({ via: "ranked", article: found, reasons: ["Même type et même dimension"] })] } },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: { data: { line: linked(line(), found, "manual"), article: found, alias_learned: "tige" } },
    });

    await user.click(await screen.findByRole("button", { name: "Autres propositions, ligne 1" }));
    const panel = await screen.findByRole("dialog", { name: "Article de la ligne 1" });
    // Every proposal of the line, not only the first one.
    expect(within(panel).getByText("Tige filetée inox M10")).toBeVisible();

    await user.type(within(panel).getByLabelText("Chercher dans le catalogue"), "goujon");
    await user.click(within(panel).getByRole("button", { name: "Chercher" }));
    await user.click(await within(panel).findByRole("button", { name: "Rattacher « Goujon d’ancrage M10 »" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(calls.some((call) => call.path === searchPath)).toBe(true);
    expect(writes()[0].body).toEqual({ product_id: ARTICLE_2, via: "manual", expected_line: seen(line()) });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Goujon d’ancrage M10")).toBeVisible();
    expect(screen.getByText("Nom usuel retenu : « tige »")).toBeVisible();
  });

  it("says a validated line returns to draft before linking it, and shows it as a draft after (1)", async () => {
    const validated = line({ status: "validated", validated_at: "2026-11-10T09:00:00.000Z" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [validated] }) },
      [`GET ${BASE}/candidates`]: { data: { lines: { [LINE_A]: [candidate()] } } },
      [`PUT ${BASE}/lines/${LINE_A}/article`]: { data: { line: linked(line(), article(), "reference"), article: article(), alias_learned: null } },
    });

    const link = await screen.findByRole("button", { name: "Rattacher l’article proposé à la ligne 1" });
    expect(link).toHaveAccessibleDescription(expect.stringContaining("La ligne repassera en brouillon."));
    // A validated line is never part of the bulk link: it would leave the validated lines without a word.
    expect(screen.getByRole("button", { name: "Rattacher les références et noms connus (0)" })).toBeDisabled();

    await user.click(link);

    expect(await screen.findByText("Ligne repassée en brouillon.")).toBeVisible();
    expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Tige filetée");
  });
});
