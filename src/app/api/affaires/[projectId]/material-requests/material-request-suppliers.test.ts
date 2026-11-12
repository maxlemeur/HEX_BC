import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as supplierProposalsRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/supplier-proposals/route";
import * as lineRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/[lineId]/route";
import * as linesRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/route";
import * as retainSuppliersRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/lines/retain-suppliers/route";
import * as supplyTypeRoute from "@/app/api/catalogue/supply-types/[supplyTypeId]/route";
import * as supplyTypesRoute from "@/app/api/catalogue/supply-types/route";
import * as preferredSupplierRoute from "@/app/api/products/[productId]/preferred-supplier/route";
import * as supplierItemsRoute from "@/app/api/products/[productId]/supplier-items/route";
import type {
  ArticleSupplierItem,
  ArticleSupplierItemSaved,
  ArticleSuppliers,
  LineSupplierProposal,
  RetainLineSuppliersResult,
} from "@/lib/material-requests/supplier-contracts";
import {
  createFakeSupabase,
  fakeMembership,
  type FakeRow,
  type FakeRpcHandler,
  type FakeTables,
} from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the suppliers of material request lines (TI-691, lot 2 « l'achat », delivery 1), written
 * before the routes. Suppliers, articles and references are fictional.
 *  1. Order of the proposal: the technician's supplier does not beat the article's exception, the exception does
 *     not beat the supply type's preferred supplier, or the type's does not beat the last purchase; a line with
 *     none of them gets something instead of null.
 *  2. A line that already has a supplier, or has no article, gets a proposal.
 *  3. The reference proposed with a supplier is that of an inactive item, or of another supplier's item.
 *  4. An archived supplier is proposed (the office cannot pick it) instead of the next source.
 *  5. Proposals are loaded with one query (or one database call) per line instead of a bounded number per request.
 *  6. Rights of the proposals: a viewer or an engineer who does not own the affaire reads them; a member of another
 *     tenant learns the affaire exists; a request of another affaire is reached through this one's URL.
 *  7. Article suppliers: a member of another tenant lists or writes them, or learns the article exists; a viewer or
 *     a director writes one; an engineer writes one on a shared article the admin did not open (TI-689 rule), or
 *     cannot once it is open, or cannot on the article they added; a supplier of another tenant is accepted; a
 *     reference without any identifier or with a non-http(s) address reaches the database; withdrawing a supplier
 *     deletes it; the database's refusal reaches the caller as a bare 400.
 * 11. (coordinator review) The list of an article's suppliers does not say which one is its exception, so the form
 *     shows « Aucun »; withdrawing a supplier asks for a reference or an address, or blanks the stored ones; a key
 *     left out of a save blanks the stored value instead of keeping it (null clears); an item that only carries
 *     prices cannot be withdrawn; a withdrawn supplier stays proposed as the article's exception.
 * 12. (coordinator review) A line that already has a supplier does not say the article's reference there, so the
 *     screen reads each article's items; or it shows the reference of an inactive item.
 *  8. The article's supplier exception: same rights as any field of the article, a supplier of another tenant is
 *     accepted, null does not clear it.
 *  9. The preferred supplier of a supply type: a viewer or a director sets it, an engineer cannot, a type or a
 *     supplier of another tenant is reached; the list of types does not say which supplier each prefers.
 * 10. A validated line returns to draft when only its supplier changes, alone or in a selection (the supplier is
 *     the office's purchasing choice); or, the other way round, changing what it says with its supplier keeps it
 *     validated.
 * 13. (independent review) A supplier withdrawn from the article is still proposed through the technician, the
 *     supply type or the last purchase, instead of the next source; an article's exception is set to a supplier
 *     that has no active item for it.
 * 14. (independent review) Retaining proposals in bulk overwrites a supplier another session set in the meantime,
 *     or reaches a line of another request; a reader retains; the answer does not say which lines were left alone.
 * 15. (independent review) The technician's supplier is proposed as if it were confirmed while the request's
 *     presumed supplier is not.
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
const NAMED_SUPPLIER = "40000000-0000-4000-8000-000000000001";
const EXCEPTION_SUPPLIER = "40000000-0000-4000-8000-000000000002";
const TYPE_SUPPLIER = "40000000-0000-4000-8000-000000000003";
const LAST_SUPPLIER = "40000000-0000-4000-8000-000000000004";
const ARCHIVED_SUPPLIER = "40000000-0000-4000-8000-000000000005";
const WITHDRAWN_SUPPLIER = "40000000-0000-4000-8000-000000000006";
const FOREIGN_SUPPLIER = "40000000-0000-4000-8000-000000000009";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const NAMED_REQUEST = "60000000-0000-4000-8000-000000000002";
const OTHER_REQUEST = "60000000-0000-4000-8000-000000000003";
const LINE_ELBOW = "70000000-0000-4000-8000-000000000001";
const LINE_TEE = "70000000-0000-4000-8000-000000000002";
const LINE_FLANGE = "70000000-0000-4000-8000-000000000003";
const LINE_CAP = "70000000-0000-4000-8000-000000000004";
const LINE_VALVE = "70000000-0000-4000-8000-000000000005";
const LINE_CHOSEN = "70000000-0000-4000-8000-000000000006";
const LINE_CHOSEN_TEE = "70000000-0000-4000-8000-000000000009";
const LINE_FREE = "70000000-0000-4000-8000-000000000007";
const LINE_VALIDATED = "70000000-0000-4000-8000-000000000008";
const LINE_NAMED = "70000000-0000-4000-8000-000000000011";
const LINE_NAMED_FLANGE = "70000000-0000-4000-8000-000000000012";
const OTHER_LINE = "70000000-0000-4000-8000-000000000019";
const ELBOW = "90000000-0000-4000-8000-000000000001";
const TEE = "90000000-0000-4000-8000-000000000002";
const FLANGE = "90000000-0000-4000-8000-000000000003";
const CAP = "90000000-0000-4000-8000-000000000004";
const VALVE = "90000000-0000-4000-8000-000000000005";
const OWN_ARTICLE = "90000000-0000-4000-8000-000000000006";
const FOREIGN_ARTICLE = "90000000-0000-4000-8000-000000000009";
const FITTINGS = "a0000000-0000-4000-8000-000000000001";
const FLANGES = "a0000000-0000-4000-8000-000000000002";
const FOREIGN_TYPE = "a0000000-0000-4000-8000-000000000009";
const ELBOW_ITEM = "b0000000-0000-4000-8000-000000000001";
const TEE_TYPE_ITEM = "b0000000-0000-4000-8000-000000000002";
const TEE_LAST_ITEM = "b0000000-0000-4000-8000-000000000003";
const FLANGE_ITEM = "b0000000-0000-4000-8000-000000000004";
const ELBOW_LAST_ITEM = "b0000000-0000-4000-8000-000000000005";
const CAP_PRICE_ITEM = "b0000000-0000-4000-8000-000000000006";
const FLANGE_NAMED_ITEM = "b0000000-0000-4000-8000-000000000007";
const CAP_WITHDRAWN_ITEM = "b0000000-0000-4000-8000-000000000008";
const OWN_ITEM = "b0000000-0000-4000-8000-000000000009";
const VALIDATED_AT = "2026-11-11T10:00:00.000Z";

type Role = "admin" | "engineer" | "viewer" | "director";

function supplier(id: string, name: string, extra: FakeRow = {}): FakeRow {
  return { id, tenant_id: TENANT, name, is_active: true, created_by: null, ...extra };
}

function article(id: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, reference: null, designation: "Article fictif", product_type: null, material: null, unit: "u",
    is_active: true, catalogue_status: "validated", supply_type_id: FITTINGS, preferred_supplier_id: null, created_by: null,
    created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", ...extra,
  };
}

function request(id: string, projectId: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: projectId, technician_id: null, requested_on: "2026-11-10", needed_on: null,
    delivery_place: null, is_urgent: false, presumed_material: "Inox 304L", material_confirmed: true,
    presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null, created_by: OWNER,
    created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

function line(id: string, requestId: string, position: number, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: requestId === OTHER_REQUEST ? OTHER_PROJECT : PROJECT, request_id: requestId,
    position, original_text: null, quantity: 4, quantity_doubtful: false, unit: "u", dimension: "DN 50",
    no_dimension: false, product_type: "coude 90", material: "Inox 304L", material_precision: null, reference: null,
    supplier_id: null, zone: null, imputation: "project", overhead_category: null, duplicate_acknowledged: false,
    status: "draft", validated_at: null, validated_by: null, product_id: null, product_match: null, pre_link_wording: null,
    created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z", ...extra,
  };
}

const linked = (productId: string, extra: FakeRow = {}) => ({ product_id: productId, product_match: "manual", ...extra });

/** The latest confirmed or received order of each article, as public.last_purchase_suppliers answers it. */
const LAST_PURCHASES: FakeRow[] = [
  { product_id: ELBOW, supplier_id: LAST_SUPPLIER },
  { product_id: TEE, supplier_id: LAST_SUPPLIER },
  { product_id: FLANGE, supplier_id: LAST_SUPPLIER },
  { product_id: VALVE, supplier_id: LAST_SUPPLIER },
  { product_id: CAP, supplier_id: WITHDRAWN_SUPPLIER },
];

const lastPurchaseSuppliers: FakeRpcHandler = (args) => {
  const ids = (args.p_product_ids as string[] | undefined) ?? [];
  return { data: LAST_PURCHASES.filter((row) => ids.includes(String(row.product_id))) };
};

/**
 * public.save_supplier_catalog_item, as pgTAP proves it: one item per tenant, supplier and article, upserted value
 * by value (null keeps, blank clears); an active item keeps a reference or an address, a new one needs one;
 * withdrawing clears the article's exception when it names that supplier. Its id is answered.
 */
const saveSupplierCatalogItem: FakeRpcHandler = (args, tables) => {
  const product = (tables.products ?? []).find((row) => row.id === args.p_product_id);
  const items = (tables.supplier_catalog_items ??= []);
  const existing = items.find((row) => row.product_id === args.p_product_id && row.supplier_id === args.p_supplier_id);
  const given = (value: unknown) => (value === null || value === undefined ? undefined : String(value).trim() || null);
  const sku = given(args.p_supplier_sku);
  const url = given(args.p_product_url);
  const next: FakeRow = existing
    ? { ...existing }
    : { id: "b0000000-0000-4000-8000-0000000000ff", tenant_id: product?.tenant_id, product_id: args.p_product_id, supplier_id: args.p_supplier_id, supplier_sku: null, product_url: null };
  if (sku !== undefined) next.supplier_sku = sku;
  if (url !== undefined) next.product_url = url;
  next.is_active = args.p_is_active;
  if (!next.supplier_sku && !next.product_url && (!existing || (next.is_active && (sku !== undefined || url !== undefined)))) {
    return { data: null, error: { code: "22023", message: "SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED" } };
  }
  if (existing) Object.assign(existing, next);
  else items.push(next);
  if (product && args.p_is_active === false && product.preferred_supplier_id === args.p_supplier_id) product.preferred_supplier_id = null;
  return { data: next.id };
};

function seed(actor: string, role: Role, overrides: {
  tables?: Partial<FakeTables>;
  rpc?: Record<string, unknown>;
  refuseUpdate?: (table: string, values: FakeRow) => string | false;
  beforeUpdate?: (table: string, values: FakeRow, tables: FakeTables) => void;
} = {}) {
  const fake = createFakeSupabase({
    userId: actor,
    rpc: {
      material_request_material_options: ["Inox 304L"],
      last_purchase_suppliers: lastPurchaseSuppliers,
      save_supplier_catalog_item: saveSupplierCatalogItem,
      ...overrides.rpc,
    },
    refuseUpdate: overrides.refuseUpdate,
    beforeUpdate: overrides.beforeUpdate,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      tenant_catalogue_policies: [],
      estimate_projects: [
        { id: PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Affaire 1", is_archived: false },
        { id: OTHER_PROJECT, tenant_id: TENANT, user_id: ENGINEER, name: "Affaire 2", is_archived: false },
      ],
      suppliers: [
        supplier(NAMED_SUPPLIER, "Fournisseur Nommé"),
        supplier(EXCEPTION_SUPPLIER, "Fournisseur Exception"),
        supplier(TYPE_SUPPLIER, "Fournisseur Raccords"),
        supplier(LAST_SUPPLIER, "Fournisseur Dernier Achat"),
        supplier(ARCHIVED_SUPPLIER, "Fournisseur Archivé", { is_active: false }),
        supplier(WITHDRAWN_SUPPLIER, "Fournisseur Retiré"),
        supplier(FOREIGN_SUPPLIER, "Fournisseur d'ailleurs", { tenant_id: OTHER_TENANT }),
      ],
      supply_types: [
        { id: FITTINGS, tenant_id: TENANT, code: "raccords", name: "Raccords", preferred_supplier_id: TYPE_SUPPLIER },
        { id: FLANGES, tenant_id: TENANT, code: "brides", name: "Brides", preferred_supplier_id: null },
        { id: FOREIGN_TYPE, tenant_id: OTHER_TENANT, code: "raccords", name: "Raccords d'ailleurs", preferred_supplier_id: null },
      ],
      products: [
        article(ELBOW, { designation: "Coude 90° inox DN 50", preferred_supplier_id: EXCEPTION_SUPPLIER }),
        article(TEE, { designation: "Té égal inox DN 50" }),
        article(FLANGE, { designation: "Bride plate inox DN 50", supply_type_id: FLANGES }),
        article(CAP, { designation: "Bouchon inox DN 50", supply_type_id: null }),
        article(VALVE, { designation: "Vanne inox DN 50", preferred_supplier_id: ARCHIVED_SUPPLIER }),
        article(OWN_ARTICLE, { designation: "Manchon inox DN 50", created_by: OWNER }),
        article(FOREIGN_ARTICLE, { tenant_id: OTHER_TENANT, designation: "Coude d'ailleurs", supply_type_id: FOREIGN_TYPE }),
      ],
      supplier_catalog_items: [
        { id: ELBOW_ITEM, tenant_id: TENANT, product_id: ELBOW, supplier_id: EXCEPTION_SUPPLIER, supplier_sku: "EXC-050", product_url: "https://exception.example.test/coude-50", is_active: true },
        { id: TEE_TYPE_ITEM, tenant_id: TENANT, product_id: TEE, supplier_id: TYPE_SUPPLIER, supplier_sku: "RAC-TE-50", product_url: null, is_active: false },
        { id: TEE_LAST_ITEM, tenant_id: TENANT, product_id: TEE, supplier_id: LAST_SUPPLIER, supplier_sku: "DA-TE-50", product_url: null, is_active: true },
        { id: FLANGE_ITEM, tenant_id: TENANT, product_id: FLANGE, supplier_id: LAST_SUPPLIER, supplier_sku: "DA-BR-50", product_url: null, is_active: true },
        { id: ELBOW_LAST_ITEM, tenant_id: TENANT, product_id: ELBOW, supplier_id: LAST_SUPPLIER, supplier_sku: "DA-CO-50", product_url: null, is_active: true },
        // Created by the price book: prices only, no reference and no address.
        { id: CAP_PRICE_ITEM, tenant_id: TENANT, product_id: CAP, supplier_id: LAST_SUPPLIER, supplier_sku: null, product_url: null, is_active: true },
        // Suppliers withdrawn from an article: never proposed for it.
        { id: FLANGE_NAMED_ITEM, tenant_id: TENANT, product_id: FLANGE, supplier_id: NAMED_SUPPLIER, supplier_sku: "NOM-BR-50", product_url: null, is_active: false },
        { id: CAP_WITHDRAWN_ITEM, tenant_id: TENANT, product_id: CAP, supplier_id: WITHDRAWN_SUPPLIER, supplier_sku: "RET-BO-50", product_url: null, is_active: false },
        { id: OWN_ITEM, tenant_id: TENANT, product_id: OWN_ARTICLE, supplier_id: NAMED_SUPPLIER, supplier_sku: "NOM-MA-50", product_url: null, is_active: true },
      ],
      supplier_pricebook: [
        { id: "c0000000-0000-4000-8000-000000000001", tenant_id: TENANT, supplier_catalog_item_id: ELBOW_ITEM, unit_price_cents: 1234 },
      ],
      material_requests: [
        request(REQUEST, PROJECT),
        request(NAMED_REQUEST, PROJECT, { presumed_supplier_id: NAMED_SUPPLIER }),
        request(OTHER_REQUEST, OTHER_PROJECT, { created_by: ENGINEER }),
      ],
      material_request_lines: [
        line(LINE_ELBOW, REQUEST, 1, linked(ELBOW)),
        line(LINE_TEE, REQUEST, 2, linked(TEE)),
        line(LINE_FLANGE, REQUEST, 3, linked(FLANGE)),
        line(LINE_CAP, REQUEST, 4, linked(CAP)),
        line(LINE_VALVE, REQUEST, 5, linked(VALVE)),
        line(LINE_CHOSEN, REQUEST, 6, linked(ELBOW, { supplier_id: EXCEPTION_SUPPLIER })),
        line(LINE_CHOSEN_TEE, REQUEST, 9, linked(TEE, { supplier_id: TYPE_SUPPLIER })),
        line(LINE_FREE, REQUEST, 7),
        line(LINE_VALIDATED, REQUEST, 8, linked(TEE, { status: "validated", validated_at: VALIDATED_AT, validated_by: OWNER })),
        line(LINE_NAMED, NAMED_REQUEST, 1, linked(ELBOW)),
        line(LINE_NAMED_FLANGE, NAMED_REQUEST, 2, linked(FLANGE)),
        line(OTHER_LINE, OTHER_REQUEST, 1, linked(ELBOW)),
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
  const payload = (await response.json()) as { ok: boolean; data?: never; error?: { code: string; message: string } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

const inRequest = { projectId: PROJECT, requestId: REQUEST };
const proposalsOf = async (requestId = REQUEST) => {
  const answer = await call(supplierProposalsRoute.GET, "GET", { projectId: PROJECT, requestId });
  expect(answer.status).toBe(200);
  return (answer.data as { lines: Record<string, LineSupplierProposal | null> }).lines;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proposed supplier of each line", () => {
  it("proposes the technician's supplier first, before the article's exception, to be confirmed while the request does not confirm it", async () => {
    seed(OWNER, "engineer");
    expect((await proposalsOf(NAMED_REQUEST))[LINE_NAMED]).toEqual({
      supplier_id: NAMED_SUPPLIER, supplier_name: "Fournisseur Nommé", reason: "technician", confirmed: false,
      supplier_sku: null, product_url: null,
    } satisfies LineSupplierProposal);
  });

  it("marks the technician's supplier confirmed once the request confirms it", async () => {
    seed(OWNER, "engineer", {
      tables: {
        material_requests: [request(NAMED_REQUEST, PROJECT, { presumed_supplier_id: NAMED_SUPPLIER, supplier_confirmed: true })],
      },
    });
    expect((await proposalsOf(NAMED_REQUEST))[LINE_NAMED]).toMatchObject({ reason: "technician", confirmed: true });
  });

  it("skips the technician's supplier when it was withdrawn from the article, and proposes the next source", async () => {
    seed(OWNER, "engineer");
    // The flange has an inactive item at the named supplier; its type prefers no supplier, so its last purchase applies.
    expect((await proposalsOf(NAMED_REQUEST))[LINE_NAMED_FLANGE]).toEqual({
      supplier_id: LAST_SUPPLIER, supplier_name: "Fournisseur Dernier Achat", reason: "last_purchase", confirmed: true,
      supplier_sku: "DA-BR-50", product_url: null,
    } satisfies LineSupplierProposal);
  });

  it("proposes the article's exception, with its reference there, when the technician named no supplier", async () => {
    seed(OWNER, "engineer");
    // The same article as the technician's line: its exception wins over its supply type and its last purchase.
    expect((await proposalsOf())[LINE_ELBOW]).toEqual({
      supplier_id: EXCEPTION_SUPPLIER, supplier_name: "Fournisseur Exception", reason: "article", confirmed: true,
      supplier_sku: "EXC-050", product_url: "https://exception.example.test/coude-50",
    } satisfies LineSupplierProposal);
  });

  it("proposes the supply type's supplier before the last purchase, after skipping an archived exception", async () => {
    seed(OWNER, "engineer");
    // The valve's exception is archived; its type's supplier has no item for it (not withdrawn), and it was last
    // bought from another supplier, whose active reference must not be shown here.
    expect((await proposalsOf())[LINE_VALVE]).toEqual({
      supplier_id: TYPE_SUPPLIER, supplier_name: "Fournisseur Raccords", reason: "supply_type", confirmed: true,
      supplier_sku: null, product_url: null,
    } satisfies LineSupplierProposal);
  });

  it("skips the supply type's supplier when it was withdrawn from the article, and proposes the last purchase", async () => {
    seed(OWNER, "engineer");
    // TI-691 review: the tee's item at its type's supplier is inactive. Before, that supplier was proposed anyway.
    expect((await proposalsOf())[LINE_TEE]).toEqual({
      supplier_id: LAST_SUPPLIER, supplier_name: "Fournisseur Dernier Achat", reason: "last_purchase", confirmed: true,
      supplier_sku: "DA-TE-50", product_url: null,
    } satisfies LineSupplierProposal);
  });

  it("proposes the last purchase when the type prefers no supplier, and nothing when the last purchase was withdrawn", async () => {
    seed(OWNER, "engineer");
    const lines = await proposalsOf();
    expect(lines[LINE_FLANGE]).toEqual({
      supplier_id: LAST_SUPPLIER, supplier_name: "Fournisseur Dernier Achat", reason: "last_purchase", confirmed: true,
      supplier_sku: "DA-BR-50", product_url: null,
    } satisfies LineSupplierProposal);
    // The cap was last bought from a supplier since withdrawn from it, and has no other source.
    expect(lines[LINE_CAP]).toBeNull();
  });

  it("answers only the lines that have an article and no supplier yet", async () => {
    seed(OWNER, "engineer");
    expect(Object.keys(await proposalsOf()).sort()).toEqual([LINE_ELBOW, LINE_TEE, LINE_FLANGE, LINE_CAP, LINE_VALVE, LINE_VALIDATED].sort());
  });

  it("gives a line that already has a supplier the article's active reference there, and nothing for an inactive item", async () => {
    seed(OWNER, "engineer");
    const answer = await call(supplierProposalsRoute.GET, "GET", inRequest);
    expect((answer.data as { references: Record<string, unknown> }).references).toEqual({
      [LINE_CHOSEN]: { supplier_sku: "EXC-050", product_url: "https://exception.example.test/coude-50" },
      [LINE_CHOSEN_TEE]: { supplier_sku: null, product_url: null },
    });
  });

  it("loads the proposals of a whole request in a bounded number of queries, whatever its number of lines", async () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      line(`71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, REQUEST, 100 + index, linked(index % 2 ? TEE : FLANGE)));
    const small = seed(OWNER, "engineer");
    await proposalsOf();
    const large = seed(OWNER, "engineer", {
      tables: { material_request_lines: [line(LINE_ELBOW, REQUEST, 1, linked(ELBOW)), ...many] },
    });
    expect(Object.keys(await proposalsOf())).toHaveLength(41);
    for (const fake of [small, large]) {
      for (const table of ["material_request_lines", "products", "supply_types", "supplier_catalog_items", "suppliers"]) {
        expect([table, fake.reads.filter((read) => read === table).length]).toEqual([table, 1]);
      }
      expect(fake.rpcArgs.filter((entry) => entry.name === "last_purchase_suppliers")).toHaveLength(1);
    }
    expect(large.reads).toHaveLength(small.reads.length);
    expect(new Set(large.rpcArgs.find((entry) => entry.name === "last_purchase_suppliers")?.args.p_product_ids as string[]))
      .toEqual(new Set([ELBOW, TEE, FLANGE]));
  });

  it.each<[string, string, Role, number]>([
    ["a viewer", VIEWER, "viewer", 403],
    ["an engineer who does not own the affaire", ENGINEER, "engineer", 403],
    ["a member of another tenant", OUTSIDER, "admin", 404],
    ["the engineer who owns the affaire", OWNER, "engineer", 200],
    ["an admin", ADMIN, "admin", 200],
    ["a director", DIRECTOR, "director", 200],
  ])("%s gets %s on the proposals", async (_label, actor, role, status) => {
    seed(actor, role);
    expect((await call(supplierProposalsRoute.GET, "GET", inRequest)).status).toBe(status);
  });

  it("answers 404 for a request of another affaire reached through this one's URL", async () => {
    seed(ADMIN, "admin");
    expect((await call(supplierProposalsRoute.GET, "GET", { projectId: PROJECT, requestId: OTHER_REQUEST })).status).toBe(404);
  });
});

describe("the supplier of a validated line", () => {
  it("keeps a validated line validated, with its date, when only its supplier changes", async () => {
    const fake = seed(OWNER, "engineer");
    const single = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_VALIDATED }, { supplier_id: TYPE_SUPPLIER });
    expect(single.status).toBe(200);
    expect((single.data as { line: FakeRow }).line).toMatchObject({ supplier_id: TYPE_SUPPLIER, status: "validated", validated_at: VALIDATED_AT });
    const bulk = await call(linesRoute.PATCH, "PATCH", inRequest, { ids: [LINE_VALIDATED, LINE_TEE], patch: { supplier_id: LAST_SUPPLIER } });
    expect(bulk.status).toBe(200);
    expect((bulk.data as { lines: FakeRow[] }).lines.map((entry) => [entry.id, entry.supplier_id, entry.status])).toEqual([
      [LINE_TEE, LAST_SUPPLIER, "draft"], [LINE_VALIDATED, LAST_SUPPLIER, "validated"],
    ]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_VALIDATED)).toMatchObject({ validated_at: VALIDATED_AT });
    expect(fake.writes.filter((write) => write.table === "material_request_lines").map((write) => write.values)).not.toContainEqual(
      expect.objectContaining({ status: "draft" }),
    );
  });

  it("still returns it to draft when the same change also says something new", async () => {
    seed(OWNER, "engineer");
    const changed = await call(lineRoute.PATCH, "PATCH", { ...inRequest, lineId: LINE_VALIDATED }, { supplier_id: TYPE_SUPPLIER, quantity: 6 });
    expect((changed.data as { line: FakeRow }).line).toMatchObject({ supplier_id: TYPE_SUPPLIER, quantity: 6, status: "draft", validated_at: null });
  });
});

describe("suppliers of an article", () => {
  const items = async (productId: string) => call(supplierItemsRoute.GET, "GET", { productId });
  const save = (productId: string, body: unknown) => call(supplierItemsRoute.PUT, "PUT", { productId }, body);

  it("lists them for any member, active ones first, with whether a price uses each and the article's exception", async () => {
    seed(VIEWER, "viewer");
    const tee = await items(TEE);
    expect(tee.status).toBe(200);
    expect(tee.data).toEqual({
      items: [
        { id: TEE_LAST_ITEM, supplier_id: LAST_SUPPLIER, supplier_name: "Fournisseur Dernier Achat", supplier_sku: "DA-TE-50", product_url: null, is_active: true, has_price: false },
        { id: TEE_TYPE_ITEM, supplier_id: TYPE_SUPPLIER, supplier_name: "Fournisseur Raccords", supplier_sku: "RAC-TE-50", product_url: null, is_active: false, has_price: false },
      ] satisfies ArticleSupplierItem[],
      preferred_supplier_id: null,
    } satisfies ArticleSuppliers);
    expect((await items(ELBOW)).data).toEqual({
      items: [
        expect.objectContaining({ id: ELBOW_LAST_ITEM, has_price: false }),
        expect.objectContaining({ id: ELBOW_ITEM, has_price: true }),
      ],
      preferred_supplier_id: EXCEPTION_SUPPLIER,
    });
  });

  it("answers 404 for an article of another tenant, and to a member of another tenant", async () => {
    seed(ADMIN, "admin");
    expect((await items(FOREIGN_ARTICLE)).status).toBe(404);
    expect((await save(FOREIGN_ARTICLE, { supplier_id: NAMED_SUPPLIER, supplier_sku: "X-1" })).status).toBe(404);
    seed(OUTSIDER, "admin");
    expect((await items(ELBOW)).status).toBe(404);
    expect((await save(ELBOW, { supplier_id: NAMED_SUPPLIER, supplier_sku: "X-1" })).status).toBe(404);
  });

  it.each<[string, string, Role, string]>([
    ["a viewer", VIEWER, "viewer", ELBOW],
    ["a director", DIRECTOR, "director", OWN_ARTICLE],
    ["an engineer, on a shared article the admin did not open", ENGINEER, "engineer", ELBOW],
    ["an engineer, on an article another engineer added", ENGINEER, "engineer", OWN_ARTICLE],
  ])("refuses %s before the database is called", async (_label, actor, role, productId) => {
    const fake = seed(actor, role);
    const refused = await save(productId, { supplier_id: NAMED_SUPPLIER, supplier_sku: "NOM-1" });
    expect(refused.status).toBe(403);
    expect(fake.rpcCalls).not.toContain("save_supplier_catalog_item");
  });

  it.each<[string, string, Role, string, FakeRow[]]>([
    ["the engineer who added the article", OWNER, "engineer", OWN_ARTICLE, []],
    ["an engineer, once the admin opened the shared base", ENGINEER, "engineer", ELBOW, [{ tenant_id: TENANT, engineers_can_edit_shared: true }]],
    ["an admin, on a shared article", ADMIN, "admin", ELBOW, []],
  ])("lets %s save a reference without a price", async (_label, actor, role, productId, policies) => {
    const fake = seed(actor, role, { tables: { tenant_catalogue_policies: policies } });
    const saved = await save(productId, { supplier_id: NAMED_SUPPLIER, supplier_sku: "  NOM-1 ", product_url: " https://nomme.example.test/a " });
    expect(saved.status).toBe(200);
    expect(fake.rpcArgs.find((entry) => entry.name === "save_supplier_catalog_item")?.args).toEqual({
      p_product_id: productId, p_supplier_id: NAMED_SUPPLIER, p_supplier_sku: "NOM-1",
      p_product_url: "https://nomme.example.test/a", p_is_active: true,
    });
    expect((saved.data as { item: ArticleSupplierItem }).item).toMatchObject({
      supplier_id: NAMED_SUPPLIER, supplier_name: "Fournisseur Nommé", supplier_sku: "NOM-1", is_active: true, has_price: false,
    });
    expect(fake.writes.filter((write) => write.table === "supplier_pricebook")).toEqual([]);
  });

  it("withdraws the supplier of the article's exception without a reference, keeping its item, and clears the exception", async () => {
    const fake = seed(ADMIN, "admin");
    const withdrawn = await save(ELBOW, { supplier_id: EXCEPTION_SUPPLIER, is_active: false });
    expect(withdrawn.status).toBe(200);
    expect(fake.rpcArgs.find((entry) => entry.name === "save_supplier_catalog_item")?.args).toEqual({
      p_product_id: ELBOW, p_supplier_id: EXCEPTION_SUPPLIER, p_supplier_sku: null, p_product_url: null, p_is_active: false,
    });
    expect(withdrawn.data).toEqual({
      item: {
        id: ELBOW_ITEM, supplier_id: EXCEPTION_SUPPLIER, supplier_name: "Fournisseur Exception", supplier_sku: "EXC-050",
        product_url: "https://exception.example.test/coude-50", is_active: false, has_price: true,
      },
      preferred_supplier_id: null,
    } satisfies ArticleSupplierItemSaved);
    expect(fake.tables.supplier_catalog_items.filter((row) => row.product_id === ELBOW)).toHaveLength(2);
  });

  it("keeps the article's exception when another of its suppliers is withdrawn", async () => {
    seed(ADMIN, "admin");
    const withdrawn = await save(ELBOW, { supplier_id: LAST_SUPPLIER, is_active: false });
    expect(withdrawn).toMatchObject({ status: 200, data: { item: { id: ELBOW_LAST_ITEM, is_active: false, supplier_sku: "DA-CO-50" }, preferred_supplier_id: EXCEPTION_SUPPLIER } });
  });

  it("withdraws an item that only carries prices", async () => {
    seed(ADMIN, "admin");
    const withdrawn = await save(CAP, { supplier_id: LAST_SUPPLIER, is_active: false });
    expect(withdrawn).toMatchObject({ status: 200, data: { item: { id: CAP_PRICE_ITEM, is_active: false, supplier_sku: null, product_url: null } } });
  });

  it("keeps a value the save leaves out and clears one sent as null", async () => {
    const fake = seed(ADMIN, "admin");
    const saved = await save(ELBOW, { supplier_id: EXCEPTION_SUPPLIER, product_url: null });
    expect(saved.status).toBe(200);
    expect(fake.rpcArgs.find((entry) => entry.name === "save_supplier_catalog_item")?.args).toMatchObject({
      p_supplier_sku: null, p_product_url: "", p_is_active: true,
    });
    expect((saved.data as ArticleSupplierItemSaved).item).toMatchObject({ supplier_sku: "EXC-050", product_url: null, is_active: true });
  });

  it("answers the database's refusal of a new supplier without a reference or an address as a 400 sentence", async () => {
    const fake = seed(ADMIN, "admin");
    const refused = await save(ELBOW, { supplier_id: NAMED_SUPPLIER });
    expect(refused.status).toBe(400);
    expect(refused.error?.message).toBe("Renseignez la référence chez le fournisseur ou l’adresse de l’article.");
    expect(fake.tables.supplier_catalog_items.filter((row) => row.product_id === ELBOW && row.supplier_id === NAMED_SUPPLIER)).toEqual([]);
  });

  it("refuses a supplier of another tenant, and a reference without any identifier or with a non-http(s) address", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await save(ELBOW, { supplier_id: FOREIGN_SUPPLIER, supplier_sku: "X-1" })).status).toBe(404);
    expect((await save(ELBOW, { supplier_id: NAMED_SUPPLIER, supplier_sku: "   ", product_url: null })).status).toBe(400);
    expect((await save(ELBOW, { supplier_id: NAMED_SUPPLIER, product_url: "ftp://nomme.example.test/a" })).status).toBe(400);
    expect((await save(ELBOW, { supplier_id: NAMED_SUPPLIER, supplier_sku: "X".repeat(256) })).status).toBe(400);
    expect(fake.rpcCalls).not.toContain("save_supplier_catalog_item");
  });

  it("words the database's own refusal as a 403", async () => {
    seed(ADMIN, "admin", {
      rpc: { save_supplier_catalog_item: (() => ({ data: null, error: { code: "42501", message: "SUPPLIER_CATALOG_ITEM_PRODUCT_LOCKED" } })) satisfies FakeRpcHandler },
    });
    const refused = await save(ELBOW, { supplier_id: NAMED_SUPPLIER, supplier_sku: "NOM-1" });
    expect(refused.status).toBe(403);
    expect(refused.error?.message).toMatch(/base commune/);
  });
});

describe("supplier exception of an article", () => {
  const prefer = (productId: string, preferred: string | null) =>
    call(preferredSupplierRoute.PATCH, "PATCH", { productId }, { preferred_supplier_id: preferred });

  it.each<[string, string, Role, string]>([
    ["a viewer", VIEWER, "viewer", OWN_ARTICLE],
    ["an engineer, on a shared article the admin did not open", ENGINEER, "engineer", ELBOW],
  ])("refuses %s, and nothing is written", async (_label, actor, role, productId) => {
    const fake = seed(actor, role);
    expect((await prefer(productId, NAMED_SUPPLIER)).status).toBe(403);
    expect(fake.writes).toEqual([]);
  });

  it("lets the engineer who added the article set it, and clear it with null", async () => {
    const fake = seed(OWNER, "engineer");
    const set = await prefer(OWN_ARTICLE, NAMED_SUPPLIER);
    expect(set).toMatchObject({ status: 200, data: { preferred_supplier_id: NAMED_SUPPLIER } });
    expect(fake.tables.products.find((row) => row.id === OWN_ARTICLE)).toMatchObject({ preferred_supplier_id: NAMED_SUPPLIER });
    const cleared = await prefer(OWN_ARTICLE, null);
    expect(cleared).toMatchObject({ status: 200, data: { preferred_supplier_id: null } });
    expect(fake.tables.products.find((row) => row.id === OWN_ARTICLE)).toMatchObject({ preferred_supplier_id: null });
  });

  it("lets an admin set it on a shared article", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await prefer(ELBOW, LAST_SUPPLIER)).status).toBe(200);
    expect(fake.tables.products.find((row) => row.id === ELBOW)).toMatchObject({ preferred_supplier_id: LAST_SUPPLIER });
  });

  it("answers 404 for a supplier or an article of another tenant, and to a member of another tenant", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await prefer(ELBOW, FOREIGN_SUPPLIER)).status).toBe(404);
    expect((await prefer(FOREIGN_ARTICLE, NAMED_SUPPLIER)).status).toBe(404);
    expect(fake.writes).toEqual([]);
    seed(OUTSIDER, "admin");
    expect((await prefer(ELBOW, null)).status).toBe(404);
  });

  it("refuses a body without the key", async () => {
    seed(ADMIN, "admin");
    expect((await call(preferredSupplierRoute.PATCH, "PATCH", { productId: ELBOW }, {})).status).toBe(400);
  });

  it.each<[string, string, string]>([
    ["has no item for the article", ELBOW, NAMED_SUPPLIER],
    ["was withdrawn from the article", TEE, TYPE_SUPPLIER],
  ])("refuses, with a 422 sentence, a supplier that %s, and nothing is written", async (_label, productId, supplierId) => {
    const fake = seed(ADMIN, "admin");
    const refused = await prefer(productId, supplierId);
    expect(refused.status).toBe(422);
    expect(refused.error?.code).toBe("PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED");
    expect(refused.error?.message).toMatch(/fournisseur/);
    expect(fake.writes).toEqual([]);
  });

  it("words the database's own refusal of a supplier without an active item as the same 422", async () => {
    seed(ADMIN, "admin", {
      refuseUpdate: (table) => (table === "products" ? "PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED" : false),
    });
    const refused = await prefer(ELBOW, LAST_SUPPLIER);
    expect(refused).toMatchObject({ status: 422, error: { code: "PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED" } });
  });
});

describe("retaining the proposed suppliers of several lines", () => {
  const retain = (choices: unknown, params: Record<string, string> = inRequest) =>
    call(retainSuppliersRoute.POST, "POST", params, { choices });

  it("writes only the lines that still have no supplier, keeps a validated line validated, and names the others", async () => {
    const fake = seed(OWNER, "engineer");
    const retained = await retain([
      { line_id: LINE_ELBOW, supplier_id: EXCEPTION_SUPPLIER },
      { line_id: LINE_VALIDATED, supplier_id: LAST_SUPPLIER },
      { line_id: LINE_CHOSEN, supplier_id: NAMED_SUPPLIER },
      { line_id: OTHER_LINE, supplier_id: NAMED_SUPPLIER },
    ]);
    expect(retained.status).toBe(200);
    const result = retained.data as RetainLineSuppliersResult;
    expect(result.lines.map((entry) => [entry.id, entry.supplier_id, entry.status])).toEqual([
      [LINE_ELBOW, EXCEPTION_SUPPLIER, "draft"], [LINE_VALIDATED, LAST_SUPPLIER, "validated"],
    ]);
    expect(result.skipped.sort()).toEqual([LINE_CHOSEN, OTHER_LINE].sort());
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_CHOSEN)).toMatchObject({ supplier_id: EXCEPTION_SUPPLIER });
    expect(fake.tables.material_request_lines.find((row) => row.id === OTHER_LINE)).toMatchObject({ supplier_id: null });
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_VALIDATED)).toMatchObject({ validated_at: VALIDATED_AT });
    // One conditional statement per supplier chosen (three here), never one per line.
    expect(fake.writes.filter((write) => write.table === "material_request_lines")).toHaveLength(3);
  });

  it("leaves alone a line another session gave a supplier in the meantime", async () => {
    const fake = seed(OWNER, "engineer", {
      beforeUpdate: (table, _values, tables) => {
        if (table !== "material_request_lines") return;
        const tee = tables.material_request_lines.find((row) => row.id === LINE_TEE);
        if (tee && tee.supplier_id === null) tee.supplier_id = NAMED_SUPPLIER;
      },
    });
    const retained = await retain([
      { line_id: LINE_TEE, supplier_id: LAST_SUPPLIER },
      { line_id: LINE_FLANGE, supplier_id: LAST_SUPPLIER },
    ]);
    expect(retained.status).toBe(200);
    expect(retained.data).toMatchObject({ skipped: [LINE_TEE] });
    expect((retained.data as RetainLineSuppliersResult).lines.map((entry) => entry.id)).toEqual([LINE_FLANGE]);
    expect(fake.tables.material_request_lines.find((row) => row.id === LINE_TEE)).toMatchObject({ supplier_id: NAMED_SUPPLIER });
  });

  it.each<[string, string, Role, number]>([
    ["a viewer", VIEWER, "viewer", 403],
    ["a director", DIRECTOR, "director", 403],
    ["an engineer who does not own the affaire", ENGINEER, "engineer", 403],
    ["a member of another tenant", OUTSIDER, "admin", 404],
  ])("refuses %s, and nothing is written", async (_label, actor, role, status) => {
    const fake = seed(actor, role);
    expect((await retain([{ line_id: LINE_ELBOW, supplier_id: EXCEPTION_SUPPLIER }])).status).toBe(status);
    expect(fake.writes).toEqual([]);
  });

  it("refuses a supplier of another tenant, a line named twice, an empty or oversized batch, and writes nothing", async () => {
    const fake = seed(OWNER, "engineer");
    expect((await retain([{ line_id: LINE_ELBOW, supplier_id: FOREIGN_SUPPLIER }])).status).toBe(400);
    expect((await retain([
      { line_id: LINE_ELBOW, supplier_id: EXCEPTION_SUPPLIER }, { line_id: LINE_ELBOW, supplier_id: LAST_SUPPLIER },
    ])).status).toBe(400);
    expect((await retain([])).status).toBe(400);
    const tooMany = Array.from({ length: 301 }, (_, index) => ({
      line_id: `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, supplier_id: EXCEPTION_SUPPLIER,
    }));
    expect((await retain(tooMany)).status).toBe(400);
    expect(fake.writes).toEqual([]);
  });

  it("answers 404 for a request of another affaire reached through this one's URL", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await retain([{ line_id: OTHER_LINE, supplier_id: NAMED_SUPPLIER }], { projectId: PROJECT, requestId: OTHER_REQUEST })).status).toBe(404);
    expect(fake.writes).toEqual([]);
  });
});

describe("preferred supplier of a supply type", () => {
  const prefer = (supplyTypeId: string, preferred: string | null) =>
    call(supplyTypeRoute.PATCH, "PATCH", { supplyTypeId }, { preferred_supplier_id: preferred });

  it.each<[string, string, Role]>([
    ["a viewer", VIEWER, "viewer"],
    ["a director", DIRECTOR, "director"],
  ])("refuses %s, and nothing is written", async (_label, actor, role) => {
    const fake = seed(actor, role);
    expect((await prefer(FLANGES, NAMED_SUPPLIER)).status).toBe(403);
    expect(fake.writes).toEqual([]);
  });

  it.each<[string, string, Role]>([
    ["an engineer", ENGINEER, "engineer"],
    ["an admin", ADMIN, "admin"],
  ])("lets %s set it, and clear it with null", async (_label, actor, role) => {
    const fake = seed(actor, role);
    const set = await prefer(FLANGES, NAMED_SUPPLIER);
    expect(set.status).toBe(200);
    expect(set.data).toEqual({
      item: { id: FLANGES, code: "brides", name: "Brides", preferred_supplier_id: NAMED_SUPPLIER, preferred_supplier_name: "Fournisseur Nommé" },
    });
    expect((await prefer(FLANGES, null)).data).toEqual({
      item: { id: FLANGES, code: "brides", name: "Brides", preferred_supplier_id: null, preferred_supplier_name: null },
    });
    expect(fake.tables.supply_types.find((row) => row.id === FLANGES)).toMatchObject({ preferred_supplier_id: null });
  });

  it("answers 404 for a supply type or a supplier of another tenant, and to a member of another tenant", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await prefer(FOREIGN_TYPE, NAMED_SUPPLIER)).status).toBe(404);
    expect((await prefer(FLANGES, FOREIGN_SUPPLIER)).status).toBe(404);
    expect(fake.writes).toEqual([]);
    seed(OUTSIDER, "admin");
    expect((await prefer(FLANGES, null)).status).toBe(404);
  });

  it("words the database's own refusal as a 403", async () => {
    seed(ENGINEER, "engineer", {
      refuseUpdate: (table) => (table === "supply_types" ? "SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY" : false),
    });
    expect((await prefer(FLANGES, NAMED_SUPPLIER)).status).toBe(403);
  });

  it("lists every supply type with the supplier it prefers", async () => {
    seed(VIEWER, "viewer");
    const listed = await call(supplyTypesRoute.GET, "GET", {});
    expect(listed.status).toBe(200);
    expect(listed.data).toEqual({
      items: [
        { id: FLANGES, code: "brides", name: "Brides", preferred_supplier_id: null, preferred_supplier_name: null },
        { id: FITTINGS, code: "raccords", name: "Raccords", preferred_supplier_id: TYPE_SUPPLIER, preferred_supplier_name: "Fournisseur Raccords" },
      ],
    });
  });
});
