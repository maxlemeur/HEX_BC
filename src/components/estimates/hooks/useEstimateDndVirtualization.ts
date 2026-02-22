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
const MAX_SECTION_DEPTH = 1;
const MAX_LINE_DEPTH = 2;

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
  onMoveItem: (
    itemId: string,
    fromParentId: string | null,
    toParentId: string | null,
    orderedSourceIds: string[],
    orderedTargetIds: string[]
  ) => void;
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
  onMoveItem,
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

  const itemById = useMemo(() => {
    const map = new Map<string, EstimateItem>();
    itemsByParent.forEach((siblings) => {
      siblings.forEach((item) => {
        map.set(item.id, item);
      });
    });
    return map;
  }, [itemsByParent]);

  const resolveDepth = useCallback(
    (itemId: string): number => {
      const fromMap = depthMap.get(itemId);
      if (fromMap !== undefined) return fromMap;

      let depth = 0;
      let currentParentId = itemById.get(itemId)?.parent_id ?? null;
      while (currentParentId) {
        const parent = itemById.get(currentParentId);
        if (!parent) break;
        depth += 1;
        currentParentId = parent.parent_id;
      }
      return depth;
    },
    [depthMap, itemById]
  );

  const isDescendantParent = useCallback(
    (targetParentId: string | null, activeItemId: string): boolean => {
      let currentParentId = targetParentId;
      while (currentParentId) {
        if (currentParentId === activeItemId) return true;
        const parent = itemById.get(currentParentId);
        if (!parent) break;
        currentParentId = parent.parent_id;
      }
      return false;
    },
    [itemById]
  );

  const canMoveToParent = useCallback(
    (activeItem: EstimateItem, targetParentId: string | null): boolean => {
      if (targetParentId !== null) {
        const targetParent = itemById.get(targetParentId);
        if (!targetParent || targetParent.item_type !== "section") {
          return false;
        }
      }

      if (activeItem.item_type === "section") {
        if (targetParentId !== null) {
          const queue = [activeItem.id];
          while (queue.length > 0) {
            const currentId = queue.pop();
            if (!currentId) continue;
            const children = itemsByParent.get(getParentKey(currentId)) ?? EMPTY_ITEMS;
            for (const child of children) {
              if (child.item_type === "section") {
                return false;
              }
              queue.push(child.id);
            }
          }
        }

        if (
          targetParentId !== null &&
          isDescendantParent(targetParentId, activeItem.id)
        ) {
          return false;
        }
        const nextDepth =
          targetParentId === null ? 0 : resolveDepth(targetParentId) + 1;
        return nextDepth <= MAX_SECTION_DEPTH;
      }

      const nextDepth =
        targetParentId === null ? 0 : resolveDepth(targetParentId) + 1;
      return nextDepth <= MAX_LINE_DEPTH;
    },
    [isDescendantParent, itemById, itemsByParent, resolveDepth]
  );

  const handleDragEnd = useCallback(
    (event: Parameters<NonNullable<DndContextProps["onDragEnd"]>>[0]) => {
      if (!canReorder) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      const activeItem = itemById.get(activeId);
      const overItem = itemById.get(overId);
      if (!activeItem) return;

      const activeParent =
        (active.data.current?.parentId as string | null | undefined) ??
        activeItem.parent_id ??
        null;
      const overParentFromData = over.data.current?.parentId as
        | string
        | null
        | undefined;
      const overParent =
        overParentFromData !== undefined
          ? overParentFromData
          : (overItem?.parent_id ?? null);

      let targetParentId = overParent;
      const canDropInsideSection =
        overItem?.item_type === "section" &&
        (activeItem.item_type === "line" || activeParent !== null);
      if (canDropInsideSection && canMoveToParent(activeItem, overItem.id)) {
        targetParentId = overItem.id;
      }
      if (!canMoveToParent(activeItem, targetParentId)) return;

      if (targetParentId === activeParent) {
        const siblings = itemsByParent.get(getParentKey(activeParent)) ?? EMPTY_ITEMS;
        const oldIndex = siblings.findIndex((item) => item.id === activeId);
        const newIndex = siblings.findIndex((item) => item.id === overId);
        if (oldIndex === -1 || newIndex === -1) return;

        const ordered = arrayMove(siblings, oldIndex, newIndex).map((item) => item.id);
        onReorder(activeParent, ordered);
        return;
      }

      const sourceSiblings =
        itemsByParent.get(getParentKey(activeParent)) ?? EMPTY_ITEMS;
      const targetSiblings =
        itemsByParent.get(getParentKey(targetParentId)) ?? EMPTY_ITEMS;
      const sourceIds = sourceSiblings.map((item) => item.id);
      if (!sourceIds.includes(activeId)) return;

      const orderedSourceIds = sourceIds.filter((id) => id !== activeId);
      const orderedTargetIds = targetSiblings
        .map((item) => item.id)
        .filter((id) => id !== activeId);
      const overIndex = orderedTargetIds.indexOf(overId);
      const insertIndex =
        targetParentId === overItem?.id || overIndex === -1
          ? orderedTargetIds.length
          : overIndex;
      orderedTargetIds.splice(insertIndex, 0, activeId);

      onMoveItem(
        activeId,
        activeParent,
        targetParentId,
        orderedSourceIds,
        orderedTargetIds
      );
    },
    [canMoveToParent, canReorder, itemById, itemsByParent, onMoveItem, onReorder]
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
