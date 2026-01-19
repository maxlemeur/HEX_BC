import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

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

export async function recalculateOrderTotals(
  orderId: string,
  supabase: SupabaseClient<Database>
) {
  const { data, error } = await supabase
    .from("purchase_order_items")
    .select("line_total_ht_cents, line_tax_cents, line_total_ttc_cents")
    .eq("purchase_order_id", orderId);

  if (error) {
    throw error;
  }

  const lineTotals = (data ?? []).map((item) => ({
    lineTotalHtCents: item.line_total_ht_cents,
    lineTaxCents: item.line_tax_cents,
    lineTotalTtcCents: item.line_total_ttc_cents,
  }));

  const totals = computeOrderTotals(lineTotals);

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      total_ht_cents: totals.totalHtCents,
      total_tax_cents: totals.totalTaxCents,
      total_ttc_cents: totals.totalTtcCents,
    })
    .eq("id", orderId);

  if (updateError) {
    throw updateError;
  }

  return totals;
}
