import { describe, expect, it } from "vitest";
import { parseTakeoffPreviewConversionResponse } from "@/lib/takeoff/apply-response-contracts";
import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import { takeoffItemFixture, JOB_ID, LINE_ID, OTHER_ID } from "@/lib/takeoff/response-contracts.test-fixtures";

function preview() {
  return { job_id: JOB_ID, strategy: "replace", target_section_id: null,
    ...computeTakeoffMappingPreview({ items: [takeoffItemFixture()], rules: [], overrides: [{
      item_id: OTHER_ID, action: "apply_assembly", action_params: { assembly_id: LINE_ID },
    }] }),
  };
}

describe("takeoff apply and preview response contracts", () => {
  it("preserves a replace preview without a target section and counts assembly exclusions correctly", () => {
    const data = preview();
    expect(parseTakeoffPreviewConversionResponse(data, { jobId: JOB_ID, strategy: "replace" })).toEqual(data);
    expect(data.summary).toMatchObject({ included_count: 1, transformed_count: 1, overridden_count: 1, excluded_by_mapping_count: 1, assembly_insertions_count: 1 });
  });
});
