import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SectionRow } from "@/components/estimates/components/estimate-editor-row/SectionRow";
import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";
import type {
  SpreadsheetCellProps,
  SpreadsheetEditorProps,
  SpreadsheetNavigationResult,
} from "@/hooks/useSpreadsheetNavigation";

function createSectionItem(partial: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id: "section-1",
    version_id: "version-1",
    parent_id: null,
    item_type: "section",
    title: "Lot gros oeuvre",
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

function createCellProps(
  cellId = "section-1::title"
): SpreadsheetCellProps {
  return {
    ref: () => undefined,
    role: "gridcell",
    tabIndex: -1,
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onKeyDown: vi.fn(),
    onMouseDown: vi.fn(),
    onClick: vi.fn(),
    onDoubleClick: vi.fn(),
    "data-testid": "estimate-cell",
    "data-cell-id": cellId,
    "data-cell-row-id": "section-1",
    "data-cell-column-key": "title",
  };
}

function createEditorProps(): SpreadsheetEditorProps<HTMLInputElement> {
  return {
    ref: () => undefined,
    tabIndex: -1,
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onKeyDown: vi.fn(),
  };
}

describe("SectionRow", () => {
  it("renders section actions and section totals without changing row markers", () => {
    const onAddLine = vi.fn();
    const onAddSection = vi.fn();
    const onRevealAidEditor = vi.fn();
    const onToggleSectionCollapsed = vi.fn();
    const onOpenSectionContextMenu = vi.fn();

    const titleCellProps = createCellProps();
    const navigation = {
      getCellProps: () => titleCellProps,
      getEditorProps: () => createEditorProps(),
      isCellActive: () => false,
      isCellEditing: () => false,
    } as unknown as SpreadsheetNavigationResult;

    render(
      <SectionRow
        item={createSectionItem()}
        itemNumber="1"
        depth={1}
        estimateCurrency="EUR"
        navigation={navigation}
        titleCell={{ rowId: "section-1", columnKey: "title" }}
        indentStyle={{ "--row-depth": "1", paddingLeft: "24px" }}
        titleCellProps={titleCellProps}
        titleEditorProps={createEditorProps()}
        isReadOnly={false}
        hideEditingActions={false}
        isPendingCreate={false}
        isAidEditorVisible={false}
        sectionTotals={{
          foTotalCents: 1200,
          moTotalCents: 3400,
          moAtelierTotalCents: 0,
          moChantierTotalCents: 0,
          totalHtCents: 4600,
          totalTtcCents: 5520,
          supplyTypeFoTotalsCents: {
            steel: 1200,
          },
        }}
        supplyTypeById={
          new Map([
            [
              "steel",
              {
                id: "steel",
                code: "steel",
                name: "Acier",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                tenant_id: "tenant-1",
              },
            ],
          ])
        }
        isLaborSplitEnabled={false}
        visibleColumns={undefined}
        sectionLevel={2}
        canAddLine
        canAddSection
        addLineLabel="+ Ligne"
        addSectionLabel="+ Section"
        isSectionCollapsed={false}
        onToggleSectionCollapsed={onToggleSectionCollapsed}
        onOpenSectionContextMenu={onOpenSectionContextMenu}
        onPatchItem={vi.fn()}
        onAddLine={onAddLine}
        onAddSection={onAddSection}
        onRevealAidEditor={onRevealAidEditor}
        aidInput={<span>AID-42</span>}
        dragHandle={<span data-testid="drag-handle" />}
        style={{
          transform: undefined,
          transition: undefined,
          opacity: 1,
        }}
        setNodeRef={vi.fn()}
        treeConnectorMeta={{
          depth: 1,
          isLastChild: false,
          ancestorLastChildFlags: [],
          hasVisibleChildren: true,
        }}
      />
    );

    const row = screen.getByTestId("estimate-section-row");
    expect(row).toHaveAttribute("data-estimate-item-id", "section-1");
    expect(screen.getByTestId("drag-handle")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Lot gros oeuvre")).toBeInTheDocument();
    expect(screen.getByText(/FO/)).toBeInTheDocument();
    expect(screen.getByText(/MO/)).toBeInTheDocument();
    expect(screen.getByText(/HT/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("estimate-section-add-line-button"));
    fireEvent.click(screen.getByTestId("estimate-section-add-section-button"));
    fireEvent.click(screen.getByTestId("estimate-section-add-aid-button"));
    fireEvent.click(screen.getByRole("button", { name: "Replier la section" }));
    fireEvent.contextMenu(row, { clientX: 12, clientY: 24 });

    expect(onAddLine).toHaveBeenCalledWith("section-1");
    expect(onAddSection).toHaveBeenCalledWith("section-1");
    expect(onRevealAidEditor).toHaveBeenCalledTimes(1);
    expect(onToggleSectionCollapsed).toHaveBeenCalledWith("section-1");
    expect(onOpenSectionContextMenu).toHaveBeenCalledWith("section-1", {
      x: 12,
      y: 24,
    });
  });
});
