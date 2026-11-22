import { describe, expect, it } from "vitest";

import {
  earlierAnalysisHref,
  earlierAnalysisReturnHref,
  earlierAnalysisView,
  EARLIER_ANALYSIS_ROWS_SHOWN,
  readEarlierAnalysisParam,
} from "@/lib/takeoff/earlier-analysis";

// « Analyse antérieure » (lot 4, PR 6a): an analysis not read against the affaire's list (an old job, a grouped one, a
// failed one, another provider) shown read only beside the table of items. Ways it could tell something false:
// - completed from today's list or template: an item of the list shown as « non trouvé » because the old job has no row
//   for it, or a coverage computed;
// - a human validation inferred: a row the Assisted review marked (`is_verified`, a navigation marker) shown as validated;
// - its rows, tables or warnings not as kept: reordered, merged, filtered or reworded;
// - its review offered for a job that has none to open, or not offered for one that has.
// Fictional values.

const JOB = "22222222-2222-4222-8222-222222222222";
const base = { id: JOB, status: "completed", level: "C", source_file_name: "plan-rdc.pdf", completed_at: "2026-11-02T10:00:00.000Z",
  created_at: "2026-11-02T09:00:00.000Z", error_code: null, estimate_version_id: null };
const rows = [
  { id: "r-2", designation: "Lavabo", quantity: 3, unit: "u", source_page: 2, source_file_name: "plan-rdc.pdf", is_excluded: false,
    exclusion_reason: null, is_verified: true },
  { id: "r-1", designation: "Vanne DN32", quantity: 1.5, unit: "m", source_page: null, source_file_name: null, is_excluded: true,
    exclusion_reason: "Doublon de la vanne du R+1", is_verified: false },
];
const result = {
  warnings: [{ code: "LOW_CONFIDENCE", message: "Cartouche peu lisible.", severity: "warning" },
    { code: "TABLE_SKIPPED", message: "Un tableau n’a pas été repris.", severity: "info", table_index: 1 }, { nothing: true }],
  tables: [{ page: 4, title: "Nomenclature", headers: ["Repère", "Qté"], rows: [{ row_index: 0, cells: ["L1", "3"] }] }],
  provider_meta: { provider: "gemini" },
};

describe("earlierAnalysisView", () => {
  it("shows the analysis as kept: its rows in their order, its tables and its warnings, with the list and coverage it never had", () => {
    const view = earlierAnalysisView({ job: base, result, rows, rowsTotal: 2 });
    expect(view).toMatchObject({ jobId: JOB, fileName: "plan-rdc.pdf", level: "C", provider: "gemini", status: "completed",
      list: "not_recorded", coverage: "unknown", reviewable: true, rowsTotal: 2, failure: null });
    expect(view.rows).toEqual([
      { id: "r-2", designation: "Lavabo", quantity: 3, unit: "u", page: 2, fileName: "plan-rdc.pdf", setAside: null },
      { id: "r-1", designation: "Vanne DN32", quantity: 1.5, unit: "m", page: null, fileName: null, setAside: "Doublon de la vanne du R+1" },
    ]);
    expect(view.tables).toEqual([{ page: 4, title: "Nomenclature", headers: ["Repère", "Qté"], rows: [["L1", "3"]] }]);
    // A warning kept in a shape this version does not read is counted, never reworded.
    expect(view.warnings).toEqual([{ severity: "warning", message: "Cartouche peu lisible." },
      { severity: "info", message: "Un tableau n’a pas été repris." }]);
    expect(view.unreadableWarnings).toBe(1);
  });

  it("infers no human validation and invents no item, state or « non trouvé »", () => {
    const view = earlierAnalysisView({ job: base, result, rows, rowsTotal: 2 });
    for (const row of view.rows) expect(Object.keys(row).sort()).toEqual(["designation", "fileName", "id", "page", "quantity", "setAside", "unit"]);
    expect(JSON.stringify(view)).not.toMatch(/verified|not_found|non trouvé|measured|validated/i);
    // Without rows the analysis shows none: nothing is completed from a list.
    expect(earlierAnalysisView({ job: base, result: null, rows: [], rowsTotal: 0 })).toMatchObject({ rows: [], tables: [], warnings: [],
      rowsTotal: 0, list: "not_recorded", coverage: "unknown" });
  });

  it("says a failed analysis's reason, offers its review only when it has one to open, and bounds the rows it shows", () => {
    const failed = earlierAnalysisView({ job: { ...base, status: "failed", error_code: "TAKEOFF_PROVIDER_TIMEOUT", completed_at: null },
      result: null, rows: [], rowsTotal: 0 });
    expect(failed).toMatchObject({ status: "failed", reviewable: false });
    expect(failed.failure).toEqual(expect.any(String));
    for (const status of ["pending", "processing", "canceled"]) {
      expect(earlierAnalysisView({ job: { ...base, status }, result: null, rows: [], rowsTotal: 0 }).reviewable, status).toBe(false);
    }
    expect(earlierAnalysisView({ job: { ...base, status: "applied" }, result, rows, rowsTotal: 2 }).reviewable).toBe(true);
    const many = Array.from({ length: EARLIER_ANALYSIS_ROWS_SHOWN + 3 }, (_, index) => ({ ...rows[0]!, id: `r-${index}` }));
    const bounded = earlierAnalysisView({ job: base, result, rows: many, rowsTotal: many.length });
    expect(bounded.rows).toHaveLength(EARLIER_ANALYSIS_ROWS_SHOWN);
    expect(bounded.rowsTotal).toBe(EARLIER_ANALYSIS_ROWS_SHOWN + 3);
  });
});

describe("the address of an earlier analysis", () => {
  const PROJECT = "11111111-1111-4111-8111-111111111111";
  const params = (query: string) => new URLSearchParams(query);
  it("names one analysis, beside the table's parameters it keeps for the way back", () => {
    expect(readEarlierAnalysisParam(params(`postePlan=p&anterieure=${JOB.toUpperCase()}`))).toBe(JOB);
    expect(readEarlierAnalysisParam(params("postePlan=p"))).toBeNull();
    for (const query of ["anterieure=", "anterieure=12", `anterieure=${JOB}&anterieure=${JOB}`]) {
      expect(readEarlierAnalysisParam(params(query)), query).toBe("invalid");
    }
    const href = earlierAnalysisHref(PROJECT, JOB, "postePlan=p&posteLimit=50");
    expect(href).toBe(`/dashboard/affaires/${PROJECT}/takeoff?postePlan=p&posteLimit=50&anterieure=${JOB}`);
    expect(earlierAnalysisReturnHref(PROJECT, new URL(href, "https://app.test").search))
      .toBe(`/dashboard/affaires/${PROJECT}/takeoff?postePlan=p&posteLimit=50`);
    expect(earlierAnalysisReturnHref(PROJECT, `anterieure=${JOB}`)).toBe(`/dashboard/affaires/${PROJECT}/takeoff`);
  });
});
