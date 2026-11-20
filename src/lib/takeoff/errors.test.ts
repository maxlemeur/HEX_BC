import { describe, expect, it } from "vitest";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffErrorResponse,
} from "@/lib/takeoff/errors";

describe("takeoff errors", () => {

  it("sanitizes provider secrets from takeoff error details", () => {
    const providerError = new Error(
      "Provider failed with key AIza123456789012345678901 and Bearer very-secret-token"
    );

    const error = new TakeoffError({
      code: TakeoffErrorCode.AI_PROVIDER,
      retryable: false,
      details: {
        apiKey: "AIza123456789012345678901",
        authorization: "Bearer very-secret-token",
        nested: {
          token: "nested-secret-token",
        },
        cause: providerError,
      },
    });
    const serialized = JSON.stringify(toTakeoffErrorResponse(error));

    expect(serialized).not.toContain("AIza123456789012345678901");
    expect(serialized).not.toContain("very-secret-token");
    expect(serialized).not.toContain("nested-secret-token");
    expect(serialized).toContain("REDACTED");
  });
});
