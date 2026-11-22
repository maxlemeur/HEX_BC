import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { IN_FILTER_CHUNK_SIZE } from "@/lib/supabase/in-chunks";
import { createSupabaseFake, servedRows } from "@/lib/takeoff/metre-m3.test-utils";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import {
  evaluateTakeoffRulesForDestination, recomputeTakeoffRulesForJob, recomputeTakeoffRulesForVersion, recomputeTakeoffRulesQuietly,
  writeTakeoffRuleResultChunks,
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
    for (const method of ["select", "eq", "in", "order"]) query[method] = () => query;
    // The version's takeoffs, read page by page: none.
    query.range = async () => ({ data: [], error: null, count: 0 });
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
        takeoff_jobs: () => ({ data: [{ id: JOB, status: "completed", created_at: "2026-11-09T09:00:00.000Z" }], error: null, count: 1 }),
        takeoff_version_links: () => ({ data: [], error: null, count: 0 }),
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

  async function recompute(sources: (job: string) => unknown, names = ["R+1.pdf", "R+1 relance.pdf"], planFileId: string | null = null, versionless = false,
    carried = false) {
    const rows = [item(M1, names[0], forced), item(M2, names[1], [])];
    const selected = versionless ? rows.slice(1) : rows;
    const written: Array<{ id: string; results: Array<{ rule: string; status: string; code: string }> }> = [];
    const write = (args: unknown) => {
      const items = (args as { p_items: typeof written }).p_items;
      written.push(...items);
      return { data: items.map((entry) => ({ item_id: entry.id, version_stamp: "stamp-written", reopened: false })), error: null };
    };
    // The lines, pages and geometries of the jobs a query names (every one of them when it names none).
    const ofJobs = (query: { filters: Array<{ column: string; value: unknown }> }) => {
      const jobs = query.filters.find((filter) => filter.column === "job_id")?.value;
      return Array.isArray(jobs) ? selected.filter((row) => jobs.includes(row.job_id)) : selected;
    };
    const fake = createSupabaseFake({
      tables: {
        // Carried: M2 is the copy's own takeoff, M1 the one its lines come from, attached to the version it was applied to
        // and carried over to the copy (takeoff_version_links), read by its id.
        takeoff_jobs: (query) => {
          const m1 = { id: M1, status: "applied", created_at: "2026-11-12T09:00:00.000Z", sources: sources(M1) };
          const m2 = { id: M2, status: "completed", created_at: "2026-11-12T09:30:00.000Z", sources: sources(M2) };
          if (carried) return { data: query.filters.some((filter) => filter.column === "estimate_version_id") ? [m2] : [m1], error: null, count: 1 };
          const served = [...(versionless ? [] : [m1]), m2];
          return { data: served, error: null, count: served.length };
        },
        takeoff_version_links: () => ({ data: carried ? [{ id: "link-1", takeoff_job_id: M1 }] : [], error: null, count: carried ? 1 : 0 }),
        takeoff_items: (query) => ({ data: ofJobs(query), error: null, count: ofJobs(query).length }),
        takeoff_vector_pages: (query) => ({ data: ofJobs(query).map((row) => ({ id: `page-${row.job_id}`, job_id: row.job_id, plan_file_id: planFileId,
          source_file_name: row.source_file_name, source_page: 1, reading, rule_anchors: anchors })), error: null, count: ofJobs(query).length }),
        takeoff_item_geometries: (query) => ({ data: ofJobs(query).map((row) => ({ takeoff_item_id: row.id, job_id: row.job_id, vector_page_id: `page-${row.job_id}`,
          geometry: { schema_version: 1, kind: "network", network: "EF", material: "inox-316l", dn: 22, zone: "Z1", level: "R+1", groups: [],
            segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null, transform: null } })), error: null }),
      },
      rpc: {
        takeoff_rule_version_has_inputs: () => ({ data: true, error: null }),
        takeoff_rule_version_stamp: () => ({ data: "stamp-read", error: null }),
        takeoff_rule_job_stamp: () => ({ data: "stamp-read", error: null }),
        write_takeoff_job_rule_results: write,
        write_takeoff_rule_results: write,
      },
    });
    if (versionless) await recomputeTakeoffRulesForJob({ tenantId: "t", projectId: "p", jobId: M2, supabase: fake.client as never });
    else await recomputeTakeoffRulesForVersion({ tenantId: "t", estimateVersionId: "v", supabase: fake.client as never });
    const jobSelect = fake.queries.find((query) => query.table === "takeoff_jobs")?.columns ?? "";
    return { written, rows, jobSelect };
  }

  it("records that a second job on the same floor has not been ruled out", async () => {
    const { written } = await recompute(() => null, ["R+1.pdf", "R+1.pdf"], null, true);
    expect(written[0].results.find((result) => result.rule === "zone_overlap")).toMatchObject({
      status: "pass",
      details: { evaluation_scope: "job", cross_job_comparison: "deferred" },
    });
  });

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

  // Fix round 1, point 4: the takeoffs a version's lines come from are its peers. Written before the fix: red on
  // 986aea27 (only the takeoffs attached to the copy were read: M2 was compared with nothing and passed).
  it("compares a copy's takeoff with the takeoff its lines come from, carried over, and never writes that one", async () => {
    const { written, rows } = await recompute(() => null, ["R+1.pdf", "R+1.pdf"], null, false, true);
    expect(written.map((entry) => entry.id)).toEqual([rows[1].id]);
    expect(written[0].results.find((result) => result.rule === "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
  });

  it("keeps the duplicate of two direct uploads it knows by their name only, the same name", async () => {
    const { written } = await recompute(() => null, ["R+1.pdf", "R+1.pdf"]);
    expect(written[0].results.find((result) => result.rule === "zone_overlap")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
  });

  // Fix round 2, point H: the takeoffs of a destination are read in full. Written before the fix: red on 2ad71cfb (the
  // attached takeoffs and the inherited links were read in one response each, cut at PostgREST's ceiling: the peer whose
  // run duplicates the takeoff being sent was not read, and the send was shown without its duplicate).
  async function evaluateBehind(peer: "attached" | "carried") {
    const own = item(M2, "R+1.pdf", []);
    const partner = item(M1, "R+1.pdf", forced);
    // A thousand earlier takeoffs of the destination, without lines, and the partner after them.
    const filler = Array.from({ length: 1000 }, (_, index) => ({ id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
      tenant_id: "t", status: "applied", created_at: "2026-11-01T00:00:00.000Z", sources: null }));
    const partnerJob = { id: M1, tenant_id: "t", status: "applied", created_at: "2026-11-12T09:00:00.000Z", sources: null };
    const attached = [...filler, ...(peer === "attached" ? [partnerJob] : [])].map((job) => ({ ...job, estimate_version_id: "v" }));
    const links = [...filler, ...(peer === "carried" ? [partnerJob] : [])].map((job, index) => ({
      id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`, tenant_id: "t", target_version_id: "v", takeoff_job_id: job.id }));
    const elsewhere = peer === "carried" ? [{ ...partnerJob, estimate_version_id: "source" }] : [];
    const ownJob = { id: M2, tenant_id: "t", project_id: "p", status: "completed", created_at: "2026-11-12T09:30:00.000Z", sources: null,
      estimate_version_id: null };
    const lines = [own, partner];
    const ofJobs = (query: { filters: Array<{ column: string; value: unknown }> }) => {
      const jobs = query.filters.find((filter) => filter.column === "job_id")?.value;
      return Array.isArray(jobs) ? lines.filter((row) => jobs.includes(row.job_id)) : lines;
    };
    const fake = createSupabaseFake({
      tables: {
        // As PostgREST serves them: never more than its ceiling of rows per response.
        // The destination's attached takeoffs are read by their version (`eq`); the takeoff sent, without one (`is null`).
        takeoff_jobs: (query) => servedRows<Record<string, unknown>>(query.filters.some((filter) => filter.column === "estimate_version_id"
          && filter.kind === "eq")
          ? attached : query.filters.some((filter) => filter.column === "project_id") ? [ownJob] : [...attached, ...elsewhere], query),
        takeoff_version_links: (query) => servedRows(links, query),
        takeoff_items: (query) => ({ data: ofJobs(query), error: null, count: ofJobs(query).length }),
        takeoff_vector_pages: (query) => ({ data: ofJobs(query).map((row) => ({ id: `page-${row.job_id}`, job_id: row.job_id,
          plan_file_id: null, source_file_name: row.source_file_name, source_page: 1, reading, rule_anchors: anchors })), error: null,
          count: ofJobs(query).length }),
        takeoff_item_geometries: (query) => ({ data: ofJobs(query).map((row) => ({ takeoff_item_id: row.id, job_id: row.job_id,
          vector_page_id: `page-${row.job_id}`, geometry: { schema_version: 1, kind: "network", network: "EF", material: "inox-316l", dn: 22,
            zone: "Z1", level: "R+1", groups: [], segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null, transform: null } })),
          error: null }),
        estimate_items: (query) => servedRows([], query),
      },
      rpc: {
        takeoff_rule_job_stamp: () => ({ data: "stamp-read", error: null }),
        takeoff_send_peers_stamp: () => ({ data: "peers-read", error: null }),
        takeoff_rule_version_stamp: () => ({ data: "stamp-read", error: null }),
        // A standalone analysis: no other plan read, no location (lot 3, migration C).
        read_takeoff_send_context: () => ({ data: { peers: [], plans: [], stamps: { peers: "p", locations: "l" }, display: null }, error: null }),
      },
    });
    const evaluated = await evaluateTakeoffRulesForDestination({ tenantId: "t", projectId: "p", jobId: M2, destinationVersionId: "v",
      supabase: fake.client as never });
    return Object.assign(evaluated.results.get(own.id)?.find((result) => result.rule === "zone_overlap") ?? {}, {
      queries: fake.queries });
  }

  it("compares the takeoff with the destination's thousand-and-first attached takeoff", async () => {
    expect(await evaluateBehind("attached")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
  });

  it("compares the takeoff with the destination's thousand-and-first takeoff carried over by a copy", async () => {
    expect(await evaluateBehind("carried")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
  });

  // Closing round, point 5: the lines of a thousand peers are read by chunks of identifiers, never in one request whose URL
  // the gateway refuses. Written before the fix: red on 9ed38ced (1,001 identifiers in one filter).
  it("reads the lines of a thousand peers by chunks of identifiers", async () => {
    const { queries } = await evaluateBehind("attached") as { queries: Array<{ table: string; filters: Array<{ column: string; value: unknown }> }> };
    const filters = queries.filter((query) => query.table === "takeoff_items")
      .map((query) => query.filters.find((filter) => filter.column === "job_id")?.value as string[]);
    expect(filters.flat()).toHaveLength(1002);
    expect(Math.max(...filters.map((ids) => ids.length))).toBeLessThanOrEqual(IN_FILTER_CHUNK_SIZE);
  });
});

// Lot 3, migration C: the send of one plan while the affaire's other plans are read. Its controls compare it with the other
// plans already read that the database's context names (never one it does not name: still read, or sent), and a page
// without a level of its own is compared under the level an operator set for its plan revision.
describe("the send of one plan: the other plans read and the operator's level", () => {
  const [A, B] = ["56565656-5656-4565-8565-565656565651", "56565656-5656-4565-8565-565656565652"];
  const [PLAN_A, PLAN_B] = ["57575757-5757-4575-8575-575757575751", "57575757-5757-4575-8575-575757575752"];
  const anchors = { version: 1, texts: ["Bureau 101", "Salle de réunion", "Local technique", "Circulation C2", "Archives"]
    .map((text, index) => [text, 12 + index * 1.3, 4 + index * 0.9]),
  lines: Array.from({ length: 30 }, (_, index) => [10, 2 + index * 0.7, 13 + (index % 5), 2 + index * 0.7]) };
  const line = (job: string, plan: string, ruleInputs = true) => ({
    id: `${job.slice(0, -2)}9${job.slice(-1)}`, job_id: job, designation: "EF Inox 316L DN 22", unit: "ml", quantity: 5,
    is_excluded: false, exclusion_reason: null, updated_at: "2026-11-22T10:00:00.000Z",
    metadata: ruleInputs ? { rule_inputs: { version: 1, source: "vector", kind: "network", network: "EF", material: "inox-316l", dn: "DN 22",
      non_observable: null, model_quantity: 5 } } : {},
    source_file_name: `${plan}.pdf`, source_page: 1, rule_results: [], rules_stale: true, rules_stale_at: "2026-11-22T10:00:00.000Z",
    rules_evaluated_at: null, quantity_entry_category: null, is_verified: false,
  });

  async function evaluatePlan(input: { peers: boolean; readingLevel: string | null; operatorLevels?: { a: string | null; b: string | null };
    ruleInputs?: boolean }) {
    const reading = { schema_version: 1, reading_version: 1, mode: "layers", size_pt: [1190, 842], rotate: 0,
      location: { zone: "Z1", level: input.readingLevel, source: input.readingLevel ? "file_name" : null },
      scale: { status: "format", reason: null, denominator: 50, cartouche: null, format: { cartouche: null, page_mm: [420, 297], matches: null },
        cotes: [], calibration: null },
      legend: [], detection: null, groups: [], groups_total: 0, labels: null, surfaces: [] };
    const lines = [line(A, PLAN_A, input.ruleInputs ?? true), line(B, PLAN_B, input.ruleInputs ?? true)];
    const planOf = (job: string) => (job === A ? PLAN_A : PLAN_B);
    // By the jobs a query names: a list of them, or one (an equality filter).
    const ofJobs = (query: { filters: Array<{ column: string; value: unknown }> }) => {
      const jobs = query.filters.find((filter) => filter.column === "job_id")?.value;
      return Array.isArray(jobs) ? lines.filter((row) => jobs.includes(row.job_id))
        : typeof jobs === "string" ? lines.filter((row) => row.job_id === jobs) : lines;
    };
    const location = (level: string | null | undefined) => (level
      ? { id: "58585858-5858-4585-8585-585858585851", revision: 3, building_choice: "reading", building: null, level_choice: "value", level }
      : null);
    const context = {
      peers: input.peers ? [{ job_id: B, stamp: "b-read" }] : [],
      plans: [{ job_id: A, plan_file_id: PLAN_A, content_hash: "a".repeat(64), location: location(input.operatorLevels?.a), current_copy: true },
        ...(input.peers ? [{ job_id: B, plan_file_id: PLAN_B, content_hash: "b".repeat(64), location: location(input.operatorLevels?.b),
          current_copy: true }] : [])],
      stamps: { peers: "p", locations: "l" }, display: null };
    const fake = createSupabaseFake({
      tables: {
        // The plan sent (read by its id and affaire), and the peers the context names (read by their ids).
        takeoff_jobs: (query) => {
          const byIds = query.filters.find((filter) => filter.column === "id" && Array.isArray(filter.value))?.value as string[] | undefined;
          const own = { id: A, status: "completed", created_at: "2026-11-22T09:30:00.000Z", sources: null };
          const peer = { id: B, status: "completed", created_at: "2026-11-22T09:00:00.000Z", sources: null };
          const data = byIds ? [peer].filter((job) => byIds.includes(job.id)) : [own];
          return { data, error: null, count: data.length };
        },
        takeoff_items: (query) => ({ data: ofJobs(query), error: null, count: ofJobs(query).length }),
        takeoff_vector_pages: (query) => ({ data: ofJobs(query).map((row) => ({ id: `page-${row.job_id}`, job_id: row.job_id,
          plan_file_id: planOf(row.job_id), source_file_name: row.source_file_name, source_page: 1, reading, rule_anchors: anchors })),
          error: null, count: ofJobs(query).length }),
        takeoff_item_geometries: (query) => ({ data: ofJobs(query).map((row) => ({ takeoff_item_id: row.id, job_id: row.job_id,
          vector_page_id: `page-${row.job_id}`, geometry: { schema_version: 1, kind: "network", network: "EF", material: "inox-316l", dn: 22,
            zone: "Z1", level: input.readingLevel, groups: [], segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null,
            transform: null } })), error: null }),
      },
      rpc: {
        takeoff_rule_job_stamp: () => ({ data: "stamp-read", error: null }),
        read_takeoff_send_context: () => ({ data: context, error: null }),
      },
    });
    const evaluated = await evaluateTakeoffRulesForDestination({ tenantId: "t", projectId: "p", jobId: A, destinationVersionId: null,
      supabase: fake.client as never });
    return { overlap: evaluated.results.get(lines[0].id)?.find((result) => result.rule === "zone_overlap") ?? null,
      writes: evaluated.writes.map((write) => write.id), context: evaluated.context, contradictions: evaluated.levelContradictions };
  }

  it("compares the plan with another plan of the affaire already read, finds their duplicate, and writes only its own lines", async () => {
    const { overlap, writes, context } = await evaluatePlan({ peers: true, readingLevel: "R+1" });
    expect(overlap).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
    expect(writes).toEqual([line(A, PLAN_A).id]);
    expect(context.stamps).toEqual({ peers: "p", locations: "l" });
  });

  it("compares it with no plan the context does not name (one still read, or sent)", async () => {
    expect((await evaluatePlan({ peers: false, readingLevel: "R+1" })).overlap).toMatchObject({ status: "pass", code: "ZONE_OVERLAP_NONE" });
  });

  it("compares pages without a level of their own under the level an operator set for each plan revision", async () => {
    expect((await evaluatePlan({ peers: true, readingLevel: null, operatorLevels: { a: "R+1", b: "R+1" } })).overlap)
      .toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
    // Two levels set apart: the two plans are not on one floor.
    expect((await evaluatePlan({ peers: true, readingLevel: null, operatorLevels: { a: "R+1", b: "R+2" } })).overlap)
      .toMatchObject({ status: "pass", code: "ZONE_OVERLAP_NONE" });
  });

  it("leaves a page with no level, read or set, compared with no other", async () => {
    expect((await evaluatePlan({ peers: true, readingLevel: null })).overlap).toBeNull();
  });

  it("keeps a page's own level over the operator's, and names the contradiction for the plan sent", async () => {
    // The pages read « R+1 »; an operator set « R+2 » on the plan sent: its pages keep their reading, the duplicate stays,
    // and the preview is told which page contradicts the level set (fix round 1, point 8).
    const contradicted = await evaluatePlan({ peers: true, readingLevel: "R+1", operatorLevels: { a: "R+2", b: null } });
    expect(contradicted.overlap).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE" });
    expect(contradicted.contradictions).toEqual([{ source_file_name: `${PLAN_A}.pdf`, source_page: 1, read_level: "R+1",
      operator_level: "R+2" }]);
  });

  it("names a page's contradiction even when none of the plan's lines carries rule inputs", async () => {
    // Its pages are read for the contradiction alone, whatever its lines carry (fix round 2, point 7). Red before: the
    // page query covered only the jobs with rule inputs, so this plan's contradiction was missed.
    const contradicted = await evaluatePlan({ peers: false, readingLevel: "R+1", operatorLevels: { a: "R+2", b: null }, ruleInputs: false });
    expect(contradicted.overlap).toBeNull();
    expect(contradicted.contradictions).toEqual([{ source_file_name: `${PLAN_A}.pdf`, source_page: 1, read_level: "R+1",
      operator_level: "R+2" }]);
  });

  it("names no contradiction when the levels agree, when a page has none, or for another plan's page", async () => {
    expect((await evaluatePlan({ peers: true, readingLevel: "R+1", operatorLevels: { a: "R+1", b: null } })).contradictions).toEqual([]);
    expect((await evaluatePlan({ peers: true, readingLevel: null, operatorLevels: { a: "R+2", b: "R+2" } })).contradictions).toEqual([]);
    // Only the plan sent is the member's to check here: a peer's page that contradicts its own plan's level is not named.
    expect((await evaluatePlan({ peers: true, readingLevel: "R+1", operatorLevels: { a: null, b: "R+2" } })).contradictions).toEqual([]);
  });
});

describe("recomputing rules for an affaire job", () => {
  it("reads the requested job only and reports a stale computation as skipped", async () => {
    const jobs = [
      { id: "analysis-one", project_id: "affaire-one", estimate_version_id: null, status: "completed" },
      { id: "analysis-two", project_id: "affaire-two", estimate_version_id: null, status: "completed" },
    ];
    const lines = jobs.map((job, index) => ({
      id: `line-${index}`,
      job_id: job.id,
      designation: "Soudures inox",
      unit: "u",
      quantity: 48,
      metadata: { rule_inputs: ruleInputsFromDesignation({ designation: "Soudures inox", unit: "u", quantity: 48 }) },
      updated_at: "2026-11-20T09:00:00Z",
      rules_stale: true,
      rules_stale_at: "2026-11-20T09:00:00Z",
      rules_evaluated_at: null,
    }));
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: ({ filters }) => ({ data: jobs.filter(job => filters.every(
          filter => filter.kind === "in" || filter.column === "tenant_id" || job[filter.column as keyof typeof job] === filter.value,
        )), error: null }),
        takeoff_items: ({ filters }) => {
          const selected = filters.find(filter => filter.column === "job_id")?.value as string[];
          const data = lines.filter(line => selected.includes(line.job_id));
          return { data, error: null, count: data.length };
        },
        takeoff_vector_pages: () => ({ data: [], error: null, count: 0 }),
        takeoff_item_geometries: () => ({ data: [], error: null, count: 0 }),
      },
      rpc: {
        takeoff_rule_job_stamp: () => ({ data: "before-edit", error: null }),
        write_takeoff_job_rule_results: () => ({ data: [], error: null }),
      },
    });

    await expect(recomputeTakeoffRulesForJob({
      tenantId: "tenant", projectId: "affaire-one", jobId: "analysis-one", supabase: fake.client as never,
    })).resolves.toEqual({ lines: 1, written: 0, skipped: 1, reopened: 0 });
    expect(fake.rpcCalls.at(-1)).toMatchObject({
      fn: "write_takeoff_job_rule_results",
      args: { p_project_id: "affaire-one", p_job_id: "analysis-one", p_stamp: "before-edit",
        p_items: [{ id: "line-0", results: [{ code: "NON_OBSERVABLE_TO_ENTER" }] }] },
    });
    expect(fake.tablesTouched).not.toContain("estimate_items");
    expect(fake.tablesTouched).not.toContain("takeoff_dpgf_links");
  });
});
