import { describe, expect, it } from "vitest";
import { parseSaveTakeoffDpgfManualLinkResponse, parseSaveTakeoffReviewDecisionResponse } from "@/lib/takeoff/review-response-contracts";
import { decisionFixture } from "@/lib/takeoff/read-contracts.test-fixtures";
import { JOB_ID, VERSION_ID, LINE_ID, OTHER_ID, EVIDENCE_ID, ACTOR_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const identity = { jobId: JOB_ID, versionId: VERSION_ID, lineId: LINE_ID };
const link = () => ({
  id: EVIDENCE_ID, tenant_id: ACTOR_ID, version_id: VERSION_ID, takeoff_job_id: JOB_ID,
  estimate_item_id: LINE_ID, takeoff_item_id: OTHER_ID, created_at: NOW, updated_at: NOW, linked_by: null,
});

describe("takeoff manual link and review response contracts", () => {
  it("preserves deduplicated links, empty unlinking and UUID case", () => {
    expect(parseSaveTakeoffDpgfManualLinkResponse({ links: [link()] }, { ...identity, itemIds: [OTHER_ID, OTHER_ID.toUpperCase()] })).toEqual({ links: [link()] });
    expect(parseSaveTakeoffDpgfManualLinkResponse({ links: [] }, { ...identity, itemIds: [] })).toEqual({ links: [] });
  });
  it("preserves absent review reason as null", () => {
    const data = { decision: { ...decisionFixture(), reason: null } };
    expect(parseSaveTakeoffReviewDecisionResponse(data, { ...identity, decision: "keep_dpgf" })).toEqual(data);
  });
});
