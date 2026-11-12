import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as cataloguePageRoute from "@/app/api/catalogue/route";
import * as requestCandidatesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/candidates/route";
import * as lineArticleRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/article/route";
import * as lineCandidatesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/candidates/route";
import * as requestRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/route";
import { PRODUCT_REFERENCE_TAKEN } from "@/lib/catalogue/product-writes";
import type {
  MaterialRequestArticleCandidate,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
  MaterialRequestLineArticleResult,
} from "@/lib/material-requests/contracts";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the « rapprochement » routes (TI-690, delivery 3). Articles, references and names are
 * fictional.
 *  1. Rights: a viewer, a director or an engineer who does not own the affaire links, unlinks or creates an
 *     article; a viewer or an engineer who does not own the affaire reads the proposals; a member of another
 *     tenant learns that the affaire exists.
 *  2. Scope: a line of another request, a request of another affaire, an article of another tenant or an
 *     archived article is reached through this URL instead of answering 404.
 *  3. Linking does not write the catalogue's wording into the line, or loses the technician's words
 *     (original_text) or the reference they wrote; a validated line stays validated with its stamps.
 *  4. Usual names: one is learned that the article already says (its type or designation), none is learned
 *     when the words differ, a name already taught fails the link, or a failed insert of the name undoes the
 *     link the office asked for.
 *  5. Unlinking erases the wording the line received, or keeps a validated line validated.
 *  6. Creating an article from a line: it is not a draft, not marked as created from a request, has no
 *     supply type (or one of another tenant), is refused to an engineer who may add articles, accepted from
 *     a viewer, or a reference already taken is a bare 400 instead of the catalogue's own 409 sentence.
 *  7. Proposals: the catalogue is read once per line instead of once per call; a line already linked is
 *     proposed articles again; the request's presumed material is ignored when the line names none; a search
 *     by hand drops the line's size.
 *  8. The detail of a request does not tell the screen which article each line is linked to.
 *  9. The catalogue page does not tell which drafts were created from a request (« Nouveau »).
 * 10. (review) Unlinking and then relinking, or relinking directly, teaches the new article the wording of
 *     the former one instead of the technician's words; unlinking leaves the catalogue's wording in the line,
 *     so its proposals are computed on the former article; a line without original_text loses the
 *     technician's words at its first link; the remembered wording reaches the browser.
 * 11. (review) The unit is replaced and the quantity kept (« 3 barres » becomes « 3 ml ») without the line
 *     asking the office to check the quantity.
 * 12. (review) A link or an unlink overwrites an edit made in between by another session, or sends back
 *     columns it does not change; the usual name is learned although the link was refused.
 * 13. (review) « sans dimension » stays checked once the article gives the line a size.
 * 14. (Codex review of #263) a link chosen from proposals computed on an older version of the line (another
 *     tab changed DN 20 to DN 25 before the link) overwrites the corrected line with the old proposal.
 * 15. (Codex review of #263) unlinking gives the line back its unit but keeps a quantity the office corrected
 *     in the article's unit (« 18 ml » becomes « 18 barres »), without asking to check it.
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
const FOREIGN_PROJECT = "30000000-0000-4000-8000-000000000009";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const OTHER_REQUEST = "60000000-0000-4000-8000-000000000003";
const LINE_ELBOW = "70000000-0000-4000-8000-000000000001";
const LINE_TEE = "70000000-0000-4000-8000-000000000002";
const LINE_LINKED = "70000000-0000-4000-8000-000000000003";
const LINE_GALVANIZED = "70000000-0000-4000-8000-000000000004";
const OTHER_LINE = "70000000-0000-4000-8000-000000000009";
const ELBOW = "90000000-0000-4000-8000-000000000001";
const TEE = "90000000-0000-4000-8000-000000000002";
const GALVANIZED_ELBOW = "90000000-0000-4000-8000-000000000003";
const FLANGE = "90000000-0000-4000-8000-000000000004";
const ARCHIVED = "90000000-0000-4000-8000-000000000005";
const FOREIGN_ARTICLE = "90000000-0000-4000-8000-000000000009";
const SUPPLY_TYPE = "a0000000-0000-4000-8000-000000000001";
const FOREIGN_SUPPLY_TYPE = "a0000000-0000-4000-8000-000000000009";

type Role = "admin" | "engineer" | "viewer" | "director";

function project(id: string, owner: string, extra: FakeRow = {}): FakeRow {
  return { id, tenant_id: TENANT, user_id: owner, name: `Affaire ${id.slice(-1)}`, is_archived: false, ...extra };
}

function request(id: string, projectId: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: projectId, technician_id: null, requested_on: "2026-11-10", needed_on: null,
    delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false,
    presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null, created_by: OWNER,
    created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

function line(id: string, requestId: string, position: number, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: requestId === OTHER_REQUEST ? OTHER_PROJECT : PROJECT, request_id: requestId,
    position, original_text: null, quantity: 4, quantity_doubtful: false, unit: "pcs", dimension: "DN 50",
    no_dimension: false, product_type: "coude 90", material: null, material_precision: null, reference: null,
    supplier_id: null, zone: null, imputation: "project", overhead_category: null, duplicate_acknowledged: false,
    status: "draft", validated_at: null, validated_by: null, product_id: null, product_match: null, pre_link_wording: null,
    created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

function article(id: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, reference: null, designation: "Article fictif", category: null, product_type: null,
    material: null, grade: null, dimensions: null, standard: null, unit: "u", unit_price_cents: 0, is_active: true,
    catalogue_status: "validated", supply_type_id: SUPPLY_TYPE, created_from_material_request: false, created_by: null,
    created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", ...extra,
  };
}

/** The flange line's own words, remembered when it was linked. */
const FLANGE_LINE_WORDING = {
  product_type: "bride collerette", material: null, material_precision: null, dimension: "DN50", no_dimension: false,
  unit: "pcs", quantity_doubtful: false,
};

function seed(
  actor: string,
  role: Role,
  overrides: {
    tables?: Record<string, FakeRow[]>;
    refuseInsert?: (table: string, values: unknown) => string | false;
    beforeUpdate?: (table: string, values: FakeRow, tables: Record<string, FakeRow[]>) => void;
  } = {},
) {
  const fake = createFakeSupabase({
    userId: actor,
    rpc: { material_request_material_options: ["Inox 304L"] },
    refuseInsert: overrides.refuseInsert,
    beforeUpdate: overrides.beforeUpdate,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      estimate_projects: [
        project(PROJECT, OWNER),
        project(OTHER_PROJECT, ENGINEER),
        project(FOREIGN_PROJECT, OUTSIDER, { tenant_id: OTHER_TENANT }),
      ],
      suppliers: [],
      supply_types: [
        { id: SUPPLY_TYPE, tenant_id: TENANT, code: "raccords", name: "Raccords" },
        { id: FOREIGN_SUPPLY_TYPE, tenant_id: OTHER_TENANT, code: "raccords", name: "Raccords d'ailleurs" },
      ],
      products: [
        article(ELBOW, { designation: "Coude 90° inox 304L DN 50", product_type: "Coude 90°", material: "Inox 304L", grade: "304L", standard: "EN 10253", dimensions: "DN 50", unit: "u", reference: "ART-000101" }),
        article(TEE, { designation: "Té égal inox 304L DN 50", product_type: "Té égal", material: "Inox 304L", dimensions: "DN 50", catalogue_status: "draft", created_from_material_request: true }),
        article(GALVANIZED_ELBOW, { designation: "Coude 90° acier galvanisé DN 50", product_type: "Coude 90°", material: "Acier galvanisé", dimensions: "DN 50" }),
        article(FLANGE, { designation: "Bride plate inox DN 50", product_type: "Bride plate", material: "Inox 304L", dimensions: "DN 50" }),
        article(ARCHIVED, { designation: "Coude 90° inox 304L DN 50 (ancien)", product_type: "Coude 90°", material: "Inox 304L", dimensions: "DN 50", is_active: false }),
        article(FOREIGN_ARTICLE, { tenant_id: OTHER_TENANT, designation: "Coude d'ailleurs", product_type: "Coude 90°", material: "Inox 304L", dimensions: "DN 50" }),
      ],
      supplier_catalog_items: [
        { id: "b0000000-0000-4000-8000-000000000001", tenant_id: TENANT, product_id: FLANGE, supplier_id: "40000000-0000-4000-8000-000000000001", supplier_sku: "BP-5050", is_active: true },
        { id: "b0000000-0000-4000-8000-000000000009", tenant_id: OTHER_TENANT, product_id: FOREIGN_ARTICLE, supplier_id: "40000000-0000-4000-8000-000000000009", supplier_sku: "CX-9050", is_active: true },
      ],
      product_aliases: [
        { id: "c0000000-0000-4000-8000-000000000001", tenant_id: TENANT, product_id: TEE, alias: "piquage", alias_key: "piquage", created_by: OWNER, created_at: "2026-11-01T09:00:00.000Z" },
      ],
      material_requests: [
        request(REQUEST, PROJECT, { presumed_material: "Inox 304L" }),
        request(OTHER_REQUEST, OTHER_PROJECT, { created_by: ENGINEER }),
      ],
      material_request_lines: [
        line(LINE_ELBOW, REQUEST, 1, { original_text: "4 coudes 90 DN50 réf CX-9050", reference: "CX-9050", status: "validated", validated_at: "2026-11-11T10:00:00.000Z", validated_by: OWNER, duplicate_acknowledged: true }),
        line(LINE_TEE, REQUEST, 2, { product_type: "piquage", original_text: "2 piquages DN50" }),
        line(LINE_LINKED, REQUEST, 3, { product_type: "Bride plate", material: "Inox 304L", status: "validated", validated_at: "2026-11-11T10:00:00.000Z", validated_by: OWNER, product_id: FLANGE, product_match: "manual", pre_link_wording: FLANGE_LINE_WORDING }),
        line(LINE_GALVANIZED, REQUEST, 4, { product_type: "coude 90", material: "Acier galvanisé" }),
        line(OTHER_LINE, OTHER_REQUEST, 1),
      ],
      ...overrides.tables,
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown, search = "") {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await (handler as Handler)(new Request(`http://localhost/api/test${search}`, init), {
    params: Promise.resolve(params as never),
  });
  const payload = (await response.json()) as { ok: boolean; data?: never; error?: { code: string; message: string } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

const inRequest = { projectId: PROJECT, requestId: REQUEST };
const onLine = (lineId: string) => ({ ...inRequest, lineId });
const NEW_TEE = { product_type: "Té réduit", material: "Inox 304L", dimensions: "DN 50 × 40", unit: "u", supply_type_id: SUPPLY_TYPE };

const WRITES: Array<[string, () => Promise<{ status: number }>]> = [
  ["link an article", () => call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" })],
  ["unlink an article", () => call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_LINKED))],
  ["create an article from a line", () => call(lineArticleRoute.POST, "POST", onLine(LINE_TEE), NEW_TEE)],
];

const READS: Array<[string, () => Promise<{ status: number }>]> = [
  ["propose articles for a request", () => call(requestCandidatesRoute.GET, "GET", inRequest)],
  ["propose articles for a line", () => call(lineCandidatesRoute.GET, "GET", onLine(LINE_ELBOW))],
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("articles of material request lines: rights and scope", () => {
  it.each<[string, string, Role]>([
    ["a director", DIRECTOR, "director"],
    ["a viewer", VIEWER, "viewer"],
    ["an engineer who does not own the affaire", ENGINEER, "engineer"],
  ])("%s is refused by every route that writes, and nothing is written", async (_label, actor, role) => {
    const fake = seed(actor, role);
    for (const [name, attempt] of WRITES) {
      expect([name, (await attempt()).status]).toEqual([name, 403]);
    }
    expect(fake.writes).toEqual([]);
  });

  it.each<[string, string, Role, number]>([
    ["a viewer", VIEWER, "viewer", 403],
    ["an engineer who does not own the affaire", ENGINEER, "engineer", 403],
    ["a member of another tenant", OUTSIDER, "admin", 404],
  ])("%s is refused by every route that reads", async (_label, actor, role, status) => {
    seed(actor, role);
    for (const [name, attempt] of READS) {
      expect([name, (await attempt()).status]).toEqual([name, status]);
    }
  });

  it("a member of another tenant is refused every write as if the affaire did not exist", async () => {
    const fake = seed(OUTSIDER, "admin");
    for (const [name, attempt] of WRITES) {
      expect([name, (await attempt()).status]).toEqual([name, 404]);
    }
    expect(fake.writes).toEqual([]);
  });

  it.each<[string, string, Role, number]>([
    ["an admin who does not own the affaire", ADMIN, "admin", 200],
    ["the engineer who owns the affaire", OWNER, "engineer", 200],
    ["a director", DIRECTOR, "director", 200],
  ])("%s reads the proposals", async (_label, actor, role, status) => {
    seed(actor, role);
    for (const [name, attempt] of READS) {
      expect([name, (await attempt()).status]).toEqual([name, status]);
    }
  });

  it("answers 404 for a line of another request, a request of another affaire, an article of another tenant or an archived one", async () => {
    const fake = seed(OWNER, "engineer");
    const link = (params: Record<string, string>, productId: string) =>
      call(lineArticleRoute.PUT, "PUT", params, { product_id: productId, via: "manual" });
    expect((await link(onLine(OTHER_LINE), ELBOW)).status).toBe(404);
    expect((await link({ projectId: PROJECT, requestId: OTHER_REQUEST, lineId: OTHER_LINE }, ELBOW)).status).toBe(404);
    expect((await link(onLine(LINE_ELBOW), FOREIGN_ARTICLE)).status).toBe(404);
    expect((await link(onLine(LINE_ELBOW), ARCHIVED)).status).toBe(404);
    expect((await call(lineCandidatesRoute.GET, "GET", onLine(OTHER_LINE))).status).toBe(404);
    expect((await call(requestCandidatesRoute.GET, "GET", { projectId: PROJECT, requestId: OTHER_REQUEST })).status).toBe(404);
    expect((await call(lineArticleRoute.DELETE, "DELETE", onLine(OTHER_LINE))).status).toBe(404);
    expect((await call(lineArticleRoute.POST, "POST", onLine(OTHER_LINE), NEW_TEE)).status).toBe(404);
    expect(fake.writes).toEqual([]);
  });

  it("refuses a link without a known way, and a request body that names a product of the URL's choosing only", async () => {
    seed(OWNER, "engineer");
    expect((await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "created" })).status).toBe(400);
    expect((await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: "pas-un-id", via: "manual" })).status).toBe(400);
  });
});

describe("linking a line to an article", () => {
  it("writes the catalogue's wording, keeps the technician's words and reference, returns a validated line to draft and learns the usual name", async () => {
    const fake = seed(OWNER, "engineer");
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" });
    expect(linked.status).toBe(200);
    const result = linked.data as MaterialRequestLineArticleResult;
    expect(result.line).toMatchObject({
      id: LINE_ELBOW,
      product_id: ELBOW,
      product_match: "ranked",
      product_type: "Coude 90°",
      material: "Inox 304L",
      material_precision: "304L EN 10253",
      dimension: "DN 50",
      unit: "u",
      original_text: "4 coudes 90 DN50 réf CX-9050",
      reference: "CX-9050",
      status: "draft",
      validated_at: null,
      // The piece changed: « not a duplicate » is asked again.
      duplicate_acknowledged: false,
    });
    expect(result.article).toEqual({
      id: ELBOW, reference: "ART-000101", designation: "Coude 90° inox 304L DN 50", product_type: "Coude 90°",
      material: "Inox 304L", dimensions: "DN 50", unit: "u", catalogue_status: "validated",
      created_from_material_request: false, supply_type_name: "Raccords",
    } satisfies MaterialRequestArticleSummary);
    expect(result.alias_learned).toBe("coude 90");
    expect(fake.tables.product_aliases.filter((alias) => alias.product_id === ELBOW)).toEqual([
      expect.objectContaining({ tenant_id: TENANT, alias: "coude 90", alias_key: "coude", created_by: OWNER }),
    ]);
  });

  it("learns nothing when the line's words are already the article's type", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_ELBOW, REQUEST, 1, { product_type: "Coudes 90°" })] },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" });
    expect(linked.status).toBe(200);
    expect((linked.data as MaterialRequestLineArticleResult).alias_learned).toBeNull();
    expect(fake.writes.filter((write) => write.table === "product_aliases")).toEqual([]);
  });

  it("relinking teaches the new article the technician's words, not the former article's", async () => {
    const fake = seed(OWNER, "engineer");
    const relinked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_LINKED), { product_id: ELBOW, via: "manual" });
    expect(relinked.status).toBe(200);
    const result = relinked.data as MaterialRequestLineArticleResult;
    expect(result.line).toMatchObject({ product_id: ELBOW, product_match: "manual", product_type: "Coude 90°", status: "draft" });
    expect(result.alias_learned).toBe("bride collerette");
    expect(fake.tables.product_aliases.filter((alias) => alias.product_id === ELBOW).map((alias) => alias.alias)).toEqual(["bride collerette"]);
    // The words remembered at the first link stay those of the technician.
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_LINKED)?.pre_link_wording).toEqual(FLANGE_LINE_WORDING);
  });

  it("unlinking gives the line back the technician's words, and a later link teaches them", async () => {
    const fake = seed(OWNER, "engineer");
    expect((await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" })).status).toBe(200);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)?.pre_link_wording).toEqual({
      product_type: "coude 90", material: null, material_precision: null, dimension: "DN 50", no_dimension: false,
      unit: "pcs", quantity_doubtful: false, quantity: 4,
    });
    const unlinked = await call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_ELBOW));
    expect((unlinked.data as { line: MaterialRequestLine }).line).toMatchObject({
      product_id: null, product_match: null, product_type: "coude 90", material: null, material_precision: null,
      dimension: "DN 50", unit: "pcs",
    });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)?.pre_link_wording).toBeNull();
    const relinked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: GALVANIZED_ELBOW, via: "manual" });
    expect((relinked.data as MaterialRequestLineArticleResult).alias_learned).toBe("coude 90");
    expect(fake.tables.product_aliases.filter((alias) => alias.product_id === GALVANIZED_ELBOW).map((alias) => alias.alias)).toEqual(["coude 90"]);
  });

  it("keeps the technician's words in original_text when the line had none, and never sends the remembered wording", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_ELBOW, REQUEST, 1, { original_text: null, material: "Inox 304L" })] },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" });
    const result = linked.data as MaterialRequestLineArticleResult;
    expect(result.line.original_text).toBe("coude 90 DN 50 Inox 304L");
    expect(result.line).not.toHaveProperty("pre_link_wording");
    expect(result.line).not.toHaveProperty("updated_at");
    // Only what changes is sent: the material was already the article's.
    const write = fake.writes.find((entry) => entry.table === "material_request_lines");
    expect(Object.keys(write?.values as object)).not.toContain("material");
    expect(Object.keys(write?.values as object)).not.toContain("reference");
  });

  it.each<[string, string | null, string, boolean]>([
    ["another unit, by its code", "u", "ml", true],
    ["a unit without a known code, written otherwise", "barres", "ml", true],
    ["the same unit written otherwise", "pièce", "u", false],
    ["a unit, to a line that gave none", null, "ml", false],
  ])("asks to check the quantity when the article brings %s", async (_label, lineUnit, articleUnit, doubtful) => {
    seed(OWNER, "engineer", {
      tables: {
        products: [article(ELBOW, { designation: "Tube inox 304L DN 50", product_type: "Tube", material: "Inox 304L", dimensions: "DN 50", unit: articleUnit })],
        material_request_lines: [line(LINE_ELBOW, REQUEST, 1, { quantity: 3, unit: lineUnit })],
      },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "manual" });
    expect((linked.data as MaterialRequestLineArticleResult).line).toMatchObject({ quantity: 3, quantity_doubtful: doubtful, unit: articleUnit });
  });

  it("refuses a link over an edit made in between, keeps that edit and learns nothing", async () => {
    let edited = false;
    const fake = seed(OWNER, "engineer", {
      beforeUpdate: (table, _values, tables) => {
        if (table !== "material_request_lines" || edited) return;
        edited = true;
        const row = tables.material_request_lines.find((entry) => entry.id === LINE_ELBOW)!;
        Object.assign(row, { zone: "R+3", updated_at: "2026-11-12T09:30:00.000Z" });
      },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" });
    expect(linked.status).toBe(409);
    expect(linked.error).toMatchObject({
      code: "MATERIAL_REQUEST_LINE_CHANGED",
      message: "La ligne a changé entre-temps : rechargez la demande, puis rattachez-la à nouveau.",
    });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)).toMatchObject({ zone: "R+3", product_id: null });
    expect(fake.writes.filter((write) => write.table === "product_aliases")).toEqual([]);
  });

  it("refuses a link chosen on an older version of the line, and links when the line is as the office saw it", async () => {
    const fake = seed(OWNER, "engineer");
    const seen = { reference: "CX-9050", product_type: "coude 90", material: null, material_precision: null, dimension: "DN 40", unit: "pcs", imputation: "project" };
    const stale = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked", expected_line: seen });
    expect(stale.status).toBe(409);
    expect(stale.error).toMatchObject({ code: "MATERIAL_REQUEST_LINE_CHANGED" });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)).toMatchObject({ dimension: "DN 50", product_id: null });
    expect(fake.writes.filter((write) => write.table === "product_aliases")).toEqual([]);

    const current = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), {
      product_id: ELBOW, via: "ranked", expected_line: { ...seen, dimension: " DN 50 " },
    });
    expect(current.status).toBe(200);
  });

  it("an unlink over an edit made in between is refused too", async () => {
    let edited = false;
    seed(OWNER, "engineer", {
      beforeUpdate: (table, _values, tables) => {
        if (table !== "material_request_lines" || edited) return;
        edited = true;
        Object.assign(tables.material_request_lines.find((entry) => entry.id === LINE_LINKED)!, { updated_at: "2026-11-12T09:30:00.000Z" });
      },
    });
    expect((await call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_LINKED))).status).toBe(409);
  });

  it("unchecks « sans dimension » when the article gives the line a size", async () => {
    seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_ELBOW, REQUEST, 1, { dimension: null, no_dimension: true })] },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "manual" });
    expect((linked.data as MaterialRequestLineArticleResult).line).toMatchObject({ dimension: "DN 50", no_dimension: false });
  });

  it("a usual name already taught does not fail the link", async () => {
    seed(OWNER, "engineer");
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_TEE), { product_id: TEE, via: "alias" });
    expect(linked.status).toBe(200);
    expect((linked.data as MaterialRequestLineArticleResult).line).toMatchObject({ product_id: TEE, product_match: "alias", product_type: "Té égal" });
    expect((linked.data as MaterialRequestLineArticleResult).alias_learned).toBeNull();
  });

  it("the link stands when the usual name cannot be recorded, and the failure is logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = seed(OWNER, "engineer", { refuseInsert: (table) => (table === "product_aliases" ? "SOMETHING_ELSE" : false) });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "ranked" });
    expect(linked.status).toBe(200);
    expect((linked.data as MaterialRequestLineArticleResult).alias_learned).toBeNull();
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)).toMatchObject({ product_id: ELBOW, product_match: "ranked" });
    expect(logged).toHaveBeenCalledWith("A usual name could not be learned for a catalogue article", expect.objectContaining({ productId: ELBOW }));
  });

  it("keeps a column of the line that the article leaves blank", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: { products: [article(ELBOW, { designation: "Coude 90° inox DN 50", product_type: "Coude 90°", material: "Inox 304L" })] },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "manual" });
    expect((linked.data as MaterialRequestLineArticleResult).line).toMatchObject({ dimension: "DN 50", material_precision: null });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)?.dimension).toBe("DN 50");
  });

  it.each<[string, number, boolean]>([
    ["corrected in the article's unit", 18, true],
    ["left as the technician asked", 3, false],
  ])("unlinking back to the technician's unit asks to check a quantity %s", async (_label, quantity, doubtful) => {
    const fake = seed(OWNER, "engineer", {
      tables: {
        products: [article(ELBOW, { designation: "Tube inox 304L DN 50", product_type: "Tube", material: "Inox 304L", dimensions: "DN 50", unit: "ml" })],
        material_request_lines: [line(LINE_ELBOW, REQUEST, 1, { quantity: 3, unit: "barres" })],
      },
    });
    const linked = await call(lineArticleRoute.PUT, "PUT", onLine(LINE_ELBOW), { product_id: ELBOW, via: "manual" });
    expect((linked.data as MaterialRequestLineArticleResult).line).toMatchObject({ quantity: 3, unit: "ml", quantity_doubtful: true });
    // The office checks the quantity in the article's unit (or keeps it) and confirms it.
    Object.assign(fake.tables.material_request_lines.find((row) => row.id === LINE_ELBOW)!, {
      quantity, quantity_doubtful: false, updated_at: new Date().toISOString(),
    });
    const unlinked = await call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_ELBOW));
    expect((unlinked.data as { line: MaterialRequestLine }).line).toMatchObject({ quantity, unit: "barres", quantity_doubtful: doubtful });
  });

  it("unlinking restores the technician's words, clears the link and returns a validated line to draft", async () => {
    const fake = seed(OWNER, "engineer");
    const unlinked = await call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_LINKED));
    expect(unlinked.status).toBe(200);
    expect((unlinked.data as { line: MaterialRequestLine }).line).toMatchObject({
      product_id: null, product_match: null, product_type: "bride collerette", material: null, dimension: "DN50", unit: "pcs",
      status: "draft", validated_at: null,
    });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_LINKED)?.pre_link_wording).toBeNull();
  });

  it("unlinking a line linked without remembered words keeps its columns", async () => {
    seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_LINKED, REQUEST, 3, { product_type: "Bride plate", material: "Inox 304L", product_id: FLANGE, product_match: "manual" })] },
    });
    const unlinked = await call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_LINKED));
    expect((unlinked.data as { line: MaterialRequestLine }).line).toMatchObject({ product_id: null, product_type: "Bride plate", material: "Inox 304L" });
  });

  it("unlinking a line without an article writes nothing", async () => {
    const fake = seed(OWNER, "engineer");
    const unlinked = await call(lineArticleRoute.DELETE, "DELETE", onLine(LINE_TEE));
    expect(unlinked.status).toBe(200);
    expect(fake.writes).toEqual([]);
  });

  it("the detail of a request gives the summary of every linked article", async () => {
    seed(OWNER, "engineer");
    const detail = await call(requestRoute.GET, "GET", inRequest);
    expect(detail.status).toBe(200);
    const { articles, lines } = detail.data as { articles: Record<string, MaterialRequestArticleSummary>; lines: MaterialRequestLine[] };
    expect(Object.keys(articles)).toEqual([FLANGE]);
    expect(articles[FLANGE]).toMatchObject({ designation: "Bride plate inox DN 50", supply_type_name: "Raccords" });
    expect(lines.find((row) => row.id === LINE_LINKED)).toMatchObject({ product_id: FLANGE, product_match: "manual" });
  });
});

describe("creating an article from a line", () => {
  it.each<[string, string, Role]>([
    ["the engineer who owns the affaire (TI-689: engineers add articles)", OWNER, "engineer"],
    ["an admin", ADMIN, "admin"],
  ])("%s creates a draft marked as created from a request, then links it", async (_label, actor, role) => {
    const fake = seed(actor, role);
    const created = await call(lineArticleRoute.POST, "POST", onLine(LINE_TEE), NEW_TEE);
    expect(created.status).toBe(201);
    const result = created.data as MaterialRequestLineArticleResult;
    expect(result.article).toMatchObject({
      designation: "Té réduit Inox 304L DN 50 × 40", product_type: "Té réduit", material: "Inox 304L", dimensions: "DN 50 × 40",
      unit: "u", catalogue_status: "draft", created_from_material_request: true, supply_type_name: "Raccords", reference: null,
    });
    expect(fake.tables.products.find((row) => row.id === result.article.id)).toMatchObject({
      tenant_id: TENANT, supply_type_id: SUPPLY_TYPE, catalogue_status: "draft", created_from_material_request: true, created_by: actor,
    });
    expect(result.line).toMatchObject({
      product_id: result.article.id, product_match: "created", product_type: "Té réduit", dimension: "DN 50 × 40", original_text: "2 piquages DN50",
    });
    expect(result.alias_learned).toBe("piquage");
  });

  it("keeps the designation the office wrote", async () => {
    seed(OWNER, "engineer");
    const created = await call(lineArticleRoute.POST, "POST", onLine(LINE_TEE), { ...NEW_TEE, designation: "Té réduit concentrique inox" });
    expect((created.data as MaterialRequestLineArticleResult).article.designation).toBe("Té réduit concentrique inox");
  });

  it("requires a supply type of the tenant", async () => {
    const fake = seed(OWNER, "engineer");
    const withoutSupplyType: Partial<typeof NEW_TEE> = { ...NEW_TEE };
    delete withoutSupplyType.supply_type_id;
    expect((await call(lineArticleRoute.POST, "POST", onLine(LINE_TEE), withoutSupplyType)).status).toBe(400);
    const foreign = await call(lineArticleRoute.POST, "POST", onLine(LINE_TEE), { ...NEW_TEE, supply_type_id: FOREIGN_SUPPLY_TYPE });
    expect(foreign.status).toBe(400);
    expect(foreign.error?.message).toBe("Ce type de fourniture n’existe pas dans votre référentiel.");
    expect(fake.writes).toEqual([]);
  });

  it("answers the catalogue's own 409 for a reference already taken, and links nothing", async () => {
    const fake = seed(OWNER, "engineer");
    const taken = await call(lineArticleRoute.POST, "POST", onLine(LINE_TEE), { ...NEW_TEE, reference: "art-000101" });
    expect(taken.status).toBe(409);
    expect(taken.error?.message).toBe(PRODUCT_REFERENCE_TAKEN);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_TEE)?.product_id).toBeNull();
  });
});

describe("proposals", () => {
  it("reads the catalogue once for every line without an article, and skips the linked ones", async () => {
    const fake = seed(OWNER, "engineer");
    const proposed = await call(requestCandidatesRoute.GET, "GET", inRequest);
    expect(proposed.status).toBe(200);
    const { lines } = proposed.data as { lines: Record<string, MaterialRequestArticleCandidate[]> };
    expect(Object.keys(lines).sort()).toEqual([LINE_ELBOW, LINE_TEE, LINE_GALVANIZED].sort());
    expect(fake.reads.filter((table) => table === "products")).toHaveLength(1);
    expect(fake.reads.filter((table) => table === "product_aliases")).toHaveLength(1);
    expect(fake.reads.filter((table) => table === "supplier_catalog_items")).toHaveLength(1);
    // The usual name taught for the tee is proposed first; another tenant's supplier reference is not ours.
    expect(lines[LINE_TEE][0]).toMatchObject({ via: "alias", article: { id: TEE, catalogue_status: "draft", created_from_material_request: true } });
    expect(lines[LINE_ELBOW].map((candidate) => candidate.article.id)).not.toContain(FOREIGN_ARTICLE);
    expect(lines[LINE_ELBOW].map((candidate) => candidate.article.id)).not.toContain(ARCHIVED);
  });

  it("uses the request's presumed material for a line that names none, and the line's own otherwise", async () => {
    seed(OWNER, "engineer");
    const { lines } = (await call(requestCandidatesRoute.GET, "GET", inRequest)).data as { lines: Record<string, MaterialRequestArticleCandidate[]> };
    expect(lines[LINE_ELBOW][0].article.id).toBe(ELBOW);
    expect(lines[LINE_ELBOW].map((candidate) => candidate.article.id)).not.toContain(GALVANIZED_ELBOW);
    expect(lines[LINE_GALVANIZED][0].article.id).toBe(GALVANIZED_ELBOW);
    expect(lines[LINE_GALVANIZED].map((candidate) => candidate.article.id)).not.toContain(ELBOW);
  });

  it("proposes by supplier reference first", async () => {
    seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_ELBOW, REQUEST, 1, { product_type: "bride", reference: "BP 5050" })] },
    });
    const { candidates } = (await call(lineCandidatesRoute.GET, "GET", onLine(LINE_ELBOW))).data as { candidates: MaterialRequestArticleCandidate[] };
    expect(candidates[0]).toMatchObject({ via: "reference", article: { id: FLANGE } });
  });

  it("a search by hand replaces the line's words, ranks its size first and flags another size", async () => {
    seed(OWNER, "engineer", {
      tables: {
        products: [
          article(TEE, { designation: "Té égal inox 304L DN 50", product_type: "Té égal", material: "Inox 304L", dimensions: "DN 50" }),
          article(FLANGE, { designation: "Té égal inox 304L DN 80", product_type: "Té égal", material: "Inox 304L", dimensions: "DN 80" }),
        ],
      },
    });
    const own = (await call(lineCandidatesRoute.GET, "GET", onLine(LINE_ELBOW))).data as { candidates: MaterialRequestArticleCandidate[] };
    expect(own.candidates).toEqual([]);
    const searched = (await call(lineCandidatesRoute.GET, "GET", onLine(LINE_ELBOW), undefined, "?q=t%C3%A9%20%C3%A9gal")).data as { candidates: MaterialRequestArticleCandidate[] };
    expect(searched.candidates.map((candidate) => candidate.article.id)).toEqual([TEE, FLANGE]);
    expect(searched.candidates[0].warnings).toEqual([]);
    expect(searched.candidates[1].warnings).toContain("Autre dimension (DN 80) que la ligne (DN 50).");
    const blank = await call(lineCandidatesRoute.GET, "GET", onLine(LINE_ELBOW), undefined, "?q=%20");
    expect((blank.data as { candidates: unknown[] }).candidates).toEqual([]);
    const tooLong = await call(lineCandidatesRoute.GET, "GET", onLine(LINE_ELBOW), undefined, `?q=${"a".repeat(201)}`);
    expect(tooLong.status).toBe(400);
  });

  it("does not read the catalogue when every line is linked", async () => {
    const fake = seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_LINKED, REQUEST, 1, { product_id: FLANGE, product_match: "manual" })] },
    });
    const proposed = await call(requestCandidatesRoute.GET, "GET", inRequest);
    expect(proposed.data).toEqual({ lines: {} });
    expect(fake.reads).not.toContain("products");
  });
});

describe("catalogue page", () => {
  it("tells which articles were created from a request", async () => {
    const fake = seed(OWNER, "engineer");
    const rows = [TEE, ELBOW].map((id, index) => ({
      id, designation: `Article ${index}`, reference: null, unit_price_cents: 0, is_active: true, catalogue_status: "draft",
      price_status: "none", supplier_price_count: 0, total_count: 2,
    }));
    const original = fake.supabase.rpc;
    fake.supabase.rpc = (async (name: string) =>
      name === "catalogue_products_page" ? { data: rows, error: null } : original(name)) as typeof original;
    const page = await cataloguePageRoute.GET(new Request("http://localhost/api/catalogue?view=page"));
    const payload = (await page.json()) as { data: { items: Array<{ id: string; created_from_material_request: boolean }> } };
    expect(page.status).toBe(200);
    expect(payload.data.items.map((item) => [item.id, item.created_from_material_request])).toEqual([[TEE, true], [ELBOW, false]]);
  });
});
