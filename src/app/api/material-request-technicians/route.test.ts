import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as technicianRequestsRoute from "@/app/api/material-request-technicians/[technicianId]/requests/route";
import * as technicianRoute from "@/app/api/material-request-technicians/[technicianId]/route";
import * as techniciansRoute from "@/app/api/material-request-technicians/route";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes, written before the routes (TI-690). Names and affaires are fictional.
 *  1. A viewer or a director adds or changes a technician; a member cannot read the list they pick from.
 *  2. The same technician is added twice under another case or spacing, or the refusal is not the agreed
 *     wording (409, « Ce technicien existe déjà. »).
 *  3. A technician of another tenant is listed, changed, or placed on a site of another tenant.
 *  4. The history of a technician shows requests of affaires the caller cannot read, of another
 *     technician or of an archived affaire; it is not the most recent first; its limit is unbounded.
 *  5. The history counts a photo whose bytes were never stored (an interrupted upload).
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
const FOREIGN_PROJECT = "30000000-0000-4000-8000-000000000009";
const TECHNICIAN = "50000000-0000-4000-8000-000000000001";
const COLLEAGUE = "50000000-0000-4000-8000-000000000002";
const FOREIGN_TECHNICIAN = "50000000-0000-4000-8000-000000000009";

type Role = "admin" | "engineer" | "viewer" | "director";

const requestId = (index: number) => `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function request(index: number, projectId: string, technicianId: string, extra: FakeRow = {}): FakeRow {
  return {
    id: requestId(index), tenant_id: TENANT, project_id: projectId, technician_id: technicianId,
    requested_on: "2026-11-10", needed_on: null, delivery_place: null, is_urgent: false, presumed_material: null,
    material_confirmed: false, presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null,
    created_by: OWNER, created_at: `2026-10-${String(index).padStart(2, "0")}T09:00:00.000Z`,
    updated_at: `2026-10-${String(index).padStart(2, "0")}T09:00:00.000Z`, ...extra,
  };
}

function line(id: string, parent: number, position: number, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: PROJECT, request_id: requestId(parent), position, original_text: null,
    quantity: 4, quantity_doubtful: false, unit: "u", dimension: "DN 50", no_dimension: false, product_type: "Bride",
    material: "Inox 304L", material_precision: null, reference: null, supplier_id: null, zone: null,
    imputation: "project", overhead_category: null, duplicate_acknowledged: false, status: "draft",
    validated_at: null, validated_by: null, created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", ...extra,
  };
}

function seed(actor: string, role: Role, extraRequests: FakeRow[] = []) {
  const fake = createFakeSupabase({
    userId: actor,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      estimate_projects: [
        { id: PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Résidence fictive", is_archived: false },
        { id: OTHER_PROJECT, tenant_id: TENANT, user_id: ENGINEER, name: "Groupe scolaire fictif", is_archived: false },
        { id: ARCHIVED_PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Chantier clos", is_archived: true },
        { id: FOREIGN_PROJECT, tenant_id: OTHER_TENANT, user_id: OUTSIDER, name: "Affaire d'ailleurs", is_archived: false },
      ],
      material_request_technicians: [
        { id: TECHNICIAN, tenant_id: TENANT, name: "Technicien Bravo", current_project_id: PROJECT, is_active: true, created_by: OWNER },
        { id: COLLEAGUE, tenant_id: TENANT, name: "Technicien Alpha", current_project_id: null, is_active: false, created_by: OWNER },
        { id: FOREIGN_TECHNICIAN, tenant_id: OTHER_TENANT, name: "Technicien d'ailleurs", current_project_id: null, is_active: true, created_by: OUTSIDER },
      ],
      material_requests: [
        request(1, PROJECT, TECHNICIAN),
        request(2, OTHER_PROJECT, TECHNICIAN),
        request(3, PROJECT, TECHNICIAN, { is_urgent: true }),
        request(4, ARCHIVED_PROJECT, TECHNICIAN),
        request(5, PROJECT, COLLEAGUE),
        ...extraRequests,
      ],
      material_request_lines: [
        line("70000000-0000-4000-8000-000000000002", 3, 2, { product_type: "Coude 45°", status: "validated", validated_at: "2026-10-03T10:00:00.000Z" }),
        line("70000000-0000-4000-8000-000000000001", 3, 1),
        line("70000000-0000-4000-8000-000000000003", 1, 1),
        line("70000000-0000-4000-8000-000000000004", 5, 1),
      ],
      material_request_files: [
        { id: "80000000-0000-4000-8000-000000000001", tenant_id: TENANT, project_id: PROJECT, request_id: requestId(3), storage_path: "x", file_name: "demande.jpg", mime_type: "image/jpeg", byte_size: 10, rotation: 0, created_at: "2026-10-03T09:00:00.000Z", stored_at: "2026-10-03T09:00:02.000Z" },
        { id: "80000000-0000-4000-8000-000000000002", tenant_id: TENANT, project_id: PROJECT, request_id: requestId(3), storage_path: "y", file_name: "interrompue.jpg", mime_type: "image/jpeg", byte_size: 10, rotation: 0, created_at: "2026-10-03T09:01:00.000Z", stored_at: null },
      ],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown, query = "") {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await (handler as Handler)(new Request(`http://localhost/api/test${query}`, init), {
    params: Promise.resolve(params as never),
  });
  const payload = (await response.json()) as { data?: never; error?: { code: string; message: string } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("material request technicians", () => {
  it.each<[string, string, Role, number, number]>([
    ["an admin", ADMIN, "admin", 201, 200],
    ["an engineer", ENGINEER, "engineer", 201, 200],
    ["a viewer", VIEWER, "viewer", 403, 403],
    ["a director", DIRECTOR, "director", 403, 403],
  ])("%s: add %i, change %i, and always reads the list", async (_label, actor, role, addStatus, changeStatus) => {
    const fake = seed(actor, role);
    const list = await call(techniciansRoute.GET, "GET", {});
    expect(list.status).toBe(200);
    expect((list.data as { items: FakeRow[] }).items).toEqual([
      { id: COLLEAGUE, name: "Technicien Alpha", current_project_id: null, is_active: false },
      { id: TECHNICIAN, name: "Technicien Bravo", current_project_id: PROJECT, is_active: true },
    ]);
    const added = await call(techniciansRoute.POST, "POST", {}, { name: "  Technicien Charlie  ", current_project_id: PROJECT });
    expect(added.status).toBe(addStatus);
    const changed = await call(technicianRoute.PATCH, "PATCH", { technicianId: TECHNICIAN }, { is_active: false });
    expect(changed.status).toBe(changeStatus);
    if (addStatus === 201) {
      expect((added.data as { item: FakeRow }).item).toMatchObject({ name: "Technicien Charlie", current_project_id: PROJECT, is_active: true });
      expect((changed.data as { item: FakeRow }).item).toEqual({ id: TECHNICIAN, name: "Technicien Bravo", current_project_id: PROJECT, is_active: false });
      expect(fake.writes[0].values).toEqual({ name: "Technicien Charlie", current_project_id: PROJECT, created_by: actor });
    } else {
      expect(fake.writes).toEqual([]);
    }
  });

  it.each(["TECHNICIEN BRAVO", "technicien  bravo", "TechnicienBravo"])("refuses « %s » as a technician who already exists", async (name) => {
    const fake = seed(OWNER, "engineer");
    const added = await call(techniciansRoute.POST, "POST", {}, { name });
    expect([added.status, added.error?.message]).toEqual([409, "Ce technicien existe déjà."]);
    const renamed = await call(technicianRoute.PATCH, "PATCH", { technicianId: COLLEAGUE }, { name });
    expect([renamed.status, renamed.error?.message]).toEqual([409, "Ce technicien existe déjà."]);
    expect(fake.tables.material_request_technicians).toHaveLength(3);
  });

  it("lets a technician keep their own name under another case", async () => {
    seed(OWNER, "engineer");
    const { status, data } = await call(technicianRoute.PATCH, "PATCH", { technicianId: TECHNICIAN }, { name: "Technicien BRAVO" });
    expect(status).toBe(200);
    expect((data as { item: FakeRow }).item).toMatchObject({ name: "Technicien BRAVO" });
  });

  it("neither lists nor changes a technician of another tenant, and refuses a site of another tenant", async () => {
    const fake = seed(OWNER, "engineer");
    expect((await call(technicianRoute.PATCH, "PATCH", { technicianId: FOREIGN_TECHNICIAN }, { is_active: false })).status).toBe(404);
    expect((await call(technicianRequestsRoute.GET, "GET", { technicianId: FOREIGN_TECHNICIAN })).status).toBe(404);
    const elsewhere = await call(techniciansRoute.POST, "POST", {}, { name: "Technicien Charlie", current_project_id: FOREIGN_PROJECT });
    expect([elsewhere.status, elsewhere.error?.message]).toEqual([400, "Affaire introuvable."]);
    const moved = await call(technicianRoute.PATCH, "PATCH", { technicianId: TECHNICIAN }, { current_project_id: FOREIGN_PROJECT });
    expect(moved.status).toBe(400);
    expect(fake.writes).toEqual([]);

    seed(OUTSIDER, "admin");
    const list = await call(techniciansRoute.GET, "GET", {});
    expect((list.data as { items: FakeRow[] }).items.map((item) => item.id)).toEqual([FOREIGN_TECHNICIAN]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a blank name", { name: "   " }],
    ["a tenant", { name: "Technicien Charlie", tenant_id: OTHER_TENANT }],
    ["nothing", {}],
  ])("refuses a technician sent with %s", async (_label, body) => {
    const fake = seed(OWNER, "engineer");
    expect((await call(techniciansRoute.POST, "POST", {}, body)).status).toBe(400);
    expect(fake.writes).toEqual([]);
  });

  it("shows an admin the technician's latest requests in every readable affaire, with their lines in order", async () => {
    seed(ADMIN, "admin");
    const { status, data } = await call(technicianRequestsRoute.GET, "GET", { technicianId: TECHNICIAN });
    const items = (data as { items: Array<{ request: FakeRow; lines: FakeRow[] }> }).items;
    expect(status).toBe(200);
    expect(items.map((item) => [item.request.id, item.request.project_name])).toEqual([
      [requestId(3), "Résidence fictive"], [requestId(2), "Groupe scolaire fictif"], [requestId(1), "Résidence fictive"],
    ]);
    expect(items[0].request).toMatchObject({
      technician_name: "Technicien Bravo", line_count: 2, validated_line_count: 1, file_count: 1, is_urgent: true,
    });
    expect(items[0].lines.map((entry) => [entry.position, entry.product_type, entry.status])).toEqual([
      [1, "Bride", "draft"], [2, "Coude 45°", "validated"],
    ]);
    expect(items[1].lines).toEqual([]);
    expect(items[0].request).not.toHaveProperty("tenant_id");
  });

  it.each<[string, string, Role, number[]]>([
    ["the engineer who owns one of the affaires sees its requests only", OWNER, "engineer", [3, 1]],
    ["an engineer who owns the other affaire sees that one only", ENGINEER, "engineer", [2]],
    ["a director sees every affaire that is not archived", DIRECTOR, "director", [3, 2, 1]],
    ["a viewer who owns no affaire sees nothing", VIEWER, "viewer", []],
  ])("%s", async (_label, actor, role, expected) => {
    seed(actor, role);
    const { status, data } = await call(technicianRequestsRoute.GET, "GET", { technicianId: TECHNICIAN });
    expect(status).toBe(200);
    expect((data as { items: Array<{ request: FakeRow }> }).items.map((item) => item.request.id)).toEqual(expected.map(requestId));
  });

  it("returns ten requests by default, twenty at most, and refuses a limit that is not a count", async () => {
    const many = Array.from({ length: 24 }, (_, index) => request(index + 6, PROJECT, TECHNICIAN));
    seed(ADMIN, "admin", many);
    const count = async (query: string) => {
      const { status, data } = await call(technicianRequestsRoute.GET, "GET", { technicianId: TECHNICIAN }, undefined, query);
      return [status, (data as { items: unknown[] } | undefined)?.items.length];
    };
    expect(await count("")).toEqual([200, 10]);
    expect(await count("?limit=3")).toEqual([200, 3]);
    expect(await count("?limit=20")).toEqual([200, 20]);
    expect(await count("?limit=21")).toEqual([400, undefined]);
    expect(await count("?limit=0")).toEqual([400, undefined]);
    expect(await count("?limit=abc")).toEqual([400, undefined]);
    const latest = await call(technicianRequestsRoute.GET, "GET", { technicianId: TECHNICIAN }, undefined, "?limit=1");
    expect((latest.data as { items: Array<{ request: FakeRow }> }).items[0].request.id).toBe(requestId(29));
  });
});
