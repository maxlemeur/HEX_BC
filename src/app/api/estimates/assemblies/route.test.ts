import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  createEstimateAssembly: vi.fn(),
  listEstimateAssemblies: vi.fn(),
}));

import { GET, POST } from "@/app/api/estimates/assemblies/route";
import {
  createEstimateAssembly,
  listEstimateAssemblies,
} from "@/lib/estimates/server";

describe("estimate assemblies route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists assemblies with query params", async () => {
    vi.mocked(listEstimateAssemblies).mockResolvedValue({
      assemblies: [],
    } as never);

    const response = await GET(
      new Request("http://localhost/api/estimates/assemblies?search=mur&limit=15")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(listEstimateAssemblies)).toHaveBeenCalledWith({
      search: "mur",
      limit: 15,
      order: "recent",
    });
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
      })
    );
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

  it("creates an assembly", async () => {
    vi.mocked(createEstimateAssembly).mockResolvedValue({
      assembly: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    } as never);

    const request = new Request("http://localhost/api/estimates/assemblies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Mur",
        items: [{ title: "Parpaing", position: 1 }],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(vi.mocked(createEstimateAssembly)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Mur",
        items: [
          expect.objectContaining({
            title: "Parpaing",
            position: 1,
          }),
        ],
        members: [],
      })
    );
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
      })
    );
  });
});
