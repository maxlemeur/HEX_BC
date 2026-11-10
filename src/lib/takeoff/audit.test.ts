import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "44444444-4444-4444-8444-444444444444";

type SupabaseInsertError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
};

function createSupabaseAuditMock(insertError: SupabaseInsertError | null = null) {
  const insertedPayloads: Array<Record<string, unknown>> = [];

  const insert = vi.fn(async (payload: Record<string, unknown>) => {
    insertedPayloads.push(payload);
    return {
      data: null,
      error: insertError,
    };
  });

  const from = vi.fn((table: string) => {
    if (table !== "audit_logs") {
      throw new Error(`Unexpected table: ${table}`);
    }

    return { insert };
  });

  const supabase = { from } as never;
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase);

  return {
    supabase,
    from,
    insert,
    insertedPayloads,
  };
}

// TI-686 D10 (H7, H10): the override audit names each forced line with its coded reason and points to a justification
// stored once; the former job-level justification is no longer a field of it (the apply trigger refuses it).
describe("takeoff.apply.override metadata, per-line reasons", () => {
  const A = "a6860000-0000-4000-8000-00000000000a";
  const B = "a6860000-0000-4000-8000-00000000000b";
  const state = (item_id: string) => ({ item_id, quantity: 4, unit: "ml", updated_at: "2026-11-10T09:00:00.000000+00:00",
    rule_failures: [], rules_stale: false, designation: "Ligne", evidence: null, source_page: 1, is_verified: false,
    quantity_entered_by: null });
  const valid = {
    estimate_version_id: "44444444-4444-4444-8444-444444444444", threshold: 0.5, blocked_item_ids: [A, B], blocked_items_count: 2,
    blocked_items_state: [state(A), state(B)],
    forced_justifications: ["Fiche du fabricant jointe au dossier."],
    forced_items: [
      { item_id: A, reason_code: "additional_evidence" as const, justification_index: 0 },
      { item_id: B, reason_code: "rule_false_positive" as const, false_positive_rules: ["dn_network" as const], justification_index: 0 },
    ],
  };
  const build = (input: unknown) => () => takeoffAuditMetadataBuilders["takeoff.apply.override"](input as never);

  it("records each forced line with its reason and the index of its justification", () => {
    expect(build(valid)()).toEqual(valid);
  });

  it("refuses an unknown key in a forced line, the former job-level justification and an index out of bounds", () => {
    expect(build({ ...valid, forced_items: [{ ...valid.forced_items[0], note: "?" }, valid.forced_items[1]] })).toThrow();
    expect(build({ ...valid, justification: "Validation manuelle exceptionnelle" })).toThrow();
    expect(build({ ...valid, forced_items: [valid.forced_items[0], { ...valid.forced_items[1], justification_index: 1 }] }))
      .toThrow();
  });

  it("refuses a blocked line without its forced entry, and an entry for a line that is not blocked", () => {
    expect(build({ ...valid, forced_items: [valid.forced_items[0]] })).toThrow();
    expect(build({ ...valid, blocked_item_ids: [A], blocked_items_count: 1, blocked_items_state: [state(A)] })).toThrow();
  });
});

describe("takeoff audit helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws in fail-hard mode when audit insert fails", async () => {
    const mock = createSupabaseAuditMock({
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: null,
      hint: null,
    });
    const metadata = takeoffAuditMetadataBuilders["takeoff.job.failed"]({});

    await expect(
      logTakeoffAuditEvent({
        supabase: mock.supabase,
        tenantId: TENANT_ID,
        userId: USER_ID,
        jobId: JOB_ID,
        action: "takeoff.job.failed",
        metadata,
        mode: "fail-hard",
      })
    ).rejects.toMatchObject({
      code: TakeoffErrorCode.CONFLICT,
      status: 409,
      message: "Conflit de données.",
    });
    expect(mock.insert).toHaveBeenCalledTimes(1);
    expect(createServiceRoleClient).toHaveBeenCalledTimes(1);
  });
});
