import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchEstimateEditorData } from "@/lib/estimates/client";
import { createEstimateEditorResponseFixture as editorResponse } from "@/test/fixtures/estimate-editor-response";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function respondWith(data: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ ok: true, data }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )));
}

describe("estimate editor read contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["a nonnumeric quantity", { quantity: "not-a-number" }],
    ["a nonnumeric price", { unit_price_ht_cents: "not-a-number" }],
    ["fractional cents", { unit_price_ht_cents: 1000.5 }],
    ["an item of another version", { version_id: PROJECT_ID }],
    ["an item of another tenant", { tenant_id: PROJECT_ID }],
    ["an unknown pricing status", { pricing_status: "unexpected" }],
  ])("rejects %s before it enters the editor", async (_name, patch) => {
    const data = editorResponse();
    respondWith({ ...data, items: [{ ...data.items[0], ...patch }] });
    await expect(fetchEstimateEditorData(VERSION_ID)).rejects.toThrow();
  });

  it("rejects an incomplete version", async () => {
    respondWith({ ...editorResponse(), version: { id: VERSION_ID } });
    await expect(fetchEstimateEditorData(VERSION_ID)).rejects.toThrow();
  });

  it("rejects a complete response for another requested version", async () => {
    respondWith(editorResponse());
    await expect(fetchEstimateEditorData(PROJECT_ID)).rejects.toThrow();
  });

  it("rejects a missing item collection instead of interpreting it as an empty estimate", async () => {
    respondWith({ ...editorResponse(), items: undefined });
    await expect(fetchEstimateEditorData(VERSION_ID)).rejects.toThrow();
  });

  it("rejects duplicate rows in an otherwise complete document", async () => {
    const data = editorResponse();
    respondWith({ ...data, items: [...data.items, ...data.items] });
    await expect(fetchEstimateEditorData(VERSION_ID)).rejects.toThrow();
  });

  it("rejects malformed reference data before applying any of the document", async () => {
    const data = editorResponse();
    respondWith({ ...data, labor_roles: [{ id: PROJECT_ID, hourly_rate_cents: "incorrect" }] });
    await expect(fetchEstimateEditorData(VERSION_ID)).rejects.toThrow();
  });

  it("rejects a version-zero summary belonging to another estimate", async () => {
    respondWith({ ...editorResponse(), version_zero_summary: {
      versionId: PROJECT_ID, projectId: PROJECT_ID, hasConfirmedBrief: false,
      confirmedBriefId: null, isVersionEmpty: false, canGenerate: false,
      availableLots: [], activeDraft: null,
    } });
    await expect(fetchEstimateEditorData(VERSION_ID)).rejects.toThrow();
  });
});
