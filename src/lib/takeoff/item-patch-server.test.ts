import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ assertTakeoffEnabled: vi.fn() }));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { batchUpdateTakeoffItems } from "@/lib/takeoff/item-patch-server";
import {
  authenticatedContext,
  createSupabaseFake,
  filterValue,
  M3_ITEM_ID,
  M3_JOB_ID,
  M3_TENANT_ID,
  takeoffItemRow,
  takeoffJobRow,
  type SupabaseFake,
} from "@/lib/takeoff/metre-m3.test-utils";

const UPDATED_AT = "2026-01-01T00:02:00.000Z";
const SECOND_ITEM_ID = "88888888-8888-4888-8888-888888888888";
const THIRD_ITEM_ID = "99999999-9999-4999-8999-999999999999";
const FOURTH_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function entry(itemId: string, updatedAt = UPDATED_AT) {
  return { item_id: itemId, updated_at: updatedAt, fields: { quantity: 18 } };
}

function useFake(fake: SupabaseFake, role = "admin") {
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake, role) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("takeoff item patch persistence", () => {
  it("keeps ordered partial results across missing, stale, raced and successful items", async () => {
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: takeoffJobRow({ status: "completed" }), error: null }),
        takeoff_items: (query) => {
          const id = filterValue(query, "id");
          const row = takeoffItemRow({ id });
          if (id === M3_ITEM_ID) return { data: null, error: null };
          if (id === THIRD_ITEM_ID && query.operation === "update") {
            return { data: null, error: null };
          }
          return {
            data: query.operation === "update" ? { ...row, ...query.payload as object } : row,
            error: null,
          };
        },
        audit_logs: () => ({ data: null, error: null }),
      },
    });
    useFake(fake);

    const response = await batchUpdateTakeoffItems(M3_JOB_ID, {
      items: [entry(M3_ITEM_ID), entry(SECOND_ITEM_ID, "stale"), entry(THIRD_ITEM_ID), entry(FOURTH_ITEM_ID)],
    });

    expect(response).toMatchObject({
      succeeded: 1,
      failed: 3,
      results: [
        { item_id: M3_ITEM_ID, success: false, error: "Item introuvable." },
        { item_id: SECOND_ITEM_ID, success: false, error: expect.stringContaining("Conflit de concurrence") },
        { item_id: THIRD_ITEM_ID, success: false, error: expect.stringContaining("Conflit de concurrence") },
        { item_id: FOURTH_ITEM_ID, success: true, item: { quantity: 18 } },
      ],
    });
    expect(fake.writesTo("takeoff_items").map((query) => filterValue(query, "id")))
      .toEqual([THIRD_ITEM_ID, FOURTH_ITEM_ID]);
    for (const query of fake.queries.filter((query) => query.table === "takeoff_items")) {
      expect(filterValue(query, "tenant_id")).toBe(M3_TENANT_ID);
      expect(filterValue(query, "job_id")).toBe(M3_JOB_ID);
      if (query.operation === "update") expect(filterValue(query, "updated_at")).toBe(UPDATED_AT);
    }
    expect(fake.writesTo("audit_logs")).toHaveLength(1);
    expect(response.results[3]?.item?.metadata).toMatchObject({ original_unit: "m.l" });
  });

  it("awaits non-blocking audit completion before processing the next item", async () => {
    let releaseAudit: (value: { data: null; error: { code: string; message: string } }) => void = () => {};
    const pendingAudit = new Promise<{ data: null; error: { code: string; message: string } }>((resolve) => {
      releaseAudit = resolve;
    });
    let item = takeoffItemRow();
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: takeoffJobRow({ status: "completed" }), error: null }),
        takeoff_items: (query) => {
          if (query.operation === "update") item = { ...item, ...query.payload as object };
          return { data: item, error: null };
        },
        audit_logs: () => pendingAudit,
      },
    });
    useFake(fake);

    let settled = false;
    const operation = batchUpdateTakeoffItems(M3_JOB_ID, {
      items: [entry(M3_ITEM_ID), entry(M3_ITEM_ID)],
    }).then((response) => {
      settled = true;
      return response;
    });
    await vi.waitFor(() => expect(fake.writesTo("audit_logs")).toHaveLength(1));
    expect(settled).toBe(false);
    expect(fake.queries.filter((query) => query.table === "takeoff_items")).toHaveLength(2);
    releaseAudit({ data: null, error: { code: "42501", message: "audit refused" } });

    const response = await operation;
    expect(response).toMatchObject({
      succeeded: 1,
      failed: 1,
      results: [
        { success: true, item: { quantity: 18 } },
        { success: false, error: expect.stringContaining("Conflit de concurrence") },
      ],
    });
    expect(fake.writesTo("takeoff_items")).toHaveLength(1);
  });

  it.each(["viewer", "buyer"])('refuses the role "%s" before reading any job', async (role) => {
    const fake = createSupabaseFake({});
    useFake(fake, role);
    await expect(batchUpdateTakeoffItems(M3_JOB_ID, { items: [entry(M3_ITEM_ID)] }))
      .rejects.toMatchObject({ status: 403 });
    expect(fake.queries).toEqual([]);
  });

  it("rejects a non-completed job before any item access", async () => {
    const fake = createSupabaseFake({
      tables: { takeoff_jobs: () => ({ data: takeoffJobRow({ status: "processing" }), error: null }) },
    });
    useFake(fake);
    await expect(batchUpdateTakeoffItems(M3_JOB_ID, { items: [entry(M3_ITEM_ID)] }))
      .rejects.toMatchObject({ status: 409 });
    expect(fake.tablesTouched).toEqual(["takeoff_jobs"]);
  });
});
