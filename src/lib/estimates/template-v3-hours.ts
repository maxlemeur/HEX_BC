/**
 * Lot 2, sous-lot 2.8 (P-12) : lignes d'un modèle v1/v2 dont les heures changent en entrant dans une v3.
 *
 * Miroir de `insert_estimate_template_into_version` (M6) : h/u = arrondi demi-supérieur de h / Q à
 * 4 décimales (Q absente = 1), puis le déclencheur v3 dérive h = arrondi(Q × h/u, 3). Une ligne dont
 * ce h dérivé diffère des heures du modèle est listée à l'utilisateur. Une ligne qui porte déjà l'une de
 * ses heures par unité (modèle issu d'une v3) n'est pas convertie ; Q nulle avec des heures est refusée
 * par la base avant cette liste. Seules les heures MO totales sont comparées (atelier et chantier non
 * listés).
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
  readonly h_mo_atelier_per_unit?: number | null;
  readonly h_mo_chantier_per_unit?: number | null;
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
  const savedFromV3 = [source.h_mo_per_unit, source.h_mo_atelier_per_unit, source.h_mo_chantier_per_unit]
    .some((value) => value !== null && value !== undefined);
  if (source.item_type !== "line" || savedFromV3) return null;
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

export type TemplateV3HoursPerUnitSource = TemplateV3HoursSource & {
  readonly h_mo_atelier: number | null;
  readonly h_mo_chantier: number | null;
};

export type TemplateV3HoursPerUnit = {
  h_mo_per_unit: number | null;
  h_mo_atelier_per_unit: number | null;
  h_mo_chantier_per_unit: number | null;
};

/**
 * Sous-lot 2.10a (A1) : heures par unité d'une ligne de modèle qui entre dans une v3 créée depuis ce modèle,
 * miroir de la boucle de M6, atelier et chantier compris. Modèle issu d'une v3 (l'une de ses heures par unité
 * renseignée) : copiées telles quelles. Sinon h / Q au demi supérieur à 4 décimales (Q absente = 1, Q nulle
 * sans heures = 0, atelier ou chantier absent = absent). `null` : Q nulle avec des heures, refus nommé de
 * l'appelant (`ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY`).
 */
export function templateLineHoursPerUnitForV3(source: TemplateV3HoursPerUnitSource): TemplateV3HoursPerUnit | null {
  const fromV3 = {
    h_mo_per_unit: source.h_mo_per_unit ?? null,
    h_mo_atelier_per_unit: source.h_mo_atelier_per_unit ?? null,
    h_mo_chantier_per_unit: source.h_mo_chantier_per_unit ?? null,
  };
  if (Object.values(fromV3).some((value) => value !== null)) return fromV3;
  const quantity = source.quantity ?? 1;
  const perUnit = (hours: number | null) => (hours === null ? null : hoursPerUnitHalfUp(hours, quantity));
  const labor = perUnit(source.h_mo ?? 0);
  const atelier = perUnit(source.h_mo_atelier);
  const chantier = perUnit(source.h_mo_chantier);
  if (labor === null || (source.h_mo_atelier !== null && atelier === null) ||
    (source.h_mo_chantier !== null && chantier === null)) {
    return null;
  }
  return { h_mo_per_unit: labor, h_mo_atelier_per_unit: atelier, h_mo_chantier_per_unit: chantier };
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
