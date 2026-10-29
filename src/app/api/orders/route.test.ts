import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET } from "@/app/api/orders/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const SITE_ID = "55555555-5555-4555-8555-555555555555";

const ORDER_ROW = {
  id: ORDER_ID,
  reference: "C-2608-001",
  created_at: "2026-08-01T10:00:00.000Z",
  status: "draft",
  expected_delivery_date: "2026-08-20",
  total_ht_cents: 1500,
  total_tax_cents: 300,
  total_ttc_cents: 1800,
  edit_revision: 1,
  suppliers: { id: SUPPLIER_ID, name: "Arcus" },
  delivery_sites: { id: SITE_ID, name: "Chantier Nord" },
};

const ITEM_ROW = {
  id: "66666666-6666-4666-8666-666666666666",
  purchase_order_id: ORDER_ID,
  designation: "Tube",
  reference: "TUB-15",
  quantity: 2,
  unit_price_ht_cents: 750,
  line_total_ht_cents: 1500,
  line_tax_cents: 300,
  line_total_ttc_cents: 1800,
  tax_rate_bp: 2000,
  unit: "u",
  price_unit: "u",
  product_id: null,
  is_source_linked: false,
  source_estimate_item_id: null,
  source_selected_supplier_price_id: null,
};

function createOrdersSupabase(options: {
  authenticated?: boolean;
  orders?: unknown[];
  devis?: Array<{ purchase_order_id: string }>;
  items?: typeof ITEM_ROW[];
} = {}) {
  const tables: string[] = [];
  const rpc = vi.fn(async (name: string, args: { p_order_ids: string[] }) => {
    if (name !== "get_purchase_order_documents") throw new Error(`Unexpected RPC: ${name}`);
    return {
      data: {
        orders: args.p_order_ids.map((id) => ({
          ...ORDER_ROW,
          id,
          items: (options.items ?? [ITEM_ROW]).filter((item) => item.purchase_order_id === id),
        })),
      },
      error: null,
    };
  });

  const supabase = {
    rpc,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: options.authenticated === false ? null : { id: USER_ID },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      tables.push(table);

      if (table === "purchase_orders") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: options.orders ?? [ORDER_ROW],
              error: null,
            })),
          })),
        };
      }

      if (table === "purchase_order_devis") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: options.devis ?? [{ purchase_order_id: ORDER_ID }],
              error: null,
            })),
          })),
        };
      }

      if (table === "suppliers") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: [{ id: SUPPLIER_ID, name: "Arcus" }],
              error: null,
            })),
          })),
        };
      }

      if (table === "delivery_sites") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: [{ id: SITE_ID, name: "Chantier Nord" }],
              error: null,
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, tables, rpc };
}

describe("GET /api/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses view=items without at least one order_id (no tenant-wide dump)", async () => {
    const { supabase } = createOrdersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request("http://localhost/api/orders?view=items")
    );

    expect(response.status).toBe(400);
  });
});
