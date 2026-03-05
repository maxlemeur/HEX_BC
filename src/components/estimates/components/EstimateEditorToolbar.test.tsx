import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorToolbar } from "@/components/estimates/components/EstimateEditorToolbar";
import { EstimateEditorProvider } from "@/components/estimates/context/EstimateEditorContext";

afterEach(() => {
  cleanup();
});

function renderToolbar(overrides?: {
  hasSelectedLines?: boolean;
  uiMode?: "expert" | "simplified";
  isLaborSplitEnabled?: boolean;
}) {
  const actions = {
    setBulkMajorationPercent: vi.fn(),
    setBulkMoveParentId: vi.fn(),
    setBulkCategoryId: vi.fn(),
    setBulkLaborRoleId: vi.fn(),
    toggleAllVisibleLines: vi.fn(),
    clearLineSelection: vi.fn(),
  };

  const onUndo = vi.fn().mockResolvedValue(undefined);
  const onApplyBulkMajoration = vi.fn().mockResolvedValue(undefined);

  render(
    <EstimateEditorProvider
      value={{
        state: {
          visibleLineIdList: ["line-1"],
          selectedLineIdList: overrides?.hasSelectedLines ? ["line-1"] : [],
          selectedLineCount: overrides?.hasSelectedLines ? 1 : 0,
          hasSelectedLines: Boolean(overrides?.hasSelectedLines),
          allVisibleSelected: false,
          bulkMajorationPercent: "100",
          bulkMoveParentId: "",
          bulkCategoryId: "",
          bulkLaborRoleId: "",
        },
        actions,
        meta: {
          hasVisibleRows: true,
          isReadOnly: false,
        },
      }}
    >
      <EstimateEditorToolbar
        uiMode={overrides?.uiMode ?? "expert"}
        qualityCounts={{
          linesCount: 2,
          linesWithAnomaliesCount: 1,
          totalFlagsCount: 1,
          byFlag: {
            missing_price: 1,
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
        outlierDetectionMethod="iqr"
        outlierThreshold={1.5}
        isUndoRedoBusy={false}
        canUndo
        canRedo={false}
        bulkMoveDestinations={[{ id: null, label: "Racine" }]}
        categories={[{ id: "cat-1", name: "Tube" } as never]}
        laborRoles={[{ id: "role-1", name: "Soudeur", is_active: true } as never]}
        bulkSuggestionEligibleCount={0}
        onQualityFilterChange={vi.fn()}
        onOutlierDetectionMethodChange={vi.fn()}
        onOutlierThresholdChange={vi.fn()}
        onUndo={onUndo}
        onRedo={vi.fn().mockResolvedValue(undefined)}
        onApplyBulkMajoration={onApplyBulkMajoration}
        onBulkDeleteSelection={vi.fn().mockResolvedValue(undefined)}
        onApplyBulkMove={vi.fn().mockResolvedValue(undefined)}
        onApplyBulkCategory={vi.fn().mockResolvedValue(undefined)}
        onApplyBulkLaborRole={vi.fn().mockResolvedValue(undefined)}
        onOpenBulkSuggestDialog={vi.fn()}
        onOpenAssemblyPicker={vi.fn()}
        columnPreset="standard"
        columnPresetLabels={{ essential: "Essentiel", standard: "Standard", full: "Complet", custom: "Personnalisé" }}
        onColumnPresetChange={vi.fn()}
        searchTerm=""
        onSearchChange={vi.fn()}
        columnVisibleColumns={new Set()}
        allAdvancedColumns={[]}
        columnLabels={{} as Record<import("@/hooks/useColumnVisibility").ColumnKey, string>}
        onToggleColumn={vi.fn()}
        hiddenAdvancedCount={5}
        onToggleAdvancedColumns={vi.fn()}
        isLaborSplitEnabled={overrides?.isLaborSplitEnabled}
      />
    </EstimateEditorProvider>
  );

  return { actions, onUndo, onApplyBulkMajoration };
}

describe("EstimateEditorToolbar", () => {
  it("delegates undo and majoration changes", () => {
    const { actions, onUndo } = renderToolbar({ hasSelectedLines: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Annuler la dernière action" })
    );
    expect(onUndo).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Majoration MO en pourcentage"), {
      target: { value: "120" },
    });
    expect(actions.setBulkMajorationPercent).toHaveBeenCalledWith("120");
  });

  it("hides bulk actions when no line is selected", () => {
    renderToolbar({ hasSelectedLines: false });
    expect(
      screen.queryByRole("button", { name: "Appliquer majoration" })
    ).not.toBeInTheDocument();
  });

  it("hides simplified advanced-columns toggle when labor split is enabled", () => {
    renderToolbar({ uiMode: "simplified", isLaborSplitEnabled: true });
    expect(
      screen.queryByRole("button", { name: "Colonnes avancées" })
    ).not.toBeInTheDocument();
  });
});
