import { describe, expect, it } from "vitest";

import {
  parseBulkUpdateEstimateItemsResponse, parseCreateEstimateResponse, parseEstimateEventsResponse,
  parseEstimateItemWriteResponse, parseEstimateStatusResponse, parseEstimateVersionIdResponse,
  parsePromoteEstimateVariantResponse, parseSaveEstimateVersionResponse, parseVerifyEstimateSealResponse,
} from "@/lib/estimates/write-response-contracts";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

const fixture = createEstimateEditorResponseFixture();
const { estimate_projects: project, ...version } = fixture.version;
const item = fixture.items[0];
const token = { id: version.id, updated_at: version.updated_at };
const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectRow = { ...project, tenant_id: version.tenant_id };
const event = {
  id: other, estimate_version_id: version.id, event_type: "seal_verified", metadata: {},
  created_by: null, actor_name: null, occurred_at: version.updated_at, created_at: version.updated_at,
};

describe("estimate mutation response contracts", () => {
  it("accepts persisted settings without the GET join and preserves timestamp microseconds", () => {
    const result = parseSaveEstimateVersionResponse({ version, items: [item] }, version.id.toUpperCase());
    expect(result.version.updated_at).toBe("2026-10-28T10:00:00.123456Z");
    expect(result.version).not.toHaveProperty("estimate_projects");
  });

  it.each([
    { version: { ...version, content_revision: undefined }, items: [item] },
    { version, items: [item, { ...item, id: item.id.toUpperCase() }] },
    { version, items: [{ ...item, tenant_id: other }] },
    { version, items: [{ ...item, version_id: other }] },
    { version: { ...version, total_ttc_cents: 1 }, items: [] },
    { version: { ...version, status: "success" }, items: [] },
    { version, items: [{ ...item, line_tax_cents: Number.MAX_SAFE_INTEGER + 1 }] },
    { version, items: [{ ...item, line_total_ttc_cents: 1 }] },
  ])("rejects incomplete or inconsistent settings receipts %#", (receipt) => {
    expect(() => parseSaveEstimateVersionResponse(receipt, version.id)).toThrow();
  });

  it("keeps old item receipts without revisions and conversion details", () => {
    expect(parseEstimateItemWriteResponse({ estimateItem: item, versionToken: token, converted_from_item_type: "section" }, version.id, item.id))
      .toMatchObject({ item, version: token, converted_from_item_type: "section" });
  });

  it("rejects foreign item/version identities", () => {
    expect(() => parseEstimateItemWriteResponse({ item, version: token }, version.id, other)).toThrow();
    expect(() => parseEstimateItemWriteResponse({ item: { ...item, version_id: other }, version: token }, version.id)).toThrow();
  });

  it("accepts recalculated counts larger than requested updates and historical missing totals", () => {
    expect(parseBulkUpdateEstimateItemsResponse({ updated_count: 2031, version: token }, version.id))
      .toEqual({ updated_count: 2031, version: token });
    expect(parseBulkUpdateEstimateItemsResponse({ updated_count: 0, version: token }, version.id).updated_count).toBe(0);
  });

  it.each([
    { version: token }, { updated_count: -1, version: token }, { updated_count: 0.5, version: token },
    { updated_count: 1, version: { ...token, content_revision: -1 } },
    { updated_count: 1, version: token, totals: null },
    { updated_count: 1, version: token, totals: { total_ht_cents: 100, total_tax_cents: 20, total_ttc_cents: 121 } },
    { updated_count: 1, version: token, totals: { total_ht_cents: Number.MAX_SAFE_INTEGER + 1, total_tax_cents: 0, total_ttc_cents: Number.MAX_SAFE_INTEGER + 1 } },
  ])("rejects invalid bulk receipts instead of fabricating counts or totals %#", (receipt) => {
    expect(() => parseBulkUpdateEstimateItemsResponse(receipt, version.id)).toThrow();
  });

  it("requires the requested status and the same promoted standalone draft", () => {
    expect(() => parseEstimateStatusResponse({ version }, version.id, "sent")).toThrow();
    expect(parseEstimateStatusResponse({ version }, version.id, "draft").version.id).toBe(version.id);
    expect(parsePromoteEstimateVariantResponse({ version }, version.id).version.id).toBe(version.id);
    for (const patch of [{ id: other }, { parent_version_id: other }, { variant_label: "B" }, { status: "sent" }]) {
      expect(() => parsePromoteEstimateVariantResponse({ version: { ...version, ...patch } }, version.id)).toThrow();
    }
  });

  it("validates creation project ownership and newly duplicated version identity", () => {
    expect(parseCreateEstimateResponse({ project: projectRow, version }, project.id).version.id).toBe(version.id);
    expect(() => parseCreateEstimateResponse({ project: { ...projectRow, tenant_id: other }, version })).toThrow();
    expect(() => parseCreateEstimateResponse({ project: projectRow, version }, other)).toThrow();
    expect(parseEstimateVersionIdResponse({ duplicatedVersionId: other }, version.id)).toEqual({ version_id: other });
    expect(() => parseEstimateVersionIdResponse({ version_id: version.id.toUpperCase() }, version.id)).toThrow();
  });

  it("keeps event aliases and rejects malformed or foreign rows instead of dropping them", () => {
    expect(parseEstimateEventsResponse({ events: [event] }, version.id).events[0])
      .toMatchObject({ estimateVersionId: version.id, eventType: "seal_verified", createdBy: null });
    for (const row of [{ ...event, estimate_version_id: other }, { ...event, metadata: null }, { ...event, occurred_at: "yesterday" }, {}]) {
      expect(() => parseEstimateEventsResponse({ events: [row] }, version.id)).toThrow();
    }
    expect(() => parseEstimateEventsResponse({}, version.id)).toThrow();
  });

  it("preserves negative historical seal verification with no stored hash", () => {
    const result = { valid: false, computed_hash: "a".repeat(64), stored_hash: null, seal_payload_version: null };
    expect(parseVerifyEstimateSealResponse(result)).toEqual(result);
    expect(parseVerifyEstimateSealResponse({ ...result, stored_hash: "historical-corrupt-hash" }).valid).toBe(false);
    expect(() => parseVerifyEstimateSealResponse({ ...result, valid: true })).toThrow();
    expect(() => parseVerifyEstimateSealResponse({ ...result, computed_hash: "bad" })).toThrow();
  });
});
