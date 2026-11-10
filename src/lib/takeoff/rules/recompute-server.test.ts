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
