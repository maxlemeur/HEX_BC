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
