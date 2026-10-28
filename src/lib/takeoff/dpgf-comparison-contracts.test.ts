import { describe, expect, it } from "vitest";

import { parseTakeoffDpgfComparisonResponse } from "@/lib/takeoff/dpgf-comparison-contracts";
import { comparisonFixture, decisionFixture, IDENTITY, JOB_ID, OTHER_ID } from "@/lib/takeoff/read-contracts.test-fixtures";

describe("DPGF comparison response contract", () => {
  it("retains actual engine output, compound proof IDs, quantities and nested metadata", () => {
    const data = comparisonFixture();
    expect(parseTakeoffDpgfComparisonResponse(data, IDENTITY)).toEqual(data);
  });

  it("compares canonical UUIDs case-insensitively and retains current decisions", () => {
    const data = comparisonFixture();
    data.rows[0].applied_decision = decisionFixture();
    expect(parseTakeoffDpgfComparisonResponse(data, {
      jobId: JOB_ID.toUpperCase(), versionId: IDENTITY.versionId.toUpperCase(),
    })).toEqual(data);
  });

  it.each([1, 2, 3])("preserves a decision carried from version %s with its original line identity", (versionNumber) => {
    const data = comparisonFixture();
    data.rows[0].applied_decision = {
      ...decisionFixture(), version_id: OTHER_ID, estimate_item_id: OTHER_ID,
      source: "carried_over", carried_over_from_version_id: OTHER_ID,
      carried_over_from_version_number: versionNumber,
    };
    expect(parseTakeoffDpgfComparisonResponse(data, IDENTITY)).toEqual(data);
  });

  it("preserves carry-over provenance after saving onto the current version", () => {
    const data = comparisonFixture();
    data.rows[0].applied_decision = {
      ...decisionFixture(), source: "carried_over", carried_over_from_version_id: OTHER_ID,
      carried_over_from_version_number: null,
    };
    expect(parseTakeoffDpgfComparisonResponse(data, IDENTITY)).toEqual(data);
  });

  it.each([
    ["version", { version_id: OTHER_ID }],
    ["current line", { estimate_item_id: OTHER_ID }],
    ["job", { takeoff_job_id: OTHER_ID }],
    ["provenance", { source: "carried_over" }],
    ["invented current provenance", { carried_over_from_version_id: OTHER_ID }],
    ["timestamp", { decided_at: "not-a-date" }],
  ])("rejects malformed decision %s", (_name, patch) => {
    const data = comparisonFixture();
    expect(() => parseTakeoffDpgfComparisonResponse({
      ...data, rows: [{ ...data.rows[0], applied_decision: { ...decisionFixture(), ...patch } }],
    }, IDENTITY)).toThrow("comparaison DPGF est invalide");
  });

  it.each([
    ["row id", { line_id: OTHER_ID }],
    ["row confidence", { confidence_score: 1.01 }],
    ["negative quantity", { takeoff_quantity: -1 }],
    ["negative absolute delta", { delta_absolute: -1 }],
    ["proof kind", { proofs: [{ ...comparisonFixture().rows[0].proofs[0], kind: "unverified" }] }],
    ["risk score", { risk: { score: 101, severity: "critical", causes: [], status: null } }],
    ["risk status", { risk: { score: 30, severity: "info", causes: [], status: "dismissed" } }],
    ["link count", { manual_link_count: 1 }],
    ["missing links", { linked_takeoff_items: undefined }],
  ])("rejects malformed nested %s", (_name, patch) => {
    const data = comparisonFixture();
    expect(() => parseTakeoffDpgfComparisonResponse({ ...data, rows: [{ ...data.rows[0], ...patch }] }, IDENTITY)).toThrow();
  });

  it.each([
    ["fractional summary", { summary: { ...comparisonFixture().summary, total_lines: 1.1 } }],
    ["summary overflow", { summary: { ...comparisonFixture().summary, to_confirm: 20 } }],
    ["unused count", { summary: { ...comparisonFixture().summary, unused_takeoff_items: 1 } }],
    ["absent candidate", { manual_link_candidates: [] }],
    ["duplicate rows", { rows: [...comparisonFixture().rows, ...comparisonFixture().rows] }],
    ["duplicate candidates", { manual_link_candidates: [...comparisonFixture().manual_link_candidates, ...comparisonFixture().manual_link_candidates] }],
    ["page overflow", { pagination: { page_size: 201, total: 1, next_cursor: null } }],
    ["empty cursor", { pagination: { page_size: 50, total: 1, next_cursor: " " } }],
    ["unreachable cursor", { pagination: { page_size: 50, total: 1, next_cursor: "opaque" } }],
  ])("rejects malformed %s", (_name, patch) => {
    expect(() => parseTakeoffDpgfComparisonResponse({ ...comparisonFixture(), ...patch }, IDENTITY)).toThrow();
  });

  it("preserves opaque cursors exactly and refuses the same cursor as the request", () => {
    const data = comparisonFixture();
    data.summary.total_lines = 2;
    data.pagination.total = 2;
    data.pagination.next_cursor = "opaque cursor/+?=version-2";
    expect(parseTakeoffDpgfComparisonResponse(data, IDENTITY).pagination.next_cursor).toBe(data.pagination.next_cursor);
    expect(() => parseTakeoffDpgfComparisonResponse(data, { ...IDENTITY, cursor: data.pagination.next_cursor })).toThrow();
  });

  it("accepts an empty exceptions view while retaining the full summary", () => {
    const data = comparisonFixture();
    data.view = "exceptions_only";
    data.rows = [];
    data.pagination.total = 0;
    expect(parseTakeoffDpgfComparisonResponse(data, { ...IDENTITY, view: "exceptions_only" })).toEqual(data);
  });
});
