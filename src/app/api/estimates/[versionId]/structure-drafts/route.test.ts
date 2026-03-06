import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/structure-drafts", () => ({
  generateEstimateStructureDraft: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/structure-drafts/route";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/structure-drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a persisted structure draft preview", async () => {
    vi.mocked(generateEstimateStructureDraft).mockResolvedValue({
      draft_id: DRAFT_ID,
      version_id: VERSION_ID,
      strategy: "hybrid",
      sources: [],
      summary: {
        root_count: 1,
        new_count: 1,
        merge_count: 0,
        duplicate_count: 0,
        low_confidence_count: 0,
      },
      nodes: [],
      generated_at: "2026-03-06T10:00:00.000Z",
    } as never);

    const response = await POST(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/structure-drafts`, {
        method: "POST",
        body: JSON.stringify({ strategy: "hybrid" }),
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        draft_id: string;
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.draft_id).toBe(DRAFT_ID);
    expect(vi.mocked(generateEstimateStructureDraft)).toHaveBeenCalledWith(
      VERSION_ID,
      { strategy: "hybrid" }
    );
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const response = await POST(
      new Request("http://localhost/api/estimates/not-a-uuid/structure-drafts", {
        method: "POST",
        body: JSON.stringify({ strategy: "hybrid" }),
      }),
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
  });
});
