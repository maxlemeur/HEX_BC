import { describe, expect, it } from "vitest";
import { buildTakeoffDiff } from "@/lib/takeoff/diff";
import { parseTakeoffJobCompareResponse } from "@/lib/takeoff/compare-response-contracts";
import { takeoffItemFixture, JOB_ID, OTHER_ID, LINE_ID } from "@/lib/takeoff/response-contracts.test-fixtures";

const identity = { jobId: JOB_ID, withJobId: OTHER_ID };
function comparison(threshold?: number) {
  return { base_job_id: JOB_ID, other_job_id: OTHER_ID, ...buildTakeoffDiff({
    baseItems: [takeoffItemFixture()], otherItems: [takeoffItemFixture({ id: LINE_ID, quantity: 13.5 })], threshold,
  }) };
}

describe("takeoff job comparison response contract", () => {
  it("preserves actual diff output, field kinds, quantities and compound keys", () => {
    expect(parseTakeoffJobCompareResponse(comparison(), identity)).toEqual(comparison());
    expect(comparison().changed[0].delta).toContainEqual(expect.objectContaining({ field: "quantity", before_value: 12.5, after_value: 13.5 }));
  });
  it.each([0.875, 0.5, 0.99])("matches the producer threshold normalization for %s", (threshold) => {
    const data = comparison(threshold);
    expect(parseTakeoffJobCompareResponse(data, { ...identity, threshold, jobId: JOB_ID.toUpperCase() })).toEqual(data);
  });
  it.each([
    { base_job_id: LINE_ID }, { other_job_id: JOB_ID }, { threshold: 0.7 },
    { summary: { ...comparison().summary, changed: 0 } },
    { summary: { ...comparison().summary, total_base: 3 } },
    { changed: [...comparison().changed, ...comparison().changed] },
    { changed: [{ ...comparison().changed[0], delta: [] }] },
    { changed: [{ ...comparison().changed[0], match_score: 2 }] },
    { changed: [{ ...comparison().changed[0], base_item: { ...takeoffItemFixture(), updated_at: "invalid" } }] },
    { changed: [{ ...comparison().changed[0], delta: [{ field: "quantity", kind: "text", label: "Quantité", before_value: "12", after_value: "13" }] }] },
  ])("rejects malformed or unrelated diff receipts %#", (patch) => {
    expect(() => parseTakeoffJobCompareResponse({ ...comparison(), ...patch }, identity)).toThrow();
  });
  it("retains empty comparisons and unchanged pairs", () => {
    const empty = { base_job_id: JOB_ID, other_job_id: OTHER_ID, ...buildTakeoffDiff({ baseItems: [], otherItems: [] }) };
    expect(parseTakeoffJobCompareResponse(empty, identity)).toEqual(empty);
    const unchanged = { base_job_id: JOB_ID, other_job_id: OTHER_ID, ...buildTakeoffDiff({
      baseItems: [takeoffItemFixture()], otherItems: [takeoffItemFixture({ id: LINE_ID })],
    }) };
    expect(parseTakeoffJobCompareResponse(unchanged, identity).unchanged).toHaveLength(1);
  });
});
