import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import {
  recomputeTakeoffRulesForVersion, recomputeTakeoffRulesQuietly, writeTakeoffRuleResultChunks,
} from "@/lib/takeoff/rules/recompute-server";

// TI-677 (PR D, review): a chunk whose write reopens a verified line moves that line's updated_at, hence the version's
// stamp. The next chunks were sent with the stamp read before the computation, and the writer wrote none of them: their
// lines kept their previous results (after a new rule version, a pass that no longer holds). Each chunk now carries the
// stamp the previous one returned.
describe("writing a version's rule results in chunks", () => {
  it("sends each chunk with the stamp the previous chunk returned", async () => {
    const stamps: unknown[] = [];
    const rpc = vi.fn(async (_fn: string, args: { p_stamp: unknown; p_items: Array<{ id: string }> }) => {
      stamps.push(args.p_stamp);
      const moved = stamps.length === 1 ? "stamp-after-chunk-1" : `stamp-${stamps.length}`;
      return { data: args.p_items.map((item) => ({ item_id: item.id, version_stamp: moved })), error: null };
    });
    const writes = Array.from({ length: 3 }, (_, index) => ({
      id: `0000000${index}-0000-4000-8000-000000000000`, results: [], expected_updated_at: "2026-11-05T00:00:00Z", expected_stale_at: null,
    }));

    const written = await writeTakeoffRuleResultChunks({
      supabase: { rpc } as never, tenantId: "t", estimateVersionId: "v", writes, transforms: [], stamp: "stamp-read", chunk: 2,
    });

    expect(written).toEqual({ written: 3, reopened: 0 });
    expect(stamps).toEqual(["stamp-read", "stamp-after-chunk-1"]);
  });

  it("keeps the stamp when a chunk writes nothing", async () => {
    const stamps: unknown[] = [];
    const rpc = vi.fn(async (_fn: string, args: { p_stamp: unknown }) => {
      stamps.push(args.p_stamp);
      return { data: [], error: null };
    });
    const writes = Array.from({ length: 4 }, (_, index) => ({
      id: `0000000${index}-0000-4000-8000-000000000000`, results: [], expected_updated_at: "2026-11-05T00:00:00Z", expected_stale_at: null,
    }));
    const result = await writeTakeoffRuleResultChunks({
      supabase: { rpc } as never, tenantId: "t", estimateVersionId: "v", writes, transforms: [], stamp: "stamp-read", chunk: 2,
    });
    expect(stamps).toEqual(["stamp-read", "stamp-read"]);
    expect(result).toEqual({ written: 0, reopened: 0 });
  });

  it("counts only real reopenings returned by the writer", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ reopened: true }, { reopened: false }], error:null });
    const writes = Array.from({length:3}, (_,i) => ({ id:String(i), results:[], expected_updated_at:"t", expected_stale_at:null }));
    await expect(writeTakeoffRuleResultChunks({ supabase:{rpc} as never, tenantId:"t", estimateVersionId:"v", writes, transforms:[], stamp:"s" }))
      .resolves.toEqual({written:2,reopened:1});
  });
});

// Recovery failures a normal browser journey cannot inject reliably: a failed service read, and a version without
// inputs while the worker flag is off. Never gate existing inputs on that flag; a later worker configuration must
// not turn off the protection of already evaluated lines.
describe("recovering a rule computation", () => {
  it("does not load a version with no rule inputs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const from = vi.fn(() => { throw new Error("Unnecessary version read"); });
    await expect(recomputeTakeoffRulesQuietly({ tenantId: "t", estimateVersionId: "v", context: "test",
      supabase: { rpc, from } as never })).resolves.toEqual({ lines: 0, written: 0, skipped: 0, reopened: 0 });
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["takeoff_rule_version_has_inputs"]);
  });

  it("recovers one failed read, with a fresh attempt, then stops", async () => {
    let reads = 0;
    const rpc = vi.fn(async (name: string) => name === "takeoff_rule_version_has_inputs"
      ? { data: true, error: null }
      : ++reads === 1 ? { data: null, error: { message: "Connection interrupted" } } : { data: "fresh-stamp", error: null });
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in"]) query[method] = () => query;
    query.order = async () => ({ data: [], error: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(recomputeTakeoffRulesQuietly({ tenantId: "t", estimateVersionId: "v", context: "test",
        supabase: { rpc, from: () => query } as never })).resolves.toEqual({ lines: 0, written: 0, skipped: 0, reopened: 0 });
      expect(reads).toBe(2);
    } finally { log.mockRestore(); }
  });

  it("leaves a persistent failure blocked after two attempts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(recomputeTakeoffRulesQuietly({ tenantId: "t", estimateVersionId: "v", context: "test",
        supabase: { rpc } as never })).resolves.toBeNull();
      expect(rpc).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });
});

// TI-686 D12: the server computes a line as entered when its quantity carries a category, whoever attested it (the
// attestation survives the deletion of its author: quantity_entered_by goes null, the category stays). A quantity
// attested before categories existed, or changed without an entry, is to enter again at the next computation.
describe("reading an entered quantity", () => {
  const JOB = "44444444-4444-4444-8444-444444444444";
  const line = (id: string, quantity: number, entry: { quantity_entered_by: string | null; quantity_entry_category: string | null }) => ({
    id, job_id: JOB, designation: "Soudures inox", unit: "u", quantity, is_excluded: false, updated_at: "2026-11-09T10:00:00.000Z",
    metadata: { rule_inputs: ruleInputsFromDesignation({ designation: "Soudures inox", unit: "u", quantity: 48 }) },
    source_file_name: "plan.pdf", source_page: 1, rule_results: [], rules_stale: true, rules_stale_at: "2026-11-09T10:00:00.000Z",
    rules_evaluated_at: null, is_verified: false, quantity_entered_at: "2026-11-09T10:00:00.000Z", ...entry,
  });

  it("enters a quantity by its category, never by its author alone or by a bare edit", async () => {
    const rows = [
      line("00000000-0000-4000-8000-0000000000a1", 48, { quantity_entered_by: null, quantity_entry_category: "site_survey" }),
      line("00000000-0000-4000-8000-0000000000a2", 52, { quantity_entered_by: "11111111-1111-4111-8111-111111111111",
        quantity_entry_category: null }),
    ];
    const written: Array<{ id: string; results: Array<{ rule: string; status: string; code: string }> }> = [];
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: [{ id: JOB, status: "completed", created_at: "2026-11-09T09:00:00.000Z" }], error: null }),
        takeoff_items: () => ({ data: rows, error: null, count: rows.length }),
        takeoff_vector_pages: () => ({ data: [], error: null, count: 0 }),
        takeoff_item_geometries: () => ({ data: [], error: null }),
      },
      rpc: {
        takeoff_rule_version_has_inputs: () => ({ data: true, error: null }),
        takeoff_rule_version_stamp: () => ({ data: "stamp-read", error: null }),
        write_takeoff_rule_results: (args) => {
          const items = (args as { p_items: typeof written }).p_items;
          written.push(...items);
          return { data: items.map((item) => ({ item_id: item.id, version_stamp: "stamp-written", reopened: false })), error: null };
        },
      },
    });

    await expect(recomputeTakeoffRulesForVersion({ tenantId: "t", estimateVersionId: "v", supabase: fake.client as never }))
      .resolves.toMatchObject({ lines: 2, written: 2 });
    const nonObservable = (id: string) => written.find((item) => item.id === id)?.results.find((result) => result.rule === "non_observable");
    expect(nonObservable(rows[0].id)).toMatchObject({ status: "pass", code: "NON_OBSERVABLE_ENTERED" });
    expect(nonObservable(rows[1].id)).toMatchObject({ status: "fail", code: "NON_OBSERVABLE_TO_ENTER" });
  });
});

// TI-682 (lot D, PR 3): a page measured again by a second takeoff. The server knows each vector page's document from
// its row (plan file, or the job's upload) and its takeoff's preparation (content hash, plan reference), as the page
// decision of the application does (page-contributions.ts). A line an administrator forced before this change belongs to
// an applied takeoff (an override is consumed by the application): its stored results are never written again.
describe("reading the plan page of each vector page", () => {
  const [M1, M2] = ["55555555-5555-4555-8555-555555555551", "55555555-5555-4555-8555-555555555552"];
  const HASH = "c".repeat(64);
  const reading = { schema_version: 1, reading_version: 1, mode: "layers", size_pt: [1190, 842], rotate: 0,
    location: { zone: "Z1", level: "R+1", source: "file_name" },
    scale: { status: "format", reason: null, denominator: 50, cartouche: null, format: { cartouche: null, page_mm: [420, 297], matches: null },
      cotes: [], calibration: null },
    legend: [], detection: null, groups: [], groups_total: 0, labels: null, surfaces: [] };
  const anchors = { version: 1, texts: ["Bureau 101", "Salle de réunion", "Local technique", "Circulation C2", "Archives"]
    .map((text, index) => [text, 12 + index * 1.3, 4 + index * 0.9]),
  lines: Array.from({ length: 30 }, (_, index) => [10, 2 + index * 0.7, 13 + (index % 5), 2 + index * 0.7]) };
  const forced = [{ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 301, acceptable: true, reason: "Fictif.",
    details: { level: "R+1", overlap_m: 5, partner_count: 1, partners: [{ item_id: `${M2.slice(0, -1)}9`, job_id: M2, zone: "Z1",
      designation: "EF Inox 316L DN 22", overlap_m: 5, resolved: false }] } }];
  const item = (job: string, fileName: string, rule_results: unknown) => ({
    id: `${job.slice(0, -1)}${job === M1 ? "8" : "9"}`, job_id: job, designation: "EF Inox 316L DN 22", unit: "ml", quantity: 5,
    is_excluded: false, exclusion_reason: null, updated_at: "2026-11-12T10:00:00.000Z",
    metadata: { rule_inputs: { version: 1, source: "vector", kind: "network", network: "EF", material: "inox-316l", dn: "DN 22",
      non_observable: null, model_quantity: 5 } },
    source_file_name: fileName, source_page: 1, rule_results, rules_stale: true, rules_stale_at: "2026-11-12T10:00:00.000Z",
    rules_evaluated_at: null, quantity_entry_category: null, is_verified: false,
  });

  async function recompute(sources: (job: string) => unknown, names = ["R+1.pdf", "R+1 relance.pdf"], planFileId: string | null = null) {
    const rows = [item(M1, names[0], forced), item(M2, names[1], [])];
    const written: Array<{ id: string; results: Array<{ rule: string; status: string; code: string }> }> = [];
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: [{ id: M1, status: "applied", created_at: "2026-11-12T09:00:00.000Z", sources: sources(M1) },
          { id: M2, status: "completed", created_at: "2026-11-12T09:30:00.000Z", sources: sources(M2) }], error: null }),
        takeoff_items: () => ({ data: rows, error: null, count: rows.length }),
        takeoff_vector_pages: () => ({ data: rows.map((row) => ({ id: `page-${row.job_id}`, job_id: row.job_id, plan_file_id: planFileId,
          source_file_name: row.source_file_name, source_page: 1, reading, rule_anchors: anchors })), error: null, count: rows.length }),
        takeoff_item_geometries: () => ({ data: rows.map((row) => ({ takeoff_item_id: row.id, job_id: row.job_id, vector_page_id: `page-${row.job_id}`,
          geometry: { schema_version: 1, kind: "network", network: "EF", material: "inox-316l", dn: 22, zone: "Z1", level: "R+1", groups: [],
            segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null, transform: null } })), error: null }),
      },
      rpc: {
        takeoff_rule_version_has_inputs: () => ({ data: true, error: null }),
        takeoff_rule_version_stamp: () => ({ data: "stamp-read", error: null }),
        write_takeoff_rule_results: (args) => {
          const items = (args as { p_items: typeof written }).p_items;
          written.push(...items);
          return { data: items.map((entry) => ({ item_id: entry.id, version_stamp: "stamp-written", reopened: false })), error: null };
        },
      },
    });
    await recomputeTakeoffRulesForVersion({ tenantId: "t", estimateVersionId: "v", supabase: fake.client as never });
    const jobSelect = fake.queries.find((query) => query.table === "takeoff_jobs")?.columns ?? "";
    return { written, rows, jobSelect };
  }

  it("passes the page read again through the content hash of each takeoff's upload, and never writes the applied takeoff", async () => {
    const { written, rows, jobSelect } = await recompute((job) => [{ document_id: `upload:${HASH}`, document_name: job === M1 ? "R+1.pdf" : "R+1 relance.pdf",
      kind: "plan", active: true, content_hash: HASH }]);
    expect(jobSelect).toContain("preparation_snapshot->preparation->sources");
    expect(written.map((entry) => entry.id)).toEqual([rows[1].id]);
    expect(written[0].results.find((result) => result.rule === "zone_overlap")).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_SAME_PAGE" });
  });

  it("passes the page read again from one plan file of the library, without any preparation", async () => {
    const { written } = await recompute(() => null, ["R+1.pdf", "R+1.pdf"], "3c000000-0000-4000-8000-000000000001");
    expect(written[0].results.find((result) => result.rule === "zone_overlap")).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_SAME_PAGE" });
  });

  it("keeps the duplicate of two direct uploads it knows by their name only, the same name", async () => {
    const { written } = await recompute(() => null, ["R+1.pdf", "R+1.pdf"]);
    expect(written[0].results.find((result) => result.rule === "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
  });
});
