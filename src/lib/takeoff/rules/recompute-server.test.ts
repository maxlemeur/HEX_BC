import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { recomputeTakeoffRulesQuietly, writeTakeoffRuleResultChunks } from "@/lib/takeoff/rules/recompute-server";

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
