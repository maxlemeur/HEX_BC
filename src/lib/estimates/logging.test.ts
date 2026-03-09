import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/estimates/errors";

import { toSafeEstimateErrorLogDetails } from "./logging";

describe("toSafeEstimateErrorLogDetails", () => {
  it("preserves ApiError metadata for structured server logs", () => {
    const error = new ApiError({
      status: 404,
      code: "NOT_FOUND",
      message: "Estimate seal source not found.",
      details: { versionId: "ver_123" },
    });

    expect(toSafeEstimateErrorLogDetails(error)).toEqual({
      errorName: "ApiError",
      errorMessage: "Estimate seal source not found.",
      errorStatus: 404,
      errorCode: "NOT_FOUND",
      errorDetails: { versionId: "ver_123" },
    });
  });

  it("keeps the digest for framework errors", () => {
    const error = Object.assign(new Error("Boom"), { digest: "next_digest" });

    expect(toSafeEstimateErrorLogDetails(error)).toEqual({
      errorName: "Error",
      errorMessage: "Boom",
      errorDigest: "next_digest",
    });
  });

  it("falls back to a generic message for non-error values", () => {
    expect(toSafeEstimateErrorLogDetails("boom")).toEqual({
      errorMessage: "boom",
    });
  });
});
