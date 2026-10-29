import { act,renderHook } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach,describe,expect,it,vi } from "vitest";

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

describe("useEstimateDndVirtualization", () => {
  beforeEach(() => {
    mockUseVirtualList.mockReset();
    mockUseVirtualList.mockReturnValue({
      scrollRef: createRef<HTMLDivElement>(),
      virtualItems: [],
      totalSize: 0,
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
      isVirtualized: false,
    });
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
});
