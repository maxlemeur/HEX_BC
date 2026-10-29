import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultEstimateLaborRoleNames } from "@/lib/estimates/version-creation-plan";
import { ensureDefaultLaborRoles } from "@/lib/estimates/version-creation-repository";

const CONTEXT_CONFLICT = { code: "40001", message: "ESTIMATE_CREATE_CONTEXT_CHANGED" };

function repository(reads: string[][], writes: Array<{ error: typeof CONTEXT_CONFLICT | null }> = []) {
  const read = vi.fn();
  reads.forEach((names) => read.mockResolvedValueOnce({ data: names.map((name) => ({ name })), error: null }));
  const upsert = vi.fn();
  writes.forEach((result) => upsert.mockResolvedValueOnce(result));
  const query = { select: vi.fn(), eq: vi.fn(), in: read, upsert };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const supabase = { from: vi.fn(() => query) } as unknown as Parameters<typeof ensureDefaultLaborRoles>[0]["supabase"];
  return { supabase, read, upsert };
}

afterEach(() => vi.useRealTimers());

describe("default labor role seeding", () => {
  it("rereads after a refused gate and skips defaults seeded concurrently", async () => {
    vi.useFakeTimers();
    const store = repository([[], defaultEstimateLaborRoleNames()], [{ error: CONTEXT_CONFLICT }]);
    const result = ensureDefaultLaborRoles({ supabase: store.supabase, tenantId: "tenant", ownerUserId: "owner" });
    await vi.advanceTimersByTimeAsync(150);
    await result;
    expect(store.read).toHaveBeenCalledTimes(2);
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(store.upsert.mock.calls[0][0]).toContainEqual({
      tenant_id: "tenant", user_id: "owner", name: "Plombier",
      hourly_rate_cents: 0, is_active: true, position: 3,
    });
  });
});
