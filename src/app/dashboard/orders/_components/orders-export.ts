import { fetchApi } from "@/components/catalogue/api";
import type { ExportColumn } from "@/lib/export";

import {
  formatOrderDate,
  relatedName,
  statusLabel,
  type OrderItemRow,
  type PurchaseOrderListRow,
  type PurchaseOrderStatus,
} from "./orders-model";

type ItemExportRow = {
  order_reference: string;
  order_created_at: string;
  supplier: string;
  delivery_site: string;
  expected_delivery_date: string | null;
  status: PurchaseOrderStatus;
  order_total_ht_cents: number;
  item_designation: string;
  item_reference: string | null;
  item_quantity: number | "";
  item_unit_price_ht_cents: number | "";
  item_line_total_ht_cents: number | "";
};

const ORDER_EXPORT_COLUMNS: ExportColumn<PurchaseOrderListRow>[] = [
  { key: "reference", header: "Référence" },
  {
    key: "created_at",
    header: "Date de création",
    formatter: (value) => formatOrderDate(value as string),
  },
  {
    key: "suppliers",
    header: "Fournisseur",
    formatter: (value) => relatedName(value as PurchaseOrderListRow["suppliers"]),
  },
  {
    key: "delivery_sites",
    header: "Chantier",
    formatter: (value) => relatedName(value as PurchaseOrderListRow["delivery_sites"]),
  },
  {
    key: "expected_delivery_date",
    header: "Date de livraison prévue",
    formatter: (value) => formatOrderDate(value as string | null),
  },
  {
    key: "status",
    header: "Statut",
    formatter: (value) => statusLabel(value as PurchaseOrderStatus),
  },
  {
    key: "total_ht_cents",
    header: "Total HT (EUR)",
    formatter: (value) => (value as number) / 100,
  },
];

const ITEM_EXPORT_COLUMNS: ExportColumn<ItemExportRow>[] = [
  { key: "order_reference", header: "Référence commande" },
  {
    key: "order_created_at",
    header: "Date commande",
    formatter: (value) => formatOrderDate(value as string),
  },
  { key: "supplier", header: "Fournisseur" },
  { key: "delivery_site", header: "Chantier" },
  {
    key: "expected_delivery_date",
    header: "Livraison prévue",
    formatter: (value) => formatOrderDate(value as string | null),
  },
  {
    key: "status",
    header: "Statut",
    formatter: (value) => statusLabel(value as PurchaseOrderStatus),
  },
  {
    key: "order_total_ht_cents",
    header: "Total HT commande (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  { key: "item_designation", header: "Désignation article" },
  { key: "item_reference", header: "Référence article" },
  { key: "item_quantity", header: "Quantité" },
  {
    key: "item_unit_price_ht_cents",
    header: "P.U. HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "item_line_total_ht_cents",
    header: "Total ligne HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
];

function buildItemsExportRows(
  orders: PurchaseOrderListRow[],
  itemsByOrderId: Record<string, OrderItemRow[]>
): ItemExportRow[] {
  return orders.flatMap((order): ItemExportRow[] => {
    const baseRow = {
      order_reference: order.reference,
      order_created_at: order.created_at,
      supplier: relatedName(order.suppliers),
      delivery_site: relatedName(order.delivery_sites),
      expected_delivery_date: order.expected_delivery_date,
      status: order.status,
      order_total_ht_cents: order.total_ht_cents,
    };

    const items = itemsByOrderId[order.id] ?? [];
    if (items.length === 0) {
      return [
        {
          ...baseRow,
          item_designation: "",
          item_reference: "",
          item_quantity: "" as const,
          item_unit_price_ht_cents: "" as const,
          item_line_total_ht_cents: "" as const,
        },
      ];
    }

    return items.map((item) => ({
      ...baseRow,
      item_designation: item.designation,
      item_reference: item.reference ?? "",
      item_quantity: item.quantity,
      item_unit_price_ht_cents: item.unit_price_ht_cents,
      item_line_total_ht_cents: item.line_total_ht_cents,
    }));
  });
}

async function fetchItemsByOrderId(orderIds: string[]): Promise<Record<string, OrderItemRow[]>> {
  if (orderIds.length === 0) return {};
  const query = new URLSearchParams({ view: "items" });
  orderIds.forEach((orderId) => query.append("order_id", orderId));
  const data = await fetchApi<{ itemsByOrderId: Record<string, OrderItemRow[]> }>(
    `/api/orders?${query.toString()}`
  );
  return data.itemsByOrderId ?? {};
}

function exportFilename() {
  return `commandes_${new Date().toISOString().split("T")[0]}`;
}

/** Workbook with one sheet of orders and one sheet of their lines. */
export async function exportOrdersToExcel(orders: PurchaseOrderListRow[]) {
  const itemsRows = buildItemsExportRows(orders, await fetchItemsByOrderId(orders.map((order) => order.id)));
  const { exportToExcelWithSheets } = await import("@/lib/export");
  await exportToExcelWithSheets(
    [
      { name: "Commandes", data: orders, columns: ORDER_EXPORT_COLUMNS },
      { name: "Articles", data: itemsRows, columns: ITEM_EXPORT_COLUMNS },
    ],
    { filename: exportFilename() }
  );
}

/** One CSV line per ordered item (orders without items keep one empty line). */
export async function exportOrdersToCsv(orders: PurchaseOrderListRow[]) {
  const itemsRows = buildItemsExportRows(orders, await fetchItemsByOrderId(orders.map((order) => order.id)));
  const { exportToCSV } = await import("@/lib/export");
  await exportToCSV(itemsRows, ITEM_EXPORT_COLUMNS, { filename: exportFilename() });
}
