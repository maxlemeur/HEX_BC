import { describe, expect, it, vi } from "vitest";

import {
  runActiveTenantExternalEffect,
  WorkflowTenantCheckError,
  WorkflowTenantInactiveError,
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
  it("runs the external effect only for an active tenant", async () => {
    const { client, builder } = createClient({ data: { id: "tenant-1" }, error: null });
    const effect = vi.fn().mockResolvedValue("ok");

    await expect(
      runActiveTenantExternalEffect({ client, tenantId: "tenant-1", effect })
    ).resolves.toBe("ok");

    expect(builder.eq).toHaveBeenNthCalledWith(1, "id", "tenant-1");
    expect(builder.eq).toHaveBeenNthCalledWith(2, "is_active", true);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("never invokes the provider for a suspended tenant", async () => {
    const { client } = createClient({ data: null, error: null });
    const effect = vi.fn();

    await expect(
      runActiveTenantExternalEffect({ client, tenantId: "tenant-2", effect })
    ).rejects.toBeInstanceOf(WorkflowTenantInactiveError);
    expect(effect).not.toHaveBeenCalled();
  });

  it("fails closed when tenant state cannot be verified", async () => {
    const { client } = createClient({ data: null, error: new Error("db down") });
    const effect = vi.fn();

    await expect(
      runActiveTenantExternalEffect({ client, tenantId: "tenant-3", effect })
    ).rejects.toBeInstanceOf(WorkflowTenantCheckError);
    expect(effect).not.toHaveBeenCalled();
  });
});
