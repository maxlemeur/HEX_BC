import type { DiscountMode, EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import { resolveEstimateCurrency } from "@/lib/estimates/editor-export";
import { buildVersionDiscountPatch, type EstimateVersionRow } from "@/lib/estimates/editor-items";
import type { Database } from "@/types/database";

const MAX_CASCADE_DISCOUNT_STEPS = 4;

function clampCascadeDiscountStepBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 10000);
}

export function normalizeCascadeDiscountSteps(steps: number[] | undefined): number[] {
  return (steps ?? [])
    .map((step) => clampCascadeDiscountStepBp(step))
    .slice(0, MAX_CASCADE_DISCOUNT_STEPS);
}

export function buildSettingsComparisonSnapshot(
  settings: EstimateSettingsState | null
) {
  if (!settings) return null;

  return {
    title: settings.title,
    date_devis: settings.date_devis,
    exclusions: settings.exclusions,
    validite_jours: settings.validite_jours,
    currency: settings.currency,
    margin_multiplier: settings.margin_multiplier,
    margin_mode: settings.margin_mode ?? "fixed",
    discount_cents: settings.discount_cents,
    discount_amount_cents: settings.discount_amount_cents ?? null,
    discount_bp: settings.discount_bp ?? null,
    discount_mode: settings.discount_mode ?? "simple",
    discount_steps: normalizeCascadeDiscountSteps(settings.discount_steps),
    global_coefficient: settings.global_coefficient ?? 1,
    tax_rate_bp: settings.tax_rate_bp,
    contractor_role: settings.contractor_role ?? "principal",
    rounding_mode: settings.rounding_mode,
    rounding_step_cents: settings.rounding_step_cents,
  };
}

/** Réglages de l'éditeur relus d'une version (chargement ; relecture d'une sauvegarde v3). */
export function buildEditorSettingsFromVersion(
  versionRow: EstimateVersionRow,
  context: { marginTiers: NonNullable<EstimateSettingsState["margin_tiers"]>; discountCents: number }
) {
  const discountMode: DiscountMode = versionRow.discount_mode === "cascade" ? "cascade" : "simple";
  return {
    title: versionRow.title ?? "",
    exclusions: versionRow.exclusions ?? "",
    date_devis: versionRow.date_devis,
    validite_jours: versionRow.validite_jours,
    currency: resolveEstimateCurrency(versionRow.currency),
    margin_multiplier: versionRow.margin_multiplier,
    margin_mode: versionRow.margin_mode ?? "fixed",
    margin_tiers: context.marginTiers,
    discount_cents: versionRow.discount_amount_cents ?? context.discountCents,
    discount_amount_cents: versionRow.discount_amount_cents ?? null,
    discount_bp: versionRow.discount_bp,
    discount_mode: discountMode,
    discount_steps: discountMode === "cascade" ? normalizeCascadeDiscountSteps(versionRow.discount_steps) : [],
    global_coefficient: Number.isFinite(versionRow.global_coefficient ?? NaN) ? Math.max(versionRow.global_coefficient ?? 1, 0) : 1,
    tax_rate_bp: versionRow.tax_rate_bp,
    contractor_role: versionRow.contractor_role ?? "principal",
    rounding_mode: versionRow.rounding_mode,
    rounding_step_cents: versionRow.rounding_step_cents,
  };
}

type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];

/** Charge v1/v2 des réglages, inchangée (le moteur 3 a la sienne, `buildEstimateV3SettingsPayload`). */
export function buildHistoricalSettingsPayload(
  settingsSnapshot: EstimateSettingsState,
  versionSnapshot: EstimateVersionRow,
  totalsSnapshot: EstimateTotals
) {
  const discountBase = totalsSnapshot.saleSubtotalCents;
  const discountBp =
    settingsSnapshot.discount_amount_cents == null
      ? (settingsSnapshot.discount_bp ?? versionSnapshot.discount_bp)
      : discountBase > 0
      ? Math.round(
          (totalsSnapshot.discountCents / discountBase) * 10000
        )
      : 0;
  const discountMode: DiscountMode =
    settingsSnapshot.discount_mode === "cascade" ? "cascade" : "simple";
  const normalizedCascadeDiscountSteps = normalizeCascadeDiscountSteps(
    settingsSnapshot.discount_steps
  );
  // EST-E26 etape 16 : le coefficient est une grandeur INDEPENDANTE du mode
  // de remise, il est persiste tel qu'il est affiche (cf.
  // buildVersionDiscountPatch). L'ecrire a 1 hors cascade rendait la version
  // auto-contradictoire, `total_ht_cents` l'incluant toujours.
  const discountPatch = buildVersionDiscountPatch({
    discountMode,
    globalCoefficient: settingsSnapshot.global_coefficient,
    cascadeDiscountSteps: normalizedCascadeDiscountSteps,
  });
  const payload: EstimateVersionUpdate = {
    title: settingsSnapshot.title.trim() || null,
    exclusions: settingsSnapshot.exclusions.trim() || null,
    date_devis: settingsSnapshot.date_devis,
    validite_jours: settingsSnapshot.validite_jours,
    currency: settingsSnapshot.currency,
    margin_multiplier: totalsSnapshot.appliedMarginMultiplier,
    margin_mode: settingsSnapshot.margin_mode ?? "fixed",
    discount_bp: discountBp,
    discount_amount_cents: settingsSnapshot.discount_amount_cents ?? null,
    ...discountPatch,
    tax_rate_bp: settingsSnapshot.tax_rate_bp,
    // EST-E27 : le regime de TVA est une grandeur de version, persistee
    // telle qu elle est choisie.
    contractor_role: settingsSnapshot.contractor_role ?? "principal",
    rounding_mode: settingsSnapshot.rounding_mode,
    rounding_step_cents: settingsSnapshot.rounding_step_cents,
    total_ht_cents: totalsSnapshot.saleTotalCents,
    total_tax_cents: totalsSnapshot.adjustedTaxCents,
    total_ttc_cents: totalsSnapshot.roundedTtcCents,
  };
  return { payload, discountPatch };
}

export function haveEstimateSettingsChanged(
  settings: EstimateSettingsState | null,
  savedSettings: EstimateSettingsState | null
) {
  return (
    JSON.stringify(buildSettingsComparisonSnapshot(settings)) !==
    JSON.stringify(buildSettingsComparisonSnapshot(savedSettings))
  );
}

/** Keep only fields edited locally while accepting the other newly confirmed settings. */
export function mergeReloadedEditorSettings(
  current: EstimateSettingsState | null,
  previouslyConfirmed: EstimateSettingsState | null,
  incoming: EstimateSettingsState
): EstimateSettingsState {
  if (!current || !previouslyConfirmed) return incoming;
  const currentFields = buildSettingsComparisonSnapshot(current)!;
  const savedFields = buildSettingsComparisonSnapshot(previouslyConfirmed)!;
  const localChanges = Object.fromEntries(
    (Object.keys(currentFields) as Array<keyof typeof currentFields>)
      .filter((key) => JSON.stringify(currentFields[key]) !== JSON.stringify(savedFields[key]))
      .map((key) => [key, current[key]])
  );
  return { ...incoming, ...localChanges };
}
