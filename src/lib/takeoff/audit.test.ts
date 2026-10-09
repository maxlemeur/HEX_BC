import { beforeEach, describe, expect, it, vi } from "vitest";

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

  return {
    supabase: { from } as never,
    from,
    insert,
    insertedPayloads,
  };
}

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
  });
});
