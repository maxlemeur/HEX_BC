import { type VirtualItem } from "@tanstack/react-virtual";
import { act,renderHook,waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import {
useEstimateDndVirtualization,
} from "@/components/estimates/hooks/useEstimateDndVirtualization";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EditorEstimateItem = EstimateItem & { _clientKey?: string };

const mockUseVirtualList = vi.fn();

vi.mock("@/hooks/useVirtualList", () => ({
  useVirtualList: (input: unknown) => mockUseVirtualList(input),
}));

function createItem(partial: Partial<EditorEstimateItem>): EditorEstimateItem {
  return {
    id: "",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    title: "",
    description: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 0,
    line_total_ht_cents: 0,
    position: 0,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    created_at: new Date().toISOString(),
    ...partial,
  } as EstimateItem;
}

function createVirtualItem(index: number, start = index * 56): VirtualItem {
  return {
    key: `virtual-${index}`,
    index,
    start,
    size: 56,
    end: start + 56,
    lane: 0,
  } as VirtualItem;
}

describe("useEstimateDndVirtualization", () => {
  let scrollToIndex: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToIndex = vi.fn();
    mockUseVirtualList.mockReset();
    mockUseVirtualList.mockReturnValue({
      scrollRef: createRef<HTMLDivElement>(),
      virtualItems: [],
      totalSize: 0,
      measureElement: vi.fn(),
      scrollToIndex,
      isVirtualized: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps root sections at root when dragging over another root section", () => {
    const sectionA = createItem({ id: "section-a", item_type: "section", position: 1 });
    const sectionB = createItem({ id: "section-b", item_type: "section", position: 2 });

    const itemsByParent = new Map<string, EstimateItem[]>([["root", [sectionA, sectionB]]]);
    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        maxSectionDepth: 1,
        itemsByParent,
        onReorder,
        onMoveItem,
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map([
          ["section-a", 0],
          ["section-b", 0],
        ]),
        mergedUnitDrafts: {},
        mergedSupplyTypeDrafts: {},
        qualityFlagsByItemId: {},
        suggestionsByItemId: new Map(),
        tableCardRef,
      })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: "section-a", data: { current: { parentId: null } } },
        over: { id: "section-b", data: { current: { parentId: null } } },
      } as never);
    });

    expect(onReorder).toHaveBeenCalledWith(null, ["section-b", "section-a"]);
    expect(onMoveItem).not.toHaveBeenCalled();
  });

  it("allows nesting a root section when depth configuration permits it", () => {
    const sectionA = createItem({ id: "section-a", item_type: "section", position: 1 });
    const sectionB = createItem({ id: "section-b", item_type: "section", position: 2 });

    const itemsByParent = new Map<string, EstimateItem[]>([["root", [sectionA, sectionB]]]);
    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        maxSectionDepth: 2,
        itemsByParent,
        onReorder,
        onMoveItem,
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map([
          ["section-a", 0],
          ["section-b", 0],
        ]),
        mergedUnitDrafts: {},
        mergedSupplyTypeDrafts: {},
        qualityFlagsByItemId: {},
        suggestionsByItemId: new Map(),
        tableCardRef,
      })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: "section-a", data: { current: { parentId: null } } },
        over: { id: "section-b", data: { current: { parentId: null } } },
      } as never);
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(onMoveItem).toHaveBeenCalledWith(
      "section-a",
      null,
      "section-b",
      ["section-b"],
      ["section-a"]
    );
  });

  it("allows dropping a line into a section that already has subsections", () => {
    const sectionRoot = createItem({ id: "section-root", item_type: "section" });
    const sectionChild = createItem({
      id: "section-child",
      item_type: "section",
      parent_id: "section-root",
    });
    const sectionSource = createItem({ id: "section-source", item_type: "section" });
    const lineSource = createItem({
      id: "line-source",
      item_type: "line",
      parent_id: "section-source",
    });

    const itemsByParent = new Map<string, EstimateItem[]>([
      ["root", [sectionRoot, sectionSource]],
      ["section-root", [sectionChild]],
      ["section-source", [lineSource]],
    ]);

    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        maxSectionDepth: 3,
        itemsByParent,
        onReorder,
        onMoveItem,
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map([
          ["section-root", 0],
          ["section-child", 1],
          ["section-source", 0],
          ["line-source", 1],
        ]),
        mergedUnitDrafts: {},
        mergedSupplyTypeDrafts: {},
        qualityFlagsByItemId: {},
        suggestionsByItemId: new Map(),
        tableCardRef,
      })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: "line-source", data: { current: { parentId: "section-source" } } },
        over: { id: "section-root", data: { current: { parentId: null } } },
      } as never);
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(onMoveItem).toHaveBeenCalledWith(
      "line-source",
      "section-source",
      "section-root",
      [],
      ["section-child", "line-source"]
    );
  });

  it("moves a line from chapter to subchapter with exact target parent id", () => {
    const lot = createItem({ id: "lot-1", item_type: "section" });
    const chapter = createItem({
      id: "chapter-1",
      item_type: "section",
      parent_id: "lot-1",
    });
    const subchapter = createItem({
      id: "subchapter-1",
      item_type: "section",
      parent_id: "chapter-1",
    });
    const sourceChapter = createItem({ id: "chapter-source", item_type: "section" });
    const sourceLine = createItem({
      id: "line-source",
      item_type: "line",
      parent_id: "chapter-source",
    });

    const itemsByParent = new Map<string, EstimateItem[]>([
      ["root", [lot, sourceChapter]],
      ["lot-1", [chapter]],
      ["chapter-1", [subchapter]],
      ["chapter-source", [sourceLine]],
      ["subchapter-1", []],
    ]);

    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        maxSectionDepth: 4,
        itemsByParent,
        onReorder,
        onMoveItem,
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map([
          ["lot-1", 0],
          ["chapter-1", 1],
          ["subchapter-1", 2],
          ["chapter-source", 0],
          ["line-source", 1],
        ]),
        mergedUnitDrafts: {},
        mergedSupplyTypeDrafts: {},
        qualityFlagsByItemId: {},
        suggestionsByItemId: new Map(),
        tableCardRef,
      })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: "line-source", data: { current: { parentId: "chapter-source" } } },
        over: { id: "subchapter-1", data: { current: { parentId: "chapter-1" } } },
      } as never);
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(onMoveItem).toHaveBeenCalledWith(
      "line-source",
      "chapter-source",
      "subchapter-1",
      [],
      ["line-source"]
    );
  });

  it("rejects invalid cross-parent drops", () => {
    const rootSection = createItem({ id: "section-root", item_type: "section" });
    const subSection = createItem({
      id: "section-sub",
      item_type: "section",
      parent_id: "section-root",
    });
    const deepSection = createItem({
      id: "section-deep",
      item_type: "section",
      parent_id: "section-sub",
    });
    const rootSectionToMove = createItem({ id: "section-other", item_type: "section" });
    const lineUnderOther = createItem({
      id: "line-under-other",
      item_type: "line",
      parent_id: "section-other",
    });
    const lineUnderSub = createItem({
      id: "line-under-sub",
      item_type: "line",
      parent_id: "section-sub",
    });
    const malformedLineParent = createItem({ id: "line-parent", item_type: "line" });
    const malformedLineChild = createItem({
      id: "line-child",
      item_type: "line",
      parent_id: "line-parent",
    });

    const itemsByParent = new Map<string, EstimateItem[]>([
      ["root", [rootSection, rootSectionToMove, malformedLineParent]],
      ["section-root", [subSection]],
      ["section-sub", [lineUnderSub, deepSection]],
      ["section-other", [lineUnderOther]],
      ["line-parent", [malformedLineChild]],
    ]);

    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        maxSectionDepth: 2,
        itemsByParent,
        onReorder,
        onMoveItem,
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map([
          ["section-root", 0],
          ["section-sub", 1],
          ["section-deep", 2],
          ["section-other", 0],
          ["line-under-sub", 2],
          ["line-under-other", 1],
          ["line-parent", 0],
          ["line-child", 1],
        ]),
        mergedUnitDrafts: {},
        mergedSupplyTypeDrafts: {},
        qualityFlagsByItemId: {},
        suggestionsByItemId: new Map(),
        tableCardRef,
      })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: "section-sub", data: { current: { parentId: "section-root" } } },
        over: {
          id: "line-under-other",
          data: { current: { parentId: "section-other" } },
        },
      } as never);
    });

    act(() => {
      result.current.handleDragEnd({
        active: { id: "section-other", data: { current: { parentId: null } } },
        over: { id: "line-under-sub", data: { current: { parentId: "section-sub" } } },
      } as never);
    });

    act(() => {
      result.current.handleDragEnd({
        active: { id: "line-under-sub", data: { current: { parentId: "section-sub" } } },
        over: { id: "line-child", data: { current: { parentId: "line-parent" } } },
      } as never);
    });

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("keeps pending scroll target until the virtualized row becomes visible", async () => {
    const line1 = createItem({ id: "line-1", item_type: "line" });
    const line2 = createItem({ id: "line-2", item_type: "line" });

    const filteredItemsByParent = new Map<string, EstimateItem[]>([["root", [line1]]]);
    const fullItemsByParent = new Map<string, EstimateItem[]>([["root", [line1, line2]]]);

    mockUseVirtualList.mockReturnValue({
      scrollRef: createRef<HTMLDivElement>(),
      virtualItems: [createVirtualItem(0), createVirtualItem(1)],
      totalSize: 112,
      measureElement: vi.fn(),
      scrollToIndex,
      isVirtualized: true,
    });

    const tableCard = document.createElement("div");
    document.body.appendChild(tableCard);

    const row = document.createElement("div");
    row.setAttribute("data-estimate-item-id", "line-2");
    const scrollIntoView = vi.fn();
    Object.defineProperty(row, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });

    const onScrollToItemHandled = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = tableCard;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { rerender } = renderHook(
      ({ itemsByParent }: { itemsByParent: Map<string, EstimateItem[]> }) =>
        useEstimateDndVirtualization({
          canReorder: true,
          maxSectionDepth: 1,
          itemsByParent,
          onReorder: vi.fn(),
          onMoveItem: vi.fn(),
          hasVisibleRows: true,
          getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
          depthMap: new Map(),
          mergedUnitDrafts: {},
          mergedSupplyTypeDrafts: {},
          qualityFlagsByItemId: {},
          suggestionsByItemId: new Map(),
          virtualization: { enabled: true },
          tableCardRef,
          scrollToItemId: "line-2",
          onScrollToItemHandled,
        }),
      {
        initialProps: {
          itemsByParent: filteredItemsByParent,
        },
      }
    );

    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(onScrollToItemHandled).not.toHaveBeenCalled();

    tableCard.appendChild(row);
    rerender({ itemsByParent: fullItemsByParent });

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1);
    });
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(onScrollToItemHandled).toHaveBeenCalledTimes(1);

    tableCard.remove();
  });
});
