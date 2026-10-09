import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/purchase-order-drafts", () => ({
  getEstimatePurchaseOrderDraftPreparation: vi.fn(),
  createEstimatePurchaseOrderDrafts: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/purchase-order-drafts/route";
import { createEstimatePurchaseOrderDrafts } from "@/lib/estimates/purchase-order-drafts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
const DELIVERY_SITE_ID = "44444444-4444-4444-8444-444444444444";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("estimate purchase order drafts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when POST payload is invalid JSON", async () => {
    const response = await POST(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/purchase-order-drafts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(vi.mocked(createEstimatePurchaseOrderDrafts)).not.toHaveBeenCalled();
  });

  it("accepts the TBD sentinel in POST payloads", async () => {
    vi.mocked(createEstimatePurchaseOrderDrafts).mockResolvedValue({
      source_version_id: VERSION_ID,
      summary: {
        draft_orders_created: 1,
        draft_lines_created: 1,
      },
      orders: [],
    } as never);

    const response = await POST(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/purchase-order-drafts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          groups: [
            {
              supplier_id: SUPPLIER_ID,
              delivery_site_id: DELIVERY_SITE_ID,
              item_ids: [ITEM_ID],
              expectedDeliveryDate: " TBD ",
            },
          ],
        }),
      }),
      makeParams()
    );

    expect(response.status).toBe(201);
    expect(vi.mocked(createEstimatePurchaseOrderDrafts)).toHaveBeenCalledWith(
      VERSION_ID,
      {
        groups: [
          {
            supplier_id: SUPPLIER_ID,
            delivery_site_id: DELIVERY_SITE_ID,
            item_ids: [ITEM_ID],
            expected_delivery_date: "TBD",
            notes: null,
          },
        ],
      }
    );
  });
});
