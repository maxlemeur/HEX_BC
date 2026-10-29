import { describe, expect, it } from "vitest";

import { resolveTakeoffOperatorState } from "@/lib/takeoff/operator-state";

describe("resolveTakeoffOperatorState", () => {
  it("allows reconcile when the provider already succeeded but the job is still processing", () => {
    const state = resolveTakeoffOperatorState({
      status: "processing",
      processingStrategy: "batch",
      providerBatchId: "batch-succeeded",
      providerBatchState: "succeeded",
      tenantRole: "admin",
    });

    expect(state.state).toBe("orphan_to_reconcile");
    expect(state.canReconcile).toBe(true);
  });

  it("hides resubmit when the provider already succeeded upstream", () => {
    const state = resolveTakeoffOperatorState({
      status: "failed",
      retryCount: 1,
      processingStrategy: "batch",
      providerBatchId: "batch-succeeded",
      providerBatchState: "succeeded",
      tenantRole: "admin",
    });

    expect(state.state).toBe("orphan_to_reconcile");
    expect(state.canResubmit).toBe(false);
    expect(state.canReconcile).toBe(true);
  });
});
