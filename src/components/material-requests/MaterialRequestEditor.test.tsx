import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildClarificationMessage } from "@/lib/material-requests/alerts";
import type {
  MaterialRequest,
  MaterialRequestFile,
  MaterialRequestLine,
  MaterialRequestLineInput,
} from "@/lib/material-requests/contracts";

/**
 * Failure modes, written before the screen (TI-690). The office rewrites a technician's request by hand;
 * each of these would let a wrong order leave, or lose the operator's work:
 *  1. a cell with a missing or doubtful value looks like the others, or says why only through its colour;
 *     a remark that does not block is shown as if it did;
 *  2. « Valider les lignes sans alerte » also sends a line that carries an alert (one that blocks, or a
 *     remark such as a material that differs from the request's: the owner wants a look at each of those)
 *     or an already validated one, or announces another count than what it sends; or a line with only a
 *     remark can no longer be validated at all;
 *  3. a refusal by the server (422, lines blocked) is shown as a success, or does not say which lines;
 *  4. applying a value to a selection touches other lines or other columns;
 *  5. the material presumed for the sheet looks settled before the operator confirms it, or confirming
 *     sends something else than the confirmation;
 *  6. a failed save throws the typed value away or fails silently;
 *  7. a reader without write access (viewer, director) is offered a control that would write;
 *  8. « Découper le texte en lignes » creates other lines than the pre-reading returned;
 *  9. the message to the technician differs from the one built by the shared rules, or is not copied;
 * 10. rotating a photo saves the wrong angle;
 * 11. Escape in a cell still saves, or Enter saves more than the edited column;
 * 12. a validated line can be rewritten without being reopened;
 * 13. a line copied from a previous request arrives validated, or with a quantity nobody has to look at;
 * 14. a line added by hand is created with values nobody typed, or leaves the cursor away from it;
 * 15. photos go to storage before the server prepared them, are listed before it checked them, or are
 *     sent twice; a refusal, a failed upload or a rejected check leaves a photo listed or prepared rows
 *     behind, or does not tell the operator that nothing was kept; leaving the request drops the rows
 *     while a photo is still on its way, so its bytes land with nothing pointing at them; a photo the
 *     browser gives no type to is sent to storage without the type the server recorded, and refused;
 * 16. changing the presumed material silently returns validated lines to draft: nothing said before,
 *     nothing said after, or the lines still shown as validated;
 * 17. a pasted message longer than a request accepts loses its last lines without a word;
 * 18. a line that left the drafts comes back already selected when it is reopened;
 * 19. on a slow connection, a correction made while a save is on its way is compared with the value
 *     still shown as saved and dropped: the pending save then wins and the operator's last value is
 *     lost without a word (text, quantity); or the error of an earlier choice stays on a select whose
 *     later choice was saved;
 * 20. a validated line, or any line shown to a reader, shows no material or supplier when they come from
 *     the request's confirmed presumption, so the reviewed table reads as if they were missing; or an
 *     unconfirmed presumption is shown as applying;
 * 21. « Confirmer la matière » (or the supplier) confirms whatever the server holds, although another
 *     session changed it since the screen was loaded, or a value still being typed or saved: the
 *     operator confirms something they never saw; or the server's refusal leaves the old value on screen;
 * 22. a line is validated although its last change was not saved (the save queued before the validation
 *     failed): the server validates the older values, the settled row hides the typed value and its
 *     error, and the operator believes they validated what they typed; the same through « Valider la
 *     sélection » or « Valider les lignes sans alerte »; or a bulk change slips another value under a
 *     typed one that is still shown as unsaved; or such a line stays locked once its change is saved
 *     or dropped.
 */

const { splitSourceTextMock, storageFromMock, uploadToSignedUrlMock } = vi.hoisted(() => ({
  splitSourceTextMock: vi.fn(),
  storageFromMock: vi.fn(),
  uploadToSignedUrlMock: vi.fn(),
}));
vi.mock("@/lib/material-requests/source-text", () => ({ splitSourceText: splitSourceTextMock }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ storage: { from: storageFromMock } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { MaterialRequestEditor } from "@/components/material-requests/MaterialRequestEditor";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const TECHNICIAN_ID = "33333333-3333-4333-8333-333333333333";
const LINE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FILE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FILE_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests/${REQUEST_ID}`;

function line(partial: Partial<MaterialRequestLine> = {}): MaterialRequestLine {
  return {
    id: LINE_A,
    request_id: REQUEST_ID,
    position: 1,
    original_text: null,
    quantity: 10,
    quantity_doubtful: false,
    unit: "u",
    dimension: "DN 32",
    no_dimension: false,
    product_type: "Raccord union",
    material: "Laiton brut",
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

function request(partial: Partial<MaterialRequest> = {}): MaterialRequest {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    technician_id: TECHNICIAN_ID,
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
    ...partial,
  };
}

function file(partial: Partial<MaterialRequestFile> = {}): MaterialRequestFile {
  return {
    id: FILE_ID,
    request_id: REQUEST_ID,
    quote_id: null,
    file_name: "photo-essai.jpg",
    mime_type: "image/jpeg",
    byte_size: 1024,
    rotation: 0,
    created_at: "2026-11-10T08:00:00.000Z",
    ...partial,
  };
}

const TECHNICIAN = { id: TECHNICIAN_ID, name: "Alpha", current_project_id: null, is_active: true };

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };
type Route = Reply | ((body: unknown) => Reply | Promise<Reply>);
type Call = { method: string; path: string; body: unknown };

let calls: Call[] = [];
/** Writes to the application and uploads to storage, in the order they happened. */
let events: string[] = [];

function mockApi(routes: Record<string, Route>) {
  calls = [];
  events = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? null);
      calls.push({ method, path, body });
      if (method !== "GET") events.push(`${method} ${path}`);
      const route = routes[`${method} ${path}`];
      const reply: Reply =
        route === undefined
          ? { status: 404, error: { code: "NOT_FOUND", message: `Route absente du test : ${method} ${path}` } }
          : typeof route === "function"
            ? await route(body)
            : route;
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload, blob: async () => new Blob(["image"]) };
    }),
  );
}

function detail(options: {
  request?: Partial<MaterialRequest>;
  lines?: MaterialRequestLine[];
  files?: MaterialRequestFile[];
  canWrite?: boolean;
}) {
  return {
    request: request(options.request),
    technician: TECHNICIAN,
    files: options.files ?? [],
    lines: options.lines ?? [],
    articles: {},
    canWrite: options.canWrite ?? true,
    materialOptions: ["Laiton brut", "PVC pression"],
    supplierOptions: [{ id: "99999999-9999-4999-8999-999999999999", name: "Négoce Exemple" }],
  };
}

function writes(): Call[] {
  return calls.filter((call) => call.method !== "GET");
}

async function openEditor(routes: Record<string, Route>) {
  // The article proposals of delivery 3 are read once per page; these journeys have none, and no quote
  // (TI-691, read by the « Consultation » section).
  mockApi({
    "GET /api/material-request-technicians": { data: { items: [TECHNICIAN] } },
    [`GET ${BASE}/candidates`]: { data: { lines: {} } },
    [`GET ${BASE}/quotes`]: { data: { items: [] } },
    ...routes,
  });
  const user = userEvent.setup();
  render(<MaterialRequestEditor projectId={PROJECT_ID} requestId={REQUEST_ID} />);
  await screen.findByRole("heading", { name: "Lignes" });
  return user;
}

describe("MaterialRequestEditor", () => {
  beforeEach(() => {
    splitSourceTextMock.mockReset();
    uploadToSignedUrlMock.mockReset();
    uploadToSignedUrlMock.mockImplementation(async (path: string) => {
      events.push(`storage ${path}`);
      return { data: { path }, error: null };
    });
    storageFromMock.mockReset();
    storageFromMock.mockReturnValue({ uploadToSignedUrl: uploadToSignedUrlMock });
    URL.createObjectURL = vi.fn(() => "blob:photo");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("highlights a cell held back by an alert and gives its reason to assistive tech (1)", async () => {
    await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines: [line(), line({ id: LINE_B, position: 2, quantity: null, product_type: "Bouchon fileté" })] }),
      },
    });

    const missing = screen.getByLabelText("Quantité, ligne 2");
    expect(missing).toHaveAttribute("aria-invalid", "true");
    expect(missing).toHaveAccessibleDescription(expect.stringContaining("Quantité à renseigner."));
    expect(missing.closest("td")).toHaveClass("bg-warning-light");

    const complete = screen.getByLabelText("Quantité, ligne 1");
    expect(complete).not.toHaveAttribute("aria-invalid", "true");
    expect(complete).toHaveAccessibleDescription("");
    expect(complete.closest("td")).not.toHaveClass("bg-warning-light");

    expect(within(screen.getByRole("list", { name: "Points à régler, ligne 2" })).getByText("Quantité à renseigner.")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Points à régler, ligne 1" })).not.toBeInTheDocument();
  });

  it("shows a remark that does not block differently from a blocking alert (1)", async () => {
    await openEditor({
      [`GET ${BASE}`]: {
        data: detail({
          request: { presumed_material: "Laiton brut", material_confirmed: true },
          lines: [line({ material: "PVC pression" })],
        }),
      },
    });

    const material = screen.getByLabelText("Matière, ligne 1");
    expect(material).toHaveAccessibleDescription(expect.stringContaining("Diffère de la matière de la demande"));
    expect(material).not.toHaveAttribute("aria-invalid", "true");
    expect(material.closest("td")).toHaveClass("bg-warning-subtle");
    expect(material.closest("td")).not.toHaveClass("bg-warning-light");
    expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Valider la ligne 1" })).toBeEnabled();
  });

  it("validates in one gesture only the draft lines without any alert, and counts them (2)", async () => {
    const lines = [
      line(),
      line({ id: LINE_B, position: 2, quantity: null, product_type: "Bouchon fileté" }),
      line({ id: LINE_C, position: 3, product_type: "Réduction", status: "validated", validated_at: "2026-11-10T09:00:00.000Z" }),
      line({ id: LINE_D, position: 4, product_type: "Clapet", material: "PVC pression" }),
    ];
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ request: { presumed_material: "Laiton brut", material_confirmed: true }, lines }),
      },
      [`POST ${BASE}/lines/validate`]: (body) => ({
        data: {
          lines: lines
            .filter((entry) => (body as { ids: string[] }).ids.includes(entry.id))
            .map((entry) => ({ ...entry, status: "validated", validated_at: "2026-11-10T10:00:00.000Z" })),
        },
      }),
    });

    await user.click(screen.getByRole("button", { name: "Valider les lignes sans alerte (1)" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: "POST", path: `${BASE}/lines/validate`, body: { ids: [LINE_A] } });
    await waitFor(() => expect(screen.getAllByText("Validée")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (0)" })).toBeDisabled();
    expect(screen.getByLabelText("Quantité, ligne 2")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Valider la ligne 2" })).toBeDisabled();

    // The line that only carries a remark is validated by its own button, after a look.
    await user.click(screen.getByRole("button", { name: "Valider la ligne 4" }));

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ ids: [LINE_D] });
    await waitFor(() => expect(screen.getAllByText("Validée")).toHaveLength(3));
  });

  it("validates nothing and names the blocked lines when the server refuses (3)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ lines: [line(), line({ id: LINE_B, position: 2, quantity: null, product_type: "Bouchon fileté" })] }),
      },
      [`POST ${BASE}/lines/validate`]: {
        status: 422,
        error: {
          code: "MATERIAL_REQUEST_LINES_BLOCKED",
          message: "Certaines lignes ne peuvent pas être validées.",
          details: { blocked: [{ id: LINE_B, codes: ["quantity_missing"] }] },
        },
      },
    });

    await user.click(screen.getByRole("checkbox", { name: "Tout sélectionner" }));
    await user.click(screen.getByRole("button", { name: "Valider la sélection" }));

    const report = await screen.findByRole("alert");
    expect(writes()[0].body).toEqual({ ids: [LINE_A, LINE_B] });
    expect(report).toHaveTextContent("Rien n’a été validé");
    expect(report).toHaveTextContent("Ligne 2");
    expect(report).toHaveTextContent("Quantité à renseigner.");
    expect(report).not.toHaveTextContent("Ligne 1");
    expect(screen.queryByText("Validée")).not.toBeInTheDocument();
    expect(screen.getAllByText("Brouillon")).toHaveLength(2);
  });

  it("applies one value to the selected lines and nothing else (4)", async () => {
    const lines = [
      line({ material: null }),
      line({ id: LINE_B, position: 2, product_type: "Bouchon fileté", material: null }),
      line({ id: LINE_D, position: 3, product_type: "Clapet", material: null }),
    ];
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`PATCH ${BASE}/lines`]: {
        data: { lines: [{ ...lines[0], material: "PVC pression" }, { ...lines[1], material: "PVC pression" }] },
      },
    });

    await user.click(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1" }));
    await user.click(screen.getByRole("checkbox", { name: "Sélectionner la ligne 2" }));
    const bar = screen.getByRole("group", { name: "Actions sur la sélection" });
    await user.selectOptions(within(bar).getByLabelText("Champ à remplir"), "Matière");
    await user.type(within(bar).getByLabelText("Valeur à appliquer"), "PVC pression");
    await user.click(within(bar).getByRole("button", { name: "Appliquer à la sélection" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: `${BASE}/lines`,
      body: { ids: [LINE_A, LINE_B], patch: { material: "PVC pression" } },
    });
    await waitFor(() => expect(screen.getByLabelText("Matière, ligne 1")).toHaveValue("PVC pression"));
    expect(screen.getByLabelText("Matière, ligne 2")).toHaveValue("PVC pression");
    expect(screen.getByLabelText("Matière, ligne 3")).toHaveValue("");
  });

  it("keeps the presumed material a proposal until the operator confirms it (5)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: {
        data: detail({ request: { presumed_material: "Laiton brut" }, lines: [line({ material: null })] }),
      },
      [`PATCH ${BASE}`]: {
        data: {
          request: request({ presumed_material: "Laiton brut", material_confirmed: true }),
          reopened_line_ids: [],
        },
      },
    });

    expect(screen.getByText("Matière à confirmer")).toBeVisible();
    expect(screen.getByLabelText("Matière, ligne 1")).toHaveAccessibleDescription(
      expect.stringContaining("Matière présumée « Laiton brut » à confirmer."),
    );
    expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (0)" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Confirmer la matière" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    // The confirmation names the material the operator has on screen.
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: BASE,
      body: { material_confirmed: true, expected_presumed_material: "Laiton brut" },
    });
    expect(await screen.findByText("Matière confirmée")).toBeVisible();
    expect(screen.queryByText("Matière à confirmer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (1)" })).toBeEnabled();
  });

  it("keeps what was typed and says what failed when a cell cannot be saved (6)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`PATCH ${BASE}/lines/${LINE_A}`]: {
        status: 500,
        error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." },
      },
    });

    const type = screen.getByLabelText("Type, ligne 1");
    await user.clear(type);
    await user.type(type, "Raccord union femelle");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enregistrement impossible pour le moment.");
    expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Raccord union femelle");
    expect(screen.getByLabelText("Type, ligne 1")).toHaveAccessibleDescription(
      expect.stringContaining("Enregistrement impossible pour le moment."),
    );
  });

  it("keeps a quantity that could not be saved (6)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`PATCH ${BASE}/lines/${LINE_A}`]: {
        status: 500,
        error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." },
      },
    });

    const quantity = screen.getByLabelText("Quantité, ligne 1");
    await user.clear(quantity);
    await user.type(quantity, "12,5");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("Enregistrement impossible pour le moment.");
    expect(writes()[0].body).toEqual({ quantity: 12.5 });
    expect(screen.getByLabelText("Quantité, ligne 1")).toHaveValue("12,5");
  });

  it("offers no control that writes to a reader without write access (7)", async () => {
    await openEditor({
      [`GET ${BASE}`]: {
        data: detail({
          canWrite: false,
          request: { presumed_material: "Laiton brut", source_text: "6 raccords DN 32" },
          files: [file()],
          lines: [
            line({ material: null }),
            line({ id: LINE_C, position: 2, product_type: "Réduction", status: "validated", validated_at: "2026-11-10T09:00:00.000Z" }),
          ],
        }),
      },
      [`GET ${BASE}/files/${FILE_ID}`]: { data: null },
    });

    await screen.findByRole("img", { name: /photo-essai\.jpg/ });
    const fields = [
      ...screen.queryAllByRole("textbox"),
      ...screen.queryAllByRole("combobox"),
      ...screen.queryAllByRole("checkbox"),
    ];
    for (const field of fields) expect(field).toBeDisabled();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    const enabledButtons = screen
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled)
      .map((button) => button.textContent?.trim() || button.getAttribute("aria-label"));
    expect(enabledButtons.sort()).toEqual(["Agrandir", "Demandes précédentes de Alpha", "Message au technicien"].sort());
    expect(screen.getByText(/lecture seule/i)).toBeVisible();
  });

  it("creates the lines the pre-reading of the pasted message returned (8)", async () => {
    const drafts: MaterialRequestLineInput[] = [
      { original_text: "6 raccords DN 32", quantity: 6, unit: "u", dimension: "DN 32", product_type: "raccords" },
      { original_text: "un rouleau de filasse" },
    ];
    splitSourceTextMock.mockReturnValue(drafts);
    const created = [
      line({ original_text: "6 raccords DN 32", quantity: 6, dimension: "DN 32", product_type: "raccords", material: null }),
      line({
        id: LINE_B,
        position: 2,
        original_text: "un rouleau de filasse",
        quantity: null,
        unit: null,
        dimension: null,
        product_type: null,
        material: null,
      }),
    ];
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ request: { source_text: "6 raccords DN 32\nun rouleau de filasse" } }) },
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: created } },
    });

    await user.click(screen.getByRole("button", { name: "Découper le texte en lignes" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(splitSourceTextMock).toHaveBeenCalledWith("6 raccords DN 32\nun rouleau de filasse");
    expect(writes()[0]).toEqual({ method: "POST", path: `${BASE}/lines`, body: { lines: drafts } });
    expect(await screen.findByLabelText("Type, ligne 1")).toHaveValue("raccords");
    expect(screen.getByText("« un rouleau de filasse »")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Découper le texte en lignes" })).not.toBeInTheDocument();
  });

  it("shows the message built by the shared rules and copies it (9)", async () => {
    const lines = [line({ quantity: 12, quantity_doubtful: true }), line({ id: LINE_B, position: 2, quantity: null, product_type: "Bouchon fileté" })];
    const user = await openEditor({ [`GET ${BASE}`]: { data: detail({ lines }) } });
    const expected = buildClarificationMessage({
      technicianName: "Alpha",
      lines,
      context: { request: request(), lines },
    });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    await user.click(screen.getByRole("button", { name: "Message au technicien" }));
    const dialog = await screen.findByRole("dialog", { name: "Message au technicien" });
    expect(expected).toContain("c’est bien 12 ?");
    expect(within(dialog).getByLabelText("Message à envoyer")).toHaveValue(expected);

    await user.click(within(dialog).getByRole("button", { name: "Copier" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(await within(dialog).findByText("Message copié.")).toBeVisible();
  });

  it("says so when there is nothing to ask the technician (9)", async () => {
    const user = await openEditor({ [`GET ${BASE}`]: { data: detail({ lines: [line()] }) } });

    await user.click(screen.getByRole("button", { name: "Message au technicien" }));

    const dialog = await screen.findByRole("dialog", { name: "Message au technicien" });
    expect(within(dialog).getByText(/Rien à demander au technicien/)).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Copier" })).not.toBeInTheDocument();
  });

  it("saves the next quarter turn when a photo is rotated (10)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ files: [file({ rotation: 270 })] }) },
      [`GET ${BASE}/files/${FILE_ID}`]: { data: null },
      [`PATCH ${BASE}/files/${FILE_ID}`]: (body) => ({
        data: { file: file({ rotation: (body as { rotation: 0 | 90 | 180 | 270 }).rotation }) },
      }),
    });
    await screen.findByRole("img", { name: /photo-essai\.jpg/ });

    await user.click(screen.getByRole("button", { name: "Tourner à droite" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: "PATCH", path: `${BASE}/files/${FILE_ID}`, body: { rotation: 0 } });

    await user.click(screen.getByRole("button", { name: "Tourner à gauche" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ rotation: 270 });
  });

  it("drops the typing on Escape and saves only the edited column on Enter (11)", async () => {
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`PATCH ${BASE}/lines/${LINE_A}`]: (body) => ({ data: { line: line(body as Partial<MaterialRequestLine>) } }),
    });

    const dimension = screen.getByLabelText("DN / dimension, ligne 1");
    await user.clear(dimension);
    await user.type(dimension, "DN 40{Escape}");
    expect(dimension).toHaveValue("DN 32");
    await user.tab();
    expect(writes()).toHaveLength(0);

    const zone = screen.getByLabelText("Repère, ligne 1");
    await user.type(zone, "  Local technique B {Enter}");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: "PATCH", path: `${BASE}/lines/${LINE_A}`, body: { zone: "Local technique B" } });
    await waitFor(() => expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("Local technique B"));
  });

  it("keeps a validated line read-only until it is reopened (12)", async () => {
    const validated = line({ status: "validated", validated_at: "2026-11-10T09:00:00.000Z" });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [validated] }) },
      [`POST ${BASE}/lines/reopen`]: { data: { lines: [line()] } },
    });

    expect(screen.queryByLabelText("Type, ligne 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Sélectionner la ligne 1" })).not.toBeInTheDocument();
    expect(screen.getByText("Raccord union")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Rouvrir la ligne 1" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: "POST", path: `${BASE}/lines/reopen`, body: { ids: [LINE_A] } });
    expect(await screen.findByLabelText("Type, ligne 1")).toHaveValue("Raccord union");
  });

  it("adds an empty draft line and puts the cursor in it (14)", async () => {
    const added = line({
      id: LINE_B,
      position: 2,
      quantity: null,
      unit: null,
      dimension: null,
      product_type: null,
      material: null,
    });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [added] } },
    });

    await user.click(screen.getByRole("button", { name: "Ajouter une ligne" }));

    await waitFor(() => expect(screen.getByLabelText("Quantité, ligne 2")).toHaveFocus());
    expect(writes()).toEqual([{ method: "POST", path: `${BASE}/lines`, body: { lines: [{}] } }]);
    expect(screen.getByRole("button", { name: "Valider la ligne 2" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (1)" })).toBeEnabled();
  });

  it("copies a line of a previous request as a draft whose quantity must be checked (13)", async () => {
    const previous = line({
      id: LINE_C,
      request_id: "44444444-4444-4444-8444-444444444444",
      quantity: 6,
      product_type: "Robinet d’arrêt",
      dimension: "DN 40",
      zone: "Local pompes",
      status: "validated",
      validated_at: "2026-11-03T09:00:00.000Z",
      duplicate_acknowledged: true,
    });
    const copied = line({ ...previous, id: LINE_B, request_id: REQUEST_ID, quantity_doubtful: true, status: "draft", validated_at: null, duplicate_acknowledged: false });
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [] }) },
      [`GET /api/material-request-technicians/${TECHNICIAN_ID}/requests?limit=10`]: {
        data: {
          items: [
            {
              request: {
                ...request({ id: previous.request_id, requested_on: "2026-11-03" }),
                technician_name: "Alpha",
                line_count: 1,
                validated_line_count: 1,
                file_count: 0,
                project_name: "Chantier Exemple",
              },
              lines: [previous],
            },
          ],
        },
      },
      [`POST ${BASE}/lines`]: { status: 201, data: { lines: [copied] } },
    });

    await user.click(screen.getByRole("button", { name: "Demandes précédentes de Alpha" }));
    const history = await screen.findByRole("dialog", { name: "Demandes précédentes de Alpha" });
    expect(await within(history).findByText(/Chantier Exemple/)).toBeVisible();
    await user.click(within(history).getByRole("button", { name: "Recopier : Robinet d’arrêt DN 40" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      lines: [
        {
          original_text: null,
          quantity: 6,
          quantity_doubtful: true,
          unit: "u",
          dimension: "DN 40",
          no_dimension: false,
          product_type: "Robinet d’arrêt",
          material: "Laiton brut",
          material_precision: null,
          reference: null,
          supplier_id: null,
          zone: "Local pompes",
          imputation: "project",
          overhead_category: null,
        },
      ],
    });
  });
  describe("photos of the original", () => {
    const photos = () => [
      new File(["premiere"], "photo-essai-1.jpg", { type: "image/jpeg" }),
      new File(["seconde photo"], "photo-essai-2.jpg", { type: "image/jpeg" }),
    ];
    const prepared = {
      status: 201,
      data: {
        uploads: [
          {
            file: { id: FILE_ID, file_name: "photo-essai-1.jpg", mime_type: "image/jpeg", byte_size: 8 },
            path: "tenant/demande/photo-1.jpg",
            token: "jeton-1",
          },
          {
            file: { id: FILE_2, file_name: "photo-essai-2.jpg", mime_type: "image/jpeg", byte_size: 13 },
            path: "tenant/demande/photo-2.jpg",
            token: "jeton-2",
          },
        ],
      },
    };

    it("prepares, sends each photo to storage, then has the server check them before listing any (15)", async () => {
      let releaseFirst!: () => void;
      uploadToSignedUrlMock.mockImplementationOnce(
        (path: string) =>
          new Promise((resolve) => {
            events.push(`storage ${path}`);
            releaseFirst = () => resolve({ data: { path }, error: null });
          }),
      );
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`POST ${BASE}/files`]: prepared,
        [`POST ${BASE}/files/complete`]: {
          data: {
            files: [
              file({ file_name: "photo-essai-1.jpg" }),
              file({ id: FILE_2, file_name: "photo-essai-2.jpg" }),
            ],
          },
        },
        [`GET ${BASE}/files/${FILE_ID}`]: { data: null },
        [`GET ${BASE}/files/${FILE_2}`]: { data: null },
      });
      const chosen = photos();

      await user.upload(screen.getByLabelText("Photos à ajouter"), chosen);

      // While the first photo travels: the operator reads where it is, nothing is listed, nothing can be sent twice.
      expect(await screen.findByText("Envoi de la photo 1 sur 2 : photo-essai-1.jpg…")).toBeVisible();
      expect(screen.getByRole("button", { name: "Ajouter des photos" })).toBeDisabled();
      expect(screen.getByLabelText("Photos à ajouter")).toBeDisabled();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Type, ligne 1")).toBeEnabled();
      releaseFirst();

      expect(await screen.findByRole("img", { name: /photo-essai-1\.jpg/ })).toBeVisible();
      expect(events).toEqual([
        `POST ${BASE}/files`,
        "storage tenant/demande/photo-1.jpg",
        "storage tenant/demande/photo-2.jpg",
        `POST ${BASE}/files/complete`,
      ]);
      expect(writes()[0].body).toEqual({
        files: [
          { name: "photo-essai-1.jpg", mime_type: "image/jpeg", byte_size: 8 },
          { name: "photo-essai-2.jpg", mime_type: "image/jpeg", byte_size: 13 },
        ],
      });
      expect(storageFromMock).toHaveBeenCalledWith("material-requests");
      expect(uploadToSignedUrlMock.mock.calls).toEqual([
        ["tenant/demande/photo-1.jpg", "jeton-1", chosen[0], { contentType: "image/jpeg" }],
        ["tenant/demande/photo-2.jpg", "jeton-2", chosen[1], { contentType: "image/jpeg" }],
      ]);
      expect(writes()[1].body).toEqual({ ids: [FILE_ID, FILE_2] });
      expect(screen.getByText("Photo 1 sur 2")).toBeVisible();
      expect(screen.getByRole("button", { name: "Ajouter des photos" })).toBeEnabled();
    });

    it("shows the server's sentence and sends nothing to storage when the preparation is refused (15)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({}) },
        [`POST ${BASE}/files`]: {
          status: 422,
          error: { code: "UNSUPPORTED_FILE", message: "Format HEIC refusé : envoyez la photo en JPEG." },
        },
      });

      await user.upload(screen.getByLabelText("Photos à ajouter"), photos());

      expect(await screen.findByRole("alert")).toHaveTextContent("Format HEIC refusé : envoyez la photo en JPEG.");
      expect(uploadToSignedUrlMock).not.toHaveBeenCalled();
      expect(events).toEqual([`POST ${BASE}/files`]);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText("Pas de photo de l’original.")).toBeVisible();
    });

    it("drops what was prepared and lists nothing when a photo does not reach storage (15)", async () => {
      uploadToSignedUrlMock.mockImplementation(async (path: string) => {
        events.push(`storage ${path}`);
        return path.endsWith("photo-2.jpg")
          ? { data: null, error: { message: "network" } }
          : { data: { path }, error: null };
      });
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({}) },
        [`POST ${BASE}/files`]: prepared,
        [`DELETE ${BASE}/files/${FILE_ID}`]: { data: { deleted: true } },
        [`DELETE ${BASE}/files/${FILE_2}`]: { data: { deleted: true } },
      });

      await user.upload(screen.getByLabelText("Photos à ajouter"), photos());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "L’envoi de « photo-essai-2.jpg » a échoué. Aucune photo n’a été gardée : vous pouvez réessayer.",
      );
      expect(events.slice(0, 3)).toEqual([
        `POST ${BASE}/files`,
        "storage tenant/demande/photo-1.jpg",
        "storage tenant/demande/photo-2.jpg",
      ]);
      expect(events.slice(3).sort()).toEqual([`DELETE ${BASE}/files/${FILE_ID}`, `DELETE ${BASE}/files/${FILE_2}`].sort());
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText("Pas de photo de l’original.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Ajouter des photos" })).toBeEnabled();
    });

    it("waits for the photo in flight, then drops what was prepared, when the operator leaves the request (15)", async () => {
      let releaseFirst!: () => void;
      uploadToSignedUrlMock.mockImplementationOnce(
        (path: string) =>
          new Promise((resolve) => {
            events.push(`storage ${path}`);
            releaseFirst = () => resolve({ data: { path }, error: null });
          }),
      );
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({}) },
        [`POST ${BASE}/files`]: prepared,
        [`DELETE ${BASE}/files/${FILE_ID}`]: { data: { deleted: true } },
        [`DELETE ${BASE}/files/${FILE_2}`]: { data: { deleted: true } },
      });
      await user.upload(screen.getByLabelText("Photos à ajouter"), photos());
      await screen.findByText("Envoi de la photo 1 sur 2 : photo-essai-1.jpg…");

      cleanup();

      // The photo on its way cannot be called back: its row stays until it has landed, so that its
      // bytes are never stored with nothing pointing at them.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toEqual([`POST ${BASE}/files`, "storage tenant/demande/photo-1.jpg"]);

      releaseFirst();

      await waitFor(() =>
        expect(events.slice(2).sort()).toEqual(
          [`DELETE ${BASE}/files/${FILE_ID}`, `DELETE ${BASE}/files/${FILE_2}`].sort(),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toHaveLength(4);
      expect(uploadToSignedUrlMock).toHaveBeenCalledTimes(1);
    });

    it("does not have the server list the last photo when the operator left while it travelled (15)", async () => {
      let releaseOnly!: () => void;
      uploadToSignedUrlMock.mockImplementationOnce(
        (path: string) =>
          new Promise((resolve) => {
            events.push(`storage ${path}`);
            releaseOnly = () => resolve({ data: { path }, error: null });
          }),
      );
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({}) },
        [`POST ${BASE}/files`]: { status: 201, data: { uploads: prepared.data.uploads.slice(0, 1) } },
        [`DELETE ${BASE}/files/${FILE_ID}`]: { data: { deleted: true } },
      });
      await user.upload(screen.getByLabelText("Photos à ajouter"), photos().slice(0, 1));
      await screen.findByText("Envoi de la photo 1 sur 1 : photo-essai-1.jpg…");

      cleanup();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toEqual([`POST ${BASE}/files`, "storage tenant/demande/photo-1.jpg"]);
      releaseOnly();

      await waitFor(() => expect(events.slice(2)).toEqual([`DELETE ${BASE}/files/${FILE_ID}`]));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toHaveLength(3);
    });

    it("sends a photo the browser gives no type to with the type the server recorded (15)", async () => {
      await openEditor({
        [`GET ${BASE}`]: { data: detail({}) },
        [`POST ${BASE}/files`]: {
          status: 201,
          data: {
            uploads: [
              {
                file: { id: FILE_ID, file_name: "photo-essai-3.jpg", mime_type: "image/jpeg", byte_size: 6 },
                path: "tenant/demande/photo-3.jpg",
                token: "jeton-3",
              },
            ],
          },
        },
        [`POST ${BASE}/files/complete`]: { data: { files: [file({ file_name: "photo-essai-3.jpg" })] } },
        [`GET ${BASE}/files/${FILE_ID}`]: { data: null },
      });
      const untyped = new File(["octets"], "photo-essai-3.jpg", { type: "" });

      fireEvent.change(screen.getByLabelText("Photos à ajouter"), { target: { files: [untyped] } });

      expect(await screen.findByRole("img", { name: /photo-essai-3\.jpg/ })).toBeVisible();
      expect(writes()[0].body).toEqual({ files: [{ name: "photo-essai-3.jpg", mime_type: "", byte_size: 6 }] });
      const [path, token, sent, options] = uploadToSignedUrlMock.mock.calls[0] as [string, string, File, unknown];
      expect([path, token]).toEqual(["tenant/demande/photo-3.jpg", "jeton-3"]);
      expect(options).toEqual({ contentType: "image/jpeg" });
      expect(sent).toBeInstanceOf(File);
      expect(sent.type).toBe("image/jpeg");
      expect(sent.name).toBe("photo-essai-3.jpg");
      expect(await sent.text()).toBe("octets");
    });

    it("lists nothing and says why when the server rejects what was stored (15)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({}) },
        [`POST ${BASE}/files`]: prepared,
        [`POST ${BASE}/files/complete`]: {
          status: 422,
          error: {
            code: "MATERIAL_REQUEST_FILE_REJECTED",
            message: "Les fichiers reçus ne correspondent pas à ce qui était annoncé.",
            details: { rejected: [{ id: FILE_2, reason: "size" }] },
          },
        },
      });

      await user.upload(screen.getByLabelText("Photos à ajouter"), photos());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "L’envoi a été refusé : « photo-essai-2.jpg » est arrivée incomplète. Aucune photo n’a été gardée : vous pouvez réessayer.",
      );
      expect(events.at(-1)).toBe(`POST ${BASE}/files/complete`);
      expect(events.filter((event) => event.startsWith("DELETE"))).toEqual([]);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText("Pas de photo de l’original.")).toBeVisible();
    });
  });

  describe("presumed material and validated lines", () => {
    const relying = (partial: Partial<MaterialRequestLine> = {}) =>
      line({ material: null, status: "validated", validated_at: "2026-11-10T09:00:00.000Z", ...partial });
    const confirmed = { presumed_material: "Laiton brut", material_confirmed: true };

    it("says beforehand that validated lines rely on the material, then returns them to draft with the reason (16)", async () => {
      const lines = [
        relying(),
        line({ id: LINE_B, position: 2, product_type: "Réduction", status: "validated", validated_at: "2026-11-10T09:00:00.000Z" }),
      ];
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ request: confirmed, lines }) },
        [`PATCH ${BASE}`]: {
          data: {
            request: request({ presumed_material: "Laiton brut", material_confirmed: false }),
            reopened_line_ids: [LINE_A],
          },
        },
      });

      const consequence =
        "1 ligne validée compte sur cette matière : la modifier, l’effacer ou annuler sa confirmation la fera repasser en brouillon.";
      expect(screen.getByText(consequence)).toBeVisible();
      const withdraw = screen.getByRole("button", { name: "Annuler la confirmation de la matière" });
      expect(withdraw).toHaveAccessibleDescription(consequence);
      expect(screen.getByLabelText("Matière présumée")).toHaveAccessibleDescription(consequence);
      expect(screen.queryByText(/repassée en brouillon/)).not.toBeInTheDocument();

      await user.click(withdraw);

      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]).toEqual({ method: "PATCH", path: BASE, body: { material_confirmed: false } });
      expect(
        await screen.findByText(
          "1 ligne validée est repassée en brouillon : elle comptait sur la matière présumée de la demande, qui vient de changer.",
        ),
      ).toBeVisible();
      expect(screen.getByLabelText("Type, ligne 1")).toHaveValue("Raccord union");
      expect(screen.getAllByText("Brouillon")).toHaveLength(1);
      expect(screen.getAllByText("Validée")).toHaveLength(1);
      expect(screen.queryByLabelText("Type, ligne 2")).not.toBeInTheDocument();
      expect(screen.queryByText(consequence)).not.toBeInTheDocument();
    });

    it("counts every line returned to draft when the material itself is changed (16)", async () => {
      const lines = [relying(), relying({ id: LINE_B, position: 2, product_type: "Réduction" })];
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ request: confirmed, lines }) },
        [`PATCH ${BASE}`]: {
          data: {
            request: request({ presumed_material: "PVC pression", material_confirmed: false }),
            reopened_line_ids: [LINE_A, LINE_B],
          },
        },
      });

      expect(screen.getByText(/^2 lignes validées comptent sur cette matière/)).toBeVisible();
      const material = screen.getByLabelText("Matière présumée");
      await user.clear(material);
      await user.type(material, "PVC pression");
      await user.tab();

      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0].body).toEqual({ presumed_material: "PVC pression", material_confirmed: false });
      expect(
        await screen.findByText(
          "2 lignes validées sont repassées en brouillon : elles comptaient sur la matière présumée de la demande, qui vient de changer.",
        ),
      ).toBeVisible();
      expect(screen.getAllByText("Brouillon")).toHaveLength(2);
      expect(screen.queryByText("Validée")).not.toBeInTheDocument();
      expect(screen.getByText("Matière à confirmer")).toBeVisible();
    });

    it("says nothing about lines when no validated line relies on the material (16)", async () => {
      await openEditor({
        [`GET ${BASE}`]: {
          data: detail({
            request: confirmed,
            lines: [line({ status: "validated", validated_at: "2026-11-10T09:00:00.000Z" }), line({ id: LINE_B, position: 2, material: null })],
          }),
        },
      });

      expect(screen.getByText("Matière confirmée")).toBeVisible();
      expect(screen.queryByText(/compte sur cette matière|comptent sur cette matière/)).not.toBeInTheDocument();
    });
  });

  it("says how many lines of a long message were read, created and left to do by hand (17)", async () => {
    const read: MaterialRequestLineInput[] = Array.from({ length: 302 }, (_, index) => ({
      original_text: `article ${index + 1}`,
    }));
    splitSourceTextMock.mockReturnValue(read);
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ request: { source_text: "article 1\narticle 2" } }) },
      [`POST ${BASE}/lines`]: {
        status: 201,
        data: { lines: [line({ original_text: "article 1", quantity: null, product_type: null, material: null })] },
      },
    });

    await user.click(screen.getByRole("button", { name: "Découper le texte en lignes" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0].body as { lines: unknown[] }).lines).toEqual(read.slice(0, 300));
    const notice = await screen.findByText(/lignes lues dans ce message/);
    expect(notice).toHaveTextContent("302 lignes lues dans ce message, 300 créées en brouillon : une demande en compte 300 au plus.");
    expect(notice).toHaveTextContent("Les 2 dernières sont à reprendre à la main, à partir du message qui reste affiché ci-dessus.");
    expect(screen.queryByRole("button", { name: "Découper le texte en lignes" })).not.toBeInTheDocument();
    expect(screen.getByText(/^article 1\s+article 2$/)).toBeVisible();
  });

  it("does not bring back as selected a line that left the drafts and is reopened (18)", async () => {
    const lines = [line(), line({ id: LINE_B, position: 2, product_type: "Réduction" })];
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines }) },
      [`POST ${BASE}/lines/validate`]: {
        data: { lines: [{ ...lines[0], status: "validated", validated_at: "2026-11-10T10:00:00.000Z" }] },
      },
      [`POST ${BASE}/lines/reopen`]: { data: { lines: [lines[0]] } },
      [`PATCH ${BASE}/lines`]: { data: { lines: [{ ...lines[1], zone: "Local technique B" }] } },
    });

    await user.click(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1" }));
    await user.click(screen.getByRole("button", { name: "Valider la sélection" }));
    await user.click(await screen.findByRole("button", { name: "Rouvrir la ligne 1" }));

    expect(await screen.findByRole("checkbox", { name: "Sélectionner la ligne 1" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Valider la sélection" })).toBeDisabled();

    // A bulk action made now reaches only what the operator checks now.
    await user.click(screen.getByRole("checkbox", { name: "Sélectionner la ligne 2" }));
    const bar = screen.getByRole("group", { name: "Actions sur la sélection" });
    await user.selectOptions(within(bar).getByLabelText("Champ à remplir"), "Repère");
    await user.type(within(bar).getByLabelText("Valeur à appliquer"), "Local technique B");
    await user.click(within(bar).getByRole("button", { name: "Appliquer à la sélection" }));

    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[2].body).toEqual({ ids: [LINE_B], patch: { zone: "Local technique B" } });
  });
  describe("a correction made while a save is on its way", () => {
    /** Holds the first save of the line until `release` is called; later ones answer at once. */
    function heldLineSaves(first: (body: unknown) => Reply = (body) => ({ data: { line: line(body as Partial<MaterialRequestLine>) } })) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let count = 0;
      const route: Route = async (body) => {
        count += 1;
        if (count > 1) return { data: { line: line(body as Partial<MaterialRequestLine>) } };
        await held;
        return first(body);
      };
      return { route, release: () => release() };
    }

    it("queues a text cell put back to its saved value, so the last write carries it (19)", async () => {
      const saves = heldLineSaves();
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: saves.route,
      });

      const dimension = screen.getByLabelText("DN / dimension, ligne 1");
      await user.clear(dimension);
      await user.type(dimension, "DN 40{Enter}");
      await waitFor(() => expect(writes()).toHaveLength(1));
      await user.clear(dimension);
      await user.type(dimension, "DN 32");
      await user.tab();
      saves.release();

      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(writes().map((call) => call.body)).toEqual([{ dimension: "DN 40" }, { dimension: "DN 32" }]);
      await waitFor(() => expect(screen.getByLabelText("DN / dimension, ligne 1")).toHaveValue("DN 32"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("queues a quantity put back to its saved value, so the last write carries it (19)", async () => {
      const saves = heldLineSaves();
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: saves.route,
      });

      const quantity = screen.getByLabelText("Quantité, ligne 1");
      await user.clear(quantity);
      await user.type(quantity, "12{Enter}");
      await waitFor(() => expect(writes()).toHaveLength(1));
      await user.clear(quantity);
      await user.type(quantity, "10");
      await user.tab();
      expect(screen.getByLabelText("Quantité, ligne 1")).toHaveValue("10");
      saves.release();

      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(writes().map((call) => call.body)).toEqual([{ quantity: 12 }, { quantity: 10 }]);
      await waitFor(() => expect(screen.getByLabelText("Quantité, ligne 1")).toHaveValue("10"));
    });

    it("does not leave the error of an earlier choice on a select whose later choice was saved (19)", async () => {
      const saves = heldLineSaves(() => ({
        status: 500,
        error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." },
      }));
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: saves.route,
      });

      const imputation = screen.getByLabelText("Imputation, ligne 1");
      await user.selectOptions(imputation, "Frais généraux");
      await waitFor(() => expect(writes()).toHaveLength(1));
      await user.selectOptions(imputation, "Affaire");
      saves.release();

      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(writes().map((call) => call.body)).toEqual([
        { imputation: "overhead" },
        { imputation: "project", overhead_category: null },
      ]);
      await waitFor(() => expect(screen.getByLabelText("Imputation, ligne 1")).toHaveDisplayValue("Affaire"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("queues a date of the request put back to empty while its save is on its way (19)", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    const user = await openEditor({
      [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
      [`PATCH ${BASE}`]: async (body) => {
        count += 1;
        if (count === 1) await held;
        return { data: { request: request(body as Partial<MaterialRequest>), reopened_line_ids: [] } };
      },
    });

    const needed = screen.getByLabelText("Date de besoin");
    await user.type(needed, "2026-11-20");
    await user.tab();
    await waitFor(() => expect(writes()).toHaveLength(1));
    await user.clear(needed);
    await user.tab();
    release();

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((call) => call.body)).toEqual([{ needed_on: "2026-11-20" }, { needed_on: null }]);
    await waitFor(() => expect(screen.getByLabelText("Date de besoin")).toHaveValue(""));
  });

  describe("material and supplier that come from the request, on rows that are not edited", () => {
    const SUPPLIER_ID = "99999999-9999-4999-8999-999999999999";
    const confirmed = {
      presumed_material: "Laiton brut",
      material_confirmed: true,
      presumed_supplier_id: SUPPLIER_ID,
      supplier_confirmed: true,
    };
    const validated = (partial: Partial<MaterialRequestLine> = {}) =>
      line({ status: "validated", validated_at: "2026-11-10T09:00:00.000Z", ...partial });

    it("shows on a validated line what the confirmed request gives it, apart from what it names itself (20)", async () => {
      await openEditor({
        [`GET ${BASE}`]: {
          data: detail({
            request: confirmed,
            lines: [
              validated({ material: null }),
              validated({ id: LINE_B, position: 2, product_type: "Réduction", material: "PVC pression", supplier_id: SUPPLIER_ID }),
              validated({ id: LINE_C, position: 3, product_type: "Gants", material: null, imputation: "overhead" }),
            ],
          }),
        },
      });

      const rows = screen.getAllByRole("rowgroup").filter((group) => group.tagName === "TBODY");
      expect(within(rows[0]).getByText("Laiton brut (demande)")).toBeVisible();
      // TI-691: the office chooses the supplier of a validated line in place (it stays validated), so the
      // supplier is a select there; what it shows is what the line is bought from.
      expect(within(rows[0]).getByLabelText("Fournisseur, ligne 1")).toHaveDisplayValue("Négoce Exemple (demande)");
      expect(within(rows[1]).getByText("PVC pression")).toBeVisible();
      expect(within(rows[1]).getByLabelText("Fournisseur, ligne 2")).toHaveDisplayValue("Négoce Exemple");
      expect(within(rows[1]).queryByText("Laiton brut (demande)")).not.toBeInTheDocument();
      // Overhead is not ordered in the sheet's material.
      expect(within(rows[2]).queryByText("Laiton brut (demande)")).not.toBeInTheDocument();
    });

    it("shows it to a reader without write access too, on lines still in draft (20)", async () => {
      await openEditor({
        [`GET ${BASE}`]: { data: detail({ canWrite: false, request: confirmed, lines: [line({ material: null })] }) },
      });

      expect(screen.getByText("Laiton brut (demande)")).toBeVisible();
      expect(screen.getByText("Négoce Exemple (demande)")).toBeVisible();
    });

    it("does not show an unconfirmed presumption as applying (20)", async () => {
      await openEditor({
        [`GET ${BASE}`]: {
          data: detail({
            canWrite: false,
            request: { ...confirmed, material_confirmed: false, supplier_confirmed: false },
            lines: [line({ material: null })],
          }),
        },
      });

      expect(screen.queryByText(/\(demande\)/)).not.toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Points à régler, ligne 1" })).toHaveTextContent(
        "Matière présumée « Laiton brut » à confirmer.",
      );
    });
  });
  describe("confirming what the request presumes", () => {
    const SUPPLIER_ID = "99999999-9999-4999-8999-999999999999";
    const OTHER_SUPPLIER_ID = "77777777-7777-4777-8777-777777777777";
    const changedElsewhere = (field: string, message: string): Reply => ({
      status: 409,
      error: { code: "MATERIAL_REQUEST_PRESUMPTION_CHANGED", message, details: { field } },
    });

    it("confirms nothing, shows the server's sentence and the material now stored when it changed elsewhere (21)", async () => {
      let reads = 0;
      const sentence = "La matière présumée a été modifiée entre-temps : relisez-la avant de la confirmer.";
      const user = await openEditor({
        [`GET ${BASE}`]: () => {
          reads += 1;
          return {
            data: detail({
              request: { presumed_material: reads === 1 ? "Laiton brut" : "PVC pression" },
              lines: [line({ material: null })],
            }),
          };
        },
        [`PATCH ${BASE}`]: changedElsewhere("presumed_material", sentence),
      });

      await user.click(screen.getByRole("button", { name: "Confirmer la matière" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
      expect(writes()).toEqual([
        { method: "PATCH", path: BASE, body: { material_confirmed: true, expected_presumed_material: "Laiton brut" } },
      ]);
      expect(reads).toBe(2);
      expect(screen.getByLabelText("Matière présumée")).toHaveValue("PVC pression");
      expect(screen.getByText("Matière à confirmer")).toBeVisible();
      expect(screen.queryByText("Matière confirmée")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (0)" })).toBeDisabled();
    });

    it("sends the supplier on screen with its confirmation, and confirms nothing when it changed elsewhere (21)", async () => {
      let reads = 0;
      const sentence = "Le fournisseur présumé a été modifié entre-temps : relisez-le avant de le confirmer.";
      const suppliers = [
        { id: SUPPLIER_ID, name: "Négoce Exemple" },
        { id: OTHER_SUPPLIER_ID, name: "Comptoir Fictif" },
      ];
      const user = await openEditor({
        [`GET ${BASE}`]: () => {
          reads += 1;
          return {
            data: {
              ...detail({ request: { presumed_supplier_id: reads === 1 ? SUPPLIER_ID : OTHER_SUPPLIER_ID }, lines: [line()] }),
              supplierOptions: suppliers,
            },
          };
        },
        [`PATCH ${BASE}`]: changedElsewhere("presumed_supplier_id", sentence),
      });
      expect(screen.getByLabelText("Fournisseur présumé")).toHaveDisplayValue("Négoce Exemple");

      await user.click(screen.getByRole("button", { name: "Confirmer le fournisseur" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
      expect(writes()).toEqual([
        { method: "PATCH", path: BASE, body: { supplier_confirmed: true, expected_presumed_supplier_id: SUPPLIER_ID } },
      ]);
      expect(screen.getByLabelText("Fournisseur présumé")).toHaveDisplayValue("Comptoir Fictif");
      expect(screen.getByText("Fournisseur à confirmer")).toBeVisible();
      expect(screen.queryByText("Fournisseur confirmé")).not.toBeInTheDocument();
    });

    it("does not confirm a material that is typed but not saved yet, then confirms the saved one (21)", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ request: { presumed_material: "Laiton brut" }, lines: [line()] }) },
        [`PATCH ${BASE}`]: async (body) => {
          const patch = body as Partial<MaterialRequest>;
          if (patch.presumed_material !== undefined) await held;
          return {
            data: {
              request: request({ presumed_material: "PVC pression", material_confirmed: patch.material_confirmed === true }),
              reopened_line_ids: [],
            },
          };
        },
      });

      const material = screen.getByLabelText("Matière présumée");
      await user.clear(material);
      await user.type(material, "PVC pression");
      const confirm = screen.getByRole("button", { name: "Confirmer la matière" });
      expect(confirm).toHaveAttribute("aria-disabled", "true");
      expect(confirm).toHaveAccessibleDescription(
        "La matière saisie n’est pas encore enregistrée : confirmez-la une fois qu’elle l’est.",
      );

      // Pressing it leaves the field, which saves the material; it confirms nothing while that save runs.
      await user.click(confirm);
      await waitFor(() => expect(writes()).toHaveLength(1));
      await user.click(confirm);
      expect(writes().map((call) => call.body)).toEqual([{ presumed_material: "PVC pression", material_confirmed: false }]);
      release();

      await waitFor(() => expect(screen.getByRole("button", { name: "Confirmer la matière" })).not.toHaveAttribute("aria-disabled"));
      await user.click(screen.getByRole("button", { name: "Confirmer la matière" }));

      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(writes()[1].body).toEqual({ material_confirmed: true, expected_presumed_material: "PVC pression" });
      expect(await screen.findByText("Matière confirmée")).toBeVisible();
    });
  });

  describe("a line whose last change was not saved", () => {
    const refused: Reply = {
      status: 500,
      error: { code: "INTERNAL", message: "Enregistrement impossible pour le moment." },
    };
    const validation: Route = (body) => ({
      data: {
        lines: [line(), line({ id: LINE_B, position: 2, product_type: "Réduction" })]
          .filter((entry) => (body as { ids: string[] }).ids.includes(entry.id))
          .map((entry) => ({ ...entry, status: "validated", validated_at: "2026-11-10T10:00:00.000Z" })),
      },
    });
    const twoLines = () => [line(), line({ id: LINE_B, position: 2, product_type: "Réduction" })];
    const notValidated = "La ligne 1 n’a pas été validée : sa dernière modification n’a pas été enregistrée.";

    it("is not validated by its own button when the save queued before the validation fails (22)", async () => {
      let reject!: () => void;
      const held = new Promise<void>((resolve) => {
        reject = resolve;
      });
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: async () => {
          await held;
          return refused;
        },
        [`POST ${BASE}/lines/validate`]: validation,
      });

      await user.type(screen.getByLabelText("Repère, ligne 1"), "Local technique B");
      // Leaving the cell queues its save; the validation is queued right behind it.
      await user.click(screen.getByRole("button", { name: "Valider la ligne 1" }));
      await waitFor(() => expect(writes()).toHaveLength(1));
      reject();

      expect(await screen.findByText(notValidated)).toBeVisible();
      expect(events).toEqual([`PATCH ${BASE}/lines/${LINE_A}`]);
      expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("Local technique B");
      expect(screen.getByRole("alert")).toHaveTextContent("Non enregistré : Enregistrement impossible pour le moment.");
      expect(screen.getByText("Brouillon")).toBeVisible();
      expect(screen.queryByText("Validée")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Valider la ligne 1" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (0)" })).toBeDisabled();
    });

    it("is left out of the one-gesture validation while the other ready lines are validated (22)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: twoLines() }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: refused,
        [`POST ${BASE}/lines/validate`]: validation,
      });
      expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (2)" })).toBeEnabled();

      await user.type(screen.getByLabelText("Repère, ligne 1"), "Local technique B");
      await user.tab();
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Valider les lignes sans alerte (1)" }));

      await waitFor(() => expect(writes()).toHaveLength(2));
      expect(writes()[1]).toEqual({ method: "POST", path: `${BASE}/lines/validate`, body: { ids: [LINE_B] } });
      await waitFor(() => expect(screen.getAllByText("Validée")).toHaveLength(1));
      expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("Local technique B");
      expect(screen.getByRole("alert")).toHaveTextContent("Non enregistré");
    });

    it("is left out of « Valider la sélection », which says so and validates the others (22)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: twoLines() }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: refused,
        [`POST ${BASE}/lines/validate`]: validation,
      });

      await user.type(screen.getByLabelText("Repère, ligne 1"), "Local technique B");
      await user.tab();
      await screen.findByRole("alert");
      await user.click(screen.getByRole("checkbox", { name: "Tout sélectionner" }));
      await user.click(screen.getByRole("button", { name: "Valider la sélection" }));

      expect(await screen.findByText(notValidated)).toBeVisible();
      expect(writes()[1].body).toEqual({ ids: [LINE_B] });
      await waitFor(() => expect(screen.getAllByText("Validée")).toHaveLength(1));
      expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("Local technique B");
    });

    it("validates once its change is saved on a second try (22)", async () => {
      let saves = 0;
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: (body) => {
          saves += 1;
          return saves === 1 ? refused : { data: { line: line(body as Partial<MaterialRequestLine>) } };
        },
        [`POST ${BASE}/lines/validate`]: (body) => ({
          data: {
            lines: (body as { ids: string[] }).ids.map((id) =>
              line({ id, zone: "Local technique B", status: "validated", validated_at: "2026-11-10T10:00:00.000Z" }),
            ),
          },
        }),
      });

      const zone = screen.getByLabelText("Repère, ligne 1");
      await user.type(zone, "Local technique B");
      await user.tab();
      await screen.findByRole("alert");
      expect(screen.getByRole("button", { name: "Valider la ligne 1" })).toBeDisabled();

      // Leaving the cell again sends the same value again.
      await user.click(zone);
      await user.tab();
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Valider les lignes sans alerte (1)" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Valider la ligne 1" }));

      expect(await screen.findByText("Validée")).toBeVisible();
      expect(writes().map((call) => call.body)).toEqual([
        { zone: "Local technique B" },
        { zone: "Local technique B" },
        { ids: [LINE_A] },
      ]);
      expect(screen.getByText("Local technique B")).toBeVisible();
    });

    it("can be validated again once the operator drops the change that was not saved (22)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: [line()] }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: refused,
        [`POST ${BASE}/lines/validate`]: validation,
      });

      const zone = screen.getByLabelText("Repère, ligne 1");
      await user.type(zone, "Local technique B");
      await user.tab();
      await screen.findByRole("alert");
      await user.click(zone);
      await user.keyboard("{Escape}");

      expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Valider la ligne 1" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Valider les lignes sans alerte (1)" }));
      expect(await screen.findByText("Validée")).toBeVisible();
      expect(writes()[1].body).toEqual({ ids: [LINE_A] });
    });

    it("is left alone by a bulk change of the column that holds its unsaved value, and the operator is told (22)", async () => {
      const user = await openEditor({
        [`GET ${BASE}`]: { data: detail({ lines: twoLines() }) },
        [`PATCH ${BASE}/lines/${LINE_A}`]: refused,
        [`PATCH ${BASE}/lines`]: (body) => ({
          data: {
            lines: twoLines()
              .filter((entry) => (body as { ids: string[] }).ids.includes(entry.id))
              .map((entry) => ({ ...entry, zone: "Local technique B" })),
          },
        }),
      });

      await user.type(screen.getByLabelText("Repère, ligne 1"), "Local pompes");
      await user.tab();
      await screen.findByRole("alert");
      await user.click(screen.getByRole("checkbox", { name: "Tout sélectionner" }));
      const bar = screen.getByRole("group", { name: "Actions sur la sélection" });
      await user.selectOptions(within(bar).getByLabelText("Champ à remplir"), "Repère");
      await user.type(within(bar).getByLabelText("Valeur à appliquer"), "Local technique B");
      await user.click(within(bar).getByRole("button", { name: "Appliquer à la sélection" }));

      expect(
        await screen.findByText(
          "La ligne 1 n’a pas été modifiée : une valeur saisie dans cette colonne n’y est pas enregistrée.",
        ),
      ).toBeVisible();
      expect(writes()[1]).toEqual({
        method: "PATCH",
        path: `${BASE}/lines`,
        body: { ids: [LINE_B], patch: { zone: "Local technique B" } },
      });
      expect(screen.getByLabelText("Repère, ligne 1")).toHaveValue("Local pompes");
      expect(screen.getByRole("alert")).toHaveTextContent("Non enregistré");
      await waitFor(() => expect(screen.getByLabelText("Repère, ligne 2")).toHaveValue("Local technique B"));
    });
  });
});
