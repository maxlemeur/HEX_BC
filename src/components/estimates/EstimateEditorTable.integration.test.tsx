import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

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
  EstimateEditorRow: ({ item, onPatchItem, onLineSelectionInteraction }: {
    item: EstimateItem;
    onPatchItem: (itemId: string, patch: { title: string }, options?: { persist?: boolean }) => void;
    onLineSelectionInteraction: (input: { id: string; ctrlKey?: boolean }) => void;
  }) => (
    <div data-estimate-item-id={item.id}>
      <button
        type="button"
        onClick={() => onPatchItem(item.id, { title: "Edited line" }, { persist: true })}
      >
        Patch {item.id}
      </button>
      {item.item_type === "line" ? (
        <button
          type="button"
          onClick={() => onLineSelectionInteraction({ id: item.id, ctrlKey: true })}
        >
          Select {item.id}
        </button>
      ) : null}
    </div>
  ),
}));

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

function createItem(partial: Partial<EstimateItem>): EstimateItem {
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

function renderEstimateEditorTable() {
  const onPatchItem = vi.fn();
  const onApplyBulkMajoration = vi.fn().mockResolvedValue(undefined);

  render(
    <EstimateEditorTable
      versionId="version-1"
      items={[
        createItem({
          id: "line-1",
          item_type: "line",
          title: "Tube acier",
          quantity: 2,
          unit_price_ht_cents: 950,
          pu_ht_cents: 950,
          line_total_ht_cents: 1900,
        }),
      ]}
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
        linesCount: 1,
        linesWithAnomaliesCount: 0,
        totalFlagsCount: 0,
        byFlag: {
          missing_price: 0,
          missing_quantity: 0,
          missing_labor_time: 0,
          missing_labor_role: 0,
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
      onApplyBulkMajoration={onApplyBulkMajoration}
      onBulkDeleteLines={vi.fn().mockResolvedValue(undefined)}
      onBulkMoveLines={vi.fn().mockResolvedValue(undefined)}
      onBulkSetCategory={vi.fn().mockResolvedValue(undefined)}
      onBulkSetLaborRole={vi.fn().mockResolvedValue(undefined)}
      onInsertAssembly={vi.fn().mockResolvedValue(undefined)}
      onPasteRows={vi.fn().mockResolvedValue(undefined)}
      onUndo={vi.fn().mockResolvedValue(undefined)}
      onRedo={vi.fn().mockResolvedValue(undefined)}
      canUndo={false}
      canRedo={false}
      isUndoRedoBusy={false}
      bulkSuggestionEligibleCount={0}
      onOpenBulkSuggestDialog={vi.fn()}
      onReorder={vi.fn()}
      onMoveItem={vi.fn()}
    />
  );

  return {
    onPatchItem,
    onApplyBulkMajoration,
  };
}

describe("EstimateEditorTable integration", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("wires row edition callback to onPatchItem", () => {
    const { onPatchItem } = renderEstimateEditorTable();

    fireEvent.click(screen.getByRole("button", { name: "Patch line-1" }));

    expect(onPatchItem).toHaveBeenCalledWith(
      "line-1",
      { title: "Edited line" },
      { persist: true }
    );
  });

  it("applies bulk majoration on selected rows", async () => {
    const { onApplyBulkMajoration } = renderEstimateEditorTable();

    fireEvent.click(screen.getByRole("button", { name: "Select line-1" }));
    fireEvent.change(screen.getByLabelText("Majoration MO en pourcentage"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer majoration" }));

    await waitFor(() => {
      expect(onApplyBulkMajoration).toHaveBeenCalledWith(["line-1"], 1.2);
    });
  });

  it("copies selected rows to clipboard from keyboard shortcut", async () => {
    renderEstimateEditorTable();

    fireEvent.click(screen.getByRole("button", { name: "Select line-1" }));

    const target = screen.getByRole("button", { name: "Select line-1" });
    fireEvent.keyDown(target, {
      key: "c",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Tube acier"));
  });
});
