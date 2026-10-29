import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeClientEstimateBatch } from "@/lib/estimates/batch-client";
import { readEstimateBatchIntention } from "@/lib/estimates/batch-intentions";
import { registerEstimateEditorMutations } from "@/lib/estimates/editor-mutations";

const versionId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const tenantId = "44444444-4444-4444-8444-444444444444";
const operationKey = "55555555-5555-4555-8555-555555555555";
const before = "2026-10-28T10:00:00.000001Z";
const after = "2026-10-28T10:00:00.000002Z";
const identity = { versionId, actorId, tenantId };
const operations = [{ op: "update" as const, id: itemId, data: { quantity: 3 } }];

function receipt(itemPatch: Record<string, unknown> = {}) {
  return {
    committed: true,
    version: { id: versionId, updated_at: after },
    results: [{ index: 0, op: "update", status: "ok", data: { item: {
      id: itemId, version_id: versionId, item_type: "line", quantity: 3,
      unit_price_ht_cents: 1000, pu_ht_cents: 1000,
      line_total_ht_cents: 3000, line_tax_cents: 600, line_total_ttc_cents: 3600,
      ...itemPatch,
    } } }],
    totals: { total_ht_cents: 3000, total_tax_cents: 600, total_ttc_cents: 3600 },
    receipt: { operation_key: operationKey, actor_id: actorId, version_id: versionId,
      expected_updated_at: before, committed_at: after, operations },
    replayed: false,
    current_version: { id: versionId, updated_at: after, status: "draft" },
  };
}

describe("the line save acknowledgement", () => {
  let unregister: () => void;

  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    unregister = registerEstimateEditorMutations(versionId, {
      getToken: () => before,
      getIdentity: () => identity,
      onCommit: vi.fn(),
      onPendingChange: vi.fn(),
    });
  });

  afterEach(() => {
    unregister();
    vi.unstubAllGlobals();
  });

  it.each([
    { quantity: "not-a-number" },
    { unit_price_ht_cents: "not-a-number" },
    { quantity: -1 },
    { unit_price_ht_cents: 1000.5 },
    { line_total_ttc_cents: 3500 },
    { pu_ht_cents: null, pricing_status: "unknown-status" },
  ])("retains the exact request when the acknowledged line is invalid: %j", async (patch) => {
    const transport = vi.fn().mockResolvedValue(receipt(patch));
    await expect(executeClientEstimateBatch({
      transport, versionId, updatedAtToken: before, operations, attempt: { operationKey },
    })).rejects.toMatchObject({ code: "BATCH_OUTCOME_UNKNOWN" });
    const retained = readEstimateBatchIntention(identity);
    expect(retained?.operationKey).toBe(operationKey);
    expect(JSON.parse(retained!.body).operations).toEqual(operations);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["actor", "request", "microseconds", "current-version"])(
    "retains an acknowledgement whose %s does not match the saved intention", async (changed) => {
      const saved = receipt();
      if (changed === "actor") saved.receipt.actor_id = tenantId;
      if (changed === "request") saved.receipt.operations = [{ ...operations[0], data: { quantity: 4 } }];
      if (changed === "microseconds") saved.receipt.expected_updated_at = after;
      if (changed === "current-version") saved.current_version.updated_at = before;
      const transport = vi.fn().mockResolvedValue(saved);
      await expect(executeClientEstimateBatch({
        transport, versionId, updatedAtToken: before, operations, attempt: { operationKey },
      })).rejects.toMatchObject({ code: "BATCH_OUTCOME_UNKNOWN" });
      expect(readEstimateBatchIntention(identity)?.operationKey).toBe(operationKey);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  );
});
