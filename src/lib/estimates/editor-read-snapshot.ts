import type { EstimateEditorData } from "@/lib/estimates/client";
import {
  normalizeEditorDraftItems,
  resolveEditorInitialDiscountCents,
  resolveEditorEngine,
} from "@/lib/estimates/editor-engine";
import {
  LABOR_SPLIT_FIELD_KEYS,
  resolveLaborRoleHourlyRate,
  type EstimateItem,
  type EstimateItemUpdatePayload,
} from "@/lib/estimates/editor-items";
import { isUnifiedEngine, usesSaleCoefficients, type EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { buildEditorSettingsFromVersion } from "@/lib/estimates/editor-settings-state";

const NORMALIZED_INPUT_FIELDS = [
  "tax_rate_bp", "k_fo", "h_mo", "h_mo_majoration", "k_mo", "supply_type_id",
  ...LABOR_SPLIT_FIELD_KEYS,
] as const;
const NORMALIZED_LINE_FIELDS = [
  ...NORMALIZED_INPUT_FIELDS,
  "pu_ht_cents", "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents",
] as const;

/** A read prepares data; only the editor accepting it may enqueue corrective writes. */
function prepareNormalizationUpdates(
  originalItems: readonly EstimateItem[],
  normalizedItems: readonly EstimateItem[],
  calcEngineVersion: EstimateEngineVersion
): Array<{ id: string; updates: EstimateItemUpdatePayload }> {
  const originals = new Map(originalItems.map((item) => [item.id, item]));
  return normalizedItems.flatMap((item) => {
    const original = originals.get(item.id);
    if (item.item_type === "line" && original && !usesSaleCoefficients(calcEngineVersion) && isUnifiedEngine(calcEngineVersion)) {
      // V2 persists amounts after global discount/allocation, while the draft
      // projection contains gross amounts. A different projection is not an edit.
      const updates: EstimateItemUpdatePayload = {};
      NORMALIZED_INPUT_FIELDS.forEach((key) => {
        if (original[key] !== item[key]) Object.assign(updates, { [key]: item[key] });
      });
      return Object.keys(updates).length > 0 ? [{ id: item.id, updates }] : [];
    }
    if (item.item_type !== "line" || !original ||
        !NORMALIZED_LINE_FIELDS.some((key) => original[key] !== item[key])) return [];
    return [{ id: item.id, updates: {
      tax_rate_bp: item.tax_rate_bp,
      k_fo: item.k_fo,
      h_mo: item.h_mo,
      h_mo_majoration: item.h_mo_majoration,
      k_mo: item.k_mo,
      supply_type_id: item.supply_type_id,
      pu_ht_cents: item.pu_ht_cents,
      line_total_ht_cents: item.line_total_ht_cents,
      line_tax_cents: item.line_tax_cents,
      line_total_ttc_cents: item.line_total_ttc_cents,
    } }];
  });
}

/** Shared pure preparation for opening a version and reconciling a structural write. */
export function prepareEstimateEditorRead(
  confirmed: EstimateEditorData,
  isLaborSplitEnabled: boolean
) {
  const roles = confirmed.laborRoles;
  const context = {
    version: confirmed.version,
    items: confirmed.items,
    rateById: new Map(roles.map((role) => [role.id, role.hourly_rate_cents])),
    rateAtelierById: new Map(roles.map((role) => [role.id, resolveLaborRoleHourlyRate(role, "atelier")])),
    rateChantierById: new Map(roles.map((role) => [role.id, resolveLaborRoleHourlyRate(role, "chantier")])),
    isLaborSplitEnabled,
  };
  const items = normalizeEditorDraftItems(context);
  const discountCents = resolveEditorInitialDiscountCents({
    ...context, marginTiers: confirmed.marginTiers,
  });
  const settings = buildEditorSettingsFromVersion(confirmed.version, {
    discountCents, marginTiers: confirmed.marginTiers,
  });
  return {
    confirmed,
    draft: { items, settings },
    normalizationUpdates: confirmed.version.status === "draft"
      ? prepareNormalizationUpdates(confirmed.items, items, resolveEditorEngine(confirmed.version))
      : [],
  };
}
