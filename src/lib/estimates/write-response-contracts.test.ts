import { describe, expect, it } from "vitest";

import { parseVerifyEstimateSealResponse } from "@/lib/estimates/write-response-contracts";

describe("estimate mutation response contracts", () => {
  it("preserves negative historical seal verification with no stored hash", () => {
    const result = { valid: false, computed_hash: "a".repeat(64), stored_hash: null, seal_payload_version: null };
    expect(parseVerifyEstimateSealResponse(result)).toEqual(result);
    expect(parseVerifyEstimateSealResponse({ ...result, stored_hash: "historical-corrupt-hash" }).valid).toBe(false);
    expect(() => parseVerifyEstimateSealResponse({ ...result, valid: true })).toThrow();
    expect(() => parseVerifyEstimateSealResponse({ ...result, computed_hash: "bad" })).toThrow();
  });
});
