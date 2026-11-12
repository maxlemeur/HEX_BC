import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MaterialRequest,
  MaterialRequestArticleSummary,
  MaterialRequestFile,
  MaterialRequestLine,
} from "@/lib/material-requests/contracts";
import type { MaterialRequestQuote, MaterialRequestQuoteLine } from "@/lib/material-requests/quote-contracts";
import { formatEUR } from "@/lib/money";

/** The amount as the screen writes it, spaces as the queries read them (no-break spaces normalised). */
const euros = (cents: number) => formatEUR(cents).replace(/\s/g, " ");

/**
 * Failure modes, written before the screen (TI-691, lot 2 « l'achat », delivery 2 « consultation »). The office
 * asks suppliers for a price with a message it copies into WhatsApp (MergeOne sends nothing), attaches what comes
 * back, prices it and retains one quote. Each of these would buy at the wrong price, tell a competitor who supplies
 * us, or lose the office's work:
 *  1. the usual supplier's message misses its reference there, or is offered to copy before the references are
 *     read (the message copied would then differ from the one recorded);
 *  2. a competition message carries a reference: the usual supplier's, the article's internal one, or the one the
 *     technician wrote;
 *  3. « Copier » copies another text than the one shown, or a refused copy is silent;
 *  4. « Consultation envoyée » records another message than the one copied, other lines (one without supplier, one
 *     already priced) or the wrong variant, or a refusal (the supplier already has a quote) is silent;
 *  5. a line without supplier is consulted, or is not said apart with what to do;
 *  6. a typed price is lost when its save is refused, or another amount is saved (« 12,50 » is 1250 cents), or an
 *     unreadable one is sent;
 *  7. « Retenir ce devis » is offered before the quote is received and every line priced, or while a refused price
 *     is on screen, or without saying why not;
 *  8. once a quote is retained, the lines do not show its supplier and unit prices as the server answered, or the
 *     competing quotes still look open;
 *  9. a retained or closed quote can still be changed (prices, files, actions), or a quote is closed without a
 *     confirmation;
 * 10. a reader is offered a message, a copy, a send, a price input or an action;
 * 11. the supplier's PDF is not attached to its quote (prepared with the quote's id, sent as a PDF), is listed
 *     among the originals, or cannot be opened.
 * Independent review of delivery 2:
 * 12. a line whose only words are a reference is put in competition as is, without the office being told it
 *     needs a type first;
 * 13. a retained quote keeps its supplier « consulted »: lines added later for that supplier can no longer be asked;
 *     or a competitor consulted for other lines reads as consulted for these, or the server's refusal for that
 *     reason is said in code words;
 * 14. a sub-cent price (0,034 €) cannot be entered, or is entered for 1 unit when the supplier gave it for 100, or a
 *     total multiplies the price for 100 by the quantity.
 * Review of PR #279:
 * 15. a saved price replaced by text that cannot be read (« 12,505 ») leaves « Retenir ce devis » offered: the
 *     retain would apply the saved price while the field shows another one;
 * 16. the first read of the quotes answers after a consultation was recorded and erases it from the screen, which
 *     then offers « Consultation envoyée » again; or « Consultation envoyée » is offered before the screen knows
 *     which consultations exist.
 * 17. a quote is retained while one of its lines is a draft (what is bought would not be what was checked): at the
 *     gesture, or at its turn in the queue after the line was reopened; or the server's refusal is not said.
 * 18. after a refused price (the field shows 20 €, 10 € is saved), choosing « pour 100 » saves the saved 10 € for
 *     100 and releases « Retenir ce devis », which would apply 10 € les 100 while the field shows 20 €; or a lot
 *     change sends something while the price shown cannot be read.
 */

const { storageFromMock, uploadToSignedUrlMock } = vi.hoisted(() => ({
  storageFromMock: vi.fn(),
  uploadToSignedUrlMock: vi.fn(),
}));
vi.mock("@/lib/material-requests/source-text", () => ({ splitSourceText: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ storage: { from: storageFromMock } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { MaterialRequestEditor } from "@/components/material-requests/MaterialRequestEditor";
import type { MaterialRequestEditorApi } from "@/components/material-requests/useMaterialRequestEditor";
import { useMaterialRequestQuotes } from "@/components/material-requests/useMaterialRequestQuotes";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const LINE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ARTICLE_1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ARTICLE_2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const ALPHA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BETA = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const GAMMA = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const QUOTE_A = "9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a";
const QUOTE_B = "9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b";
const QUOTE_G = "9c9c9c9c-9c9c-49c9-89c9-9c9c9c9c9c9c";
const FILE_PDF = "8f8f8f8f-8f8f-48f8-88f8-8f8f8f8f8f8f";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests/${REQUEST_ID}`;
const QUOTES = `${BASE}/quotes`;
const PROPOSALS = `${BASE}/supplier-proposals`;
const AFFAIRE = "Résidence des Tilleuls";
const SUPPLIERS = [
  { id: ALPHA, name: "Négoce Alpha" },
  { id: BETA, name: "Comptoir Bêta" },
  { id: GAMMA, name: "Dépôt Gamma" },
];

/** `price_per` (review of delivery 2): a price is in whole cents for that many units, on quote and request lines. */
type Line = MaterialRequestLine;
type QuoteLine = MaterialRequestQuoteLine;
type Quote = MaterialRequestQuote;

function line(partial: Partial<Line> = {}): Line {
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
    supplier_id: ALPHA,
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

const TEE = { id: LINE_B, position: 2, original_text: "4 tés inox 50", quantity: 4, product_type: "Té égal", product_id: ARTICLE_2 };
/** A quote is retained only on validated lines (review of PR #279). */
const VALIDATED = { status: "validated" as const, validated_at: "2026-11-13T09:00:00.000Z" };

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

function quote(partial: Partial<Quote> = {}): Quote {
  return {
    id: QUOTE_A,
    request_id: REQUEST_ID,
    supplier_id: ALPHA,
    supplier_name: "Négoce Alpha",
    status: "requested",
    with_references: true,
    message: "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :\n- 20 u Coude 90° — réf. NA-4471\nMerci !",
    requested_at: "2026-11-12T09:00:00.000Z",
    received_at: null,
    amount_ht_cents: null,
    notes: null,
    retained_at: null,
    closed_at: null,
    lines: [
      { line_id: LINE_A, unit_price_ht_cents: null, price_per: 1 },
      { line_id: LINE_B, unit_price_ht_cents: null, price_per: 1 },
    ],
    files: [],
    ...partial,
  };
}

function pdfFile(partial: Partial<MaterialRequestFile> = {}): MaterialRequestFile {
  return {
    id: FILE_PDF,
    request_id: REQUEST_ID,
    quote_id: QUOTE_A,
    file_name: "devis-alpha.pdf",
    mime_type: "application/pdf",
    byte_size: PDF.length,
    rotation: 0,
    created_at: "2026-11-13T10:00:00.000Z",
    ...partial,
  };
}

/** A tiny PDF, invented here: one empty page. */
const PDF = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj",
  "trailer << /Root 1 0 R >>",
  "%%EOF",
].join("\n");

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

function detail(options: { lines: MaterialRequestLine[]; request?: Partial<MaterialRequest>; canWrite?: boolean }) {
  return {
    request: request(options.request),
    technician: null,
    files: [],
    lines: options.lines,
    articles: { [ARTICLE_1]: article(), [ARTICLE_2]: article({ id: ARTICLE_2, reference: "TE-I316-50", designation: "Té égal inox 316L DN 50", product_type: "Té égal" }) },
    canWrite: options.canWrite ?? true,
    materialOptions: ["Inox 316L"],
    supplierOptions: SUPPLIERS,
  };
}

/** The references at the lines' supplier, as the proposals route answers them. */
function references(entries: Record<string, string | null>) {
  return {
    data: {
      lines: {},
      references: Object.fromEntries(
        Object.entries(entries).map(([lineId, sku]) => [lineId, { supplier_sku: sku, product_url: null }]),
      ),
    },
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
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} affaireName={AFFAIRE} />);
  await screen.findByRole("heading", { name: "Consultation" });
  return user;
}

function quoteCard(supplier: string) {
  return screen.getByRole("article", { name: `Devis ${supplier}` });
}

describe("consultation of suppliers", () => {
  beforeEach(() => {
    uploadToSignedUrlMock.mockReset();
    uploadToSignedUrlMock.mockImplementation(async (path: string) => ({ data: { path }, error: null }));
    storageFromMock.mockReset();
    storageFromMock.mockReturnValue({ uploadToSignedUrl: uploadToSignedUrlMock });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("copies the usual supplier's message with its references, and records that very message as sent (1, 3, 4, 5)", async () => {
    const lines = [
      line(),
      line(TEE),
      line({ id: LINE_C, position: 3, supplier_id: null, product_type: "Bride plate", product_id: null, product_match: null, original_text: "2 brides 50" }),
    ];
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines, request: { delivery_place: "site" } }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: { data: { items: [] } },
      [`POST ${QUOTES}`]: (body) => {
        const input = body as { supplier_id: string; line_ids: string[]; with_references: boolean; message: string };
        return {
          status: 201,
          data: {
            item: quote({
              message: input.message,
              lines: input.line_ids.map((line_id) => ({ line_id, unit_price_ht_cents: null, price_per: 1 })),
            }),
          },
        };
      },
    });
    const expected = [
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :",
      "- 20 u Coude 90° — réf. NA-4471",
      "- 4 u Té égal, DN 50, Inox 316L",
      "Livraison : chantier",
      "Merci !",
    ].join("\n");

    const message = await screen.findByRole("textbox", { name: "Message pour Négoce Alpha" });
    expect(message).toHaveValue(expected);
    expect(message).toHaveAttribute("readonly");
    // The line without supplier is said apart, with what to do, and is in no message.
    expect(screen.getByText("Sans fournisseur : choisissez-en un dans la colonne Fournisseur.")).toBeVisible();
    expect(screen.getByText("Ligne 3 · Bride plate DN 50")).toBeVisible();
    expect(screen.getByText("Aucune consultation envoyée pour le moment.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Copier le message pour Négoce Alpha" }));
    expect(await screen.findByText("Message copié.")).toBeVisible();
    expect(await navigator.clipboard.readText()).toBe(expected);
    // Copied is not sent: nothing is recorded before the office says so.
    expect(writes()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Consultation envoyée à Négoce Alpha" }));

    expect(await screen.findByText("Consultation envoyée le 12/11/2026.")).toBeVisible();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: QUOTES,
        body: { supplier_id: ALPHA, line_ids: [LINE_A, LINE_B], with_references: true, message: expected },
      },
    ]);
    // Recorded once: the button gives way to the date, and the quote is listed, asked and awaited.
    expect(screen.queryByRole("button", { name: "Consultation envoyée à Négoce Alpha" })).not.toBeInTheDocument();
    const card = quoteCard("Négoce Alpha");
    expect(within(card).getByText("Demandé")).toBeVisible();
    expect(within(card).getByText("avec références")).toBeVisible();
    expect(within(card).getByText("Demandé le 12/11/2026")).toBeVisible();
  });

  it("offers the message only once the references at the supplier are read (1)", async () => {
    let answer!: (reply: Reply) => void;
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: () => new Promise<Reply>((resolve) => (answer = resolve)),
      [`GET ${QUOTES}`]: { data: { items: [] } },
    });

    expect(await screen.findByText("Lecture des références chez Négoce Alpha…")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Message pour Négoce Alpha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Consultation envoyée à Négoce Alpha" })).not.toBeInTheDocument();

    answer(references({ [LINE_A]: "NA-4471" }));

    expect(await screen.findByRole("textbox", { name: "Message pour Négoce Alpha" })).toHaveValue(
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :\n- 20 u Coude 90° — réf. NA-4471\nMerci !",
    );
  });

  it("puts other suppliers in competition with a message that names no reference at all (2, 3, 4)", async () => {
    let quotes: Quote[] = [];
    const user = await openEditor({
      // The technician wrote a reference, the article has an internal one, Alpha has its own.
      [`GET ${BASE}`]: { data: detail({ lines: [line({ reference: "471205" })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471" }),
      [`GET ${QUOTES}`]: () => ({ data: { items: quotes } }),
      [`POST ${QUOTES}`]: (body) => {
        const input = body as { supplier_id: string; line_ids: string[]; with_references: boolean; message: string };
        if (input.supplier_id === GAMMA) {
          // Recorded meanwhile from another tab: the server refuses a second one.
          quotes = [...quotes, quote({ id: QUOTE_G, supplier_id: GAMMA, supplier_name: "Dépôt Gamma", with_references: false })];
          return {
            status: 409,
            error: { code: "MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN", message: "Dépôt Gamma a déjà un devis en cours pour cette demande." },
          };
        }
        const item = quote({
          id: QUOTE_B,
          supplier_id: input.supplier_id,
          supplier_name: "Comptoir Bêta",
          with_references: input.with_references,
          message: input.message,
          lines: input.line_ids.map((line_id) => ({ line_id, unit_price_ht_cents: null, price_per: 1 })),
        });
        quotes = [...quotes, item];
        return { status: 201, data: { item } };
      },
    });
    const competition = [
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :",
      "- 20 u Coude 90°, DN 50, Inox 316L",
      "Merci !",
    ].join("\n");

    const toggle = await screen.findByRole("button", { name: "Mettre en concurrence les lignes de Négoce Alpha" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The usual supplier is not its own competitor.
    expect(screen.queryByRole("checkbox", { name: "Négoce Alpha" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Comptoir Bêta" }));

    const message = screen.getByRole("textbox", { name: "Message pour Comptoir Bêta" });
    expect(message).toHaveValue(competition);
    expect((message as HTMLTextAreaElement).value).not.toMatch(/réf|NA-4471|471205|CD-I316/i);

    // A copy the browser refuses is said, so the office copies by hand.
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new DOMException("Refusé", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: "Copier le message pour Comptoir Bêta" }));
    expect(
      await screen.findByText("La copie a été refusée par le navigateur : sélectionnez le texte et copiez-le à la main."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Consultation envoyée à Comptoir Bêta" }));
    await waitFor(() => expect(quoteCard("Comptoir Bêta")).toBeVisible());
    expect(writes()).toEqual([
      {
        method: "POST",
        path: QUOTES,
        body: { supplier_id: BETA, line_ids: [LINE_A], with_references: false, message: competition },
      },
    ]);
    expect(within(quoteCard("Comptoir Bêta")).getByText("mise en concurrence")).toBeVisible();

    // A refusal is said beside the button in plain words, not the server's code, and the quotes are read again so
    // the screen shows the consultation recorded meanwhile.
    await user.click(screen.getByRole("checkbox", { name: "Dépôt Gamma" }));
    const readsBefore = reads(QUOTES).length;
    await user.click(screen.getByRole("button", { name: "Consultation envoyée à Dépôt Gamma" }));
    expect(
      await screen.findByText(
        "Non enregistré : Dépôt Gamma a déjà une consultation en cours pour cette demande : retenez ou fermez d’abord son devis (« Clore »), puis consultez-le de nouveau.",
      ),
    ).toBeVisible();
    await waitFor(() => expect(reads(QUOTES).length).toBeGreaterThan(readsBefore));
    expect(await screen.findByRole("article", { name: "Devis Dépôt Gamma" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Consultation envoyée à Dépôt Gamma" })).not.toBeInTheDocument();
  });

  it("asks for a type before putting in competition a line whose only words carry a reference (12)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({
          lines: [
            line(),
            line({ ...TEE, product_type: null, product_id: null, product_match: null, dimension: null, material: null, original_text: "réf NA-4471 x4", reference: "NA-4471" }),
          ],
        }),
      },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471" }),
      [`GET ${QUOTES}`]: { data: { items: [] } },
    });

    // The usual supplier's message is as before: the technician's words are his own reference there.
    expect(await screen.findByRole("textbox", { name: "Message pour Négoce Alpha" })).toHaveValue(
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :\n- 20 u Coude 90° — réf. NA-4471\n- 4 u réf NA-4471 x4\nMerci !",
    );
    await user.click(screen.getByRole("button", { name: "Mettre en concurrence les lignes de Négoce Alpha" }));
    expect(screen.getByText("Ligne 2 : donnez-lui un type dans le tableau avant de la mettre en concurrence.")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Comptoir Bêta" }));

    const message = screen.getByRole("textbox", { name: "Message pour Comptoir Bêta" });
    expect(message).toHaveValue(
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :\n- 20 u Coude 90°, DN 50, Inox 316L\n- 4 u Article à préciser (ligne 2)\nMerci !",
    );
    expect((message as HTMLTextAreaElement).value).not.toMatch(/NA-4471|r[ée]f/i);
  });

  it("consults again the lines added after its supplier's quote was retained (13)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({
          lines: [
            line({ unit_price_ht_cents: 1250, price_quote_id: QUOTE_A, price_per: 1 }),
            line({ ...TEE, id: LINE_C, position: 3 }),
          ],
        }),
      },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_C]: null }),
      [`GET ${QUOTES}`]: {
        data: {
          items: [
            quote({
              status: "retained",
              received_at: "2026-11-13T10:00:00.000Z",
              retained_at: "2026-11-14T08:00:00.000Z",
              lines: [{ line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 }],
            }),
          ],
        },
      },
      [`POST ${QUOTES}`]: (body) => ({
        status: 201,
        data: { item: quote({ id: QUOTE_B, message: (body as { message: string }).message, lines: [{ line_id: LINE_C, unit_price_ht_cents: null, price_per: 1 }] }) },
      }),
    });

    const group = await screen.findByRole("group", { name: "Négoce Alpha" });
    expect(within(group).getByText("2 lignes · 1 au prix retenu")).toBeVisible();
    // The message waits for the references at Alpha.
    expect(await within(group).findByRole("textbox", { name: "Message pour Négoce Alpha" })).toHaveValue(
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :\n- 4 u Té égal, DN 50, Inox 316L\nMerci !",
    );
    await user.click(within(group).getByRole("button", { name: "Consultation envoyée à Négoce Alpha" }));

    expect(await within(group).findByText("Consultation envoyée le 12/11/2026.")).toBeVisible();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: QUOTES,
        body: {
          supplier_id: ALPHA,
          line_ids: [LINE_C],
          with_references: true,
          message: "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :\n- 4 u Té égal, DN 50, Inox 316L\nMerci !",
        },
      },
    ]);
  });

  it("says plainly that a competitor is already consulted for other lines, and records nothing (13)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines: [line(), line({ ...TEE, id: LINE_C, position: 3, supplier_id: GAMMA })] }),
      },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_C]: null }),
      // Bêta is asked for the line bought from Gamma, not for Alpha's.
      [`GET ${QUOTES}`]: {
        data: {
          items: [
            quote({
              id: QUOTE_B,
              supplier_id: BETA,
              supplier_name: "Comptoir Bêta",
              with_references: false,
              lines: [{ line_id: LINE_C, unit_price_ht_cents: null, price_per: 1 }],
            }),
          ],
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Mettre en concurrence les lignes de Négoce Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Comptoir Bêta" }));

    expect(
      screen.getByText(
        "Comptoir Bêta a déjà une consultation en cours pour d’autres lignes de cette demande : retenez ou fermez d’abord son devis (« Clore »), puis consultez-le de nouveau.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Consultation envoyée à Comptoir Bêta" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Consultation envoyée le/)).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("enters a sub-cent price for 100 or 10 units, sends it with the price, and totals it per unit (14)", async () => {
    let stored = quote({ status: "received", received_at: "2026-11-13T10:00:00.000Z" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line(TEE)] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });

    // Chosen before the price: nothing to save yet, the choice goes with the price.
    await user.selectOptions(within(card).getByRole("combobox", { name: "Prix donné pour, ligne 2, Négoce Alpha" }), "100");
    expect(writes()).toEqual([]);
    await user.type(within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 2, Négoce Alpha" }), "3,40");
    await user.tab();
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `${QUOTES}/${QUOTE_A}`,
          body: { lines: [{ line_id: LINE_B, unit_price_ht_cents: 340, price_per: 100 }] },
        },
      ]),
    );
    // 4 u at 3,40 € les 100: 0,136 €, rounded to the cent.
    expect(await within(card).findByText(`${euros(14)} HT`)).toBeVisible();

    // Chosen after the price: the price is sent again with it.
    await user.type(within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" }), "12,50");
    await user.tab();
    await user.selectOptions(within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" }), "10");
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[2].body).toEqual({ lines: [{ line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 10 }] });
    expect(await within(card).findByText(`Total des lignes : ${euros(2500 + 14)} HT`)).toBeVisible();
  });

  it("holds « Retenir ce devis » while a price on screen cannot be read, until it is corrected or given up (15)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const retain = await screen.findByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    const first = screen.getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const second = screen.getByRole("textbox", { name: "Prix unitaire HT, ligne 2, Négoce Alpha" });
    expect(retain).toBeEnabled();

    await user.clear(first);
    await user.type(first, "12,505");
    await user.tab();
    expect(retain).toBeDisabled();
    expect(retain).toHaveAccessibleDescription("Le prix de la ligne 1 n’est pas lisible.");
    expect(writes()).toEqual([]);

    // Corrected: saved, and the quote may be retained on what the field shows.
    await user.clear(first);
    await user.type(first, "12,60");
    await user.tab();
    await waitFor(() => expect(retain).toBeEnabled());
    expect(writes()).toEqual([
      { method: "PATCH", path: `${QUOTES}/${QUOTE_A}`, body: { lines: [{ line_id: LINE_A, unit_price_ht_cents: 1260, price_per: 1 }] } },
    ]);

    // Given up: Escape shows the saved price again, which is the one a retain applies.
    await user.clear(second);
    await user.type(second, "4,0x");
    expect(retain).toBeDisabled();
    expect(retain).toHaveAccessibleDescription("Le prix de la ligne 2 n’est pas lisible.");
    await user.keyboard("{Escape}");
    expect(second).toHaveValue("4,00");
    expect(retain).toBeEnabled();
    expect(writes()).toHaveLength(1);
  });

  it("offers « Consultation envoyée » only once the consultations already recorded are read (16)", async () => {
    let answer!: (reply: Reply) => void;
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471" }),
      [`GET ${QUOTES}`]: () => new Promise<Reply>((resolve) => (answer = resolve)),
    });

    const send = await screen.findByRole("button", { name: "Consultation envoyée à Négoce Alpha" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Lecture des consultations déjà envoyées…");

    // Recorded meanwhile, from another tab: once read, the screen shows it instead of offering it again.
    answer({ data: { items: [quote({ lines: [{ line_id: LINE_A, unit_price_ht_cents: null, price_per: 1 }] })] } });
    expect(await screen.findByText("Consultation envoyée le 12/11/2026.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Consultation envoyée à Négoce Alpha" })).not.toBeInTheDocument();
  });

  it("keeps a consultation just recorded when the first read of the quotes answers after it (16)", async () => {
    let answer!: (reply: Reply) => void;
    mockApi({
      [`GET ${QUOTES}`]: () => new Promise<Reply>((resolve) => (answer = resolve)),
      [`POST ${QUOTES}`]: { status: 201, data: { item: quote() } },
    });
    // The editor's queue of writes, as it runs them: one after the other, in the order they were asked.
    let tail: Promise<unknown> = Promise.resolve();
    const queueWrite = <T,>(call: () => Promise<T>): Promise<T> => {
      const next = tail.then(call, call);
      tail = next.catch(() => undefined);
      return next;
    };
    const editor = { projectId: PROJECT_ID, requestId: REQUEST_ID, queueWrite, mergeServerLines: vi.fn() };
    const { result } = renderHook(() => useMaterialRequestQuotes(editor as unknown as MaterialRequestEditorApi));

    let created!: Promise<unknown>;
    act(() => {
      created = result.current.createQuote(
        { supplier_id: ALPHA, line_ids: [LINE_A, LINE_B], with_references: true, message: "Bonjour" },
        "Négoce Alpha",
      );
    });
    // The read started first answers last, without the quote it could not know about.
    await waitFor(() => expect(answer).toBeTypeOf("function"));
    await act(async () => answer({ data: { items: [] } }));
    await act(async () => {
      await created;
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.items.map((item) => item.id)).toEqual([QUOTE_A]);
  });

  it("holds « Retenir ce devis » while a line of the quote is a draft, and offers it once validated (17)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line(TEE)] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: {
        data: {
          items: [
            quote({
              status: "received",
              received_at: "2026-11-13T10:00:00.000Z",
              lines: [
                { line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 },
                { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
              ],
            }),
          ],
        },
      },
      [`POST ${BASE}/lines/validate`]: (body) => {
        const [id] = (body as { ids: string[] }).ids;
        return { data: { lines: [id === LINE_A ? line(VALIDATED) : line({ ...TEE, ...VALIDATED })] } };
      },
    });
    const retain = await screen.findByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    expect(retain).toBeDisabled();
    expect(retain).toHaveAccessibleDescription(
      "Les lignes 1 et 2 ne sont pas validées : validez-les avant de retenir ce devis.",
    );

    await user.click(screen.getByRole("button", { name: "Valider la ligne 1" }));
    await waitFor(() =>
      expect(retain).toHaveAccessibleDescription("La ligne 2 n’est pas validée : validez-la avant de retenir ce devis."),
    );
    await user.click(screen.getByRole("button", { name: "Valider la ligne 2" }));

    await waitFor(() => expect(retain).toBeEnabled());
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST ${BASE}/lines/validate`,
      `POST ${BASE}/lines/validate`,
    ]);
  });

  it("does not retain on a line reopened just before, when its turn comes (17)", async () => {
    let reopened!: () => void;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: {
        data: {
          items: [
            quote({
              status: "received",
              received_at: "2026-11-13T10:00:00.000Z",
              lines: [
                { line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 },
                { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
              ],
            }),
          ],
        },
      },
      [`POST ${BASE}/lines/reopen`]: () =>
        new Promise<Reply>((resolve) => (reopened = () => resolve({ data: { lines: [line()] } }))),
      [`POST ${QUOTES}/${QUOTE_A}/retain`]: { status: 500, error: { code: "UNEXPECTED", message: "Ne devait pas être appelé." } },
    });
    const retain = await screen.findByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });

    // The reopen is on its way: the line still reads validated, and the retain is queued behind it.
    await user.click(screen.getByRole("button", { name: "Rouvrir la ligne 1" }));
    await user.click(retain);
    reopened();

    expect(
      await screen.findByText("Non enregistré : La ligne 1 n’est pas validée : validez-la avant de retenir ce devis."),
    ).toBeVisible();
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([`POST ${BASE}/lines/reopen`]);
    expect(retain).toBeDisabled();
  });

  it("says the server's sentence when it still refuses a retain for a line not validated (17)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: {
        data: {
          items: [
            quote({
              status: "received",
              received_at: "2026-11-13T10:00:00.000Z",
              lines: [
                { line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 },
                { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
              ],
            }),
          ],
        },
      },
      // Reopened from another tab meanwhile.
      [`POST ${QUOTES}/${QUOTE_A}/retain`]: {
        status: 422,
        error: {
          code: "MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED",
          message: "La ligne 2 n’est pas validée : validez-la avant de retenir ce devis.",
          details: { positions: [2], line_ids: [LINE_B] },
        },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Retenir ce devis (Négoce Alpha)" }));

    expect(
      await screen.findByText("Non enregistré : La ligne 2 n’est pas validée : validez-la avant de retenir ce devis."),
    ).toBeVisible();
    expect(within(quoteCard("Négoce Alpha")).getByText("Reçu")).toBeVisible();
  });

  it("sends the price shown with a new lot after a refused save, and holds the retain until it is saved (18)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    let patches = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        patches += 1;
        if (patches === 1) return { status: 503, error: { code: "UNAVAILABLE", message: "Le service est indisponible, réessayez." } };
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });
    const retain = within(card).getByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    const price = within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const lot = within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" });
    expect(retain).toBeEnabled();

    await user.clear(price);
    await user.type(price, "20,00");
    await user.tab();
    expect(await within(card).findByText("Non enregistré : Le service est indisponible, réessayez.")).toBeVisible();
    // The quote as the server holds it is read again (10 €); the field keeps the 20 € typed.
    await waitFor(() => expect(reads(QUOTES).length).toBeGreaterThan(1));
    expect(price).toHaveValue("20,00");
    expect(retain).toBeDisabled();

    await user.selectOptions(lot, "100");

    // The price shown goes with the lot, never the 10 € saved before.
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ lines: [{ line_id: LINE_A, unit_price_ht_cents: 2000, price_per: 100 }] });
    await waitFor(() => expect(retain).toBeEnabled());
    expect(price).toHaveValue("20,00");
    expect(lot).toHaveValue("100");
    expect(within(card).queryByText(/^Non enregistré/)).not.toBeInTheDocument();
  });

  it("holds a lot change while the price shown cannot be read, and sends both once it is corrected (18)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });
    const retain = within(card).getByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    const price = within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });

    await user.clear(price);
    await user.type(price, "20,0x");
    await user.selectOptions(within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" }), "10");
    expect(writes()).toEqual([]);
    expect(retain).toHaveAccessibleDescription("Le prix de la ligne 1 n’est pas lisible.");

    await user.clear(price);
    await user.type(price, "20,00");
    await user.tab();
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `${QUOTES}/${QUOTE_A}`,
          body: { lines: [{ line_id: LINE_A, unit_price_ht_cents: 2000, price_per: 10 }] },
        },
      ]),
    );
    await waitFor(() => expect(retain).toBeEnabled());
  });

  it("sends a lot chosen while the price could not be read, when the price is corrected back to the saved one (18)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });
    const retain = within(card).getByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    const price = within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const lot = within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" });

    await user.clear(price);
    await user.type(price, "10,0x");
    await user.selectOptions(lot, "100");
    await user.clear(price);
    await user.type(price, "10,00");
    await user.tab();
    await waitFor(() =>
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: `${QUOTES}/${QUOTE_A}`,
          body: { lines: [{ line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 100 }] },
        },
      ]),
    );
    await waitFor(() => expect(retain).toBeEnabled());
    expect(lot).toHaveValue("100");
  });

  it("keeps a lot chosen while an earlier price save travels, and sends it with the corrected price (18)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    let releaseFirst: () => void = () => undefined;
    let patches = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: async (body) => {
        patches += 1;
        if (patches === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });
    const price = within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const lot = within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" });

    await user.clear(price);
    await user.type(price, "20,00");
    await user.tab();
    await waitFor(() => expect(writes()).toHaveLength(1));
    await user.clear(price);
    await user.type(price, "30,0x");
    await user.selectOptions(lot, "100");
    releaseFirst();
    await waitFor(() => expect(within(card).getByRole("button", { name: "Retenir ce devis (Négoce Alpha)" })).toHaveAccessibleDescription(
      "Le prix de la ligne 1 n’est pas lisible.",
    ));
    expect(lot).toHaveValue("100");

    await user.clear(price);
    await user.type(price, "30,00");
    await user.tab();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ lines: [{ line_id: LINE_A, unit_price_ht_cents: 3000, price_per: 100 }] });
  });

  it("sends a lot chosen while a save travels when that save already wrote the corrected price (18)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    let releaseFirst: () => void = () => undefined;
    let patches = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: async (body) => {
        patches += 1;
        if (patches === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });
    const price = within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const lot = within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" });

    // 20 € pour 1 travels; meanwhile the text is unreadable, « pour 100 » waits for it, and it is corrected to 20 €.
    await user.clear(price);
    await user.type(price, "20,00");
    await user.tab();
    await waitFor(() => expect(writes()).toHaveLength(1));
    await user.clear(price);
    await user.type(price, "20,0x");
    await user.selectOptions(lot, "100");
    await user.click(price);
    await user.clear(price);
    await user.type(price, "20,00");
    // The first save comes back with the very amount now shown: the lot chosen since is still to send.
    releaseFirst();
    await waitFor(() => expect(writes()).toHaveLength(1));
    await user.tab();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ lines: [{ line_id: LINE_A, unit_price_ht_cents: 2000, price_per: 100 }] });
    expect(lot).toHaveValue("100");
  });

  it("gives back the saved lot with the saved price when an unreadable price is abandoned with Escape (18)", async () => {
    let stored = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [
        { line_id: LINE_A, unit_price_ht_cents: 1000, price_per: 1 },
        { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 },
      ],
    });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        for (const price of (body as { lines: QuoteLine[] }).lines) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });
    const card = await screen.findByRole("article", { name: "Devis Négoce Alpha" });
    const retain = within(card).getByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    const price = within(card).getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const lot = within(card).getByRole("combobox", { name: "Prix donné pour, ligne 1, Négoce Alpha" });

    await user.clear(price);
    await user.type(price, "10,0x");
    await user.selectOptions(lot, "100");
    await user.click(price);
    await user.keyboard("{Escape}");
    expect(price).toHaveValue("10,00");
    expect(lot).toHaveValue("1");
    await waitFor(() => expect(retain).toBeEnabled());
    await user.tab();
    expect(writes()).toEqual([]);
  });

  it("saves a typed price in cents, keeps one the server refuses, and sends nothing unreadable (6, 7)", async () => {
    let stored = quote({ status: "received", received_at: "2026-11-13T10:00:00.000Z" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line(TEE)] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        const [price] = (body as { lines: QuoteLine[] }).lines;
        if (price.line_id === LINE_B) {
          return { status: 503, error: { code: "UNAVAILABLE", message: "Le service est indisponible, réessayez." } };
        }
        stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        return { data: { item: stored } };
      },
    });
    const retain = await screen.findByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    const first = screen.getByRole("textbox", { name: "Prix unitaire HT, ligne 1, Négoce Alpha" });
    const second = screen.getByRole("textbox", { name: "Prix unitaire HT, ligne 2, Négoce Alpha" });

    await user.type(first, "12,50");
    await user.tab();
    await waitFor(() =>
      expect(writes()).toEqual([
        { method: "PATCH", path: `${QUOTES}/${QUOTE_A}`, body: { lines: [{ line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 }] } },
      ]),
    );
    expect(first).toHaveValue("12,50");
    expect(await within(quoteCard("Négoce Alpha")).findByText(`${euros(25000)} HT`)).toBeVisible();

    await user.type(second, "8,30");
    await user.tab();
    expect(await screen.findByText("Non enregistré : Le service est indisponible, réessayez.")).toBeVisible();
    // What was typed stays, and the quote cannot be retained on another price than the one shown.
    expect(second).toHaveValue("8,30");
    expect(retain).toBeDisabled();
    expect(retain).toHaveAccessibleDescription(
      "Un prix saisi sur ce devis n’est pas enregistré : corrigez-le, ou appuyez sur Échap pour revenir au prix enregistré.",
    );

    // Escape gives back the saved price: the quote then only lacks that line's price.
    await user.click(second);
    await user.keyboard("{Escape}");
    expect(second).toHaveValue("");
    expect(retain).toHaveAccessibleDescription("Pour retenir ce devis, saisissez le prix de chaque ligne (il en manque 1).");

    const before = writes().length;
    await user.type(second, "8,305");
    await user.tab();
    expect(
      screen.getByText("Non enregistré : Montant illisible : en euros, avec une virgule et deux décimales au plus (12,50)."),
    ).toBeVisible();
    expect(writes()).toHaveLength(before);
  });

  it("offers « Retenir ce devis » once the quote is received and every line priced, and says why until then (7)", async () => {
    let stored = quote({ lines: [{ line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 }, { line_id: LINE_B, unit_price_ht_cents: null, price_per: 1 }] });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items: [stored] } }),
      [`PATCH ${QUOTES}/${QUOTE_A}`]: (body) => {
        const patch = body as { received?: true; lines?: QuoteLine[] };
        if (patch.received) stored = { ...stored, status: "received", received_at: "2026-11-13T10:00:00.000Z" };
        for (const price of patch.lines ?? []) {
          stored = { ...stored, lines: stored.lines.map((entry) => (entry.line_id === price.line_id ? price : entry)) };
        }
        return { data: { item: stored } };
      },
    });

    const retain = await screen.findByRole("button", { name: "Retenir ce devis (Négoce Alpha)" });
    expect(retain).toBeDisabled();
    expect(retain).toHaveAccessibleDescription(
      "Pour retenir ce devis, marquez-le reçu et saisissez le prix de chaque ligne (il en manque 1).",
    );

    await user.click(screen.getByRole("button", { name: "Marquer reçu le devis Négoce Alpha" }));
    expect(await within(quoteCard("Négoce Alpha")).findByText("Reçu")).toBeVisible();
    expect(screen.getByText("Demandé le 12/11/2026 · reçu le 13/11/2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Marquer reçu le devis Négoce Alpha" })).not.toBeInTheDocument();
    expect(retain).toHaveAccessibleDescription("Pour retenir ce devis, saisissez le prix de chaque ligne (il en manque 1).");

    await user.type(screen.getByRole("textbox", { name: "Prix unitaire HT, ligne 2, Négoce Alpha" }), "4");
    await user.tab();

    await waitFor(() => expect(retain).toBeEnabled());
    expect(retain).not.toHaveAccessibleDescription();
    expect(writes()).toEqual([
      { method: "PATCH", path: `${QUOTES}/${QUOTE_A}`, body: { received: true } },
      { method: "PATCH", path: `${QUOTES}/${QUOTE_A}`, body: { lines: [{ line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 }] } },
    ]);
    expect(screen.getByText(`Total des lignes : ${euros(20 * 1250 + 4 * 400)} HT`)).toBeVisible();
  });

  it("retaining a competitor prices the lines from the server's answer and shows the other quote closed, read-only (8, 9)", async () => {
    const alpha = quote({
      status: "received",
      received_at: "2026-11-13T10:00:00.000Z",
      lines: [{ line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 }, { line_id: LINE_B, unit_price_ht_cents: 400, price_per: 1 }],
    });
    const beta = quote({
      id: QUOTE_B,
      supplier_id: BETA,
      supplier_name: "Comptoir Bêta",
      with_references: false,
      status: "received",
      received_at: "2026-11-13T11:00:00.000Z",
      // The tees are priced for 100: 3,80 € les 100.
      lines: [{ line_id: LINE_A, unit_price_ht_cents: 1100, price_per: 1 }, { line_id: LINE_B, unit_price_ht_cents: 380, price_per: 100 }],
    });
    const retainedAt = "2026-11-14T08:00:00.000Z";
    let items = [alpha, beta];
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(VALIDATED), line({ ...TEE, ...VALIDATED })] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: () => ({ data: { items } }),
      [`POST ${QUOTES}/${QUOTE_B}/retain`]: () => {
        items = [
          { ...alpha, status: "closed", closed_at: retainedAt },
          { ...beta, status: "retained", retained_at: retainedAt },
        ];
        return {
          data: {
            item: items[1],
            lines: [
              line({ ...VALIDATED, supplier_id: BETA, unit_price_ht_cents: 1100, price_quote_id: QUOTE_B }),
              line({ ...TEE, ...VALIDATED, supplier_id: BETA, unit_price_ht_cents: 380, price_per: 100, price_quote_id: QUOTE_B }),
            ],
            closed_quote_ids: [QUOTE_A],
          },
        };
      },
    });

    const competitor = await screen.findByRole("article", { name: "Devis Comptoir Bêta" });
    // 4 tees at 3,80 € les 100 are 0,152 €: 0,15 €.
    expect(within(competitor).getByText(`Total des lignes : ${euros(20 * 1100 + 15)} HT`)).toBeVisible();
    expect(within(competitor).getByRole("combobox", { name: "Prix donné pour, ligne 2, Comptoir Bêta" })).toHaveValue("100");
    await user.click(screen.getByRole("button", { name: "Retenir ce devis (Comptoir Bêta)" }));

    expect(await within(quoteCard("Comptoir Bêta")).findByText("Retenu")).toBeVisible();
    expect(within(quoteCard("Comptoir Bêta")).getByText(`${euros(380)} les 100`)).toBeVisible();
    expect(writes()).toEqual([{ method: "POST", path: `${QUOTES}/${QUOTE_B}/retain`, body: null }]);
    // The lines are bought from the retained quote's supplier, at its prices, and that supplier no longer changes.
    expect(screen.getByText(`Prix unitaire HT : ${euros(1100)} (devis retenu)`)).toBeVisible();
    expect(screen.getByText(`Prix unitaire HT : ${euros(380)} les 100 (devis retenu)`)).toBeVisible();
    expect(screen.queryByLabelText("Fournisseur, ligne 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fournisseur, ligne 2")).not.toBeInTheDocument();
    expect(screen.getByText("Devis retenu : ses prix unitaires sont ceux des lignes.")).toBeVisible();
    // Bought lines are not asked again.
    expect(within(screen.getByRole("group", { name: "Comptoir Bêta" })).getByText("Toutes ses lignes ont leur prix retenu.")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Négoce Alpha" })).not.toBeInTheDocument();

    // The competitor is closed, readable and read-only: its prices are shown, nothing writes.
    const closed = quoteCard("Négoce Alpha");
    expect(within(closed).getByText("Clos")).toBeVisible();
    expect(within(closed).getByText("Devis clos : il reste lisible, rien n’y change.")).toBeVisible();
    expect(within(closed).getByText(euros(1250))).toBeVisible();
    expect(within(closed).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(closed).queryByRole("button", { name: /Retenir|Clore|Marquer|Joindre/ })).not.toBeInTheDocument();
    expect(closed.querySelector('input[type="file"]')).toBeNull();
    await waitFor(() => expect(within(closed).getByText("Demandé le 12/11/2026 · reçu le 13/11/2026 · clos le 14/11/2026")).toBeVisible());
  });

  it("closes a quote only after a confirmation, and it stays readable (9)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line(TEE)] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: { data: { items: [quote()] } },
      [`POST ${QUOTES}/${QUOTE_A}/close`]: { data: { item: quote({ status: "closed", closed_at: "2026-11-13T10:00:00.000Z" }) } },
    });

    await user.click(await screen.findByRole("button", { name: "Clore le devis Négoce Alpha" }));
    expect(writes()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Confirmer la clôture du devis Négoce Alpha" }));

    expect(await within(quoteCard("Négoce Alpha")).findByText("Clos")).toBeVisible();
    expect(writes()).toEqual([{ method: "POST", path: `${QUOTES}/${QUOTE_A}/close`, body: null }]);
    expect(within(quoteCard("Négoce Alpha")).queryByRole("textbox")).not.toBeInTheDocument();
    // Closed, Alpha may be asked again.
    expect(screen.getByRole("button", { name: "Consultation envoyée à Négoce Alpha" })).toBeEnabled();
  });

  it("shows a reader the groups and the quotes, with nothing that writes or copies (10)", async () => {
    const lines = [
      line(),
      line({ ...TEE }),
      line({ id: LINE_C, position: 3, supplier_id: null, product_type: "Bride plate", product_id: null, product_match: null }),
    ];
    await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines, canWrite: false }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: {
        data: { items: [quote({ status: "received", received_at: "2026-11-13T10:00:00.000Z", lines: [{ line_id: LINE_A, unit_price_ht_cents: 1250, price_per: 1 }, { line_id: LINE_B, unit_price_ht_cents: null, price_per: 1 }], files: [pdfFile()] })] },
      },
    });

    const section = screen.getByRole("region", { name: "Consultation" });
    const card = await within(section).findByRole("article", { name: "Devis Négoce Alpha" });
    const group = within(section).getByRole("group", { name: "Négoce Alpha" });
    expect(within(group).getByText("Ligne 1 · Coude 90° DN 50")).toBeVisible();
    expect(within(group).getByText("Ligne 2 · Té égal DN 50")).toBeVisible();
    expect(within(section).getByText("Sans fournisseur :")).toBeVisible();
    expect(within(card).getByText(euros(1250))).toBeVisible();
    expect(within(card).getByRole("link", { name: "devis-alpha.pdf" })).toBeVisible();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(section).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(section).queryAllByRole("button")).toEqual([]);
    expect(section.querySelector('input[type="file"]')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("attaches the supplier's PDF to its quote, never among the originals, and opens it (11)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line(), line(TEE)] }) },
      [`GET ${PROPOSALS}`]: references({ [LINE_A]: "NA-4471", [LINE_B]: null }),
      [`GET ${QUOTES}`]: { data: { items: [quote()] } },
      [`POST ${BASE}/files`]: {
        status: 201,
        data: {
          uploads: [
            {
              file: { id: FILE_PDF, file_name: "devis-alpha.pdf", mime_type: "application/pdf", byte_size: PDF.length },
              path: "tenant/demande/devis/devis-alpha.pdf",
              token: "jeton-devis",
            },
          ],
        },
      },
      [`POST ${BASE}/files/complete`]: { data: { files: [pdfFile()] } },
    });
    const pdf = new File([PDF], "devis-alpha.pdf", { type: "application/pdf" });

    await user.upload(await screen.findByLabelText("Pièces à joindre au devis Négoce Alpha"), pdf);

    const link = await within(quoteCard("Négoce Alpha")).findByRole("link", { name: "devis-alpha.pdf" });
    expect(link).toHaveAttribute("href", `${BASE}/files/${FILE_PDF}`);
    // The server answers the bytes as an attachment: the link downloads them under their own name.
    expect(link).toHaveAttribute("download", "devis-alpha.pdf");
    expect(within(quoteCard("Négoce Alpha")).getByText("PDF, 1 Ko")).toBeVisible();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: `${BASE}/files`,
        body: { quote_id: QUOTE_A, files: [{ name: "devis-alpha.pdf", mime_type: "application/pdf", byte_size: PDF.length }] },
      },
      { method: "POST", path: `${BASE}/files/complete`, body: { ids: [FILE_PDF] } },
    ]);
    expect(uploadToSignedUrlMock.mock.calls).toEqual([
      ["tenant/demande/devis/devis-alpha.pdf", "jeton-devis", pdf, { contentType: "application/pdf" }],
    ]);
    expect(screen.getByText("Pas de photo de l’original.")).toBeVisible();
  });
});
