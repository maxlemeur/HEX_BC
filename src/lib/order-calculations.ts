import { orderQuantityToMilliunits } from "@/lib/purchase-orders/quantities";

export const MAX_ORDER_AMOUNT_CENTS = 2_147_483_647;

function checkedAmount(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(MAX_ORDER_AMOUNT_CENTS)) {
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

export function computeLineTotals({
  quantity,
  unitPriceHtCents,
  taxRateBp,
}: LineInput): LineTotals {
  const milliunits = orderQuantityToMilliunits(quantity);
  const price = checkedInteger(unitPriceHtCents, MAX_ORDER_AMOUNT_CENTS);
  const taxRate = checkedInteger(taxRateBp, 10000);
  const ht = (milliunits * price + BigInt(500)) / BigInt(1000);
  const tax = (ht * taxRate + BigInt(5000)) / BigInt(10000);
  return {
    lineTotalHtCents: checkedAmount(ht),
    lineTaxCents: checkedAmount(tax),
    lineTotalTtcCents: checkedAmount(ht + tax),
  };
}

export function computeOrderTotals(lines: LineTotals[]): OrderTotals {
  return lines.reduce(
    (totals, line) => ({
      totalHtCents: checkedAmount(BigInt(totals.totalHtCents) + checkedInteger(line.lineTotalHtCents, MAX_ORDER_AMOUNT_CENTS)),
      totalTaxCents: checkedAmount(BigInt(totals.totalTaxCents) + checkedInteger(line.lineTaxCents, MAX_ORDER_AMOUNT_CENTS)),
      totalTtcCents: checkedAmount(BigInt(totals.totalTtcCents) + checkedInteger(line.lineTotalTtcCents, MAX_ORDER_AMOUNT_CENTS)),
    }),
    { totalHtCents: 0, totalTaxCents: 0, totalTtcCents: 0 }
  );
}

export function computeTotalsFromInputs(inputs: LineInput[]) {
  const lineTotals = inputs.map((input) => computeLineTotals(input));
  const orderTotals = computeOrderTotals(lineTotals);
  return { lineTotals, orderTotals };
}
