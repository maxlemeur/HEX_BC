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
          if (id === M3_ITEM_ID) return { data: null, error: null };
          return { data: takeoffItemRow({ id }), error: null };
        },
        audit_logs: () => ({ data: null, error: null }),
      },
      rpc: {
        update_takeoff_item_for_review: (args) => {
          const { p_item_id: id, p_fields: fields } = args as { p_item_id: string; p_fields: object };
          return { data: id === THIRD_ITEM_ID ? [] : [{ ...takeoffItemRow({ id }), ...fields }], error: null };
        },
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
    const saves = fake.rpcCalls.filter((call) => call.fn === "update_takeoff_item_for_review")
      .map((call) => call.args as { p_item_id: string; p_tenant_id: string; p_job_id: string; p_expected_updated_at: string });
    expect(saves.map((save) => save.p_item_id)).toEqual([THIRD_ITEM_ID, FOURTH_ITEM_ID]);
    for (const save of saves) {
      expect([save.p_tenant_id, save.p_job_id, save.p_expected_updated_at]).toEqual([M3_TENANT_ID, M3_JOB_ID, UPDATED_AT]);
    }
    for (const query of fake.queries.filter((query) => query.table === "takeoff_items")) {
      expect(filterValue(query, "tenant_id")).toBe(M3_TENANT_ID);
      expect(filterValue(query, "job_id")).toBe(M3_JOB_ID);
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
        takeoff_items: () => ({ data: item, error: null }),
        audit_logs: () => pendingAudit,
      },
      rpc: {
        update_takeoff_item_for_review: (args) => {
          item = { ...item, ...(args as { p_fields: object }).p_fields };
          return { data: [item], error: null };
        },
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
    expect(fake.queries.filter((query) => query.table === "takeoff_items")).toHaveLength(1);
    expect(fake.rpcCalls.filter((call) => call.fn === "update_takeoff_item_for_review")).toHaveLength(1);
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
    expect(fake.rpcCalls.filter((call) => call.fn === "update_takeoff_item_for_review")).toHaveLength(1);
  });

  // TI-664 L5c: a saved line's rules read the other lines of its job (a run on two zone plans, two rooms of a page).
  // Ways the review fails, written before the fix:
  // - only the saved lines are read back: a partner line keeps, in the review, results the server just recomputed
  //   (shown failed when settled, or settled when failed);
  // - when the computation fails or is skipped, the partners made stale by the edit still read as evaluated;
  // - lines no rule reads are sent too (a flag-off version pays for nothing it shows).
  it("returns the rule state of the job's lines read after the rules, even when they could not run", async () => {
    const evaluatedAt = "2026-01-01T00:03:00.000Z";
    const failing = [{ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 101, acceptable: true,
      reason: "Tronçon compté aussi sur une autre page du niveau R+1 que Z1 : 1,00 m avec « EF » (Z2)." }];
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: takeoffJobRow({ status: "completed" }), error: null }),
        takeoff_items: (query) => {
          const id = filterValue(query, "id");
          if (id) return { data: takeoffItemRow({ id, rule_results: [], rules_evaluated_at: evaluatedAt, rules_stale: false }), error: null };
          return { data: [
            { id: M3_ITEM_ID, rule_results: [], rules_evaluated_at: evaluatedAt, rules_stale: true },
            { id: SECOND_ITEM_ID, rule_results: failing, rules_evaluated_at: evaluatedAt, rules_stale: true },
            { id: THIRD_ITEM_ID, rule_results: [], rules_evaluated_at: null, rules_stale: false },
          ], error: null, count: 3 };
        },
        audit_logs: () => ({ data: null, error: null }),
      },
      rpc: {
        update_takeoff_item_for_review: (args) => {
          const { p_item_id: id, p_fields: fields } = args as { p_item_id: string; p_fields: object };
          return { data: [{ ...takeoffItemRow({ id }), ...fields, rules_stale: true }], error: null };
        },
        takeoff_rule_version_stamp: () => ({ data: null, error: { message: "verrou de version" } }),
      },
    });
    useFake(fake);

    const response = await batchUpdateTakeoffItems(M3_JOB_ID, { items: [entry(M3_ITEM_ID)] });

    expect(response.results).toMatchObject([{ item_id: M3_ITEM_ID, success: true, item: { quantity: 18 } }]);
    expect(response.rule_states).toEqual([
      { item_id: M3_ITEM_ID, rule_results: [], rules_evaluated_at: evaluatedAt, rules_stale: true },
      { item_id: SECOND_ITEM_ID, rule_results: failing, rules_evaluated_at: evaluatedAt, rules_stale: true },
    ]);
    const stateRead = fake.queries.find((query) => query.table === "takeoff_items" && query.operation === "select" && !filterValue(query, "id"));
    expect(stateRead && [filterValue(stateRead, "tenant_id"), filterValue(stateRead, "job_id")]).toEqual([M3_TENANT_ID, M3_JOB_ID]);
  });

  // TI-677 (Codex #160, thread 4467587403): two saves of one version could deadlock. Each UPDATE locked its own line,
  // then the peer invalidation of the rules locked every other line of the version: A held its line and waited for
  // B's, B held its line and waited for A's, and one save failed (« Impossible de mettre à jour l'item. »). A line is
  // now saved through update_takeoff_item_for_review, which takes the version's lock before the line's (pgTAP
  // takeoff-rule-peers-race.test.sql shows the deadlock and its absence): the review never updates the table directly.
  it("saves each line through the version's serialized write, with its expected timestamp, never a direct update", async () => {
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: takeoffJobRow({ status: "completed" }), error: null }),
        takeoff_items: () => ({ data: takeoffItemRow(), error: null }),
        audit_logs: () => ({ data: null, error: null }),
      },
      rpc: {
        update_takeoff_item_for_review: (args) => ({
          data: [{ ...takeoffItemRow(), ...(args as { p_fields: object }).p_fields, rule_results: [], rules_stale: false }], error: null,
        }),
      },
    });
    useFake(fake);

    const response = await batchUpdateTakeoffItems(M3_JOB_ID, { items: [entry(M3_ITEM_ID)] });

    expect(response.results).toMatchObject([{ item_id: M3_ITEM_ID, success: true, item: { quantity: 18 } }]);
    expect(fake.writesTo("takeoff_items")).toEqual([]);
    expect(fake.rpcCalls.filter((call) => call.fn === "update_takeoff_item_for_review")).toEqual([{
      fn: "update_takeoff_item_for_review",
      args: { p_tenant_id: M3_TENANT_ID, p_job_id: M3_JOB_ID, p_item_id: M3_ITEM_ID, p_expected_updated_at: UPDATED_AT,
        p_fields: expect.objectContaining({ quantity: 18 }) },
    }]);
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
