import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  listEstimateItems: vi.fn(),
  getEstimateSupplierComparisons: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/reference", () => ({
  buildPurchaseOrderReference: vi.fn(() => "C-2603-001"),
}));

import {
  createEstimatePurchaseOrderDrafts,
  getEstimatePurchaseOrderDraftPreparation,
} from "@/lib/estimates/purchase-order-drafts";
import {
  getEstimateSupplierComparisons,
  listEstimateItems,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_SUPPLIER_ID = "66666666-6666-4666-8666-666666666666";
const DELIVERY_SITE_ID = "55555555-5555-4555-8555-555555555555";

function makeLine(input: {
  id: string;
  title: string;
  quantity: number | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp?: number | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
}) {
  return {
    id: input.id,
    item_type: "line",
    title: input.title,
    quantity: input.quantity,
    unit_price_ht_cents: input.unit_price_ht_cents,
    tax_rate_bp: input.tax_rate_bp ?? 2000,
    supply_type_id: input.supply_type_id ?? "supply-1",
    selected_supplier_price_id: input.selected_supplier_price_id ?? null,
  };
}

function createThenableBuilder<T>(resolveResult: () => T) {
  const builder = {
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(resolveResult()).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

function createSupabaseMock(options?: {
  insertedOrders?: Array<{ id: string; order_number: number }>;
  updateErrors?: Array<{ message: string; code?: string } | null>;
  itemInsertErrors?: Array<{ message: string; code?: string } | null>;
  draftedOrderIdsByCall?: string[][];
  draftedSourceItemIdsByCall?: string[][];
}) {
  const membershipsLimit = vi.fn().mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: "engineer",
        is_default: true,
        created_at: "2026-03-11T10:00:00.000Z",
      },
    ],
    error: null,
  });
  const membershipsOrder = vi.fn(() => ({ order: membershipsOrder, limit: membershipsLimit }));
  membershipsOrder.mockReturnValue({ order: membershipsOrder, limit: membershipsLimit });

  const deliverySitesIn = vi.fn().mockResolvedValue({
    data: [{ id: DELIVERY_SITE_ID }],
    error: null,
  });
  const deliverySitesEq = vi.fn(() => ({ in: deliverySitesIn }));

  let insertIndex = 0;
  const insertedOrders = options?.insertedOrders ?? [
    {
      id: "order-1",
      order_number: 1,
    },
  ];
  const orderSelectSingle = vi.fn().mockImplementation(() => {
    const nextOrder =
      insertedOrders[insertIndex] ?? insertedOrders[insertedOrders.length - 1] ?? null;
    insertIndex += 1;
    return Promise.resolve({
      data: nextOrder,
      error: null,
    });
  });
  const purchaseOrdersInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: orderSelectSingle,
    })),
  }));
  let updateIndex = 0;
  const purchaseOrdersUpdateEq = vi.fn().mockImplementation(() =>
    Promise.resolve({
      error: options?.updateErrors?.[updateIndex++] ?? null,
    })
  );
  const purchaseOrdersUpdate = vi.fn(() => ({
    eq: purchaseOrdersUpdateEq,
  }));
  const deletedOrderIds: string[] = [];
  const purchaseOrdersDeleteEq = vi
    .fn()
    .mockImplementation((column: string, value: string) => {
      if (column === "id") {
        deletedOrderIds.push(value);
      }
      return Promise.resolve({ error: null });
    });
  const purchaseOrdersDelete = vi.fn(() => ({
    eq: purchaseOrdersDeleteEq,
  }));

  let draftedOrderSelectIndex = 0;
  const purchaseOrdersSelect = vi.fn(() =>
    createThenableBuilder(() => ({
      data: (options?.draftedOrderIdsByCall?.[draftedOrderSelectIndex++] ?? []).map((id) => ({
        id,
      })),
      error: null,
    }))
  );

  let itemInsertIndex = 0;
  const purchaseOrderItemsInsert = vi.fn().mockImplementation(() =>
    Promise.resolve({
      error: options?.itemInsertErrors?.[itemInsertIndex++] ?? null,
    })
  );
  let draftedItemSelectIndex = 0;
  const purchaseOrderItemsSelect = vi.fn(() =>
    createThenableBuilder(() => ({
      data: (
        options?.draftedSourceItemIdsByCall?.[draftedItemSelectIndex++] ?? []
      ).map((source_estimate_item_id) => ({
        source_estimate_item_id,
      })),
      error: null,
    }))
  );

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
          },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: membershipsOrder,
            })),
          })),
        };
      }

      if (table === "delivery_sites") {
        return {
          select: vi.fn(() => ({
            eq: deliverySitesEq,
          })),
        };
      }

      if (table === "purchase_orders") {
        return {
          select: purchaseOrdersSelect,
          insert: purchaseOrdersInsert,
          update: purchaseOrdersUpdate,
          delete: purchaseOrdersDelete,
        };
      }

      if (table === "purchase_order_items") {
        return {
          select: purchaseOrderItemsSelect,
          insert: purchaseOrderItemsInsert,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    supabase,
    deletedOrderIds,
    purchaseOrdersInsert,
    purchaseOrderItemsInsert,
  };
}

describe("estimate purchase order drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups only covered selected supplier lines and isolates blocked reasons", async () => {
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        makeLine({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Ligne draftable",
          quantity: 2,
          unit_price_ht_cents: 1200,
          selected_supplier_price_id: "price-1",
        }),
        makeLine({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Sans selection",
          quantity: 1,
          unit_price_ht_cents: 900,
          selected_supplier_price_id: null,
        }),
        makeLine({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          title: "Quantite decimale",
          quantity: 1.5,
          unit_price_ht_cents: 700,
          selected_supplier_price_id: "price-3",
        }),
      ],
    } as never);

    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      coverage_summary: {
        total_items: 3,
        covered_items: 2,
        ambiguous_items: 0,
        no_price_items: 0,
        stale_items: 0,
      },
      comparisons: [
        {
          item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          selected_supplier_price_id: "price-1",
          best_supplier_price_id: "price-1",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-1",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 1200,
            supplier_reference: "REF-1",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit A",
            is_selected: true,
          },
          alternatives: [],
        },
        {
          item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          selected_supplier_price_id: null,
          best_supplier_price_id: "price-2",
          coverage_status: "covered",
          risk_flags: ["selection_missing"],
          selected_alternative: null,
          alternatives: [],
        },
        {
          item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          selected_supplier_price_id: "price-3",
          best_supplier_price_id: "price-3",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-3",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 700,
            supplier_reference: "REF-3",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit C",
            is_selected: true,
          },
          alternatives: [],
        },
      ],
      bulk_preselection: {
        summary: {
          total_items: 3,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
    } as never);

    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await getEstimatePurchaseOrderDraftPreparation(VERSION_ID);

    expect(result.summary.draftable_lines).toBe(1);
    expect(result.summary.selection_missing_lines).toBe(1);
    expect(result.summary.non_integer_quantity_lines).toBe(1);
    expect(result.groups).toEqual([
      expect.objectContaining({
        supplier_id: SUPPLIER_ID,
        supplier_name: "Supplier A",
        line_count: 1,
      }),
    ]);
    expect(result.blocked_lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          reason: "selection_missing",
        }),
        expect.objectContaining({
          item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          reason: "non_integer_quantity",
        }),
      ])
    );
  });

  it("excludes estimate lines already linked to an existing draft order", async () => {
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        makeLine({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Ligne deja draft",
          quantity: 2,
          unit_price_ht_cents: 1200,
          selected_supplier_price_id: "price-1",
        }),
        makeLine({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Ligne encore disponible",
          quantity: 1,
          unit_price_ht_cents: 900,
          selected_supplier_price_id: "price-2",
        }),
      ],
    } as never);

    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      coverage_summary: {
        total_items: 2,
        covered_items: 2,
        ambiguous_items: 0,
        no_price_items: 0,
        stale_items: 0,
      },
      comparisons: [
        {
          item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          selected_supplier_price_id: "price-2",
          best_supplier_price_id: "price-2",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-2",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 900,
            supplier_reference: "REF-2",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit B",
            is_selected: true,
          },
          alternatives: [],
        },
      ],
      bulk_preselection: {
        summary: {
          total_items: 2,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
    } as never);

    const { supabase } = createSupabaseMock({
      draftedOrderIdsByCall: [["draft-order-1"]],
      draftedSourceItemIdsByCall: [["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await getEstimatePurchaseOrderDraftPreparation(VERSION_ID);

    expect(result.summary.total_supplier_lines).toBe(1);
    expect(result.summary.draftable_lines).toBe(1);
    expect(result.groups).toEqual([
      expect.objectContaining({
        supplier_id: SUPPLIER_ID,
        lines: [
          expect.objectContaining({
            item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        ],
      }),
    ]);
    expect(
      result.groups.some((group) =>
        group.lines.some(
          (line) => line.item_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        )
      )
    ).toBe(false);
  });

  it("creates draft purchase orders with source traceability", async () => {
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        makeLine({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Ligne draftable",
          quantity: 2,
          unit_price_ht_cents: 1200,
          selected_supplier_price_id: "price-1",
        }),
      ],
    } as never);

    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      coverage_summary: {
        total_items: 1,
        covered_items: 1,
        ambiguous_items: 0,
        no_price_items: 0,
        stale_items: 0,
      },
      comparisons: [
        {
          item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          selected_supplier_price_id: "price-1",
          best_supplier_price_id: "price-1",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-1",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 1200,
            supplier_reference: "REF-1",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit A",
            is_selected: true,
          },
          alternatives: [],
        },
      ],
      bulk_preselection: {
        summary: {
          total_items: 1,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
    } as never);

    const { supabase, purchaseOrdersInsert, purchaseOrderItemsInsert } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createEstimatePurchaseOrderDrafts(VERSION_ID, {
      groups: [
        {
          supplier_id: SUPPLIER_ID,
          delivery_site_id: DELIVERY_SITE_ID,
          item_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
          expected_delivery_date: null,
          notes: "Commande depuis finish line",
        },
      ],
    });

    expect(result.summary).toEqual({
      draft_orders_created: 1,
      draft_lines_created: 1,
    });
    expect(purchaseOrdersInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        supplier_id: SUPPLIER_ID,
        delivery_site_id: DELIVERY_SITE_ID,
        expected_delivery_date: null,
        source_estimate_version_id: VERSION_ID,
      })
    );
    expect(purchaseOrderItemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        designation: "Ligne draftable",
        source_estimate_item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        source_selected_supplier_price_id: "price-1",
      }),
    ]);
  });

  it("rolls back previously created draft orders when a later group fails", async () => {
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        makeLine({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Ligne fournisseur A",
          quantity: 2,
          unit_price_ht_cents: 1200,
          selected_supplier_price_id: "price-1",
        }),
        makeLine({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Ligne fournisseur B",
          quantity: 1,
          unit_price_ht_cents: 800,
          selected_supplier_price_id: "price-2",
        }),
      ],
    } as never);

    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      coverage_summary: {
        total_items: 2,
        covered_items: 2,
        ambiguous_items: 0,
        no_price_items: 0,
        stale_items: 0,
      },
      comparisons: [
        {
          item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          selected_supplier_price_id: "price-1",
          best_supplier_price_id: "price-1",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-1",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 1200,
            supplier_reference: "REF-1",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit A",
            is_selected: true,
          },
          alternatives: [],
        },
        {
          item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          selected_supplier_price_id: "price-2",
          best_supplier_price_id: "price-2",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-2",
            supplier_id: SECOND_SUPPLIER_ID,
            supplier_name: "Supplier B",
            adjusted_unit_price_cents: 800,
            supplier_reference: "REF-2",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit B",
            is_selected: true,
          },
          alternatives: [],
        },
      ],
      bulk_preselection: {
        summary: {
          total_items: 2,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
    } as never);

    const { supabase, deletedOrderIds } = createSupabaseMock({
      insertedOrders: [
        { id: "order-1", order_number: 1 },
        { id: "order-2", order_number: 2 },
      ],
      itemInsertErrors: [null, { message: "insert failed", code: "23503" }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimatePurchaseOrderDrafts(VERSION_ID, {
        groups: [
          {
            supplier_id: SUPPLIER_ID,
            delivery_site_id: DELIVERY_SITE_ID,
            item_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            expected_delivery_date: null,
            notes: null,
          },
          {
            supplier_id: SECOND_SUPPLIER_ID,
            delivery_site_id: DELIVERY_SITE_ID,
            item_ids: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
            expected_delivery_date: null,
            notes: null,
          },
        ],
      })
    ).rejects.toMatchObject({
      message: "Impossible d'enregistrer les lignes de commande.",
    });

    expect(deletedOrderIds).toEqual(["order-1", "order-2"]);
  });

  it("rejects creation when requested lines become drafted after preparation", async () => {
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        makeLine({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Ligne draftable",
          quantity: 2,
          unit_price_ht_cents: 1200,
          selected_supplier_price_id: "price-1",
        }),
      ],
    } as never);

    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      coverage_summary: {
        total_items: 1,
        covered_items: 1,
        ambiguous_items: 0,
        no_price_items: 0,
        stale_items: 0,
      },
      comparisons: [
        {
          item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          selected_supplier_price_id: "price-1",
          best_supplier_price_id: "price-1",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-1",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 1200,
            supplier_reference: "REF-1",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit A",
            is_selected: true,
          },
          alternatives: [],
        },
      ],
      bulk_preselection: {
        summary: {
          total_items: 1,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
    } as never);

    const { supabase, purchaseOrdersInsert, purchaseOrderItemsInsert } = createSupabaseMock({
      draftedOrderIdsByCall: [[], ["draft-order-1"]],
      draftedSourceItemIdsByCall: [["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimatePurchaseOrderDrafts(VERSION_ID, {
        groups: [
          {
            supplier_id: SUPPLIER_ID,
            delivery_site_id: DELIVERY_SITE_ID,
            item_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            expected_delivery_date: null,
            notes: null,
          },
        ],
      })
    ).rejects.toMatchObject({
      message: "Certaines lignes sont deja rattachees a un brouillon de commande.",
      code: "ORDER_DRAFT_ALREADY_EXISTS",
    });

    expect(purchaseOrdersInsert).not.toHaveBeenCalled();
    expect(purchaseOrderItemsInsert).not.toHaveBeenCalled();
  });

  it("preserves the TBD sentinel for estimate-derived draft orders", async () => {
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        makeLine({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Ligne draftable",
          quantity: 2,
          unit_price_ht_cents: 1200,
          selected_supplier_price_id: "price-1",
        }),
      ],
    } as never);

    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      stale_price_days: 90,
      coverage_summary: {
        total_items: 1,
        covered_items: 1,
        ambiguous_items: 0,
        no_price_items: 0,
        stale_items: 0,
      },
      comparisons: [
        {
          item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          selected_supplier_price_id: "price-1",
          best_supplier_price_id: "price-1",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-1",
            supplier_id: SUPPLIER_ID,
            supplier_name: "Supplier A",
            adjusted_unit_price_cents: 1200,
            supplier_reference: "REF-1",
            catalogue_url: null,
            updated_at: "2026-03-11T10:00:00.000Z",
            is_stale: false,
            product_designation: "Produit A",
            is_selected: true,
          },
          alternatives: [],
        },
      ],
      bulk_preselection: {
        summary: {
          total_items: 1,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
    } as never);

    const { supabase, purchaseOrdersInsert } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await createEstimatePurchaseOrderDrafts(VERSION_ID, {
      groups: [
        {
          supplier_id: SUPPLIER_ID,
          delivery_site_id: DELIVERY_SITE_ID,
          item_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
          expected_delivery_date: "TBD",
          notes: null,
        },
      ],
    });

    expect(purchaseOrdersInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_delivery_date: "TBD",
      })
    );
  });
});
