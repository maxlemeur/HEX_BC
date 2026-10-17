/**
 * Lot 2, sous-lot 2.4 - calcul complet d'un devis v3 (conception §4).
 *
 * Module pur, inerte en 2.4 : aucun écran ni écrivain ne l'appelle. Ordre : lecture stricte de
 * l'entrée, lignes brutes, G, remise R, arrondi A, N = G − R − A, réductions et nets de ligne par
 * répartition exacte, TVA par taux, pied. Les invariants du §4 sont revérifiés avant de rendre
 * le résultat (une violation est un défaut du moteur, jamais un résultat).
 */
import { allocateExact } from "@/lib/estimates/engine-v3/allocate";
import {
  divideHalfUp,
  formatScaled,
  INT32_MAX,
  pow10,
  roundHalfUpToScale,
  toCents,
  ZERO,
} from "@/lib/estimates/engine-v3/decimal";
import { computeCommercialRounding, computeDiscountApplied } from "@/lib/estimates/engine-v3/discount";
import { normalizeEstimateV3Input, type NormalizedV3Params } from "@/lib/estimates/engine-v3/input";
import { computeV3LineGross } from "@/lib/estimates/engine-v3/line";
import { computeTaxByRate } from "@/lib/estimates/engine-v3/tax";
import type {
  EstimateV3Breakdown,
  EstimateV3CanonicalTotals,
  EstimateV3DiscountSummary,
  EstimateV3Input,
  EstimateV3LineResult,
  EstimateV3ResolvedParams,
  EstimateV3Warning,
} from "@/lib/estimates/engine-v3/types";

const COEFFICIENT_SCALE = 6;
const SALE_COEFFICIENT_SCALE = 4;

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, ZERO);
}

/** N / Σ D à 6 décimales, demi supérieur ; « 1.000000 » si N = Σ D = 0 ; nul si seul Σ D = 0. */
function realizedSaleCoefficient(net: bigint, cost: bigint): string | null {
  if (cost === ZERO) return net === ZERO ? formatScaled(pow10(COEFFICIENT_SCALE), COEFFICIENT_SCALE) : null;
  return formatScaled(divideHalfUp(net * pow10(COEFFICIENT_SCALE), cost), COEFFICIENT_SCALE);
}

function resolvedParams(params: NormalizedV3Params): EstimateV3ResolvedParams {
  const coefficient = (value: NormalizedV3Params["saleCoefficientFo"]) =>
    formatScaled(roundHalfUpToScale(value, SALE_COEFFICIENT_SCALE), SALE_COEFFICIENT_SCALE);
  return {
    sale_coefficient_fo: coefficient(params.saleCoefficientFo),
    sale_coefficient_mo: coefficient(params.saleCoefficientMo),
    discount_amount_cents: params.discountAmountCents === null ? null : Number(params.discountAmountCents),
    discount_bp: Number(params.discountBp),
    rounding_mode: params.roundingMode,
    rounding_step_cents: Number(params.roundingStepCents),
    reverse_charge: params.reverseCharge,
    labor_split_enabled: params.laborSplitEnabled,
  };
}

function assertEngineInvariant(condition: boolean, label: string) {
  if (!condition) throw new Error(`ESTIMATE_V3_ENGINE_INVARIANT_BROKEN: ${label}`);
}

/** Calcul v3 d'une entrée typée (façade, éditeur). */
export function computeEstimateV3Breakdown(input: EstimateV3Input): EstimateV3Breakdown {
  return computeEstimateV3BreakdownFromUnknown(input);
}

/** Même calcul sur une entrée non typée (JSON canonique) : tout écart de forme est refusé. */
export function computeEstimateV3BreakdownFromUnknown(rawInput: unknown): EstimateV3Breakdown {
  const { params, lines } = normalizeEstimateV3Input(rawInput);
  const gross = lines.map((line, index) => computeV3LineGross(line, params, `items[${index}]`));

  const grossTotal = sum(gross.map((line) => line.gross));
  toCents(grossTotal, "gross_ht_cents");
  const costTotal = sum(gross.map((line) => line.cost));
  toCents(costTotal, "cost_subtotal_cents");
  const discountApplied = computeDiscountApplied(grossTotal, params.discount);
  const commercialRounding = computeCommercialRounding(
    grossTotal - discountApplied,
    params.roundingMode,
    params.roundingStepCents
  );
  const netTotal = grossTotal - discountApplied - commercialRounding;

  const reductions = allocateExact(
    discountApplied + commercialRounding,
    lines.map((line, index) => ({ key: line.id, weight: gross[index].gross }))
  );
  const nets = gross.map((line, index) => line.gross - reductions[index]);
  const netSplits = gross.map((line, index) => {
    const [fo, mo] = allocateExact(nets[index], [
      { key: "fo", weight: line.grossFo },
      { key: "mo", weight: line.grossMo },
    ]);
    const [atelier, chantier] = line.laborSplit
      ? allocateExact(mo, [
          { key: "atelier", weight: line.grossMoAtelier },
          { key: "chantier", weight: line.grossMoChantier },
        ])
      : [ZERO, ZERO];
    return { fo, mo, atelier, chantier };
  });

  const { groups, lineTax } = computeTaxByRate(
    lines.map((line, index) => ({
      key: line.id,
      priced: gross[index].priced,
      rateBp: line.taxRateBp,
      net: nets[index],
    })),
    params.reverseCharge
  );
  const taxTotal = sum(groups.map((group) => group.tax));
  const ttcTotal = netTotal + taxTotal;
  toCents(ttcTotal, "total_ttc_cents");

  const warnings: EstimateV3Warning[] = [];
  const resultLines: EstimateV3LineResult[] = lines.map((line, index) => {
    const computed = gross[index];
    const path = `items[${index}]`;
    if (!computed.priced) {
      warnings.push({ code: "ESTIMATE_V3_LINE_NOT_PRICED", line_id: line.id, pricing_status: line.pricingStatus });
    } else if (computed.laborRateMissing) {
      warnings.push({ code: "ESTIMATE_V3_LABOR_RATE_MISSING", line_id: line.id });
    }
    const lineTtc = nets[index] + lineTax[index];
    return {
      id: line.id,
      pu_ht_cents: computed.pu === null ? null : Number(computed.pu),
      gross_ht_cents: Number(computed.gross),
      gross_fo_ht_cents: Number(computed.grossFo),
      gross_mo_ht_cents: Number(computed.grossMo),
      gross_mo_atelier_ht_cents: Number(computed.grossMoAtelier),
      gross_mo_chantier_ht_cents: Number(computed.grossMoChantier),
      cost_ht_cents: Number(computed.cost),
      reduction_cents: Number(reductions[index]),
      line_total_ht_cents: Number(nets[index]),
      snapshot_fo_ht_cents: Number(netSplits[index].fo),
      snapshot_mo_ht_cents: Number(netSplits[index].mo),
      snapshot_mo_atelier_ht_cents: Number(netSplits[index].atelier),
      snapshot_mo_chantier_ht_cents: Number(netSplits[index].chantier),
      line_tax_cents: Number(lineTax[index]),
      line_total_ttc_cents: toCents(lineTtc, `${path}.line_total_ttc_cents`),
      h_mo: computed.hoursMo,
      h_mo_atelier: computed.hoursMoAtelier,
      h_mo_chantier: computed.hoursMoChantier,
      pricing_status: line.pricingStatus,
      tax_rate_bp: Number(line.taxRateBp),
      labor_split: computed.laborSplit,
    };
  });

  const totals: EstimateV3CanonicalTotals = {
    gross_ht_cents: Number(grossTotal),
    discount_applied_cents: Number(discountApplied),
    commercial_rounding_cents: Number(commercialRounding),
    total_ht_cents: Number(netTotal),
    total_tax_cents: toCents(taxTotal, "total_tax_cents"),
    total_ttc_cents: Number(ttcTotal),
    rounding_adjustment_cents: 0,
    cost_subtotal_cents: Number(costTotal),
    realized_sale_coefficient: realizedSaleCoefficient(netTotal, costTotal),
    tax_breakdown: groups.map((group) => ({
      rate_bp: Number(group.rateBp),
      base_cents: Number(group.base),
      tax_cents: Number(group.tax),
    })),
  };

  // Invariants du §4 (défaut du moteur s'ils cassent : jamais rendus comme un résultat).
  assertEngineInvariant(sum(nets) === netTotal, "Σ nets = HT");
  assertEngineInvariant(
    nets.every((net, index) => net >= ZERO && net <= gross[index].gross),
    "0 <= net <= brut"
  );
  assertEngineInvariant(sum(lineTax) === taxTotal, "Σ TVA de ligne = Σ T_r");
  assertEngineInvariant(netTotal >= ZERO && netTotal <= INT32_MAX, "HT dans l'entier PostgreSQL");
  assertEngineInvariant(
    netSplits.every((split, index) => split.fo + split.mo === nets[index]),
    "FO net + MO net = net"
  );
  assertEngineInvariant(commercialRounding < params.roundingStepCents, "A < pas");

  const discount: EstimateV3DiscountSummary = {
    kind: params.discount.kind,
    requested_cents: params.discount.kind === "amount" ? Number(params.discount.requestedCents) : null,
    rate_bp: params.discount.kind === "rate" ? Number(params.discount.rateBp) : null,
    base_cents: Number(grossTotal),
    applied_cents: Number(discountApplied),
  };

  return {
    engine: 3,
    params: resolvedParams(params),
    lines: resultLines,
    totals,
    discount,
    commercial_rounding: {
      mode: params.roundingMode,
      step_cents: Number(params.roundingStepCents),
      applied_cents: Number(commercialRounding),
    },
    warnings,
  };
}
