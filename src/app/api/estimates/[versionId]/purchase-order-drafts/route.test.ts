import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/purchase-order-drafts", () => ({
  getEstimatePurchaseOrderDraftPreparation: vi.fn(),
  createEstimatePurchaseOrderDrafts: vi.fn(),
}));

import {
  GET,
  POST,
} from "@/app/api/estimates/[versionId]/purchase-order-drafts/route";
import {
  createEstimatePurchaseOrderDrafts,
  getEstimatePurchaseOrderDraftPreparation,
} from "@/lib/estimates/purchase-order-drafts";

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

  it("returns draft preparation from GET", async () => {
    vi.mocked(getEstimatePurchaseOrderDraftPreparation).mockResolvedValue({
      version_id: VERSION_ID,
      stale_price_days: 90,
      summary: {
        total_supplier_lines: 1,
        draftable_lines: 1,
        blocked_lines: 0,
        supplier_groups: 1,
        selection_missing_lines: 0,
        stale_lines: 0,
        ambiguous_lines: 0,
        no_price_lines: 0,
        missing_quantity_lines: 0,
        non_integer_quantity_lines: 0,
        missing_unit_price_lines: 0,
      },
      groups: [],
      blocked_lines: [],
    } as never);

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/purchase-order-drafts`),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: { version_id: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.version_id).toBe(VERSION_ID);
    expect(vi.mocked(getEstimatePurchaseOrderDraftPreparation)).toHaveBeenCalledWith(
      VERSION_ID
    );
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

  it("creates draft orders from POST", async () => {
    vi.mocked(createEstimatePurchaseOrderDrafts).mockResolvedValue({
      source_version_id: VERSION_ID,
      summary: {
        draft_orders_created: 1,
        draft_lines_created: 1,
      },
      orders: [
        {
          purchase_order_id: "55555555-5555-4555-8555-555555555555",
          reference: "C-2603-001",
          supplier_id: SUPPLIER_ID,
          supplier_name: "Supplier A",
          delivery_site_id: DELIVERY_SITE_ID,
          item_count: 1,
          total_ht_cents: 1200,
          total_tax_cents: 240,
          total_ttc_cents: 1440,
          ordered_source_item_ids: [ITEM_ID],
        },
      ],
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
            },
          ],
        }),
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: { summary: { draft_orders_created: number } };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.summary.draft_orders_created).toBe(1);
    expect(vi.mocked(createEstimatePurchaseOrderDrafts)).toHaveBeenCalledWith(
      VERSION_ID,
      {
        groups: [
          {
            supplier_id: SUPPLIER_ID,
            delivery_site_id: DELIVERY_SITE_ID,
            item_ids: [ITEM_ID],
            expected_delivery_date: null,
            notes: null,
          },
        ],
      }
    );
  });
});
