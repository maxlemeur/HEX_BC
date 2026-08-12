"use client";

import { useCallback, useMemo } from "react";

import {
  computeAllSectionTotals,
  type ComputeAllSectionTotalsInput,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import type {
  EstimateQualityFlagKey,
  EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export type EstimateQualityFilter =
  | "all_lines"
  | "with_anomalies"
  | EstimateQualityFlagKey;

type BulkMoveDestination = {
  id: string | null;
  label: string;
};

export type EstimateSectionCalculation = Pick<
  ComputeAllSectionTotalsInput,
  | "marginMode"
  | "marginTiers"
  | "globalCoefficient"
  | "discountMode"
  | "discountStepsBp"
  | "calcEngineVersion"
  | "preserveStoredSnapshot"
>;

type UseEstimateVisibilityParams = {
  items: EstimateItem[];
  reorderItems?: EstimateItem[];
  qualityFilter: EstimateQualityFilter;
  qualityFlagsByItemId: EstimateQualityFlagsByItemId;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  sectionCalculation: EstimateSectionCalculation;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled: boolean;
};

const ROOT_KEY = "root";
const EMPTY_ITEMS: EstimateItem[] = [];

function getParentKey(id: string | null) {
  return id ?? ROOT_KEY;
}

function buildItemsByParentMap(items: EstimateItem[]) {
  const map = new Map<string, EstimateItem[]>();
  items.forEach((item) => {
    const key = getParentKey(item.parent_id);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  });
  map.forEach((list) => list.sort((a, b) => a.position - b.position));
  return map;
}

function matchesQualityFilter(
  qualityFlags: EstimateQualityFlagKey[],
  filter: EstimateQualityFilter
) {
  if (filter === "all_lines") return true;
  if (filter === "with_anomalies") return qualityFlags.length > 0;
  return qualityFlags.includes(filter);
}

export function useEstimateVisibility({
  items,
  reorderItems,
  qualityFilter,
  qualityFlagsByItemId,
  marginMultiplier,
  discountCents,
  taxRateBp,
  sectionCalculation,
  laborRateById,
  isLaborSplitEnabled,
}: UseEstimateVisibilityParams) {
  const reorderSourceItems = reorderItems ?? items;

  const itemsByParent = useMemo(() => {
    return buildItemsByParentMap(reorderSourceItems);
  }, [reorderSourceItems]);

  const visibleSourceItemsByParent = useMemo(() => {
    return buildItemsByParentMap(items);
  }, [items]);

  const depthMap = useMemo(() => {
    const depth = new Map<string, number>();
    function walk(parentId: string | null, level: number) {
      const list = itemsByParent.get(getParentKey(parentId)) ?? [];
      list.forEach((item) => {
        depth.set(item.id, level);
        if (item.item_type === "section") {
          walk(item.id, level + 1);
        }
      });
    }
    walk(null, 0);
    return depth;
  }, [itemsByParent]);

  const itemById = useMemo(() => {
    const map = new Map<string, EstimateItem>();
    reorderSourceItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [reorderSourceItems]);

  const bulkMoveDestinations = useMemo(() => {
    const destinations: BulkMoveDestination[] = [{ id: null, label: "Racine" }];

    function walk(parentId: string | null, depth: number) {
      const children = itemsByParent.get(getParentKey(parentId)) ?? [];
      children.forEach((child) => {
        if (child.item_type !== "section") return;
        const prefix = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
        destinations.push({
          id: child.id,
          label: `${prefix}${child.title || "Sans titre"}`,
        });
        walk(child.id, depth + 1);
      });
    }

    walk(null, 0);
    return destinations;
  }, [itemsByParent]);

  const visibleLineIds = useMemo(() => {
    const visible = new Set<string>();
    items.forEach((item) => {
      if (item.item_type !== "line") return;
      const qualityFlags = qualityFlagsByItemId[item.id] ?? [];
      if (matchesQualityFilter(qualityFlags, qualityFilter)) {
        visible.add(item.id);
      }
    });
    return visible;
  }, [items, qualityFilter, qualityFlagsByItemId]);

  const visibleSectionIds = useMemo(() => {
    const visible = new Set<string>();

    function walk(parentId: string | null): boolean {
      const list = visibleSourceItemsByParent.get(getParentKey(parentId)) ?? [];
      let hasVisibleLine = false;

      list.forEach((item) => {
        if (item.item_type === "line") {
          if (visibleLineIds.has(item.id)) {
            hasVisibleLine = true;
          }
          return;
        }

        const hasVisibleChild = walk(item.id);
        if (qualityFilter === "all_lines" || hasVisibleChild) {
          visible.add(item.id);
        }
        if (hasVisibleChild) {
          hasVisibleLine = true;
        }
      });

      return hasVisibleLine;
    }

    walk(null);
    return visible;
  }, [qualityFilter, visibleLineIds, visibleSourceItemsByParent]);

  const sectionTotalsById = useMemo(() => {
    const calcItems = items as EstimateItemRecord[];
    return computeAllSectionTotals({
      items: calcItems,
      marginMultiplier,
      discountCents,
      taxRateBp,
      laborRateById,
      isLaborSplitEnabled,
      ...sectionCalculation,
      sectionIds: visibleSectionIds,
    });
  }, [
    discountCents,
    isLaborSplitEnabled,
    items,
    laborRateById,
    marginMultiplier,
    sectionCalculation,
    taxRateBp,
    visibleSectionIds,
  ]);

  const getSectionTotals = useCallback(
    (sectionId: string) => sectionTotalsById.get(sectionId) ?? null,
    [sectionTotalsById]
  );

  const visibleItemsByParent = useMemo(() => {
    const map = new Map<string, EstimateItem[]>();
    visibleSourceItemsByParent.forEach((list, parentKey) => {
      const visibleList = list.filter((item) => {
        if (item.item_type === "line") {
          return visibleLineIds.has(item.id);
        }
        return visibleSectionIds.has(item.id);
      });
      if (visibleList.length > 0) {
        map.set(parentKey, visibleList);
      }
    });
    return map;
  }, [visibleLineIds, visibleSectionIds, visibleSourceItemsByParent]);

  const getVisibleItems = useCallback(
    (parentId: string | null) => {
      return visibleItemsByParent.get(getParentKey(parentId)) ?? EMPTY_ITEMS;
    },
    [visibleItemsByParent]
  );

  const hasVisibleRows = getVisibleItems(null).length > 0;

  const visibleLineIdList = useMemo(() => {
    return items
      .filter((item) => item.item_type === "line" && visibleLineIds.has(item.id))
      .map((item) => item.id);
  }, [items, visibleLineIds]);

  const visibleItemsInOrder = useMemo(() => {
    const ordered: EstimateItem[] = [];
    const walk = (parentId: string | null) => {
      const list = getVisibleItems(parentId);
      list.forEach((item) => {
        ordered.push(item);
        if (item.item_type === "section") {
          walk(item.id);
        }
      });
    };
    walk(null);
    return ordered;
  }, [getVisibleItems]);

  return {
    itemsByParent,
    depthMap,
    itemById,
    bulkMoveDestinations,
    visibleLineIds,
    visibleSectionIds,
    sectionTotalsById,
    getSectionTotals,
    visibleItemsByParent,
    getVisibleItems,
    hasVisibleRows,
    visibleLineIdList,
    visibleItemsInOrder,
  };
}
