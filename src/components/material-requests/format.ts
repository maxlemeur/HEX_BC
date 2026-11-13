import {
  MATERIAL_REQUEST_FILE_MAX_BYTES,
  MATERIAL_REQUEST_MAX_FILES,
  type MaterialRequestLine,
  type MaterialRequestPricePer,
} from "@/lib/material-requests/contracts";
import { MATERIAL_REQUEST_QUOTE_MAX_FILES } from "@/lib/material-requests/quote-contracts";
import { formatEUR } from "@/lib/money";
import { isValidOrderQuantity, orderQuantityToMilliunits } from "@/lib/purchase-orders/quantities";

/** « 2026-11-12 » → « 12/11/2026 », without a time zone in the way. */
export function formatDateOnly(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** How a line is named to the operator outside its row: its type and size, else the technician's words. */
export function lineTitle(line: MaterialRequestLine): string {
  const type = text(line.product_type);
  if (type) return [type, text(line.dimension)].filter(Boolean).join(" ");
  const original = text(line.original_text);
  return original ? `« ${original} »` : "Sans désignation";
}

export function formatQuantity(quantity: number | null): string {
  return quantity === null ? "" : String(quantity).replace(".", ",");
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function materialRequestsHref(projectId: string): string {
  return `/dashboard/affaires/${projectId}/demandes-materiel`;
}

export function materialRequestHref(projectId: string, requestId: string): string {
  return `${materialRequestsHref(projectId)}/${requestId}`;
}

/** Refuses on the spot what the server would refuse after a long upload. */
export function checkPhotoSelection(files: readonly File[], alreadyThere: number): string | null {
  if (alreadyThere + files.length > MATERIAL_REQUEST_MAX_FILES) {
    return `${MATERIAL_REQUEST_MAX_FILES} photos au plus par demande.`;
  }
  const tooBig = files.find((file) => file.size > MATERIAL_REQUEST_FILE_MAX_BYTES);
  return tooBig ? `« ${tooBig.name} » dépasse 20 Mo.` : null;
}

/** The same check for the files of a quote (TI-691): a PDF or photographed pages. */
export function checkQuoteFileSelection(files: readonly File[], alreadyThere: number): string | null {
  if (alreadyThere + files.length > MATERIAL_REQUEST_QUOTE_MAX_FILES) {
    return `${MATERIAL_REQUEST_QUOTE_MAX_FILES} pièces au plus par devis.`;
  }
  const tooBig = files.find((file) => file.size > MATERIAL_REQUEST_FILE_MAX_BYTES);
  return tooBig ? `« ${tooBig.name} » dépasse 20 Mo.` : null;
}

/** « 1 000 » with a no-break space: « les 1 000 » never breaks across two lines. */
export function formatPricePer(per: MaterialRequestPricePer): string {
  return per === 1000 ? "1 000" : String(per);
}

/** « 11,50 € », or « 3,40 € les 100 » for a price given for several units. */
export function formatQuotedPrice(cents: number, per: MaterialRequestPricePer): string {
  return per === 1 ? formatEUR(cents) : `${formatEUR(cents)} les ${formatPricePer(per)}`;
}

/**
 * Quantity × price ÷ the units the price is for, rounded half up to the cent, on exact integers (the quantity in
 * thousandths, as orders count it). Null when the quantity or the price is not known.
 */
export function quotedAmountCents(
  quantity: number | null,
  cents: number | null,
  per: MaterialRequestPricePer,
): number | null {
  if (quantity === null || cents === null || !isValidOrderQuantity(quantity)) return null;
  const divisor = BigInt(1000 * per);
  return Number((orderQuantityToMilliunits(quantity) * BigInt(cents) + divisor / BigInt(2)) / divisor);
}

/** A purchase order's status in words (as on the orders list); an unknown one is shown as the server wrote it. */
const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyée",
  confirmed: "Confirmée",
  received: "Reçue",
  canceled: "Annulée",
};

export function purchaseOrderStatusLabel(status: string): string {
  return PURCHASE_ORDER_STATUS_LABELS[status] ?? status;
}

export function purchaseOrderHref(orderId: string): string {
  return `/dashboard/orders/${encodeURIComponent(orderId)}`;
}

const DAY = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Paris",
});

/** A moment recorded by the server, as the day it was in France (« 12/11/2026 »). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DAY.format(date);
}
