import { describe, expect, it } from "vitest";

import {
  badRequest,
  conflict,
  forbidden,
  payloadTooLarge,
  unauthorized,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import {
  TakeoffError,
  TakeoffErrorCode,
  mapGeminiErrorToTakeoffError,
  toTakeoffError,
  toTakeoffErrorResponse,
} from "@/lib/takeoff/errors";

describe("takeoff errors", () => {
  it("maps exceptions to stable takeoff codes and HTTP statuses", () => {
    const mappedBadRequest = toTakeoffError(badRequest("invalid payload"));
    expect(mappedBadRequest.status).toBe(400);
    expect(mappedBadRequest.code).toBe(TakeoffErrorCode.BAD_REQUEST);

    const mappedUnauthorized = toTakeoffError(unauthorized());
    expect(mappedUnauthorized.status).toBe(401);
    expect(mappedUnauthorized.code).toBe(TakeoffErrorCode.UNAUTHORIZED);

    const mappedModuleDisabled = toTakeoffError(
      forbidden(
        "Le module Takeoff est desactive pour ce tenant.",
        undefined,
        "TAKEOFF_MODULE_DISABLED"
      )
    );
    expect(mappedModuleDisabled.status).toBe(403);
    expect(mappedModuleDisabled.code).toBe(TakeoffErrorCode.TAKEOFF_MODULE_DISABLED);

    const mappedFileTooLarge = toTakeoffError(
      payloadTooLarge("File too large", undefined, "PAYLOAD_TOO_LARGE")
    );
    expect(mappedFileTooLarge.status).toBe(413);
    expect(mappedFileTooLarge.code).toBe(TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE);

    const mappedFileType = toTakeoffError(
      unprocessableEntity(
        "Unsupported file",
        undefined,
        "TAKEOFF_FILE_TYPE_INVALID"
      )
    );
    expect(mappedFileType.status).toBe(422);
    expect(mappedFileType.code).toBe(TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID);

    const mappedConflict = toTakeoffError(
      conflict(
        "La cle d'idempotence est deja utilisee avec un payload different.",
        { job_id: "4d476fd9-bce4-491e-ae7b-536d2da939de" },
        "IDEMPOTENCY_KEY_REUSED"
      )
    );
    expect(mappedConflict.status).toBe(409);
    expect(mappedConflict.code).toBe(TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED);

    const mappedUnknown = toTakeoffError(new Error("unexpected"), {
      logUnexpected: false,
    });
    expect(mappedUnknown.status).toBe(500);
    expect(mappedUnknown.code).toBe(TakeoffErrorCode.INTERNAL_ERROR);
  });

  it("returns a stable JSON envelope via toTakeoffErrorResponse", () => {
    const jobId = "4d476fd9-bce4-491e-ae7b-536d2da939de";
    const error = new TakeoffError({
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
      message: "Conflit d'idempotence.",
      retryable: false,
      jobId,
      level: "A",
      details: {
        reason: "DUPLICATE_PAYLOAD",
      },
    });

    const response = toTakeoffErrorResponse(error);

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED);
    expect(response.error.message).toBe("Conflit d'idempotence.");
    expect(response.error.retryable).toBe(false);
    expect(response.error.jobId).toBe(jobId);
    expect(response.error.level).toBe("A");
    expect(response.error.details).toMatchObject({
      reason: "DUPLICATE_PAYLOAD",
      retryable: false,
      jobId,
      job_id: jobId,
      level: "A",
    });
  });

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
