"use client";

import { useCallback, useRef, type RefObject } from "react";
import {
  useVirtualizer,
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
}: UseVirtualListOptions): UseVirtualListResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isVirtualized = enabled && count > 0;

  // TanStack Virtual exposes mutable instance functions intentionally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    enabled: isVirtualized,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
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
