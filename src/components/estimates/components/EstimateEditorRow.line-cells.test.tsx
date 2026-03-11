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
  EditableCell: ({ cell, className }: { cell: { rowId: string; columnKey: string }; className?: string }) => (
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
      ref: () => undefined,
      role: "gridcell" as const,
      tabIndex: -1,
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onKeyDown: vi.fn(),
      onMouseDown: vi.fn(),
      onClick: vi.fn(),
      onDoubleClick: vi.fn(),
      "data-testid": "estimate-cell" as const,
      "data-cell-id": `${cell.rowId}::${cell.columnKey}`,
      "data-cell-row-id": cell.rowId,
      "data-cell-column-key": cell.columnKey,
    }),
    getEditorProps: () => ({
      ref: () => undefined,
      tabIndex: -1 as const,
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

function createItem(partial: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id: "line-1",
    version_id: "version-1",
    parent_id: "section-1",
    item_type: "line",
    title: "Ligne test",
    description: null,
    quantity: 1,
    unit_price_ht_cents: 100,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 2,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 100,
    line_total_ht_cents: 100,
    position: 1,
    labor_role_id: "role-1",
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    h_mo_atelier: 1,
    k_mo_atelier: 1.1,
    labor_role_atelier_id: "role-1",
    h_mo_chantier: 1,
    k_mo_chantier: 1.2,
    labor_role_chantier_id: "role-2",
    created_at: new Date().toISOString(),
    ...partial,
  } as EstimateItem;
}

function renderRow(isLaborSplitEnabled: boolean) {
  return render(
    <EstimateEditorRow
      versionId="version-1"
      estimateCurrency="EUR"
      item={createItem()}
      depth={1}
      unitValue="m2"
      supplyTypeValue="Acier"
      qualityFlags={[]}
      detectedOutlierFlags={[]}
      dismissedOutlierFlags={[]}
      supplyTypeById={new Map()}
      laborRoles={[
        {
          id: "role-1",
          tenant_id: "tenant-1",
          user_id: "user-1",
          name: "Poseur",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          hourly_rate_cents: 4500,
          is_active: true,
          position: 1,
        },
        {
          id: "role-2",
          tenant_id: "tenant-1",
          user_id: "user-2",
          name: "Chef",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          hourly_rate_cents: 5200,
          is_active: true,
          position: 2,
        },
      ] as Database["public"]["Tables"]["labor_roles"]["Row"][]}
      isLineSelected={false}
      hasSupplierComparisonMismatch={false}
      sectionTotals={null}
      isDragDisabled
      isOutlierActionPending={false}
      isReadOnly={false}
      hideEditingActions
      isLaborSplitEnabled={isLaborSplitEnabled}
    />
  );
}

describe("EstimateEditorRow line cells", () => {
  it("renders the standard labor cells when labor split is disabled", () => {
    const { container } = renderRow(false);

    expect(container.querySelector('[data-cell-id="line-1::h_mo"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-id="line-1::h_mo_atelier"]')).toBeNull();
    expect(container.querySelectorAll("select.estimate-select")).toHaveLength(1);
  });

  it("renders split labor cells when labor split is enabled", () => {
    const { container } = renderRow(true);

    expect(container.querySelector('[data-cell-id="line-1::h_mo"]')).toBeNull();
    expect(container.querySelector('[data-cell-id="line-1::h_mo_atelier"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-id="line-1::h_mo_chantier"]')).not.toBeNull();
    expect(container.querySelectorAll("select.estimate-select")).toHaveLength(2);
  });
});
