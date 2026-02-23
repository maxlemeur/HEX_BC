import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  listEstimateImportSources: vi.fn(),
}));

import { GET } from "@/app/api/estimates/import-sources/route";
import { listEstimateImportSources } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/estimates/import-sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns import sources and forwards normalized query", async () => {
    vi.mocked(listEstimateImportSources).mockResolvedValue({
      items: [
        {
          id: VERSION_ID,
          project_id: "22222222-2222-4222-8222-222222222222",
          project_name: "Projet A",
          version_number: 2,
          status: "draft",
          title: "V2",
          updated_at: "2026-02-23T10:00:00.000Z",
          total_ht_cents: 120000,
        },
      ],
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/import-sources?excludeVersionId=${VERSION_ID}`
    );

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        items: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(vi.mocked(listEstimateImportSources)).toHaveBeenCalledWith({
      exclude_version_id: VERSION_ID,
    });
  });

  it("returns 400 VALIDATION_ERROR for invalid query", async () => {
    const request = new Request(
      "http://localhost/api/estimates/import-sources?excludeVersionId=not-a-uuid"
    );

    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(listEstimateImportSources)).not.toHaveBeenCalled();
  });
});
