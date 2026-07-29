import { render, within } from "@testing-library/react";
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

function renderRowWithItem(
  item: EstimateItem,
  laborRateCents = 4500,
) {
  return render(
    <EstimateEditorRow
      versionId="version-1"
      estimateCurrency="EUR"
      item={item}
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
          hourly_rate_cents: laborRateCents,
          is_active: true,
          position: 1,
        },
      ] as Database["public"]["Tables"]["labor_roles"]["Row"][]}
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
}

describe("EstimateEditorRow line cells", () => {
  it("renders the standard labor cells when labor split is disabled", () => {
    const { container } = renderRow(false);

    expect(container.querySelector('[data-cell-id="line-1::h_mo"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-id="line-1::h_mo_atelier"]')).toBeNull();
    expect(container.querySelectorAll("select.estimate-select")).toHaveLength(1);

    const kFoInput = within(container).getByRole("textbox", {
      name: "Coefficient fourniture K FO pour Ligne test",
    });
    expect(kFoInput).toHaveAttribute(
      "title",
      "K FO agit uniquement sur le prix de revient fourniture et ne modifie jamais le prix de revient MO."
    );
    expect(kFoInput).toHaveClass("estimate-input--compact-number");
    expect(kFoInput).toHaveAttribute("type", "text");
    expect(kFoInput).toHaveAttribute("inputmode", "decimal");

    const hMoInput = container.querySelector<HTMLInputElement>(
      '[data-cell-id="line-1::h_mo"] input'
    );
    expect(hMoInput).toHaveClass("estimate-input--compact-number");
    expect(hMoInput).toHaveAttribute("type", "text");
    expect(hMoInput).toHaveAttribute("inputmode", "decimal");

    const kMoInput = within(container).getByRole("textbox", {
      name: "Coefficient main-d'œuvre K MO pour Ligne test",
    });
    expect(kMoInput).toHaveClass("estimate-input--compact-number");
    expect(kMoInput).toHaveAttribute("type", "text");
    expect(kMoInput).toHaveAttribute("inputmode", "decimal");

    // La quantité doit accepter la virgule décimale FR (text + decimal),
    // pas un input number qui la rejette au pavé numérique.
    const quantityInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Obligatoire"]'
    );
    expect(quantityInput).not.toBeNull();
    // Avant le correctif la cellule était un input number, qui rejette la
    // virgule décimale FR au pavé numérique ; elle est désormais en texte.
    expect(quantityInput?.type).toBe("text");
  });

  it("renders split labor cells when labor split is enabled", () => {
    const { container } = renderRow(true);

    expect(container.querySelector('[data-cell-id="line-1::h_mo"]')).toBeNull();
    expect(container.querySelector('[data-cell-id="line-1::h_mo_atelier"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-id="line-1::h_mo_chantier"]')).not.toBeNull();
    expect(container.querySelectorAll("select.estimate-select")).toHaveLength(2);
  });

  it("announces source, qty status and confidence in a single badge label", () => {
    const view = renderRowWithItem(
      createItem({
        source_provider: "dpgf",
        source_file_name: "client-dpgf.xlsx",
        quantity: 12,
      } as Partial<EstimateItem>)
    );

    const row = within(view.container);
    // Les trois informations étaient portées par trois badges distincts ; elles
    // sont désormais concaténées dans un badge unique, dont seul le libellé
    // compact est visible. Le `.sr-only` doit donc toujours les annoncer toutes
    // les trois, sous peine de régresser l'accessibilité.
    const screenReaderLabel = row.getByText(/DPGF importee/, {
      selector: ".sr-only",
    });
    expect(screenReaderLabel).toHaveTextContent(
      "DPGF importee — Qte importee non verifiee — Confiance moyenne"
    );

    // Le libellé visible reste compact et masqué aux lecteurs d'écran.
    const compactLabel = view.container.querySelector(
      '.estimate-line-truth__badge [aria-hidden="true"]'
    );
    expect(compactLabel).toHaveTextContent("DPGF");
  });

  it("shows the hourly rate in options without displaying it in the cell", () => {
    const view = renderRowWithItem(createItem(), 0);

    const roleSelect = within(view.container).getByRole("combobox", {
      name: "Rôle de main-d'œuvre pour Ligne test",
    }) as HTMLSelectElement;
    const selectedRoleDisplay = within(view.container).getByTestId(
      "estimate-labor-role-value"
    );
    const kMoInput = within(view.container).getByRole("textbox", {
      name: "Coefficient main-d'œuvre K MO pour Ligne test",
    });

    expect(roleSelect.selectedOptions[0]?.textContent).toBe("0,00 €/h Poseur");
    expect(roleSelect.selectedOptions[0]?.textContent).not.toContain("—");
    expect(roleSelect.style.color).toBe("transparent");
    expect(selectedRoleDisplay).toHaveTextContent("Poseur");
    expect(selectedRoleDisplay).not.toHaveTextContent("€/h");
    expect(roleSelect).toHaveAttribute("aria-invalid", "true");
    expect(kMoInput).toHaveAttribute(
      "title",
      "Le taux horaire de Poseur est à 0 €/h : renseignez-le dans Paramétrage pour que h MO et K MO entrent dans le P.U."
    );
  });
});
