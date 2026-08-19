import { useMemo } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import {
  computeEstimateBreakdown,
  computeReadOnlyTotals,
  type EstimateTotals,
} from "@/lib/estimate-calculations";
import type { CalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import { readLaborSplitFields } from "@/lib/estimates/editor-items";

type EstimateEditorCalculationInput = {
  items: EditorEstimateItem[];
  settings: EstimateSettingsState | null;
  savedSettings: EstimateSettingsState | null;
  version: EstimateVersionRow | null;
  calcEngineVersion: CalcEngineVersion;
  isReadOnly: boolean;
  isLaborSplitEnabled: boolean;
  laborRateById: Map<string, number>;
  laborRateAtelierById: Map<string, number>;
  laborRateChantierById: Map<string, number>;
};

type EstimateEditorCalculationResult = {
  totals: EstimateTotals | null;
  editorDisplayItems: EditorEstimateItem[];
  persistedTotals: EstimateTotals | null;
};

function computeDraftBreakdown(input: {
  items: EditorEstimateItem[];
  settings: EstimateSettingsState;
  calcEngineVersion: CalcEngineVersion;
  isLaborSplitEnabled: boolean;
  laborRateById: Map<string, number>;
  laborRateAtelierById: Map<string, number>;
  laborRateChantierById: Map<string, number>;
}) {
  return computeEstimateBreakdown({
    items: input.items,
    marginMultiplier: input.settings.margin_multiplier,
    marginMode: input.settings.margin_mode ?? "fixed",
    marginTiers: input.settings.margin_tiers ?? [],
    discountCents: input.settings.discount_cents,
    discountMode: input.settings.discount_mode ?? "simple",
    discountStepsBp: input.settings.discount_steps ?? [],
    globalCoefficient: input.settings.global_coefficient ?? 1,
    taxRateBp: input.settings.tax_rate_bp,
    roundingMode: input.settings.rounding_mode,
    roundingStepCents: input.settings.rounding_step_cents,
    isLaborSplitEnabled: input.isLaborSplitEnabled,
    vatReverseCharge: input.settings.contractor_role === "subcontractor",
    laborRateById: input.laborRateById,
    laborRateAtelierById: input.laborRateAtelierById,
    laborRateChantierById: input.laborRateChantierById,
    calcEngineVersion: input.calcEngineVersion,
  });
}

function toFiniteNumber(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildLineCalculationInput(
  item: EstimateItem,
  maps: {
    laborRateById: Map<string, number>;
    laborRateAtelierById: Map<string, number>;
    laborRateChantierById: Map<string, number>;
  },
  options?: {
    taxRateBp?: number;
    rateOverrideByRoleId?: string;
    hourlyRateCents?: number;
    hourlyRateAtelierCents?: number;
    hourlyRateChantierCents?: number;
  }
) {
  const splitFields = readLaborSplitFields(item);
  const taxRate = options?.taxRateBp ?? item.tax_rate_bp ?? 0;
  const kFo = item.k_fo ?? 1;
  const hMo = item.h_mo ?? 0;
  const hMoMajoration = item.h_mo_majoration ?? 1;
  const kMo = item.k_mo ?? 1;
  const overrideRoleId = options?.rateOverrideByRoleId;

  const resolveRate = (
    roleId: string | null | undefined,
    map: Map<string, number>,
    overrideRate: number | undefined
  ) => {
    if (!roleId) return 0;
    if (overrideRoleId && roleId === overrideRoleId) {
      return Math.max(toFiniteNumber(overrideRate, 0), 0);
    }
    return map.get(roleId) ?? 0;
  };

  return {
    ...item,
    tax_rate_bp: taxRate,
    k_fo: kFo,
    h_mo: hMo,
    h_mo_majoration: hMoMajoration,
    k_mo: kMo,
    ...splitFields,
    labor_role_hourly_rate_cents: resolveRate(
      item.labor_role_id,
      maps.laborRateById,
      options?.hourlyRateCents
    ),
    labor_role_atelier_hourly_rate_cents: resolveRate(
      splitFields.labor_role_atelier_id,
      maps.laborRateAtelierById,
      options?.hourlyRateAtelierCents ?? options?.hourlyRateCents
    ),
    labor_role_chantier_hourly_rate_cents: resolveRate(
      splitFields.labor_role_chantier_id,
      maps.laborRateChantierById,
      options?.hourlyRateChantierCents ?? options?.hourlyRateCents
    ),
  };
}

export function computeLineValuesWithLaborContext(
  item: EstimateItem,
  maps: {
    laborRateById: Map<string, number>;
    laborRateAtelierById: Map<string, number>;
    laborRateChantierById: Map<string, number>;
  },
  options: {
    marginMultiplier: number;
    taxRateBp: number;
    isLaborSplitEnabled: boolean;
    rateOverrideByRoleId?: string;
    hourlyRateCents?: number;
    hourlyRateAtelierCents?: number;
    hourlyRateChantierCents?: number;
    vatReverseCharge?: boolean;
  }
) {
  const lineInput = buildLineCalculationInput(item, maps, {
    taxRateBp: options.taxRateBp,
    rateOverrideByRoleId: options.rateOverrideByRoleId,
    hourlyRateCents: options.hourlyRateCents,
    hourlyRateAtelierCents: options.hourlyRateAtelierCents,
    hourlyRateChantierCents: options.hourlyRateChantierCents,
  });
  return {
    lineInput,
    lineValues: computeEstimateLineValues(lineInput, {
      marginMultiplier: options.marginMultiplier,
      taxRateBp: options.vatReverseCharge ? 0 : options.taxRateBp,
      isLaborSplitEnabled: options.isLaborSplitEnabled,
    }),
  };
}

/**
 * Module de calcul d'affichage de l'editeur. Son interface expose les quatre
 * valeurs utiles au caller et garde le choix draft/snapshot v2 au meme seam.
 */
export function useEstimateEditorCalculation(
  input: EstimateEditorCalculationInput
): EstimateEditorCalculationResult {
  const {
    items,
    settings,
    savedSettings,
    version,
    calcEngineVersion,
    isReadOnly,
    isLaborSplitEnabled,
    laborRateById,
    laborRateAtelierById,
    laborRateChantierById,
  } = input;
  const calculationBreakdown = useMemo(() => {
    if (!settings || isReadOnly) return null;
    return computeDraftBreakdown({
      items,
      settings,
      calcEngineVersion,
      isLaborSplitEnabled,
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
    });
  }, [
    calcEngineVersion,
    isLaborSplitEnabled,
    isReadOnly,
    items,
    laborRateAtelierById,
    laborRateById,
    laborRateChantierById,
    settings,
  ]);

  const totals = useMemo(() => {
    if (!settings) return null;
    if (!isReadOnly || !version) {
      return calculationBreakdown?.totals ?? null;
    }
    return computeReadOnlyTotals({
      items,
      version: {
        ...version,
        discount_mode: settings.discount_mode ?? version.discount_mode,
        discount_steps: settings.discount_steps ?? version.discount_steps,
        global_coefficient: settings.global_coefficient ?? version.global_coefficient,
      },
      discountCents: settings.discount_cents,
      laborRateById,
      isLaborSplitEnabled,
      laborRateAtelierById,
      laborRateChantierById,
      marginTiers: settings.margin_tiers ?? [],
      roundingMode: settings.rounding_mode,
      roundingStepCents: settings.rounding_step_cents,
      calcEngineVersion,
      preserveStoredSnapshot: true,
      vatReverseCharge: settings.contractor_role === "subcontractor",
    });
  }, [
    calculationBreakdown,
    calcEngineVersion,
    isLaborSplitEnabled,
    isReadOnly,
    items,
    laborRateAtelierById,
    laborRateById,
    laborRateChantierById,
    settings,
    version,
  ]);

  const editorDisplayItems = useMemo(() => {
    if (calcEngineVersion !== 2) return items;
    if (isReadOnly) {
      return items.map((item) =>
        item.item_type === "line" && item.snapshot_pu_ht_cents != null
          ? { ...item, pu_ht_cents: item.snapshot_pu_ht_cents }
          : item
      );
    }
    if (!calculationBreakdown) return items;
    return items.map((item) => {
      const line = calculationBreakdown.lineById.get(item.id);
      return line
        ? {
            ...item,
            pu_ht_cents: line.puNetHtCents,
            line_total_ht_cents: line.saleNetHtCents,
            line_tax_cents: line.taxCents,
            line_total_ttc_cents: line.saleNetHtCents + line.taxCents,
          }
        : item;
    });
  }, [
    calculationBreakdown,
    calcEngineVersion,
    isReadOnly,
    items,
  ]);

  const persistedTotals = useMemo(() => {
    if (!savedSettings) return null;
    return computeDraftBreakdown({
      items,
      settings: savedSettings,
      calcEngineVersion,
      isLaborSplitEnabled,
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
    }).totals;
  }, [
    calcEngineVersion,
    isLaborSplitEnabled,
    items,
    laborRateAtelierById,
    laborRateById,
    laborRateChantierById,
    savedSettings,
  ]);

  return {
    totals,
    editorDisplayItems,
    persistedTotals,
  };
}
