/** TI-541: the supply cost of a line, factor by factor, as engine 3 computes it (`engine-v3/line.ts`). */
import { decimalFromInteger, decimalFromLiteral, DECIMAL_ONE, multiply, roundHalfUp, type Decimal } from "@/lib/estimates/engine-v3/decimal";
import { foCostBaseLabel, siteCostSourceText, type FoPriceLine } from "@/lib/estimates/fo-price-origin";

type Factor = number | string | null | undefined;
export type FoCostDetailLine = FoPriceLine & { k_fo?: Factor; fo_provision?: Factor };
export type FoCostDetail = {
  baseLabel: ReturnType<typeof foCostBaseLabel>;
  /** Source of a site cost as saved on the line, empty for the other bases. */
  source: string;
  baseCents: number;
  /** Base × provision FO × K FO, rounded to the cent for reading only. */
  costUnitCents: number;
  /** The same product × sale coefficient: the supply share of the unit price before labour is added. Null while the coefficient of the quote is not known. */
  saleUnitCents: number | null;
  text: string;
};

/** An absent K FO or provision is 1, as the engine reads it (`engine-v3/input.ts`). */
function factor(value: Factor): { decimal: Decimal; text: string } {
  try {
    const text = value === null || value === undefined || value === "" ? "1" : String(Number(value));
    return { decimal: decimalFromLiteral(text, "factor", 4), text: text.replace(".", ",") };
  } catch {
    return { decimal: DECIMAL_ONE, text: "1" };
  }
}
const euros = (cents: number) => `${String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${String(cents % 100).padStart(2, "0")} €`;

export function foCostDetail(line: FoCostDetailLine, params: { saleCoefficientFo?: Factor }): FoCostDetail {
  const baseCents = Number.isInteger(line.unit_price_ht_cents) && (line.unit_price_ht_cents ?? 0) > 0 ? Number(line.unit_price_ht_cents) : 0;
  const provision = factor(line.fo_provision);
  const kFo = factor(line.k_fo);
  // The sale coefficient belongs to the quote: without it (preview refused or not loaded) the sentence stops at the cost.
  const saleKnown = params.saleCoefficientFo !== null && params.saleCoefficientFo !== undefined && params.saleCoefficientFo !== "";
  const sale = factor(params.saleCoefficientFo);
  const cost = multiply(multiply(decimalFromInteger(BigInt(baseCents)), provision.decimal), kFo.decimal);
  const costUnitCents = Number(roundHalfUp(cost));
  const saleUnitCents = saleKnown ? Number(roundHalfUp(multiply(cost, sale.decimal))) : null;
  const baseLabel = foCostBaseLabel(line);
  return { baseLabel, source: siteCostSourceText(line.fo_price_origin), baseCents, costUnitCents, saleUnitCents,
    text: `${baseLabel} ${euros(baseCents)}${provision.text === "1" ? "" : ` × provision FO ${provision.text}`} × K FO ${kFo.text} = ${euros(costUnitCents)} de coût FO` +
      (saleUnitCents === null ? "" : ` ; × coef. de vente FO ${sale.text} = ${euros(saleUnitCents)}`) };
}
