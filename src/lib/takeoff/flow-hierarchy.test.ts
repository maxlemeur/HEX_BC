import { describe, expect, it } from "vitest";

import {
  countLegacyPlanSets,
  resolvePlanSetFlowDescriptor,
} from "@/lib/takeoff/flow-hierarchy";

describe("resolvePlanSetFlowDescriptor", () => {
  it("marks affaire-scoped plan sets as principal flow", () => {
    expect(
      resolvePlanSetFlowDescriptor({
        estimate_version_id: null,
      })
    ).toMatchObject({
      kind: "principal",
      label: "Flux principal",
    });
  });

  it("marks version-scoped plan sets as explicit legacy fallback", () => {
    expect(
      resolvePlanSetFlowDescriptor({
        estimate_version_id: "22222222-2222-4222-8222-222222222222",
      })
    ).toMatchObject({
      kind: "legacy",
      label: "Fallback legacy",
    });
  });
});

describe("countLegacyPlanSets", () => {
  it("counts only version-scoped legacy plan sets", () => {
    expect(
      countLegacyPlanSets([
        { estimate_version_id: null },
        { estimate_version_id: "22222222-2222-4222-8222-222222222222" },
        { estimate_version_id: "33333333-3333-4333-8333-333333333333" },
      ])
    ).toBe(2);
  });
});
