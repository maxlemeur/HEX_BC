import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
  patchEstimateVersion: vi.fn(),
}));

import { PATCH } from "@/app/api/estimates/[versionId]/route";
import { patchEstimateVersion } from "@/lib/estimates/server";

const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-07-27T08:00:00.000Z";
const NEXT_UPDATED_AT = "2026-07-27T08:00:01.000Z";

describe("estimate version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards a direct contractor-role PATCH and returns the principal version payload", async () => {
    const updatedVersion = {
      id: VERSION_ID,
      contractor_role: "subcontractor",
      total_ht_cents: 10_000,
      total_tax_cents: 0,
      total_ttc_cents: 10_000,
      updated_at: NEXT_UPDATED_AT,
    };
    vi.mocked(patchEstimateVersion).mockResolvedValue({
      version: updatedVersion,
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": UPDATED_AT,
        },
        body: JSON.stringify({
          contractor_role: "subcontractor",
        }),
      }
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        version: updatedVersion,
      },
    });
    expect(patchEstimateVersion).toHaveBeenCalledWith(
      VERSION_ID,
      {
        contractor_role: "subcontractor",
      },
      UPDATED_AT
    );
  });
});
