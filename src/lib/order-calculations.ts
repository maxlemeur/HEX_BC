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
  const lineTotalHtCents = quantity * unitPriceHtCents;
  const lineTaxCents = Math.round((lineTotalHtCents * taxRateBp) / 10000);
  return {
    lineTotalHtCents,
    lineTaxCents,
    lineTotalTtcCents: lineTotalHtCents + lineTaxCents,
  };
}

export function computeOrderTotals(lines: LineTotals[]): OrderTotals {
  return lines.reduce(
    (totals, line) => ({
      totalHtCents: totals.totalHtCents + line.lineTotalHtCents,
      totalTaxCents: totals.totalTaxCents + line.lineTaxCents,
      totalTtcCents: totals.totalTtcCents + line.lineTotalTtcCents,
    }),
    { totalHtCents: 0, totalTaxCents: 0, totalTtcCents: 0 }
  );
}

export function computeTotalsFromInputs(inputs: LineInput[]) {
  const lineTotals = inputs.map((input) => computeLineTotals(input));
  const orderTotals = computeOrderTotals(lineTotals);
  return { lineTotals, orderTotals };
}
