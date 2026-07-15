import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  patchEstimateStatus: vi.fn(),
}));

import { PATCH } from "@/app/api/estimates/[versionId]/status/route";
import { conflict } from "@/lib/estimates/errors";
import { patchEstimateStatus } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";

describe("estimate status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when If-Match token is missing", async () => {
    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "sent",
        updated_at: UPDATED_AT,
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
          message: "Jeton de concurrence manquant.",
        }),
      })
    );
    expect(vi.mocked(patchEstimateStatus)).not.toHaveBeenCalled();
  });

  it("forwards token and maps conflict errors", async () => {
    vi.mocked(patchEstimateStatus).mockRejectedValue(
      conflict(
        "Version modifiee par un autre utilisateur",
        { updated_at: "2026-02-21T11:00:00.000Z" },
        "VERSION_CONFLICT"
      )
    );

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": UPDATED_AT,
      },
      body: JSON.stringify({
        status: "sent",
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(vi.mocked(patchEstimateStatus)).toHaveBeenCalledWith(
      VERSION_ID,
      {
        status: "sent",
      },
      UPDATED_AT
    );
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VERSION_CONFLICT",
        }),
      })
    );
  });

  it("returns updated version on success", async () => {
    vi.mocked(patchEstimateStatus).mockResolvedValue({
      version: {
        id: VERSION_ID,
        updated_at: "2026-02-21T10:00:01.000Z",
        status: "sent",
      },
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": UPDATED_AT,
      },
      body: JSON.stringify({
        status: "sent",
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          version: expect.objectContaining({
            id: VERSION_ID,
            status: "sent",
          }),
        }),
      })
    );
  });
});
