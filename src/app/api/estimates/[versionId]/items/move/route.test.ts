import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  moveEstimateItem: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/items/move/route";
import { conflict } from "@/lib/estimates/errors";
import { moveEstimateItem } from "@/lib/estimates/server";

const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_PARENT_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_PARENT_ID = "66666666-6666-4666-8666-666666666666";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/items/move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves an item with validated payload", async () => {
    vi.mocked(moveEstimateItem).mockResolvedValue({
      item_id: ITEM_ID,
      from_parent_id: SOURCE_PARENT_ID,
      to_parent_id: TARGET_PARENT_ID,
      ordered_source_ids: [],
      ordered_target_ids: [ITEM_ID],
      updated_count: 1,
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item_id: ITEM_ID,
          from_parent_id: SOURCE_PARENT_ID,
          to_parent_id: TARGET_PARENT_ID,
          ordered_source_ids: [],
          ordered_target_ids: [ITEM_ID],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as { ok: boolean; data: unknown };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(vi.mocked(moveEstimateItem)).toHaveBeenCalledWith(VERSION_ID, {
      item_id: ITEM_ID,
      from_parent_id: SOURCE_PARENT_ID,
      to_parent_id: TARGET_PARENT_ID,
      ordered_source_ids: [],
      ordered_target_ids: [ITEM_ID],
    });
  });

  it("returns 400 VALIDATION_ERROR for invalid move payload", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item_id: ITEM_ID,
          from_parent_id: SOURCE_PARENT_ID,
          to_parent_id: TARGET_PARENT_ID,
          ordered_source_ids: [ITEM_ID],
          ordered_target_ids: [],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: false;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(moveEstimateItem)).not.toHaveBeenCalled();
  });

  it("forwards move conflicts from the server", async () => {
    vi.mocked(moveEstimateItem).mockRejectedValue(
      conflict("La liste de deplacement est obsolete.", {
        expected_source_ids: ["source-1"],
        received_source_ids: [],
      })
    );

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item_id: ITEM_ID,
          from_parent_id: SOURCE_PARENT_ID,
          to_parent_id: TARGET_PARENT_ID,
          ordered_source_ids: [],
          ordered_target_ids: [ITEM_ID],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: false;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });
});
