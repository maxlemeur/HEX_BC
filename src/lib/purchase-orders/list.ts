import { readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { badRequest, unauthorized } from "@/lib/estimates/errors";

import type { OrdersListQueryInput } from "./schemas";

export type PurchaseOrderListRelated =
  | { id: string; name: string }
  | { id: string; name: string }[]
  | null;

export type PurchaseOrderListItem = {
  id: string;
  reference: string;
  created_at: string;
  status: "draft" | "sent" | "confirmed" | "received" | "canceled";
  expected_delivery_date: string | null;
  total_ht_cents: number;
  suppliers: PurchaseOrderListRelated;
  delivery_sites: PurchaseOrderListRelated;
  devis_count: number;
  has_devis: "with" | "without";
};

export type OrderItemRow = {
  id: string;
  purchase_order_id?: string;
  designation: string;
  reference: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  line_total_ht_cents: number;
};

export type OrdersLookupRow = {
  id: string;
  name: string;
};

export type OrdersListResponse = {
  items: PurchaseOrderListItem[];
  suppliers: OrdersLookupRow[];
  delivery_sites: OrdersLookupRow[];
};

export type OrderItemsResponse = {
  items: OrderItemRow[];
  itemsByOrderId: Record<string, OrderItemRow[]>;
};

async function getAuthenticatedClient() {
  const { supabase, user, error } = await readAuthenticatedUser();
  if (error || !user) {
    throw unauthorized();
  }
  return { supabase, userId: user.id };
}

function asLookupRows(data: unknown): OrdersLookupRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as { id?: unknown; name?: unknown };
    if (typeof record.id !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [{ id: record.id, name: record.name }];
  });
}

function groupItemsByOrderId(rows: OrderItemRow[]) {
  const itemsByOrderId: Record<string, OrderItemRow[]> = {};
  for (const row of rows) {
    const orderId = row.purchase_order_id;
    if (!orderId) continue;
    if (!itemsByOrderId[orderId]) {
      itemsByOrderId[orderId] = [];
    }
    itemsByOrderId[orderId].push({
      id: row.id,
      designation: row.designation,
      reference: row.reference,
      quantity: row.quantity,
      unit_price_ht_cents: row.unit_price_ht_cents,
      line_total_ht_cents: row.line_total_ht_cents,
    });
  }
  return itemsByOrderId;
}

export async function listOrdersPage(): Promise<OrdersListResponse> {
  const { supabase } = await getAuthenticatedClient();

  const [ordersResult, suppliersResult, sitesResult] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, reference, created_at, status, expected_delivery_date, total_ht_cents, suppliers ( id, name ), delivery_sites ( id, name )"
      )
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("delivery_sites").select("id, name").order("name"),
  ]);

  if (ordersResult.error) {
    throw badRequest(ordersResult.error.message);
  }

  const orders = (ordersResult.data ?? []) as unknown as Array<
    Omit<PurchaseOrderListItem, "devis_count" | "has_devis">
  >;
  const orderIds = orders.map((order) => order.id);
  const devisCountMap: Record<string, number> = {};

  if (orderIds.length > 0) {
    const { data: devisData, error: devisError } = await supabase
      .from("purchase_order_devis")
      .select("purchase_order_id")
      .in("purchase_order_id", orderIds);

    if (devisError) {
      throw badRequest(devisError.message);
    }

    for (const row of devisData ?? []) {
      const orderId = (row as { purchase_order_id?: string }).purchase_order_id;
      if (!orderId) continue;
      devisCountMap[orderId] = (devisCountMap[orderId] ?? 0) + 1;
    }
  }

  return {
    items: orders.map((order) => {
      const devisCount = devisCountMap[order.id] ?? 0;
      return {
        ...order,
        devis_count: devisCount,
        has_devis: devisCount > 0 ? "with" : "without",
      };
    }),
    suppliers: asLookupRows(suppliersResult.data),
    delivery_sites: asLookupRows(sitesResult.data),
  };
}

export async function listOrderItems(
  orderIds: string[]
): Promise<OrderItemsResponse> {
  const { supabase } = await getAuthenticatedClient();

  if (orderIds.length === 0) {
    return { items: [], itemsByOrderId: {} };
  }

  const query = supabase
    .from("purchase_order_items")
    .select(
      "id, purchase_order_id, designation, reference, quantity, unit_price_ht_cents, line_total_ht_cents"
    )
    .in("purchase_order_id", orderIds);

  const { data, error } = await query
    .order("purchase_order_id", { ascending: true })
    .order("position", { ascending: true });
  if (error) {
    throw badRequest(error.message);
  }

  const items = (data ?? []) as OrderItemRow[];
  return {
    items: items.map((item) => ({
      id: item.id,
      designation: item.designation,
      reference: item.reference,
      quantity: item.quantity,
      unit_price_ht_cents: item.unit_price_ht_cents,
      line_total_ht_cents: item.line_total_ht_cents,
    })),
    itemsByOrderId: groupItemsByOrderId(items),
  };
}

export async function getOrdersDirectoryData(query: OrdersListQueryInput) {
  if (query.view === "items") {
    return listOrderItems(query.order_id);
  }

  return listOrdersPage();
}
