import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MaterialRequestSummary, MaterialRequestTechnician } from "@/lib/material-requests/contracts";

/**
 * Failure modes, written before the screen (TI-690):
 *  1. a request is listed without what the office looks at first (who asked, when, urgency, how far its
 *     validation is), or an affaire without any request shows an empty page with no way forward;
 *  2. creating a request sends something else than the chosen technician and the pasted message, or
 *     leaves the operator on the list;
 *  3. a technician added on the spot is not the one selected, or a name the server refuses fails silently;
 *  4. the photos chosen at creation go to storage before the request exists or before the server prepared
 *     them, the request is opened before the server checked them, or the form is sent twice; or their
 *     refusal hides that the request itself exists and creates it a second time;
 *  5. a reader without write access is offered « Nouvelle demande »;
 *  6. after a request was created without its photos, reopening « Nouvelle demande » shows that old
 *     request again instead of a form, until the page is reloaded.
 */

const { pushMock, storageFromMock, uploadToSignedUrlMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  storageFromMock: vi.fn(),
  uploadToSignedUrlMock: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ storage: { from: storageFromMock } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }) }));

import { MaterialRequestsList } from "@/components/material-requests/MaterialRequestsList";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ALPHA = "33333333-3333-4333-8333-333333333333";
const BRAVO = "55555555-5555-4555-8555-555555555555";
const BASE = `/api/affaires/${PROJECT_ID}/material-requests`;
const REQUEST_HREF = `/dashboard/affaires/${PROJECT_ID}/demandes-materiel/${REQUEST_ID}`;

function technician(partial: Partial<MaterialRequestTechnician> = {}): MaterialRequestTechnician {
  return { id: ALPHA, name: "Alpha", current_project_id: null, is_active: true, ...partial };
}

function summary(partial: Partial<MaterialRequestSummary> = {}): MaterialRequestSummary {
  return {
    id: REQUEST_ID,
    project_id: PROJECT_ID,
    technician_id: ALPHA,
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
    technician_name: "Alpha",
    line_count: 0,
    validated_line_count: 0,
    file_count: 0,
    ...partial,
  };
}

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string } };
type Route = Reply | ((body: unknown) => Reply);
type Call = { method: string; path: string; body: unknown };

let calls: Call[] = [];
/** Writes to the application, uploads to storage and the navigation, in the order they happened. */
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
            ? route(body)
            : route;
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload };
    }),
  );
}

function writes(): Call[] {
  return calls.filter((call) => call.method !== "GET");
}

function list(options: { items?: MaterialRequestSummary[]; technicians?: MaterialRequestTechnician[]; canWrite?: boolean }) {
  return {
    data: {
      items: options.items ?? [],
      technicians: options.technicians ?? [technician(), technician({ id: BRAVO, name: "Bravo" })],
      canWrite: options.canWrite ?? true,
    },
  };
}

const CREATED = {
  status: 201,
  data: { request: summary(), technician: technician(), files: [], lines: [] },
};

describe("MaterialRequestsList", () => {
  beforeEach(() => {
    pushMock.mockReset();
    pushMock.mockImplementation((href: string) => events.push(`open ${href}`));
    uploadToSignedUrlMock.mockReset();
    uploadToSignedUrlMock.mockImplementation(async (path: string) => {
      events.push(`storage ${path}`);
      return { data: { path }, error: null };
    });
    storageFromMock.mockReset();
    storageFromMock.mockReturnValue({ uploadToSignedUrl: uploadToSignedUrlMock });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists each request with who asked, its urgency and how far its validation is (1)", async () => {
    mockApi({
      [`GET ${BASE}`]: list({
        items: [
          summary({ is_urgent: true, needed_on: "2026-11-14", line_count: 8, validated_line_count: 3, file_count: 2 }),
          summary({
            id: "66666666-6666-4666-8666-666666666666",
            requested_on: "2026-11-03",
            technician_id: null,
            technician_name: null,
            line_count: 2,
            validated_line_count: 2,
          }),
        ],
      }),
    });
    render(<MaterialRequestsList projectId={PROJECT_ID} />);

    const rows = within(await screen.findByRole("list", { name: "Demandes de matériel" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("10/11/2026");
    expect(rows[0]).toHaveTextContent("Alpha");
    expect(rows[0]).toHaveTextContent("Urgent");
    expect(rows[0]).toHaveTextContent("Pour le 14/11/2026");
    expect(rows[0]).toHaveTextContent("3 lignes validées sur 8");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", REQUEST_HREF);
    expect(rows[1]).toHaveTextContent("03/11/2026");
    expect(rows[1]).toHaveTextContent("Technicien non renseigné");
    expect(rows[1]).not.toHaveTextContent("Urgent");
    expect(rows[1]).toHaveTextContent("2 lignes validées sur 2");
  });

  it("says where each request stands, and numbers a step only when the list can know it", async () => {
    const stage = (id: string, partial: Record<string, unknown>) =>
      ({ ...summary({ id }), ...partial }) as MaterialRequestSummary;
    mockApi({
      [`GET ${BASE}`]: list({
        items: [
          stage("60000000-0000-4000-8000-000000000001", { line_count: 0, to_order_line_count: 0, has_orders: false }),
          stage("60000000-0000-4000-8000-000000000002", { line_count: 3, validated_line_count: 1, to_order_line_count: 3, has_orders: false }),
          // Past the lines the list does not know whether a line is priced: it names no step the page could contradict.
          stage("60000000-0000-4000-8000-000000000003", { line_count: 3, validated_line_count: 3, to_order_line_count: 3, has_orders: false }),
          stage("60000000-0000-4000-8000-000000000004", { line_count: 3, validated_line_count: 3, to_order_line_count: 2, has_orders: true }),
          stage("60000000-0000-4000-8000-000000000005", { line_count: 3, validated_line_count: 3, to_order_line_count: 0, has_orders: true }),
          // The orders could not be read for this one: nothing is said rather than a guess.
          stage("60000000-0000-4000-8000-000000000006", { line_count: 3, validated_line_count: 3, to_order_line_count: null, has_orders: false }),
        ],
      }),
    });
    render(<MaterialRequestsList projectId={PROJECT_ID} />);

    const rows = within(await screen.findByRole("list", { name: "Demandes de matériel" })).getAllByRole("listitem");
    const stages = ["Lignes à saisir", "Étape 1 · Lignes", "À chiffrer ou à commander", "Bons de commande faits"];
    expect(rows.map((row) => stages.filter((label) => within(row).queryByText(label) !== null))).toEqual([
      ["Lignes à saisir"],
      ["Étape 1 · Lignes"],
      ["À chiffrer ou à commander"],
      ["À chiffrer ou à commander"],
      ["Bons de commande faits"],
      [],
    ]);
  });

  it("gives a way forward when the affaire has no request yet (1)", async () => {
    mockApi({ [`GET ${BASE}`]: list({}) });
    render(<MaterialRequestsList projectId={PROJECT_ID} />);

    expect(await screen.findByRole("heading", { name: "Aucune demande de matériel" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Nouvelle demande" }).length).toBeGreaterThan(0);
  });

  it("creates the request for the chosen technician with the pasted message, then opens it (2)", async () => {
    mockApi({ [`GET ${BASE}`]: list({}), [`POST ${BASE}`]: CREATED });
    const user = userEvent.setup();
    render(<MaterialRequestsList projectId={PROJECT_ID} />);

    await user.click((await screen.findAllByRole("button", { name: "Nouvelle demande" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle demande" });
    expect(within(dialog).getByRole("button", { name: "Créer la demande" })).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Technicien"), "Bravo");
    await user.type(within(dialog).getByLabelText(/Message reçu/), "6 raccords DN 32{Enter}un rouleau de filasse");
    await user.click(within(dialog).getByRole("button", { name: "Créer la demande" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(REQUEST_HREF));
    expect(writes()).toEqual([
      { method: "POST", path: BASE, body: { technician_id: BRAVO, source_text: "6 raccords DN 32\nun rouleau de filasse" } },
    ]);
  });

  it("selects a technician added on the spot and shows a name the server refuses (3)", async () => {
    let attempt = 0;
    mockApi({
      [`GET ${BASE}`]: list({}),
      "POST /api/material-request-technicians": (body) => {
        attempt += 1;
        return attempt === 1
          ? { status: 409, error: { code: "CONFLICT", message: "Un technicien porte déjà ce nom." } }
          : { status: 201, data: { item: technician({ id: "77777777-7777-4777-8777-777777777777", name: (body as { name: string }).name }) } };
      },
      [`POST ${BASE}`]: CREATED,
    });
    const user = userEvent.setup();
    render(<MaterialRequestsList projectId={PROJECT_ID} />);

    await user.click((await screen.findAllByRole("button", { name: "Nouvelle demande" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle demande" });
    await user.click(within(dialog).getByRole("button", { name: "Ajouter un technicien" }));
    await user.type(within(dialog).getByLabelText("Nom du technicien"), "Alpha");
    await user.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Un technicien porte déjà ce nom.");

    await user.clear(within(dialog).getByLabelText("Nom du technicien"));
    await user.type(within(dialog).getByLabelText("Nom du technicien"), "Charlie");
    await user.click(within(dialog).getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(within(dialog).getByLabelText("Technicien")).toHaveDisplayValue("Charlie"));
    expect(writes().map((call) => call.body)).toEqual([{ name: "Alpha" }, { name: "Charlie" }]);
    await user.click(within(dialog).getByRole("button", { name: "Créer la demande" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(REQUEST_HREF));
    expect(writes()[2].body).toEqual({ technician_id: "77777777-7777-4777-8777-777777777777" });
  });

  const FILE_1 = "88888888-8888-4888-8888-888888888888";
  const FILE_2 = "99999999-9999-4999-8999-999999999999";
  const FILES = `${BASE}/${REQUEST_ID}/files`;
  const photos = () => [
    new File(["a"], "photo-essai-1.jpg", { type: "image/jpeg" }),
    new File(["bb"], "photo-essai-2.jpg", { type: "image/jpeg" }),
  ];

  async function createWithPhotos(routes: Record<string, Route>) {
    mockApi({ [`GET ${BASE}`]: list({}), [`POST ${BASE}`]: CREATED, ...routes });
    const user = userEvent.setup();
    render(<MaterialRequestsList projectId={PROJECT_ID} />);
    await user.click((await screen.findAllByRole("button", { name: "Nouvelle demande" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Nouvelle demande" });
    await user.selectOptions(within(dialog).getByLabelText("Technicien"), "Alpha");
    await user.upload(within(dialog).getByLabelText(/Photos de l’original/), photos());
    await user.click(within(dialog).getByRole("button", { name: "Créer la demande" }));
    return dialog;
  }

  it("creates the request, sends its photos to storage, has them checked, and only then opens it (4)", async () => {
    let releaseFirst!: () => void;
    uploadToSignedUrlMock.mockImplementationOnce(
      (path: string) =>
        new Promise((resolve) => {
          events.push(`storage ${path}`);
          releaseFirst = () => resolve({ data: { path }, error: null });
        }),
    );
    const dialog = await createWithPhotos({
      [`POST ${FILES}`]: {
        status: 201,
        data: {
          uploads: [
            { file: { id: FILE_1, file_name: "photo-essai-1.jpg", mime_type: "image/jpeg", byte_size: 1 }, path: "t/d/1.jpg", token: "jeton-1" },
            { file: { id: FILE_2, file_name: "photo-essai-2.jpg", mime_type: "image/jpeg", byte_size: 2 }, path: "t/d/2.jpg", token: "jeton-2" },
          ],
        },
      },
      [`POST ${FILES}/complete`]: { data: { files: [] } },
    });

    expect(await within(dialog).findByText("Envoi de la photo 1 sur 2 : photo-essai-1.jpg…")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Créer la demande" })).toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();
    releaseFirst();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(REQUEST_HREF));
    expect(events).toEqual([
      `POST ${BASE}`,
      `POST ${FILES}`,
      "storage t/d/1.jpg",
      "storage t/d/2.jpg",
      `POST ${FILES}/complete`,
      `open ${REQUEST_HREF}`,
    ]);
    expect(writes()[1].body).toEqual({
      files: [
        { name: "photo-essai-1.jpg", mime_type: "image/jpeg", byte_size: 1 },
        { name: "photo-essai-2.jpg", mime_type: "image/jpeg", byte_size: 2 },
      ],
    });
    expect(storageFromMock).toHaveBeenCalledWith("material-requests");
    expect(uploadToSignedUrlMock.mock.calls.map(([path, token]) => [path, token])).toEqual([
      ["t/d/1.jpg", "jeton-1"],
      ["t/d/2.jpg", "jeton-2"],
    ]);
    expect(writes()[2].body).toEqual({ ids: [FILE_1, FILE_2] });
  });

  it("says the request exists when only its photos were refused, and does not create it twice (4)", async () => {
    const dialog = await createWithPhotos({
      [`POST ${FILES}`]: {
        status: 422,
        error: { code: "UNSUPPORTED_FILE", message: "Format HEIC refusé : envoyez la photo en JPEG." },
      },
    });

    const failure = await within(dialog).findByRole("alert");
    expect(failure).toHaveTextContent("La demande est créée, mais sans ses photos.");
    expect(failure).toHaveTextContent("Format HEIC refusé : envoyez la photo en JPEG.");
    expect(uploadToSignedUrlMock).not.toHaveBeenCalled();
    expect(events).toEqual([`POST ${BASE}`, `POST ${FILES}`]);
    expect(pushMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("link", { name: "Ouvrir la demande" })).toHaveAttribute("href", REQUEST_HREF);
    expect(within(dialog).queryByRole("button", { name: "Créer la demande" })).not.toBeInTheDocument();
  });

  it("opens a blank form again after a request was created without its photos, and creates a distinct one (6)", async () => {
    const SECOND_ID = "44444444-4444-4444-8444-444444444444";
    let created = 0;
    const dialog = await createWithPhotos({
      [`POST ${BASE}`]: () => {
        created += 1;
        return {
          status: 201,
          data: {
            request: summary(created === 1 ? {} : { id: SECOND_ID, technician_id: BRAVO }),
            technician: technician(),
            files: [],
            lines: [],
          },
        };
      },
      [`POST ${FILES}`]: {
        status: 422,
        error: { code: "UNSUPPORTED_FILE", message: "Format HEIC refusé : envoyez la photo en JPEG." },
      },
    });
    await within(dialog).findByText("La demande est créée, mais sans ses photos.");
    const user = userEvent.setup();

    await user.click(within(dialog).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Nouvelle demande" })[0]);

    const reopened = await screen.findByRole("dialog", { name: "Nouvelle demande" });
    expect(within(reopened).queryByText("La demande est créée, mais sans ses photos.")).not.toBeInTheDocument();
    expect(within(reopened).getByLabelText("Technicien")).toHaveValue("");
    expect(within(reopened).getByLabelText(/Message reçu/)).toHaveValue("");
    expect(within(reopened).queryByRole("list", { name: "Photos choisies" })).not.toBeInTheDocument();
    expect(within(reopened).getByRole("button", { name: "Créer la demande" })).toBeDisabled();

    await user.selectOptions(within(reopened).getByLabelText("Technicien"), "Bravo");
    await user.click(within(reopened).getByRole("button", { name: "Créer la demande" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/dashboard/affaires/${PROJECT_ID}/demandes-materiel/${SECOND_ID}`));
    expect(events).toEqual([
      `POST ${BASE}`,
      `POST ${FILES}`,
      `POST ${BASE}`,
      `open /dashboard/affaires/${PROJECT_ID}/demandes-materiel/${SECOND_ID}`,
    ]);
    expect(writes().filter((call) => call.path === BASE).map((call) => call.body)).toEqual([
      { technician_id: ALPHA },
      { technician_id: BRAVO },
    ]);
  });

  it("does not offer « Nouvelle demande » to a reader without write access (5)", async () => {
    mockApi({ [`GET ${BASE}`]: list({ items: [summary()], canWrite: false }) });
    render(<MaterialRequestsList projectId={PROJECT_ID} />);

    await screen.findByRole("list", { name: "Demandes de matériel" });
    expect(screen.queryByRole("button", { name: "Nouvelle demande" })).not.toBeInTheDocument();
  });
});
