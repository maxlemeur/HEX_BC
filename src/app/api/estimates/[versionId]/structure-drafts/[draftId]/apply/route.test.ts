import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/structure-drafts", () => ({
  applyEstimateStructureDraft: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/structure-drafts/[draftId]/apply/route";
import { applyEstimateStructureDraft } from "@/lib/estimates/structure-drafts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

function makeParams(
  versionId = VERSION_ID,
  draftId = DRAFT_ID
) {
  return { params: Promise.resolve({ versionId, draftId }) };
}

describe("POST /api/estimates/[versionId]/structure-drafts/[draftId]/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies a structure draft with explicit human validation", async () => {
    vi.mocked(applyEstimateStructureDraft).mockResolvedValue({
      draft_id: DRAFT_ID,
      version_id: VERSION_ID,
      mode: "merge_existing",
      created_count: 2,
      merged_count: 1,
      skipped_count: 0,
      created_item_ids: [],
      merged_item_ids: [],
      version: {
        id: VERSION_ID,
        updated_at: "2026-03-06T11:00:00.000Z",
      },
    } as never);

    const response = await POST(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/structure-drafts/${DRAFT_ID}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            mode: "merge_existing",
            selectedRootNodeIds: [DRAFT_ID],
            overrides: [],
          }),
        }
      ),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        mode: string;
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.mode).toBe("merge_existing");
    expect(vi.mocked(applyEstimateStructureDraft)).toHaveBeenCalledWith(
      VERSION_ID,
      DRAFT_ID,
      {
        mode: "merge_existing",
        selected_root_node_ids: [DRAFT_ID],
        overrides: [],
      }
    );
  });
});
