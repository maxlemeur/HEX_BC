"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { EstimateQualityFilter } from "@/components/estimates/hooks/useEstimateVisibility";
import type { EstimateItem } from "@/lib/estimates/editor-items";

type Options = {
  items: EstimateItem[];
  quickFilteredItems: EstimateItem[];
  itemById: Map<string, EstimateItem>;
  getVisibleItems: (parentId: string | null) => EstimateItem[];
  scrollToItemId?: string | null;
  revealScrollTarget: boolean;
  qualityFilter: EstimateQualityFilter;
  onQualityFilterChange: (filter: EstimateQualityFilter) => void;
  onSearchChange: (value: string) => void;
};

export function useEstimateSectionVisibility({
  items, quickFilteredItems, itemById, getVisibleItems, scrollToItemId, revealScrollTarget,
  qualityFilter, onQualityFilterChange, onSearchChange,
}: Options) {
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set()
  );
  const scrollTargetVisibility = useMemo(() => {
    const ancestorIds: string[] = [];
    let isFilteredOut = false;
    if (revealScrollTarget && scrollToItemId) {
      let cursor = itemById.get(scrollToItemId);
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        const cursorId = cursor.id;
        if (!getVisibleItems(cursor.parent_id).some((item) => item.id === cursorId)) {
          isFilteredOut = true;
        }
        if (!cursor.parent_id) break;
        ancestorIds.push(cursor.parent_id);
        cursor = itemById.get(cursor.parent_id);
      }
    }
    return { ancestorIds, isFilteredOut };
  }, [getVisibleItems, itemById, revealScrollTarget, scrollToItemId]);
  const needsSectionExpansion = scrollTargetVisibility.ancestorIds.some(
    (id) => collapsedSectionIds.has(id)
  );
  const needsScrollTargetReveal = scrollTargetVisibility.isFilteredOut || needsSectionExpansion;
  const isSearchFilteredOut = Boolean(revealScrollTarget && scrollToItemId &&
    itemById.has(scrollToItemId) && !quickFilteredItems.some((item) => item.id === scrollToItemId));

  useEffect(() => {
    if (scrollTargetVisibility.isFilteredOut) {
      // Remove a hiding search first; a matching quality filter can stay active.
      if (isSearchFilteredOut) onSearchChange("");
      else if (qualityFilter !== "all_lines") onQualityFilterChange("all_lines");
    }
    if (needsSectionExpansion) {
      setCollapsedSectionIds((previous) => {
        const next = new Set(previous);
        scrollTargetVisibility.ancestorIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [isSearchFilteredOut, needsSectionExpansion, onQualityFilterChange, onSearchChange, qualityFilter, scrollTargetVisibility]);

  useEffect(() => {
    const sectionIdSet = new Set(
      items.filter((item) => item.item_type === "section").map((item) => item.id)
    );
    setCollapsedSectionIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set<string>();
      previous.forEach((sectionId) => {
        if (sectionIdSet.has(sectionId)) {
          next.add(sectionId);
        }
      });
      return next.size === previous.size ? previous : next;
    });
  }, [items]);

  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setCollapsedSectionIds((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const handleExpandAllSections = useCallback(() => {
    setCollapsedSectionIds(new Set());
  }, []);

  const handleCollapseAllSections = useCallback(() => {
    setCollapsedSectionIds(
      new Set(
        items.filter((item) => item.item_type === "section").map((item) => item.id)
      )
    );
  }, [items]);

  return {
    collapsedSectionIds, needsScrollTargetReveal,
    toggleSectionCollapsed, handleExpandAllSections, handleCollapseAllSections,
  };
}
