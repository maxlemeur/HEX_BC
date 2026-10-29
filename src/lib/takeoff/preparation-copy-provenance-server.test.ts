import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { findTakeoffPreparationCopyReceipt, hasTakeoffPreparationCopyReceipt, recordTakeoffPreparationCopy } from "@/lib/takeoff/preparation-copy-provenance-server";
import { authenticatedContext, createSupabaseFake, filterValue, M3_PROJECT_ID, M3_TENANT_ID, M3_USER_ID, M3_VERSION_ID, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const scope = { projectId: M3_PROJECT_ID, sourceVersionId: SOURCE_ID, targetVersionId: M3_VERSION_ID, preparationRevision: 2 };

function fixture() {
  let receipt: Record<string, unknown> | null = null;
  let targetProject = M3_PROJECT_ID;
  const user = createSupabaseFake({ tables: {
    estimate_projects: () => ({ data: { id: M3_PROJECT_ID }, error: null }),
    estimate_versions: (query) => query.cardinality === "maybeSingle" ? { data: targetProject === M3_PROJECT_ID ? { id: M3_VERSION_ID } : null, error: null } : ({ data: [
      { id: SOURCE_ID, project_id: M3_PROJECT_ID, status: "sent", parent_version_id: null },
      ...(targetProject === M3_PROJECT_ID ? [{ id: M3_VERSION_ID, project_id: targetProject, status: "draft", parent_version_id: null }] : []),
    ], error: null }),
  } });
  const server = createSupabaseFake({ tables: {
    audit_logs: (query: FakeQuery) => {
      if (query.operation === "insert") {
        receipt = query.payload as Record<string, unknown>;
        return { data: null, error: null };
      }
      const metadata = receipt?.after_data as Record<string, unknown> | undefined;
      const matches = receipt && metadata && query.filters.every((filter) => {
        const value = filter.column.startsWith("after_data->>") ? String(metadata[filter.column.slice("after_data->>".length)]) : receipt![filter.column];
        return value === filter.value;
      });
      return { data: query.cardinality === "many" ? matches ? [receipt] : [] : matches ? { id: "receipt-id" } : null, error: null };
    },
  } });
  vi.mocked(createServiceRoleClient).mockReturnValue(server.client as never);
  const context = authenticatedContext(user) as never;
  return { user, server, context, receipt: () => receipt, moveTarget: () => { targetProject = SOURCE_ID; } };
}

beforeEach(() => vi.clearAllMocks());

describe("ordinary takeoff copy provenance", () => {
  it("records a trusted same-project normal copy without changing variant parentage", async () => {
    const f = fixture();
    await recordTakeoffPreparationCopy({ ...scope, context: f.context });
    expect(f.receipt()).toMatchObject({ tenant_id: M3_TENANT_ID, user_id: M3_USER_ID,
      action: "takeoff.preparation.version_created", table_name: "estimate_versions",
      record_id: M3_VERSION_ID, estimate_version_id: M3_VERSION_ID,
      after_data: { schema_version: 1, project_id: M3_PROJECT_ID, source_version_id: SOURCE_ID, target_version_id: M3_VERSION_ID, preparation_revision: 2 } });
    expect(f.user.queries.filter((query) => query.operation !== "select")).toEqual([]);
    expect(await hasTakeoffPreparationCopyReceipt({ ...scope, context: f.context })).toBe(true);
  });

  it("never accepts a browser-supplied source or another preparation revision without its exact receipt", async () => {
    const f = fixture();
    expect(await hasTakeoffPreparationCopyReceipt({ ...scope, context: f.context })).toBe(false);
    await recordTakeoffPreparationCopy({ ...scope, context: f.context });
    expect(await hasTakeoffPreparationCopyReceipt({ ...scope, sourceVersionId: M3_PROJECT_ID, context: f.context })).toBe(false);
    expect(await hasTakeoffPreparationCopyReceipt({ ...scope, preparationRevision: 3, context: f.context })).toBe(false);
    expect(await hasTakeoffPreparationCopyReceipt({ ...scope, projectId: SOURCE_ID, context: f.context })).toBe(false);
    expect(filterValue(f.server.queries.at(-1)!, "tenant_id")).toBe(M3_TENANT_ID);
  });

  it("does not record an unrelated target or a source reused as its own copy", async () => {
    const f = fixture();
    f.moveTarget();
    await expect(recordTakeoffPreparationCopy({ ...scope, context: f.context })).rejects.toMatchObject({ status: 409 });
    await expect(recordTakeoffPreparationCopy({ ...scope, targetVersionId: SOURCE_ID, context: f.context })).rejects.toMatchObject({ status: 409 });
    expect(f.server.writesTo("audit_logs")).toEqual([]);
  });

  it("recovers only a live same-project target from the exact source and preparation receipt", async () => {
    const f = fixture();
    await recordTakeoffPreparationCopy({ ...scope, context: f.context });
    const sourceScope = { projectId: scope.projectId, sourceVersionId: scope.sourceVersionId, preparationRevision: scope.preparationRevision };
    expect(await findTakeoffPreparationCopyReceipt({ ...sourceScope, context: f.context })).toEqual({ targetVersionId: M3_VERSION_ID });
    expect(await findTakeoffPreparationCopyReceipt({ ...sourceScope, preparationRevision: 3, context: f.context })).toBeNull();
    f.moveTarget();
    expect(await findTakeoffPreparationCopyReceipt({ ...sourceScope, context: f.context })).toBeNull();
  });
});
