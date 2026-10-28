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
  it.each([
    { takeoff_job_id: OTHER_ID }, { version_id: OTHER_ID }, { estimate_item_id: OTHER_ID },
    { takeoff_item_id: LINE_ID }, { updated_at: "invalid" }, { id: "invalid" },
  ])("rejects an unrelated or malformed link %#", (patch) => {
    expect(() => parseSaveTakeoffDpgfManualLinkResponse({ links: [{ ...link(), ...patch }] }, { ...identity, itemIds: [OTHER_ID] })).toThrow();
  });
  it("rejects an incomplete set or duplicated link IDs", () => {
    expect(() => parseSaveTakeoffDpgfManualLinkResponse({ links: [] }, { ...identity, itemIds: [OTHER_ID] })).toThrow();
    expect(() => parseSaveTakeoffDpgfManualLinkResponse({ links: [link(), link()] }, { ...identity, itemIds: [OTHER_ID] })).toThrow();
  });
  it.each([1, 2, 3])("preserves the saved decision and provenance from version %s", (sourceVersion) => {
    const data = { decision: { ...decisionFixture(), source: "carried_over", carried_over_from_version_id: OTHER_ID, carried_over_from_version_number: sourceVersion } };
    expect(parseSaveTakeoffReviewDecisionResponse(data, { ...identity, decision: "keep_dpgf", reason: " Quantité contrôlée " })).toEqual(data);
  });
  it("preserves absent review reason as null", () => {
    const data = { decision: { ...decisionFixture(), reason: null } };
    expect(parseSaveTakeoffReviewDecisionResponse(data, { ...identity, decision: "keep_dpgf" })).toEqual(data);
  });
  it.each([
    { version_id: OTHER_ID }, { estimate_item_id: OTHER_ID }, { takeoff_job_id: OTHER_ID }, { decision: "manual_fix" }, { reason: "Different reason" },
  ])("rejects a decision that does not acknowledge the request %#", (patch) => {
    expect(() => parseSaveTakeoffReviewDecisionResponse({ decision: { ...decisionFixture(), ...patch } }, {
      ...identity, decision: "keep_dpgf", reason: "Quantité contrôlée",
    })).toThrow();
  });
});
