

import { describe, expect, it } from "vitest";

import {
  inspectPlanSetResourceBudget,
  PLAN_SET_MAX_FILES,
  PLAN_SET_MAX_TOTAL_SIZE_BYTES,
} from "@/lib/takeoff/plans";
const MIB = 1024 * 1024;

describe("plan-set aggregate resource budget", () => {
  it("accepts the exact file and byte boundary", () => {
    const budget = inspectPlanSetResourceBudget(
      Array.from({ length: PLAN_SET_MAX_FILES }, () => ({
        file_size_bytes:
          PLAN_SET_MAX_TOTAL_SIZE_BYTES / PLAN_SET_MAX_FILES,
        page_count: 1,
      })),
      { maxPages: PLAN_SET_MAX_FILES }
    );

    expect(budget).toMatchObject({
      fileCount: PLAN_SET_MAX_FILES,
      totalSizeBytes: PLAN_SET_MAX_TOTAL_SIZE_BYTES,
      knownPageCount: PLAN_SET_MAX_FILES,
      violation: null,
    });
  });

  it("rejects excess cardinality before considering later limits", () => {
    const budget = inspectPlanSetResourceBudget(
      Array.from({ length: PLAN_SET_MAX_FILES + 1 }, () => ({
        file_size_bytes: MIB,
        page_count: 1,
      }))
    );

    expect(budget.violation).toBe("file_count");
  });

  it("rejects aggregate bytes even when every file is individually valid", () => {
    const budget = inspectPlanSetResourceBudget([
      { file_size_bytes: 40 * MIB, page_count: 1 },
      { file_size_bytes: 40 * MIB, page_count: 1 },
      { file_size_bytes: 40 * MIB, page_count: 1 },
    ]);

    expect(budget.violation).toBe("total_size");
  });

  it("rejects a known aggregate page count above the processing limit", () => {
    const budget = inspectPlanSetResourceBudget(
      [
        { file_size_bytes: MIB, page_count: 6 },
        { file_size_bytes: MIB, page_count: 5 },
      ],
      { maxPages: 10 }
    );

    expect(budget).toMatchObject({
      knownPageCount: 11,
      violation: "total_pages",
    });
  });

  it("preserves a legitimate multi-file set with incomplete page metadata", () => {
    const budget = inspectPlanSetResourceBudget(
      [
        { file_size_bytes: 2 * MIB, page_count: 4 },
        { file_size_bytes: 3 * MIB, page_count: null },
      ],
      { maxPages: 10 }
    );

    expect(budget).toMatchObject({
      fileCount: 2,
      totalSizeBytes: 5 * MIB,
      knownPageCount: 4,
      unknownPageCount: 1,
      violation: null,
    });
  });
});
