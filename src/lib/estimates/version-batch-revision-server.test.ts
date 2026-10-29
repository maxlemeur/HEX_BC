import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { claimEstimateBatchRevision } from "@/lib/estimates/version-batch-revision-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const token = "2026-02-20T10:00:00.000Z";
const nextToken = "2026-02-20T10:00:01.000Z";
const rpc = vi.fn();

describe("claimEstimateBatchRevision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as never);
  });

  it.each([undefined, "", "not-a-timestamp"])("rejects malformed revisions before opening a database client", async (input) => {
    await expect(claimEstimateBatchRevision("version-1", input)).rejects.toMatchObject({ status: 400 });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("claims the normalized revision and returns the committed revision", async () => {
    rpc.mockResolvedValue({ data: [{ id: "version-1", updated_at: nextToken }], error: null });
    await expect(claimEstimateBatchRevision("version-1", `W/"${token}"`)).resolves.toEqual({ id: "version-1", updated_at: nextToken });
    expect(rpc).toHaveBeenCalledWith("claim_estimate_batch_revision", {
      p_version_id: "version-1", p_expected_updated_at: token,
    });
  });

  it.each([
    { code: "40001", message: "serialization conflict" },
    { code: "P0001", message: "ESTIMATE_BATCH_REVISION_CONFLICT" },
  ])("maps a lost claim to the same revision conflict", async (error) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(claimEstimateBatchRevision("version-1", token)).rejects.toMatchObject({
      status: 409, code: "VERSION_CONFLICT", details: { updated_at: token },
    });
  });

  it("does not acknowledge a claim without a returned version", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(claimEstimateBatchRevision("version-1", token)).rejects.toMatchObject({
      status: 409, code: "VERSION_CONFLICT", details: { updated_at: token },
    });
  });
});
