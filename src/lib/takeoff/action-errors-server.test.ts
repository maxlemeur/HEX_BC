import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { createEmptyTakeoffPreparation, evaluateTakeoffPreparation, TakeoffPreparationNotReadyError } from "@/lib/takeoff/preparation";
import { runSafeTakeoffAction } from "@/lib/takeoff/action-errors-server";
import { unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";

describe("public takeoff Server Action errors", () => {
  it("serializes an expected conflict and preserves the corrective message in the client", async () => {
    const result = await runSafeTakeoffAction(async () => {
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
        message: "Le plan a changé. Vérifiez sa version avant de confirmer.", retryable: false,
        details: { sql: "private internals" } });
    });
    const received = JSON.parse(JSON.stringify(result));
    expect(received).toEqual({ ok: false, error: { status: 409, code: "CONFLICT", message: "Le plan a changé. Vérifiez sa version avant de confirmer.", retryable: false } });
    expect(() => unwrapTakeoffActionResult(received)).toThrow("Vérifiez sa version");
  });

  it("returns a business prerequisite as an expected field correction", async () => {
    const readiness = evaluateTakeoffPreparation(createEmptyTakeoffPreparation());
    const result = await runSafeTakeoffAction(async () => { throw new TakeoffPreparationNotReadyError(readiness); });
    expect(result).toMatchObject({ ok: false, error: { status: 422, code: "TAKEOFF_PREPARATION_INCOMPLETE", message: readiness.blockers[0].message } });
  });

  it("redacts unknown exceptions, internal API failures and validation input values", async () => {
    const secret = "Bearer secret-session-token postgres://private-db";
    const errors = [new Error(secret), new ApiError({ status: 500, code: "INTERNAL_ERROR", message: secret }), z.number().safeParse(secret).error];
    for (const error of errors) {
      const result = await runSafeTakeoffAction(async () => { throw error; });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain("postgres");
      expect(JSON.stringify(result)).not.toContain("stack");
    }
  });

  it("keeps an unapplied preparation migration explicit without exposing database details", async () => {
    const result = await runSafeTakeoffAction(async () => {
      throw new TakeoffError({ status: 503, code: TakeoffErrorCode.INTERNAL_ERROR,
        message: "internal implementation text", details: { reason: "PREPARATION_SCHEMA_REQUIRED" }, retryable: false });
    });
    expect(result).toMatchObject({ ok: false, error: { status: 503, code: "TAKEOFF_PREPARATION_SCHEMA_REQUIRED", retryable: false, message: expect.stringContaining("mise à jour de la base") } });
    expect(JSON.stringify(result)).not.toContain("implementation");
  });
});
