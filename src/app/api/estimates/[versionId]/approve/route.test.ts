import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/rules-engine", () => ({
  submitEstimateApproval: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/approve/route";
import { submitEstimateApproval } from "@/lib/estimates/rules-engine";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

describe("estimate approve route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 on invalid version id", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "request",
        rule_id: "22222222-2222-4222-8222-222222222222",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: "invalid-id" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      })
    );
    expect(vi.mocked(submitEstimateApproval)).not.toHaveBeenCalled();
  });

  it("creates an approval request with 201", async () => {
    vi.mocked(submitEstimateApproval).mockResolvedValue({
      approval: {
        id: "33333333-3333-4333-8333-333333333333",
        version_id: VERSION_ID,
        rule_id: "22222222-2222-4222-8222-222222222222",
        status: "pending",
      },
    } as never);

    const request = new Request("http://localhost", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "request",
        rule_id: "22222222-2222-4222-8222-222222222222",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(vi.mocked(submitEstimateApproval)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      action: "request",
      ruleId: "22222222-2222-4222-8222-222222222222",
    });
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          approval: expect.objectContaining({
            status: "pending",
          }),
        }),
      })
    );
  });

  it("approves an existing request with 200", async () => {
    vi.mocked(submitEstimateApproval).mockResolvedValue({
      approval: {
        id: "33333333-3333-4333-8333-333333333333",
        version_id: VERSION_ID,
        rule_id: "22222222-2222-4222-8222-222222222222",
        status: "approved",
      },
    } as never);

    const request = new Request("http://localhost", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        approval_id: "33333333-3333-4333-8333-333333333333",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(submitEstimateApproval)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      action: "approve",
      ruleId: undefined,
      approvalId: "33333333-3333-4333-8333-333333333333",
    });
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          approval: expect.objectContaining({
            status: "approved",
          }),
        }),
      })
    );
  });
});
