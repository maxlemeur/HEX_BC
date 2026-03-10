import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateSupplierComparisons: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/supplier-comparisons/route";
import { getEstimateSupplierComparisons } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID_1 = "22222222-2222-4222-8222-222222222222";
const ITEM_ID_2 = "33333333-3333-4333-8333-333333333333";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

function makeUuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("POST /api/estimates/[versionId]/supplier-comparisons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 BAD_REQUEST when JSON payload is invalid", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/supplier-comparisons`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(vi.mocked(getEstimateSupplierComparisons)).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when item_ids contains invalid UUID", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/supplier-comparisons`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item_ids: [ITEM_ID_1, "not-a-uuid"],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(getEstimateSupplierComparisons)).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when item_ids exceeds 200 unique identifiers", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/supplier-comparisons`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item_ids: Array.from({ length: 201 }, (_, index) => makeUuid(index + 1)),
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(getEstimateSupplierComparisons)).not.toHaveBeenCalled();
  });

  it("deduplicates item_ids and forwards request to service", async () => {
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      comparisons: [
        {
          item_id: ITEM_ID_1,
          selected_supplier_price_id: null,
          best_supplier_price_id: null,
          alternatives: [],
        },
        {
          item_id: ITEM_ID_2,
          selected_supplier_price_id: "44444444-4444-4444-8444-444444444444",
          best_supplier_price_id: "55555555-5555-4555-8555-555555555555",
          alternatives: [
            {
              kind: "best_price",
              supplier_price_id: "55555555-5555-4555-8555-555555555555",
              supplier_id: "66666666-6666-4666-8666-666666666666",
              supplier_name: "Supplier",
              adjusted_unit_price_cents: 1200,
              supplier_reference: "REF-1",
              catalogue_url: null,
              updated_at: "2026-02-20T10:00:00.000Z",
              is_stale: false,
              product_designation: "Tube acier",
              is_selected: false,
            },
          ],
        },
      ],
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/supplier-comparisons`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          item_ids: [ITEM_ID_1, ITEM_ID_2, ITEM_ID_1],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        stale_price_days: number;
        comparisons: Array<{ item_id: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.stale_price_days).toBe(90);
    expect(body.data.comparisons).toHaveLength(2);
    expect(vi.mocked(getEstimateSupplierComparisons)).toHaveBeenCalledWith(
      VERSION_ID,
      [ITEM_ID_1, ITEM_ID_2]
    );
  });
});
