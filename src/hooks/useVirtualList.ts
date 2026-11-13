"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
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
   * "end" keeps a list scrolled to its end at the end while the rows mounted
   * there are measured larger or smaller than estimated (TanStack's
   * `anchorTo`). Default "start".
   */
  anchorTo?: "start" | "end";
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
   * Drops every measured size, then measures the rows still mounted again,
   * and keeps the row at the top of the viewport where it was. For a content
   * change that alters row heights without remounting the rows. Does nothing
   * when the list is not virtualized.
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
  anchorTo,
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
  if (anchorTo !== undefined) options.anchorTo = anchorTo;
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
  // Scroll offset restored by remeasure(), written once the rows laid out
  // with the new sizes are in the DOM, so the browser does not clamp it to the
  // previous scroll height.
  const pendingScrollTopRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const target = pendingScrollTopRef.current;
    const element = scrollRef.current;
    if (target === null || !element) return;
    pendingScrollTopRef.current = null;
    if (Math.abs(element.scrollTop - target) >= 1) element.scrollTop = target;
  });
  const remeasure = useCallback(() => {
    if (!isVirtualized) return;
    const offset = virtualizer.scrollOffset ?? 0;
    const anchor = offset > 0 ? virtualizer.getVirtualItemForOffset(offset) : undefined;
    // No per-row scroll correction while every size is reset: the offsets of
    // the old and the new layout do not compare. The anchor is restored below.
    const { options: currentOptions } = virtualizer;
    const anchorToBefore = currentOptions.anchorTo;
    const shouldAdjustBefore = virtualizer.shouldAdjustScrollPositionOnItemSizeChange;
    currentOptions.anchorTo = "start";
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
    try {
      virtualizer.measure();
      // Rebuild the layout from the estimates before reading the mounted rows:
      // each one whose real height differs from its estimate is then recorded,
      // whether its height changed or not. Their refs are not called again
      // while they stay mounted, an unchanged row gets no ResizeObserver entry,
      // and measureElement() skips rows while the list is scrolling: resize
      // them directly.
      virtualizer.getTotalSize();
      virtualizer.elementsCache.forEach((element) => {
        if (!element.isConnected) return;
        virtualizer.resizeItem(
          virtualizer.indexFromElement(element),
          virtualizer.options.measureElement(element, undefined, virtualizer)
        );
      });
    } finally {
      currentOptions.anchorTo = anchorToBefore;
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = shouldAdjustBefore;
    }
    if (!anchor) return;
    const totalSize = virtualizer.getTotalSize();
    const start = virtualizer.measurementsCache[anchor.index]?.start;
    if (start === undefined) return;
    const viewport = scrollRef.current?.clientHeight ?? 0;
    const target = Math.max(0, Math.min(start + offset - anchor.start, totalSize - viewport));
    // The next render computes its window at the restored offset; the DOM
    // scroll follows in the layout effect above.
    virtualizer.scrollOffset = target;
    pendingScrollTopRef.current = target;
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
