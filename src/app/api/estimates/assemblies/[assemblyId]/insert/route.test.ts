import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  insertAssemblyIntoVersion: vi.fn(),
}));

import { POST } from "@/app/api/estimates/assemblies/[assemblyId]/insert/route";
import { insertAssemblyIntoVersion } from "@/lib/estimates/server";

const ASSEMBLY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AFTER_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("estimate assembly insert route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts assembly items into version", async () => {
    vi.mocked(insertAssemblyIntoVersion).mockResolvedValue({
      items: [],
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/assemblies/${ASSEMBLY_ID}/insert?versionId=${VERSION_ID}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          afterItemId: AFTER_ITEM_ID,
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ assemblyId: ASSEMBLY_ID }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(insertAssemblyIntoVersion)).toHaveBeenCalledWith({
      assemblyId: ASSEMBLY_ID,
      versionId: VERSION_ID,
      afterItemId: AFTER_ITEM_ID,
    });
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
