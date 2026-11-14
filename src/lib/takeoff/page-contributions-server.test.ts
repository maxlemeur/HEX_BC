import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the session is stood in for; the takeoff and version reads run against the tables below.
vi.mock("@/lib/takeoff/job-read-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/job-read-server")>(),
  getAuthenticatedTakeoffContext: vi.fn(),
}));

import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { getTakeoffJobPageContributions, readTakeoffJobPageReading } from "@/lib/takeoff/page-contributions-server";

// TI-682 lot D: a takeoff carried over into a copied estimate version is reviewed under that copy. The warning reads
// the estimate the review shows, the copy, never the version the takeoff was launched in; and a version id from the
// client reads nothing it does not open: another tenant's version, or a version the takeoff is not part of, is 404.
// The tables below stand for what the user's session reads (tenant filter; RLS hides the rest). Fictional ids only.

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const OTHER_PROJECT = "20000000-0000-4000-8000-000000000002";
const V1 = "30000000-0000-4000-8000-000000000001"; // the version the takeoffs were launched in
const V2 = "30000000-0000-4000-8000-000000000002"; // its copy, which the review shows
const V_OTHER_PROJECT = "30000000-0000-4000-8000-000000000003";
const V_OTHER_TENANT = "30000000-0000-4000-8000-000000000004";
const J1 = "40000000-0000-4000-8000-000000000001"; // carried over from V1 into V2: the takeoff reviewed
const J2 = "40000000-0000-4000-8000-000000000002"; // launched in the copy, applied there: same page
const J3 = "40000000-0000-4000-8000-000000000003"; // applied in V1 on the same page; its line removed from the copy
const item = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;
const line = (n: number) => `60000000-0000-4000-8000-00000000000${n}`;
const AT = "2026-11-01T08:00:00.000Z";

type Row = Record<string, unknown>;
type Filter = { column: string; values: unknown[] } | { column: string; isNotNull: true };

function job(id: string, versionId: string, createdAt: string): Row {
  return { id, tenant_id: TENANT, estimate_version_id: versionId, status: "applied", level: "C", source_file_name: "plan-rdc.pdf",
    source_file_type: "application/pdf", source_file_size_bytes: 1024, created_at: createdAt, updated_at: createdAt, sources: null };
}
const takeoffLine = (n: number, jobId: string, page = 1): Row =>
  ({ id: item(n), tenant_id: TENANT, job_id: jobId, source_file_name: "plan-rdc.pdf", source_page: page, source_document: null, is_excluded: false });
const estimateLine = (n: number, versionId: string, jobId: string, itemId: string): Row => ({ id: line(n), tenant_id: TENANT,
  version_id: versionId, item_type: "line", source_provider: "takeoff", source_job_id: jobId, source_file_name: "plan-rdc.pdf", source_page: 1,
  takeoff_item_id: itemId, rounding_item_ids: null, rounding_job_id: null, policy_item_ids: null, policy_job_id: null });

function database() {
  const tables: Record<string, Row[]> = {
    estimate_versions: [
      { id: V1, tenant_id: TENANT, project_id: PROJECT, version_number: 1 },
      { id: V2, tenant_id: TENANT, project_id: PROJECT, version_number: 2 },
      { id: V_OTHER_PROJECT, tenant_id: TENANT, project_id: OTHER_PROJECT, version_number: 1 },
      { id: V_OTHER_TENANT, tenant_id: OTHER_TENANT, project_id: OTHER_PROJECT, version_number: 1 },
    ],
    takeoff_jobs: [job(J1, V1, AT), job(J2, V2, "2026-11-03T08:00:00.000Z"), job(J3, V1, "2026-11-02T08:00:00.000Z")],
    takeoff_version_links: [{ tenant_id: TENANT, takeoff_job_id: J1, source_version_id: V1, target_version_id: V2, linked_at: AT },
      { tenant_id: TENANT, takeoff_job_id: J3, source_version_id: V1, target_version_id: V2, linked_at: AT }],
    takeoff_items: [takeoffLine(1, J1), takeoffLine(2, J2), takeoffLine(3, J3)],
    estimate_items: [
      estimateLine(1, V1, J1, item(1)), estimateLine(3, V1, J3, item(3)),
      // PR 2: the section of an ouvrage J3 applied carries J3's line too; a section is never a line of the page.
      { ...estimateLine(5, V1, J3, item(3)), item_type: "section" },
      // The copy keeps each line's source_job_id and provenance; J3's copied line was removed, J2 applied in the copy.
      estimateLine(4, V2, J1, item(1)), estimateLine(2, V2, J2, item(2)),
    ],
  };
  const reads: Array<{ table: string; filters: Filter[] }> = [];
  function from(table: string) {
    const filters: Filter[] = [];
    let columns: string[] | null = null;
    let range: [number, number] | null = null;
    const rows = () => {
      reads.push({ table, filters: [...filters] });
      const matched = (tables[table] ?? []).filter((row) => filters.every((filter) => ("isNotNull" in filter
        ? row[filter.column] != null : filter.values.includes(row[filter.column]))));
      // A plain column list is projected (strict readers); an aliased one is stored in its read shape already.
      return matched.map((row) => (columns ? Object.fromEntries(columns.map((column) => [column, row[column]])) : row));
    };
    const builder = {
      select(select: string) {
        columns = /[:>]/.test(select) ? null : select.split(",").map((column) => column.trim());
        return builder;
      },
      eq(column: string, value: unknown) { filters.push({ column, values: [value] }); return builder; },
      in(column: string, values: unknown[]) { filters.push({ column, values }); return builder; },
      not(column: string) { filters.push({ column, isNotNull: true }); return builder; },
      order() { return builder; },
      limit() { return builder; },
      range(start: number, end: number) { range = [start, end]; return builder; },
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
        const all = rows();
        const data = range ? all.slice(range[0], range[1] + 1) : all;
        return Promise.resolve({ data, error: null, count: all.length }).then(resolve, reject);
      },
    };
    return builder;
  }
  const estimateReads = () => reads.filter((read) => read.table === "estimate_items")
    .map((read) => read.filters.find((filter) => filter.column === "version_id"))
    .map((filter) => (filter && "values" in filter ? filter.values[0] : null));
  return { supabase: { from }, estimateReads, tables };
}

let db: ReturnType<typeof database>;

beforeEach(() => {
  db = database();
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: db.supabase, tenantId: TENANT } as never);
});

describe("getTakeoffJobPageContributions — the estimate version the review shows", () => {
  it("reads the copied version's lines for a takeoff carried over into it", async () => {
    const read = await getTakeoffJobPageContributions(J1, V2);

    expect(db.estimateReads()).toEqual([V2]);
    expect(read.version_id).toBe(V2);
    // J2, applied in the copy, read the same page; J3's line, removed from the copy, is no longer reported.
    expect(read.pages).toMatchObject([{ file_name: "plan-rdc.pdf", page: 1, item_ids: [item(1)], own_line_count: 1,
      earlier: [{ job_id: J2, line_count: 1, takeoff_item_ids: [item(2)] }] }]);
    expect(read.jobs.map((entry) => entry.id)).toEqual([J2]);
  });

  it("reads the takeoff's own version when that is the version reviewed", async () => {
    const read = await getTakeoffJobPageContributions(J1, V1);

    expect(db.estimateReads()).toEqual([V1]);
    expect(read.pages).toMatchObject([{ page: 1, own_line_count: 1, earlier: [{ job_id: J3, line_count: 1 }] }]);
    expect(read.other_takeoff_line_count).toBe(1);
  });

  it.each([
    ["another tenant's version", J1, V_OTHER_TENANT],
    ["a version of another project the takeoff is not part of", J1, V_OTHER_PROJECT],
    ["a version the takeoff was neither launched in nor carried into", J2, V1],
  ])("refuses %s with 404 and reads none of its lines", async (_label, jobId, versionId) => {
    await expect(getTakeoffJobPageContributions(jobId, versionId)).rejects.toMatchObject({ status: 404 });
    expect(db.estimateReads()).toEqual([]);
  });
});

describe("readTakeoffJobPageReading — the pages the application brings again (TI-696, Codex review of PR 288)", () => {
  // J1 reviewed in V1, where J3 brought page 1. J1 reads page 1 (its line 1) and page 2 (its line 6). The DPGF
  // reconciliation leaves out of a line's total the earlier parts of the pages read again: only the lines the application
  // brings read a page again, as the database reads them (private.takeoff_prepare_page_decisions: not excluded, neither
  // skipped nor folded into an assembly by the mapping plan).
  it("reads a page again through a line the application brings, never through an excluded or left-out one", async () => {
    db.tables.takeoff_items.push(takeoffLine(6, J1, 2));
    const context = { supabase: db.supabase, tenantId: TENANT } as never;
    const included = await readTakeoffJobPageReading(context, J1, V1);
    expect([...included.readAgainItemIds()]).toEqual([item(3)]);
    // Left out by the mapping plan: page 1 no longer comes again.
    expect([...included.readAgainItemIds(new Set([item(1)]))]).toEqual([]);

    db.tables.takeoff_items.find((row) => row.id === item(1))!.is_excluded = true;
    const excluded = await readTakeoffJobPageReading(context, J1, V1);
    expect([...excluded.readAgainItemIds()]).toEqual([]);
  });

  it("leaves the review's notice reading every line: the screen hides a page once its lines are excluded", async () => {
    db.tables.takeoff_items.find((row) => row.id === item(1))!.is_excluded = true;
    const read = await getTakeoffJobPageContributions(J1, V1);
    expect(read.pages).toMatchObject([{ page: 1, item_ids: [item(1)], earlier: [{ job_id: J3 }] }]);
  });
});
