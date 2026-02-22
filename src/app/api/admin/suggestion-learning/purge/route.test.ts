import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/suggestion-learning", () => ({
  purgeLearnings: vi.fn(),
}));

import { POST } from "@/app/api/admin/suggestion-learning/purge/route";
import { purgeLearnings } from "@/lib/estimates/suggestion-learning";

describe("POST /api/admin/suggestion-learning/purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards retention months to purge", async () => {
    vi.mocked(purgeLearnings).mockResolvedValue({
      deleted_count: 12,
      retention_months: 6,
      config: {
        enabled: true,
        threshold: 3,
        retention_months: 6,
      },
      proposals: [],
      by_rule_id: {},
    } as never);

    const request = new Request("http://localhost/api/admin/suggestion-learning/purge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        retention_months: 6,
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        deleted_count: number;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.deleted_count).toBe(12);
    expect(vi.mocked(purgeLearnings)).toHaveBeenCalledWith({
      retentionMonths: 6,
    });
  });

  it("returns 400 when retention payload is invalid", async () => {
    const request = new Request("http://localhost/api/admin/suggestion-learning/purge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        retention_months: 0,
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(purgeLearnings)).not.toHaveBeenCalled();
  });
});
