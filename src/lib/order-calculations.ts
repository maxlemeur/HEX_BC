import { roundHalfAwayFromZero } from "@/lib/money";
import { orderQuantityToMilliunits } from "@/lib/purchase-orders/quantities";

export const MAX_ORDER_AMOUNT_CENTS = 2_147_483_647;

/** TI-691: the discounts of an order exceed the rest of it; its totals would be negative. */
export class OrderTotalNegativeError extends RangeError {
  constructor() {
    super("La remise dépasse le montant de la commande.");
    this.name = "OrderTotalNegativeError";
  }
}

function checkedAmount(value: bigint): number {
  if (value < BigInt(0)) throw new OrderTotalNegativeError();
  if (value > BigInt(MAX_ORDER_AMOUNT_CENTS)) {
    throw new RangeError("Le montant dépasse la capacité d'une commande.");
  }
  return Number(value);
}

/** A line amount: negative for a discount, within the capacity of a column either way. */
function checkedLineAmount(value: bigint): number {
  if (value < -BigInt(MAX_ORDER_AMOUNT_CENTS) || value > BigInt(MAX_ORDER_AMOUNT_CENTS)) {
    throw new RangeError("Le montant dépasse la capacité d'une commande.");
  }
  return Number(value);
}

function checkedInteger(value: number, maximum: number): bigint {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError("Prix ou taux de TVA invalide.");
  }
  return BigInt(value);
}

export type LineInput = {
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  /** TI-691: the price is for 1 (default), 10, 100 or 1 000 units. */
  pricePer?: number;
  /** TI-691: a discount is subtracted (negative totals); shipping and articles add. */
  kind?: "article" | "shipping" | "discount";
};

export type LineTotals = {
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
};

export type OrderTotals = {
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
};

const PRICE_PER = new Set([1, 10, 100, 1000]);

/**
 * Quantity x price / pricePer, rounded half away from zero to the cent, then its tax the same way, as
 * normalize_purchase_order_item computes them. For one unit (every line before TI-691) it is the previous
 * computation. A discount is that amount subtracted: its totals are negative.
 */
export function computeLineTotals({
  quantity,
  unitPriceHtCents,
  taxRateBp,
  pricePer = 1,
  kind = "article",
}: LineInput): LineTotals {
  const milliunits = orderQuantityToMilliunits(quantity);
  const price = checkedInteger(unitPriceHtCents, MAX_ORDER_AMOUNT_CENTS);
  const taxRate = checkedInteger(taxRateBp, 10000);
  if (!PRICE_PER.has(pricePer)) throw new RangeError("Le prix s'entend pour 1, 10, 100 ou 1 000 unités.");
  const amount = roundHalfAwayFromZero(milliunits * price, BigInt(1000 * pricePer));
  const ht = kind === "discount" ? -amount : amount;
  const tax = roundHalfAwayFromZero(ht * taxRate, BigInt(10000));
  return {
    lineTotalHtCents: checkedLineAmount(ht),
    lineTaxCents: checkedLineAmount(tax),
    lineTotalTtcCents: checkedLineAmount(ht + tax),
  };
}

/** The order adds its lines (a discount subtracts); its totals stay within [0, capacity]. */
export function computeOrderTotals(lines: LineTotals[]): OrderTotals {
  const sum = (pick: (line: LineTotals) => number) => lines.reduce(
    (total, line) => total + BigInt(checkedLineAmount(BigInt(pick(line)))),
    BigInt(0),
  );
  return {
    totalHtCents: checkedAmount(sum((line) => line.lineTotalHtCents)),
    totalTaxCents: checkedAmount(sum((line) => line.lineTaxCents)),
    totalTtcCents: checkedAmount(sum((line) => line.lineTotalTtcCents)),
  };
}

export function computeTotalsFromInputs(inputs: LineInput[]) {
  const lineTotals = inputs.map((input) => computeLineTotals(input));
  const orderTotals = computeOrderTotals(lineTotals);
  return { lineTotals, orderTotals };
}
