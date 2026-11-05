import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { writeTakeoffRuleResultChunks } from "@/lib/takeoff/rules/recompute-server";

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

    expect(written).toBe(3);
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
    await writeTakeoffRuleResultChunks({
      supabase: { rpc } as never, tenantId: "t", estimateVersionId: "v", writes, transforms: [], stamp: "stamp-read", chunk: 2,
    });
    expect(stamps).toEqual(["stamp-read", "stamp-read"]);
  });
});
