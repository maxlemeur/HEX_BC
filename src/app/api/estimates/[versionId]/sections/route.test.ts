import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  listEstimateImportSections: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/sections/route";
import { listEstimateImportSections } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const SECTION_ID = "22222222-2222-4222-8222-222222222222";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("GET /api/estimates/[versionId]/sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns importable sections for a source version", async () => {
    vi.mocked(listEstimateImportSections).mockResolvedValue({
      source_version_id: VERSION_ID,
      items: [
        {
          id: SECTION_ID,
          title: "Electricite",
          line_count: 3,
          total_ht_cents: 45000,
          position: 1,
        },
      ],
    } as never);

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/sections`),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        items: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(vi.mocked(listEstimateImportSections)).toHaveBeenCalledWith(VERSION_ID);
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const response = await GET(
      new Request("http://localhost/api/estimates/not-a-uuid/sections"),
      makeParams("not-a-uuid")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(listEstimateImportSections)).not.toHaveBeenCalled();
  });
});
