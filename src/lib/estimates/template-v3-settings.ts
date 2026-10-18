/**
 * Lot 2, sous-lot 2.10a (A1, D-h, P-12) : réglages d'un modèle repris par une v3 créée depuis ce modèle.
 *
 * Une v3 naît en marge fixe à 1, coefficient global 1, remise simple d'une seule intention et arrondi « aucun »
 * ou inférieur (CHECK de forme v3, `assertEstimateV3VersionShape`). Un réglage du modèle que la v3 sait
 * représenter est repris (devise, TVA, remise simple, palier inférieur) ; les autres ne sont **pas** repris et
 * sont listés à l'utilisateur, comme les lignes converties (`converted_lines`) : marge ≠ 1, marge par tranche,
 * coefficient global ≠ 1, remise en cascade, arrondi au plus proche ou au palier supérieur. Module pur.
 */
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";

export type TemplateVersionSettings = {
  margin_multiplier: number | null;
  margin_mode: string | null;
  currency: string | null;
  discount_bp: number | null;
  discount_amount_cents: number | null;
  discount_mode: string | null;
  discount_steps: readonly number[] | null;
  global_coefficient: number | null;
  tax_rate_bp: number | null;
  rounding_mode: string | null;
  rounding_step_cents: number | null;
};

export type TemplateV3DroppedSettingKey =
  | "margin_mode"
  | "margin_multiplier"
  | "global_coefficient"
  | "discount_mode"
  | "rounding_mode";

export type TemplateV3DroppedSetting = { setting: TemplateV3DroppedSettingKey; label: string };

/** Réglages de version repris par la v3 ; les absents prennent les défauts neutres de la création v3. */
export type TemplateV3VersionSettings = {
  currency?: string;
  tax_rate_bp?: number;
  discount_bp?: number;
  discount_amount_cents?: number | null;
  rounding_mode: "none" | "down";
  rounding_step_cents: number;
};

const PERCENT_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const COEFFICIENT_FORMAT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
  useGrouping: false,
});

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function resolveTemplateV3VersionSettings(template: TemplateVersionSettings): {
  settings: TemplateV3VersionSettings;
  dropped: TemplateV3DroppedSetting[];
} {
  const dropped: TemplateV3DroppedSetting[] = [];
  const currency = normalizeEstimateCurrency(template.currency) ?? "EUR";
  const marginMultiplier = finite(template.margin_multiplier) ? Number(template.margin_multiplier) : 1;
  if (template.margin_mode === "tiered") {
    dropped.push({ setting: "margin_mode", label: "Marge par tranche" });
  } else if (marginMultiplier !== 1) {
    dropped.push({ setting: "margin_multiplier", label: `Marge ${PERCENT_FORMAT.format((marginMultiplier - 1) * 100)} %` });
  }
  const globalCoefficient = finite(template.global_coefficient) ? Number(template.global_coefficient) : 1;
  if (globalCoefficient !== 1) {
    dropped.push({ setting: "global_coefficient", label: `Coefficient global ${COEFFICIENT_FORMAT.format(globalCoefficient)}` });
  }

  // Une remise fixe prime en v2 sur le taux et les paliers : elle est la remise effective du modèle.
  const settings: TemplateV3VersionSettings = { currency, rounding_mode: "none", rounding_step_cents: 1 };
  if (finite(template.tax_rate_bp)) settings.tax_rate_bp = Number(template.tax_rate_bp);
  const steps = (template.discount_steps ?? []).map(Number);
  if (template.discount_amount_cents !== null && template.discount_amount_cents !== undefined) {
    settings.discount_amount_cents = Number(template.discount_amount_cents);
    settings.discount_bp = 0;
  } else if (template.discount_mode === "cascade" || steps.length > 0) {
    const rates = steps.map((step) => `${PERCENT_FORMAT.format(step / 100)} %`);
    dropped.push({ setting: "discount_mode", label: rates.length > 0 ? `Remise en cascade ${rates.join(" puis ")}` : "Remise en cascade" });
  } else if (finite(template.discount_bp) && Number(template.discount_bp) > 0) {
    settings.discount_bp = Number(template.discount_bp);
  }

  const step = finite(template.rounding_step_cents) && Number(template.rounding_step_cents) >= 1
    ? Number(template.rounding_step_cents) : 1;
  switch (template.rounding_mode) {
    case "down":
      settings.rounding_mode = "down";
      settings.rounding_step_cents = step;
      break;
    case "up":
      dropped.push({ setting: "rounding_mode", label: `Arrondi au palier supérieur de ${formatCurrency(step, currency)}` });
      break;
    case "nearest":
      dropped.push({ setting: "rounding_mode", label: `Arrondi au plus proche de ${formatCurrency(step, currency)}` });
      break;
    default:
      break;
  }
  return { settings, dropped };
}
