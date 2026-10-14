export type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type RelatedLookup = { id: string; name: string };

export type PurchaseOrderListRow = {
  id: string;
  reference: string;
  created_at: string;
  status: PurchaseOrderStatus;
  expected_delivery_date: string | null;
  total_ht_cents: number;
  suppliers: RelatedLookup | RelatedLookup[] | null;
  delivery_sites: RelatedLookup | RelatedLookup[] | null;
  devis_count: number;
  has_devis: "with" | "without";
};

export type OrderItemRow = {
  id: string;
  designation: string;
  reference: string | null;
  quantity: number;
  unit: string | null;
  price_unit: string | null;
  unit_price_ht_cents: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
};

export type DevisItemRow = {
  id: string;
  name: string;
  originalFilename: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  position: number;
  downloadUrl: string | null;
};

/** Lazily loaded data of an expanded row. */
export type LazyRows<T> = T[] | "loading" | "error";

export type ItemsCache = Record<string, LazyRows<OrderItemRow>>;
export type DevisCache = Record<string, LazyRows<DevisItemRow>>;

export const ORDER_STATUS_OPTIONS: { value: PurchaseOrderStatus; label: string }[] = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "confirmed", label: "Confirmée" },
  { value: "received", label: "Reçue" },
  { value: "canceled", label: "Annulée" },
];

export function statusLabel(status: PurchaseOrderStatus) {
  return ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Legacy `.status-badge` pills: kept as the shared status hook used across the app. */
export function statusClass(status: PurchaseOrderStatus) {
  const known = ORDER_STATUS_OPTIONS.some((option) => option.value === status);
  return `status-badge status-${known ? status : "draft"}`;
}

export function relatedName(value: PurchaseOrderListRow["suppliers"]) {
  if (!value) return "-";
  if (Array.isArray(value)) return value[0]?.name ?? "-";
  return value.name;
}

/** `TBD` is the stored sentinel of a delivery date still to be agreed with the supplier. */
export function formatOrderDate(dateStr: string | null) {
  if (!dateStr) return "-";
  if (dateStr === "TBD") return "À déterminer";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}
