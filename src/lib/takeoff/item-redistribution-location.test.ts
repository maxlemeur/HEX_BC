import { describe, expect, it } from "vitest";

import { redistributionLocation } from "@/lib/takeoff/item-redistribution-location";
import type { TakeoffJobPlanLocation } from "@/lib/takeoff/plan-location-contracts";

const source = { part_id: "p", job_id: "j", file_id: "f", hash: "hash", revision: 2, name: "Plan" };
const plan = (building: string | null, level: string) => ({
  plan_file_id: "f", status: "current", replacement: null, reading_issue: null,
  revision: { content_hash: "hash" }, annotation: { revision: 2 },
  location: {
    building: { value: building, state: building ? "confirmed" : "unknown", origin: building ? "operator" : null },
    level: { value: level, state: "corrected", origin: "operator" },
  },
}) as TakeoffJobPlanLocation;

describe("current plan compartments for confirmed parts", () => {
  it("separates confirmed floors when the building reading has no candidate", () => {
    expect(["RDC", "R+1"].map((level) => redistributionLocation(source, plan(null, level), "by_level", false).key))
      .toEqual(['level:[null,"rdc"]', 'level:[null,"r+1"]']);
  });
  it("places several floors in one confirmed building, and distinguishes an unknown building", () => {
    expect(["RDC", "R+1"].map((level) => redistributionLocation(source, plan("A", level), "by_building", true).key))
      .toEqual(['building:["a"]', 'building:["a"]']);
    expect(redistributionLocation(source, plan(null, "RDC"), "by_level", true).key).toBe("unallocated");
  });
  it("uses the correction read now, and blocks a replaced, missing or unreadable file", () => {
    expect(redistributionLocation(source, plan("A", "Combles"), "by_level", true).key).toBe('level:["a","combles"]');
    for (const file of [undefined, { ...plan(null, "RDC"), reading_issue: "unreadable" as const },
      { ...plan(null, "RDC"), status: "changed" as const }]) {
      expect(redistributionLocation(source, file, "together", false).available).toBe(false);
    }
  });
});
