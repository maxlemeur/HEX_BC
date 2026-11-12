"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
  type Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";

const DEFAULT_ROW_ESTIMATE = 56;
const DEFAULT_OVERSCAN = 8;

export type UseVirtualListOptions = {
  count: number;
  enabled?: boolean;
  /**
   * Row height before measurement: one value for every row, or one per index.
   * The virtualizer reads it again only when the count, the padding or
   * `enabled` changes, or after `remeasure()`; a new function identity alone
   * does not refresh the estimates.
   */
  estimateSize?: number | ((index: number) => number);
  overscan?: number;
  /** Space before the first row inside the scroll element (a header, for example). */
  paddingStart?: number;
  /** Scroll element size assumed until it is measured, so the first render has a window. */
  initialRect?: { width: number; height: number };
  /**
   * How a mounted row is measured. "boundingRect" (default) reads
   * getBoundingClientRect, which a CSS transform scales. "layout" uses
   * TanStack's default: the ResizeObserver border box, the cached size, then
   * offsetHeight, none of which a transform such as a dialog's zoom-in changes.
   */
  measure?: "boundingRect" | "layout";
  /**
   * Index of a row that must stay mounted even when it is scrolled out of the
   * rendered window (the row holding keyboard focus, for example). Read at
   * each range computation, so it may come from a ref.
   */
  getPinnedIndex?: () => number | null;
};

export type UseVirtualListResult<TItem extends Element = HTMLDivElement> = {
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualItems: VirtualItem[];
  totalSize: number;
  measureElement: Virtualizer<HTMLDivElement, TItem>["measureElement"];
  scrollToIndex: (index: number) => void;
  /**
   * Drops every measured size, then measures the rows still mounted again.
   * For a content change that alters row heights without remounting the rows.
   * Does nothing when the list is not virtualized.
   */
  remeasure: () => void;
  isVirtualized: boolean;
};

const measureWithBoundingRect = (element: Element) => element.getBoundingClientRect().height;

export function useVirtualList<TItem extends Element = HTMLDivElement>({
  count,
  enabled = false,
  estimateSize = DEFAULT_ROW_ESTIMATE,
  overscan = DEFAULT_OVERSCAN,
  paddingStart,
  initialRect,
  measure = "boundingRect",
  getPinnedIndex,
}: UseVirtualListOptions): UseVirtualListResult<TItem> {
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

  const options: Omit<
    VirtualizerOptions<HTMLDivElement, TItem>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  > = {
    count,
    enabled: isVirtualized,
    getScrollElement: () => scrollRef.current,
    estimateSize: typeof estimateSize === "function" ? estimateSize : () => estimateSize,
    overscan,
    rangeExtractor,
  };
  if (paddingStart !== undefined) options.paddingStart = paddingStart;
  if (initialRect !== undefined) options.initialRect = initialRect;
  // "layout" leaves the key out so TanStack's own measurement applies.
  if (measure === "boundingRect") options.measureElement = measureWithBoundingRect;

  // TanStack Virtual exposes mutable instance functions intentionally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, TItem>(options);
  const scrollToIndex = useCallback(
    (index: number) => {
      if (!isVirtualized || index < 0 || index >= count) return;
      virtualizer.scrollToIndex(index, { align: "auto" });
    },
    [count, isVirtualized, virtualizer]
  );
  const remeasure = useCallback(() => {
    if (!isVirtualized) return;
    virtualizer.measure();
    // The row refs are not called again for rows that stay mounted, and a row
    // whose height did not change gets no ResizeObserver entry: read them now.
    virtualizer.elementsCache.forEach((element) => {
      if (element.isConnected) virtualizer.measureElement(element);
    });
  }, [isVirtualized, virtualizer]);

  return {
    scrollRef,
    virtualItems: isVirtualized ? virtualizer.getVirtualItems() : [],
    totalSize: isVirtualized ? virtualizer.getTotalSize() : 0,
    measureElement: virtualizer.measureElement,
    scrollToIndex,
    remeasure,
    isVirtualized,
  };
}
