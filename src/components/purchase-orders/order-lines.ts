import { formatEUR } from "@/lib/money";
import {
  computeLineTotals,
  computeOrderTotals,
  MAX_ORDER_AMOUNT_CENTS,
  type LineTotals,
  type OrderTotals,
} from "@/lib/order-calculations";
// Dependency-free words only (no validation schema): this module is in the « orders » page bundle.
import {
  PURCHASE_ORDER_AMOUNT_LINE_UNIT,
  PURCHASE_ORDER_DELIVERY_MODE_LABELS,
  PURCHASE_ORDER_DELIVERY_MODES,
  PURCHASE_ORDER_LINE_KINDS,
  type PurchaseOrderDeliveryMode,
  type PurchaseOrderLineKind,
} from "@/lib/purchase-orders/line-kinds";
import { orderQuantityToMilliunits } from "@/lib/purchase-orders/quantities";

/*
 * Wording of the purchase orders made from a material request (TI-691, lot 2 « l'achat », delivery 3a): how an
 * order without a delivery site is delivered, the kinds of lines, the price given for a lot and where a line comes
 * from. An order without these fields (from an estimate, or typed by hand) reads as before.
 */

export { PURCHASE_ORDER_DELIVERY_MODE_LABELS, type PurchaseOrderDeliveryMode };

/** The request's delivery place, copied on the order; null for an order that has a site. */
export function deliveryModeOf(value: unknown): PurchaseOrderDeliveryMode | null {
  return PURCHASE_ORDER_DELIVERY_MODES.find((mode) => mode === value) ?? null;
}

export { PURCHASE_ORDER_AMOUNT_LINE_UNIT, type PurchaseOrderLineKind };
/** The supplier's shipping and a global discount: amounts of the order, not articles. */
export type PurchaseOrderAmountKind = Exclude<PurchaseOrderLineKind, "article">;

export const PURCHASE_ORDER_LINE_KIND_LABELS: Record<PurchaseOrderAmountKind, string> = {
  shipping: "Port",
  discount: "Remise",
};

export function lineKindOf(value: unknown): PurchaseOrderLineKind {
  return PURCHASE_ORDER_LINE_KINDS.find((kind) => kind === value) ?? "article";
}

/** A discount subtracts: shown negative, whatever sign it is stored with. */
export function signedLineAmount(cents: number, kind: PurchaseOrderLineKind | undefined): number {
  return kind === "discount" ? -Math.abs(cents) : cents;
}

const MAX = BigInt(MAX_ORDER_AMOUNT_CENTS);

function checked(value: bigint, min: bigint): number {
  if (value < min || value > MAX) throw new RangeError("Le montant dépasse la capacité d'une commande.");
  return Number(value);
}

/**
 * What the editor shows of a line before the server answers: quantity × price ÷ `pricePer`, half away from zero
 * to the cent, then its tax the same way; a discount is that amount subtracted. A plain article (one unit, not a
 * discount) is computed exactly as before.
 */
export function orderLineTotals(input: {
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  pricePer: number;
  kind: PurchaseOrderLineKind;
}): LineTotals {
  if (input.pricePer <= 1 && input.kind !== "discount") return computeLineTotals(input);
  if (!Number.isInteger(input.unitPriceHtCents) || input.unitPriceHtCents < 0 || input.unitPriceHtCents > MAX_ORDER_AMOUNT_CENTS) {
    throw new RangeError("Prix ou taux de TVA invalide.");
  }
  if (!Number.isInteger(input.taxRateBp) || input.taxRateBp < 0 || input.taxRateBp > 10000) {
    throw new RangeError("Prix ou taux de TVA invalide.");
  }
  const divisor = BigInt(1000 * Math.max(1, input.pricePer));
  const ht = (orderQuantityToMilliunits(input.quantity) * BigInt(input.unitPriceHtCents) + divisor / BigInt(2)) / divisor;
  const tax = (ht * BigInt(input.taxRateBp) + BigInt(5000)) / BigInt(10000);
  const sign = input.kind === "discount" ? BigInt(-1) : BigInt(1);
  return {
    lineTotalHtCents: checked(sign * ht, -MAX),
    lineTaxCents: checked(sign * tax, -MAX),
    lineTotalTtcCents: checked(sign * (ht + tax), -MAX),
  };
}

/** The order's totals; a discount larger than the rest is refused as the server would. */
export function orderTotalsOf(lines: readonly LineTotals[]): OrderTotals {
  if (lines.every((line) => line.lineTotalHtCents >= 0 && line.lineTaxCents >= 0)) return computeOrderTotals([...lines]);
  const sum = (pick: (line: LineTotals) => number) => lines.reduce((total, line) => total + BigInt(pick(line)), BigInt(0));
  const totals = {
    totalHtCents: sum((line) => line.lineTotalHtCents),
    totalTaxCents: sum((line) => line.lineTaxCents),
    totalTtcCents: sum((line) => line.lineTotalTtcCents),
  };
  if (totals.totalHtCents < BigInt(0) || totals.totalTaxCents < BigInt(0) || totals.totalTtcCents < BigInt(0)) {
    throw new RangeError("La remise dépasse le total de la commande.");
  }
  return {
    totalHtCents: checked(totals.totalHtCents, BigInt(0)),
    totalTaxCents: checked(totals.totalTaxCents, BigInt(0)),
    totalTtcCents: checked(totals.totalTtcCents, BigInt(0)),
  };
}

/** « 1 000 » with a no-break space: « les 1 000 » never breaks across two lines. */
function lotSize(per: number): string {
  return per === 1000 ? "1 000" : String(per);
}

/** « 3,40 € les 100 » for a price given for a lot; « 3,40 € » for one unit. */
export function formatLotPrice(cents: number, per: number | null | undefined): string {
  return per && per > 1 ? `${formatEUR(cents)} les ${lotSize(per)}` : formatEUR(cents);
}

/** What a line's cost is imputed to, in words: « Affaire », « Frais généraux · EPI ». Null when it is not said. */
export function imputationLabel(imputation: string | null | undefined, category: string | null | undefined): string | null {
  if (imputation === "project") return "Affaire";
  if (imputation === "overhead") {
    const named = category?.trim();
    return named ? `Frais généraux · ${named}` : "Frais généraux";
  }
  return null;
}

/** « 2026-11-12 » → « 12/11 ». */
function dayAndMonth(value: string | null | undefined): string | null {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[2]}/${match[1]}` : null;
}

/** The request line an order line comes from: « Demande du 12/11, ligne 3 », opening that request. */
export function requestLineOrigin(source: {
  projectId: string;
  requestId: string;
  requestedOn: string | null;
  position: number;
}): { href: string; label: string } {
  const day = dayAndMonth(source.requestedOn);
  return {
    href: `/dashboard/affaires/${encodeURIComponent(source.projectId)}/demandes-materiel/${encodeURIComponent(source.requestId)}`,
    label: day ? `Demande du ${day}, ligne ${source.position}` : `Demande de matériel, ligne ${source.position}`,
  };
}

export function affaireHref(projectId: string): string {
  return `/dashboard/affaires/${encodeURIComponent(projectId)}`;
}

/** PostgREST answers a to-one embed as an object, or as a one-element array through some relations. */
type Embedded<T> = T | T[] | null | undefined;

function first<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Where an order of an affaire leads back to (TI-691): the request its lines come from, open on its orders' step, or
 * the affaire's requests when they come from several; null when no line comes from a request.
 */
export function orderRequestOrigin(
  projectId: string,
  lines: readonly StoredOrderLineFields[],
): { href: string; label: string } | null {
  const requests = new Map<string, string | null>();
  for (const line of lines) {
    const source = first(line.material_request_lines);
    if (source) requests.set(source.request_id, first(source.material_requests)?.requested_on ?? null);
  }
  const base = `/dashboard/affaires/${encodeURIComponent(projectId)}/demandes-materiel`;
  if (requests.size === 0) return null;
  if (requests.size > 1) return { href: base, label: "Achats" };
  const [[requestId, requestedOn]] = [...requests];
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(requestedOn ?? "");
  return {
    href: `${base}/${encodeURIComponent(requestId)}?etape=commande`,
    label: day ? `Demande du ${day[3]}/${day[2]}/${day[1]}` : "Demande de matériel",
  };
}

/** The columns a stored order line carries since TI-691; absent (or default) on every other order. */
export type StoredOrderLineFields = {
  line_kind?: string | null;
  price_per?: number | null;
  imputation?: string | null;
  overhead_category?: string | null;
  material_request_line_id?: string | null;
  material_request_lines?: Embedded<{
    position: number;
    request_id: string;
    material_requests?: Embedded<{ project_id: string; requested_on: string | null }>;
  }>;
};

/**
 * What the document shows of a stored line beyond its designation, quantity and price. `fromRequest`: the order was
 * made from a material request (it has an affaire); only then are imputations said, so that an order typed by hand
 * or made from an estimate reads as before. `onScreen`: the request link and the imputation are ours, never printed.
 */
export function storedLineDocumentFields(
  item: StoredOrderLineFields,
  options: { fromRequest: boolean; onScreen: boolean },
): { pricePer: number; lineKind: PurchaseOrderLineKind; origin: { href: string; label: string } | null; imputation: string | null } {
  const lineKind = lineKindOf(item.line_kind);
  const pricePer = typeof item.price_per === "number" && item.price_per > 1 ? item.price_per : 1;
  if (!options.onScreen || !options.fromRequest) return { pricePer, lineKind, origin: null, imputation: null };
  const source = first(item.material_request_lines);
  const request = first(source?.material_requests);
  return {
    pricePer,
    lineKind,
    origin:
      source && request
        ? requestLineOrigin({
            projectId: request.project_id,
            requestId: source.request_id,
            requestedOn: request.requested_on,
            position: source.position,
          })
        : null,
    imputation: imputationLabel(item.imputation, item.overhead_category),
  };
}

/** The affaire embedded on an order made from a request: its name, and its site address for a delivery there. */
export function storedOrderAffaire(
  value: Embedded<{ name: string; site_address?: string | null }>,
): { name: string; address: string | null } | null {
  const affaire = first(value);
  return affaire ? { name: affaire.name, address: affaire.site_address ?? null } : null;
}
