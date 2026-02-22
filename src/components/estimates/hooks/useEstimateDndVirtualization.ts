"use client";

import { useCallback, useEffect, useMemo, type RefObject } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DndContextProps,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { useVirtualList } from "@/hooks/useVirtualList";
import { type SpreadsheetCell } from "@/hooks/useSpreadsheetNavigation";
import { type EstimateQualityFlagKey } from "@/lib/estimate-quality";
import {
  type SuggestionPreview,
} from "@/components/estimates/components/EstimateSuggestionRow";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type EstimateVirtualizationConfig = {
  enabled?: boolean;
  rowEstimate?: number;
  overscan?: number;
  maxHeight?: number;
  containerHeight?: number;
};

const ROOT_KEY = "root";
const DEFAULT_VIRTUAL_ROW_ESTIMATE = 56;
const DEFAULT_VIRTUAL_OVERSCAN = 8;
const DEFAULT_VIRTUAL_MAX_HEIGHT = 640;
const EMPTY_ITEMS: EstimateItem[] = [];
const EMPTY_QUALITY_FLAGS: EstimateQualityFlagKey[] = [];

function getParentKey(id: string | null) {
  return id ?? ROOT_KEY;
}

export type VirtualizedItemRow = {
  key: string;
  kind: "item";
  item: EstimateItem;
  depth: number;
  unitValue: string;
  supplyTypeValue: string;
  qualityFlags: EstimateQualityFlagKey[];
};

export type VirtualizedSuggestionRow = {
  key: string;
  kind: "suggestion";
  item: EstimateItem;
  suggestions: SuggestionPreview[];
};

export type VirtualizedRow = VirtualizedItemRow | VirtualizedSuggestionRow;

export type UseEstimateDndVirtualizationInput = {
  canReorder: boolean;
  itemsByParent: Map<string, EstimateItem[]>;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  hasVisibleRows: boolean;
  getVisibleItems: (parentId: string | null) => EstimateItem[];
  depthMap: Map<string, number>;
  mergedUnitDrafts: Record<string, string>;
  mergedSupplyTypeDrafts: Record<string, string>;
  qualityFlagsByItemId: Record<string, EstimateQualityFlagKey[]>;
  suggestionsByItemId: Map<string, SuggestionPreview[]>;
  virtualization?: EstimateVirtualizationConfig;
  tableCardRef: RefObject<HTMLDivElement | null>;
  scrollToItemId?: string | null;
  onScrollToItemHandled?: () => void;
};

export function useEstimateDndVirtualization({
  canReorder,
  itemsByParent,
  onReorder,
  hasVisibleRows,
  getVisibleItems,
  depthMap,
  mergedUnitDrafts,
  mergedSupplyTypeDrafts,
  qualityFlagsByItemId,
  suggestionsByItemId,
  virtualization,
  tableCardRef,
  scrollToItemId,
  onScrollToItemHandled,
}: UseEstimateDndVirtualizationInput) {
  const shouldVirtualize = Boolean(virtualization?.enabled);

  const flattenedRows = useMemo(() => {
    if (!shouldVirtualize) return [] as VirtualizedRow[];

    const rows: VirtualizedRow[] = [];
    const walk = (parentId: string | null) => {
      const list = getVisibleItems(parentId);
      list.forEach((item) => {
        rows.push({
          key: `item:${item.id}`,
          kind: "item",
          item,
          depth: depthMap.get(item.id) ?? 0,
          unitValue: mergedUnitDrafts[item.id] ?? "",
          supplyTypeValue: mergedSupplyTypeDrafts[item.id] ?? "",
          qualityFlags: qualityFlagsByItemId[item.id] ?? EMPTY_QUALITY_FLAGS,
        });

        const suggestions = suggestionsByItemId.get(item.id);
        if (suggestions && suggestions.length > 0) {
          rows.push({
            key: `suggestion:${item.id}`,
            kind: "suggestion",
            item,
            suggestions,
          });
        }

        if (item.item_type === "section") {
          walk(item.id);
        }
      });
    };

    walk(null);
    return rows;
  }, [
    depthMap,
    getVisibleItems,
    mergedSupplyTypeDrafts,
    mergedUnitDrafts,
    qualityFlagsByItemId,
    shouldVirtualize,
    suggestionsByItemId,
  ]);

  const {
    scrollRef: virtualScrollRef,
    virtualItems,
    totalSize: virtualTotalSize,
    measureElement,
    scrollToIndex,
    isVirtualized,
  } = useVirtualList({
    count: flattenedRows.length,
    enabled: shouldVirtualize && hasVisibleRows,
    estimateSize: virtualization?.rowEstimate ?? DEFAULT_VIRTUAL_ROW_ESTIMATE,
    overscan: virtualization?.overscan ?? DEFAULT_VIRTUAL_OVERSCAN,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: Parameters<NonNullable<DndContextProps["onDragEnd"]>>[0]) => {
      if (!canReorder) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeParent = active.data.current?.parentId ?? null;
      const overParent = over.data.current?.parentId ?? null;
      if (activeParent !== overParent) return;

      const siblings = itemsByParent.get(getParentKey(activeParent)) ?? EMPTY_ITEMS;
      const oldIndex = siblings.findIndex((item) => item.id === active.id);
      const newIndex = siblings.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const ordered = arrayMove(siblings, oldIndex, newIndex).map((item) => item.id);
      onReorder(activeParent, ordered);
    },
    [canReorder, itemsByParent, onReorder]
  );

  const virtualizedSortableIds = useMemo(() => {
    if (!canReorder || !isVirtualized) return [] as string[];

    const ids: string[] = [];
    virtualItems.forEach((virtualRow) => {
      const row = flattenedRows[virtualRow.index];
      if (row?.kind === "item") {
        ids.push(row.item.id);
      }
    });
    return ids;
  }, [canReorder, flattenedRows, isVirtualized, virtualItems]);

  const virtualRowIndexByItemId = useMemo(() => {
    const map = new Map<string, number>();
    if (!isVirtualized) return map;

    flattenedRows.forEach((row, index) => {
      if (row.kind === "item") {
        map.set(row.item.id, index);
      }
    });
    return map;
  }, [flattenedRows, isVirtualized]);

  const handleNavigationCellNotMounted = useCallback(
    (cell: SpreadsheetCell) => {
      if (!isVirtualized) return;
      const rowIndex = virtualRowIndexByItemId.get(cell.rowId);
      if (rowIndex === undefined) return;
      scrollToIndex(rowIndex);
    },
    [isVirtualized, scrollToIndex, virtualRowIndexByItemId]
  );

  useEffect(() => {
    if (!scrollToItemId) return;

    let frameId: number | null = null;
    const scrollToRow = () => {
      const rowElement = tableCardRef.current?.querySelector<HTMLElement>(
        `[data-estimate-item-id="${scrollToItemId}"]`
      );
      if (rowElement) {
        rowElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      onScrollToItemHandled?.();
    };

    if (isVirtualized) {
      const rowIndex = virtualRowIndexByItemId.get(scrollToItemId);
      if (rowIndex === undefined) {
        onScrollToItemHandled?.();
        return;
      }
      scrollToIndex(rowIndex);
      frameId = window.requestAnimationFrame(scrollToRow);
    } else {
      scrollToRow();
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    isVirtualized,
    onScrollToItemHandled,
    scrollToIndex,
    scrollToItemId,
    tableCardRef,
    virtualRowIndexByItemId,
  ]);

  const virtualBodyStyle = useMemo(() => {
    if (!isVirtualized) return undefined;
    const maxHeight =
      virtualization?.maxHeight ??
      virtualization?.containerHeight ??
      DEFAULT_VIRTUAL_MAX_HEIGHT;
    return {
      maxHeight: `${maxHeight}px`,
      overflowY: "auto" as const,
    };
  }, [isVirtualized, virtualization?.containerHeight, virtualization?.maxHeight]);

  return {
    sensors,
    handleDragEnd,
    flattenedRows,
    virtualScrollRef,
    virtualItems,
    virtualTotalSize,
    measureElement,
    isVirtualized,
    virtualizedSortableIds,
    virtualBodyStyle,
    handleNavigationCellNotMounted,
  };
}

export type UseEstimateDndVirtualizationResult = ReturnType<
  typeof useEstimateDndVirtualization
>;
