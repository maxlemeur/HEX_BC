import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  verifyEstimateSeal: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/verify/route";
import { verifyEstimateSeal } from "@/lib/estimates/server";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";

describe("estimate verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns verify payload when seal is valid", async () => {
    vi.mocked(verifyEstimateSeal).mockResolvedValue({
      valid: true,
      computed_hash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      stored_hash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/verify`, {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          valid: true,
        }),
      })
    );
  });

  it("returns verify payload when seal is invalid", async () => {
    vi.mocked(verifyEstimateSeal).mockResolvedValue({
      valid: false,
      computed_hash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      stored_hash:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/verify`, {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          valid: false,
        }),
      })
    );
  });

  it("returns 400 when versionId is invalid", async () => {
    const request = new Request("http://localhost/api/estimates/not-a-uuid/verify", {
      method: "GET",
    });

    const response = await GET(request, {
      params: Promise.resolve({ versionId: "not-a-uuid" }),
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
    expect(vi.mocked(verifyEstimateSeal)).not.toHaveBeenCalled();
  });
});
