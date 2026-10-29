import { describe, expect, it } from "vitest";

import { parseTakeoffDpgfComparisonResponse } from "@/lib/takeoff/dpgf-comparison-contracts";
import { comparisonFixture, IDENTITY } from "@/lib/takeoff/read-contracts.test-fixtures";

describe("DPGF comparison response contract", () => {
  it("preserves opaque cursors exactly and refuses the same cursor as the request", () => {
    const data = comparisonFixture();
    data.summary.total_lines = 2;
    data.pagination.total = 2;
    data.pagination.next_cursor = "opaque cursor/+?=version-2";
    expect(parseTakeoffDpgfComparisonResponse(data, IDENTITY).pagination.next_cursor).toBe(data.pagination.next_cursor);
    expect(() => parseTakeoffDpgfComparisonResponse(data, { ...IDENTITY, cursor: data.pagination.next_cursor })).toThrow();
  });

  it("accepts an empty exceptions view while retaining the full summary", () => {
    const data = comparisonFixture();
    data.view = "exceptions_only";
    data.rows = [];
    data.pagination.total = 0;
    expect(parseTakeoffDpgfComparisonResponse(data, { ...IDENTITY, view: "exceptions_only" })).toEqual(data);
  });
});
