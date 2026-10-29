import { describe, expect, it } from "vitest";
import {
  parseTakeoffJobCreateResponse, parseTakeoffJobDetailResponse,
} from "@/lib/takeoff/job-response-contracts";
import { appliedJobFixture, takeoffItemFixture, JOB_ID, VERSION_ID, OTHER_ID, LINE_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const dispatch = { status: "accepted", correlation_id: OTHER_ID, persisted: false };
function creation() {
  return { id: JOB_ID, estimate_version_id: VERSION_ID, status: "applied", level: "A", source_file_name: "plans.pdf", created_at: NOW, dispatch };
}
function detail() {
  return { job: appliedJobFixture(), result: {
    id: LINE_ID, extracted_json: { items: [] }, warnings: [], tables: [], provider_meta: { source: "provider" }, raw_response: null,
    confidence: 0.9, token_count: 100, cost_cents: 1, duration_ms: 1000, created_at: NOW, updated_at: NOW,
  }, items: { data: [takeoffItemFixture()], pagination: { limit: 50, offset: 0, total: 1 } } };
}

describe("takeoff job transport response contracts", () => {
  it.each(["pending", "processing", "completed", "failed", "canceled", "applied"])("accepts creation idempotency replay at persisted status %s", (status) => {
    const data = { ...creation(), status };
    expect(parseTakeoffJobCreateResponse(data, { versionId: VERSION_ID.toUpperCase(), level: "A" })).toEqual(data);
  });
  it("retains real detail fields, nullable results and pages beyond the last item", () => {
    expect(parseTakeoffJobDetailResponse(detail(), { jobId: JOB_ID })).toEqual(detail());
    const emptyPage = { job: appliedJobFixture(), result: null, items: { data: [], pagination: { limit: 50, offset: 5, total: 1 } } };
    expect(parseTakeoffJobDetailResponse(emptyPage, { jobId: JOB_ID, itemsOffset: 5 })).toEqual(emptyPage);
  });
});
