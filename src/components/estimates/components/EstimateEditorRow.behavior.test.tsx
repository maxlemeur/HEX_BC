import { type ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EstimateEditorRow,
  getSpreadsheetColumnKeys,
} from "@/components/estimates/components/EstimateEditorRow";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

const rowActionSpies = {
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
};

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
  EditableCell: ({
    cell,
    className,
  }: {
    cell: { rowId: string; columnKey: string };
    className?: string;
  }) => (
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
      ref: vi.fn(),
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
      ref: vi.fn(),
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
  useEstimateEditorRowActions: () => rowActionSpies,
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

function renderRow(
  item: EstimateItem,
  overrides?: Partial<ComponentProps<typeof EstimateEditorRow>>
) {
  return render(
    <EstimateEditorRow
      versionId="version-1"
      estimateCurrency="EUR"
      item={item}
      depth={1}
      unitValue="u"
      supplyTypeValue=""
      qualityFlags={[]}
      detectedOutlierFlags={[]}
      dismissedOutlierFlags={[]}
      supplyTypeById={new Map()}
      laborRoles={[
        {
          id: "role-1",
          name: "Main d'oeuvre",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tenant_id: "tenant-1",
          user_id: "user-1",
          hourly_rate_cents: 4200,
          position: 1,
        },
      ]}
      isLineSelected={false}
      hasSupplierComparisonMismatch={false}
      sectionTotals={null}
      isDragDisabled
      isOutlierActionPending={false}
      isReadOnly={false}
      hideEditingActions={false}
      isLaborSplitEnabled={false}
      {...overrides}
    />
  );
}

describe("EstimateEditorRow behavior", () => {
  beforeEach(() => {
    Object.values(rowActionSpies).forEach((spy) => spy.mockReset());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps getSpreadsheetColumnKeys public contract stable", () => {
    expect(getSpreadsheetColumnKeys("section", false)).toEqual(["title"]);
    expect(getSpreadsheetColumnKeys("line", false)).toEqual([
      "title",
      "quantity",
      "unit",
      "unit_price",
      "supply_type",
      "k_fo",
      "h_mo",
      "h_mo_majoration",
      "labor_role",
      "k_mo",
      "pu_ht",
      "line_total_ht",
    ]);
    expect(getSpreadsheetColumnKeys("line", true)).toEqual([
      "title",
      "quantity",
      "unit",
      "unit_price",
      "supply_type",
      "k_fo",
      "h_mo_majoration",
      "h_mo_atelier",
      "labor_role_atelier",
      "k_mo_atelier",
      "h_mo_chantier",
      "labor_role_chantier",
      "k_mo_chantier",
      "pu_ht",
      "line_total_ht",
    ]);
  });

  it("preserves section actions through the public row component", () => {
    const sectionItem = createItem({
      id: "section-1",
      item_type: "section",
      title: "Lot",
      parent_id: null,
    });

    renderRow(sectionItem, {
      itemNumber: "1",
      sectionTotals: {
        foTotalCents: 1000,
        moTotalCents: 2000,
        moAtelierTotalCents: 0,
        moChantierTotalCents: 0,
        totalHtCents: 3000,
        totalTtcCents: 3600,
        supplyTypeFoTotalsCents: {},
      },
      onToggleSectionCollapsed: vi.fn(),
    });

    const row = screen.getByTestId("estimate-section-row");
    fireEvent.click(screen.getByTestId("estimate-section-quick-actions-trigger"));
    fireEvent.click(screen.getByTestId("estimate-section-add-line-button"));
    fireEvent.click(screen.getByTestId("estimate-section-add-section-button"));
    fireEvent.click(screen.getByTestId("estimate-section-add-aid-button"));
    fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    expect(rowActionSpies.onAddLine).toHaveBeenCalledWith("section-1");
    expect(rowActionSpies.onAddSection).toHaveBeenCalledWith("section-1");
    expect(rowActionSpies.onOpenSectionContextMenu).toHaveBeenCalledWith("section-1", {
      x: 10,
      y: 20,
    });
  });

  it("renders standard and labor split variants with distinct cell controls", () => {
    const { container, rerender } = renderRow(createItem({ id: "line-standard" }));

    expect(container.querySelectorAll("select.estimate-select")).toHaveLength(1);
    expect(container.querySelectorAll('input[placeholder="0.0"]')).toHaveLength(1);

    rerender(
      <EstimateEditorRow
        versionId="version-1"
        estimateCurrency="EUR"
        item={createItem({ id: "line-split" })}
        depth={1}
        unitValue="u"
        supplyTypeValue=""
        qualityFlags={[]}
        detectedOutlierFlags={[]}
        dismissedOutlierFlags={[]}
        supplyTypeById={new Map()}
        laborRoles={[
          {
            id: "role-1",
            name: "Main d'oeuvre",
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            tenant_id: "tenant-1",
            user_id: "user-1",
            hourly_rate_cents: 4200,
            position: 1,
          },
        ]}
        isLineSelected={false}
        hasSupplierComparisonMismatch={false}
        sectionTotals={null}
        isDragDisabled
        isOutlierActionPending={false}
        isReadOnly={false}
        hideEditingActions={false}
        isLaborSplitEnabled
      />
    );

    expect(container.querySelectorAll("select.estimate-select")).toHaveLength(2);
    expect(container.querySelectorAll('input[placeholder="0.0"]')).toHaveLength(2);
  });

  it("keeps metadata below the title and its compact AID action", () => {
    const { container } = renderRow(
      createItem({
        id: "line-responsive-designation",
      })
    );

    const titleInput = screen.getByTestId("estimate-line-title-input");
    const primaryRow = container.querySelector(
      ".estimate-line-designation__primary"
    );
    const supportRow = container.querySelector(
      ".estimate-line-designation__support"
    );
    const truthBadges = Array.from(
      container.querySelectorAll(".estimate-line-truth__badge")
    );
    const truthGroup = screen.getByTestId("estimate-line-truth");
    const addAidButton = screen.getByTestId("estimate-line-add-aid-button");

    expect(primaryRow).toContainElement(titleInput);
    expect(supportRow).not.toContainElement(titleInput);
    expect(primaryRow).toContainElement(addAidButton);
    expect(supportRow).not.toContainElement(addAidButton);
    expect(truthBadges).toHaveLength(3);
    truthBadges.forEach((badge) => {
      expect(badge).toHaveClass("estimate-line-truth__badge");
    });
    expect(
      within(truthGroup).getByText("Saisie manuelle", { selector: ".sr-only" })
    ).toBeInTheDocument();
    expect(
      within(truthGroup).getByText("Qte supposee", { selector: ".sr-only" })
    ).toBeInTheDocument();
    expect(
      within(truthGroup).getByText("Confiance moyenne", {
        selector: ".sr-only",
      })
    ).toBeInTheDocument();
  });

  it("loads catalogue suggestions and applies the highlighted suggestion on Enter", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          suggestions: [
            {
              supplier_price_id: "price-1",
              product_id: "product-1",
              product_designation: "Produit catalogue",
              product_reference: "REF-1",
              supplier_id: "supplier-1",
              supplier_name: "Supplier A",
              supplier_reference: "SUP-1",
              unit: "u",
              unit_price_cents: 1234,
              adjusted_unit_price_cents: 1234,
              currency: "EUR",
              updated_at: "2026-03-11T00:00:00.000Z",
              is_stale: false,
              stale_days: 0,
              relevance_score: 0.9,
              has_material_index_adjustment: false,
              material_index_code: null,
              material_index_value: null,
              catalogue_url: null,
              alternatives: [],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRow(
      createItem({
        id: "line-catalogue",
        title: "Tube acier",
      })
    );

    const titleInput = screen.getAllByTestId("estimate-line-title-input").at(-1);
    expect(titleInput).toBeDefined();
    if (!titleInput) {
      throw new Error("Expected line title input");
    }
    fireEvent.focus(titleInput);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Supplier A")).toBeInTheDocument();

    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() => {
      expect(rowActionSpies.onPatchItem).toHaveBeenCalledWith(
        "line-catalogue",
        expect.objectContaining({
          description: "Produit catalogue",
          unit_price_ht_cents: 1234,
          selected_supplier_price_id: "price-1",
        }),
        { persist: true }
      );
    });
  });
});
