import { describe, expect, it } from "vitest";
import { normalizeTakeoffApplySummary } from "@/lib/takeoff/apply-preparation";
import { parseTakeoffApplyResponse, parseTakeoffPreviewConversionResponse } from "@/lib/takeoff/apply-response-contracts";
import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import { appliedJobFixture, takeoffItemFixture, JOB_ID, VERSION_ID, LINE_ID, OTHER_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const identity = { jobId: JOB_ID, versionId: VERSION_ID };
function application() {
  return { job: appliedJobFixture(), summary: {
    scope: "version", created_count: 1, updated_count: 0, ignored_count: 0,
    created_ids: [LINE_ID], item_links: [{ takeoff_item_id: OTHER_ID, estimate_item_id: LINE_ID }],
  } };
}
function preview() {
  return { job_id: JOB_ID, strategy: "replace", target_section_id: null,
    ...computeTakeoffMappingPreview({ items: [takeoffItemFixture()], rules: [], overrides: [{
      item_id: OTHER_ID, action: "apply_assembly", action_params: { assembly_id: LINE_ID },
    }] }),
  };
}

describe("takeoff apply and preview response contracts", () => {
  it("preserves a confirmed apply with its job, persisted item links and timestamps", () => {
    expect(parseTakeoffApplyResponse(application(), identity)).toEqual(application());
    expect(parseTakeoffApplyResponse(application(), { ...identity, jobId: JOB_ID.toUpperCase() }).job.updated_at).toBe(NOW);
  });
  it.each([
    { created_items_count: 2, updated_items_count: 1, ignored_items_count: 0 },
    [{ summary: { created_count: 2, updated_count: 1, created_item_ids: [LINE_ID] } }],
    { created_count: 3, created_ids: [LINE_ID], item_links: [{ takeoff_item_id: OTHER_ID, estimate_item_id: LINE_ID }] },
  ])("retains normalized legacy RPC counts and optional detail %#", (rpcData) => {
    const summary = normalizeTakeoffApplySummary({ rpcData, jobId: JOB_ID, request: { strategy: "append" } });
    expect(parseTakeoffApplyResponse({ job: appliedJobFixture(), summary }, identity).summary).toEqual(summary);
  });
  it.each([
    { id: OTHER_ID }, { estimate_version_id: OTHER_ID }, { status: "completed" }, { level: "invalid" },
    { updated_at: "invalid" }, { metrics: { token_count: -1, cost_cents: 0, duration_ms: 1 } },
  ])("rejects a malformed or unconfirmed applied job %#", (patch) => {
    expect(() => parseTakeoffApplyResponse({ ...application(), job: { ...appliedJobFixture(), ...patch } }, identity)).toThrow();
  });
  it.each([
    { created_count: 0 }, { updated_count: -1 }, { ignored_count: 0.1 }, { created_ids: [LINE_ID, LINE_ID] },
    { item_links: [{ takeoff_item_id: "invalid", estimate_item_id: LINE_ID }] }, { scope: "section" },
  ])("rejects invalid apply counters, IDs or scope %#", (patch) => {
    const data = application();
    expect(() => parseTakeoffApplyResponse({ ...data, summary: { ...data.summary, ...patch } }, identity)).toThrow();
  });
  it("preserves a replace preview without a target section and counts assembly exclusions correctly", () => {
    const data = preview();
    expect(parseTakeoffPreviewConversionResponse(data, { jobId: JOB_ID, strategy: "replace" })).toEqual(data);
    expect(data.summary).toMatchObject({ included_count: 1, transformed_count: 1, overridden_count: 1, excluded_by_mapping_count: 1, assembly_insertions_count: 1 });
  });
  it.each([
    { job_id: OTHER_ID }, { strategy: "append" }, { target_section_id: LINE_ID },
    { summary: { ...preview().summary, included_count: 0 } },
    { summary: { ...preview().summary, assembly_insertions_count: 2 } },
    { items: [{ ...preview().items[0], source_order: 3 }] },
    { items: [{ ...preview().items[0], transformed: { ...preview().items[0].transformed, quantity: "wrong" } }] },
  ])("rejects malformed or unrelated conversion previews %#", (patch) => {
    expect(() => parseTakeoffPreviewConversionResponse({ ...preview(), ...patch }, { jobId: JOB_ID, strategy: "replace" })).toThrow();
  });
});
