import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorRow } from "@/components/estimates/components/EstimateEditorRow";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

const onPatchItem = vi.fn();

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
    onPatchItem,
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
    title: "Tube acier",
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

describe("EstimateEditorRow catalogue suggestions", () => {
  beforeEach(() => {
    onPatchItem.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            query: "Tube acier",
            stale_price_days: 30,
            suggestions: [
              {
                price_source: "supplier",
                supplier_price_id: "price-1",
                product_id: "product-1",
                product_designation: "Tube acier galvanise",
                product_reference: "TUBE-1",
                supplier_id: "supplier-1",
                supplier_name: "Fournisseur A",
                supplier_reference: "REF-1",
                unit: "m",
                unit_price_cents: 1200,
                adjusted_unit_price_cents: 1234,
                currency: "EUR",
                updated_at: "2026-03-10T12:00:00.000Z",
                is_stale: false,
                stale_days: 0,
                relevance_score: 0.9,
                has_material_index_adjustment: false,
                material_index_code: null,
                material_index_value: null,
                catalogue_url: null,
                supplier_offer_count: 1,
                alternatives: [],
              },
            ],
          },
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads suggestions and applies the active one with Enter", async () => {
    render(
      <EstimateEditorRow
        versionId="version-1"
        estimateCurrency="EUR"
        item={createItem()}
        depth={1}
        unitValue="m"
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
        isReadOnly={false}
        hideEditingActions
        isLaborSplitEnabled={false}
      />
    );

    const titleInput = screen.getByTestId("estimate-line-title-input");
    fireEvent.focus(titleInput);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(titleInput, { key: "Enter" });

    expect(onPatchItem).toHaveBeenCalledWith(
      "line-1",
      expect.objectContaining({
        description: "Tube acier galvanise",
        selected_supplier_price_id: "price-1",
        unit_price_ht_cents: 1234,
      }),
      { persist: true }
    );
  }, 10000);

  it("applies a product reference price without keeping an old supplier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            query: "Rouge",
            stale_price_days: 30,
            suggestions: [
              {
                price_source: "reference",
                supplier_price_id: null,
                product_id: "product-red",
                product_designation: "Rouge",
                product_reference: null,
                supplier_id: null,
                supplier_name: null,
                supplier_reference: null,
                unit: "u",
                unit_price_cents: 2000,
                adjusted_unit_price_cents: 2000,
                currency: null,
                updated_at: "2026-08-20T19:34:27.442333Z",
                is_stale: false,
                stale_days: 30,
                relevance_score: 100,
                has_material_index_adjustment: false,
                material_index_code: null,
                material_index_value: null,
                catalogue_url: null,
                supplier_offer_count: 0,
                alternatives: [],
              },
            ],
          },
        }),
      }),
    );

    render(
      <EstimateEditorRow
        versionId="version-1"
        estimateCurrency="EUR"
        item={
          createItem({
            title: "Rouge",
            selected_supplier_price_id: "old-price",
          })
        }
        depth={1}
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
        isReadOnly={false}
        hideEditingActions
        isLaborSplitEnabled={false}
      />
    );

    const titleInput = screen.getByTestId("estimate-line-title-input");
    fireEvent.focus(titleInput);
    expect(await screen.findByText("Sans offre fournisseur")).toBeInTheDocument();

    fireEvent.keyDown(titleInput, { key: "Enter" });

    expect(onPatchItem).toHaveBeenCalledWith(
      "line-1",
      expect.objectContaining({
        description: "Rouge",
        selected_supplier_price_id: null,
        unit_price_ht_cents: 2000,
      }),
      { persist: true },
    );
  }, 10000);
});
