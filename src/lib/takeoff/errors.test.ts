import { describe, expect, it } from "vitest";
import {
  TakeoffErrorCode,
  mapGeminiErrorToTakeoffError,
  toTakeoffErrorResponse,
} from "@/lib/takeoff/errors";

describe("takeoff errors", () => {

  it("sanitizes provider secrets from takeoff errors", () => {
    const providerError = new Error(
      "Gemini provider failed with key AIza123456789012345678901 and Bearer very-secret-token"
    ) as Error & { status?: number; details?: unknown; code?: string };
    providerError.status = 503;
    providerError.code = "PROVIDER_FAILURE";
    providerError.details = {
      apiKey: "AIza123456789012345678901",
      authorization: "Bearer very-secret-token",
      nested: {
        token: "nested-secret-token",
      },
    };

    const mapped = mapGeminiErrorToTakeoffError(providerError);
    const serialized = JSON.stringify(toTakeoffErrorResponse(mapped));

    expect(mapped.code).toBe(TakeoffErrorCode.AI_PROVIDER);
    expect(mapped.status).toBe(500);
    expect(mapped.retryable).toBe(true);
    expect(serialized).not.toContain("AIza123456789012345678901");
    expect(serialized).not.toContain("very-secret-token");
    expect(serialized).not.toContain("nested-secret-token");
    expect(serialized).toContain("REDACTED");
  });
});
