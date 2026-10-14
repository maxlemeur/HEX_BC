import { readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { ApiError, badRequest, internalError, unauthorized } from "@/lib/estimates/errors";

import { purchaseOrderDocumentsSchema, type OrdersListQueryInput } from "@/lib/purchase-orders/schemas";
import { purchaseOrderWriteError } from "@/lib/purchase-orders/write";

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
  total_tax_cents: number;
  total_ttc_cents: number;
  edit_revision: number;
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
  unit: string | null;
  price_unit: string | null;
  product_id: string | null;
  is_source_linked: boolean;
  source_estimate_item_id: string | null;
  source_selected_supplier_price_id: string | null;
  tax_rate_bp: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
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
  orders: Omit<PurchaseOrderListItem, "devis_count" | "has_devis">[];
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

export async function listOrdersPage(): Promise<OrdersListResponse> {
  const { supabase } = await getAuthenticatedClient();

  const [ordersResult, suppliersResult, sitesResult] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, reference, created_at, status, expected_delivery_date, total_ht_cents, total_tax_cents, total_ttc_cents, edit_revision, suppliers ( id, name ), delivery_sites ( id, name )"
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

  if (orderIds.length === 0) return { orders: [], items: [], itemsByOrderId: {} };
  const ids = [...new Set(orderIds.map((id) => id.toLowerCase()))];
  const { data, error } = await supabase.rpc("get_purchase_order_documents", { p_order_ids: ids });
  if (error) {
    const failure = purchaseOrderWriteError(error);
    throw new ApiError({ status: failure.status, code: failure.code, message: failure.message });
  }
  const parsed = purchaseOrderDocumentsSchema.safeParse(data);
  if (!parsed.success || parsed.data.orders.length !== ids.length ||
      new Set(parsed.data.orders.map((order) => order.id)).size !== ids.length ||
      parsed.data.orders.some((order) => !ids.includes(order.id))) {
    throw internalError("La projection des commandes est incomplète. Aucun export ne peut être produit.");
  }
  const orders: OrderItemsResponse["orders"] = [];
  const items: OrderItemRow[] = [];
  const itemsByOrderId: Record<string, OrderItemRow[]> = {};
  for (const { items: rows, ...order } of parsed.data.orders) {
    if (rows.some((item) => item.purchase_order_id !== order.id)) {
      throw internalError("La projection des lignes est incohérente.");
    }
    orders.push(order);
    items.push(...rows);
    itemsByOrderId[order.id] = rows;
  }
  return { orders, items, itemsByOrderId };
}

export async function getOrdersDirectoryData(query: OrdersListQueryInput) {
  if (query.view === "items") {
    return listOrderItems(query.order_id);
  }

  return listOrdersPage();
}
