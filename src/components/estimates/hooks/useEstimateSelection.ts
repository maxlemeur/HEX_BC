"use client";

import { useCallback, useState } from "react";

import {
  useMultiSelect,
  type MultiSelectItemInteraction,
} from "@/hooks/useMultiSelect";
import { parseNumberInput } from "@/lib/estimates/editor-values";

function parseMajorationPercentToCoefficient(value: string) {
  return Math.max(parseNumberInput(value) / 100, 0);
}

type UseEstimateSelectionParams = {
  visibleLineIdList: string[];
  isReadOnly: boolean;
  onApplyBulkMajoration: (itemIds: string[], coefficient: number) => Promise<void>;
  onBulkDeleteLines: (itemIds: string[]) => Promise<void>;
  onBulkMoveLines: (itemIds: string[], targetParentId: string | null) => Promise<void>;
  onBulkSetCategory: (itemIds: string[], categoryId: string | null) => Promise<void>;
  onBulkSetLaborRole: (itemIds: string[], laborRoleId: string | null) => Promise<void>;
};

export function useEstimateSelection({
  visibleLineIdList,
  isReadOnly,
  onApplyBulkMajoration,
  onBulkDeleteLines,
  onBulkMoveLines,
  onBulkSetCategory,
  onBulkSetLaborRole,
}: UseEstimateSelectionParams) {
  const [bulkMajorationPercent, setBulkMajorationPercent] = useState("100");
  const [bulkMoveParentId, setBulkMoveParentId] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkLaborRoleId, setBulkLaborRoleId] = useState("");

  const {
    selectedIds: selectedLineIdList,
    isSelected: isLineSelected,
    handleItemSelection,
    selectAll: selectAllVisibleLines,
    clear: clearLineSelection,
  } = useMultiSelect({
    visibleIds: visibleLineIdList,
  });

  const selectedLineCount = selectedLineIdList.length;
  const hasSelectedLines = selectedLineCount > 0;

  const allVisibleSelected =
    visibleLineIdList.length > 0 && selectedLineCount === visibleLineIdList.length;

  const toggleAllVisibleLines = useCallback(
    (checked: boolean) => {
      if (checked) {
        selectAllVisibleLines(visibleLineIdList);
        return;
      }
      clearLineSelection();
    },
    [clearLineSelection, selectAllVisibleLines, visibleLineIdList]
  );

  const handleLineSelectionInteraction = useCallback(
    (interaction: MultiSelectItemInteraction) => {
      if (isReadOnly) return;
      handleItemSelection(interaction);
    },
    [handleItemSelection, isReadOnly]
  );

  const handleApplyBulkMajoration = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    const coefficient = parseMajorationPercentToCoefficient(bulkMajorationPercent);
    await onApplyBulkMajoration(selectedLineIdList, coefficient);
  }, [
    bulkMajorationPercent,
    hasSelectedLines,
    isReadOnly,
    onApplyBulkMajoration,
    selectedLineIdList,
  ]);

  const handleBulkDeleteSelection = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;

    const lineLabel =
      selectedLineCount > 1 ? "lignes selectionnees" : "ligne selectionnee";
    const confirmed = window.confirm(`Supprimer ${selectedLineCount} ${lineLabel} ?`);
    if (!confirmed) return;

    await onBulkDeleteLines(selectedLineIdList);
    clearLineSelection();
  }, [
    clearLineSelection,
    hasSelectedLines,
    isReadOnly,
    onBulkDeleteLines,
    selectedLineCount,
    selectedLineIdList,
  ]);

  const handleApplyBulkMove = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    await onBulkMoveLines(selectedLineIdList, bulkMoveParentId || null);
  }, [
    bulkMoveParentId,
    hasSelectedLines,
    isReadOnly,
    onBulkMoveLines,
    selectedLineIdList,
  ]);

  const handleApplyBulkCategory = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    await onBulkSetCategory(selectedLineIdList, bulkCategoryId || null);
  }, [
    bulkCategoryId,
    hasSelectedLines,
    isReadOnly,
    onBulkSetCategory,
    selectedLineIdList,
  ]);

  const handleApplyBulkLaborRole = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    await onBulkSetLaborRole(selectedLineIdList, bulkLaborRoleId || null);
  }, [
    bulkLaborRoleId,
    hasSelectedLines,
    isReadOnly,
    onBulkSetLaborRole,
    selectedLineIdList,
  ]);

  return {
    bulkMajorationPercent,
    setBulkMajorationPercent,
    bulkMoveParentId,
    setBulkMoveParentId,
    bulkCategoryId,
    setBulkCategoryId,
    bulkLaborRoleId,
    setBulkLaborRoleId,
    selectedLineIdList,
    selectedLineCount,
    hasSelectedLines,
    allVisibleSelected,
    isLineSelected,
    selectAllVisibleLines,
    clearLineSelection,
    toggleAllVisibleLines,
    handleLineSelectionInteraction,
    handleApplyBulkMajoration,
    handleBulkDeleteSelection,
    handleApplyBulkMove,
    handleApplyBulkCategory,
    handleApplyBulkLaborRole,
  };
}

export type UseEstimateSelectionResult = ReturnType<typeof useEstimateSelection>;
