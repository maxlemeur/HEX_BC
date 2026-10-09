import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  deleteEstimateAssembly: vi.fn(),
  getEstimateAssembly: vi.fn(),
  updateEstimateAssembly: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/estimates/assemblies/[assemblyId]/route";
import { updateEstimateAssembly } from "@/lib/estimates/server";

const ASSEMBLY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("estimate assembly by id route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when assemblyId is invalid", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ assemblyId: "not-a-uuid" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      })
    );
  });

  it("keeps omitted fields omitted for partial updates", async () => {
    vi.mocked(updateEstimateAssembly).mockResolvedValue({
      assembly: { id: ASSEMBLY_ID },
    } as never);

    const request = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mur renomme",
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ assemblyId: ASSEMBLY_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(updateEstimateAssembly)).toHaveBeenCalledWith(
      ASSEMBLY_ID,
      {
        name: "Mur renomme",
      }
    );
  });
});
