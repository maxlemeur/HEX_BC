import { describe, expect, it } from "vitest";

import { resolveTakeoffOperatorState } from "@/lib/takeoff/operator-state";

describe("resolveTakeoffOperatorState", () => {
  it("labels a batch whose provider already succeeded while the job is still processing as a resumption to check", () => {
    const state = resolveTakeoffOperatorState({
      status: "processing",
      processingStrategy: "batch",
      providerBatchId: "batch-succeeded",
      providerBatchState: "succeeded",
      tenantRole: "admin",
    });

    expect(state.state).toBe("orphan_to_reconcile");
    expect(state.label).toBe("Reprise à vérifier");
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
  });
});
