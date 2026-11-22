import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MaterialRequestFile, MaterialRequestLine, MaterialRequestLineInput } from "@/lib/material-requests/contracts";
import type { MaterialRequestPhotoAnalysisAvailability } from "@/lib/material-requests/photo-analysis";

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
 *     correction was thrown away with a success message);
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
  return { user, original: await screen.findByRole("dialog", { name: "Original de la demande" }) };
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
});
