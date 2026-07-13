import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorToolbar } from "@/components/estimates/components/EstimateEditorToolbar";
import { EstimateEditorProvider } from "@/components/estimates/context/EstimateEditorContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createRect({
  left,
  right,
  top,
  bottom,
  width,
  height,
}: {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}) {
  return {
    x: left,
    y: top,
    left,
    right,
    top,
    bottom,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockCompactViewport() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(max-width: 1024px)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList
  );
}

function renderToolbar(overrides?: {
  hasSelectedLines?: boolean;
  uiMode?: "expert" | "simplified";
  isLaborSplitEnabled?: boolean;
  showAdjacentActions?: boolean;
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
        supplierPreselectionEligibleCount={2}
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
        onOpenSupplierPreselectionDialog={vi.fn()}
        onOpenAssemblyPicker={vi.fn()}
        onOpenImportFromEstimateDialog={vi.fn()}
        onAddRootSection={vi.fn()}
        onExpandAllSections={vi.fn()}
        onCollapseAllSections={vi.fn()}
        onOpenEstimateStructureDraftDialog={
          overrides?.showAdjacentActions ? vi.fn() : undefined
        }
        onOpenGeneratedOuvrageDialog={
          overrides?.showAdjacentActions ? vi.fn() : undefined
        }
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

  it("shows supplier preselection action when lines are available", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Outils" }));
    expect(
      screen.getByRole("button", { name: "Préselection fournisseurs (2)" })
    ).toBeInTheDocument();
  });

  it("exposes and updates the relationships for toolbar popovers", () => {
    renderToolbar();

    const columnsButton = screen.getByRole("button", { name: "Colonnes" });
    expect(columnsButton).toHaveAttribute("aria-expanded", "false");
    expect(columnsButton).toHaveAttribute("aria-haspopup", "dialog");
    expect(columnsButton).toHaveAttribute(
      "aria-controls",
      "estimate-editor-columns-panel"
    );
    fireEvent.click(columnsButton);
    expect(columnsButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "Choisir les colonnes" })
    ).toHaveAttribute("id", "estimate-editor-columns-panel");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(columnsButton).toHaveAttribute("aria-expanded", "false");

    const anomaliesButton = screen.getByRole("button", { name: /1 anomalie/ });
    expect(anomaliesButton).toHaveAttribute("aria-expanded", "false");
    expect(anomaliesButton).toHaveAttribute("aria-haspopup", "dialog");
    expect(anomaliesButton).toHaveAttribute(
      "aria-controls",
      "estimate-editor-anomalies-panel"
    );
    fireEvent.click(anomaliesButton);
    expect(anomaliesButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "Filtrer les anomalies" })
    ).toHaveAttribute("id", "estimate-editor-anomalies-panel");
    fireEvent.keyDown(document, { key: "Escape" });

    const toolsButton = screen.getByRole("button", { name: "Outils" });
    expect(toolsButton).toHaveAttribute("aria-expanded", "false");
    expect(toolsButton).toHaveAttribute("aria-haspopup", "dialog");
    expect(toolsButton).toHaveAttribute(
      "aria-controls",
      "estimate-editor-tools-panel"
    );
    fireEvent.click(toolsButton);
    expect(toolsButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("dialog", { name: "Outils du devis" })
    ).toHaveAttribute("id", "estimate-editor-tools-panel");
    fireEvent.mouseDown(screen.getByLabelText("Filtre qualité"));
    expect(toolsButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(document.body);
    expect(toolsButton).toHaveAttribute("aria-expanded", "false");
  });

  it("moves keyboard focus into tools and restores it on Escape", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const toolsButton = screen.getByRole("button", { name: "Outils" });
    await user.click(toolsButton);

    const qualityFilter = screen.getByLabelText("Filtre qualité");
    expect(qualityFilter).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Raccourcis clavier" })
    ).not.toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Outliers")).toHaveFocus();

    const assembliesButton = screen.getByRole("button", {
      name: "Assemblages",
    });
    assembliesButton.focus();
    await user.tab();
    expect(qualityFilter).toHaveFocus();

    await user.tab({ shift: true });
    expect(assembliesButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(toolsButton).toHaveFocus();
    expect(toolsButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("dialog", { name: "Outils du devis" })
    ).not.toBeInTheDocument();
  });

  it.each([
    { viewportWidth: 727, expectedWidth: 320 },
    { viewportWidth: 320, expectedWidth: 288 },
  ])(
    "keeps the tools panel inside a $viewportWidth px viewport",
    ({ viewportWidth, expectedWidth }) => {
      vi.stubGlobal("innerWidth", viewportWidth);
      vi.stubGlobal("innerHeight", 800);
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect"
      ).mockReturnValue(
        createRect({
          left: 180,
          right: 250,
          top: 100,
          bottom: 132,
          width: 70,
          height: 32,
        })
      );
      renderToolbar();

      fireEvent.click(screen.getByRole("button", { name: "Outils" }));

      const panel = screen.getByRole("dialog", { name: "Outils du devis" });
      expect(panel).toHaveStyle({
        left: "16px",
        width: `${expectedWidth}px`,
      });
      expect(16 + expectedWidth).toBeLessThanOrEqual(viewportWidth - 16);
    }
  );

  it("keeps the tools panel right-aligned to its trigger on desktop", () => {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      createRect({
        left: 1130,
        right: 1200,
        top: 100,
        bottom: 132,
        width: 70,
        height: 32,
      })
    );
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Outils" }));

    expect(
      screen.getByRole("dialog", { name: "Outils du devis" })
    ).toHaveStyle({ left: "880px", width: "320px" });
  });

  it("labels optional estimate assistants discreetly", () => {
    renderToolbar({ showAdjacentActions: true });

    const assistantLabel = screen.getByText("Assistants optionnels");
    expect(assistantLabel).toBeInTheDocument();
    expect(assistantLabel).toHaveClass("text-slate-400");
    expect(assistantLabel).not.toHaveClass("border");
    expect(
      screen.getByRole("button", { name: "Structure IA" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Générer des ouvrages" })
    ).toBeInTheDocument();
  });

  it("groups secondary actions into touch-friendly controls on compact viewports", () => {
    mockCompactViewport();
    renderToolbar({ showAdjacentActions: true });

    expect(
      screen.getByTestId("estimate-editor-toolbar-add-root-section-button")
    ).toHaveClass("h-11", "flex-1");
    expect(screen.getByTestId("estimate-editor-search-input")).toHaveClass(
      "h-11",
      "min-h-11",
      "w-full"
    );
    expect(
      screen.queryByRole("button", { name: "Structure IA" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("estimate-editor-primary-actions-button")
    );
    const actionsMenu = screen.getByRole("menu", {
      name: "Actions du devis",
    });
    expect(
      within(actionsMenu).getByRole("menuitem", { name: "Tout déplier" })
    ).toBeInTheDocument();
    expect(
      within(actionsMenu).getByRole("menuitem", { name: "Structure IA" })
    ).toBeInTheDocument();
    expect(
      within(actionsMenu).getByRole("menuitem", {
        name: "Générer des ouvrages",
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("estimate-editor-overflow-button"));
    const compactDialog = screen.getByRole("dialog", {
      name: "Insertion et affichage",
    });
    fireEvent.click(
      within(compactDialog).getByTestId("estimate-editor-columns-button")
    );
    expect(
      within(compactDialog).getByRole("group", {
        name: "Choisir les colonnes",
      })
    ).toBeInTheDocument();

    fireEvent.click(
      within(compactDialog).getByTestId("estimate-editor-anomalies-button")
    );
    expect(
      within(compactDialog).getByRole("group", {
        name: "Filtrer les anomalies",
      })
    ).toBeInTheDocument();
    expect(
      within(compactDialog).getByRole("button", {
        name: "Raccourcis clavier",
      })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("estimate-editor-overflow-button"));
    expect(compactDialog).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("estimate-editor-overflow-button"));
    const reopenedDialog = screen.getByRole("dialog", {
      name: "Insertion et affichage",
    });
    expect(
      within(reopenedDialog).queryByRole("group", {
        name: "Filtrer les anomalies",
      })
    ).not.toBeInTheDocument();
  });
});
