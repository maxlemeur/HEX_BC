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
});
