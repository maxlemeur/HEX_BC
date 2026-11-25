import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/catalogue/workbook-import/supplier-references/route";
import type { CostingWorkbookSupplierReferenceReport } from "@/lib/catalogue/costing-workbook-contract";
import { createFakeSupabase, fakeMembership, type FakeRow, type FakeRpcHandler } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the supplier reference import's report (TI-711), written with the screen that corrects them.
 * The database function is proved by pgTAP (catalogue-engineer-rights.test.sql); here it only counts its rows.
 * Companies, suppliers and articles are invented.
 *  1. References of an article the draft import of the same sheet creates are sent to Excel as « article
 *     introuvable »: nothing is wrong in the workbook, the drafts come first. An archived article, which that
 *     import skips, must stay « introuvable ».
 *  2. A reason names a conflict with the catalogue without what the catalogue holds: the code already
 *     registered, the records that share an identifier or a name.
 *  3. The preview writes, or the confirmation writes without the preview's fingerprint.
 *  4. After the confirmation, the report no longer says which references were imported.
 *  5. Scope: an article, a supplier or a reference of another company is matched or named.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const ATLAS = "40000000-0000-4000-8000-000000000001";
const BOREAL = "40000000-0000-4000-8000-000000000002";
const TWIN_A = "40000000-0000-4000-8000-000000000003";
const TWIN_B = "40000000-0000-4000-8000-000000000004";
const FOREIGN_SUPPLIER = "40000000-0000-4000-8000-000000000009";
const TUBE = "90000000-0000-4000-8000-000000000001";
const ARCHIVED = "90000000-0000-4000-8000-000000000002";
const DOUBLE_A = "90000000-0000-4000-8000-000000000003";
const DOUBLE_B = "90000000-0000-4000-8000-000000000004";
const EXISTING_ITEM = "50000000-0000-4000-8000-000000000001";

const HEADERS = ["ID", "Matériau", "Caractéristique", "Unité", "F1_nom", "F1_ref", "F2_nom", "F2_ref", "Type_ligne"];
type Cell = string | number | null;
const article = (values: Record<string, Cell>): Cell[] =>
  HEADERS.map((header) => ({ "Type_ligne": "Art", "Matériau": "Inox 304L", "Unité": "ml", ...values })[header] ?? null);

const SHEET: Cell[][] = [
  HEADERS,
  // Row 2: importable at Atlas; another code than the catalogue's at Boréal.
  article({ "ID": "TUBE-32", "Caractéristique": "Tube", "F1_nom": "Comptoir Atlas", "F1_ref": "AT-32", "F2_nom": "Dépôt Boréal", "F2_ref": "BO-NEW" }),
  // Row 3: an article the draft import creates; its supplier is unknown too, but the article comes first.
  article({ "ID": "COUDE-32", "Caractéristique": "Coude 90°", "F1_nom": "Comptoir Atlas", "F1_ref": "AT-C32", "F2_nom": "Inconnu SARL", "F2_ref": "X-1" }),
  // Row 4: archived in the catalogue: the draft import skips it, so it is not « to create ».
  article({ "ID": "BRIDE-50", "Caractéristique": "Bride plate", "F1_nom": "Comptoir Atlas", "F1_ref": "AT-B50" }),
  // Row 5: two active articles share the identifier.
  article({ "ID": "DOUBLE-1", "Caractéristique": "Té égal", "F1_nom": "Comptoir Atlas", "F1_ref": "AT-T1" }),
  // Row 6: two active suppliers share the name; an unknown supplier on a known article.
  article({ "ID": "TUBE-32", "Caractéristique": "Tube", "F1_nom": "négoce jumeau", "F1_ref": "NJ-1", "F2_nom": "Inconnu SARL", "F2_ref": "X-2" }),
];

function product(id: string, reference: string, extra: FakeRow = {}): FakeRow {
  return { id, tenant_id: TENANT, reference, designation: `Fiche ${reference}`, created_by: ADMIN, is_active: true, ...extra };
}
function supplier(id: string, name: string, extra: FakeRow = {}): FakeRow {
  return { id, tenant_id: TENANT, name, city: null, email: null, siret: null, created_at: "2026-10-01T09:00:00.000Z", is_active: true, ...extra };
}

const importReferences: FakeRpcHandler = (args) => ({ data: (args.p_rows as unknown[]).length });

function seed() {
  const fake = createFakeSupabase({
    userId: ADMIN,
    rpc: { import_workbook_supplier_references: importReferences },
    tables: {
      tenant_memberships: [fakeMembership(ADMIN, TENANT, "admin")],
      products: [
        product(TUBE, "TUBE-32"),
        product(ARCHIVED, "Bride-50", { is_active: false }),
        product(DOUBLE_A, "DOUBLE-1", { designation: "Té égal DN25" }),
        product(DOUBLE_B, "DB_Raccords__double-1", { designation: "Té égal DN25 (ancien import)" }),
        // Another company holds the article the sheet creates here (5).
        product("90000000-0000-4000-8000-000000000009", "COUDE-32", { tenant_id: OTHER_TENANT }),
      ],
      suppliers: [
        supplier(ATLAS, "Comptoir Atlas"),
        supplier(BOREAL, "Dépôt Boréal"),
        supplier(TWIN_A, "Négoce Jumeau", { city: "Lyon" }),
        supplier(TWIN_B, "Négoce jumeau", { city: "Nantes" }),
        supplier(FOREIGN_SUPPLIER, "Inconnu SARL", { tenant_id: OTHER_TENANT }),
      ],
      supplier_catalog_items: [{
        id: EXISTING_ITEM, tenant_id: TENANT, product_id: TUBE, supplier_id: BOREAL, supplier_sku: "BO-OLD",
        is_active: true, reference_needs_review: false,
      }],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

async function send(body: unknown) {
  const response = await POST(new Request("http://localhost/api/catalogue/workbook-import/supplier-references", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const payload = (await response.json()) as { data?: CostingWorkbookSupplierReferenceReport; error?: { code: string; message: string } };
  return { status: response.status, data: payload.data, error: payload.error };
}

describe("POST /api/catalogue/workbook-import/supplier-references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says what each cell waits for, with what the catalogue holds, and writes nothing (1, 2, 3, 5)", async () => {
    const fake = seed();

    const answer = await send({ rows: SHEET, confirm: false });

    expect(answer.status).toBe(200);
    expect(answer.data).toMatchObject({ confirmed: false, to_import: 1, imported: 0, already_registered: 0, duplicates: 0 });
    expect(answer.data?.preview_token).toMatch(/^[a-f0-9]{64}$/);
    expect(answer.data?.proposed).toEqual([
      { row: 2, slot: 1, article_reference: "TUBE-32", supplier_name: "Comptoir Atlas", product_id: TUBE },
    ]);
    expect(answer.data?.for_decision).toEqual([
      { row: 2, slot: 2, reason: "different_existing_reference", product_id: TUBE, supplier_id: BOREAL, existing_supplier_sku: "BO-OLD" },
      { row: 3, slot: 1, reason: "article_to_create" },
      { row: 3, slot: 2, reason: "article_to_create" },
      { row: 4, slot: 1, reason: "article_not_found" },
      {
        row: 5, slot: 1, reason: "ambiguous_article",
        candidates: [
          { id: DOUBLE_A, label: "DOUBLE-1 · Té égal DN25" },
          { id: DOUBLE_B, label: "DB_Raccords__double-1 · Té égal DN25 (ancien import)" },
        ],
      },
      {
        row: 6, slot: 1, reason: "ambiguous_supplier", product_id: TUBE,
        candidates: [{ id: TWIN_A, label: "Négoce Jumeau · Lyon" }, { id: TWIN_B, label: "Négoce jumeau · Nantes" }],
      },
      { row: 6, slot: 2, reason: "supplier_not_found", product_id: TUBE },
    ]);
    expect(fake.writes).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("confirms with the preview's fingerprint only, and answers the references it imported (3, 4)", async () => {
    const fake = seed();
    const preview = await send({ rows: SHEET, confirm: false });

    expect((await send({ rows: SHEET, confirm: true })).status).toBe(400);
    const stale = await send({ rows: SHEET, confirm: true, preview_token: "0".repeat(64) });
    expect(stale.status).toBe(409);
    expect(fake.rpcCalls).toEqual([]);

    const answer = await send({ rows: SHEET, confirm: true, preview_token: preview.data?.preview_token });
    expect(answer.status).toBe(200);
    expect(answer.data).toMatchObject({ confirmed: true, to_import: 0, imported: 1, preview_token: null });
    expect(answer.data?.proposed).toEqual(preview.data?.proposed);
    expect(fake.rpcArgs).toEqual([{
      name: "import_workbook_supplier_references",
      args: {
        p_tenant_id: TENANT,
        p_rows: [{ product_id: TUBE, product_reference: "TUBE-32", supplier_id: ATLAS, supplier_name: "Comptoir Atlas", supplier_sku: "AT-32" }],
      },
    }]);
  });
});
