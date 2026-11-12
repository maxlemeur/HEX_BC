import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as fileRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/[fileId]/route";
import * as completeRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/complete/route";
import * as filesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/route";
import * as lineRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/route";
import * as reopenRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/reopen/route";
import * as linesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/route";
import * as validateRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/validate/route";
import * as requestRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/route";
import * as requestsRoute from "@/app/api/affaires/[projectId]/material-requests/route";
import { MATERIAL_REQUEST_FILE_MAX_BYTES, MATERIAL_REQUEST_MAX_LINES } from "@/lib/material-requests/contracts";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes, written before the routes (TI-690). Everything is fictional.
 *  1. Rights: a viewer, a director or an engineer who does not own the affaire creates, changes or deletes
 *     a request, a line or an original; a viewer or an engineer who does not own the affaire reads them;
 *     a member of another tenant learns that the affaire exists; a reader is told they may write.
 *  2. Scope: a request, line or original of another affaire is read or changed through this affaire's URL,
 *     or the list of one affaire shows the requests of another.
 *  3. Validation: some lines are validated while another requested line is blocked; the refusal does not
 *     say which line and why; a duplicate elsewhere in the request or an unconfirmed presumed material
 *     is not seen.
 *  4. A validated line is edited (alone or in a selection) and stays validated; or acknowledging a
 *     duplicate, or sending back the same values, returns it to draft.
 *  5. Originals never pass through the application (a request body is capped far below a phone photo):
 *     the server prepares signed uploads and checks afterwards what storage really holds. A HEIC photo is
 *     accepted, or refused with another wording; another type or an oversized file is announced and
 *     accepted; a file that was never sent, has another size or other bytes than announced becomes
 *     visible, or leaves the rest of its batch visible; the upload is signed with anything but the
 *     caller's own client, or allows overwriting; bytes are served with a sniffable or cacheable response;
 *     a storage error or the storage path of a stored original reaches a reader.
 *  6. A request grows past the line cap, or new lines are not appended after the existing ones.
 *  7. The confirmation of a presumed material survives its change, or is given without any material.
 *  8. Deleting a request or an original leaves its bytes in storage.
 *  9. The client sets what only the server decides (status, validation date, tenant).
 * 10. « Ajouter une ligne » (an empty draft) is refused, or a new line takes a position still held after a
 *     deletion, so two lines of a request share one.
 * 12. A validated line stays validated when the presumed material it relied on is changed, cleared or
 *     un-confirmed, or the answer does not say which lines went back to draft; the database refuses a
 *     validation for its material and the caller gets a bare 400 instead of the blocked lines.
 * 13. A line kept as "not a duplicate" is edited into the twin of another and keeps its acknowledgement.
 * 14. What an interrupted upload left behind is never cleaned.
 * 15. Bytes outlive their row or land without one: a prepared photo is cancelled, rejected or discarded
 *     by deleting its row first, so an upload still in flight finishes with nowhere to go; a withdrawn
 *     photo is still listed or served.
 * 16. Two uploads prepared side by side both become visible, past twelve originals; or rows waiting for
 *     their bytes pile up without bound.
 * 17. Completing a batch removes the bytes of photos it has just made visible, because another session
 *     cancelled one of them in the meantime: listed photos whose bytes answer 500.
 * 11. A photo is listed, counted or served before its bytes are stored (found by the end-to-end journey:
 *     the request listed the photo while GET of its bytes answered 500), stays listed after an upload that
 *     failed or was interrupted, or keeps its bytes when its request is deleted; a storage error reaches
 *     the client.
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
const ARCHIVED_PROJECT = "30000000-0000-4000-8000-000000000003";
const VIEWER_PROJECT = "30000000-0000-4000-8000-000000000004";
const FOREIGN_PROJECT = "30000000-0000-4000-8000-000000000009";
const SUPPLIER = "40000000-0000-4000-8000-000000000001";
const INACTIVE_SUPPLIER = "40000000-0000-4000-8000-000000000002";
const FOREIGN_SUPPLIER = "40000000-0000-4000-8000-000000000009";
const TECHNICIAN = "50000000-0000-4000-8000-000000000001";
const FOREIGN_TECHNICIAN = "50000000-0000-4000-8000-000000000009";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const OLDER_REQUEST = "60000000-0000-4000-8000-000000000002";
const OTHER_REQUEST = "60000000-0000-4000-8000-000000000003";
const LINE_READY = "70000000-0000-4000-8000-000000000001";
const LINE_NO_QUANTITY = "70000000-0000-4000-8000-000000000002";
const LINE_VALIDATED = "70000000-0000-4000-8000-000000000003";
const OTHER_LINE = "70000000-0000-4000-8000-000000000009";
const FILE = "80000000-0000-4000-8000-000000000001";
const OTHER_FILE = "80000000-0000-4000-8000-000000000009";
/** An upload that was interrupted: the row exists, perhaps its bytes too, but it was never marked stored. */
const PENDING_FILE = "80000000-0000-4000-8000-000000000002";
const FILE_PATH = `${TENANT}/${PROJECT}/${REQUEST}/${FILE}/demande-chantier.jpg`;
const OTHER_FILE_PATH = `${TENANT}/${OTHER_PROJECT}/${OTHER_REQUEST}/${OTHER_FILE}/autre.jpg`;
const PENDING_FILE_PATH = `${TENANT}/${PROJECT}/${REQUEST}/${PENDING_FILE}/interrompue.jpg`;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48]);
const HEIC = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00]);
const HEIC_MESSAGE =
  "Les photos HEIC ne sont pas encore prises en charge : enregistrez la photo en JPEG, puis déposez-la à nouveau.";

type Role = "admin" | "engineer" | "viewer" | "director";

function project(id: string, owner: string, extra: FakeRow = {}): FakeRow {
  return { id, tenant_id: TENANT, user_id: owner, name: `Affaire ${id.slice(-1)}`, is_archived: false, ...extra };
}

function request(id: string, projectId: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: projectId, technician_id: null, requested_on: "2026-11-10", needed_on: null,
    delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false,
    material_confirmed_at: null, material_confirmed_by: null, presumed_supplier_id: null, supplier_confirmed: false,
    supplier_confirmed_at: null, supplier_confirmed_by: null, source_text: null, note: null, created_by: OWNER,
    created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

function line(id: string, requestId: string, position: number, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: requestId === OTHER_REQUEST ? OTHER_PROJECT : PROJECT, request_id: requestId,
    position, original_text: null, quantity: 10, quantity_doubtful: false, unit: "u", dimension: "DN 20",
    no_dimension: false, product_type: "Coude 45°", material: null, material_precision: null, reference: null,
    supplier_id: null, zone: null, imputation: "project", overhead_category: null, duplicate_acknowledged: false,
    status: "draft", validated_at: null, validated_by: null, created_at: "2026-11-10T09:00:00.000Z",
    updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

function seed(
  actor: string,
  role: Role,
  overrides: {
    tables?: Record<string, FakeRow[]>;
    objects?: Record<string, Uint8Array>;
    failSign?: (path: string) => boolean;
    refuseUpdate?: (table: string, values: FakeRow) => string | false;
    beforeUpdate?: (table: string, values: FakeRow, tables: Record<string, FakeRow[]>) => void;
  } = {},
) {
  const fake = createFakeSupabase({
    userId: actor,
    rpc: { material_request_material_options: ["Cuivre", "Inox 304L"] },
    objects: overrides.objects ?? { [FILE_PATH]: JPEG, [OTHER_FILE_PATH]: JPEG, [PENDING_FILE_PATH]: JPEG },
    failSign: overrides.failSign,
    refuseUpdate: overrides.refuseUpdate,
    beforeUpdate: overrides.beforeUpdate,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      estimate_projects: [
        project(PROJECT, OWNER),
        project(OTHER_PROJECT, ENGINEER),
        project(ARCHIVED_PROJECT, OWNER, { is_archived: true }),
        project(VIEWER_PROJECT, VIEWER),
        project(FOREIGN_PROJECT, OUTSIDER, { tenant_id: OTHER_TENANT }),
      ],
      suppliers: [
        { id: SUPPLIER, tenant_id: TENANT, name: "Négoce fictif", is_active: true },
        { id: INACTIVE_SUPPLIER, tenant_id: TENANT, name: "Ancien négoce", is_active: false },
        { id: FOREIGN_SUPPLIER, tenant_id: OTHER_TENANT, name: "Négoce d'ailleurs", is_active: true },
      ],
      material_request_technicians: [
        { id: TECHNICIAN, tenant_id: TENANT, name: "Technicien Bravo", current_project_id: PROJECT, is_active: true },
        { id: FOREIGN_TECHNICIAN, tenant_id: OTHER_TENANT, name: "Technicien d'ailleurs", current_project_id: null, is_active: true },
      ],
      material_requests: [
        request(REQUEST, PROJECT, { technician_id: TECHNICIAN, presumed_material: "Inox 304L", material_confirmed: true, created_at: "2026-11-11T09:00:00.000Z" }),
        request(OLDER_REQUEST, PROJECT, { created_at: "2026-11-09T09:00:00.000Z" }),
        request(OTHER_REQUEST, OTHER_PROJECT, { created_by: ENGINEER }),
      ],
      material_request_lines: [
        line(LINE_READY, REQUEST, 1),
        line(LINE_NO_QUANTITY, REQUEST, 2, { quantity: null, product_type: "Té égal" }),
        line(LINE_VALIDATED, REQUEST, 3, { quantity: 4, product_type: "Bride", dimension: "DN 50", status: "validated", validated_at: "2026-11-11T10:00:00.000Z", validated_by: OWNER }),
        line(OTHER_LINE, OTHER_REQUEST, 1),
      ],
      material_request_files: [
        { id: FILE, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, storage_path: FILE_PATH, file_name: "demande chantier.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_by: OWNER, created_at: "2026-11-11T09:05:00.000Z", stored_at: "2026-11-11T09:05:02.000Z" },
        { id: PENDING_FILE, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, storage_path: PENDING_FILE_PATH, file_name: "interrompue.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_by: OWNER, created_at: new Date(Date.now() - 60_000).toISOString(), stored_at: null },
        { id: OTHER_FILE, tenant_id: TENANT, project_id: OTHER_PROJECT, request_id: OTHER_REQUEST, storage_path: OTHER_FILE_PATH, file_name: "autre.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_by: ENGINEER, created_at: "2026-11-10T09:05:00.000Z", stored_at: "2026-11-10T09:05:02.000Z" },
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
  const payload = isJson ? ((await response.clone().json()) as { ok: boolean; data?: never; error?: { code: string; message: string; details?: never } }) : null;
  return { status: response.status, data: payload?.data as never, error: payload?.error, response };
}

type Declared = { name: string; mime_type: string; byte_size: number };
type Upload = { file: { id: string; file_name: string; mime_type: string; byte_size: number }; path: string; token: string };

/** What the browser announces before it sends a photo. */
const declared = (name = "demande.jpg", mime_type = "image/jpeg", byte_size = JPEG.byteLength): Declared => ({ name, mime_type, byte_size });

const inProject = { projectId: PROJECT };
const inRequest = { projectId: PROJECT, requestId: REQUEST };

/** Every route that writes, with a body it would accept from someone allowed to. */
const WRITES: Array<[string, () => Promise<{ status: number }>]> = [
  ["create a request", () => call(requestsRoute.POST, "POST", inProject, {})],
  ["change a request", () => call(requestRoute.PATCH, "PATCH", inRequest, { is_urgent: true })],
  ["delete a request", () => call(requestRoute.DELETE, "DELETE", inRequest)],
  ["add lines", () => call(linesRoute.POST, "POST", inRequest, { lines: [{ product_type: "Coude" }] })],
  ["change a selection of lines", () => call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_READY], patch: { zone: "R+3" } })],
  ["change a line", () => call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_READY }, { quantity: 2 })],
  ["delete a line", () => call(lineRoute.DELETE, "DELETE", { ...inRequest, lineId: LINE_READY })],
  ["validate lines", () => call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY] })],
  ["reopen lines", () => call(reopenRoute.POST, "POST", inRequest, { ids: [LINE_VALIDATED] })],
  ["prepare the upload of an original", () => call(filesRoute.POST, "POST", inRequest, { files: [declared()] })],
  ["complete the upload of an original", () => call(completeRoute.POST, "POST", inRequest, { ids: [PENDING_FILE] })],
  ["turn an original", () => call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: FILE }, { rotation: 90 })],
  ["delete an original", () => call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: FILE })],
];

const READS: Array<[string, () => Promise<{ status: number }>]> = [
  ["list the requests", () => call(requestsRoute.GET, "GET", inProject)],
  ["open a request", () => call(requestRoute.GET, "GET", inRequest)],
  ["open an original", () => call(fileRoute.GET, "GET", { ...inRequest, fileId: FILE })],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("material requests of an affaire: rights", () => {
  it.each<[string, string, Role, number, number, boolean | null]>([
    ["an admin who does not own the affaire", ADMIN, "admin", 200, 201, true],
    ["the engineer who owns the affaire", OWNER, "engineer", 200, 201, true],
    ["an engineer who does not own the affaire", ENGINEER, "engineer", 403, 403, null],
    ["a viewer", VIEWER, "viewer", 403, 403, null],
    ["a director", DIRECTOR, "director", 200, 403, false],
    ["a member of another tenant", OUTSIDER, "admin", 404, 404, null],
  ])("%s: list %i, create %i", async (_label, actor, role, listStatus, createStatus, canWrite) => {
    const fake = seed(actor, role);
    const list = await call(requestsRoute.GET, "GET", inProject);
    expect(list.status).toBe(listStatus);
    if (canWrite !== null) expect((list.data as { canWrite: boolean }).canWrite).toBe(canWrite);
    const created = await call(requestsRoute.POST, "POST", inProject, { is_urgent: true });
    expect(created.status).toBe(createStatus);
    expect(fake.writes.filter((write) => write.operation === "insert")).toHaveLength(createStatus === 201 ? 1 : 0);
  });

  it("a viewer who owns the affaire reads its requests and writes nothing", async () => {
    const fake = seed(VIEWER, "viewer");
    const list = await call(requestsRoute.GET, "GET", { projectId: VIEWER_PROJECT });
    expect(list.status).toBe(200);
    expect((list.data as { canWrite: boolean }).canWrite).toBe(false);
    expect((await call(requestsRoute.POST, "POST", { projectId: VIEWER_PROJECT }, {})).status).toBe(403);
    expect(fake.writes).toEqual([]);
  });

  it.each<[string, string, Role]>([
    ["a director", DIRECTOR, "director"],
    ["a viewer", VIEWER, "viewer"],
    ["an engineer who does not own the affaire", ENGINEER, "engineer"],
  ])("%s is refused by every route that writes, and nothing is written or stored", async (_label, actor, role) => {
    const fake = seed(actor, role);
    for (const [name, attempt] of WRITES) {
      expect([name, (await attempt()).status]).toEqual([name, 403]);
    }
    expect(fake.writes).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
  });

  it.each<[string, string, Role, number]>([
    ["a viewer", VIEWER, "viewer", 403],
    ["an engineer who does not own the affaire", ENGINEER, "engineer", 403],
    ["a member of another tenant", OUTSIDER, "admin", 404],
  ])("%s is refused by every route that reads", async (_label, actor, role, status) => {
    const fake = seed(actor, role);
    for (const [name, attempt] of READS) {
      expect([name, (await attempt()).status]).toEqual([name, status]);
    }
    expect(fake.storageCalls).toEqual([]);
  });

  it("a director opens a request and its original, and is told they cannot write", async () => {
    seed(DIRECTOR, "director");
    const detail = await call(requestRoute.GET, "GET", inRequest);
    expect(detail.status).toBe(200);
    expect((detail.data as { canWrite: boolean }).canWrite).toBe(false);
    expect((await call(fileRoute.GET, "GET", { ...inRequest, fileId: FILE })).status).toBe(200);
  });

  it("answers 401 without a session and 404 on an archived affaire", async () => {
    const anonymous = createFakeSupabase({ userId: null, tables: {} });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(anonymous.supabase as never);
    expect((await call(requestsRoute.GET, "GET", inProject)).status).toBe(401);

    seed(OWNER, "engineer");
    expect((await call(requestsRoute.GET, "GET", { projectId: ARCHIVED_PROJECT })).status).toBe(404);
    expect((await call(requestsRoute.POST, "POST", { projectId: ARCHIVED_PROJECT }, {})).status).toBe(404);
  });
});

describe("material requests of an affaire: scope", () => {
  it("does not find a request, line or original of another affaire through this affaire's URL", async () => {
    // The admin may read and write both affaires: only the URL separates them.
    const fake = seed(ADMIN, "admin");
    const foreignRequest = { projectId: PROJECT, requestId: OTHER_REQUEST };
    const attempts: Array<[string, Promise<{ status: number }>]> = [
      ["open", call(requestRoute.GET, "GET", foreignRequest)],
      ["change", call(requestRoute.PATCH, "PATCH", foreignRequest, { is_urgent: true })],
      ["delete", call(requestRoute.DELETE, "DELETE", foreignRequest)],
      ["add lines", call(linesRoute.POST, "POST", foreignRequest, { lines: [{ product_type: "Coude" }] })],
      ["prepare an original", call(filesRoute.POST, "POST", foreignRequest, { files: [declared()] })],
      ["complete a foreign original", call(completeRoute.POST, "POST", inRequest, { ids: [OTHER_FILE] })],
      ["complete an original through a foreign request", call(completeRoute.POST, "POST", foreignRequest, { ids: [FILE] })],
      ["change a foreign line", call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: OTHER_LINE }, { quantity: 2 })],
      ["delete a foreign line", call(lineRoute.DELETE, "DELETE", { ...inRequest, lineId: OTHER_LINE })],
      ["change a selection holding a foreign line", call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_READY, OTHER_LINE], patch: { zone: "R+3" } })],
      ["validate a selection holding a foreign line", call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY, OTHER_LINE] })],
      ["reopen a foreign line", call(reopenRoute.POST, "POST", inRequest, { ids: [OTHER_LINE] })],
      ["open a foreign original", call(fileRoute.GET, "GET", { ...inRequest, fileId: OTHER_FILE })],
      ["turn a foreign original", call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: OTHER_FILE }, { rotation: 90 })],
      ["delete a foreign original", call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: OTHER_FILE })],
    ];
    const before = structuredClone(fake.tables);
    for (const [name, attempt] of attempts) {
      expect([name, (await attempt).status]).toEqual([name, 404]);
    }
    // A statement may have been sent, filtered on this affaire: it reached no row.
    expect(fake.writes.flatMap((write) => write.ids)).toEqual([]);
    expect(fake.tables).toEqual(before);
    expect(fake.storageCalls).toEqual([]);
  });

  it("lists the requests of this affaire only, most recent first, with their counts and the tenant's technicians", async () => {
    seed(OWNER, "engineer");
    const { data } = await call(requestsRoute.GET, "GET", inProject);
    const list = data as { items: FakeRow[]; technicians: FakeRow[]; canWrite: boolean };
    expect(list.items.map((item) => item.id)).toEqual([REQUEST, OLDER_REQUEST]);
    expect(list.items[0]).toMatchObject({
      project_id: PROJECT, technician_name: "Technicien Bravo", line_count: 3, validated_line_count: 1, file_count: 1,
      presumed_material: "Inox 304L", material_confirmed: true, supplier_confirmed: false,
    });
    expect(list.items[1]).toMatchObject({ technician_name: null, line_count: 0, validated_line_count: 0, file_count: 0 });
    expect(list.items[0]).not.toHaveProperty("tenant_id");
    expect(list.technicians).toEqual([{ id: TECHNICIAN, name: "Technicien Bravo", current_project_id: PROJECT, is_active: true }]);
    expect(list.canWrite).toBe(true);
  });

  it("opens a request with its technician, originals, lines in order and the tenant's own options", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(requestRoute.GET, "GET", inRequest);
    const detail = data as {
      request: FakeRow; technician: FakeRow; files: FakeRow[]; lines: FakeRow[]; canWrite: boolean;
      materialOptions: string[]; supplierOptions: FakeRow[];
    };
    expect(status).toBe(200);
    expect(detail.request).toMatchObject({ id: REQUEST, project_id: PROJECT, material_confirmed: true });
    expect(detail.technician).toEqual({ id: TECHNICIAN, name: "Technicien Bravo", current_project_id: PROJECT, is_active: true });
    expect(detail.files).toEqual([
      { id: FILE, request_id: REQUEST, file_name: "demande chantier.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_at: "2026-11-11T09:05:00.000Z" },
    ]);
    expect(detail.lines.map((entry) => [entry.id, entry.position, entry.status])).toEqual([
      [LINE_READY, 1, "draft"], [LINE_NO_QUANTITY, 2, "draft"], [LINE_VALIDATED, 3, "validated"],
    ]);
    expect(detail.lines[2]).not.toHaveProperty("validated_by");
    expect(detail.lines[2]).not.toHaveProperty("tenant_id");
    expect(detail.materialOptions).toEqual(["Cuivre", "Inox 304L"]);
    expect(detail.supplierOptions).toEqual([{ id: SUPPLIER, name: "Négoce fictif" }]);
    expect(detail.canWrite).toBe(true);
    expect(fake.rpcCalls).toEqual(["material_request_material_options"]);
  });
});

describe("material requests of an affaire: the request", () => {
  it("records a request in the name of the caller and answers with its detail", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(requestsRoute.POST, "POST", inProject, {
      technician_id: TECHNICIAN, needed_on: "2026-11-20", delivery_place: "site", is_urgent: true,
      presumed_material: "  Inox 304L  ", source_text: "60 robinet 20/27\nté 32 90° - 25 pièces",
    });
    const detail = data as { request: FakeRow; technician: FakeRow; files: unknown[]; lines: unknown[] };
    expect(status).toBe(201);
    expect(detail.request).toMatchObject({
      project_id: PROJECT, technician_id: TECHNICIAN, needed_on: "2026-11-20", delivery_place: "site", is_urgent: true,
      presumed_material: "Inox 304L", material_confirmed: false, source_text: "60 robinet 20/27\nté 32 90° - 25 pièces",
    });
    expect(detail.technician).toMatchObject({ id: TECHNICIAN, name: "Technicien Bravo" });
    expect(detail.files).toEqual([]);
    expect(detail.lines).toEqual([]);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ table: "material_requests", operation: "insert" });
    expect(fake.writes[0].values).toMatchObject({ project_id: PROJECT, created_by: OWNER });
    expect(fake.writes[0].values).not.toHaveProperty("tenant_id");
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["a technician of another tenant", { technician_id: FOREIGN_TECHNICIAN }, "Technicien introuvable."],
    ["a supplier of another tenant", { presumed_supplier_id: FOREIGN_SUPPLIER }, "Fournisseur introuvable."],
    ["a confirmation without a presumed material", { material_confirmed: true }, "Aucune matière présumée à confirmer."],
    ["a confirmation without a presumed supplier", { supplier_confirmed: true }, "Aucun fournisseur présumé à confirmer."],
  ])("refuses %s, on creation and on change, and writes nothing", async (_label, body, message) => {
    const fake = seed(OWNER, "engineer");
    const created = await call(requestsRoute.POST, "POST", inProject, body);
    const changed = await call(requestRoute.PATCH, "PATCH", { projectId: PROJECT, requestId: OLDER_REQUEST }, body);
    expect([created.status, created.error?.message]).toEqual([400, message]);
    expect([changed.status, changed.error?.message]).toEqual([400, message]);
    expect(fake.writes).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a tenant", { tenant_id: OTHER_TENANT }],
    ["another affaire", { project_id: OTHER_PROJECT }],
    ["a confirmation date", { material_confirmed_at: "2020-01-01T00:00:00.000Z" }],
    ["nothing at all", {}],
  ])("refuses a change that carries %s", async (_label, body) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(requestRoute.PATCH, "PATCH", inRequest, body);
    expect([status, error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(fake.writes).toEqual([]);
  });

  it("refuses a body that is not JSON, an identifier that is not one, and an oversized body", async () => {
    const fake = seed(OWNER, "engineer");
    const send = (body: string, headers: Record<string, string> = {}) =>
      requestRoute.PATCH(new Request("http://localhost/api/test", { method: "PATCH", body, headers }), { params: Promise.resolve(inRequest) });
    expect((await send("{not json")).status).toBe(400);
    expect((await send(JSON.stringify({ note: "x".repeat(1024 * 1024) }))).status).toBe(413);
    expect((await call(requestRoute.GET, "GET", { projectId: PROJECT, requestId: "42" })).status).toBe(400);
    expect(fake.writes).toEqual([]);
  });

  it("withdraws the confirmation when the presumed material changes or is cleared", async () => {
    const fake = seed(OWNER, "engineer");
    const changed = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_material: "Acier galvanisé" });
    expect((changed.data as { request: FakeRow }).request).toMatchObject({ presumed_material: "Acier galvanisé", material_confirmed: false });
    expect(fake.writes[0].values).toEqual({ presumed_material: "Acier galvanisé", material_confirmed: false });

    await call(requestRoute.PATCH, "PATCH", inRequest, { material_confirmed: true });
    const cleared = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_material: "   " });
    expect((cleared.data as { request: FakeRow }).request).toMatchObject({ presumed_material: null, material_confirmed: false });
  });

  it("applies the same rule to the presumed supplier", async () => {
    const fake = seed(OWNER, "engineer");
    const named = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_supplier_id: SUPPLIER, supplier_confirmed: false });
    expect((named.data as { request: FakeRow }).request).toMatchObject({ presumed_supplier_id: SUPPLIER, supplier_confirmed: false });
    const confirmed = await call(requestRoute.PATCH, "PATCH", inRequest, { supplier_confirmed: true });
    expect((confirmed.data as { request: FakeRow }).request).toMatchObject({ presumed_supplier_id: SUPPLIER, supplier_confirmed: true });
    const changed = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_supplier_id: INACTIVE_SUPPLIER });
    expect((changed.data as { request: FakeRow }).request).toMatchObject({ presumed_supplier_id: INACTIVE_SUPPLIER, supplier_confirmed: false });
    const cleared = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_supplier_id: null });
    expect((cleared.data as { request: FakeRow }).request).toMatchObject({ presumed_supplier_id: null, supplier_confirmed: false });
    expect(fake.writes.map((write) => write.values)).toEqual([
      { presumed_supplier_id: SUPPLIER, supplier_confirmed: false },
      { supplier_confirmed: true },
      { presumed_supplier_id: INACTIVE_SUPPLIER, supplier_confirmed: false },
      { presumed_supplier_id: null, supplier_confirmed: false },
    ]);
  });

  it("withdraws a confirmation the screen withdraws itself, with or without a new material", async () => {
    seed(OWNER, "engineer");
    const withMaterial = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_material: "PVC pression", material_confirmed: false });
    expect((withMaterial.data as { request: FakeRow }).request).toMatchObject({ presumed_material: "PVC pression", material_confirmed: false });
    await call(requestRoute.PATCH, "PATCH", inRequest, { material_confirmed: true });
    const alone = await call(requestRoute.PATCH, "PATCH", inRequest, { material_confirmed: false });
    expect((alone.data as { request: FakeRow }).request).toMatchObject({ presumed_material: "PVC pression", material_confirmed: false });
  });

  it("keeps the confirmation when the same material is sent again, and changes nothing else", async () => {
    seed(OWNER, "engineer");
    const { data } = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_material: "Inox 304L", note: "Livrer avant 8 h" });
    expect((data as { request: FakeRow }).request).toMatchObject({ material_confirmed: true, note: "Livrer avant 8 h" });
  });

  it("confirms a material given in the same request only after it is recorded", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(requestRoute.PATCH, "PATCH", inRequest, { presumed_material: "Cuivre", material_confirmed: true });
    expect(status).toBe(200);
    expect((data as { request: FakeRow }).request).toMatchObject({ presumed_material: "Cuivre", material_confirmed: true });
    expect(fake.writes.map((write) => write.values)).toEqual([
      { presumed_material: "Cuivre", material_confirmed: false },
      { material_confirmed: true },
    ]);
  });

  it("deletes a request with the bytes of its originals", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(requestRoute.DELETE, "DELETE", inRequest);
    expect([status, data]).toEqual([200, { deleted: true }]);
    // Every row of the request, stored or not: an interrupted upload may have left bytes too.
    expect(fake.storageCalls).toEqual([{ operation: "remove", bucket: "material-requests", paths: [FILE_PATH, PENDING_FILE_PATH] }]);
    expect([...fake.objects.keys()]).toEqual([OTHER_FILE_PATH]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([OTHER_FILE]);
    expect(fake.tables.material_requests.map((row) => row.id)).toEqual([OLDER_REQUEST, OTHER_REQUEST]);
    expect(fake.tables.material_request_lines.map((row) => row.id)).toEqual([OTHER_LINE]);
    expect(fake.objects.has(OTHER_FILE_PATH)).toBe(true);
  });
});

describe("material requests of an affaire: lines", () => {
  it("appends new lines after the existing ones, as drafts, in the order given", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(linesRoute.POST, "POST", inRequest, {
      lines: [
        { original_text: "60 robinet d'arrêt m/f chromé 20/27", quantity: 60, unit: "u", dimension: "20/27", product_type: "robinet d'arrêt m/f chromé" },
        { original_text: "Toute la visserie en laiton" },
      ],
    });
    const created = (data as { lines: FakeRow[] }).lines;
    expect(status).toBe(201);
    expect(created.map((entry) => [entry.position, entry.status, entry.original_text])).toEqual([
      [4, "draft", "60 robinet d'arrêt m/f chromé 20/27"], [5, "draft", "Toute la visserie en laiton"],
    ]);
    expect(created[0]).toMatchObject({ request_id: REQUEST, quantity: 60, unit: "u", dimension: "20/27", validated_at: null });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].values).toEqual([
      expect.objectContaining({ request_id: REQUEST, position: 4 }), expect.objectContaining({ request_id: REQUEST, position: 5 }),
    ]);
  });

  it("adds one empty draft line, after the highest position still held once a line was deleted", async () => {
    const fake = seed(OWNER, "engineer");
    await call(lineRoute.DELETE, "DELETE", { ...inRequest, lineId: LINE_NO_QUANTITY });
    const { status, data } = await call(linesRoute.POST, "POST", inRequest, { lines: [{}] });
    expect(status).toBe(201);
    expect((data as { lines: FakeRow[] }).lines).toEqual([
      expect.objectContaining({ request_id: REQUEST, position: 4, status: "draft", quantity: null, product_type: null, original_text: null }),
    ]);
    const positions = fake.tables.material_request_lines.filter((row) => row.request_id === REQUEST).map((row) => row.position);
    expect(positions).toEqual([1, 3, 4]);
  });

  it(`keeps a request within ${MATERIAL_REQUEST_MAX_LINES} lines`, async () => {
    const fake = seed(OWNER, "engineer");
    const drafts = (count: number) => Array.from({ length: count }, (_, index) => ({ product_type: `Article ${index + 1}` }));
    const tooMany = await call(linesRoute.POST, "POST", inRequest, { lines: drafts(MATERIAL_REQUEST_MAX_LINES - 2) });
    expect([tooMany.status, tooMany.error?.code]).toEqual([422, "MATERIAL_REQUEST_LINE_LIMIT"]);
    expect(fake.writes).toEqual([]);
    const fits = await call(linesRoute.POST, "POST", inRequest, { lines: drafts(MATERIAL_REQUEST_MAX_LINES - 3) });
    expect(fits.status).toBe(201);
    expect(fake.tables.material_request_lines.filter((row) => row.request_id === REQUEST)).toHaveLength(MATERIAL_REQUEST_MAX_LINES);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a status", { status: "validated" }],
    ["a validation date", { validated_at: "2020-01-01T00:00:00.000Z" }],
    ["a position", { position: 1 }],
    ["a quantity of zero", { quantity: 0 }],
    ["nothing at all", {}],
  ])("refuses a line change that carries %s", async (_label, body) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_READY }, body);
    expect([status, error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(fake.writes).toEqual([]);
  });

  it("returns a validated line to draft when what it says changes", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_VALIDATED }, { quantity: 6 });
    expect(status).toBe(200);
    expect((data as { line: FakeRow }).line).toMatchObject({ id: LINE_VALIDATED, quantity: 6, status: "draft", validated_at: null });
    expect(fake.writes.map((write) => write.values)).toEqual([{ quantity: 6, status: "draft" }]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["acknowledging a duplicate", { duplicate_acknowledged: true }],
    ["sending back the values it already has", { quantity: 4, unit: "u", product_type: "Bride", dimension: "DN 50", material: null }],
  ])("keeps a validated line validated when %s", async (_label, body) => {
    seed(OWNER, "engineer");
    const { data } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_VALIDATED }, body);
    expect((data as { line: FakeRow }).line).toMatchObject({ id: LINE_VALIDATED, status: "validated", validated_at: "2026-11-11T10:00:00.000Z" });
  });

  it("applies a change to a selection and returns its validated lines to draft", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(linesRoute.PATCH, "PATCH", inRequest, {
      ids: [LINE_VALIDATED, LINE_READY], patch: { zone: "R+3", supplier_id: SUPPLIER },
    });
    expect(status).toBe(200);
    expect((data as { lines: FakeRow[] }).lines.map((entry) => [entry.id, entry.zone, entry.supplier_id, entry.status])).toEqual([
      [LINE_READY, "R+3", SUPPLIER, "draft"], [LINE_VALIDATED, "R+3", SUPPLIER, "draft"],
    ]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_NO_QUANTITY)).toMatchObject({ zone: null });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_VALIDATED)).toMatchObject({ validated_at: null });
  });

  it("keeps a validated line of a selection validated when the change tells it nothing new", async () => {
    seed(OWNER, "engineer");
    const { data } = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_VALIDATED, LINE_READY], patch: { unit: "u" } });
    expect((data as { lines: FakeRow[] }).lines.map((entry) => [entry.id, entry.status])).toEqual([
      [LINE_READY, "draft"], [LINE_VALIDATED, "validated"],
    ]);
  });

  it("refuses a supplier of another tenant on a line, alone or in a selection", async () => {
    const fake = seed(OWNER, "engineer");
    const single = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_READY }, { supplier_id: FOREIGN_SUPPLIER });
    const bulk = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_READY], patch: { supplier_id: FOREIGN_SUPPLIER } });
    const added = await call(linesRoute.POST, "POST", inRequest, { lines: [{ supplier_id: FOREIGN_SUPPLIER }] });
    expect([single.status, bulk.status, added.status]).toEqual([400, 400, 400]);
    expect(single.error?.message).toBe("Fournisseur introuvable.");
    expect(fake.writes).toEqual([]);
  });

  it("validates the requested lines when none is held back", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY, LINE_VALIDATED] });
    expect(status).toBe(200);
    expect((data as { lines: FakeRow[] }).lines.map((entry) => [entry.id, entry.status])).toEqual([
      [LINE_READY, "validated"], [LINE_VALIDATED, "validated"],
    ]);
    expect((data as { lines: FakeRow[] }).lines[0].validated_at).toEqual(expect.any(String));
    // The line that was already validated keeps its own date: it is not written again.
    expect(fake.writes).toEqual([{ table: "material_request_lines", operation: "update", values: { status: "validated" }, ids: [LINE_READY] }]);
  });

  it("validates nothing when one requested line is held back, and says which and why", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY, LINE_NO_QUANTITY] });
    expect(status).toBe(422);
    expect(error?.code).toBe("MATERIAL_REQUEST_LINES_BLOCKED");
    expect(error?.message).toBe("Aucune ligne n’a été validée : 1 ligne a encore une alerte bloquante.");
    expect(error?.details).toEqual({ blocked: [{ id: LINE_NO_QUANTITY, codes: ["quantity_missing"] }] });
    expect(fake.writes).toEqual([]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_READY)).toMatchObject({ status: "draft" });
  });

  it("holds back a line written twice in the request, even when its twin is not in the selection", async () => {
    const twin = "70000000-0000-4000-8000-000000000004";
    const fake = seed(OWNER, "engineer", {
      tables: {
        material_request_lines: [line(LINE_READY, REQUEST, 1), line(twin, REQUEST, 2, { dimension: "dn20", product_type: "coude 45°" })],
      },
    });
    const refused = await call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY] });
    expect(refused.error?.details).toEqual({ blocked: [{ id: LINE_READY, codes: ["possible_duplicate"] }] });
    expect(fake.writes).toEqual([]);

    await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_READY }, { duplicate_acknowledged: true });
    expect((await call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY] })).status).toBe(200);
  });

  it("holds back every line that relies on a presumed material nobody confirmed", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: { material_requests: [request(REQUEST, PROJECT, { presumed_material: "Inox 304L", material_confirmed: false })] },
    });
    const { status, error } = await call(validateRoute.POST, "POST", inRequest, { ids: [LINE_READY, LINE_VALIDATED] });
    expect(status).toBe(422);
    expect(error?.message).toBe("Aucune ligne n’a été validée : 2 lignes ont encore une alerte bloquante.");
    expect(error?.details).toEqual({
      blocked: [{ id: LINE_READY, codes: ["material_unconfirmed"] }, { id: LINE_VALIDATED, codes: ["material_unconfirmed"] }],
    });
    expect(fake.writes).toEqual([]);
  });

  it("reopens validated lines and deletes a line", async () => {
    const fake = seed(OWNER, "engineer");
    const reopened = await call(reopenRoute.POST, "POST", inRequest, { ids: [LINE_VALIDATED] });
    expect((reopened.data as { lines: FakeRow[] }).lines).toEqual([
      expect.objectContaining({ id: LINE_VALIDATED, status: "draft", validated_at: null }),
    ]);
    const removed = await call(lineRoute.DELETE, "DELETE", { ...inRequest, lineId: LINE_NO_QUANTITY });
    expect([removed.status, removed.data]).toEqual([200, { deleted: true }]);
    expect(fake.tables.material_request_lines.map((row) => row.id)).toEqual([LINE_READY, LINE_VALIDATED, OTHER_LINE]);
  });
});

describe("material requests of an affaire: the material a line is validated in", () => {
  const OWN_MATERIAL = "70000000-0000-4000-8000-000000000005";
  const OVERHEAD = "70000000-0000-4000-8000-000000000006";
  const validated = { status: "validated", validated_at: "2026-11-11T10:00:00.000Z", validated_by: OWNER };
  const lines = [
    line(LINE_READY, REQUEST, 1),
    line(LINE_VALIDATED, REQUEST, 3, { quantity: 4, product_type: "Bride", dimension: "DN 50", ...validated }),
    line(OWN_MATERIAL, REQUEST, 4, { product_type: "Manchon", material: "Laiton", ...validated }),
    line(OVERHEAD, REQUEST, 5, { product_type: "Gants", imputation: "overhead", no_dimension: true, dimension: null, ...validated }),
  ];

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ["changed", { presumed_material: "Cuivre" }, { presumed_material: "Cuivre", material_confirmed: false }],
    ["cleared", { presumed_material: null }, { presumed_material: null, material_confirmed: false }],
    ["un-confirmed", { material_confirmed: false }, { presumed_material: "Inox 304L", material_confirmed: false }],
    ["replaced and confirmed at once", { presumed_material: "Cuivre", material_confirmed: true }, { presumed_material: "Cuivre", material_confirmed: true }],
  ])("returns to draft the validated lines that relied on a presumed material once it is %s, and names them", async (_label, body, expected) => {
    const fake = seed(OWNER, "engineer", { tables: { material_request_lines: lines } });
    const { status, data } = await call(requestRoute.PATCH, "PATCH", inRequest, body);
    expect(status).toBe(200);
    expect(data).toEqual({ request: expect.objectContaining({ id: REQUEST, ...expected }), reopened_line_ids: [LINE_VALIDATED] });
    expect(fake.tables.material_request_lines.map((row) => [row.id, row.status, row.validated_at === null])).toEqual([
      [LINE_READY, "draft", true], [LINE_VALIDATED, "draft", true], [OWN_MATERIAL, "validated", false], [OVERHEAD, "validated", false],
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a note", { note: "Livrer au portail" }],
    ["the same material again", { presumed_material: "Inox 304L" }],
    ["a presumed supplier", { presumed_supplier_id: SUPPLIER }],
    ["its confirmation, already given", { material_confirmed: true }],
  ])("reopens no line when the change is %s", async (_label, body) => {
    const fake = seed(OWNER, "engineer", { tables: { material_request_lines: lines } });
    const { data } = await call(requestRoute.PATCH, "PATCH", inRequest, body);
    expect((data as { reopened_line_ids: string[] }).reopened_line_ids).toEqual([]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_VALIDATED)).toMatchObject({ status: "validated" });
  });

  it.each<[string, string]>([
    ["MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED", "material_unconfirmed"],
    ["MATERIAL_REQUEST_LINE_MATERIAL_MISSING", "material_missing"],
  ])("answers with the blocked lines when the database itself refuses a validation (%s)", async (raised, code) => {
    // The request changed between the alerts read and the write: the database has the last word.
    const fake = seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_READY, REQUEST, 1), line(OWN_MATERIAL, REQUEST, 2, { product_type: "Manchon", material: "Laiton" })] },
      refuseUpdate: (table, values) => (table === "material_request_lines" && values.status === "validated" ? raised : false),
    });
    const { status, error } = await call(validateRoute.POST, "POST", inRequest, { ids: [OWN_MATERIAL, LINE_READY] });
    expect([status, error?.code]).toEqual([422, "MATERIAL_REQUEST_LINES_BLOCKED"]);
    expect(error?.message).toBe("Aucune ligne n’a été validée : 1 ligne a encore une alerte bloquante.");
    expect(error?.details).toEqual({ blocked: [{ id: LINE_READY, codes: [code] }] });
    expect(fake.tables.material_request_lines.map((row) => row.status)).toEqual(["draft", "draft"]);
  });
});

describe("material requests of an affaire: a duplicate that was kept", () => {
  const kept = (extra: FakeRow = {}) => ({
    tables: { material_request_lines: [line(LINE_READY, REQUEST, 1, { duplicate_acknowledged: true, zone: "R+1", ...extra }), line(LINE_NO_QUANTITY, REQUEST, 2)] },
  });

  it.each<[string, Record<string, unknown>]>([
    ["type", { product_type: "Coude 90°" }],
    ["dimension", { dimension: "DN 25" }],
    ["material", { material: "Cuivre" }],
    ["zone", { zone: "R+2" }],
    ["imputation", { imputation: "overhead" }],
  ])("asks again once its %s changes", async (_label, body) => {
    const fake = seed(OWNER, "engineer", kept());
    const { data } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_READY }, body);
    expect((data as { line: FakeRow }).line).toMatchObject({ ...body, duplicate_acknowledged: false });
    expect(fake.writes.map((write) => write.values)).toEqual([{ ...body, duplicate_acknowledged: false }]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["its quantity changes", { quantity: 3 }],
    ["the same zone is sent again", { zone: "R+1" }],
    ["the same update keeps it", { zone: "R+2", duplicate_acknowledged: true }],
  ])("stays kept when %s", async (_label, body) => {
    seed(OWNER, "engineer", kept());
    const { data } = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_READY }, body);
    expect((data as { line: FakeRow }).line).toMatchObject({ duplicate_acknowledged: true });
  });

  it("asks again for the lines of a selection that change, validated or not, and for those only", async () => {
    const validated = { status: "validated", validated_at: "2026-11-11T10:00:00.000Z", validated_by: OWNER };
    const fake = seed(OWNER, "engineer", {
      tables: {
        material_request_lines: [
          line(LINE_READY, REQUEST, 1, { duplicate_acknowledged: true }),
          line(LINE_NO_QUANTITY, REQUEST, 2, { duplicate_acknowledged: true, zone: "R+3" }),
          line(LINE_VALIDATED, REQUEST, 3, { duplicate_acknowledged: true, ...validated }),
        ],
      },
    });
    const { data } = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_READY, LINE_NO_QUANTITY, LINE_VALIDATED], patch: { zone: "R+3" } });
    expect((data as { lines: FakeRow[] }).lines.map((entry) => [entry.id, entry.zone, entry.duplicate_acknowledged, entry.status])).toEqual([
      [LINE_READY, "R+3", false, "draft"], [LINE_NO_QUANTITY, "R+3", true, "draft"], [LINE_VALIDATED, "R+3", false, "draft"],
    ]);
    expect(fake.writes.flatMap((write) => write.ids).sort()).toEqual([LINE_READY, LINE_VALIDATED].sort());
  });
});

describe("material requests of an affaire: originals", () => {
  const prepare = (files: Declared[], params = inRequest) => call(filesRoute.POST, "POST", params, { files });
  const complete = (ids: string[]) => call(completeRoute.POST, "POST", inRequest, { ids });
  const uploadsOf = (data: unknown) => (data as { uploads: Upload[] }).uploads;
  const listed = async () => ((await call(requestRoute.GET, "GET", inRequest)).data as { files: FakeRow[] }).files.map((entry) => entry.id);

  it("prepares one signed upload per photo, with the caller's client, under the path of a row nobody sees yet", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await prepare([
      declared("Demande du 12 novembre (1).JPG"), declared("capture écran.png", "image/png", PNG.byteLength), declared("sans-type.webp", "", 4096),
    ]);
    const uploads = uploadsOf(data);
    expect(status).toBe(201);
    expect(uploads.map((upload) => upload.file)).toEqual([
      { id: expect.any(String), file_name: "Demande du 12 novembre (1).JPG", mime_type: "image/jpeg", byte_size: JPEG.byteLength },
      { id: expect.any(String), file_name: "capture écran.png", mime_type: "image/png", byte_size: PNG.byteLength },
      { id: expect.any(String), file_name: "sans-type.webp", mime_type: "image/webp", byte_size: 4096 },
    ]);
    expect(uploads.map((upload) => upload.path)).toEqual([
      `${TENANT}/${PROJECT}/${REQUEST}/${uploads[0].file.id}/Demande-du-12-novembre-1-.JPG`,
      `${TENANT}/${PROJECT}/${REQUEST}/${uploads[1].file.id}/capture-cran.png`,
      `${TENANT}/${PROJECT}/${REQUEST}/${uploads[2].file.id}/sans-type.webp`,
    ]);
    expect(uploads.every((upload) => typeof upload.token === "string" && upload.token.length > 0)).toBe(true);
    // Never an upsert: a stored original is not replaced.
    expect(fake.storageCalls).toEqual(uploads.map((upload) => ({ operation: "sign", bucket: "material-requests", path: upload.path, upsert: false })));
    // The row first: storage signs an upload only beside the row that names its path.
    expect(fake.events).toEqual(["insert material_request_files", "sign", "insert material_request_files", "sign", "insert material_request_files", "sign"]);
    expect(fake.writes.map((write) => write.values)).toEqual(uploads.map((upload) =>
      expect.objectContaining({ id: upload.file.id, request_id: REQUEST, storage_path: upload.path, created_by: OWNER })));
    expect(fake.tables.material_request_files.filter((row) => row.stored_at === null).map((row) => row.id))
      .toEqual([PENDING_FILE, ...uploads.map((upload) => upload.file.id)]);
    expect(await listed()).toEqual([FILE]);
  });

  it.each<[string, Declared]>([
    ["named .heic", declared("IMG_0042.HEIC", "image/heic")],
    ["named .heif without a type", declared("IMG_0042.heif", "")],
    ["declared image/heic under a .jpg name", declared("IMG_0042.jpg", "image/heic")],
    ["declared image/heif-sequence", declared("IMG_0042.jpeg", "image/heif-sequence")],
  ])("refuses a HEIC photo %s with the agreed wording, and prepares nothing of the batch", async (_label, heic) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await prepare([declared(), heic]);
    expect([status, error?.message]).toEqual([422, HEIC_MESSAGE]);
    expect(fake.writes).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
  });

  it.each<[string, Declared, number]>([
    ["a PDF", declared("bon.pdf", "application/pdf"), 400],
    ["a GIF", declared("anim.gif", "image/gif"), 400],
    ["a photo without extension", declared("photo", "image/jpeg"), 400],
    ["a PNG declared as JPEG", declared("capture.png", "image/jpeg"), 400],
    ["a JPEG declared as a PDF", declared("photo.jpg", "application/pdf"), 400],
    ["a photo above 20 MiB", declared("grande.jpg", "image/jpeg", MATERIAL_REQUEST_FILE_MAX_BYTES + 1), 413],
  ])("refuses to prepare %s, naming the file, and prepares nothing of the batch", async (_label, file, expected) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await prepare([declared(), file]);
    expect(status).toBe(expected);
    expect(error?.message).toContain(file.name);
    expect(fake.writes).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["no photo", { files: [] }],
    ["thirteen photos", { files: Array.from({ length: 13 }, (_, index) => declared(`photo-${index}.jpg`)) }],
    ["an empty photo", { files: [declared("vide.jpg", "image/jpeg", 0)] }],
    ["a size that is not a whole number", { files: [declared("photo.jpg", "image/jpeg", 10.5)] }],
    ["a name of 256 characters", { files: [declared(`${"a".repeat(252)}.jpg`)] }],
    ["a path chosen by the client", { files: [{ ...declared(), path: "ailleurs/photo.jpg" }] }],
  ])("refuses a preparation that carries %s", async (_label, body) => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await call(filesRoute.POST, "POST", inRequest, body);
    expect([status, error?.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(fake.writes).toEqual([]);
  });

  it("keeps twelve originals per request, counting those whose bytes are stored and no other", async () => {
    const fake = seed(OWNER, "engineer");
    const twelve = Array.from({ length: 12 }, (_, index) => declared(`photo-${index}.jpg`));
    // One original is stored: twelve more would make thirteen. The interrupted one does not count.
    const full = await prepare(twelve);
    expect([full.status, full.error?.code]).toEqual([422, "MATERIAL_REQUEST_FILE_LIMIT"]);
    expect(fake.writes).toEqual([]);
    expect((await prepare(twelve.slice(0, 11))).status).toBe(201);
  });

  it("prepares nothing of a batch when storage refuses to sign one upload, and does not say why", async () => {
    const fake = seed(OWNER, "engineer", { failSign: (path) => path.endsWith("/seconde.jpg") });
    const { status, error } = await prepare([declared("premiere.jpg"), declared("seconde.jpg")]);
    expect([status, error]).toEqual([500, { code: "INTERNAL_ERROR", message: "Impossible de préparer l’envoi des photos. Réessayez." }]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, PENDING_FILE, OTHER_FILE]);
  });

  it("takes back what an interrupted upload left hours ago when the next one is prepared, and nothing recent", async () => {
    const stalePath = `${TENANT}/${PROJECT}/${REQUEST}/80000000-0000-4000-8000-000000000003/ancienne.jpg`;
    const fake = seed(OWNER, "engineer", { objects: { [FILE_PATH]: JPEG, [PENDING_FILE_PATH]: JPEG, [stalePath]: JPEG } });
    fake.tables.material_request_files.push({
      id: "80000000-0000-4000-8000-000000000003", tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, storage_path: stalePath,
      file_name: "ancienne.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_by: OWNER,
      created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), stored_at: null,
    });
    const { status, data } = await prepare([declared()]);
    expect(status).toBe(201);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, PENDING_FILE, OTHER_FILE, uploadsOf(data)[0].file.id]);
    expect([...fake.objects.keys()]).toEqual([FILE_PATH, PENDING_FILE_PATH]);
  });

  it("makes a batch visible in one statement, once storage holds what was announced for every photo", async () => {
    const fake = seed(OWNER, "engineer");
    const uploads = uploadsOf((await prepare([declared("une.jpg"), declared("deux.png", "image/png", PNG.byteLength)])).data);
    // What the browser does with uploadToSignedUrl(path, token, file).
    fake.objects.set(uploads[0].path, JPEG);
    fake.objects.set(uploads[1].path, PNG);
    fake.events.length = 0;
    fake.writes.length = 0;

    const ids = uploads.map((upload) => upload.file.id);
    const { status, data } = await complete([ids[1], ids[0]]);
    expect(status).toBe(200);
    expect((data as { files: FakeRow[] }).files).toEqual([
      { id: ids[1], request_id: REQUEST, file_name: "deux.png", mime_type: "image/png", byte_size: PNG.byteLength, rotation: 0, created_at: expect.any(String) },
      { id: ids[0], request_id: REQUEST, file_name: "une.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_at: expect.any(String) },
    ]);
    // Every photo is looked at in storage before the single mark that makes them visible.
    expect(fake.events).toEqual(["info", "download", "info", "download", "update material_request_files"]);
    expect(fake.writes).toEqual([
      { table: "material_request_files", operation: "update", values: { stored_at: expect.any(String) }, ids: [ids[0], ids[1]] },
    ]);
    expect(await listed()).toEqual([FILE, ids[0], ids[1]]);
  });

  it.each<[string, Declared, Uint8Array | null, string]>([
    ["was never sent", declared("absente.jpg"), null, "missing"],
    ["has another size than announced", declared("tronquee.jpg"), JPEG.subarray(0, 10), "size"],
    ["holds other bytes than its type", declared("deguisee.jpg", "image/jpeg", PNG.byteLength), PNG, "type"],
    ["holds HEIC bytes", declared("iphone.jpg", "image/jpeg", HEIC.byteLength), HEIC, "type"],
    ["holds a script", declared("script.png", "image/png", 25), new TextEncoder().encode("<script>alert(1)</script>"), "type"],
  ])("discards the whole batch when one photo %s, and says which and why", async (_label, bad, sent, reason) => {
    const fake = seed(OWNER, "engineer");
    const [good, rejected] = uploadsOf((await prepare([declared("bonne.jpg"), bad])).data);
    fake.objects.set(good.path, JPEG);
    if (sent) fake.objects.set(rejected.path, sent);
    fake.writes.length = 0;

    const { status, error } = await complete([good.file.id, rejected.file.id]);
    expect([status, error?.code]).toEqual([422, "MATERIAL_REQUEST_FILE_REJECTED"]);
    expect(error?.message).toBe("Les photos reçues ne sont pas celles annoncées : aucune n’a été conservée. Déposez-les à nouveau.");
    expect(error?.details).toEqual({ rejected: [{ id: rejected.file.id, reason }] });
    // Nothing of the batch is marked, listed or left in storage; what was there before stays.
    expect(fake.writes.filter((write) => write.operation === "update" && "stored_at" in (write.values as FakeRow))).toEqual([]);
    // Withdrawn first, so that an upload still in flight cannot land; then the bytes, then the rows.
    expect(fake.events.slice(-3)).toEqual(["update material_request_files", "remove", "delete material_request_files"]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, PENDING_FILE, OTHER_FILE]);
    expect([...fake.objects.keys()]).toEqual([FILE_PATH, OTHER_FILE_PATH, PENDING_FILE_PATH]);
    expect(await listed()).toEqual([FILE]);
  });

  it("completes an upload that was interrupted, and leaves alone a photo that is already stored", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await complete([FILE, PENDING_FILE]);
    expect(status).toBe(200);
    expect((data as { files: FakeRow[] }).files.map((entry) => entry.id)).toEqual([FILE, PENDING_FILE]);
    expect(fake.writes.flatMap((write) => write.ids)).toEqual([PENDING_FILE]);
    // The stored photo is not read again.
    expect(fake.storageCalls.map((entry) => "path" in entry && entry.path)).toEqual([PENDING_FILE_PATH, PENDING_FILE_PATH]);
  });

  it("never discards a stored photo named in a batch that is rejected", async () => {
    const fake = seed(OWNER, "engineer", { objects: { [FILE_PATH]: JPEG, [OTHER_FILE_PATH]: JPEG } });
    const { status, error } = await complete([FILE, PENDING_FILE]);
    expect(status).toBe(422);
    expect(error?.details).toEqual({ rejected: [{ id: PENDING_FILE, reason: "missing" }] });
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, OTHER_FILE]);
    expect(fake.objects.has(FILE_PATH)).toBe(true);
  });

  it("keeps nothing of a batch the database refuses to mark stored, and says so without its reason", async () => {
    const fake = seed(OWNER, "engineer", {
      refuseUpdate: (table, values) => (table === "material_request_files" && "stored_at" in values ? "MATERIAL_REQUEST_FILE_NOT_STORED" : false),
    });
    const uploads = uploadsOf((await prepare([declared("premiere.jpg"), declared("seconde.jpg")])).data);
    for (const upload of uploads) fake.objects.set(upload.path, JPEG);
    const { status, error } = await complete(uploads.map((upload) => upload.file.id));
    expect([status, error]).toEqual([500, { code: "INTERNAL_ERROR", message: "Impossible d’enregistrer les photos : aucune n’a été conservée. Réessayez." }]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, PENDING_FILE, OTHER_FILE]);
    expect([...fake.objects.keys()]).toEqual([FILE_PATH, OTHER_FILE_PATH, PENDING_FILE_PATH]);
  });

  it("lets only one of two uploads prepared side by side become visible past twelve originals", async () => {
    const fake = seed(OWNER, "engineer");
    const eleven = (prefix: string) => Array.from({ length: 11 }, (_, index) => declared(`${prefix}-${index}.jpg`));
    // One original is stored: each batch of eleven fits on its own, the two together do not.
    const first = uploadsOf((await prepare(eleven("matin"))).data);
    const second = uploadsOf((await prepare(eleven("soir"))).data);
    for (const upload of [...first, ...second]) fake.objects.set(upload.path, JPEG);

    expect((await complete(first.map((upload) => upload.file.id))).status).toBe(200);
    const late = await complete(second.map((upload) => upload.file.id));
    expect([late.status, late.error?.code]).toEqual([422, "MATERIAL_REQUEST_FILE_LIMIT"]);
    expect(late.error?.message).toBe("Une demande garde 12 originaux au plus (12 déjà déposés) : ces photos n’ont pas été conservées.");
    expect(await listed()).toEqual([FILE, ...first.map((upload) => upload.file.id)]);
    // The batch that did not fit is gone, rows and bytes.
    expect(fake.tables.material_request_files.filter((row) => row.request_id === REQUEST)).toHaveLength(13);
    expect(second.some((upload) => fake.objects.has(upload.path))).toBe(false);
  });

  it("answers the same way when the database itself refuses a thirteenth original", async () => {
    const fake = seed(OWNER, "engineer", {
      refuseUpdate: (table, values) => (table === "material_request_files" && "stored_at" in values ? "MATERIAL_REQUEST_FILE_LIMIT" : false),
    });
    const [upload] = uploadsOf((await prepare([declared()])).data);
    fake.objects.set(upload.path, JPEG);
    const { status, error } = await complete([upload.file.id]);
    expect([status, error?.code]).toEqual([422, "MATERIAL_REQUEST_FILE_LIMIT"]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, PENDING_FILE, OTHER_FILE]);
    expect(fake.objects.has(upload.path)).toBe(false);
  });

  it("bounds the photos waiting for their bytes on a request", async () => {
    const fake = seed(OWNER, "engineer");
    const eleven = Array.from({ length: 11 }, (_, index) => declared(`photo-${index}.jpg`));
    // One upload was interrupted: 1 + 11 + 11 wait for their bytes, eleven more would make 34.
    expect((await prepare(eleven)).status).toBe(201);
    expect((await prepare(eleven)).status).toBe(201);
    fake.writes.length = 0;
    fake.storageCalls.length = 0;
    const { status, error } = await prepare(eleven);
    expect([status, error?.code]).toEqual([422, "MATERIAL_REQUEST_UPLOADS_PENDING"]);
    expect(error?.message).toBe("Trop de photos sont en cours d’envoi pour cette demande (24 au plus) : terminez ou annulez les envois en cours, puis réessayez.");
    expect(fake.writes).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
  });

  it("keeps the bytes of the photos it made visible when another session cancelled one of the batch meanwhile", async () => {
    let cancelled: string | null = null;
    const fake = seed(OWNER, "engineer", {
      // Between the read of the batch and its mark, the other tab deletes the second photo.
      beforeUpdate: (table, values, tables) => {
        if (table !== "material_request_files" || !("stored_at" in values) || !cancelled) return;
        tables.material_request_files = tables.material_request_files.filter((row) => row.id !== cancelled);
        cancelled = null;
      },
    });
    const [kept, gone] = uploadsOf((await prepare([declared("gardee.jpg"), declared("annulee.jpg")])).data);
    fake.objects.set(kept.path, JPEG);
    fake.objects.set(gone.path, JPEG);
    cancelled = gone.file.id;

    const { status, error } = await complete([kept.file.id, gone.file.id]);
    expect([status, error?.code]).toEqual([409, "MATERIAL_REQUEST_UPLOAD_CHANGED"]);
    // The photo that was marked is listed, and its bytes are still there to serve.
    expect(await listed()).toEqual([FILE, kept.file.id]);
    expect(fake.objects.has(kept.path)).toBe(true);
    const bytes = await call(fileRoute.GET, "GET", { ...inRequest, fileId: kept.file.id });
    expect(bytes.status).toBe(200);
    expect(new Uint8Array(await bytes.response.arrayBuffer())).toEqual(JPEG);
  });

  it("neither lists, serves nor completes a photo whose deletion has begun", async () => {
    const fake = seed(OWNER, "engineer");
    fake.tables.material_request_files[0].removed_at = "2026-11-12T07:00:00.000Z";
    expect(await listed()).toEqual([]);
    const list = await call(requestsRoute.GET, "GET", inProject);
    expect((list.data as { items: FakeRow[] }).items[0]).toMatchObject({ id: REQUEST, file_count: 0 });
    expect((await call(fileRoute.GET, "GET", { ...inRequest, fileId: FILE })).status).toBe(404);
    expect((await call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: FILE }, { rotation: 90 })).status).toBe(404);
    expect((await complete([FILE])).status).toBe(404);
    expect(fake.storageCalls).toEqual([]);
    // Its deletion can be finished.
    expect((await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: FILE })).status).toBe(200);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([PENDING_FILE, OTHER_FILE]);
  });

  it("withdraws an original before its bytes go, whether it is deleted, cancelled or goes with its request", async () => {
    const stored = seed(OWNER, "engineer");
    await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: FILE });
    expect(stored.events).toEqual(["update material_request_files", "remove", "delete material_request_files"]);
    expect(stored.writes[0]).toEqual({ table: "material_request_files", operation: "update", values: { removed_at: expect.any(String) }, ids: [FILE] });

    const pending = seed(OWNER, "engineer");
    await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: PENDING_FILE });
    expect(pending.events).toEqual(["update material_request_files", "remove", "delete material_request_files"]);

    const whole = seed(OWNER, "engineer");
    await call(requestRoute.DELETE, "DELETE", inRequest);
    expect(whole.events).toEqual(["update material_request_files", "remove", "delete material_requests"]);
    expect(whole.writes[0]).toMatchObject({ values: { removed_at: expect.any(String) }, ids: [FILE, PENDING_FILE] });
  });

  it.each<[string, unknown]>([
    ["no id", { ids: [] }],
    ["thirteen ids", { ids: Array.from({ length: 13 }, (_, index) => `80000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`) }],
    ["something that is not an id", { ids: ["42"] }],
  ])("refuses a completion that carries %s", async (_label, body) => {
    seed(OWNER, "engineer");
    const { status, error } = await call(completeRoute.POST, "POST", inRequest, body);
    expect([status, error?.code]).toEqual([400, "VALIDATION_ERROR"]);
  });

  it("does not list, count, serve or turn a photo whose bytes were never marked stored", async () => {
    const fake = seed(OWNER, "engineer");
    expect(await listed()).toEqual([FILE]);
    const list = await call(requestsRoute.GET, "GET", inProject);
    expect((list.data as { items: FakeRow[] }).items[0]).toMatchObject({ id: REQUEST, file_count: 1 });

    const bytes = await call(fileRoute.GET, "GET", { ...inRequest, fileId: PENDING_FILE });
    expect([bytes.status, bytes.error?.message]).toEqual([404, "Original introuvable dans cette demande."]);
    const turned = await call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: PENDING_FILE }, { rotation: 90 });
    expect([turned.status, turned.error?.message]).toEqual([404, "Original introuvable dans cette demande."]);
    // Its bytes exist in storage: they are not even asked for.
    expect(fake.storageCalls).toEqual([]);
    expect(fake.writes.flatMap((write) => write.ids)).toEqual([]);
  });

  it("deletes a photo whose upload was interrupted or is being cancelled, row and bytes", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: PENDING_FILE });
    expect([status, data]).toEqual([200, { deleted: true }]);
    expect(fake.storageCalls).toEqual([{ operation: "remove", bucket: "material-requests", paths: [PENDING_FILE_PATH] }]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, OTHER_FILE]);

    const [cancelled] = uploadsOf((await prepare([declared()])).data);
    expect((await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: cancelled.file.id })).status).toBe(200);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([FILE, OTHER_FILE]);
  });

  it("answers 500 in its own words when the bytes of a stored photo cannot be read", async () => {
    seed(OWNER, "engineer", { objects: {} });
    const { status, response } = await call(fileRoute.GET, "GET", { ...inRequest, fileId: FILE });
    const body = await response.text();
    expect(status).toBe(500);
    expect(JSON.parse(body).error).toEqual({ code: "INTERNAL_ERROR", message: "Impossible de récupérer cet original." });
    expect(body).not.toMatch(/Object not found|NoSuchKey|StorageApiError/);
  });

  it("serves the bytes of an original through the application, private and unsniffable", async () => {
    const fake = seed(OWNER, "engineer");
    const { response, status } = await call(fileRoute.GET, "GET", { ...inRequest, fileId: FILE });
    expect(status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="demande_chantier\.jpg"/);
    expect(fake.storageCalls).toEqual([{ operation: "download", bucket: "material-requests", path: FILE_PATH }]);
  });

  it("turns an original by quarter turns only", async () => {
    const fake = seed(OWNER, "engineer");
    const turned = await call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: FILE }, { rotation: 270 });
    expect((turned.data as { file: FakeRow }).file).toMatchObject({ id: FILE, rotation: 270 });
    expect((turned.data as { file: FakeRow }).file).not.toHaveProperty("storage_path");
    expect(fake.writes.map((write) => write.values)).toEqual([{ rotation: 270 }]);
    expect((await call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: FILE }, { rotation: 45 })).status).toBe(400);
    expect((await call(fileRoute.PATCH, "PATCH", { ...inRequest, fileId: FILE }, { rotation: 90, file_name: "x.jpg" })).status).toBe(400);
  });

  it("deletes an original with its bytes", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await call(fileRoute.DELETE, "DELETE", { ...inRequest, fileId: FILE });
    expect([status, data]).toEqual([200, { deleted: true }]);
    expect(fake.storageCalls).toEqual([{ operation: "remove", bucket: "material-requests", paths: [FILE_PATH] }]);
    expect(fake.tables.material_request_files.map((row) => row.id)).toEqual([PENDING_FILE, OTHER_FILE]);
  });
});
