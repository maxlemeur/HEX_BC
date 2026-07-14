import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DndContextProps } from "@dnd-kit/core";
import { type VirtualItem } from "@tanstack/react-virtual";

import { EstimateEditorBody } from "@/components/estimates/components/EstimateEditorBody";
import { type VirtualizedRow } from "@/components/estimates/hooks/useEstimateDndVirtualization";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

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

function buildProps(overrides?: {
  items?: EstimateItem[];
  hasVisibleRows?: boolean;
  isReadOnly?: boolean;
  isVirtualized?: boolean;
  virtualizedSortableIds?: string[];
  virtualItems?: VirtualItem[];
  flattenedRows?: VirtualizedRow[];
  virtualBodyStyle?: CSSProperties;
  renderList?: () => ReactNode;
  renderVirtualRow?: (row: VirtualizedRow) => ReactNode;
  onAddRootSection?: () => void;
  onResetQualityFilter?: () => void;
  onBodyMouseDown?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const onAddRootSection = overrides?.onAddRootSection ?? vi.fn();
  const onResetQualityFilter = overrides?.onResetQualityFilter ?? vi.fn();
  const onBodyMouseDown = overrides?.onBodyMouseDown ?? vi.fn();
  const renderList =
    overrides?.renderList ??
    vi.fn(() => <div data-testid="list-view">list</div>);
  const renderVirtualRow =
    overrides?.renderVirtualRow ??
    vi.fn((row: VirtualizedRow) => (
      <div data-testid={`row-${row.key}`}>{row.key}</div>
    ));

  const flattenedRows =
    overrides?.flattenedRows ??
    [
      {
        key: "item:line-1",
        kind: "item",
        item: createItem({ id: "line-1", item_type: "line", title: "Tube" }),
        depth: 0,
        treeConnectorMeta: {
          depth: 0,
          isLastChild: true,
          ancestorLastChildFlags: [],
          hasVisibleChildren: false,
        },
        unitValue: "u",
        supplyTypeValue: "Tube",
        qualityFlags: [],
      },
    ];

  const props = {
    items: overrides?.items ?? [createItem({ id: "line-1", item_type: "line", title: "Tube" })],
    hasVisibleRows: overrides?.hasVisibleRows ?? true,
    isReadOnly: overrides?.isReadOnly ?? false,
    onAddRootSection,
    onResetQualityFilter,
    sensors: [] as DndContextProps["sensors"],
    onDragEnd: vi.fn(),
    isVirtualized: overrides?.isVirtualized ?? false,
    virtualizedSortableIds: overrides?.virtualizedSortableIds ?? ["line-1"],
    virtualTotalSize: 56,
    virtualItems: overrides?.virtualItems ?? [createVirtualItem(0)],
    flattenedRows,
    measureElement: vi.fn(),
    virtualScrollRef: createRef<HTMLDivElement>(),
    virtualBodyStyle: overrides?.virtualBodyStyle,
    onBodyMouseDown,
    spreadsheetRowCount: 1,
    renderVirtualRow,
    renderList,
  };

  return {
    props,
    onAddRootSection,
    onResetQualityFilter,
    onBodyMouseDown,
    renderList,
    renderVirtualRow,
  };
}

describe("EstimateEditorBody", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders empty state and calls add root section", () => {
    const { props, onAddRootSection } = buildProps({
      items: [],
      hasVisibleRows: false,
      isReadOnly: false,
    });

    render(<EstimateEditorBody {...props} />);

    expect(screen.getByText("Aucune ligne pour le moment.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Creer un lot" }));
    expect(onAddRootSection).toHaveBeenCalledTimes(1);
  });

  it("keeps root-lot creation at the bottom of a populated table", () => {
    const { props, onAddRootSection } = buildProps();
    render(<EstimateEditorBody {...props} />);

    const addLotButton = screen.getByTestId("estimate-editor-add-lot-button");
    expect(
      screen.getByTestId("estimate-editor-add-lot-row")
    ).toContainElement(addLotButton);
    fireEvent.click(addLotButton);
    expect(onAddRootSection).toHaveBeenCalledTimes(1);
  });

  it("renders quality-filter empty state and resets filter", () => {
    const { props, onResetQualityFilter } = buildProps({
      items: [createItem({ id: "line-1", item_type: "line", title: "Tube" })],
      hasVisibleRows: false,
    });

    render(<EstimateEditorBody {...props} />);

    expect(
      screen.getByText("Aucune ligne ne correspond au filtre qualite actif.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Afficher toutes les lignes" }));
    expect(onResetQualityFilter).toHaveBeenCalledTimes(1);
  });

  it("renders virtual rows and delegates mousedown to spreadsheet handler", () => {
    const rows: VirtualizedRow[] = [
      {
        key: "item:line-1",
        kind: "item",
        item: createItem({ id: "line-1", item_type: "line", title: "Tube" }),
        depth: 0,
        treeConnectorMeta: {
          depth: 0,
          isLastChild: true,
          ancestorLastChildFlags: [],
          hasVisibleChildren: false,
        },
        unitValue: "u",
        supplyTypeValue: "Tube",
        qualityFlags: [],
      },
      {
        key: "suggestion:line-1",
        kind: "suggestion",
        item: createItem({ id: "line-1", item_type: "line", title: "Tube" }),
        suggestions: [],
      },
    ];

    const { props, onBodyMouseDown, renderVirtualRow } = buildProps({
      isVirtualized: true,
      virtualBodyStyle: {
        maxHeight: "480px",
        overflowY: "auto",
      },
      virtualizedSortableIds: ["line-1"],
      flattenedRows: rows,
      virtualItems: [createVirtualItem(0), createVirtualItem(1)],
    });

    render(<EstimateEditorBody {...props} />);

    expect(renderVirtualRow).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("row-item:line-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-suggestion:line-1")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("grid", { name: "Lignes de devis" }));
    expect(onBodyMouseDown).toHaveBeenCalledTimes(1);
  });

  it("falls back to nested list rendering when virtualization is disabled", () => {
    const { props, renderList, renderVirtualRow } = buildProps({
      isVirtualized: false,
      hasVisibleRows: true,
    });

    render(<EstimateEditorBody {...props} />);

    expect(renderList).toHaveBeenCalledTimes(1);
    expect(renderVirtualRow).not.toHaveBeenCalled();
    expect(screen.getByTestId("list-view")).toBeInTheDocument();
  });
});
