import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/suggestion-learning", () => ({
  getLearnings: vi.fn(),
  reviewLearning: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/admin/suggestion-learning/route";
import {
  getLearnings,
  reviewLearning,
} from "@/lib/estimates/suggestion-learning";

const RULE_ID = "11111111-1111-4111-8111-111111111111";

describe("/api/admin/suggestion-learning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns aggregated tenant proposals", async () => {
    vi.mocked(getLearnings).mockResolvedValue({
      config: {
        enabled: true,
        threshold: 3,
        retention_months: 12,
      },
      proposals: [],
      by_rule_id: {},
    } as never);

    const response = await GET();
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(vi.mocked(getLearnings)).toHaveBeenCalledWith({
      includeInactive: true,
      adminOnly: true,
    });
  });

  it("PATCH forwards review actions", async () => {
    vi.mocked(reviewLearning).mockResolvedValue({
      config: {
        enabled: true,
        threshold: 3,
        retention_months: 12,
      },
      proposals: [],
      by_rule_id: {},
    } as never);

    const request = new Request("http://localhost/api/admin/suggestion-learning", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rule_id: RULE_ID,
        field_name: "k_fo",
        corrected_value: "1.5",
        action: "approve",
      }),
    });

    const response = await PATCH(request);
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(vi.mocked(reviewLearning)).toHaveBeenCalledWith({
      ruleId: RULE_ID,
      fieldName: "k_fo",
      correctedValue: "1.5",
      action: "approve",
    });
  });

  it("returns 400 for invalid review payload", async () => {
    const request = new Request("http://localhost/api/admin/suggestion-learning", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rule_id: RULE_ID,
        field_name: "invalid",
        action: "approve",
      }),
    });

    const response = await PATCH(request);
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(reviewLearning)).not.toHaveBeenCalled();
  });
});
