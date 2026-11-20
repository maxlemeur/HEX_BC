"use client";

import { useCallback, useMemo } from "react";

import {
  computeDraftBreakdown,
  computeLineValuesWithLaborContext as computeLineValuesWithLaborContextFromMaps,
} from "@/hooks/useEstimateEditorCalculation";
import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import type { EditorEstimateItem, EstimateItem } from "@/lib/estimates/editor-items";
import type { EstimateSettingsState } from "@/lib/estimates/editor-settings-state";
import { isUnifiedEngine, type CalcEngineVersion } from "@/lib/estimates/engine/capabilities";
import { withRederivedFoProvision, type FoProvisionBySupplyTypeId } from "@/lib/estimates/fo-provision";
import { applyOfferChoiceRules } from "@/lib/estimates/offer-choice";
import { applyStatusReasonRules } from "@/lib/estimates/status-reason";

/**
 * A line priced at the editor's labor rates, and a patched line normalized before it is written: its v1/v2
 * amounts recomputed, or its v3 entries kept with the status, reserve and FO provision the database keeps.
 */
export function useEstimateEditorLineNormalization({
  laborRateById,
  laborRateAtelierById,
  laborRateChantierById,
  isLaborSplitEnabled,
  isV3,
  calcEngineVersion,
  settings,
  editorDocument,
  getItemsSnapshot,
  foProvisionBySupplyTypeId,
}: {
  laborRateById: Map<string, number>;
  laborRateAtelierById: Map<string, number>;
  laborRateChantierById: Map<string, number>;
  isLaborSplitEnabled: boolean;
  isV3: boolean;
  calcEngineVersion: CalcEngineVersion;
  settings: EstimateSettingsState | null;
  editorDocument: EstimateEditorDocument;
  getItemsSnapshot: () => EditorEstimateItem[];
  foProvisionBySupplyTypeId: FoProvisionBySupplyTypeId;
}) {
  const laborRateMaps = useMemo(
    () => ({
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
    }),
    [laborRateAtelierById, laborRateById, laborRateChantierById]
  );

  const computeLineValuesWithLaborContext = useCallback(
    (
      item: EstimateItem,
      options: {
        marginMultiplier: number;
        taxRateBp: number;
        rateOverrideByRoleId?: string;
        hourlyRateCents?: number;
        hourlyRateAtelierCents?: number;
        hourlyRateChantierCents?: number;
        vatReverseCharge?: boolean;
      }
    ) =>
      computeLineValuesWithLaborContextFromMaps(item, laborRateMaps, {
        ...options,
        isLaborSplitEnabled,
      }),
    [isLaborSplitEnabled, laborRateMaps]
  );

  const normalizePatchedItem = useCallback(
    (item: EditorEstimateItem) => {
      if (item.item_type !== "line") return item;
      if (isV3) {
        // v3 : la ligne garde ses saisies ; PU, nets et heures totales viennent du moteur v3. Un changement de type
        // FO redérive la provision FO, comme le déclencheur à l'écriture (TI-534).
        const current = getItemsSnapshot().find((candidate) => candidate.id === item.id);
        // TI-682, lot C : la ligne reste celle que la base garde (« a été Non chiffrée » collant, motif effacé quand
        // le statut quitte Inclus, Pour mémoire, Hors lot et Sans objet). L'indicateur suit la ligne attendue en base
        // (confirmée, plus les enregistrements en vol) : l'écriture fusionnée du délai d'enregistrement s'y compare.
        const saved = (editorDocument.getExpectedItem(item.id) as EditorEstimateItem | undefined) ?? null;
        const statusTracked = current ? applyStatusReasonRules(current, item, saved) : item;
        // TI-682, lot C, PR 4 : la réserve écrite est celle que la base garde : la réserve enregistrée, effacée si le
        // statut qui sera écrit ne lui convient plus (jamais une saisie de la grille).
        const tracked = saved ? applyOfferChoiceRules(saved, { ...statusTracked, offer_choice: saved.offer_choice ?? null })
          : statusTracked;
        return withRederivedFoProvision(current, tracked, foProvisionBySupplyTypeId);
      }
      const taxRate =
        item.tax_rate_bp ?? settings?.tax_rate_bp ?? 0;
      let marginMultiplier = settings?.margin_multiplier ?? 1;
      if (isUnifiedEngine(calcEngineVersion) && settings?.margin_mode === "tiered") {
        const currentItems = getItemsSnapshot();
        const postPatchItems = currentItems.some((current) => current.id === item.id)
          ? currentItems.map((current) => current.id === item.id ? item : current)
          : [...currentItems, item];
        marginMultiplier = computeDraftBreakdown({
            items: postPatchItems,
            settings,
            calcEngineVersion,
            isLaborSplitEnabled,
            ...laborRateMaps,
        }).totals.appliedMarginMultiplier;
      }
      const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
        marginMultiplier,
        taxRateBp: taxRate,
        vatReverseCharge: settings?.contractor_role === "subcontractor",
      });
      return {
        ...item,
        tax_rate_bp: lineInput.tax_rate_bp,
        k_fo: lineInput.k_fo,
        h_mo: lineInput.h_mo,
        k_mo: lineInput.k_mo,
        pu_ht_cents: lineValues.puHtCents,
        line_total_ht_cents: lineValues.saleLineCents,
        line_tax_cents: lineValues.taxLineCents,
        line_total_ttc_cents: lineValues.ttcLineCents,
      };
    },
    [
      calcEngineVersion,
      computeLineValuesWithLaborContext,
      editorDocument,
      foProvisionBySupplyTypeId,
      getItemsSnapshot,
      isLaborSplitEnabled,
      isV3,
      laborRateMaps,
      settings,
    ]
  );

  return { computeLineValuesWithLaborContext, normalizePatchedItem };
}
