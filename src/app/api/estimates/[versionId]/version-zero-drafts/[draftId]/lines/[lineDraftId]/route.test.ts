import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/version-zero-drafts", () => ({
  reviewVersionZeroLine: vi.fn(),
}));

import { PATCH } from "@/app/api/estimates/[versionId]/version-zero-drafts/[draftId]/lines/[lineDraftId]/route";
import { reviewVersionZeroLine } from "@/lib/estimates/version-zero-drafts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const LINE_DRAFT_ID = "33333333-3333-4333-8333-333333333333";

function makeParams(
  versionId = VERSION_ID,
  draftId = DRAFT_ID,
  lineDraftId = LINE_DRAFT_ID
) {
  return { params: Promise.resolve({ versionId, draftId, lineDraftId }) };
}

describe("PATCH /api/estimates/[versionId]/version-zero-drafts/[draftId]/lines/[lineDraftId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves omitted editedValues fields for partial edits", async () => {
    vi.mocked(reviewVersionZeroLine).mockResolvedValue({
      draft: { id: DRAFT_ID },
      lots: [],
    } as never);

    const response = await PATCH(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/version-zero-drafts/${DRAFT_ID}/lines/${LINE_DRAFT_ID}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            reviewStatus: "edited",
            editedValues: {
              title: "Titre ajuste",
            },
          }),
        }
      ),
      makeParams()
    );
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(vi.mocked(reviewVersionZeroLine)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
      lineDraftId: LINE_DRAFT_ID,
      reviewStatus: "edited",
      editedValues: {
        title: "Titre ajuste",
      },
    });
  });
});
