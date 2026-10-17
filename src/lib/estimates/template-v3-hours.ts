/**
 * Lot 2, sous-lot 2.8 (P-12) : lignes d'un modèle v1/v2 dont les heures changent en entrant dans une v3.
 *
 * Miroir de `insert_estimate_template_into_version` (M6) : h/u = arrondi demi-supérieur de h / Q à
 * 4 décimales (Q absente = 1), puis le déclencheur v3 dérive h = arrondi(Q × h/u, 3). Une ligne dont
 * ce h dérivé diffère des heures du modèle est listée à l'utilisateur. Une ligne qui porte déjà ses
 * heures par unité (modèle issu d'une v3) n'est pas convertie ; Q nulle avec des heures est refusée
 * par la base avant cette liste.
 */
import {
  compare,
  decimalFromLiteral,
  divideHalfUp,
  formatScaled,
  pow10,
  roundHalfUpToScale,
  type Decimal,
} from "@/lib/estimates/engine-v3/decimal";

export type TemplateV3HoursSource = {
  readonly item_type: string;
  readonly title: string;
  readonly quantity: number | null;
  readonly h_mo: number | null;
  readonly h_mo_per_unit?: number | null;
};

export type TemplateV3ConvertedLine = {
  title: string;
  template_hours: number;
  converted_hours: number;
};

const HOURS_PER_UNIT_SCALE = 4;
const LINE_HOURS_SCALE = 3;

function readDecimal(value: number, field: string): Decimal {
  return decimalFromLiteral(String(value), field, 12);
}

/**
 * Heures par unité d'une ligne dont on connaît les heures totales : arrondi demi-supérieur de h / Q à
 * 4 décimales (Q nulle sans heures : 0 ; Q nulle avec des heures : `null`, refus nommé de l'appelant).
 * Miroir de M6 (modèles, ouvrages générés).
 */
export function hoursPerUnitHalfUp(hours: number, quantity: number): number | null {
  const q = readDecimal(quantity, "quantity");
  const h = readDecimal(hours, "h_mo");
  if (q.units === BigInt(0)) return h.units === BigInt(0) ? 0 : null;
  const units = divideHalfUp(h.units * pow10(q.scale + HOURS_PER_UNIT_SCALE), q.units * pow10(h.scale));
  return Number(formatScaled(units, HOURS_PER_UNIT_SCALE));
}

/** h dérivé dans la v3 : arrondi(Q × arrondi(h / Q, 4), 3) ; `null` sans conversion. */
export function convertedTemplateLineHours(source: TemplateV3HoursSource): Decimal | null {
  if (source.item_type !== "line" || (source.h_mo_per_unit !== null && source.h_mo_per_unit !== undefined)) return null;
  const quantity = readDecimal(source.quantity ?? 1, "quantity");
  const hours = readDecimal(source.h_mo ?? 0, "h_mo");
  if (quantity.units === BigInt(0)) return null;
  const hoursPerUnit = divideHalfUp(
    hours.units * pow10(quantity.scale + HOURS_PER_UNIT_SCALE),
    quantity.units * pow10(hours.scale)
  );
  return {
    units: roundHalfUpToScale(
      { units: quantity.units * hoursPerUnit, scale: quantity.scale + HOURS_PER_UNIT_SCALE },
      LINE_HOURS_SCALE
    ),
    scale: LINE_HOURS_SCALE,
  };
}

export function listTemplateLinesConvertedForV3(
  items: ReadonlyArray<TemplateV3HoursSource>
): TemplateV3ConvertedLine[] {
  return items.flatMap((item) => {
    const converted = convertedTemplateLineHours(item);
    if (!converted || compare(converted, readDecimal(item.h_mo ?? 0, "h_mo")) === 0) return [];
    return [{
      title: item.title,
      template_hours: item.h_mo ?? 0,
      converted_hours: Number(formatScaled(converted.units, LINE_HOURS_SCALE)),
    }];
  });
}
