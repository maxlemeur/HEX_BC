import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET } from "@/app/api/orders/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const SITE_ID = "55555555-5555-4555-8555-555555555555";

const ORDER_ROW = {
  id: ORDER_ID,
  reference: "C-2608-001",
  created_at: "2026-08-01T10:00:00.000Z",
  status: "draft",
  expected_delivery_date: "2026-08-20",
  total_ht_cents: 1500,
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
};

function thenable<T extends Record<string, unknown>>(value: T, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    then: (
      resolve: (value: T) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(value).then(resolve, reject),
  };
}

function createOrdersSupabase(options: {
  authenticated?: boolean;
  orders?: unknown[];
  devis?: Array<{ purchase_order_id: string }>;
  items?: unknown[];
} = {}) {
  const tables: string[] = [];
  const itemFilters: unknown[] = [];

  const supabase = {
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

      if (table === "purchase_order_items") {
        const builder = {
          select: vi.fn(() => builder),
          in: vi.fn((column: string, ids: unknown) => {
            itemFilters.push({ column, ids });
            return builder;
          }),
          order: vi.fn(() =>
            thenable(
              {
                data: options.items ?? [ITEM_ROW],
                error: null,
              },
              { order: vi.fn(async () => ({
                data: options.items ?? [ITEM_ROW],
                error: null,
              })) }
            )
          ),
        };
        return builder;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, tables, itemFilters };
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

  it("rejects unauthenticated access", async () => {
    const { supabase } = createOrdersSupabase({ authenticated: false });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(new Request("http://localhost/api/orders"));
    expect(response.status).toBe(401);
  });

  it("assembles orders, devis counts and lookups on the server", async () => {
    const { supabase, tables } = createOrdersSupabase({
      devis: [
        { purchase_order_id: ORDER_ID },
        { purchase_order_id: ORDER_ID },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(new Request("http://localhost/api/orders"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(tables).toEqual([
      "purchase_orders",
      "suppliers",
      "delivery_sites",
      "purchase_order_devis",
    ]);
    expect(body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: ORDER_ID,
            reference: "C-2608-001",
            devis_count: 2,
            has_devis: "with",
            suppliers: { id: SUPPLIER_ID, name: "Arcus" },
          },
        ],
        suppliers: [{ id: SUPPLIER_ID, name: "Arcus" }],
        delivery_sites: [{ id: SITE_ID, name: "Chantier Nord" }],
      },
    });
  });

  it("skips the devis query when there are no orders", async () => {
    const { supabase, tables } = createOrdersSupabase({ orders: [] });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(new Request("http://localhost/api/orders"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(tables).toEqual(["purchase_orders", "suppliers", "delivery_sites"]);
    expect(body.data.items).toEqual([]);
  });

  it("returns items for one order", async () => {
    const { supabase, itemFilters, tables } = createOrdersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(`http://localhost/api/orders?view=items&order_id=${ORDER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(tables).toEqual(["purchase_order_items"]);
    expect(itemFilters).toEqual([
      { column: "purchase_order_id", ids: [ORDER_ID] },
    ]);
    expect(body).toMatchObject({
      ok: true,
      data: {
        items: [{ id: ITEM_ROW.id, designation: "Tube" }],
        itemsByOrderId: {
          [ORDER_ID]: [{ id: ITEM_ROW.id, designation: "Tube" }],
        },
      },
    });
  });

  it("groups export items by order id", async () => {
    const { supabase, itemFilters } = createOrdersSupabase({
      items: [
        ITEM_ROW,
        { ...ITEM_ROW, id: "77777777-7777-4777-8777-777777777777", purchase_order_id: OTHER_ORDER_ID },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(
        `http://localhost/api/orders?view=items&order_id=${ORDER_ID}&order_id=${OTHER_ORDER_ID}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(itemFilters[0]).toEqual({
      column: "purchase_order_id",
      ids: [ORDER_ID, OTHER_ORDER_ID],
    });
    expect(Object.keys(body.data.itemsByOrderId)).toEqual([
      ORDER_ID,
      OTHER_ORDER_ID,
    ]);
  });

  it("rejects an invalid order id", async () => {
    const { supabase } = createOrdersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request("http://localhost/api/orders?view=items&order_id=not-a-uuid")
    );

    expect(response.status).toBe(400);
  });
});
