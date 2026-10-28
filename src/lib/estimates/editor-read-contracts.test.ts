import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchEstimateEditorData } from "@/lib/estimates/client";
import { parseEstimateEditorResponse } from "@/lib/estimates/editor-read-contracts";
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

  it("preserves the complete v3 document and its microsecond revision", async () => {
    const data = editorResponse();
    respondWith(data);
    const result = await fetchEstimateEditorData(VERSION_ID);
    expect(result.version).toEqual(data.version);
    expect(result.items).toEqual(data.items);
    expect(result.supplyTypes).toEqual([]);
  });

  it.each([1, 2, 3])("preserves engine %i and stored amounts without applying current defaults", async (engine) => {
    const data = editorResponse();
    const version = {
      ...data.version, calc_engine_version: engine, status: "sent",
      sale_coefficient_fo: engine === 3 ? 1.3 : null,
      sale_coefficient_mo: engine === 3 ? 1.2 : null,
      rounding_adjustment_cents: -7,
      calc_snapshot_context: { engine, legacy_extension: { historic: true } },
    };
    respondWith({ ...data, version });
    const result = await fetchEstimateEditorData(VERSION_ID);
    expect(result.version).toEqual(version);
    expect(result.items[0].line_total_ht_cents).toBe(2600);
  });

  it("preserves null prices for non-priced lines and the source and supplier evidence", async () => {
    const data = editorResponse();
    const item = {
      ...data.items[0], pricing_status: "not_priced", unit_price_ht_cents: null,
      pu_ht_cents: null, quantity: null, line_total_ht_cents: 0, line_tax_cents: 0, line_total_ttc_cents: 0,
      selected_supplier_details: { price_id: PROJECT_ID, name: "Fournisseur test", reference: "CU-01" },
      source_level: "B", source_extracted_at: data.version.updated_at, source_version_number: 2,
      source_metadata: { kind: "assembly_library", library_origin: { source_metadata: { note: "À confirmer" } } },
      line_truth: {
        source: { kind: "plan", label: "Plan", detail: null },
        qtyStatus: { code: "to_confirm", label: "À confirmer", detail: null },
        confidence: { label: "moyenne", score: 0.6, detail: null }, needsReview: true,
      },
    };
    respondWith({ ...data, items: [item] });
    expect((await fetchEstimateEditorData(VERSION_ID)).items).toEqual([item]);
  });

  it("accepts the established camelCase transport names after validating the same document", async () => {
    const data = editorResponse();
    respondWith({
      estimateVersion: data.version, estimateItems: data.items,
      estimateCategories: data.categories, supplyTypes: data.supply_types,
      laborRoles: data.labor_roles, marginTiers: data.margin_tiers,
      suggestionRules: data.suggestion_rules, versionZeroSummary: null,
    });
    expect((await fetchEstimateEditorData(VERSION_ID)).items).toEqual(data.items);
  });

  it("keeps the export calculation context in the shared wire contract", () => {
    const data = { ...editorResponse(), is_labor_split_enabled: true };
    expect(parseEstimateEditorResponse(data, VERSION_ID)).toEqual(data);
  });

  it("validates opaque metadata as JSON without losing nested evidence", () => {
    const data = editorResponse();
    expect(() => parseEstimateEditorResponse({
      ...data, version: { ...data.version, calc_snapshot_context: () => "not JSON" },
    }, VERSION_ID)).toThrow();
  });

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
