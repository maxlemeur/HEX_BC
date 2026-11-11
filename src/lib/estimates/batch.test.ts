import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Retained orchestration coverage adapted BEFORE the atomic batch implementation.
// Read doubles exercise the real prospective preparer. They do not establish SQL
// rollback, RLS, concurrency, audit durability, or receipt integrity: native/E2E do.
vi.mock("@/lib/estimates/server-context", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/estimates/server-context")>(),
  getAuthenticatedContext: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({
    "x-estimate-draft-lock-session-id": "99999999-9999-4999-8999-999999999999",
  })),
}));

import { executeEstimateBatch } from "@/lib/estimates/batch";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import { getAuthenticatedContext } from "@/lib/estimates/server-context";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "44444444-4444-4444-8444-444444444444";
const CHILD_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "66666666-6666-4666-8666-666666666666";
const ACTOR_ID = "77777777-7777-4777-8777-777777777777";
const PROJECT_ID = "88888888-8888-4888-8888-888888888888";
const SESSION_ID = "99999999-9999-4999-8999-999999999999";
const OPERATION_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";
const OPTIONS = { concurrencyToken: UPDATED_AT, operationKey: OPERATION_KEY };
type Row = Record<string, unknown>;

function line(id = ITEM_ID, position = 1): Row {
  return {
    id, tenant_id: TENANT_ID, version_id: VERSION_ID, parent_id: SECTION_ID,
    item_type: "line", position, title: "Ligne", description: "Description", aid: null,
    quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1,
    h_mo: 0, h_mo_majoration: 1, k_mo: 1, labor_role_id: null,
    h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
    h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
    category_id: null, supply_type_id: null, product_id: null,
    selected_supplier_price_id: null, line_nature: "supply_only",
    pu_ht_cents: 1000, line_total_ht_cents: 1000, line_tax_cents: 200,
    line_total_ttc_cents: 1200, source_provider: "manual", source_job_id: null,
    source_file_name: null, source_page: null, source_metadata: {},
    created_at: UPDATED_AT, updated_at: UPDATED_AT,
    snapshot_pu_ht_cents: null, snapshot_fo_ht_cents: null, snapshot_mo_ht_cents: null,
    snapshot_mo_atelier_ht_cents: null, snapshot_mo_chantier_ht_cents: null,
  };
}

function section(): Row {
  return {
    ...line(SECTION_ID), parent_id: null, item_type: "section", title: "Section",
    description: null, quantity: null, unit_price_ht_cents: null, tax_rate_bp: null,
    k_fo: null, h_mo: null, h_mo_majoration: null, k_mo: null, line_nature: null,
    pu_ht_cents: null, line_total_ht_cents: null, line_tax_cents: null,
    line_total_ttc_cents: null,
  };
}

function readOnlyDatabase() {
  const project = {
    id: PROJECT_ID, tenant_id: TENANT_ID, user_id: ACTOR_ID, is_archived: false,
    name: "Test", reference: null, estimate_reference: null, site_address: null,
    client_name: null, notes: null,
  };
  const version = {
    id: VERSION_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID, status: "draft",
    updated_at: UPDATED_AT, content_revision: 0, max_section_depth: 1,
    margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
    discount_bp: 0, discount_mode: "simple", discount_steps: [], global_coefficient: 1,
    rounding_mode: "none", rounding_step_cents: null, calc_engine_version: 2,
    contractor_role: "principal", total_ht_cents: 1000, total_tax_cents: 200,
    total_ttc_cents: 1200, calc_snapshot_context: null,
    calc_snapshot_content_revision: null, estimate_projects: project,
  };
  const rows: Record<string, Row[]> = {
    estimate_versions: [version], estimate_projects: [project],
    estimate_items: [section(), line()],
    draft_locks: [{ id: SESSION_ID, tenant_id: TENANT_ID, version_id: VERSION_ID,
      user_id: ACTOR_ID, session_id: SESSION_ID, locked_at: UPDATED_AT,
      expires_at: "2099-01-01T00:00:00.000Z" }],
    margin_tiers: [], feature_flags: [], labor_roles: [], estimate_categories: [],
    supply_types: [], products: [], supplier_pricebook: [],
  };
  const forbiddenWrite = vi.fn(() => { throw new Error("Unexpected direct write"); });
  const commit = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();
  const rpc = vi.fn(async (name: string, input: Record<string, unknown>) => {
    if (name === "get_estimate_batch_receipt") return { data: null, error: null };
    if (name === "commit_estimate_batch") return commit(input);
    throw new Error(`Unexpected RPC ${name}`);
  });
  const from = vi.fn((table: string) => {
    if (!(table in rows)) throw new Error(`Unexpected read ${table}`);
    const filters: Array<(row: Row) => boolean> = [];
    let start = 0;
    let end = Number.MAX_SAFE_INTEGER;
    let one = false;
    let required = false;
    const ordering: Array<{ column: string; ascending: boolean }> = [];
    const response = () => {
      let found = rows[table].filter((row) => filters.every((filter) => filter(row)));
      found = [...found].sort((a, b) => {
        for (const order of ordering) {
          const left = a[order.column];
          const right = b[order.column];
          const delta = typeof left === "number" && typeof right === "number"
            ? left - right : String(left).localeCompare(String(right));
          if (delta !== 0) return order.ascending ? delta : -delta;
        }
        return 0;
      }).slice(start, end + 1);
      return { data: structuredClone(one ? found[0] ?? null : found),
        error: required && found.length !== 1
          ? { code: "PGRST116", message: "Missing row" } : null };
    };
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      is: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query; },
      gt: (column: string, value: string) => { filters.push((row) => String(row[column]) > value); return query; },
      order: (column: string, options?: { ascending?: boolean }) => {
        ordering.push({ column, ascending: options?.ascending !== false }); return query;
      },
      range: (first: number, last: number) => { start = first; end = last; return query; },
      limit: (count: number) => { end = count - 1; return query; },
      single: () => { one = true; required = true; return Promise.resolve(response()); },
      maybeSingle: () => { one = true; return Promise.resolve(response()); },
      then: <T, U>(resolve: (value: ReturnType<typeof response>) => T, reject?: (reason: unknown) => U) =>
        Promise.resolve(response()).then(resolve, reject),
      insert: forbiddenWrite, update: forbiddenWrite, delete: forbiddenWrite, upsert: forbiddenWrite,
    };
    return query;
  });
  return { rows, version, from, rpc, commit, forbiddenWrite };
}

describe("executeEstimateBatch", () => {
  const originalBatchLimit = process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
  let db: ReturnType<typeof readOnlyDatabase>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
    db = readOnlyDatabase();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: db as never, tenantId: TENANT_ID, userId: ACTOR_ID, tenantRole: "engineer",
    });
  });
  afterEach(() => {
    if (originalBatchLimit === undefined) delete process.env.ESTIMATE_BATCH_MAX_OPERATIONS;
    else process.env.ESTIMATE_BATCH_MAX_OPERATIONS = originalBatchLimit;
  });

  it("returns validated dry-run previews without applying operations", async () => {
    const before = structuredClone(db.rows);
    const result = await executeEstimateBatch(VERSION_ID, [
      { op: "create", data: { item_type: "section", title: "Nouveau chapitre" } },
      { op: "update", id: ITEM_ID, data: { title: "Prévisualisation" } },
    ], { ...OPTIONS, concurrencyToken: ` ${UPDATED_AT} `, dryRun: true });
    expect(result).toMatchObject({ committed: false, version: { id: VERSION_ID, updated_at: UPDATED_AT },
      results: [
        { index: 0, op: "create", status: "ok", data: { dry_run: true } },
        { index: 1, op: "update", status: "ok", data: { dry_run: true } },
      ] });
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.forbiddenWrite).not.toHaveBeenCalled();
    expect(db.rows).toEqual(before);
  });

  it("does not fall back to separate mutations when the commit loses the race", async () => {
    db.commit.mockResolvedValue({ data: null,
      error: { code: "40001", message: "ESTIMATE_BATCH_STALE" } });
    await expect(executeEstimateBatch(VERSION_ID, [{ op: "delete", id: ITEM_ID }], OPTIONS))
      .rejects.toMatchObject({ code: "ESTIMATE_BATCH_STALE" });
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.forbiddenWrite).not.toHaveBeenCalled();
  });

  async function assertPreflightRefusal(operations: BatchOperationInput[]) {
    const before = structuredClone(db.rows);
    const result = await executeEstimateBatch(VERSION_ID, operations, OPTIONS);
    expect(result).toMatchObject({ committed: false, version: { id: VERSION_ID, updated_at: UPDATED_AT },
      results: [
        { index: 0, op: operations[0].op, status: "ok", data: { rolled_back: true } },
        { index: 1, op: operations[1].op, status: "error", code: "NOT_FOUND" },
      ] });
    expect(result.results).toHaveLength(2);
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.forbiddenWrite).not.toHaveBeenCalled();
    expect(db.rows).toEqual(before);
  }

  it("preserves deleted rows and descendants when a later operation is invalid", async () => {
    db.rows.estimate_items.push(line(CHILD_ID, 2));
    await assertPreflightRefusal([
      { op: "delete", id: SECTION_ID },
      { op: "update", id: CHILD_ID, data: { title: "Descendant supprimé dans le plan" } },
    ]);
  });

  // Replaces the old expectation that a failed compensation still proves false.
  it("does not claim committed=false when the commit transport has an unknown outcome", async () => {
    db.commit.mockRejectedValue(new Error("Connection closed after dispatch"));
    await expect(executeEstimateBatch(VERSION_ID, [{ op: "delete", id: ITEM_ID }], OPTIONS))
      .rejects.toMatchObject({ status: 503, code: "BATCH_OUTCOME_UNKNOWN" });
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.forbiddenWrite).not.toHaveBeenCalled();
  });

  // Without the revision, the editor read the whole estimate again after every save (5 Mo for 2 031 items) only
  // to learn this number. Failure modes: a revision from another state of the version; a commit reported as
  // failed, or as unknown, because this read failed; server-side copies paying a read they do not use.
  describe("content revision of a committed batch", () => {
    const COMMITTED_AT = "2026-02-21T10:00:05.000Z";
    const operations: BatchOperationInput[] = [{ op: "update", id: ITEM_ID, data: { title: "Titre enregistré" } }];
    const commitAt = (after: { updated_at: string; content_revision: number }) => {
      db.commit.mockImplementation(async () => {
        // The transaction has moved the version before the function reads it back.
        Object.assign(db.version, after);
        return {
          data: {
            committed: true,
            results: [{ index: 0, op: "update", status: "ok", data: { item: { ...line(), title: "Titre enregistré" } } }],
            version: { id: VERSION_ID, updated_at: COMMITTED_AT },
            totals: { total_ht_cents: 1000, total_tax_cents: 200, total_ttc_cents: 1200 },
            receipt: {
              operation_key: OPERATION_KEY, actor_id: ACTOR_ID, version_id: VERSION_ID,
              expected_updated_at: UPDATED_AT, operations, committed_at: COMMITTED_AT,
            },
            replayed: false,
            current_version: { id: VERSION_ID, updated_at: COMMITTED_AT, status: "draft" },
          },
          error: null,
        };
      });
    };
    const HTTP_OPTIONS = { ...OPTIONS, currentContentRevision: true };

    it("returns the revision of the version it committed", async () => {
      commitAt({ updated_at: COMMITTED_AT, content_revision: 7 });
      const result = await executeEstimateBatch(VERSION_ID, operations, HTTP_OPTIONS);
      expect(result).toMatchObject({
        committed: true, version: { id: VERSION_ID, updated_at: COMMITTED_AT },
        current_version: { id: VERSION_ID, updated_at: COMMITTED_AT, status: "draft", content_revision: 7 },
      });
      expect(db.forbiddenWrite).not.toHaveBeenCalled();
    });

    it("leaves the revision out when the version has moved again since the commit", async () => {
      commitAt({ updated_at: "2026-02-21T10:00:09.000Z", content_revision: 8 });
      const result = await executeEstimateBatch(VERSION_ID, operations, HTTP_OPTIONS);
      expect(result).toMatchObject({ committed: true, current_version: { updated_at: COMMITTED_AT } });
      expect(result.committed && "content_revision" in result.current_version).toBe(false);
    });

    it("still acknowledges the commit when the revision cannot be read", async () => {
      commitAt({ updated_at: COMMITTED_AT, content_revision: 7 });
      const read = db.from.getMockImplementation()!;
      let committed = false;
      db.commit.mockImplementation(((previous) => async (input: Record<string, unknown>) => {
        const response = await previous!(input);
        committed = true;
        return response;
      })(db.commit.getMockImplementation()));
      db.from.mockImplementation((table: string) => {
        if (committed && table === "estimate_versions") throw new Error("Connection closed");
        return read(table);
      });
      const result = await executeEstimateBatch(VERSION_ID, operations, HTTP_OPTIONS);
      expect(result).toMatchObject({ committed: true, current_version: { updated_at: COMMITTED_AT } });
      expect(result.committed && "content_revision" in result.current_version).toBe(false);
    });

    it("still acknowledges the commit when the version is no longer readable", async () => {
      commitAt({ updated_at: COMMITTED_AT, content_revision: 7 });
      // The read finds no row once the batch has committed (access withdrawn in between).
      db.commit.mockImplementation(((previous) => async (input: Record<string, unknown>) => {
        const response = await previous!(input);
        db.rows.estimate_versions = [];
        return response;
      })(db.commit.getMockImplementation()));
      const result = await executeEstimateBatch(VERSION_ID, operations, HTTP_OPTIONS);
      expect(result).toMatchObject({ committed: true, current_version: { updated_at: COMMITTED_AT } });
      expect(result.committed && "content_revision" in result.current_version).toBe(false);
    });

    it("reads nothing more for a caller that does not ask for the revision", async () => {
      commitAt({ updated_at: COMMITTED_AT, content_revision: 7 });
      let readsAfterCommit = 0;
      const read = db.from.getMockImplementation()!;
      db.commit.mockImplementation(((previous) => async (input: Record<string, unknown>) => {
        const response = await previous!(input);
        db.from.mockImplementation((table: string) => { readsAfterCommit += 1; return read(table); });
        return response;
      })(db.commit.getMockImplementation()));
      const result = await executeEstimateBatch(VERSION_ID, operations, OPTIONS);
      expect(result).toMatchObject({ committed: true });
      expect(result.committed && "content_revision" in result.current_version).toBe(false);
      expect(readsAfterCommit).toBe(0);
    });
  });

  // TI-534: the projection checked by the database (D12) carries the FO provision its trigger gives each v3 line.
  it("projects a v3 line with the FO provision of its supply type, on a supply type change and at creation", async () => {
    const TUBE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    Object.assign(db.version, {
      calc_engine_version: 3, sale_coefficient_fo: 1, sale_coefficient_mo: 1, discount_amount_cents: null,
      gross_ht_cents: 1000, discount_applied_cents: 0, commercial_rounding_cents: 0,
    });
    db.rows.estimate_items = [section(), {
      ...line(), h_mo: 0, h_mo_per_unit: 0, unit_code: "u", pricing_status: "priced", fo_provision: 1, k_fo_manual: false,
    }];
    db.rows.estimate_fo_preferences = [];
    db.rows.supply_types = [{ id: TUBE_ID, tenant_id: TENANT_ID, code: "tube", name: "Tube", default_fo_provision: 1.13 }];
    db.commit.mockResolvedValue({ data: null, error: { code: "40001", message: "ESTIMATE_BATCH_STALE" } });
    const operations: BatchOperationInput[] = [
      { op: "update", id: ITEM_ID, data: { supply_type_id: TUBE_ID } },
      { op: "create", data: { item_type: "line", parent_id: SECTION_ID, title: "Coude", quantity: 2, unit_price_ht_cents: 500 } },
    ];
    await expect(executeEstimateBatch(VERSION_ID, operations, OPTIONS)).rejects.toMatchObject({ code: "ESTIMATE_BATCH_STALE" });
    const sent = db.commit.mock.calls[0][0] as {
      p_operations: unknown; p_created_ids: Array<{ id: string }>; p_item_updates: Array<Record<string, unknown>>;
      p_version_patch: Record<string, unknown>;
    };
    const createdId = sent.p_created_ids[0].id;
    // TI-534 current contract: one K FO, 1.13 for Tube and 1.02 without a family.
    expect(Object.fromEntries(sent.p_item_updates.map((update) => [update.id, [update.pu_ht_cents, update.line_total_ht_cents]])))
      .toEqual({ [ITEM_ID]: [1130, 1130], [createdId]: [510, 1020] });
    expect(sent.p_version_patch).toMatchObject({ gross_ht_cents: 2150, total_ht_cents: 2150 });
    // The provision is the database's: the operations replayed by an idempotent retry stay those of the client.
    expect(JSON.stringify(sent.p_operations)).not.toContain("fo_provision");
  });
  // TI-682, lot C: the internal reason of an exclusion is a line key of the batch, on create and update, written with
  // the status by anyone who may write the line. « Was not priced » is the database's: never an input.
  describe("status_reason", () => {
    const NOTE = "Fourni par le maître d'ouvrage";
    function asV3(status = "not_priced") {
      Object.assign(db.version, {
        calc_engine_version: 3, sale_coefficient_fo: 1, sale_coefficient_mo: 1, discount_amount_cents: null,
        gross_ht_cents: 0, discount_applied_cents: 0, commercial_rounding_cents: 0, total_ht_cents: 0, total_tax_cents: 0,
        total_ttc_cents: 0,
      });
      db.rows.estimate_items = [section(), {
        ...line(), unit_price_ht_cents: 0, h_mo: 0, h_mo_per_unit: 0, unit_code: "u", pricing_status: status, fo_provision: 1,
        pu_ht_cents: null, line_total_ht_cents: 0, line_tax_cents: 0, line_total_ttc_cents: 0,
        was_not_priced: status === "not_priced", status_reason: null,
      }];
      db.commit.mockResolvedValue({ data: null, error: { code: "40001", message: "ESTIMATE_BATCH_STALE" } });
    }
    const sentOperations = () => (db.commit.mock.calls[0][0] as { p_operations: unknown }).p_operations;

    it("sends the reason with the status, its note trimmed, on update and on create", async () => {
      asV3();
      const operations: BatchOperationInput[] = [
        { op: "update", id: ITEM_ID, data: { pricing_status: "out_of_scope", status_reason: { code: "client_supplied", note: `  ${NOTE}\n` } } },
        { op: "create", data: { item_type: "line", parent_id: SECTION_ID, title: "Hors lot direct", pricing_status: "out_of_scope",
          status_reason: { code: "other_trade" } as never } },
      ];
      await expect(executeEstimateBatch(VERSION_ID, operations, OPTIONS)).rejects.toMatchObject({ code: "ESTIMATE_BATCH_STALE" });
      expect(sentOperations()).toEqual([
        { op: "update", id: ITEM_ID, data: { pricing_status: "out_of_scope", status_reason: { code: "client_supplied", note: NOTE } } },
        { op: "create", data: expect.objectContaining({ pricing_status: "out_of_scope", status_reason: { code: "other_trade", note: null } }) },
      ]);
    });

    it("clears the reason with null", async () => {
      asV3("out_of_scope");
      await expect(executeEstimateBatch(VERSION_ID, [{ op: "update", id: ITEM_ID, data: { status_reason: null } }], OPTIONS))
        .rejects.toMatchObject({ code: "ESTIMATE_BATCH_STALE" });
      expect(sentOperations()).toEqual([{ op: "update", id: ITEM_ID, data: { status_reason: null } }]);
    });

    it.each([
      ["an unknown code", { status_reason: { code: "unknown" } }],
      ["a note of 9 characters", { status_reason: { code: "other_trade", note: "123456789" } }],
      ["« other » without a note", { status_reason: { code: "other", note: "  " } }],
      ["« was not priced » as an input", { was_not_priced: false }],
    ])("refuses %s before anything is written", async (_name, data) => {
      asV3();
      await expect(executeEstimateBatch(VERSION_ID, [{ op: "update", id: ITEM_ID, data } as never], OPTIONS)).rejects.toThrow();
      expect(db.commit).not.toHaveBeenCalled();
    });

    it("refuses « was not priced » at creation too", async () => {
      asV3();
      await expect(executeEstimateBatch(VERSION_ID, [{ op: "create", data: {
        item_type: "line", parent_id: SECTION_ID, title: "Ligne", pricing_status: "out_of_scope", was_not_priced: true,
      } } as never], OPTIONS)).rejects.toThrow();
      expect(db.commit).not.toHaveBeenCalled();
    });

    it("refuses a reason on an engine 2 line by name", async () => {
      await expect(executeEstimateBatch(VERSION_ID, [
        { op: "update", id: ITEM_ID, data: { status_reason: { code: "other_trade", note: null } } },
      ], OPTIONS)).resolves.toMatchObject({
        committed: false, results: [expect.objectContaining({ status: "error", code: "ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED" })],
      });
      expect(db.commit).not.toHaveBeenCalled();
    });

    it("refuses by name a new reason on a line that is not excluded", async () => {
      asV3("out_of_scope");
      await expect(executeEstimateBatch(VERSION_ID, [
        { op: "update", id: ITEM_ID, data: { pricing_status: "priced", status_reason: { code: "other_trade", note: null } } },
      ], OPTIONS)).resolves.toMatchObject({
        committed: false, results: [expect.objectContaining({ status: "error", code: "ESTIMATE_STATUS_REASON_STATUS_MISMATCH" })],
      });
      expect(db.commit).not.toHaveBeenCalled();
    });
  });

  // TI-541, réponse de Maxime du 11/11/2026 : une POSE SEULE ne prend ni pertes ni transport. La projection contrôlée
  // par la base (D12) porte donc une provision de 1 sur une ligne qui devient POSE SEULE ou qui est créée ainsi, et
  // reprend celle du type quand la ligne quitte cette nature.
  it("projects a POSE SEULE line without FO provision, and with its type's provision again when it leaves the nature", async () => {
    const TUBE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const POSE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    Object.assign(db.version, {
      calc_engine_version: 3, sale_coefficient_fo: 1, sale_coefficient_mo: 1, discount_amount_cents: null,
      gross_ht_cents: 2030, discount_applied_cents: 0, commercial_rounding_cents: 0,
    });
    const v3Line = { h_mo: 0, h_mo_per_unit: 0, unit_code: "u", pricing_status: "priced", supply_type_id: TUBE_ID };
    db.rows.estimate_items = [section(),
      { ...line(), ...v3Line, fo_provision: 1.03, line_nature: "supply_only" },
      { ...line(), ...v3Line, id: POSE_ID, position: 2, fo_provision: 1, line_nature: "pose_only" }];
    db.rows.supply_types = [{ id: TUBE_ID, tenant_id: TENANT_ID, code: "tube", name: "Tube", default_fo_provision: 1.03 }];
    db.commit.mockResolvedValue({ data: null, error: { code: "40001", message: "ESTIMATE_BATCH_STALE" } });
    const operations: BatchOperationInput[] = [
      { op: "update", id: ITEM_ID, data: { line_nature: "pose_only" } },
      { op: "update", id: POSE_ID, data: { line_nature: "supply_only" } },
      { op: "create", data: { item_type: "line", parent_id: SECTION_ID, title: "Supportage", quantity: 2, unit_price_ht_cents: 500,
        line_nature: "pose_only" } },
    ];
    await expect(executeEstimateBatch(VERSION_ID, operations, OPTIONS)).rejects.toMatchObject({ code: "ESTIMATE_BATCH_STALE" });
    const sent = db.commit.mock.calls[0][0] as { p_created_ids: Array<{ id: string }>; p_item_updates: Array<Record<string, unknown>> };
    // Devenue POSE SEULE : 1 × 1 000 × 1 = 1 000. Redevenue fourniture, tube : 1 000 × 1,030 = 1 030.
    // Créée POSE SEULE : 2 × (500 × 1) = 1 000, sans le 1,010 d'une ligne neuve.
    expect(Object.fromEntries(sent.p_item_updates.map((update) => [update.id, [update.pu_ht_cents, update.line_total_ht_cents]])))
      .toEqual({ [ITEM_ID]: [1000, 1000], [POSE_ID]: [1030, 1030], [sent.p_created_ids[0].id]: [500, 1000] });
  });
});
