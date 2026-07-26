import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TAKEOFF_AUDIT_ACTIONS,
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import { classifyTakeoffUploadSource } from "@/lib/takeoff/document-classifier";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";

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

  it("keeps the TKF-015 audit action catalog complete", () => {
    expect(TAKEOFF_AUDIT_ACTIONS).toEqual([
      "takeoff.job.created",
      "takeoff.job.processing",
      "takeoff.job.completed",
      "takeoff.job.failed",
      "takeoff.job.retried",
      "takeoff.job.reconcile_requested",
      "takeoff.job.resubmitted",
      "takeoff.job.canceled",
      "takeoff.item.excluded",
      "takeoff.item.modified",
      "takeoff.dpgf.review_decision",
      "takeoff.apply.started",
      "takeoff.apply.override",
      "takeoff.apply.completed",
      "takeoff.apply.failed",
      "takeoff.mapping.applied",
    ]);
  });

  it("normalizes metadata for takeoff.job.created", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.job.created"]({
      level: "A",
      estimate_version_id: ESTIMATE_VERSION_ID,
      source_file_name: "  niveau-a.csv  ",
      idempotency_key: "   ",
    });

    expect(metadata).toEqual({
      level: "A",
      estimate_version_id: ESTIMATE_VERSION_ID,
      source_file_name: "niveau-a.csv",
      idempotency_key: null,
      plan_set_id: null,
      classification: null,
      selection: null,
    });
  });

  it("normalizes classification and selection for takeoff.job.created", () => {
    const classification = classifyTakeoffUploadSource({
      fileName: "lot-cvc-dpgf.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_048,
    });

    const metadata = takeoffAuditMetadataBuilders["takeoff.job.created"]({
      level: "C",
      estimate_version_id: ESTIMATE_VERSION_ID,
      source_file_name: " lot-cvc-dpgf.pdf ",
      plan_set_id: JOB_ID,
      classification,
      selection: {
        selected_level: "C",
        override_applied: true,
        source_kind: "plan_set",
      },
    });

    expect(metadata).toMatchObject({
      level: "C",
      plan_set_id: JOB_ID,
      classification: {
        document_class: "tabular_pdf",
        recommended_level: "B",
        compatible_levels: ["B", "C"],
        recommendation_strength: "high",
        signals: {
          mime_type: "application/pdf",
          extension: "pdf",
          file_count: 1,
        },
      },
      selection: {
        selected_level: "C",
        override_applied: true,
        source_kind: "plan_set",
      },
    });
  });

  it("normalizes metadata for takeoff.job.failed", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.job.failed"]({
      error_code: "  ",
      error_message: "  provider timeout  ",
    });

    expect(metadata).toEqual({
      status: "failed",
      attempt: 1,
      error_code: null,
      error_message: "provider timeout",
      retryable: false,
    });
  });

  it("normalizes metadata for takeoff.job.reconcile_requested", () => {
    const metadata =
      takeoffAuditMetadataBuilders["takeoff.job.reconcile_requested"]({
        reason: " manual_reconcile ",
        requested_by_role: "admin",
        from_status: " processing ",
        from_provider_batch_state: " running ",
        outcome: "applied",
      });

    expect(metadata).toEqual({
      status: "reconcile_requested",
      reason: "manual_reconcile",
      requested_by_role: "admin",
      from_status: "processing",
      from_provider_batch_state: "running",
      outcome: "applied",
    });
  });

  it("normalizes metadata for takeoff.item.modified", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.item.modified"]({
      item_id: ITEM_ID,
      field: "  quantity  ",
      previous_value: {
        amount: 12,
        unit: "ml",
      },
      next_value: 15,
      reason: "  user correction  ",
    });

    expect(metadata).toEqual({
      item_id: ITEM_ID,
      field: "quantity",
      previous_value: {
        amount: 12,
        unit: "ml",
      },
      next_value: 15,
      reason: "user correction",
    });
  });

  it("normalizes metadata for takeoff.dpgf.review_decision", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.dpgf.review_decision"]({
      estimate_item_id: ITEM_ID,
      review_reference: "  dpgf xlsx row 12  ",
      previous_decision: "keep_takeoff",
      next_decision: "manual_fix",
      previous_reason: "  IA ok  ",
      next_reason: "  Mesure terrain a reprendre.  ",
    });

    expect(metadata).toEqual({
      estimate_item_id: ITEM_ID,
      review_reference: "dpgf xlsx row 12",
      previous_decision: "keep_takeoff",
      next_decision: "manual_fix",
      previous_reason: "IA ok",
      next_reason: "Mesure terrain a reprendre.",
    });
  });

  it("normalizes metadata for takeoff.apply.completed", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.apply.completed"]({
      estimate_version_id: ESTIMATE_VERSION_ID,
    });

    expect(metadata).toEqual({
      estimate_version_id: ESTIMATE_VERSION_ID,
      applied_items_count: 0,
      excluded_items_count: 0,
    });
  });

  it("normalizes metadata for takeoff.apply.override", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.apply.override"]({
      estimate_version_id: ESTIMATE_VERSION_ID,
      threshold: 0.5,
      blocked_item_ids: [ITEM_ID],
      justification: "  Validation manuelle du lot  ",
    });

    expect(metadata).toEqual({
      estimate_version_id: ESTIMATE_VERSION_ID,
      threshold: 0.5,
      blocked_item_ids: [ITEM_ID],
      blocked_items_count: 1,
      justification: "Validation manuelle du lot",
    });
  });

  it("normalizes metadata for takeoff.mapping.applied", () => {
    const metadata = takeoffAuditMetadataBuilders["takeoff.mapping.applied"]({
      job_id: JOB_ID,
      item_id: ITEM_ID,
      rule_id: "  ",
      action: "set_price",
      estimate_item_id: "66666666-6666-4666-8666-666666666666",
    });

    expect(metadata).toEqual({
      job_id: JOB_ID,
      item_id: ITEM_ID,
      rule_id: null,
      action: "set_price",
      estimate_item_id: "66666666-6666-4666-8666-666666666666",
    });
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

  it("does not throw in non-blocking mode and logs a console error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
        mode: "non-blocking",
      })
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff audit logging failed (non-blocking)",
      expect.objectContaining({
        action: "takeoff.job.failed",
        tenantId: TENANT_ID,
        jobId: JOB_ID,
        error: expect.objectContaining({
          code: TakeoffErrorCode.CONFLICT,
          status: 409,
        }),
      })
    );
    expect(mock.insert).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("inserts the expected audit_logs payload envelope", async () => {
    const mock = createSupabaseAuditMock();
    const metadata = takeoffAuditMetadataBuilders["takeoff.apply.completed"]({
      estimate_version_id: ESTIMATE_VERSION_ID,
      applied_items_count: 7,
      excluded_items_count: 2,
    });

    await logTakeoffAuditEvent({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      estimateVersionId: ESTIMATE_VERSION_ID,
      action: "takeoff.apply.completed",
      metadata,
    });

    expect(mock.from).toHaveBeenCalledWith("audit_logs");
    expect(mock.insertedPayloads).toHaveLength(1);

    const [payload] = mock.insertedPayloads;

    expect(payload).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      record_id: JOB_ID,
      action: "takeoff.apply.completed",
      estimate_version_id: ESTIMATE_VERSION_ID,
    });
    expect(payload.after_data).toEqual({
      schema_version: 1,
      action: "takeoff.apply.completed",
      job_id: JOB_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      metadata: {
        estimate_version_id: ESTIMATE_VERSION_ID,
        applied_items_count: 7,
        excluded_items_count: 2,
      },
    });
  });
});
