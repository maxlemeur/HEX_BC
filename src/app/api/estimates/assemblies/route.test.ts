import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  createEstimateAssembly: vi.fn(),
  listEstimateAssemblies: vi.fn(),
}));

import { GET } from "@/app/api/estimates/assemblies/route";
import { listEstimateAssemblies } from "@/lib/estimates/server";

describe("estimate assemblies route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when limit is invalid", async () => {
    const response = await GET(
      new Request("http://localhost/api/estimates/assemblies?limit=abc")
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
        }),
      })
    );
    expect(vi.mocked(listEstimateAssemblies)).not.toHaveBeenCalled();
  });
});
