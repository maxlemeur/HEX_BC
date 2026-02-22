import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/suggestion-learning", () => ({
  getLearnings: vi.fn(),
  trackCorrection: vi.fn(),
}));

import { GET, POST } from "@/app/api/estimates/[versionId]/suggestion-learning/route";
import {
  getLearnings,
  trackCorrection,
} from "@/lib/estimates/suggestion-learning";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const RULE_ID = "22222222-2222-4222-8222-222222222222";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("/api/estimates/[versionId]/suggestion-learning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns active learning state for the version", async () => {
    vi.mocked(getLearnings).mockResolvedValue({
      config: {
        enabled: true,
        threshold: 3,
        retention_months: 12,
      },
      proposals: [],
      by_rule_id: {},
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/suggestion-learning`,
      {
        method: "GET",
      }
    );

    const response = await GET(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(vi.mocked(getLearnings)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      includeInactive: false,
    });
  });

  it("POST normalizes nullables and forwards corrections", async () => {
    vi.mocked(trackCorrection).mockResolvedValue({
      config: {
        enabled: true,
        threshold: 3,
        retention_months: 12,
      },
      proposals: [],
      by_rule_id: {},
      tracked_count: 1,
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/suggestion-learning`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          corrections: [
            {
              rule_id: RULE_ID,
              field_name: "description",
              corrected_value: "Description corrigee",
              item_title: "Ligne test",
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        tracked_count: number;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.tracked_count).toBe(1);
    expect(vi.mocked(trackCorrection)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      corrections: [
        {
          rule_id: RULE_ID,
          field_name: "description",
          original_value: null,
          corrected_value: "Description corrigee",
          item_title: "Ligne test",
        },
      ],
    });
  });

  it("returns 400 for an invalid versionId", async () => {
    const request = new Request(
      "http://localhost/api/estimates/not-a-uuid/suggestion-learning",
      {
        method: "GET",
      }
    );

    const response = await GET(request, makeParams("not-a-uuid"));
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(getLearnings)).not.toHaveBeenCalled();
  });
});
