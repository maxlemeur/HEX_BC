"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";

const DEFAULT_ROW_ESTIMATE = 56;
const DEFAULT_OVERSCAN = 8;

export type UseVirtualListOptions = {
  count: number;
  enabled?: boolean;
  estimateSize?: number;
  overscan?: number;
  /**
   * Index of a row that must stay mounted even when it is scrolled out of the
   * rendered window (the row holding keyboard focus, for example). Read at
   * each range computation, so it may come from a ref.
   */
  getPinnedIndex?: () => number | null;
};

export type UseVirtualListResult = {
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualItems: VirtualItem[];
  totalSize: number;
  measureElement: Virtualizer<HTMLDivElement, HTMLDivElement>["measureElement"];
  scrollToIndex: (index: number) => void;
  isVirtualized: boolean;
};

export function useVirtualList({
  count,
  enabled = false,
  estimateSize = DEFAULT_ROW_ESTIMATE,
  overscan = DEFAULT_OVERSCAN,
  getPinnedIndex,
}: UseVirtualListOptions): UseVirtualListResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isVirtualized = enabled && count > 0;
  const getPinnedIndexRef = useRef(getPinnedIndex);
  useEffect(() => {
    getPinnedIndexRef.current = getPinnedIndex;
  }, [getPinnedIndex]);
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    const pinned = getPinnedIndexRef.current?.() ?? null;
    if (pinned === null || pinned < 0 || pinned >= range.count) return indexes;
    if (indexes.includes(pinned)) return indexes;
    indexes.push(pinned);
    indexes.sort((left, right) => left - right);
    return indexes;
  }, []);

  // TanStack Virtual exposes mutable instance functions intentionally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    enabled: isVirtualized,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    rangeExtractor,
    measureElement: (element) => element.getBoundingClientRect().height,
  });
  const scrollToIndex = useCallback(
    (index: number) => {
      if (!isVirtualized || index < 0 || index >= count) return;
      virtualizer.scrollToIndex(index, { align: "auto" });
    },
    [count, isVirtualized, virtualizer]
  );

  return {
    scrollRef,
    virtualItems: isVirtualized ? virtualizer.getVirtualItems() : [],
    totalSize: isVirtualized ? virtualizer.getTotalSize() : 0,
    measureElement: virtualizer.measureElement,
    scrollToIndex,
    isVirtualized,
  };
}
