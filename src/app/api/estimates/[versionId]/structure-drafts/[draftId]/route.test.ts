import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/structure-drafts", () => ({
  getEstimateStructureDraft: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/structure-drafts/[draftId]/route";
import { getEstimateStructureDraft } from "@/lib/estimates/structure-drafts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

function makeParams(
  versionId = VERSION_ID,
  draftId = DRAFT_ID
) {
  return { params: Promise.resolve({ versionId, draftId }) };
}

describe("GET /api/estimates/[versionId]/structure-drafts/[draftId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a persisted structure draft", async () => {
    vi.mocked(getEstimateStructureDraft).mockResolvedValue({
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

    const response = await GET(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/structure-drafts/${DRAFT_ID}`
      ),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        draft_id: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.draft_id).toBe(DRAFT_ID);
    expect(vi.mocked(getEstimateStructureDraft)).toHaveBeenCalledWith(
      VERSION_ID,
      DRAFT_ID
    );
  });
});
