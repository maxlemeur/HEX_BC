import { readAllRows } from "@/lib/supabase/read-all";
import { readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { ApiError, badRequest, conflict, internalError, payloadTooLarge, unauthorized } from "@/lib/estimates/errors";

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

export type OrdersLookupRow = { id: string; name: string };
export type OrdersListResponse = {
  items: PurchaseOrderListItem[];
  pagination: { page: number; size: number; totalItems: number; totalPages: number };
};
type OrderListDatabaseRow = Omit<PurchaseOrderListItem, "devis_count" | "has_devis"> & {
  quote_counts: Array<{ count: number }>; devis_filter?: unknown;
};
export type OrderItemsResponse = {
  orders: Omit<PurchaseOrderListItem, "devis_count" | "has_devis">[];
  items: OrderItemRow[];
  itemsByOrderId: Record<string, OrderItemRow[]>;
};

async function getAuthenticatedClient() {
  const { supabase, user, error } = await readAuthenticatedUser();
  if (error || !user) throw unauthorized();
  return supabase;
}
type Client = Awaited<ReturnType<typeof getAuthenticatedClient>>;
// The legacy `count` embed works with db-aggregates-enabled=false. `count()`
// requires a different server setting; retain this compatible, bounded form.
const LIST_COLUMNS = "id, reference, created_at, status, expected_delivery_date, total_ht_cents, total_tax_cents, total_ttc_cents, edit_revision, suppliers ( id, name ), delivery_sites ( id, name ), quote_counts:purchase_order_devis(count)";
const SELECTION_COLUMNS = "id, edit_revision, suppliers(name), delivery_sites(name)";

// Preserve the previous accent-insensitive literal substring search while
// filtering before pagination. All regex syntax supplied by the user is escaped.
const referenceLetterVariants: Record<string, string> = {
  a: "[aàâä]", c: "[cç]", e: "[eèéêë]", i: "[iîï]", o: "[oôö]", u: "[uùûü]", y: "[yÿ]",
};
function referenceSearchPattern(value: string) {
  return [...value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")]
    .map(letter => referenceLetterVariants[letter] ?? letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("");
}

function filteredOrders(supabase: Client, query: OrdersListQueryInput, columns: string) {
  // An empty embed is used only for EXISTS/NOT EXISTS. Keeping it separate
  // from the count embed also handles orders with zero children correctly.
  let request = supabase.from("purchase_orders")
    .select(columns + (query.has_devis ? ",devis_filter:purchase_order_devis()" : ""), { count: "exact" });
  if (query.q) request = request.regexIMatch("reference", referenceSearchPattern(query.q));
  if (query.status.length) request = request.in("status", query.status);
  if (query.supplier_id) request = request.eq("supplier_id", query.supplier_id);
  if (query.delivery_site_id) request = request.eq("delivery_site_id", query.delivery_site_id);
  if (query.has_devis === "with") request = request.not("devis_filter", "is", null);
  if (query.has_devis === "without") request = request.is("devis_filter", null);
  if (query.date_from) request = request.gte("created_at", `${query.date_from}T00:00:00.000Z`);
  if (query.date_to) {
    const nextDay = new Date(`${query.date_to}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    request = request.lt("created_at", nextDay.toISOString());
  }
  return request.order(query.sort, { ascending: query.direction === "asc", nullsFirst: query.direction === "desc" })
    .order("id", { ascending: true });
}

function orderListRows(data: unknown): PurchaseOrderListItem[] {
  return ((data ?? []) as OrderListDatabaseRow[]).map(({ quote_counts, ...order }) => {
    delete order.devis_filter;
    const count = quote_counts?.[0]?.count;
    if (!Number.isSafeInteger(count) || count < 0) throw internalError("Le compte des devis est incomplet.");
    return { ...order, devis_count: count, has_devis: count > 0 ? "with" : "without" };
  });
}

export async function listOrdersPage(query: OrdersListQueryInput): Promise<OrdersListResponse> {
  const supabase = await getAuthenticatedClient();
  const offset = (query.page - 1) * query.size;
  const { data, error, count } = await filteredOrders(supabase, query, LIST_COLUMNS).range(offset, offset + query.size - 1);
  if (error) throw badRequest(error.message);
  if (count === null || !Number.isSafeInteger(count) || count < 0) throw internalError("Le nombre de commandes est indisponible.");
  const rows = orderListRows(data);
  const expectedRows = Math.min(query.size, Math.max(0, count - offset));
  if (rows.length !== expectedRows) throw internalError("La page des commandes est incomplète.");
  return {
    items: rows,
    pagination: { page: query.page, size: query.size, totalItems: count, totalPages: Math.max(1, Math.ceil(count / query.size)) },
  };
}

async function listOrdersLookups(supabase = getAuthenticatedClient()) {
  const client = await supabase;
  const [suppliers, sites, orders] = await Promise.all([
    readAllRows(() => client.from("suppliers").select("id, name", { count: "exact" })),
    readAllRows(() => client.from("delivery_sites").select("id, name", { count: "exact" })),
    client.from("purchase_orders").select("id", { count: "exact", head: true }),
  ]);
  for (const result of [suppliers, sites, orders]) if (result.error) throw badRequest(result.error.message);
  if (orders.count === null || !Number.isSafeInteger(orders.count)) throw internalError("Le nombre de commandes est indisponible.");
  const byName = (a: OrdersLookupRow, b: OrdersLookupRow) => a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id);
  return { suppliers: (suppliers.data ?? []).sort(byName), delivery_sites: (sites.data ?? []).sort(byName), totalOrders: orders.count };
}

async function listOrdersLegacy(query: OrdersListQueryInput) {
  const supabase = getAuthenticatedClient();
  const [orders, lookups] = await Promise.all([
    supabase.then(client => readAllRows(() => filteredOrders(client, query, LIST_COLUMNS))),
    listOrdersLookups(supabase),
  ]);
  if (orders.error) throw badRequest(orders.error.message);
  // Existing API consumers retain their complete inventory. The UI opts into
  // view=page, so it never pays for this compatibility projection.
  return { items: orderListRows(orders.data), ...lookups };
}

async function orderItems(supabase: Client, orderIds: string[]): Promise<OrderItemsResponse> {
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
    if (rows.some((item) => item.purchase_order_id !== order.id)) throw internalError("La projection des lignes est incohérente.");
    orders.push(order);
    items.push(...rows);
    itemsByOrderId[order.id] = rows;
  }
  return { orders, items, itemsByOrderId };
}

export async function listOrderItems(orderIds: string[]): Promise<OrderItemsResponse> {
  return orderItems(await getAuthenticatedClient(), orderIds);
}

async function exportOrders(query: OrdersListQueryInput) {
  const supabase = await getAuthenticatedClient();
  const selection = async () => {
    const result = await readAllRows(() => filteredOrders(supabase, query, SELECTION_COLUMNS));
    if (result.error) throw badRequest(result.error.message);
    return result.data ?? [];
  };
  const before = await selection() as unknown as Array<{ id: string; edit_revision: number }>;
  const result: OrderItemsResponse & { selection_count: number } = {
    orders: [], items: [], itemsByOrderId: {}, selection_count: before.length,
  };
  for (let start = 0; start < before.length; start += 100) {
    // Each header and its lines come from the same transactional RPC snapshot.
    // Batches avoid the 1000-order RPC ceiling; the existing global 10000-line
    // export limit stays explicit, never a partial download.
    const batch = before.slice(start, start + 100);
    const snapshot = await orderItems(supabase, batch.map(order => order.id));
    const expected = new Map(batch.map(order => [order.id, order.edit_revision]));
    if (snapshot.orders.some(order => expected.get(order.id) !== order.edit_revision)) {
      throw conflict("La sélection a changé pendant l’export. Réessayez.");
    }
    if (result.items.length + snapshot.items.length > 10_000) {
      throw payloadTooLarge("L’export dépasse 10 000 lignes. Affinez les filtres avant de réessayer.");
    }
    result.orders.push(...snapshot.orders);
    result.items.push(...snapshot.items);
    Object.assign(result.itemsByOrderId, snapshot.itemsByOrderId);
  }
  if (JSON.stringify(before) !== JSON.stringify(await selection())) {
    throw conflict("La sélection a changé pendant l’export. Réessayez.");
  }
  return result;
}

export async function getOrdersDirectoryData(query: OrdersListQueryInput) {
  if (query.view === "items") return listOrderItems(query.order_id);
  if (query.view === "lookups") return listOrdersLookups();
  if (query.view === "export") return exportOrders(query);
  if (query.view === "page") return listOrdersPage(query);
  return listOrdersLegacy(query);
}
