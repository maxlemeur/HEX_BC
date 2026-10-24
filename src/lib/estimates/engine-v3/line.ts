/**
 * Lot 2, sous-lot 2.4 - calcul brut d'une ligne v3 (conception §4, étapes 1 à 5).
 *
 * FO_u = P × provision FO × k_fo (TI-534) ; MO_u = maj × h × t × k_mo (ou maj × (h_at × t_at × k_at + h_ch × t_ch × k_ch)
 * avec la ventilation) ; PU = ⌈FO_u × c_FO + MO_u × c_MO⌋ (un seul arrondi) ; B = ⌈Q × PU⌋ ;
 * FO/MO bruts = répartition exacte de B ; D = ⌈Q × (FO_u + MO_u)⌋ ; h_mo* = arrondi(Q × h/u, 3).
 * Une ligne non chiffrée contribue 0 partout (quantité effective 0, PU nul).
 */
import { allocateExactByDecimal } from "@/lib/estimates/engine-v3/allocate";
import {
  add,
  compare,
  type Decimal,
  DECIMAL_ONE,
  DECIMAL_ZERO,
  decimalFromInteger,
  formatScaled,
  multiply,
  pow10,
  roundHalfUp,
  roundHalfUpToScale,
  toCents,
  ZERO,
} from "@/lib/estimates/engine-v3/decimal";
import { amountOverflow } from "@/lib/estimates/engine-v3/errors";
import type { NormalizedV3Line, NormalizedV3Params } from "@/lib/estimates/engine-v3/input";

export type V3LineGross = {
  priced: boolean;
  laborSplit: boolean;
  laborRateMissing: boolean;
  pu: bigint | null;
  gross: bigint;
  grossFo: bigint;
  grossMo: bigint;
  grossMoAtelier: bigint;
  grossMoChantier: bigint;
  cost: bigint;
  hoursMo: string | null;
  hoursMoAtelier: string | null;
  hoursMoChantier: string | null;
};

const HOURS_SCALE = 3;
/** `numeric(12,3)` : heures de ligne < 10^9. */
const HOURS_LIMIT_UNITS = pow10(12);

/**
 * Même déclenchement qu'en v2 (`isLaborSplitEnabled && hasActiveLaborSplitPayload`), transposé
 * aux colonnes v3 : la présence d'un rôle devient la présence de son taux dans l'entrée.
 */
function hasActiveLaborSplitPayload(line: NormalizedV3Line): boolean {
  const positive = (value: Decimal | null) => value !== null && value.units > ZERO;
  const notNeutral = (value: Decimal | null) => value !== null && compare(value, DECIMAL_ONE) !== 0;
  return (
    positive(line.hoursAtelierPerUnit) ||
    positive(line.hoursChantierPerUnit) ||
    line.laborRateAtelierCents !== null ||
    line.laborRateChantierCents !== null ||
    notNeutral(line.kMoAtelier) ||
    notNeutral(line.kMoChantier)
  );
}

/** Nulle si la colonne par unité est nulle (intégration 2.4 I-04) ; au-delà de `numeric(12,3)` : I-06. */
function derivedHours(quantity: Decimal, hoursPerUnit: Decimal | null, field: string): string | null {
  if (hoursPerUnit === null) return null;
  const units = roundHalfUpToScale(multiply(quantity, hoursPerUnit), HOURS_SCALE);
  if (units >= HOURS_LIMIT_UNITS) throw amountOverflow(field);
  return formatScaled(units, HOURS_SCALE);
}

function laborProduct(hours: Decimal | null, rate: Decimal | null, coefficient: Decimal | null): Decimal {
  return multiply(multiply(hours ?? DECIMAL_ZERO, rate ?? DECIMAL_ZERO), coefficient ?? DECIMAL_ONE);
}

export function computeV3LineGross(
  line: NormalizedV3Line,
  params: NormalizedV3Params,
  path: string
): V3LineGross {
  const priced = line.pricingStatus === "priced";
  const quantity = priced ? line.quantity : DECIMAL_ZERO;
  const hours = {
    hoursMo: derivedHours(quantity, line.hoursPerUnit, `${path}.h_mo`),
    hoursMoAtelier: derivedHours(quantity, line.hoursAtelierPerUnit, `${path}.h_mo_atelier`),
    hoursMoChantier: derivedHours(quantity, line.hoursChantierPerUnit, `${path}.h_mo_chantier`),
  };
  const laborSplit = params.laborSplitEnabled && hasActiveLaborSplitPayload(line);
  if (!priced) {
    return {
      priced,
      laborSplit,
      laborRateMissing: false,
      pu: null,
      gross: ZERO,
      grossFo: ZERO,
      grossMo: ZERO,
      grossMoAtelier: ZERO,
      grossMoChantier: ZERO,
      cost: ZERO,
      ...hours,
    };
  }

  const foUnit = multiply(multiply(line.unitPriceCents, line.foProvision), line.kFo);
  const atelierUnit = laborProduct(line.hoursAtelierPerUnit, line.laborRateAtelierCents, line.kMoAtelier);
  const chantierUnit = laborProduct(line.hoursChantierPerUnit, line.laborRateChantierCents, line.kMoChantier);
  const moUnit = laborSplit
    ? multiply(line.majoration, add(atelierUnit, chantierUnit))
    : multiply(line.majoration, laborProduct(line.hoursPerUnit, line.laborRateCents, line.kMo));
  const laborRateMissing = laborSplit
    ? ((line.hoursAtelierPerUnit?.units ?? ZERO) > ZERO && line.laborRateAtelierCents === null) ||
      ((line.hoursChantierPerUnit?.units ?? ZERO) > ZERO && line.laborRateChantierCents === null)
    : (line.hoursPerUnit?.units ?? ZERO) > ZERO && line.laborRateCents === null;

  const foSaleUnit = multiply(foUnit, params.saleCoefficientFo);
  const moSaleUnit = multiply(moUnit, params.saleCoefficientMo);
  const pu = roundHalfUp(add(foSaleUnit, moSaleUnit));
  toCents(pu, `${path}.pu_ht_cents`);
  const gross = roundHalfUp(multiply(quantity, decimalFromInteger(pu)));
  toCents(gross, `${path}.gross_ht_cents`);
  const cost = roundHalfUp(multiply(quantity, add(foUnit, moUnit)));
  toCents(cost, `${path}.cost_ht_cents`);

  const [grossFo, grossMo] = allocateExactByDecimal(gross, [
    { key: "fo", weight: foSaleUnit },
    { key: "mo", weight: moSaleUnit },
  ]);
  const [grossMoAtelier, grossMoChantier] = laborSplit
    ? allocateExactByDecimal(grossMo, [
        { key: "atelier", weight: multiply(multiply(line.majoration, atelierUnit), params.saleCoefficientMo) },
        { key: "chantier", weight: multiply(multiply(line.majoration, chantierUnit), params.saleCoefficientMo) },
      ])
    : // Sans ventilation, toute la MO est « chantier » (convention v2, intégration 2.4 I-01).
      [ZERO, grossMo];

  return {
    priced,
    laborSplit,
    laborRateMissing,
    pu,
    gross,
    grossFo,
    grossMo,
    grossMoAtelier,
    grossMoChantier,
    cost,
    ...hours,
  };
}
