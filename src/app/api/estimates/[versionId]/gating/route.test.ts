import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateSendGating: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/gating/route";
import { internalError } from "@/lib/estimates/errors";
import { getEstimateSendGating } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

describe("estimate gating route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns gating payload on success", async () => {
    vi.mocked(getEstimateSendGating).mockResolvedValue({
      gating: {
        canSend: false,
        blockingFlags: [
          {
            key: "missing_price",
            severity: "blocking",
            count: 1,
            item_ids: ["item-1"],
            label: "Prix manquant",
            description: "Le prix unitaire FO est absent ou egal a 0.",
          },
        ],
        warningFlags: [],
        stalePriceDays: 90,
        checkedAt: "2026-02-22T12:00:00.000Z",
      },
    } as never);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          gating: expect.objectContaining({
            canSend: false,
          }),
        }),
      })
    );
    expect(vi.mocked(getEstimateSendGating)).toHaveBeenCalledWith(VERSION_ID);
  });

  it("returns 400 on invalid version id", async () => {
    const response = await GET(new Request("http://localhost"), {
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
    expect(vi.mocked(getEstimateSendGating)).not.toHaveBeenCalled();
  });

  it("maps server failures with error envelope", async () => {
    vi.mocked(getEstimateSendGating).mockRejectedValue(
      internalError("Erreur inattendue de gating.")
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "INTERNAL_ERROR",
          message: "Erreur inattendue de gating.",
        }),
      })
    );
  });
});
