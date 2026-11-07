import { describe, expect, it } from "vitest";

import { takeoffApplyOverrideItemState } from "@/lib/takeoff/apply-override-state";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { prepareRuleResultWrite } from "@/lib/takeoff/rules/result-identity";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

const id = (n: number) => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function result(rule: "room_overlap" | "zone_overlap", ids: string[]): TakeoffRuleResult {
  const details = rule === "room_overlap" ? { overlapping_item_ids: ids, overlap_count: ids.length } :
    { partners: ids.map((item_id) => ({ item_id, job_id: id(0), designation: "EF", overlap_m: 8, resolved: false, zone: "Z2" })), partner_count: ids.length };
  return { rule, details, code: rule === "room_overlap" ? "ROOM_OVERLAP" : "ZONE_OVERLAP_DUPLICATE", version: 1,
    acceptable: true, status: "fail", reason: "Superposition mesurée." };
}

function override(results: TakeoffRuleResult[]) {
  return takeoffApplyOverrideItemState({ id:id(0), quantity:1, unit:"ml", updated_at:"stable", rule_results:results,
    rules_stale:false, designation:"EF", is_verified:true }).rule_failures;
}

describe("identities of overlapping partners beyond the displayed results", () => {
  it.each([["zone_overlap",51],["room_overlap",3000]] as const)("preserves every %s identity privately", (rule,size) => {
    const ids = Array.from({length:size}, (_,i) => id(i+1));
    const write = prepareRuleResultWrite([result(rule,ids)]);
    expect(write.complete_failure_keys).toHaveLength(size);
    expect(write.complete_failure_keys?.at(-1)).toContain(ids.at(-1));
    expect(jsonbTextBytes(write.results)).toBeLessThanOrEqual(65536);
    expect(write.results[0].details?.failure_keys_sha256).toMatch(/^[a-f0-9]{64}$/);
    const replaced = prepareRuleResultWrite([result(rule,[...ids.slice(0,-1),id(size+1)])]);
    expect(override(replaced.results)).not.toEqual(override(write.results));
    expect(override(prepareRuleResultWrite([result(rule,[...ids].reverse())]).results)).toEqual(override(write.results));
  });

  it("sends no separate keys when all 50 partners are shown", () => {
    const ids = Array.from({ length:50 },(_,i) => id(i+1));
    const entry = result("zone_overlap",ids);
    expect(prepareRuleResultWrite([entry])).toEqual({results:[entry]});
  });
});
