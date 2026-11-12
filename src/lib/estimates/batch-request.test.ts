import { expect, it } from "vitest";
import { canonicalizeEstimateBatchOperations } from "@/lib/estimates/batch-request";
it("keeps manual and automatic K FO provenance in canonical request identity", () => {
  for (const manual of [false, true]) {
    expect(
      canonicalizeEstimateBatchOperations([
        {
          op: "update",
          id: "00000000-0000-4000-8000-000000000001",
          data: { k_fo: 1.017, k_fo_manual: manual },
        },
      ])[0],
    ).toMatchObject({ data: { k_fo: 1.017, k_fo_manual: manual } });
  }
});
