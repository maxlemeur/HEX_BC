import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MaterialRequestFile, MaterialRequestLine, MaterialRequestLineInput } from "@/lib/material-requests/contracts";
import {
  MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES,
  type MaterialRequestPhotoAnalysisAvailability,
} from "@/lib/material-requests/photo-analysis";

/**
 * Failure modes, written before the screen. The office asks the AI to read the photos of a request; each of these
 * would spend a member's ChatGPT plan for nothing, lose typed work or create lines nobody asked for:
 *  1. the reading is offered where it cannot run or to who cannot ask for it: an instance without AI, a reader, a
 *     request without photo; or a plan to connect is shown as a working button, without what to do;
 *  2. the lines created are not the ones read, in the order of the photos; or lines are created although a photo
 *     could not be read, so the office believes the sheet is complete;
 *  3. taking the reading up after a failure reads again the photos already read (the plan is spent twice);
 *  4. drafts already typed are replaced without the office choosing it, or the choice is offered although a line is
 *     validated or priced (the server would refuse, after minutes of reading);
 *  5. lines are replaced although they are no longer the ones the office saw when it chose: one was added while the
 *     photos were being read, or a draft was corrected meanwhile (independent review: the ids were the same, and the
 *     correction was thrown away with a success message), or the office is typing in a cell when the last photo
 *     answers (review of pull request 494: a cell keeps its typing to itself until it is left);
 *  6. a photo without any article is reported as a failure, or creates an empty line;
 *  7. « Arrêter » creates lines anyway, or a refusal to run does not lead to the profile where the plan is connected.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const LINE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FILE_1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FILE_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests/${REQUEST_ID}`;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/material-requests/MaterialRequestPdfViewer", () => ({
  MaterialRequestPdfViewer: ({ name, downloadUrl }: { name: string; downloadUrl: string }) => (
    <div data-testid="pdf-viewer" data-download={downloadUrl}>
      Aperçu PDF : {name}
    </div>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: vi.fn().mockResolvedValue({ data: { path: "tenant/req/new.pdf" }, error: null }),
      }),
    },
  }),
}));
vi.mock("@/app/dashboard/_actions/chatgpt", () => ({
  loadPhotoAnalysisModelOptions: vi.fn().mockResolvedValue({
    billingSource: "chatgpt_plan", connectionId: null,
    models: [{ id: "gpt-6.2-sol", name: "GPT-6.2 Sol", reasoningEfforts: ["high"], defaultReasoningEffort: "high" }],
    preferences: { model: "gpt-6.2-sol", reasoningEffort: "high" },
  }),
}));

import { MaterialRequestEditor } from "@/components/material-requests/MaterialRequestEditor";

function line(partial: Partial<MaterialRequestLine> = {}): MaterialRequestLine {
  return {
    id: LINE_A, request_id: REQUEST_ID, position: 1, original_text: null, quantity: 10, quantity_doubtful: false,
    unit: "u", dimension: "DN 32", no_dimension: false, product_type: "Raccord union", material: "Laiton brut",
    material_precision: null, reference: null, supplier_id: null, zone: null, imputation: "project",
    overhead_category: null, duplicate_acknowledged: false, status: "draft", validated_at: null, product_id: null,
    product_match: null, unit_price_ht_cents: null, price_per: 1, price_quote_id: null, ...partial,
  };
}

function file(id: string, partial: Partial<MaterialRequestFile> = {}): MaterialRequestFile {
  return {
    id, request_id: REQUEST_ID, quote_id: null, file_name: `photo-${id.slice(0, 2)}.jpg`, mime_type: "image/jpeg",
    byte_size: 1024, rotation: 0, created_at: "2026-11-10T08:00:00.000Z", ...partial,
  };
}

const AVAILABLE: MaterialRequestPhotoAnalysisAvailability = { status: "available", message: "Connexion ChatGPT configurée." };

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };
type Route = Reply | ((body: unknown) => Reply | Promise<Reply>);
type Call = { method: string; path: string; body: unknown };

let calls: Call[] = [];

function detail(options: {
  lines?: MaterialRequestLine[];
  files?: MaterialRequestFile[];
  canWrite?: boolean;
  photoAnalysis?: MaterialRequestPhotoAnalysisAvailability | null;
}) {
  return {
    request: {
      id: REQUEST_ID, project_id: PROJECT_ID, technician_id: null, requested_on: "2026-11-10", needed_on: null,
      delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false,
      presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null,
      created_at: "2026-11-10T08:00:00.000Z", updated_at: "2026-11-10T08:00:00.000Z",
    },
    technician: null,
    files: options.files ?? [file(FILE_1)],
    lines: options.lines ?? [],
    articles: {},
    canWrite: options.canWrite ?? true,
    materialOptions: [],
    supplierOptions: [],
    photoAnalysis: options.photoAnalysis === undefined ? AVAILABLE : options.photoAnalysis,
  };
}

async function openOriginal(routes: Record<string, Route>) {
  calls = [];
  const all: Record<string, Route> = {
    "GET /api/material-request-technicians": { data: { items: [] } },
    [`GET ${BASE}/candidates`]: { data: { lines: {} } },
    [`GET ${BASE}/supplier-proposals`]: { data: { lines: {}, references: {} } },
    [`GET ${BASE}/quotes`]: { data: { items: [] } },
    [`GET ${BASE}/orders`]: { data: { ready_line_ids: [], not_ready: [], ordered: [], orders: [], can_create: true } },
    // The bytes of the photos shown in the original.
    [`GET ${BASE}/files/${FILE_1}`]: { data: null },
    [`GET ${BASE}/files/${FILE_2}`]: { data: null },
    ...routes,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, path, body });
      const route = all[`${method} ${path}`];
      const reply: Reply = route === undefined
        ? { status: 404, error: { code: "NOT_FOUND", message: `Route absente du test : ${method} ${path}` } }
        : typeof route === "function" ? await route(body) : route;
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload, blob: async () => new Blob(["image"]) };
    }),
  );
  const user = userEvent.setup();
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} />);
  await screen.findByRole("heading", { name: "Lignes" });
  await user.click(screen.getByRole("button", { name: "Voir l’original" }));
  const original = await screen.findByRole("dialog", { name: "Original de la demande" });
  await waitFor(() => expect(within(original).queryByText("Chargement des modèles…")).not.toBeInTheDocument());
  return { user, original };
}

const writes = () => calls.filter((call) => call.method !== "GET");
const readings = () => writes().filter((call) => call.path.endsWith("/analysis")).map((call) => call.path);
const analysisOf = (fileId: string) => `POST ${BASE}/files/${fileId}/analysis`;
const read = (fileId: string, lines: MaterialRequestLineInput[]): Reply => ({ data: { file_id: fileId, lines, model: "modele-fictif" } });

const SHEET_1: MaterialRequestLineInput[] = [
  { original_text: "12 coudes cuivre Ø22", quantity: 12, unit: "u", dimension: "Ø 22", product_type: "coude", material: "cuivre" },
  { original_text: "7 vannes", quantity: 7, quantity_doubtful: true, product_type: "vanne" },
];
const SHEET_2: MaterialRequestLineInput[] = [{ original_text: "tube 32", product_type: "tube", dimension: "32" }];

describe("AI reading of the photos of a material request", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:photo");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reads each photo in turn and creates exactly the lines read, in the order of the photos (2)", async () => {
    const created = [...SHEET_1, ...SHEET_2].map((draft, index) =>
      line({ id: [LINE_A, LINE_B, LINE_C][index], position: index + 1, quantity: null, material: null, ...draft } as Partial<MaterialRequestLine>));
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1), file(FILE_2)] }) },
      [analysisOf(FILE_1)]: read(FILE_1, SHEET_1),
      [analysisOf(FILE_2)]: read(FILE_2, SHEET_2),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: created } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser les photos avec l’IA" }));
    expect(await within(original).findByText(/^3 lignes créées en brouillon\./)).toBeTruthy();

    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      analysisOf(FILE_1), analysisOf(FILE_2), `POST ${BASE}/lines`,
    ]);
    expect(writes()[2].body).toEqual({ lines: [...SHEET_1, ...SHEET_2] });
    await user.click(within(original).getByRole("button", { name: "Fermer" }));
    expect(await screen.findByLabelText("Type, ligne 3")).toHaveValue("tube");
  });

  it.each<[string, Parameters<typeof detail>[0]]>([
    ["on an instance without AI", { photoAnalysis: { status: "disabled", message: "Indisponible sur cette instance." } }],
    ["to a reader", { canWrite: false, photoAnalysis: null }],
    ["without a photo", { files: [] }],
  ])("is not offered %s (1)", async (_label, options) => {
    const { original } = await openOriginal({ [`GET ${BASE}`]: { data: detail(options) } });
    expect(within(original).queryByRole("button", { name: /Analyser .* avec l’IA/ })).not.toBeInTheDocument();
  });

  it("says what to do, on a button that cannot start a reading, while the ChatGPT plan is not connected (1)", async () => {
    const { original } = await openOriginal({
      [`GET ${BASE}`]: {
        data: detail({ photoAnalysis: { status: "unavailable", message: "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents." } }),
      },
    });
    const button = within(original).getByRole("button", { name: "Analyser la photo avec l’IA" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(expect.stringContaining("Connectez votre forfait ChatGPT dans Mon profil"));
    expect(within(original).getByRole("link", { name: "Ouvrir Mon profil" })).toHaveAttribute("href", "/dashboard/profile");
  });

  it("creates nothing when a photo cannot be read, names it, and does not read the others again (2, 3)", async () => {
    let secondAttempts = 0;
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1), file(FILE_2)] }) },
      [analysisOf(FILE_1)]: read(FILE_1, SHEET_1),
      [analysisOf(FILE_2)]: () => {
        secondAttempts += 1;
        return secondAttempts === 1
          ? { status: 503, error: { code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED", message: "La limite du forfait ChatGPT est atteinte : la photo n’a pas été lue.", details: { reason: "AI_QUOTA" } } }
          : read(FILE_2, SHEET_2);
      },
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ original_text: "12 coudes cuivre Ø22" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser les photos avec l’IA" }));

    const alert = await within(original).findByRole("alert");
    expect(alert).toHaveTextContent("Photo 2 sur 2 : La limite du forfait ChatGPT est atteinte : la photo n’a pas été lue. Aucune ligne n’a été créée. Les photos déjà lues ne seront pas relues.");
    expect(writes().some((call) => call.path === `${BASE}/lines`)).toBe(false);

    await user.click(within(original).getByRole("button", { name: "Analyser les photos avec l’IA" }));
    await waitFor(() => expect(writes().some((call) => call.path === `${BASE}/lines`)).toBe(true));
    expect(readings()).toEqual([`${BASE}/files/${FILE_1}/analysis`, `${BASE}/files/${FILE_2}/analysis`, `${BASE}/files/${FILE_2}/analysis`]);
    expect(writes().at(-1)?.body).toEqual({ lines: [...SHEET_1, ...SHEET_2] });
  });

  it("asks before replacing drafts, and replaces the ones shown when the office chooses it (4)", async () => {
    const drafts = [line(), line({ id: LINE_B, position: 2, product_type: "Bouchon" })];
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines: drafts }) },
      [analysisOf(FILE_1)]: read(FILE_1, SHEET_1),
      [`POST ${BASE}/lines/replace`]: { data: { lines: [line({ id: LINE_C, original_text: "12 coudes cuivre Ø22", product_type: "coude" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    // Nothing is read before the office has chosen.
    expect(writes()).toEqual([]);
    expect(within(original).getByRole("button", { name: "Ajouter à la suite" })).toHaveFocus();
    await user.click(within(original).getByRole("button", { name: "Remplacer les 2 lignes" }));

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({
      method: "POST", path: `${BASE}/lines/replace`, body: { replaced_ids: [LINE_A, LINE_B], lines: SHEET_1 },
    });
  });

  it("reads nothing when the office gives the choice up, and hands the focus back (4)", async () => {
    const { user, original } = await openOriginal({ [`GET ${BASE}`]: { data: detail({ lines: [line()] }) } });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(within(original).getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" })).toHaveFocus());
    expect(writes()).toEqual([]);
  });

  it("adds after the existing lines, without offering a replacement, once a line is validated (4)", async () => {
    const lines = [line({ status: "validated", validated_at: "2026-11-10T09:00:00.000Z" }), line({ id: LINE_B, position: 2 })];
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [analysisOf(FILE_1)]: read(FILE_1, SHEET_2),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_C, position: 3, product_type: "tube" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(within(original).queryByRole("button", { name: /^Remplacer/ })).not.toBeInTheDocument();
    expect(writes()[1]).toEqual({ method: "POST", path: `${BASE}/lines`, body: { lines: SHEET_2 } });
  });

  it("replaces nothing when the lines changed while the photo was being read (5)", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const held = new Promise<Reply>((resolve) => {
      release = resolve;
    });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [analysisOf(FILE_1)]: () => held,
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_B, position: 2, quantity: null, product_type: null, material: null })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(within(original).getByRole("button", { name: "Remplacer la ligne" }));
    await within(original).findByText(/Lecture de la photo/);
    // The reading runs; the office closes the original and adds a line by hand.
    await user.click(within(original).getByRole("button", { name: "Fermer" }));
    await user.click(screen.getByRole("button", { name: "Ajouter une ligne" }));
    await screen.findByLabelText("Type, ligne 2");
    release(read(FILE_1, SHEET_1));

    await user.click(screen.getByRole("button", { name: "Voir l’original" }));
    const reopened = await screen.findByRole("dialog", { name: "Original de la demande" });
    expect(await within(reopened).findByRole("alert")).toHaveTextContent("Les lignes ont changé pendant la lecture : rien n’a été remplacé.");
    expect(writes().some((call) => call.path === `${BASE}/lines/replace`)).toBe(false);
  });

  it("replaces nothing when a draft was corrected while the photo was being read (5)", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const held = new Promise<Reply>((resolve) => {
      release = resolve;
    });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [analysisOf(FILE_1)]: () => held,
      [`PATCH ${BASE}/lines/${LINE_A}`]: { data: { line: line({ quantity: 25 }) } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(within(original).getByRole("button", { name: "Remplacer la ligne" }));
    await within(original).findByText(/Lecture de la photo/);
    await user.click(within(original).getByRole("button", { name: "Fermer" }));
    // Same line, same id: only what was typed on it changed.
    const quantity = screen.getByLabelText("Quantité, ligne 1");
    await user.clear(quantity);
    await user.type(quantity, "25{Enter}");
    await waitFor(() => expect(writes().some((call) => call.method === "PATCH")).toBe(true));
    await waitFor(() => expect(screen.getByLabelText("Quantité, ligne 1")).toHaveValue("25"));
    release(read(FILE_1, SHEET_1));

    await user.click(screen.getByRole("button", { name: "Voir l’original" }));
    const reopened = await screen.findByRole("dialog", { name: "Original de la demande" });
    expect(await within(reopened).findByRole("alert")).toHaveTextContent("Les lignes ont changé pendant la lecture : rien n’a été remplacé.");
    expect(writes().some((call) => call.path === `${BASE}/lines/replace`)).toBe(false);
    // The photo is not read again when the office chooses anew.
    await user.click(within(reopened).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(within(reopened).getByRole("button", { name: "Ajouter à la suite" }));
    await waitFor(() => expect(writes().some((call) => call.path === `${BASE}/lines`)).toBe(true));
    expect(readings()).toHaveLength(1);
  });

  it("replaces nothing when a correction typed during the reading could not be saved (5)", async () => {
    let releaseReading: (reply: Reply) => void = () => undefined;
    let releaseSave: (reply: Reply) => void = () => undefined;
    const reading = new Promise<Reply>((resolve) => {
      releaseReading = resolve;
    });
    const save = new Promise<Reply>((resolve) => {
      releaseSave = resolve;
    });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [analysisOf(FILE_1)]: () => reading,
      [`PATCH ${BASE}/lines/${LINE_A}`]: () => save,
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(within(original).getByRole("button", { name: "Remplacer la ligne" }));
    await within(original).findByText(/Lecture de la photo/);
    await user.click(within(original).getByRole("button", { name: "Fermer" }));
    const quantity = screen.getByLabelText("Quantité, ligne 1");
    await user.clear(quantity);
    await user.type(quantity, "25{Enter}");
    await waitFor(() => expect(writes().some((call) => call.method === "PATCH")).toBe(true));
    // The photo answers while the save is on its way; the save is then refused: the line reads as before, and the
    // quantity typed is still on screen, unsaved.
    releaseReading(read(FILE_1, SHEET_1));
    releaseSave({ status: 500, error: { code: "INTERNAL_ERROR", message: "Enregistrement impossible." } });

    await user.click(screen.getByRole("button", { name: "Voir l’original" }));
    const reopened = await screen.findByRole("dialog", { name: "Original de la demande" });
    expect(await within(reopened).findByRole("alert")).toHaveTextContent("Les lignes ont changé pendant la lecture : rien n’a été remplacé.");
    expect(writes().some((call) => call.path === `${BASE}/lines/replace`)).toBe(false);
  });

  it("does not offer a replacement while a change of a line is not saved (4)", async () => {
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`PATCH ${BASE}/lines/${LINE_A}`]: { status: 500, error: { code: "INTERNAL_ERROR", message: "Enregistrement impossible." } },
    });
    await user.click(within(original).getByRole("button", { name: "Fermer" }));
    const quantity = screen.getByLabelText("Quantité, ligne 1");
    await user.clear(quantity);
    await user.type(quantity, "25{Enter}");
    await waitFor(() => expect(writes().some((call) => call.method === "PATCH")).toBe(true));

    await user.click(screen.getByRole("button", { name: "Voir l’original" }));
    const reopened = await screen.findByRole("dialog", { name: "Original de la demande" });
    await user.click(within(reopened).getByRole("button", { name: "Analyser la photo avec l’IA" }));

    expect(await within(reopened).findByRole("button", { name: "Remplacer la ligne" })).toBeDisabled();
    expect(within(reopened).getByText(/Une modification de ligne n’est pas enregistrée/)).toBeVisible();
    expect(within(reopened).getByRole("button", { name: "Ajouter à la suite" })).toBeEnabled();
  });

  it("replaces nothing while the office is typing in a line, and keeps what is typed (5)", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const held = new Promise<Reply>((resolve) => {
      release = resolve;
    });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [analysisOf(FILE_1)]: () => held,
      [`PATCH ${BASE}/lines/${LINE_A}`]: { data: { line: line({ product_type: "Raccord union double" }) } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(within(original).getByRole("button", { name: "Remplacer la ligne" }));
    await within(original).findByText(/Lecture de la photo/);
    await user.click(within(original).getByRole("button", { name: "Fermer" }));
    // Typed, neither left nor confirmed with Enter: no write, and the line reads as it did at the choice.
    const type = screen.getByLabelText("Type, ligne 1");
    await user.type(type, " double");
    expect(writes().some((call) => call.method === "PATCH")).toBe(false);
    release(read(FILE_1, SHEET_1));

    const status = await screen.findByText(/Une ligne était en cours de saisie à la fin de la lecture : rien n’a été remplacé\./);
    expect(status).toBeInTheDocument();
    expect(writes().some((call) => call.path === `${BASE}/lines/replace`)).toBe(false);
    expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Raccord union double");
    expect(screen.getByLabelText("Type, ligne 1")).toHaveFocus();
  });

  it("creates nothing once the office stops the reading (7)", async () => {
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({}) },
      [analysisOf(FILE_1)]: () => new Promise<Reply>(() => undefined),
    });
    // The mock ignores the signal a real fetch obeys: it gives the request up the same way.
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      const signal = init?.signal;
      if (!signal) return answer(input, init);
      return Promise.race([
        answer(input, init),
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      ]);
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await user.click(await within(original).findByRole("button", { name: "Arrêter" }));

    expect(await within(original).findByText(/^Lecture arrêtée : aucune ligne n’a été créée\./)).toBeVisible();
    expect(writes().map((call) => call.path)).toEqual([`${BASE}/files/${FILE_1}/analysis`]);
    await waitFor(() => expect(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" })).toHaveFocus());
  });

  it("leads to the profile when the reading is refused because the plan must be reconnected (7)", async () => {
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({}) },
      [analysisOf(FILE_1)]: {
        status: 409,
        error: { code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE", message: "Reconnectez votre forfait ChatGPT dans Mon profil.", details: { status: "unavailable" } },
      },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));

    const alert = await within(original).findByRole("alert");
    expect(alert).toHaveTextContent("Reconnectez votre forfait ChatGPT dans Mon profil. Aucune ligne n’a été créée.");
    expect(within(alert).getByRole("link", { name: "Ouvrir Mon profil" })).toHaveAttribute("href", "/dashboard/profile");
  });

  it("says that a photo holds no article, without creating a line (6)", async () => {
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({}) },
      [analysisOf(FILE_1)]: read(FILE_1, []),
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));

    expect(await within(original).findByText("Aucun article lu sur la photo : saisissez les lignes à la main.")).toBeVisible();
    expect(within(original).queryByRole("alert")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });

  it("displays a PDF original in the PDF viewer without rotation controls and analyzes it into draft lines", async () => {
    const pdf = file(FILE_1, { file_name: "demande.pdf", mime_type: "application/pdf" });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [pdf] }) },
      [analysisOf(FILE_1)]: read(FILE_1, SHEET_1),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A }), line({ id: LINE_B, position: 2 })] } },
    });

    expect(await within(original).findByTestId("pdf-viewer")).toHaveTextContent("Aperçu PDF : demande.pdf");
    expect(within(original).queryByRole("button", { name: "Tourner à gauche" })).not.toBeInTheDocument();
    expect(within(original).queryByRole("button", { name: "Tourner à droite" })).not.toBeInTheDocument();
    expect(within(original).getByRole("link", { name: "Télécharger" })).toHaveAttribute("download", "demande.pdf");

    await user.click(within(original).getByRole("button", { name: "Analyser le PDF avec l’IA" }));
    expect(await within(original).findByText(/^2 lignes créées en brouillon\./)).toBeVisible();
    expect(readings()).toEqual([`${BASE}/files/${FILE_1}/analysis`]);
  });

  it("continues reading the other originals when one exceeds 15 MiB and reports the skipped file", async () => {
    const heavy = file(FILE_1, { file_name: "plan-lourd.pdf", mime_type: "application/pdf", byte_size: MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES + 1 });
    const normal = file(FILE_2, { file_name: "feuille.jpg", mime_type: "image/jpeg" });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [heavy, normal] }) },
      [analysisOf(FILE_2)]: read(FILE_2, SHEET_2),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A, product_type: "tube" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser les originaux avec l’IA" }));

    const status = await within(original).findByText(/1 ligne créée en brouillon\./);
    expect(status).toHaveTextContent(/Original ignoré : « plan-lourd\.pdf » \(dépasse 15 Mo\)\. À reprendre à la main\./);
    expect(readings()).toEqual([`${BASE}/files/${FILE_2}/analysis`]);
    expect(writes().at(-1)?.body).toEqual({ lines: SHEET_2 });
  });

  it("continues reading the other originals when one is unreadable or rejected by the model", async () => {
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1, { file_name: "verrouille.pdf", mime_type: "application/pdf" }), file(FILE_2, { file_name: "ok.jpg" })] }) },
      [analysisOf(FILE_1)]: {
        status: 422,
        error: { code: "MATERIAL_REQUEST_PHOTO_UNREADABLE", message: "Ce PDF ne peut pas être lu." },
      },
      [analysisOf(FILE_2)]: read(FILE_2, SHEET_2),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A, product_type: "tube" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser les originaux avec l’IA" }));

    const status = await within(original).findByText(/1 ligne créée en brouillon\./);
    expect(status).toHaveTextContent(/Original ignoré : « verrouille\.pdf » \(Ce PDF ne peut pas être lu\)\. À reprendre à la main\./);
    expect(readings()).toEqual([`${BASE}/files/${FILE_1}/analysis`, `${BASE}/files/${FILE_2}/analysis`]);
  });

  it("creates nothing and reports an alert when every original is skipped (> 15 MiB or unreadable)", async () => {
    const heavy = file(FILE_1, { file_name: "trop-lourd.jpg", byte_size: MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES + 1 });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [heavy] }) },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));

    const alert = await within(original).findByRole("alert");
    expect(alert).toHaveTextContent(/Original ignoré : « trop-lourd\.jpg » \(dépasse 15 Mo\)/);
    expect(alert).toHaveTextContent(/Aucune ligne n’a été créée\./);
    expect(writes()).toEqual([]);
  });

  it("drops lines from an original removed during a reading and continues with the remaining original", async () => {
    let releaseSecond: (reply: Reply) => void = () => undefined;
    const heldSecond = new Promise<Reply>((resolve) => {
      releaseSecond = resolve;
    });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1, { file_name: "retiree.jpg" }), file(FILE_2, { file_name: "gardee.jpg" })] }) },
      [analysisOf(FILE_1)]: read(FILE_1, SHEET_1),
      [analysisOf(FILE_2)]: () => heldSecond,
      [`DELETE ${BASE}/files/${FILE_1}`]: { data: { deleted: true } },
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A, product_type: "tube" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser les photos avec l’IA" }));
    await within(original).findByText(/Lecture de la photo 2 sur 2/);
    // Remove FILE_1 while FILE_2 is still being read.
    await user.click(within(original).getByRole("button", { name: "Retirer la photo" }));
    await user.click(within(original).getByRole("button", { name: "Confirmer le retrait de la photo" }));
    await waitFor(() => expect(writes().some((call) => call.method === "DELETE")).toBe(true));

    releaseSecond(read(FILE_2, SHEET_2));

    const status = await within(original).findByText(/1 ligne créée en brouillon\./);
    expect(status).toHaveTextContent(/« retiree\.jpg » a été retiré pendant la lecture et n’a pas été repris\./);
    expect(writes().find((call) => call.path === `${BASE}/lines`)?.body).toEqual({ lines: SHEET_2 });
  });

  it("continues when an original returns 404 mid-read (withdrawn in another session)", async () => {
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1, { file_name: "disparue.jpg" }), file(FILE_2, { file_name: "presente.jpg" })] }) },
      [analysisOf(FILE_1)]: { status: 404, error: { code: "NOT_FOUND", message: "Original introuvable dans cette demande." } },
      [analysisOf(FILE_2)]: read(FILE_2, SHEET_2),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A, product_type: "tube" })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser les photos avec l’IA" }));

    const status = await within(original).findByText(/1 ligne créée en brouillon\./);
    expect(status).toHaveTextContent(/« disparue\.jpg » a été retiré pendant la lecture et n’a pas été repris\./);
    expect(writes().at(-1)?.body).toEqual({ lines: SHEET_2 });
  });

  it("reports an original added while a reading is in progress so the office knows it was not included", async () => {
    let releaseFirst: (reply: Reply) => void = () => undefined;
    const heldFirst = new Promise<Reply>((resolve) => {
      releaseFirst = resolve;
    });
    const addedPdf = file(FILE_2, { file_name: "ajout.pdf", mime_type: "application/pdf" });
    const { user, original } = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1, { file_name: "initiale.jpg" })] }) },
      [analysisOf(FILE_1)]: () => heldFirst,
      [`POST ${BASE}/files`]: {
        status: 201,
        data: { uploads: [{ file: { id: FILE_2, file_name: "ajout.pdf", mime_type: "application/pdf", byte_size: 10 }, path: "tenant/req/new.pdf", token: "tok" }] },
      },
      [`POST ${BASE}/files/complete`]: { data: { files: [addedPdf] } },
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A }), line({ id: LINE_B, position: 2 })] } },
    });

    await user.click(within(original).getByRole("button", { name: "Analyser la photo avec l’IA" }));
    await within(original).findByText(/Lecture de la photo/);

    const pdfFile = new File(["%PDF-1.4\n%"], "ajout.pdf", { type: "application/pdf" });
    await user.upload(within(original).getByLabelText("Photos à ajouter"), pdfFile);
    await within(original).findByTestId("pdf-viewer");

    releaseFirst(read(FILE_1, SHEET_1));

    const status = await within(original).findByText(/2 lignes créées en brouillon\./);
    expect(status).toHaveTextContent(/1 original ajouté pendant la lecture \(« ajout\.pdf »\) n’a pas été lu : relancez l’analyse pour l’inclure\./);
    expect(readings()).toEqual([`${BASE}/files/${FILE_1}/analysis`]);
  });

  it("skips a file blocked by pre-call AI_KEY_CEILING but aborts the batch on post-call AI_KEY_CEILING_EXCEEDED", async () => {
    const first = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1, { file_name: "trop-cher.pdf", mime_type: "application/pdf" }), file(FILE_2, { file_name: "ok.jpg" })] }) },
      [analysisOf(FILE_1)]: {
        status: 503,
        error: { code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED", message: "Le plafond serait dépassé avant l’envoi.", details: { reason: "AI_KEY_CEILING" } },
      },
      [analysisOf(FILE_2)]: read(FILE_2, SHEET_2),
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [line({ id: LINE_A, product_type: "tube" })] } },
    });
    await first.user.click(within(first.original).getByRole("button", { name: "Analyser les originaux avec l’IA" }));
    expect(await within(first.original).findByText(/1 ligne créée en brouillon\./)).toHaveTextContent(/Original ignoré : « trop-cher\.pdf »/);
    expect(readings()).toEqual([`${BASE}/files/${FILE_1}/analysis`, `${BASE}/files/${FILE_2}/analysis`]);

    cleanup();
    const second = await openOriginal({
      [`GET ${BASE}`]: { data: detail({ files: [file(FILE_1, { file_name: "depasse.pdf", mime_type: "application/pdf" }), file(FILE_2, { file_name: "suivant.jpg" })] }) },
      [analysisOf(FILE_1)]: {
        status: 503,
        error: { code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED", message: "Le coût réel a dépassé le plafond. Les configurations suivantes n’ont pas été lancées.", details: { reason: "AI_KEY_CEILING_EXCEEDED" } },
      },
      [analysisOf(FILE_2)]: read(FILE_2, SHEET_2),
    });
    await second.user.click(within(second.original).getByRole("button", { name: "Analyser les originaux avec l’IA" }));
    expect(await within(second.original).findByRole("alert")).toHaveTextContent(/Le coût réel a dépassé le plafond/);
    // Never sends FILE_2 after a billing ceiling breach.
    expect(readings()).toEqual([`${BASE}/files/${FILE_1}/analysis`]);
    expect(writes().some((call) => call.path === `${BASE}/lines`)).toBe(false);
  });
});
