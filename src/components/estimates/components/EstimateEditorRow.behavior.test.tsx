import { type ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EstimateEditorRow,
} from "@/components/estimates/components/EstimateEditorRow";
import { getEstimateEditorItemClientKey } from "@/lib/estimates/editor-items";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EditorEstimateItem = EstimateItem & { _clientKey?: string };

const rowActionSpies = {
  onDeleteItem: vi.fn(),
  onOpenArticle: vi.fn(),
  onAssociateArticle: vi.fn(),
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
    type,
    inputMode,
    value,
  }: {
    cell: { rowId: string; columnKey: string };
    className?: string;
    type?: string;
    inputMode?: string;
    value?: string | number | null;
  }) => (
    <div
      role="gridcell"
      className={className}
      data-cell-id={`${cell.rowId}::${cell.columnKey}`}
      data-input-type={type}
      data-input-mode={inputMode}
      data-input-value={String(value ?? "")}
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

function createItem(partial: Partial<EditorEstimateItem>): EditorEstimateItem {
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

function createRowNode(
  item: EditorEstimateItem,
  overrides?: Partial<ComponentProps<typeof EstimateEditorRow>>
) {
  return (
    <EstimateEditorRow
      key={getEstimateEditorItemClientKey(item)}
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

function renderRow(
  item: EditorEstimateItem,
  overrides?: Partial<ComponentProps<typeof EstimateEditorRow>>
) {
  return render(createRowNode(item, overrides));
}

describe("EstimateEditorRow behavior", () => {
  beforeEach(() => {
    Object.values(rowActionSpies).forEach((spy) => spy.mockReset());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps the title editor mounted and focused when the server id replaces the temp id", () => {
    const clientKey = "tmp:line-client";
    const optimisticItem = createItem({
      id: clientKey,
      _clientKey: clientKey,
      title: "Nouvelle ligne",
    });
    const { rerender } = renderRow(optimisticItem);
    const titleInput = screen.getByTestId(
      "estimate-line-title-input",
    ) as HTMLInputElement;

    titleInput.focus();
    expect(titleInput).toHaveFocus();

    rerender(
      createRowNode(
        createItem({
          id: "line-real",
          _clientKey: clientKey,
          title: "Nouvelle ligne",
        }),
      ),
    );

    expect(screen.getByTestId("estimate-line-title-input")).toBe(titleInput);
    expect(titleInput).toHaveFocus();
    expect(titleInput.closest("[data-estimate-item-id]")).toHaveAttribute(
      "data-estimate-item-id",
      "line-real",
    );
    expect(titleInput.closest("[data-cell-id]")).toHaveAttribute(
      "data-cell-id",
      `${clientKey}::title`,
    );
  });

  it("persists an explicit line nature and exposes contextual labels", () => {
    const { container } = renderRow(
      createItem({
        id: "line-nature",
        title: "Litière sur mesure",
        line_nature: "supply_only",
      }),
    );

    const natureSelect = screen.getByRole("combobox", {
      name: "Fournitures — nature de ligne pour Litière sur mesure",
    });
    expect(screen.getByText("Fournitures")).toBeInTheDocument();
    expect(natureSelect).toHaveAttribute(
      "data-cell-id",
      "line-nature::line_nature",
    );
    fireEvent.change(natureSelect, {
      target: { value: "supply_and_labor" },
    });

    expect(rowActionSpies.onPatchItem).toHaveBeenCalledWith(
      "line-nature",
      { line_nature: "supply_and_labor" },
      { persist: true },
    );
    expect(
      screen.getByRole("combobox", {
        name: "Unité pour Litière sur mesure",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "Heures de main-d’œuvre pour Litière sur mesure",
      }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        'input[aria-label="Prix de vente unitaire HT pour Litière sur mesure"]',
      ),
    ).not.toBeNull();
  });

  it("commits FO by UUID after explicit selection and preserves it on an unknown prefix", () => {
    const type = {
      id: "type-tube", code: "TUB", name: "Tube", default_fo_provision: 1.03, tenant_id: "tenant-1", created_at: "", updated_at: "",
    };
    renderRow(createItem({ supply_type_id: type.id }), { supplyTypeById: new Map([[type.id, type]]) });
    const input = screen.getByRole("combobox", { name: /Type de fourniture/ });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "inconnu" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("Tube");
    expect(rowActionSpies.onPatchItem).not.toHaveBeenCalled();
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("option", { name: "Aucun type" }));
    expect(rowActionSpies.onPatchItem).toHaveBeenCalledExactlyOnceWith("line-1", { supply_type_id: null }, { persist: true });
  });
});
