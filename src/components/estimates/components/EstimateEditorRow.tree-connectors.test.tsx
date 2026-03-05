import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EstimateEditorRow } from "@/components/estimates/components/EstimateEditorRow";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock("@/components/estimates/EditableCell", () => ({
  EditableCell: ({ className, cell }: { className?: string; cell: { rowId: string; columnKey: string } }) => (
    <div
      role="gridcell"
      className={className}
      data-cell-id={`${cell.rowId}::${cell.columnKey}`}
    />
  ),
}));

vi.mock("@/components/takeoff/TakeoffSourceBadge", () => ({
  TakeoffSourceBadge: () => null,
}));

vi.mock("@/components/estimates/context/EstimateSpreadsheetContext", () => ({
  useEstimateSpreadsheetNavigation: () => ({
    getCellProps: (cell: { rowId: string; columnKey: string }) => ({
      tabIndex: -1,
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onKeyDown: vi.fn(),
      "data-cell-id": `${cell.rowId}::${cell.columnKey}`,
    }),
    getEditorProps: () => ({
      ref: () => undefined,
      tabIndex: -1,
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onKeyDown: vi.fn(),
    }),
    isCellActive: () => false,
    isCellEditing: () => false,
  }),
}));

vi.mock("@/components/estimates/context/EstimateEditorRowActionsContext", () => ({
  useEstimateEditorRowActions: () => ({
    onDeleteItem: vi.fn(),
    onOpenSupplierComparisonPanel: vi.fn(),
    onOpenSupplierComparisonContextMenu: vi.fn(),
    onOpenSectionContextMenu: vi.fn(),
    onPatchItem: vi.fn(),
    onUnitChange: vi.fn(),
    onUnitCommit: vi.fn(),
    onSupplyTypeChange: vi.fn(),
    onSupplyTypeCommit: vi.fn(),
    onAddLine: vi.fn(),
    onAddSection: vi.fn(),
    onConvertLineToSection: vi.fn(),
    onToggleOutlierDismiss: vi.fn(),
    onLineSelectionInteraction: vi.fn(),
  }),
}));

function createItem(partial: Partial<EstimateItem>): EstimateItem {
  return {
    id: "line-1",
    version_id: "version-1",
    parent_id: "parent-1",
    item_type: "line",
    title: "Ligne test",
    description: null,
    quantity: 1,
    unit_price_ht_cents: 100,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 100,
    line_total_ht_cents: 100,
    position: 1,
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

describe("EstimateEditorRow tree connectors", () => {
  it("renders generic connector segments for depth 3 lines", () => {
    const { container } = render(
      <EstimateEditorRow
        versionId="version-1"
        estimateCurrency="EUR"
        item={createItem({ id: "line-deep", parent_id: "subchapter-1" })}
        depth={3}
        unitValue="u"
        supplyTypeValue=""
        qualityFlags={[]}
        detectedOutlierFlags={[]}
        dismissedOutlierFlags={[]}
        supplyTypeById={new Map()}
        laborRoles={[]}
        isLineSelected={false}
        hasSupplierComparisonMismatch={false}
        sectionTotals={null}
        isDragDisabled
        isOutlierActionPending={false}
        isReadOnly
        hideEditingActions
        isLaborSplitEnabled={false}
        treeConnectorMeta={{
          depth: 3,
          isLastChild: true,
          ancestorLastChildFlags: [false, true, false],
          hasVisibleChildren: false,
        }}
      />
    );

    const connectors = container.querySelector(".estimate-tree-connectors");
    expect(connectors).not.toBeNull();
    expect(connectors?.querySelectorAll(".estimate-tree-segment--v")).toHaveLength(2);
    expect(connectors?.querySelectorAll(".estimate-tree-segment--h")).toHaveLength(1);

    const horizontalSegment = connectors?.querySelector<HTMLElement>(".estimate-tree-segment--h");
    expect(horizontalSegment?.style.left).toBe(
      "calc(2 * var(--tree-indent) + var(--tree-offset))"
    );
  });
});
