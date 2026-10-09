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

  it.each([
    {
      label: "an approval decision without a target",
      body: { action: "approve" },
    },
    {
      label: "a scoped comment without scope_id",
      body: {
        action: "decide",
        decision: "changes_requested",
        comments: [
          {
            scope_type: "line",
            comment: "Preciser le quantitatif.",
          },
        ],
      },
    },
  ])("returns 400 for $label", async ({ body }) => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
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

  it("accepts a version-level review decision with scoped comments", async () => {
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
        action: "decide",
        decision: "approved_with_reservations",
        comments: [
          {
            scope_type: "approval_rule",
            scope_id: "22222222-2222-4222-8222-222222222222",
            comment: "Validee sous reserve de confirmer la marge.",
          },
        ],
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(submitEstimateApproval)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      action: "decide",
      decision: "approved_with_reservations",
      comments: [
        {
          scopeType: "approval_rule",
          scopeId: "22222222-2222-4222-8222-222222222222",
          comment: "Validee sous reserve de confirmer la marge.",
        },
      ],
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
