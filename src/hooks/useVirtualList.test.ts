// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useVirtualList } from "@/hooks/useVirtualList";

// The paste preview table (PastePreviewRowsTable) needs per-row estimates, a
// header offset, a first window before the scroll element is measured and a
// layout-based row measurement that ignores the dialog's zoom-in transform.
// The existing callers keep the defaults, which these tests pin as well.

const INITIAL_RECT = { width: 0, height: 430 };

function measuredRow(index: number) {
  const node = document.createElement("div");
  node.setAttribute("data-index", String(index));
  document.body.appendChild(node);
  return node;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("useVirtualList", () => {
  it("uses a per-index estimate before any measurement, and still accepts a number", () => {
    const estimate = (index: number) => (index % 2 === 0 ? 120 : 64);
    const perIndex = renderHook(() =>
      useVirtualList({ count: 200, enabled: true, estimateSize: estimate, initialRect: INITIAL_RECT }));
    const items = perIndex.result.current.virtualItems;
    expect(items.length).toBeGreaterThan(2);
    for (const item of items) expect(item.size).toBe(estimate(item.index));

    const constant = renderHook(() =>
      useVirtualList({ count: 200, enabled: true, estimateSize: 30, initialRect: INITIAL_RECT }));
    expect(constant.result.current.virtualItems.length).toBeGreaterThan(2);
    expect(constant.result.current.virtualItems.every((item) => item.size === 30)).toBe(true);
  });

  it("offsets the first item by paddingStart and includes it in the total size", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 10, enabled: true, estimateSize: 64, paddingStart: 97, initialRect: INITIAL_RECT }));
    expect(result.current.virtualItems[0]).toMatchObject({ index: 0, start: 97, end: 161 });
    expect(result.current.totalSize).toBe(97 + 640);
  });

  it("renders a first window from initialRect without any measured scroll element", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 2161, enabled: true, estimateSize: 64, overscan: 8, initialRect: INITIAL_RECT }));
    const indexes = result.current.virtualItems.map((item) => item.index);
    // 430 px / 64 px is 7 visible rows, plus 8 overscan after them.
    expect(indexes[0]).toBe(0);
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.length).toBeLessThanOrEqual(40);
  });

  it("measures with the layout box when asked, and with the bounding rect by default", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 61, width: 100, height: 61, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);

    const layout = renderHook(() =>
      useVirtualList({ count: 20, enabled: true, estimateSize: 50, measure: "layout", initialRect: INITIAL_RECT }));
    act(() => layout.result.current.measureElement(measuredRow(0)));
    layout.rerender();
    expect(layout.result.current.virtualItems[0].size).toBe(64);

    const fallback = renderHook(() =>
      useVirtualList({ count: 20, enabled: true, estimateSize: 50, initialRect: INITIAL_RECT }));
    act(() => fallback.result.current.measureElement(measuredRow(0)));
    fallback.rerender();
    expect(fallback.result.current.virtualItems[0].size).toBe(61);
  });

  it("re-measures only when virtualized: detached rows return to their estimate, mounted rows are read again", () => {
    const disabled = renderHook(() => useVirtualList({ count: 20, enabled: false, initialRect: INITIAL_RECT }));
    expect(() => act(() => disabled.result.current.remeasure())).not.toThrow();
    expect(disabled.result.current.virtualItems).toEqual([]);

    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(64);
    const { result, rerender } = renderHook(() =>
      useVirtualList({ count: 20, enabled: true, estimateSize: 50, measure: "layout", initialRect: INITIAL_RECT }));
    const first = measuredRow(0);
    const second = measuredRow(1);
    act(() => {
      result.current.measureElement(first);
      result.current.measureElement(second);
    });
    rerender();
    expect(result.current.virtualItems.slice(0, 2).map((item) => item.size)).toEqual([64, 64]);

    // A mapping change makes the mounted row 80 px; the row that left the DOM
    // must not keep its stale 64 px measurement.
    height.mockReturnValue(80);
    second.remove();
    act(() => result.current.remeasure());
    rerender();
    expect(result.current.virtualItems.slice(0, 2).map((item) => item.size)).toEqual([80, 50]);
  });

  it("keeps a pinned index mounted in sorted order when it lies outside the window", () => {
    const { result } = renderHook(() =>
      useVirtualList({
        count: 2161, enabled: true, estimateSize: 64, overscan: 8, initialRect: INITIAL_RECT,
        getPinnedIndex: () => 1500,
      }));
    const indexes = result.current.virtualItems.map((item) => item.index);
    expect(indexes.at(-1)).toBe(1500);
    expect(indexes.slice(0, -1).every((index) => index < 30)).toBe(true);
    expect([...indexes].sort((left, right) => left - right)).toEqual(indexes);
  });
});
