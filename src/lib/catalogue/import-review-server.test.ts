import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  bulkUpdateProducts,
  createSupplierAlias,
  deleteSupplierAlias,
  listCatalogueImportBatches,
  listPendingSupplierReferences,
  reviewSupplierReferences,
  undoCatalogueImportBatch,
} from "@/lib/catalogue/import-review-server";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { createFakeSupabase, fakeMembership, type FakeRow, type FakeRpcHandler } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of what follows an import of the costing workbook (TI-711), written before the screens. The
 * database functions are proved by pgTAP (workbook-import-review.test.sql); here they answer what the test
 * gives them. Companies, suppliers and articles are invented.
 *  1. A member who may not add to the catalogue (viewer) reaches a write.
 *  2. A workbook name is associated to a supplier of another company or an archived one; asking twice for the
 *     same pair is refused instead of answered; a name already given to another supplier is given again.
 *  3. A review of « every reference of this supplier » also reviews another supplier's or another company's,
 *     or a reference already checked; a refusal of the database is lost.
 *  4. Validating the drafts of an import also validates another import's, or articles already validated; the
 *     database's « administrators only » comes back as a bare error.
 *  5. An undo stops after its first page, or loops for ever on rows the database keeps.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const VIEWER = "20000000-0000-4000-8000-000000000003";
const ATLAS = "40000000-0000-4000-8000-000000000001";
const BOREAL = "40000000-0000-4000-8000-000000000002";
const ARCHIVED_SUPPLIER = "40000000-0000-4000-8000-000000000003";
const FOREIGN_SUPPLIER = "40000000-0000-4000-8000-000000000009";
const BATCH = "b0000000-0000-4000-8000-000000000001";
const OTHER_BATCH = "b0000000-0000-4000-8000-000000000002";
const SUPPLY_TYPE = "a0000000-0000-4000-8000-000000000001";

const uuid = (prefix: string, index: number) => `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const selectionOf = (indices: number[]) =>
  createHash("sha256").update(indices.map((index) => uuid("5", index)).toSorted().join("\n")).digest("hex");
const supplier = (id: string, name: string, extra: FakeRow = {}): FakeRow => ({ id, tenant_id: TENANT, name, is_active: true, ...extra });
const item = (index: number, supplierId: string, extra: FakeRow = {}): FakeRow => ({
  id: uuid("5", index), tenant_id: TENANT, supplier_id: supplierId, product_id: uuid("9", index), supplier_sku: `SKU-${index}`,
  reference_needs_review: true, is_active: false, import_batch_id: BATCH, created_at: "2026-11-25T11:00:00.000Z",
  products: { reference: `REF-${index}`, designation: `Tube de démonstration ${index}`, created_by: ADMIN },
  suppliers: { name: "Négoce de démonstration" },
  ...extra,
});
const product = (index: number, extra: FakeRow = {}): FakeRow => ({
  id: uuid("9", index), tenant_id: TENANT, reference: `REF-${index}`, catalogue_status: "draft", import_batch_id: BATCH, ...extra,
});

function seed(role: "admin" | "viewer" | "engineer", options: { rpc?: Record<string, FakeRpcHandler>; refuseInsert?: boolean; aliases?: FakeRow[] } = {}) {
  const actor = role === "admin" ? ADMIN : VIEWER;
  const fake = createFakeSupabase({
    userId: actor,
    rpc: options.rpc,
    refuseInsert: options.refuseInsert ? () => ({ code: "23505", message: "duplicate key value violates unique constraint" }) : undefined,
    tables: {
      tenant_memberships: [fakeMembership(actor, TENANT, role)],
      suppliers: [
        supplier(ATLAS, "Comptoir Atlas"), supplier(BOREAL, "Dépôt Boréal"),
        supplier(ARCHIVED_SUPPLIER, "Ancien Négoce", { is_active: false }),
        supplier(FOREIGN_SUPPLIER, "Comptoir d’ailleurs", { tenant_id: OTHER_TENANT }),
      ],
      supplier_aliases: options.aliases ?? [],
      supplier_catalog_items: [
        item(1, ATLAS), item(2, ATLAS), item(3, BOREAL),
        item(4, ATLAS, { reference_needs_review: false, is_active: true }),
        item(5, ATLAS, { tenant_id: OTHER_TENANT }),
      ],
      products: [
        product(1), product(2), product(3, { catalogue_status: "validated" }),
        product(4, { import_batch_id: OTHER_BATCH }), product(5, { tenant_id: OTHER_TENANT }),
      ],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

describe("supplier aliases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("remembers a workbook name for an active supplier of the company only (1, 2)", async () => {
    const fake = seed("admin");
    const { item: alias } = await createSupplierAlias({ supplier_id: ATLAS, alias: "  Cptoir ATLAS " });
    expect(alias).toMatchObject({ supplier_id: ATLAS, supplier_name: "Comptoir Atlas", alias: "  Cptoir ATLAS " });
    expect(fake.tables.supplier_aliases).toMatchObject([{ tenant_id: TENANT, supplier_id: ATLAS, alias_key: "cptoir atlas" }]);

    await expect(createSupplierAlias({ supplier_id: FOREIGN_SUPPLIER, alias: "Atlas" })).rejects.toMatchObject({ status: 404 });
    await expect(createSupplierAlias({ supplier_id: ARCHIVED_SUPPLIER, alias: "Atlas" })).rejects.toMatchObject({ status: 404 });
    expect(fake.tables.supplier_aliases).toHaveLength(1);

    seed("viewer");
    await expect(createSupplierAlias({ supplier_id: ATLAS, alias: "Atlas" })).rejects.toMatchObject({ status: 403, message: PRODUCT_WRITE_REFUSAL });
    await expect(deleteSupplierAlias(uuid("6", 1))).rejects.toMatchObject({ status: 403 });
  });

  it("answers the association it already holds, and refuses a name given to another supplier (2)", async () => {
    const held = { id: uuid("6", 1), tenant_id: TENANT, supplier_id: ATLAS, alias: "Cptoir Atlas", alias_key: "cptoir atlas", created_at: "2026-11-25T10:00:00.000Z" };
    seed("admin", { refuseInsert: true, aliases: [held] });
    expect((await createSupplierAlias({ supplier_id: ATLAS, alias: "CPTOIR atlas" })).item).toMatchObject({ id: held.id, supplier_name: "Comptoir Atlas" });
    await expect(createSupplierAlias({ supplier_id: BOREAL, alias: "Cptoir Atlas" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("listPendingSupplierReferences", () => {
  it("uses the IDs already queried when the whole selection fits on one page", async () => {
    const fake = seed("admin");
    const page = await listPendingSupplierReferences({ page: 1, size: 25, supplier_id: ATLAS });
    expect(page.selection_signature).toBe(selectionOf([1, 2]));
    expect(page.items.map((row) => row.id)).toEqual([uuid("5", 1), uuid("5", 2)]);
    expect(fake.reads.filter((table) => table === "supplier_catalog_items")).toHaveLength(1);
  });

  it("covers every page of the filter with a stable signature", async () => {
    const fake = seed("admin");
    const indices = Array.from({ length: 31 }, (_, index) => index + 1);
    fake.tables.supplier_catalog_items = indices.toReversed().map((index) => item(index, ATLAS));
    const page = await listPendingSupplierReferences({ page: 2, size: 25 });
    expect(page.items).toHaveLength(6);
    expect(page.selection_signature).toBe(selectionOf(indices));
    expect(fake.reads.filter((table) => table === "supplier_catalog_items")).toHaveLength(2);
  });

  it("keeps the page readable without an approval signature if a displayed row no longer matches", async () => {
    const fake = seed("admin");
    fake.tables.supplier_catalog_items = Array.from({ length: 31 }, (_, index) => item(index + 1, ATLAS));
    const from = fake.supabase.from;
    let queueReads = 0;
    vi.spyOn(fake.supabase, "from").mockImplementation((table) => {
      if (table === "supplier_catalog_items" && ++queueReads === 2) fake.tables.supplier_catalog_items[0] = item(32, ATLAS);
      return from(table);
    });
    const page = await listPendingSupplierReferences({ page: 1, size: 25 });
    expect(page.items[0]?.id).toBe(uuid("5", 1));
    expect(page.pagination.totalItems).toBe(31);
    expect(page.selection_signature).toBeNull();
  });

  it("keeps the page readable if the additional ID scan fails", async () => {
    const fake = seed("admin");
    fake.tables.supplier_catalog_items = Array.from({ length: 31 }, (_, index) => item(index + 1, ATLAS));
    const from = fake.supabase.from;
    let queueReads = 0;
    vi.spyOn(fake.supabase, "from").mockImplementation((table) => {
      if (table === "supplier_catalog_items" && ++queueReads === 2) throw new Error("Lecture incomplète.");
      return from(table);
    });
    const page = await listPendingSupplierReferences({ page: 1, size: 25 });
    expect(page.items).toHaveLength(25);
    expect(page.pagination.totalItems).toBe(31);
    expect(page.selection_signature).toBeNull();
  });
});

describe("reviewSupplierReferences", () => {
  beforeEach(() => vi.clearAllMocks());
  const review: FakeRpcHandler = (args) => ({ data: { reviewed: (args.p_item_ids as string[]).length - 1, skipped: 1 } });

  it("reviews the references named, or every pending one of the company the filter matches (3)", async () => {
    const fake = seed("admin", { rpc: { review_supplier_references: review } });
    expect(await reviewSupplierReferences({ action: "withdraw", ids: [uuid("5", 1), uuid("5", 3)] })).toEqual({ reviewed: 1, skipped: 1 });
    expect(fake.rpcArgs.at(-1)).toEqual({ name: "review_supplier_references", args: { p_item_ids: [uuid("5", 1), uuid("5", 3)], p_validate: false } });

    // Atlas only: neither Boréal's, nor the one already checked, nor the other company's.
    await reviewSupplierReferences({ action: "validate", filter: { supplier_id: ATLAS }, expected_count: 2, expected_selection: selectionOf([1, 2]) });
    expect(fake.rpcArgs.at(-1)?.args).toEqual({ p_item_ids: [uuid("5", 1), uuid("5", 2)], p_validate: true });
    // The whole queue with an empty filter; nothing to review asks nothing of the database.
    await reviewSupplierReferences({ action: "validate", filter: {}, expected_count: 3, expected_selection: selectionOf([1, 2, 3]) });
    expect(fake.rpcArgs.at(-1)?.args.p_item_ids).toEqual([uuid("5", 1), uuid("5", 2), uuid("5", 3)]);
    const calls = fake.rpcCalls.length;
    expect(await reviewSupplierReferences({
      action: "validate", filter: { import_batch_id: OTHER_BATCH }, expected_count: 0, expected_selection: selectionOf([]),
    })).toEqual({ reviewed: 0, skipped: 0 });
    expect(fake.rpcCalls).toHaveLength(calls);
  });

  it("rejects a filter whose pending count changed since confirmation", async () => {
    const fake = seed("admin", { rpc: { review_supplier_references: review } });
    const confirmed = { action: "validate" as const, filter: {}, expected_count: 2, expected_selection: selectionOf([1, 2]) };
    await expect(reviewSupplierReferences(confirmed)).rejects.toMatchObject({ status: 409 });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a replacement at the same count before writing any reference", async () => {
    const fake = seed("admin", { rpc: { review_supplier_references: review } });
    const confirmed = {
      action: "validate" as const,
      filter: {},
      expected_count: 3,
      expected_selection: selectionOf([1, 2, 3]),
    };
    fake.tables.supplier_catalog_items[0] = item(6, ATLAS);
    await expect(reviewSupplierReferences(confirmed)).rejects.toMatchObject({ status: 409 });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a previously opened page that sends only the count", async () => {
    const fake = seed("admin", { rpc: { review_supplier_references: review } });
    await expect(reviewSupplierReferences({ action: "validate", filter: {}, expected_count: 3 })).rejects.toMatchObject({ status: 409 });
    expect(fake.reads).not.toContain("supplier_catalog_items");
    expect(fake.rpcCalls).toEqual([]);
  });

  it("returns committed reference counts if the next chunk is refused", async () => {
    let calls = 0;
    const fake = seed("admin", { rpc: { review_supplier_references: () => ++calls === 1
      ? { data: { reviewed: 4999, skipped: 1 } }
      : { data: null, error: { code: "42501", message: "SUPPLIER_CATALOG_ITEM_EDITORS_ONLY" } } } });
    const indices = Array.from({ length: 5001 }, (_, index) => index + 1);
    fake.tables.supplier_catalog_items = indices.map((index) => item(index, ATLAS));
    await expect(reviewSupplierReferences({
      action: "validate", filter: {}, expected_count: indices.length, expected_selection: selectionOf(indices),
    })).rejects.toMatchObject({
      status: 403, details: { committed: { reviewed: 4999, skipped: 1 } },
    });
    expect(fake.rpcCalls).toHaveLength(2);
  });

  it("refuses a viewer before any read, and words the database's refusal (1, 3)", async () => {
    const viewer = seed("viewer", { rpc: { review_supplier_references: review } });
    await expect(reviewSupplierReferences({ action: "validate", filter: {}, expected_count: 3 })).rejects.toMatchObject({ status: 403 });
    expect([viewer.rpcCalls, viewer.reads.filter((table) => table !== "tenant_memberships")]).toEqual([[], []]);

    seed("admin", { rpc: { review_supplier_references: () => ({ data: null, error: { code: "42501", message: "SUPPLIER_CATALOG_ITEM_EDITORS_ONLY" } }) } });
    await expect(reviewSupplierReferences({ action: "validate", ids: [uuid("5", 1)] })).rejects.toMatchObject({ status: 403, message: PRODUCT_WRITE_REFUSAL });
  });
});

describe("bulkUpdateProducts", () => {
  beforeEach(() => vi.clearAllMocks());
  const validate: FakeRpcHandler = (args) => ({ data: { validated: (args.p_product_ids as string[]).length, incomplete: 0, skipped: 0 } });

  it("validates the drafts of one import of the company, and gives a supply type to the articles named (4)", async () => {
    const fake = seed("admin", { rpc: { validate_draft_products: validate, assign_products_supply_type: () => ({ data: 2 }) } });
    expect(await bulkUpdateProducts({ action: "validate", import_batch_id: BATCH })).toEqual({ action: "validate", validated: 2, incomplete: 0, skipped: 0 });
    // The two drafts of the import: not its validated article, not another import's, not another company's.
    expect(fake.rpcArgs.at(-1)?.args).toEqual({ p_product_ids: [uuid("9", 1), uuid("9", 2)] });

    const ids = [uuid("9", 1), uuid("9", 4)];
    expect(await bulkUpdateProducts({ action: "assign-supply-type", ids, supply_type_id: SUPPLY_TYPE })).toEqual({ action: "assign-supply-type", updated: 2 });
    expect(fake.rpcArgs.at(-1)).toEqual({ name: "assign_products_supply_type", args: { p_product_ids: ids, p_supply_type_id: SUPPLY_TYPE } });
  });

  it("edits 1 000 articles per statement at most, far from the API roles' statement timeout (4)", async () => {
    const fake = seed("admin", { rpc: { validate_draft_products: validate, assign_products_supply_type: (args) => ({ data: (args.p_product_ids as string[]).length }) } });
    const ids = Array.from({ length: 2001 }, (_, index) => uuid("9", index + 1));

    expect(await bulkUpdateProducts({ action: "validate", ids })).toMatchObject({ validated: 2001 });
    expect(await bulkUpdateProducts({ action: "assign-supply-type", ids, supply_type_id: SUPPLY_TYPE })).toEqual({ action: "assign-supply-type", updated: 2001 });
    expect(fake.rpcArgs.map(({ name, args }) => [name, (args.p_product_ids as string[]).length])).toEqual([
      ["validate_draft_products", 1000], ["validate_draft_products", 1000], ["validate_draft_products", 1],
      ["assign_products_supply_type", 1000], ["assign_products_supply_type", 1000], ["assign_products_supply_type", 1],
    ]);
  });

  it("rejects an engineer before reading even an empty batch", async () => {
    const fake = seed("engineer");
    await expect(bulkUpdateProducts({ action: "validate", import_batch_id: BATCH })).rejects.toMatchObject({ status: 403 });
    expect(fake.reads).not.toContain("products");
  });

  it("returns the committed validation counts with a later refusal", async () => {
    let calls = 0;
    seed("admin", { rpc: { validate_draft_products: () => ++calls === 1
      ? { data: { validated: 980, incomplete: 15, skipped: 5 } }
      : { data: null, error: { code: "42501", message: "PRODUCT_VALIDATION_ADMIN_ONLY" } } } });
    const ids = Array.from({ length: 1001 }, (_, index) => uuid("9", index + 1));
    await expect(bulkUpdateProducts({ action: "validate", ids })).rejects.toMatchObject({
      status: 403, details: { committed: { action: "validate", validated: 980, incomplete: 15, skipped: 5 } },
    });
  });

  it("says in words that validating is an administrator's act, and that a supply type is not the company's (4)", async () => {
    seed("admin", { rpc: {
      validate_draft_products: () => ({ data: null, error: { code: "42501", message: "PRODUCT_VALIDATION_ADMIN_ONLY" } }),
      assign_products_supply_type: () => ({ data: null, error: { code: "23514", message: "PRODUCT_SUPPLY_TYPE_INVALID" } }),
    } });
    await expect(bulkUpdateProducts({ action: "validate", ids: [uuid("9", 1)] })).rejects.toMatchObject({
      status: 403, message: "La validation d’un article en brouillon est réservée aux administrateurs.",
    });
    await expect(bulkUpdateProducts({ action: "assign-supply-type", ids: [uuid("9", 1)], supply_type_id: SUPPLY_TYPE })).rejects.toMatchObject({
      status: 400, message: "Ce type de fourniture n’existe pas dans votre référentiel.",
    });
  });
});

describe("undoCatalogueImportBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("walks the import page after page until the database says it is done (5)", async () => {
    const pages = [
      { deleted: 500, kept: 0, done: false },
      { deleted: 120, kept: 3, done: true },
    ];
    const fake = seed("admin", { rpc: { undo_catalogue_import_batch: () => ({ data: pages.shift() }) } });
    expect(await undoCatalogueImportBatch(BATCH)).toEqual({ deleted: 620, kept: 3 });
    expect(fake.rpcArgs.map(({ args }) => args)).toEqual([
      { p_batch_id: BATCH, p_limit: 500 },
      { p_batch_id: BATCH, p_limit: 500 },
    ]);
  });

  it("stops with what it removed when the database never finishes, and words its refusals (1, 5)", async () => {
    const endless = seed("admin", { rpc: { undo_catalogue_import_batch: () => ({ data: { deleted: 1, kept: 0, done: false } }) } });
    await expect(undoCatalogueImportBatch(BATCH)).rejects.toMatchObject({
      status: 409, message: "L’annulation est en cours : 40 éléments retirés. Relancez-la pour la terminer.",
    });
    expect(endless.rpcCalls).toHaveLength(40);

    seed("admin", { rpc: { undo_catalogue_import_batch: () => ({ data: null, error: { code: "P0002", message: "CATALOGUE_IMPORT_BATCH_NOT_FOUND" } }) } });
    await expect(undoCatalogueImportBatch(BATCH)).rejects.toMatchObject({ status: 404 });
    seed("admin", { rpc: { undo_catalogue_import_batch: () => ({ data: null, error: { code: "42501", message: "CATALOGUE_IMPORT_UNDO_FORBIDDEN" } }) } });
    await expect(undoCatalogueImportBatch(BATCH)).rejects.toMatchObject({ status: 403 });
    const viewer = seed("viewer", { rpc: { undo_catalogue_import_batch: () => ({ data: { deleted: 0, kept: 0, done: true } }) } });
    await expect(undoCatalogueImportBatch(BATCH)).rejects.toMatchObject({ status: 403 });
    expect(viewer.rpcCalls).toEqual([]);
  });

  it("lists a started undo as resumable until the batch is marked undone", async () => {
    const fake = seed("admin");
    fake.tables.products = [];
    const createdAt = "2026-11-25T10:00:00.000Z";
    const startedAt = "2026-11-25T11:00:00.000Z";
    fake.tables.catalogue_import_batches = [
      { id: BATCH, tenant_id: TENANT, kind: "workbook_articles", source_name: null, created_at: createdAt,
        created_by: ADMIN, undo_started_at: startedAt, undone_at: null },
      { id: OTHER_BATCH, tenant_id: TENANT, kind: "workbook_articles", source_name: null, created_at: createdAt,
        created_by: ADMIN, undo_started_at: startedAt, undone_at: startedAt },
    ];

    const { items } = await listCatalogueImportBatches();

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: BATCH, undo_started_at: startedAt, undone_at: null, total: 0, open: 0, can_undo: true }),
      expect.objectContaining({ id: OTHER_BATCH, undo_started_at: startedAt, undone_at: startedAt, can_undo: false }),
    ]));
  });
});
