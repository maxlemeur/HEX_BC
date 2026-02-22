import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { type VirtualItem } from "@tanstack/react-virtual";

import {
  useEstimateDndVirtualization,
} from "@/components/estimates/hooks/useEstimateDndVirtualization";
import { type SuggestionPreview } from "@/components/estimates/components/EstimateSuggestionRow";
import { type SpreadsheetCell } from "@/hooks/useSpreadsheetNavigation";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

const mockUseVirtualList = vi.fn();

vi.mock("@/hooks/useVirtualList", () => ({
  useVirtualList: (input: unknown) => mockUseVirtualList(input),
}));

function createItem(partial: Partial<EstimateItem>): EstimateItem {
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

function createSuggestion(ruleId: string): SuggestionPreview {
  return {
    rule: {
      id: ruleId,
      name: `Rule ${ruleId}`,
      unit: "u",
      category_id: null,
      labor_role_id: null,
      k_fo: null,
      k_mo: null,
    } as unknown as SuggestionPreview["rule"],
    score: 1,
    matchKind: "partial",
    matchedKeyword: "tube",
    usageCount: 1,
    parts: ["Type FO: Tube"],
  };
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

  it("flattens virtual rows and exposes sortable item ids", () => {
    const section = createItem({ id: "section-1", item_type: "section", title: "Chapitre" });
    const line = createItem({
      id: "line-1",
      item_type: "line",
      parent_id: "section-1",
      title: "Tube acier",
    });
    const rootLine = createItem({ id: "line-2", item_type: "line", title: "Fixations" });

    const itemsByParent = new Map<string, EstimateItem[]>([
      ["root", [section, rootLine]],
      ["section-1", [line]],
    ]);

    mockUseVirtualList.mockReturnValue({
      scrollRef: createRef<HTMLDivElement>(),
      virtualItems: [
        createVirtualItem(0),
        createVirtualItem(1),
        createVirtualItem(2),
        createVirtualItem(3),
      ],
      totalSize: 224,
      measureElement: vi.fn(),
      scrollToIndex,
      isVirtualized: true,
    });

    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        itemsByParent,
        onReorder: vi.fn(),
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map([
          ["section-1", 0],
          ["line-1", 1],
          ["line-2", 0],
        ]),
        mergedUnitDrafts: { "line-1": "u", "line-2": "ml" },
        mergedSupplyTypeDrafts: { "line-1": "Tube", "line-2": "Fixation" },
        qualityFlagsByItemId: { "line-1": ["missing_price"] },
        suggestionsByItemId: new Map([["line-1", [createSuggestion("rule-1")]]]),
        virtualization: {
          enabled: true,
          rowEstimate: 56,
          overscan: 4,
          maxHeight: 480,
        },
        tableCardRef,
      })
    );

    expect(mockUseVirtualList).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 4,
        enabled: true,
        estimateSize: 56,
        overscan: 4,
      })
    );

    expect(result.current.flattenedRows.map((row) => row.key)).toEqual([
      "item:section-1",
      "item:line-1",
      "suggestion:line-1",
      "item:line-2",
    ]);
    expect(result.current.virtualizedSortableIds).toEqual([
      "section-1",
      "line-1",
      "line-2",
    ]);
    expect(result.current.virtualBodyStyle).toMatchObject({
      maxHeight: "480px",
      overflowY: "auto",
    });
  });

  it("reorders only siblings sharing the same parent", () => {
    const line1 = createItem({ id: "line-1", item_type: "line" });
    const line2 = createItem({ id: "line-2", item_type: "line" });
    const line3 = createItem({ id: "line-3", item_type: "line" });
    const childA = createItem({ id: "child-a", item_type: "line", parent_id: "section-1" });

    const itemsByParent = new Map<string, EstimateItem[]>([
      ["root", [line1, line2, line3]],
      ["section-1", [childA]],
    ]);

    const onReorder = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        itemsByParent,
        onReorder,
        hasVisibleRows: true,
        getVisibleItems: (parentId) => itemsByParent.get(parentId ?? "root") ?? [],
        depthMap: new Map(),
        mergedUnitDrafts: {},
        mergedSupplyTypeDrafts: {},
        qualityFlagsByItemId: {},
        suggestionsByItemId: new Map(),
        tableCardRef,
      })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: "line-2", data: { current: { parentId: null } } },
        over: { id: "line-3", data: { current: { parentId: null } } },
      } as never);
    });

    expect(onReorder).toHaveBeenCalledWith(null, ["line-1", "line-3", "line-2"]);

    act(() => {
      result.current.handleDragEnd({
        active: { id: "child-a", data: { current: { parentId: "section-1" } } },
        over: { id: "line-1", data: { current: { parentId: null } } },
      } as never);
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it("scrolls to target row in virtual mode and handles keyboard navigation fallback", async () => {
    const line1 = createItem({ id: "line-1", item_type: "line" });
    const line2 = createItem({ id: "line-2", item_type: "line" });

    const itemsByParent = new Map<string, EstimateItem[]>([["root", [line1, line2]]]);

    mockUseVirtualList.mockReturnValue({
      scrollRef: createRef<HTMLDivElement>(),
      virtualItems: [createVirtualItem(0), createVirtualItem(1)],
      totalSize: 112,
      measureElement: vi.fn(),
      scrollToIndex,
      isVirtualized: true,
    });

    const tableCard = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-estimate-item-id", "line-2");
    const scrollIntoView = vi.fn();
    Object.defineProperty(row, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });
    tableCard.appendChild(row);
    document.body.appendChild(tableCard);

    const onScrollToItemHandled = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = tableCard;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { result } = renderHook(() =>
      useEstimateDndVirtualization({
        canReorder: true,
        itemsByParent,
        onReorder: vi.fn(),
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
      })
    );

    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenCalledWith(1);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(onScrollToItemHandled).toHaveBeenCalledTimes(1);

    const missingCell: SpreadsheetCell = {
      rowId: "line-1",
      columnKey: "title",
    };

    act(() => {
      result.current.handleNavigationCellNotMounted(missingCell);
    });

    expect(scrollToIndex).toHaveBeenCalledWith(0);
    tableCard.remove();
  });
});
