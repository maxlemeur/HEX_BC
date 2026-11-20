import { describe, expect, it } from "vitest";
import { z } from "zod";
import { takeoffJobSummaryResponseSchema } from "@/lib/takeoff/apply-response-contracts";
import { parseTakeoffJobDetailResponse } from "@/lib/takeoff/job-response-contracts";
import { takeoffReviewContextResponseSchema } from "@/lib/takeoff/review-context-contracts";
import { appliedJobFixture, takeoffItemFixture, JOB_ID, LINE_ID, NOW, OTHER_ID, VERSION_ID } from "@/lib/takeoff/response-contracts.test-fixtures";

function detail() {
  return { job: appliedJobFixture(), result: {
    id: LINE_ID, extracted_json: { items: [] }, warnings: [], tables: [], provider_meta: { source: "provider" }, raw_response: null,
    confidence: 0.9, token_count: 100, cost_cents: 1, duration_ms: 1000, created_at: NOW, updated_at: NOW,
  }, items: { data: [takeoffItemFixture()], pagination: { limit: 50, offset: 0, total: 1 } } };
}

describe("takeoff job transport response contracts", () => {
  it("retains real detail fields, nullable results and pages beyond the last item", () => {
    expect(parseTakeoffJobDetailResponse(detail(), { jobId: JOB_ID })).toEqual(detail());
    const emptyPage = { job: appliedJobFixture(), result: null, items: { data: [], pagination: { limit: 50, offset: 5, total: 1 } } };
    expect(parseTakeoffJobDetailResponse(emptyPage, { jobId: JOB_ID, itemsOffset: 5 })).toEqual(emptyPage);
  });

  it("accepts an affaire job without a version and requires its affaire identity", () => {
    const old = detail();
    const job = { ...old.job, status: "completed", project_id: OTHER_ID, estimate_version_id: null };
    expect(parseTakeoffJobDetailResponse({ ...old, job }, { jobId: JOB_ID }).job).toEqual(job);
    expect(() => parseTakeoffJobDetailResponse({ ...old, job: { ...job, project_id: undefined } }, { jobId: JOB_ID })).toThrow();
  });

  it("requires a destination for every financial comparison", () => {
    const context = { posts: [], unlinked_item_ids: [], item_pricing: [] };
    expect(takeoffReviewContextResponseSchema.parse({ ...context, version_id: VERSION_ID })).toEqual({ ...context, version_id: VERSION_ID });
    expect(takeoffReviewContextResponseSchema.parse({ ...context, version_id: null })).toEqual({ ...context, version_id: null });
    expect(takeoffReviewContextResponseSchema.safeParse({ ...context, version_id: null, unlinked_item_ids: [LINE_ID] }).success).toBe(false);
  });

  it("publishes the affaire requirement only for a job without a version", () => {
    const schema = z.toJSONSchema(takeoffJobSummaryResponseSchema);
    expect(schema.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ properties: expect.objectContaining({ estimate_version_id: expect.objectContaining({ type: "string" }) }),
        required: expect.not.arrayContaining(["project_id"]) }),
      expect.objectContaining({ properties: expect.objectContaining({ estimate_version_id: { type: "null" } }),
        required: expect.arrayContaining(["estimate_version_id", "project_id"]) }),
    ]));
  });
});
