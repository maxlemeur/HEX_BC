import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  deleteEstimateAssembly: vi.fn(),
  getEstimateAssembly: vi.fn(),
  updateEstimateAssembly: vi.fn(),
}));

import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/estimates/assemblies/[assemblyId]/route";
import {
  deleteEstimateAssembly,
  getEstimateAssembly,
  updateEstimateAssembly,
} from "@/lib/estimates/server";

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

  it("returns a single assembly", async () => {
    vi.mocked(getEstimateAssembly).mockResolvedValue({
      assembly: {
        id: ASSEMBLY_ID,
      },
    } as never);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ assemblyId: ASSEMBLY_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(getEstimateAssembly)).toHaveBeenCalledWith(ASSEMBLY_ID);
  });

  it("updates an assembly", async () => {
    vi.mocked(updateEstimateAssembly).mockResolvedValue({
      assembly: { id: ASSEMBLY_ID },
    } as never);

    const request = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Mur v2",
        items: [{ title: "Ligne", position: 1 }],
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ assemblyId: ASSEMBLY_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(updateEstimateAssembly)).toHaveBeenCalledWith(
      ASSEMBLY_ID,
      {
        name: "Mur v2",
        items: [
          {
            title: "Ligne",
            position: 1,
          },
        ],
      }
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

  it("deletes an assembly", async () => {
    vi.mocked(deleteEstimateAssembly).mockResolvedValue({
      deleted_id: ASSEMBLY_ID,
    } as never);

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ assemblyId: ASSEMBLY_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(deleteEstimateAssembly)).toHaveBeenCalledWith(ASSEMBLY_ID);
  });
});
