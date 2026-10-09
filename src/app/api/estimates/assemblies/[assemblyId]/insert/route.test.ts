import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  insertAssemblyIntoVersion: vi.fn(),
}));

import { POST } from "@/app/api/estimates/assemblies/[assemblyId]/insert/route";
import { insertAssemblyIntoVersion } from "@/lib/estimates/server";

const ASSEMBLY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("estimate assembly insert route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when versionId is missing", async () => {
    const request = new Request(
      `http://localhost/api/estimates/assemblies/${ASSEMBLY_ID}/insert`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ assemblyId: ASSEMBLY_ID }),
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
    expect(vi.mocked(insertAssemblyIntoVersion)).not.toHaveBeenCalled();
  });
});
