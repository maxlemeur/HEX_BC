import { describe, expect, it } from "vitest";
import { normalizeTakeoffJobRow, parseTakeoffLevel } from "@/lib/takeoff/job-creation-input";
import { normalizeTakeoffJobSummaryRow } from "@/lib/takeoff/job-read-server";
import { toTakeoffError } from "@/lib/takeoff/errors";
import { appliedJobFixture } from "@/lib/takeoff/response-contracts.test-fixtures";

describe("job normalizers use the public status and level enums", () => {
  it("retains legitimate applied and provider metadata without changing normalization defaults", () => {
    const job = appliedJobFixture();
    const normalized = normalizeTakeoffJobSummaryRow({ ...job, ...job.metrics });
    expect(normalized).toMatchObject({ status: "applied", level: "A", processing_strategy: null, provider_batch_state: null, metrics: job.metrics });
    expect(normalizeTakeoffJobRow(job)).toMatchObject({ status: "applied", level: "A", id: job.id });
  });
  it.each([{ status: "invalid" }, { level: "invalid" }])("rejects malformed database enum values before the response boundary %#", (patch) => {
    const job = appliedJobFixture();
    for (const normalize of [
      () => normalizeTakeoffJobSummaryRow({ ...job, ...job.metrics, ...patch }),
      () => normalizeTakeoffJobRow({ ...job, ...patch } as never),
    ]) {
      let failure: unknown;
      try { normalize(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(toTakeoffError(failure, { logUnexpected: false })).toMatchObject({ status: 500, code: "INTERNAL_ERROR", retryable: false });
    }
  });
  it("preserves deterministic input errors", () => {
    const form = new FormData();
    form.set("level", "invalid");
    try { parseTakeoffLevel(form); } catch (error) {
      expect(toTakeoffError(error)).toMatchObject({ status: 422, code: "TAKEOFF_LEVEL_UNSUPPORTED" });
      return;
    }
    throw new Error("The malformed level was accepted.");
  });
});
