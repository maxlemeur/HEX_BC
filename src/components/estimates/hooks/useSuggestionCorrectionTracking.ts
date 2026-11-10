import { useCallback, useMemo, type MutableRefObject } from "react";

import {
  TRACKED_SUGGESTION_CORRECTION_FIELDS,
  type AppliedSuggestionContext,
  type EstimateEditorItemPatch,
  type SuggestionAppliedValues,
  type SuggestionCorrectionFieldName,
  type SuggestionCorrectionPayload,
  type SuggestionCorrectionValue,
} from "@/components/estimates/estimate-editor-table-types";
import { toNonEmptyString } from "@/lib/estimates/editor-values";

type ItemPatch = EstimateEditorItemPatch;
type CellPatchEntries = ReadonlyArray<{ itemId: string; patch: ItemPatch }>;

function normalizeSuggestionCorrectionValue(
  fieldName: SuggestionCorrectionFieldName,
  value: unknown
): SuggestionCorrectionValue {
  if (fieldName === "k_fo" || fieldName === "k_mo") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.replace(",", "."));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  return toNonEmptyString(value);
}

function readTrackedFieldValueFromPatch(
  patch: ItemPatch,
  fieldName: SuggestionCorrectionFieldName
): SuggestionCorrectionValue | undefined {
  if (!(fieldName in patch)) return undefined;
  const rawValue = patch[fieldName];
  if (rawValue === undefined) return undefined;
  return normalizeSuggestionCorrectionValue(fieldName, rawValue);
}

function toSuggestionCorrectionTextValue(value: SuggestionCorrectionValue) {
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function areSuggestionCorrectionValuesEqual(
  left: SuggestionCorrectionValue,
  right: SuggestionCorrectionValue
) {
  if (typeof left === "number" || typeof right === "number") {
    return typeof left === "number" && typeof right === "number" && left === right;
  }
  return left === right;
}

export function extractTrackedSuggestionValuesFromPatch(patch: ItemPatch) {
  const trackedValues: SuggestionAppliedValues = {};
  TRACKED_SUGGESTION_CORRECTION_FIELDS.forEach((fieldName) => {
    const fieldValue = readTrackedFieldValueFromPatch(patch, fieldName);
    if (fieldValue === undefined) return;
    trackedValues[fieldName] = fieldValue;
  });
  return trackedValues;
}

/**
 * Wraps the two write paths of the estimate grid (one cell, cells written
 * together) so that a persisted value that departs from an applied suggestion
 * is reported once as a correction of that suggestion.
 */
export function useSuggestionCorrectionTracking({
  isEnabled,
  appliedContextByItemIdRef,
  itemById,
  onPatchItem,
  onApplyCellPatches,
  onTrackSuggestionCorrections,
}: {
  isEnabled: boolean;
  appliedContextByItemIdRef: MutableRefObject<Record<string, AppliedSuggestionContext>>;
  itemById: ReadonlyMap<string, { item_type: string; title: string | null }>;
  onPatchItem: (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => void;
  onApplyCellPatches?: (entries: CellPatchEntries) => Promise<boolean | void>;
  onTrackSuggestionCorrections?: (corrections: SuggestionCorrectionPayload[]) => Promise<void>;
}) {
  const collectSuggestionCorrections = useCallback(
    (itemId: string, patch: ItemPatch): SuggestionCorrectionPayload[] => {
      if (!isEnabled) return [];
      if (!onTrackSuggestionCorrections) return [];

      const appliedContext = appliedContextByItemIdRef.current[itemId];
      if (!appliedContext) return [];

      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return [];

      const corrections: SuggestionCorrectionPayload[] = [];

      TRACKED_SUGGESTION_CORRECTION_FIELDS.forEach((fieldName) => {
        if (appliedContext.trackedFieldDivergences[fieldName]) {
          return;
        }

        const correctedValue = readTrackedFieldValueFromPatch(patch, fieldName);
        if (correctedValue === undefined) return;

        const suggestedValue = appliedContext.suggestedValues[fieldName];
        if (suggestedValue === undefined) return;

        if (areSuggestionCorrectionValuesEqual(suggestedValue, correctedValue)) {
          return;
        }

        appliedContext.trackedFieldDivergences[fieldName] = true;
        corrections.push({
          rule_id: appliedContext.ruleId,
          field_name: fieldName,
          original_value: toSuggestionCorrectionTextValue(suggestedValue),
          corrected_value: toSuggestionCorrectionTextValue(correctedValue),
          item_title: item.title ?? "",
        });
      });

      return corrections;
    },
    [appliedContextByItemIdRef, isEnabled, itemById, onTrackSuggestionCorrections]
  );

  const sendSuggestionCorrections = useCallback(
    (corrections: SuggestionCorrectionPayload[]) => {
      if (corrections.length === 0 || !onTrackSuggestionCorrections) return;
      void onTrackSuggestionCorrections(corrections).catch((error) => {
        console.error("Impossible d'envoyer les corrections de suggestion.", error);
      });
    },
    [onTrackSuggestionCorrections]
  );

  const patchItemWithSuggestionTracking = useCallback(
    (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => {
      onPatchItem(itemId, patch, options);

      if (options?.persist !== true) return;
      sendSuggestionCorrections(collectSuggestionCorrections(itemId, patch));
    },
    [collectSuggestionCorrections, onPatchItem, sendSuggestionCorrections]
  );

  // Cells written together by the grid correct the suggestions as a cell-by-cell entry
  // does, once the batch is accepted and in a single send.
  const applyCellPatchesWithSuggestionTracking = useMemo(() => {
    if (!onApplyCellPatches) return undefined;
    return async (entries: CellPatchEntries) => {
      const applied = await onApplyCellPatches(entries);
      if (applied === false) return false;
      sendSuggestionCorrections(
        entries.flatMap((entry) => collectSuggestionCorrections(entry.itemId, entry.patch))
      );
      return true;
    };
  }, [collectSuggestionCorrections, onApplyCellPatches, sendSuggestionCorrections]);

  return { patchItemWithSuggestionTracking, applyCellPatchesWithSuggestionTracking };
}
