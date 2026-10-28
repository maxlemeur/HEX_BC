import { describe, expect, it } from "vitest";
import { parseTakeoffItemBatchPatchResponse } from "@/lib/takeoff/item-response-contracts";
import { takeoffItemFixture, OTHER_ID, LINE_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const success = () => ({ item_id: OTHER_ID, success: true, item: takeoffItemFixture() });
const failure = () => ({ item_id: LINE_ID, success: false, error: "Conflit de concurrence" });
const response = () => ({ results: [success(), failure()], succeeded: 1, failed: 1 });

describe("takeoff partial item response contract", () => {
  it("retains ordered partial outcomes and database timestamp precision", () => {
    const data = response();
    expect(parseTakeoffItemBatchPatchResponse(data, [OTHER_ID.toUpperCase(), LINE_ID])).toEqual(data);
    expect(data.results[0]).toMatchObject({ item: { updated_at: NOW } });
  });
  it("preserves repeated requested IDs as distinct sequential results", () => {
    const data = { results: [success(), { ...failure(), item_id: OTHER_ID }], succeeded: 1, failed: 1 };
    expect(parseTakeoffItemBatchPatchResponse(data, [OTHER_ID, OTHER_ID])).toEqual(data);
  });
  it.each([
    { succeeded: 2 }, { failed: 0 }, { succeeded: 0.5 }, { results: [failure(), success()] },
    { results: [success()] }, { results: [success(), failure(), failure()] },
    { results: [{ ...success(), item: { ...takeoffItemFixture(), id: LINE_ID } }, failure()] },
    { results: [{ item_id: OTHER_ID, success: true }, failure()] },
    { results: [{ ...success(), error: "also failed" }, failure()] },
    { results: [success(), { ...failure(), item: takeoffItemFixture() }] },
    { results: [success(), { ...failure(), error: null }] },
    { results: [{ ...success(), item: { ...takeoffItemFixture(), quantity: -1 } }, failure()] },
    { results: [{ ...success(), item: { ...takeoffItemFixture(), updated_at: "invalid" } }, failure()] },
  ])("rejects malformed or misattributed partial results %#", (patch) => {
    expect(() => parseTakeoffItemBatchPatchResponse({ ...response(), ...patch }, [OTHER_ID, LINE_ID])).toThrow();
  });
});
