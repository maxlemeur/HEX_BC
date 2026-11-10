import { describe, expect, it } from "vitest";

import { readTakeoffProvision } from "@/lib/estimates/takeoff-provision";

// TI-686 D10/D12: the takeoff application writes source_metadata.takeoff_provision on an estimate line built from a
// forced takeoff line or from a quantity entered as a hypothesis (private.takeoff_mark_provisions). The marker states
// facts; how the line reaches the offer is the default treatment, an internal provision (H9, H18).
const JOB_ID = "c3000000-0000-4000-8000-000000000201";
const FORCED = { takeoff_item_id: "c3000000-0000-4000-8000-000000000301", forced: true, forced_reason: null, entry_category: null };
const HYPOTHESIS = {
  takeoff_item_id: "c3000000-0000-4000-8000-000000000303", forced: false, forced_reason: null, entry_category: "hypothesis",
};
const marker = (...sources: unknown[]) => ({ takeoff_item_id: FORCED.takeoff_item_id,
  takeoff_provision: { version: 1, job_id: JOB_ID, sources } });

describe("readTakeoffProvision", () => {
  it("reads no provision without the marker", () => {
    expect(readTakeoffProvision({ takeoff_item_id: FORCED.takeoff_item_id })).toBeNull();
    expect(readTakeoffProvision({ takeoff_item_id: FORCED.takeoff_item_id, takeoff_provision: null })).toBeNull();
    expect(readTakeoffProvision(null)).toBeNull();
    expect(readTakeoffProvision("takeoff_provision")).toBeNull();
  });

  it("reads a forced line as an internal provision, treated as such in the offer", () => {
    expect(readTakeoffProvision(marker(FORCED))).toEqual({
      kind: "internal_provision", treatment: "internal_provision", readable: true, sources: [FORCED],
    });
  });

  it("reads a quantity entered as a hypothesis, or forced as a priced hypothesis, as a hypothesis", () => {
    expect(readTakeoffProvision(marker(FORCED, HYPOTHESIS))).toMatchObject({
      kind: "hypothesis", treatment: "internal_provision", sources: [FORCED, HYPOTHESIS],
    });
    expect(readTakeoffProvision(marker({ ...FORCED, forced_reason: "priced_hypothesis" }))).toMatchObject({ kind: "hypothesis" });
  });

  it("counts an unreadable marker as an internal provision, never as no marker", () => {
    for (const unreadable of [{}, "provision", { version: 2, job_id: JOB_ID, sources: [FORCED] },
      { version: 1, job_id: JOB_ID, sources: [] }, { version: 1, job_id: JOB_ID, sources: [{ forced: "yes" }] }]) {
      expect(readTakeoffProvision({ takeoff_provision: unreadable })).toEqual({
        kind: "internal_provision", treatment: "internal_provision", readable: false, sources: [],
      });
    }
  });
});
