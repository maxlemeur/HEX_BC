import { describe, expect, it } from "vitest";

import {
  assertCanWriteEstimateWorkflows,
  canWriteEstimateWorkflows,
} from "@/lib/estimates/write-access";

describe("estimate workflow write roles", () => {
  it.each(["admin", "engineer"] as const)("allows %s", (role) => {
    expect(canWriteEstimateWorkflows(role)).toBe(true);
    expect(() => assertCanWriteEstimateWorkflows(role)).not.toThrow();
  });

  it.each(["viewer", "director"] as const)("rejects %s", (role) => {
    expect(canWriteEstimateWorkflows(role)).toBe(false);
    expect(() => assertCanWriteEstimateWorkflows(role)).toThrow(
      expect.objectContaining({
        status: 403,
        code: "ESTIMATE_WRITE_ROLE_REQUIRED",
      })
    );
  });
});
