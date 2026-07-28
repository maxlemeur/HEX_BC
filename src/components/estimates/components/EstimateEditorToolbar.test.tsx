import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorToolbar } from "@/components/estimates/components/EstimateEditorToolbar";
import { EstimateEditorProvider } from "@/components/estimates/context/EstimateEditorContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderToolbar(overrides?: {
  hasSelectedLines?: boolean;
  uiMode?: "expert" | "simplified";
  isLaborSplitEnabled?: boolean;
  showAssistants?: boolean;
  isViewerMode?: boolean;
  isFinalizationPanelOpen?: boolean;
}) {
  const actions = {
    setBulkMajorationPercent: vi.fn(),
    setBulkMoveParentId: vi.fn(),
    setBulkCategoryId: vi.fn(),
    setBulkLaborRoleId: vi.fn(),
    toggleAllVisibleLines: vi.fn(),
    clearLineSelection: vi.fn(),
  };
  const callbacks = {
    onUndo: vi.fn().mockResolvedValue(undefined),
    onQualityFilterChange: vi.fn(),
    onApplyBulkMajoration: vi.fn().mockResolvedValue(undefined),
    onApplyBulkMove: vi.fn().mockResolvedValue(undefined),
    onBulkDeleteSelection: vi.fn().mockResolvedValue(undefined),
    onOpenAssemblyPicker: vi.fn(),
    onOpenImportFromEstimateDialog: vi.fn(),
    onToggleQuickTemplatePicker: vi.fn(),
    onToggleQuickAssemblyPicker: vi.fn(),
    onToggleFinalizationPanel: vi.fn(),
  };

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
        isViewerMode={overrides?.isViewerMode}
        qualityCounts={{
          linesCount: 2,
          linesWithAnomaliesCount: 1,
          totalFlagsCount: 2,
          byFlag: {
            missing_price: 1,
            missing_quantity: 1,
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
        laborRoles={[
          { id: "role-1", name: "Soudeur", is_active: true } as never,
        ]}
        bulkSuggestionEligibleCount={0}
        supplierPreselectionEligibleCount={2}
        onQualityFilterChange={callbacks.onQualityFilterChange}
        onOutlierDetectionMethodChange={vi.fn()}
        onOutlierThresholdChange={vi.fn()}
        onUndo={callbacks.onUndo}
        onRedo={vi.fn().mockResolvedValue(undefined)}
        onApplyBulkMajoration={callbacks.onApplyBulkMajoration}
        onBulkDeleteSelection={callbacks.onBulkDeleteSelection}
        onApplyBulkMove={callbacks.onApplyBulkMove}
        onApplyBulkCategory={vi.fn().mockResolvedValue(undefined)}
        onApplyBulkLaborRole={vi.fn().mockResolvedValue(undefined)}
        onOpenBulkSuggestDialog={vi.fn()}
        onOpenSupplierPreselectionDialog={vi.fn()}
        onOpenAssemblyPicker={callbacks.onOpenAssemblyPicker}
        onOpenImportFromEstimateDialog={
          callbacks.onOpenImportFromEstimateDialog
        }
        onExpandAllSections={vi.fn()}
        onCollapseAllSections={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenEstimateStructureDraftDialog={
          overrides?.showAssistants ? vi.fn() : undefined
        }
        onOpenGeneratedOuvrageDialog={
          overrides?.showAssistants ? vi.fn() : undefined
        }
        columnPreset="standard"
        columnPresetLabels={{
          essential: "Essentiel",
          standard: "Standard",
          full: "Complet",
          custom: "Personnalisé",
        }}
        onColumnPresetChange={vi.fn()}
        searchTerm=""
        onSearchChange={vi.fn()}
        columnVisibleColumns={new Set()}
        allAdvancedColumns={[]}
        columnLabels={
          {} as Record<import("@/hooks/useColumnVisibility").ColumnKey, string>
        }
        onToggleColumn={vi.fn()}
        hiddenAdvancedCount={5}
        onToggleAdvancedColumns={vi.fn()}
        isFinalizationPanelOpen={overrides?.isFinalizationPanelOpen}
        onToggleFinalizationPanel={callbacks.onToggleFinalizationPanel}
        isLaborSplitEnabled={overrides?.isLaborSplitEnabled}
        onToggleQuickTemplatePicker={callbacks.onToggleQuickTemplatePicker}
        onToggleQuickAssemblyPicker={callbacks.onToggleQuickAssemblyPicker}
      />
    </EstimateEditorProvider>,
  );

  return { actions, callbacks };
}

function selectRibbonTab(name: string | RegExp) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

function openInsertionMenu() {
  selectRibbonTab("Insérer");
  fireEvent.click(screen.getByTestId("estimate-editor-insert-button"));
  return screen.getByRole("menu", {
    name: "Insérer dans le chiffrage",
  });
}

function openDisplayDialog() {
  selectRibbonTab(/^Affichage & contrôle/);
  fireEvent.click(screen.getByTestId("estimate-editor-display-button"));
  return screen.getByRole("dialog", {
    name: "Options d’affichage du chiffrage",
  });
}

describe("EstimateEditorToolbar option 3", () => {
  it("presents one command row with explicit insertion and display groups", () => {
    renderToolbar({ showAssistants: true });

    expect(
      screen.getByRole("button", { name: "Annuler la dernière action" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Rechercher dans le chiffrage..."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commandes/ })).toHaveAttribute(
      "title",
    );
    selectRibbonTab("Insérer");
    expect(
      screen.getByTestId("estimate-editor-insert-button"),
    ).toHaveAttribute("title");
    selectRibbonTab(/^Affichage & contrôle/);
    expect(
      screen.getByTestId("estimate-editor-display-button"),
    ).toHaveAttribute("title");
  });

  it("groups insertion sources and explains optional assistants", () => {
    const { callbacks } = renderToolbar({ showAssistants: true });

    const menu = openInsertionMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Insérer un template" }),
    ).toBeInTheDocument();
    expect(within(menu).getByText("Assistants optionnels")).toBeInTheDocument();
    expect(within(menu).getByText(/libre de valider/)).toBeInTheDocument();

    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Importer depuis un autre devis",
      }),
    );
    expect(callbacks.onOpenImportFromEstimateDialog).toHaveBeenCalledTimes(1);
  });

  it("offers a single explicit entry point to add an ouvrage", () => {
    const { callbacks } = renderToolbar();

    const menu = openInsertionMenu();
    expect(
      within(menu).queryByTestId("estimate-editor-quick-assembly-button"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Ajouter un ouvrage" }),
    );
    expect(callbacks.onOpenAssemblyPicker).toHaveBeenCalledTimes(1);
  });

  it("groups structure, columns, quality and advanced controls under Afficher", () => {
    const { callbacks } = renderToolbar();

    const dialog = openDisplayDialog();
    expect(
      within(dialog).getByRole("heading", { name: "Structure" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Colonnes" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("2 anomalies")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Contrôles avancés" }),
    ).toHaveAttribute("title");

    fireEvent.change(within(dialog).getByLabelText("Lignes affichées"), {
      target: { value: "with_anomalies" },
    });
    expect(callbacks.onQualityFilterChange).toHaveBeenCalledWith(
      "with_anomalies",
    );
  });

  it("keeps the finalization inspector hidden behind an explicit display toggle", () => {
    const { callbacks } = renderToolbar();

    const dialog = openDisplayDialog();
    expect(
      within(dialog).getByRole("heading", { name: "Finalisation" }),
    ).toBeInTheDocument();

    const toggle = within(dialog).getByTestId(
      "estimate-editor-toggle-finalization-button",
    );
    expect(toggle).toHaveTextContent("Afficher");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(callbacks.onToggleFinalizationPanel).toHaveBeenCalledTimes(1);
  });

  it("labels the finalization toggle as Masquer when the inspector is open", () => {
    renderToolbar({ isFinalizationPanelOpen: true });

    openDisplayDialog();
    const toggle = screen.getByTestId(
      "estimate-editor-toggle-finalization-button",
    );
    expect(toggle).toHaveTextContent("Masquer");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps root-lot creation out of the toolbar", () => {
    renderToolbar();
    expect(
      screen.queryByTestId("estimate-editor-toolbar-add-root-section-button"),
    ).not.toBeInTheDocument();
  });

  it("keeps selection actions contextual and functional", () => {
    const { actions, callbacks } = renderToolbar({ hasSelectedLines: true });

    const selectionBar = screen.getByTestId(
      "estimate-editor-bulk-selection-bar",
    );
    expect(
      within(selectionBar).getByText("1 ligne sélectionnée"),
    ).toBeInTheDocument();
    fireEvent.change(
      within(selectionBar).getByLabelText(
        "Déplacer les lignes sélectionnées vers",
      ),
      {
        target: { value: "" },
      },
    );
    expect(actions.setBulkMoveParentId).toHaveBeenCalledWith("");
    fireEvent.click(
      within(selectionBar).getByRole("button", { name: "Déplacer" }),
    );
    expect(callbacks.onApplyBulkMove).toHaveBeenCalledTimes(1);

    fireEvent.click(within(selectionBar).getByText("Modifier les attributs"));
    fireEvent.change(
      within(selectionBar).getByLabelText("Majoration MO en pourcentage"),
      {
        target: { value: "120" },
      },
    );
    expect(actions.setBulkMajorationPercent).toHaveBeenCalledWith("120");
  });

  it("hides selection actions when no line is selected", () => {
    renderToolbar();
    expect(
      screen.queryByTestId("estimate-editor-bulk-selection-bar"),
    ).not.toBeInTheDocument();
  });

  it("keeps simplified labor-split mode free of the advanced-column toggle", () => {
    renderToolbar({ uiMode: "simplified", isLaborSplitEnabled: true });
    openDisplayDialog();
    expect(
      screen.queryByRole("button", { name: "Colonnes avancées" }),
    ).not.toBeInTheDocument();
  });

  it("opens the global command palette through Ctrl+K", () => {
    const keydownListener = vi.fn();
    document.addEventListener("keydown", keydownListener);
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: /Commandes/ }));
    expect(keydownListener).toHaveBeenCalledWith(
      expect.objectContaining({ key: "k", ctrlKey: true }),
    );
    document.removeEventListener("keydown", keydownListener);
  });
});
