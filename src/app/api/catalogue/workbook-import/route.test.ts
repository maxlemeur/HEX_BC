import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/catalogue/workbook-import/route";
import {
  COSTING_WORKBOOK_FORMAT,
  COSTING_WORKBOOK_IMPORT_INCOMPLETE,
  COSTING_WORKBOOK_MAX_BODY_BYTES,
  type CostingWorkbookImportIncompleteDetails,
  type CostingWorkbookImportReport,
} from "@/lib/catalogue/costing-workbook-contract";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the costing workbook import (TI-690, lot 1), written before the code. Companies, suppliers,
 * articles and references are invented, in the shape of the workbook's « All_data » sheet.
 *  1. Rights: a member who may not add articles (viewer, director) previews or imports; an engineer, who may,
 *     is refused.
 *  2. The preview writes something.
 *  3. A draft loses what the workbook says (reliability, supply type, category, unit, price in cents), is not a
 *     draft, or is marked as created from a material request.
 *  4. An article already in the catalogue (same reference in another case, or under an earlier import's
 *     « DB_<sheet>__ » prefix; draft, validated or archived) is created again or modified.
 *  5. A second run of the same workbook creates anything.
 *  6. The supply type comes from another company, is created, or a missing code is not counted.
 *  7. A supplier, a supplier reference or a price is read or written: they come with purchasing (lot 2), with
 *     dated prices. The report does not count the supplier references the new articles carry.
 *  8. Scope: the catalogue or the supply types are read across every company of the member.
 *  9. A sheet of another shape is written anyway instead of a 422 with the reader's sentence; a body outside the
 *     contract, or too large, reaches the database.
 * 10. A refused chunk: the import goes on, or stops without saying what the earlier chunks created; an article
 *     added meanwhile answers a bare conflict; a re-run does not complete the rest.
 * 11. More than one chunk of rows is sent in one statement, or a chunk boundary loses or repeats an article.
 * 12. The report carries every issue of a long sheet.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const ENGINEER = "20000000-0000-4000-8000-000000000002";
const VIEWER = "20000000-0000-4000-8000-000000000003";
const DIRECTOR = "20000000-0000-4000-8000-000000000004";
const ALPHA = "40000000-0000-4000-8000-000000000001";
const PLAIN = "90000000-0000-4000-8000-000000000001";
const PREFIXED = "90000000-0000-4000-8000-000000000002";
const ARCHIVED = "90000000-0000-4000-8000-000000000003";
const FOREIGN_PRODUCT = "90000000-0000-4000-8000-000000000009";

const SUPPLY_KINDS = ["tube", "raccord", "vanne", "robinetterie", "support", "calorifuge", "divers"] as const;
const supplyTypeId = (tenant: string, code: string) =>
  `a${tenant === TENANT ? "0" : "9"}000000-0000-4000-8000-00000000000${SUPPLY_KINDS.indexOf(code as never) + 1}`;
const supplyTypes = (tenant: string, codes: readonly string[] = SUPPLY_KINDS) =>
  codes.map((code) => ({ id: supplyTypeId(tenant, code), tenant_id: tenant, code, name: code }));

const HEADERS = [
  "Fiabilité (/10)", "ID", "Matériau", "Dimension", "Caractéristique", "Précision", "norme", "Unité", "PR. FO",
  "Type FO", "F1_nom", "F1_ref", "F1_URL", "F2_nom", "F2_ref", "F2_URL", "F3_nom", "F3_ref", "F3_URL", "Type_ligne",
];
type Cell = string | number | null;
const row = (values: Record<string, Cell>): Cell[] => HEADERS.map((header) => (header in values ? values[header] : null));
const article = (values: Record<string, Cell>) => row({ "Type_ligne": "Art", "Unité": "U", ...values });

/** The sheet of most tests: a section, three articles already in the catalogue, four new ones, a bad row. */
const SHEET: Cell[][] = [
  HEADERS,
  row({ "Type_ligne": "Rub", "Caractéristique": "Tuyauterie inox" }),
  article({ "ID": "Tub.X4so.20", "Caractéristique": "Tube", "Matériau": "Inox 304L soudé", "Type FO": "I4L", "F1_nom": "Fournisseur Alpha", "F1_ref": "A-1" }),
  article({ "ID": "Cou.X4so.20", "Caractéristique": "Coude 90°", "Matériau": "Inox 304L soudé", "Type FO": "I4L" }),
  article({ "ID": "bri.x.50", "Caractéristique": "Bride plate", "Matériau": "Inox 304L soudé", "Type FO": "I4L" }),
  article({
    "ID": "Tub.X4so.25", "Fiabilité (/10)": 8, "Caractéristique": "Tube", "Matériau": "Inox 304L soudé", "Dimension": "DN25",
    "norme": "EN 10217-7", "Unité": "ml", "PR. FO": 12.59, "Type FO": "I4L",
    "F1_nom": "Fournisseur Alpha", "F1_ref": "015053", "F1_URL": "https://fournisseur.example/015053",
    "F2_nom": "Modèle régression", "F2_ref": "MR-1",
  }),
  article({
    "ID": "Van.X.50", "Fiabilité (/10)": 6, "Caractéristique": "Vanne à boisseau sphérique", "Matériau": "Robinetterie",
    "Dimension": "DN50", "PR. FO": "45,10", "Type FO": "ROB",
    "F1_nom": "Fournisseur Alpha", "F1_ref": "NB-50", "F2_nom": "Fournisseur Gamma", "F2_ref": "G-50",
    "F3_nom": "Modèle régression", "F3_ref": "MR-2",
  }),
  article({
    "ID": "Coq.K.25", "Caractéristique": "Coquille porteuse", "Matériau": "Kooltherm", "Dimension": "DN25", "Unité": "ml",
    "Type FO": "CAL", "F1_nom": "Fournisseur Alpha", "F1_ref": "AF-1", "F2_nom": "Fournisseur Delta", "F2_ref": "DN-1",
  }),
  article({
    "ID": "Div.1", "Fiabilité (/10)": 3, "Caractéristique": "Vase expansion à membrane", "Matériau": "Divers", "Unité": "",
    "F1_nom": "Fournisseur Alpha", "F1_ref": "VX-1", "F3_nom": "fournisseur alpha", "F3_ref": "VX-2",
  }),
  article({ "ID": "", "Caractéristique": "Coude sans référence" }),
];

const SHEET_REPORT: Omit<CostingWorkbookImportReport, "confirmed"> = {
  articles: 7,
  new_articles: 4,
  already_in_catalogue: 3,
  without_supply_type: 0,
  // As the reader keeps them for the four new articles (2 + 3 + 2 + 2); the tube already present has one more.
  supplier_references_not_imported: 9,
  issues: [
    { row: 9, reference: "Div.1", message: "Unité absente : « u » retenue." },
    { row: 10, reference: null, message: "Ligne sans référence (colonne ID) : ignorée." },
  ],
  issue_count: 2,
  sections: 1,
};

function existingProduct(id: string, extra: FakeRow): FakeRow {
  return {
    id, tenant_id: TENANT, reference: null, designation: "Article fictif", category: null, product_type: null,
    material: null, grade: null, dimensions: null, standard: null, unit: "u", unit_price_cents: 700, is_active: true,
    catalogue_status: "validated", supply_type_id: null, reliability_score: null, created_from_material_request: false,
    created_by: null, created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", ...extra,
  };
}

const EXISTING_PRODUCTS = (): FakeRow[] => [
  existingProduct(PLAIN, { reference: "Tub.X4so.20", designation: "Tube inox 304L DN20" }),
  existingProduct(PREFIXED, { reference: "DB_I4Lsoude__Cou.X4so.20", designation: "Coude inox DN20", catalogue_status: "draft", reliability_score: 4 }),
  existingProduct(ARCHIVED, { reference: "Bri.X.50", designation: "Bride plate DN50", is_active: false }),
  existingProduct(FOREIGN_PRODUCT, { tenant_id: OTHER_TENANT, reference: "Van.X.50", designation: "Vanne d'ailleurs" }),
];

type Role = "admin" | "engineer" | "viewer" | "director";

function seed(
  actor: string,
  role: Role,
  overrides: { supplyTypes?: FakeRow[]; refuseInsert?: (table: string, values: unknown) => string | false } = {},
) {
  const fake = createFakeSupabase({
    userId: actor,
    refuseInsert: overrides.refuseInsert,
    tables: {
      tenant_memberships: [fakeMembership(actor, TENANT, role)],
      supply_types: [...(overrides.supplyTypes ?? supplyTypes(TENANT)), ...supplyTypes(OTHER_TENANT)],
      // A supplier the workbook names: still nothing is written for it.
      suppliers: [{ id: ALPHA, tenant_id: TENANT, name: "Fournisseur Alpha", is_active: true }],
      products: EXISTING_PRODUCTS(),
      supplier_catalog_items: [],
      supplier_pricebook: [],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Answer = {
  status: number;
  data?: CostingWorkbookImportReport;
  error?: { code: string; message: string; details?: unknown };
};

async function send(body: unknown, init: { raw?: string } = {}): Promise<Answer> {
  const response = await POST(new Request("http://localhost/api/catalogue/workbook-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: init.raw ?? JSON.stringify(body),
  }));
  const payload = (await response.json()) as { data?: CostingWorkbookImportReport; error?: Answer["error"] };
  return { status: response.status, data: payload.data, error: payload.error };
}

const importSheet = (rows: unknown, confirm: boolean) => send({ rows, confirm });

const SEEDED_IDS = new Set([PLAIN, PREFIXED, ARCHIVED, FOREIGN_PRODUCT]);
const draftsOf = (fake: ReturnType<typeof seed>) =>
  new Map(fake.tables.products.filter((entry) => !SEEDED_IDS.has(String(entry.id))).map((entry) => [entry.reference, entry]));

function generatedSheet(count: number) {
  return [
    HEADERS,
    ...Array.from({ length: count }, (_, index) => article({
      "ID": `Gen.${index + 1}`, "Caractéristique": "Coude 90°", "Matériau": "Inox 316L serti", "Type FO": "I6L",
      "PR. FO": index + 1, "F1_nom": "Fournisseur Alpha", "F1_ref": `ALPHA-${index + 1}`,
    })),
  ];
}

const productInsertsOf = (fake: ReturnType<typeof seed>) =>
  fake.writes.filter((write) => write.table === "products" && write.operation === "insert");

describe("POST /api/catalogue/workbook-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews the import with its counts and writes nothing (2, 7, 8)", async () => {
    const fake = seed(ADMIN, "admin");

    const answer = await importSheet(SHEET, false);

    expect(answer.status).toBe(200);
    expect(answer.data).toEqual({ confirmed: false, ...SHEET_REPORT });
    expect(fake.writes).toEqual([]);
  });

  it("creates the new articles as drafts with the workbook's values, and nothing of their suppliers (3, 6, 7)", async () => {
    const fake = seed(ADMIN, "admin");

    const answer = await importSheet(SHEET, true);

    expect(answer.status).toBe(200);
    expect(answer.data).toEqual({ confirmed: true, ...SHEET_REPORT });
    const drafts = draftsOf(fake);
    expect([...drafts.keys()]).toEqual(["Tub.X4so.25", "Van.X.50", "Coq.K.25", "Div.1"]);
    const common = { tenant_id: TENANT, catalogue_status: "draft", is_active: true, created_from_material_request: false, created_by: ADMIN };
    expect(drafts.get("Tub.X4so.25")).toMatchObject({
      ...common, designation: "Tube — Inox 304L soudé DN25", product_type: "Tube", material: "Inox 304L soudé",
      grade: "304L", dimensions: "DN25", standard: "EN 10217-7", category: "Tuyauterie", unit: "ml",
      unit_price_cents: 1259, reliability_score: 8, supply_type_id: supplyTypeId(TENANT, "tube"),
    });
    expect(drafts.get("Van.X.50")).toMatchObject({
      ...common, designation: "Vanne à boisseau sphérique DN50", category: "Robinetterie", unit: "u",
      unit_price_cents: 4510, reliability_score: 6, supply_type_id: supplyTypeId(TENANT, "vanne"),
    });
    expect(drafts.get("Coq.K.25")).toMatchObject({
      ...common, category: "Autres", unit: "ml", unit_price_cents: 0, reliability_score: null,
      supply_type_id: supplyTypeId(TENANT, "calorifuge"),
    });
    expect(drafts.get("Div.1")).toMatchObject({
      ...common, designation: "Vase expansion à membrane", category: "Autres", unit: "u", reliability_score: 3,
      supply_type_id: supplyTypeId(TENANT, "divers"),
    });

    // One statement of drafts; no supplier, supplier reference, price or supply type is read or written.
    expect(fake.events).toEqual(["insert products"]);
    expect(fake.reads.filter((table) => table.startsWith("supplier"))).toEqual([]);
    expect([fake.tables.supplier_catalog_items, fake.tables.supplier_pricebook]).toEqual([[], []]);
  });

  it("skips an article already in the catalogue, whatever its status or prefix, and leaves it unchanged (4, 8)", async () => {
    const fake = seed(ADMIN, "admin");

    await importSheet(SHEET, true);

    expect(fake.tables.products.filter((entry) => SEEDED_IDS.has(String(entry.id)))).toEqual(EXISTING_PRODUCTS());
    expect(fake.writes.every((write) => write.operation === "insert")).toBe(true);
    // The valve of another company does not hide the company's own new valve.
    expect(draftsOf(fake).get("Van.X.50")).toMatchObject({ tenant_id: TENANT });
  });

  it("creates nothing when the same workbook is imported again (5)", async () => {
    const fake = seed(ADMIN, "admin");
    await importSheet(SHEET, true);
    const writes = fake.writes.length;

    const again = await importSheet(SHEET, true);

    expect(again.status).toBe(200);
    expect(again.data).toEqual({
      ...SHEET_REPORT, confirmed: true, new_articles: 0, already_in_catalogue: 7, supplier_references_not_imported: 0,
    });
    expect(fake.writes).toHaveLength(writes);
  });

  it("leaves a draft without supply type when the company has none with its code, and counts it (6)", async () => {
    const fake = seed(ADMIN, "admin", { supplyTypes: supplyTypes(TENANT, ["tube", "raccord", "vanne", "robinetterie", "support"]) });

    const answer = await importSheet(SHEET, true);

    expect(answer.data).toMatchObject({ new_articles: 4, without_supply_type: 2 });
    const drafts = draftsOf(fake);
    expect([drafts.get("Coq.K.25")?.supply_type_id, drafts.get("Div.1")?.supply_type_id]).toEqual([null, null]);
    expect(fake.tables.supply_types).toHaveLength(5 + SUPPLY_KINDS.length);
  });

  it("lets an engineer import, as the author of the drafts (1)", async () => {
    const fake = seed(ENGINEER, "engineer");

    const answer = await importSheet(SHEET, true);

    expect(answer.status).toBe(200);
    expect([...draftsOf(fake).values()].map((entry) => entry.created_by)).toEqual([ENGINEER, ENGINEER, ENGINEER, ENGINEER]);
  });

  it.each([
    ["viewer", false, VIEWER],
    ["viewer", true, VIEWER],
    ["director", true, DIRECTOR],
  ] as const)("refuses a %s, who may not add articles (confirm: %s), and writes nothing (1)", async (role, confirm, actor) => {
    const fake = seed(actor, role);

    const answer = await importSheet(SHEET, confirm);

    expect(answer.status).toBe(403);
    expect(answer.error?.message).toBe(PRODUCT_WRITE_REFUSAL);
    expect(fake.writes).toEqual([]);
  });

  it("refuses a sheet of another shape with the reader's sentence, and writes nothing (9)", async () => {
    const fake = seed(ADMIN, "admin");

    const answer = await importSheet([["Référence", "Désignation", "Prix"], ["A", "B", 1]], true);

    expect(answer.status).toBe(422);
    expect(answer.error).toMatchObject({
      code: COSTING_WORKBOOK_FORMAT,
      message: "Ce fichier n’a pas les colonnes du classeur de chiffrage (onglet « All_data ») : ID, Caractéristique, Matériau, Type_ligne manquantes.",
    });
    expect(fake.writes).toEqual([]);
  });

  it.each([
    ["no row", { rows: [], confirm: true }],
    ["no confirmation", { rows: SHEET }],
    ["a confirmation that is not a boolean", { rows: SHEET, confirm: "oui" }],
    ["a key outside the contract", { rows: SHEET, confirm: true, tenant_id: TENANT }],
    ["a cell that is an object", { rows: [[{ formula: "=A1" }]], confirm: true }],
    ["a row of more than 60 cells", { rows: [Array.from({ length: 61 }, () => null)], confirm: true }],
  ])("answers 400 to a body with %s, before any read (9)", async (_label, body) => {
    const fake = seed(ADMIN, "admin");

    const answer = await send(body);

    expect(answer.status).toBe(400);
    expect(fake.reads).toEqual([]);
  });

  it("answers 400 to a body that is not JSON, and 413 to one above the limit, before any read (9)", async () => {
    const fake = seed(ADMIN, "admin");

    expect((await send(null, { raw: "{\"rows\": [" })).status).toBe(400);
    const tooLarge = await send(null, { raw: " ".repeat(COSTING_WORKBOOK_MAX_BODY_BYTES + 1) });
    expect(tooLarge.status).toBe(413);
    expect(fake.reads).toEqual([]);
  });

  it("writes 1,001 drafts in chunks of 500, one statement each (11)", async () => {
    const fake = seed(ADMIN, "admin");

    const answer = await importSheet(generatedSheet(1001), true);

    expect(answer.data).toMatchObject({ confirmed: true, articles: 1001, new_articles: 1001, supplier_references_not_imported: 1001 });
    expect(productInsertsOf(fake).map((write) => write.ids.length)).toEqual([500, 500, 1]);
    expect(fake.events).toEqual(["insert products", "insert products", "insert products"]);
    const drafts = draftsOf(fake);
    expect(drafts.size).toBe(1001);
    expect([1, 500, 501, 1000, 1001].map((index) => drafts.get(`Gen.${index}`)?.unit_price_cents)).toEqual(
      [100, 50000, 50100, 100000, 100100],
    );
  });

  it("stops at a refused chunk, says what the earlier chunks created, and a re-run creates the rest (10)", async () => {
    let productInserts = 0;
    const fake = seed(ADMIN, "admin", {
      refuseInsert: (table) => table === "products" && ++productInserts === 2 ? "chunk refused" : false,
    });

    const stopped = await importSheet(generatedSheet(1001), true);

    expect(stopped.status).toBe(400);
    expect(stopped.error?.code).toBe(COSTING_WORKBOOK_IMPORT_INCOMPLETE);
    expect(stopped.error?.message).toBe(
      `L’import s’est arrêté : ${(500).toLocaleString("fr-FR")} brouillons créés sur ${(1001).toLocaleString("fr-FR")}. `
      + "Relancez l’import du même classeur : il ne crée que les articles qui manquent encore au catalogue.",
    );
    expect((stopped.error?.details as CostingWorkbookImportIncompleteDetails).report).toMatchObject({
      confirmed: true, articles: 1001, new_articles: 500, already_in_catalogue: 0, supplier_references_not_imported: 500,
    });
    // The refused chunk wrote nothing; the third was never sent.
    expect([draftsOf(fake).size, productInserts]).toEqual([500, 2]);

    const rerun = await importSheet(generatedSheet(1001), true);

    expect(rerun.data).toMatchObject({ new_articles: 501, already_in_catalogue: 500 });
    expect(draftsOf(fake).size).toBe(1001);
  });

  it("says so when an article of the workbook was added meanwhile, and a re-run skips it (10)", async () => {
    let tables: Record<string, FakeRow[]> | null = null;
    const fake = seed(ADMIN, "admin", {
      // Another member adds one of the new references between the import's read and its write.
      refuseInsert: (table) => {
        if (table === "products" && tables && !tables.products.some((entry) => entry.id === "concurrent")) {
          tables.products.push(existingProduct("concurrent", { reference: "TUB.X4SO.25" }));
        }
        return false;
      },
    });
    tables = fake.tables;

    const answer = await importSheet(SHEET, true);

    expect(answer.status).toBe(409);
    expect(answer.error?.message).toBe(
      "Un article de ce classeur vient d’être ajouté au catalogue : relancez l’import, il ignore les articles déjà présents.",
    );
    expect(fake.tables.products.filter((entry) => entry.tenant_id === TENANT)).toHaveLength(4);

    const rerun = await importSheet(SHEET, true);

    expect(rerun.data).toMatchObject({ new_articles: 3, already_in_catalogue: 4 });
  });

  it("answers the database's refusal when the first chunk fails, with nothing created (10)", async () => {
    const fake = seed(ADMIN, "admin", { refuseInsert: (table) => table === "products" ? "chunk refused" : false });

    const answer = await importSheet(SHEET, true);

    expect(answer.status).toBe(400);
    expect(answer.error?.code).not.toBe(COSTING_WORKBOOK_IMPORT_INCOMPLETE);
    expect(draftsOf(fake).size).toBe(0);
  });

  it("reports the first 100 issues in sheet order, and counts them all (12)", async () => {
    seed(ADMIN, "admin");
    const rows = [HEADERS, ...Array.from({ length: 150 }, (_, index) => article({ "ID": `Sans.${index + 1}`, "Caractéristique": "" }))];

    const answer = await importSheet(rows, false);

    expect(answer.data?.issue_count).toBe(150);
    expect(answer.data?.issues).toHaveLength(100);
    expect([answer.data?.issues[0], answer.data?.issues[99]]).toEqual([
      { row: 2, reference: "Sans.1", message: "Ligne sans caractéristique : ignorée." },
      { row: 101, reference: "Sans.100", message: "Ligne sans caractéristique : ignorée." },
    ]);
  });
});
