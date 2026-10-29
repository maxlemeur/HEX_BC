import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProvider } from "@/components/UserContext";
import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import { useEstimateEditorRowActions } from "@/components/estimates/context/EstimateEditorRowActionsContext";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EditorEstimateItem = EstimateItem & { _clientKey?: string };

vi.mock("@/components/estimates/PastePreviewDialog", () => ({
  PastePreviewDialog: () => null,
}));

vi.mock("@/components/estimates/AssemblyPicker", () => ({
  AssemblyPicker: () => null,
}));

vi.mock("@/components/estimates/SupplierComparisonPanel", () => ({
  SupplierComparisonPanel: () => null,
}));

vi.mock("@/components/estimates/components/EstimateSuggestionRow", () => ({
  EstimateSuggestionRow: () => null,
}));

vi.mock("@/components/estimates/components/EstimateEditorBody", () => ({
  EstimateEditorBody: ({ renderList }: { renderList: () => ReactNode }) => (
    <div data-testid="editor-body">{renderList()}</div>
  ),
}));

vi.mock("@/components/estimates/components/EstimateEditorRow", () => ({
  getSpreadsheetColumnKeys: () => ["title"],
  EstimateEditorRow: ({
    item,
    unitValue,
  }: {
    item: EstimateItem;
    unitValue?: string;
  }) => <MockRow item={item} unitValue={unitValue} />,
}));

function MockRow({
  item,
  unitValue,
}: {
  item: EstimateItem;
  unitValue?: string;
}) {
  const { onUnitChange, onUnitCommit } = useEstimateEditorRowActions();

  return (
    <div data-estimate-item-id={item.id}>
      <input aria-label={`Title ${item.id}`} value={item.title} readOnly />
      {unitValue === undefined ? null : (
        <input
          aria-label={`Unit ${item.id}`}
          value={unitValue}
          onChange={(event) => onUnitChange(item.id, event.target.value)}
          onBlur={() => onUnitCommit(item.id)}
        />
      )}
    </div>
  );
}

vi.mock("@/components/estimates/hooks/useEstimateDndVirtualization", () => ({
  useEstimateDndVirtualization: () => ({
    sensors: [],
    handleDragEnd: vi.fn(),
    flattenedRows: [],
    virtualScrollRef: { current: null },
    virtualItems: [],
    virtualTotalSize: 0,
    measureElement: vi.fn(),
    isVirtualized: false,
    virtualizedSortableIds: [],
    virtualBodyStyle: undefined,
    handleNavigationCellNotMounted: vi.fn(),
  }),
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
    unit_price_ht_cents: 100,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 100,
    line_total_ht_cents: 100,
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

function renderEstimateEditorTable(options: { items: EstimateItem[] }) {
  const onPatchItem = vi.fn();
  const createNode = (nextItems: EstimateItem[]) => {
    const lineCount = nextItems.filter((item) => item.item_type === "line").length;
    return (
      <UserProvider
      initialUserEmail="integration@test.local"
      initialProfile={{
        id: "user-1",
        full_name: "Integration User",
        phone: null,
        job_title: null,
        work_email: "integration@test.local",
        role: "buyer",
        ui_mode: "expert",
        tenant_id: "tenant-1",
        tenant_role: "admin",
      }}
    >
      <EstimateEditorTable
        versionId="version-1"
        currency="EUR"
        items={nextItems}
        categories={[]}
        supplyTypes={[]}
        laborRoles={[]}
        suggestionRules={[]}
        detectedOutlierFlagsByItemId={{}}
        dismissedOutlierFlagsByItemId={{}}
        outlierActionPendingByItemId={{}}
        outlierDetectionMethod="iqr"
        outlierThreshold={1.5}
        qualityFlagsByItemId={{}}
        qualityCounts={{
          linesCount: lineCount,
          linesWithAnomaliesCount: 0,
          totalFlagsCount: 0,
          byFlag: {
            missing_price: 0,
            missing_quantity: 0,
            missing_labor_time: 0,
            missing_labor_role: 0,
            line_nature_mismatch: 0,
            price_outlier: 0,
            quantity_outlier: 0,
            supplier_price_outdated: 0,
            labor_split_incomplete: 0,
          },
        }}
        qualityFilter="all_lines"
        actionError={null}
        marginMultiplier={1}
        discountCents={0}
        taxRateBp={2000}
        sectionCalculation={{
          marginMode: "fixed",
          marginTiers: [],
          globalCoefficient: 1,
          discountMode: "simple",
          discountStepsBp: [],
          calcEngineVersion: 1,
        }}
        laborRateById={new Map()}
        isReadOnly={false}
        onQualityFilterChange={vi.fn()}
        onOutlierDetectionMethodChange={vi.fn()}
        onOutlierThresholdChange={vi.fn()}
        onToggleOutlierDismiss={vi.fn()}
        onAddSection={vi.fn()}
        onAddLine={vi.fn()}
        onDeleteItem={vi.fn()}
        onPatchItem={onPatchItem}
        onApplyBulkMajoration={vi.fn().mockResolvedValue(undefined)}
        onBulkDeleteLines={vi.fn().mockResolvedValue(undefined)}
        onBulkMoveLines={vi.fn().mockResolvedValue(undefined)}
        onBulkSetCategory={vi.fn().mockResolvedValue(undefined)}
        onBulkSetLaborRole={vi.fn().mockResolvedValue(undefined)}
        onInsertAssembly={vi.fn().mockResolvedValue(undefined)}
        onInsertTemplate={vi.fn().mockResolvedValue(undefined)}
        onPasteRows={vi.fn().mockResolvedValue(undefined)}
        onUndo={vi.fn().mockResolvedValue(undefined)}
        onRedo={vi.fn().mockResolvedValue(undefined)}
        canUndo={false}
        canRedo={false}
        isUndoRedoBusy={false}
        bulkSuggestionEligibleCount={0}
        supplierPreselectionEligibleCount={lineCount}
        onOpenBulkSuggestDialog={vi.fn()}
        onOpenSupplierPreselectionDialog={vi.fn()}
        onReorder={vi.fn()}
        onMoveItem={vi.fn()}
      />
      </UserProvider>
    );
  };
  const renderResult = render(createNode(options.items));

  return {
    onPatchItem,
    rerenderItems: (nextItems: EstimateItem[]) =>
      renderResult.rerender(createNode(nextItems)),
  };
}

describe("EstimateEditorTable integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the focused row mounted when an optimistic id is reconciled", () => {
    const clientKey = "tmp:line-client";
    const optimisticItem = createItem({
      id: clientKey,
      _clientKey: clientKey,
      title: "Nouvelle ligne",
    });
    const { rerenderItems } = renderEstimateEditorTable({
      items: [optimisticItem],
    });
    const titleInput = screen.getByRole("textbox", {
      name: `Title ${clientKey}`,
    });

    titleInput.focus();
    expect(titleInput).toHaveFocus();

    rerenderItems([
      createItem({
        id: "line-real",
        _clientKey: clientKey,
        title: "Nouvelle ligne",
      }),
    ]);

    expect(
      screen.getByRole("textbox", { name: "Title line-real" }),
    ).toBe(titleInput);
    expect(titleInput).toHaveFocus();
  });

  it("keeps a unit typed on an optimistic line once its id is reconciled", () => {
    const clientKey = "tmp:line-client";
    const { onPatchItem, rerenderItems } = renderEstimateEditorTable({
      items: [createItem({ id: clientKey, _clientKey: clientKey, description: null })],
    });

    fireEvent.change(screen.getByRole("textbox", { name: `Unit ${clientKey}` }), { target: { value: "u" } });
    rerenderItems([createItem({ id: "line-real", _clientKey: clientKey, description: null })]);
    const unitInput = screen.getByRole("textbox", { name: "Unit line-real" });
    fireEvent.blur(unitInput);

    expect(unitInput).toHaveValue("u");
    expect(onPatchItem).toHaveBeenCalledWith("line-real", { description: "u" }, { persist: true });
  });
});
