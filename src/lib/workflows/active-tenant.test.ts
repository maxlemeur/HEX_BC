import { describe, expect, it, vi } from "vitest";

import {
  isWorkflowTenantActive,
  WorkflowTenantCheckError,
  type WorkflowTenantClient,
} from "@/lib/workflows/active-tenant";

function createClient(result: { data: unknown; error: unknown }) {
  const builder = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  builder.eq.mockReturnValue(builder);

  return {
    client: {
      from: vi.fn(() => ({
        select: vi.fn(() => builder),
      })),
    } as unknown as WorkflowTenantClient,
    builder,
  };
}

describe("active workflow tenant boundary", () => {
  it("reports an active tenant", async () => {
    const { client, builder } = createClient({ data: { id: "tenant-1" }, error: null });

    await expect(isWorkflowTenantActive(client, "tenant-1")).resolves.toBe(true);

    expect(builder.eq).toHaveBeenNthCalledWith(1, "id", "tenant-1");
    expect(builder.eq).toHaveBeenNthCalledWith(2, "is_active", true);
  });

  it("reports a suspended tenant as inactive", async () => {
    const { client } = createClient({ data: null, error: null });

    await expect(isWorkflowTenantActive(client, "tenant-2")).resolves.toBe(false);
  });

  it("fails closed when tenant state cannot be verified", async () => {
    const { client } = createClient({ data: null, error: new Error("db down") });

    await expect(
      isWorkflowTenantActive(client, "tenant-3")
    ).rejects.toBeInstanceOf(WorkflowTenantCheckError);
  });
});
