import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  suggestEstimateCataloguePrices: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/suggest-prices/route";
import { suggestEstimateCataloguePrices } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("GET /api/estimates/[versionId]/suggest-prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when q is missing", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/suggest-prices`,
      { method: "GET" }
    );

    const response = await GET(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(vi.mocked(suggestEstimateCataloguePrices)).not.toHaveBeenCalled();
  });

  it("forwards versionId and q to server", async () => {
    vi.mocked(suggestEstimateCataloguePrices).mockResolvedValue({
      query: "tube",
      stale_price_days: 90,
      suggestions: [],
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/suggest-prices?q=tube`,
      { method: "GET" }
    );

    const response = await GET(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        query: string;
        stale_price_days: number;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.query).toBe("tube");
    expect(body.data.stale_price_days).toBe(90);
    expect(vi.mocked(suggestEstimateCataloguePrices)).toHaveBeenCalledWith(
      VERSION_ID,
      "tube"
    );
  });
});
