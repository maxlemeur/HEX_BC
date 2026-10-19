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

type ExportOrder = Omit<PurchaseOrderListRow, "devis_count" | "has_devis">;

type OrderExportSnapshot = {
  orders: ExportOrder[];
  itemsByOrderId: Record<string, OrderItemRow[]>;
  selection_count?: number;
};
type ExportSelection = PurchaseOrderListRow[] | URLSearchParams;

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
  item_unit: string;
  item_price_unit: string;
  item_unit_price_ht_cents: number | "";
  item_line_total_ht_cents: number | "";
  item_line_tax_cents: number | "";
  item_line_total_ttc_cents: number | "";
};

const ORDER_EXPORT_COLUMNS: ExportColumn<ExportOrder>[] = [
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
  { key: "item_unit", header: "Unité" },
  { key: "item_price_unit", header: "Unité du prix" },
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
  {
    key: "item_line_tax_cents",
    header: "TVA ligne (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "item_line_total_ttc_cents",
    header: "Total ligne TTC (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
];

function buildItemsExportRows(
  orders: ExportOrder[],
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

    const items = itemsByOrderId[order.id];
    if (items.length === 0) {
      return [
        {
          ...baseRow,
          item_designation: "",
          item_reference: "",
          item_quantity: "" as const,
          item_unit: "",
          item_price_unit: "",
          item_unit_price_ht_cents: "" as const,
          item_line_total_ht_cents: "" as const,
          item_line_tax_cents: "" as const,
          item_line_total_ttc_cents: "" as const,
        },
      ];
    }

    return items.map((item) => ({
      ...baseRow,
      item_designation: item.designation,
      item_reference: item.reference ?? "",
      item_quantity: item.quantity,
      item_unit: item.unit || "Unité à confirmer",
      item_price_unit: item.price_unit || "Unité à confirmer",
      item_unit_price_ht_cents: item.unit_price_ht_cents,
      item_line_total_ht_cents: item.line_total_ht_cents,
      item_line_tax_cents: item.line_tax_cents,
      item_line_total_ttc_cents: item.line_total_ttc_cents,
    }));
  });
}

async function fetchOrderExportSnapshot(selection: ExportSelection): Promise<OrderExportSnapshot> {
  const selectedIds = Array.isArray(selection) ? [...new Set(selection.map(order => order.id))] : null;
  if (selectedIds && selectedIds.length === 0) throw new Error("Sélectionnez au moins une commande à exporter.");
  const query = selectedIds ? new URLSearchParams({ view: "items" }) : new URLSearchParams(selection as URLSearchParams);
  if (selectedIds) selectedIds.forEach(orderId => query.append("order_id", orderId));
  else {
    query.set("view", "export");
    query.delete("page");
    query.delete("size");
  }
  const data = await fetchApi<OrderExportSnapshot>(`/api/orders?${query.toString()}`);
  if (!data || !Array.isArray(data.orders) || !data.itemsByOrderId ||
      typeof data.itemsByOrderId !== "object" || Array.isArray(data.itemsByOrderId)) {
    throw new Error("La préparation de l’export est incomplète. Rechargez la liste puis réessayez.");
  }
  const ordersById = new Map(data.orders.map(order => [order.id, order]));
  const expectedCount = selectedIds?.length ?? data.selection_count;
  if (!Number.isSafeInteger(expectedCount) || ordersById.size !== data.orders.length || ordersById.size !== expectedCount) {
    throw new Error("La sélection de commandes a changé. Rechargez la liste avant d’exporter.");
  }
  const orders = (selectedIds ?? data.orders.map(order => order.id)).map(id => {
    const order = ordersById.get(id);
    if (!order || !Array.isArray(data.itemsByOrderId[id])) {
      throw new Error("Une commande sélectionnée est absente ou incomplète. Rechargez la liste avant d’exporter.");
    }
    return order;
  });
  if (!orders.length) throw new Error("Aucune commande ne correspond aux filtres de cet export.");
  return { orders, itemsByOrderId: data.itemsByOrderId };
}

function exportFilename() {
  return `commandes_${new Date().toISOString().split("T")[0]}`;
}

/** Workbook with one sheet of orders and one sheet of their lines. */
export async function exportOrdersToExcel(selection: ExportSelection) {
  // Server filters determine the complete selection, independently of the page.
  const snapshot = await fetchOrderExportSnapshot(selection);
  const itemsRows = buildItemsExportRows(snapshot.orders, snapshot.itemsByOrderId);
  const { exportToExcelWithSheets } = await import("@/lib/export");
  await exportToExcelWithSheets(
    [
      { name: "Commandes", data: snapshot.orders, columns: ORDER_EXPORT_COLUMNS },
      { name: "Articles", data: itemsRows, columns: ITEM_EXPORT_COLUMNS },
    ],
    { filename: exportFilename() }
  );
}

/** One CSV line per ordered item (orders without items keep one empty line). */
export async function exportOrdersToCsv(selection: ExportSelection) {
  const snapshot = await fetchOrderExportSnapshot(selection);
  const itemsRows = buildItemsExportRows(snapshot.orders, snapshot.itemsByOrderId);
  const { exportToCSV } = await import("@/lib/export");
  await exportToCSV(itemsRows, ITEM_EXPORT_COLUMNS, { filename: exportFilename() });
}
