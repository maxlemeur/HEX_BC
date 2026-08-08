import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProvider } from "@/components/UserContext";
import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import { useEstimateEditorRowActions } from "@/components/estimates/context/EstimateEditorRowActionsContext";
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
  EstimateEditorRow: ({
    item,
    estimateCurrency,
    treeConnectorMeta,
    visibleColumns,
    onOpenMobileEditor,
  }: {
    item: EstimateItem;
    estimateCurrency: string;
    visibleColumns?: ReadonlySet<string>;
    onOpenMobileEditor?: (itemId: string) => void;
    treeConnectorMeta?: {
      depth: number;
      isLastChild: boolean;
      ancestorLastChildFlags: boolean[];
      hasVisibleChildren: boolean;
    };
  }) => (
    <MockRow
      item={item}
      estimateCurrency={estimateCurrency}
      treeConnectorMeta={treeConnectorMeta}
      visibleColumns={visibleColumns}
      onOpenMobileEditor={onOpenMobileEditor}
    />
  ),
}));

function MockRow({
  item,
  estimateCurrency,
  treeConnectorMeta,
  onOpenMobileEditor,
  visibleColumns,
}: {
  item: EstimateItem;
  estimateCurrency: string;
  visibleColumns?: ReadonlySet<string>;
  onOpenMobileEditor?: (itemId: string) => void;
  treeConnectorMeta?: {
    depth: number;
    isLastChild: boolean;
    ancestorLastChildFlags: boolean[];
    hasVisibleChildren: boolean;
  };
}) {
  const { onPatchItem, onLineSelectionInteraction } =
    useEstimateEditorRowActions();

  return (
    <div
      data-estimate-item-id={item.id}
      data-connector-depth={treeConnectorMeta?.depth}
      data-connector-is-last-child={treeConnectorMeta?.isLastChild}
      data-connector-ancestor-flags={treeConnectorMeta?.ancestorLastChildFlags.join(
        ",",
      )}
      data-connector-has-visible-children={
        treeConnectorMeta?.hasVisibleChildren
      }
      data-visible-columns={
        visibleColumns
          ? Array.from(visibleColumns).sort().join(",")
          : "undefined"
      }
    >
      <span>Currency {estimateCurrency}</span>
      <button
        type="button"
        onClick={() =>
          onPatchItem(item.id, { title: "Edited line" }, { persist: true })
        }
      >
        Patch {item.id}
      </button>
      {item.item_type === "line" ? (
        <button
          type="button"
          onClick={() =>
            onLineSelectionInteraction({ id: item.id, ctrlKey: true })
          }
        >
          Select {item.id}
        </button>
      ) : null}
      {item.item_type === "line" && onOpenMobileEditor ? (
        <button
          type="button"
          onClick={() => onOpenMobileEditor(item.id)}
        >
          Modifier {item.id}
        </button>
      ) : null}
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

function renderEstimateEditorTable(options?: {
  currency?: "EUR" | "USD" | "GBP";
  uiMode?: "expert" | "simplified";
  items?: EstimateItem[];
  isLaborSplitEnabled?: boolean;
}) {
  const onPatchItem = vi.fn();
  const onApplyBulkMajoration = vi.fn().mockResolvedValue(undefined);
  const onBulkDeleteLines = vi.fn().mockResolvedValue(undefined);
  const onAddSection = vi.fn();
  const onAddLine = vi.fn();
  const items = options?.items ?? [
    createItem({
      id: "line-1",
      item_type: "line",
      title: "Tube acier",
      quantity: 2,
      unit_price_ht_cents: 950,
      pu_ht_cents: 950,
      line_total_ht_cents: 1900,
    }),
  ];
  const lineCount = items.filter((item) => item.item_type === "line").length;

  render(
    <UserProvider
      initialUserEmail="integration@test.local"
      initialProfile={{
        id: "user-1",
        full_name: "Integration User",
        phone: null,
        job_title: null,
        work_email: "integration@test.local",
        role: "buyer",
        ui_mode: options?.uiMode ?? "expert",
        tenant_id: "tenant-1",
        tenant_role: "admin",
      }}
    >
      <EstimateEditorTable
        versionId="version-1"
        currency={options?.currency ?? "EUR"}
        items={items}
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
        isLaborSplitEnabled={options?.isLaborSplitEnabled}
        isReadOnly={false}
        onQualityFilterChange={vi.fn()}
        onOutlierDetectionMethodChange={vi.fn()}
        onOutlierThresholdChange={vi.fn()}
        onToggleOutlierDismiss={vi.fn()}
        onAddSection={onAddSection}
        onAddLine={onAddLine}
        onDeleteItem={vi.fn()}
        onPatchItem={onPatchItem}
        onApplyBulkMajoration={onApplyBulkMajoration}
        onBulkDeleteLines={onBulkDeleteLines}
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
    </UserProvider>,
  );

  return {
    onPatchItem,
    onApplyBulkMajoration,
    onBulkDeleteLines,
    onAddSection,
    onAddLine,
  };
}

describe("EstimateEditorTable integration", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
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

  it("demande confirmation avant la suppression groupée de lignes", async () => {
    const { onBulkDeleteLines } = renderEstimateEditorTable();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Sélectionner toutes les lignes visibles/i,
      }),
    );

    const deleteButton = screen.getByTestId(
      "estimate-editor-bulk-delete-selection-button",
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(deleteButton);
    expect(onBulkDeleteLines).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(deleteButton);
    await waitFor(() => expect(onBulkDeleteLines).toHaveBeenCalledTimes(1));

    confirmSpy.mockRestore();
  });

  it("transmet les colonnes du preset complet aux lignes en mode MO éclatée", () => {
    localStorage.setItem("est-col-vis", "full");
    renderEstimateEditorTable({ isLaborSplitEnabled: true });

    expect(
      document.querySelector('[data-estimate-item-id="line-1"]'),
    ).toHaveAttribute(
      "data-visible-columns",
      "ds,k_fo,k_mo,labor_role,marge,marque,supply_type",
    );
  });

  it("masque Majoration MO (%) du preset Complet, activable via Personnalisé", () => {
    localStorage.setItem("est-col-vis", "full");
    localStorage.setItem("est-col-override", "true");
    renderEstimateEditorTable();

    expect(screen.queryByText("Majoration MO (%)")).not.toBeInTheDocument();
  });

  it("wires row edition callback to onPatchItem", () => {
    const { onPatchItem } = renderEstimateEditorTable();

    fireEvent.click(screen.getByRole("button", { name: "Patch line-1" }));

    expect(onPatchItem).toHaveBeenCalledWith(
      "line-1",
      { title: "Edited line" },
      { persist: true },
    );
  });

  it("applies bulk majoration on selected rows", async () => {
    const { onApplyBulkMajoration } = renderEstimateEditorTable();

    fireEvent.click(screen.getByRole("button", { name: "Select line-1" }));
    fireEvent.change(screen.getByLabelText("Majoration MO en pourcentage"), {
      target: { value: "120" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Appliquer majoration" }),
    );

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
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Tube acier"),
    );
  });

  it("forwards active estimate currency to editor rows", () => {
    renderEstimateEditorTable({ currency: "USD" });

    expect(screen.getByText("Currency USD")).toBeInTheDocument();
  });

  it("renders clean column labels, a sale group, and centralized help", () => {
    // Preset « Personnalisé » avec toutes les colonnes : Majoration MO (%) est
    // sortie du preset « Complet » et n'est plus visible que sur opt-in.
    localStorage.setItem("est-col-vis", "custom");
    localStorage.setItem(
      "est-col-custom",
      JSON.stringify([
        "supply_type",
        "k_fo",
        "h_mo_majoration",
        "labor_role",
        "k_mo",
        "ds",
        "marge",
        "marque",
      ]),
    );
    localStorage.setItem("est-col-override", "true");
    renderEstimateEditorTable();

    const superHead = document.querySelector(".estimate-table__super-head");
    expect(superHead).toBeInTheDocument();
    expect(
      superHead?.querySelectorAll(".estimate-super-head__spacer"),
    ).toHaveLength(2);
    expect(screen.getByText("Vente")).toHaveClass(
      "estimate-super-head__group--sale",
    );
    expect(screen.getByText("Rentabilité")).toHaveClass(
      "estimate-super-head__group--margin",
    );

    expect(screen.getByText("K FO").closest("span")).toHaveClass(
      "whitespace-nowrap",
    );
    expect(screen.getByText("Majoration MO (%)").closest("span")).toHaveClass(
      "whitespace-normal",
    );
    expect(screen.getByText("PR FO")).toBeInTheDocument();
    expect(screen.getByText("PU").closest("div")).toHaveClass(
      "estimate-col--sale",
    );
    expect(screen.getByText("Prix total").closest("div")).toHaveClass(
      "estimate-col--sale",
    );
    const headerLabels = Array.from(
      document.querySelectorAll(
        '[data-testid="estimate-editor-table-head"] > div',
      ),
      (cell) => cell.textContent?.trim() ?? "",
    );
    expect(headerLabels.indexOf("K MO")).toBeLessThan(
      headerLabels.indexOf("Deboursé sec"),
    );
    expect(headerLabels.indexOf("Marque %")).toBeLessThan(
      headerLabels.indexOf("PU"),
    );
    expect(
      screen.queryByRole("button", { name: /^Aide :/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aide colonnes" }),
    ).toBeInTheDocument();
  });

  it("migrates legacy full preset to manual override when override key is missing", () => {
    localStorage.setItem("est-col-vis", "full");
    localStorage.removeItem("est-col-override");

    renderEstimateEditorTable({ uiMode: "simplified" });

    expect(localStorage.getItem("est-col-override")).toBe("true");
    expect(localStorage.getItem("est-col-vis")).toBe("full");
  });

  it("uses the existing essential view on mobile without overwriting the desktop preset", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(
        (query: string) =>
          ({
            matches: query === "(max-width: 767px)",
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    });

    try {
      localStorage.setItem("est-col-vis", "full");
      localStorage.setItem("est-col-override", "true");

      renderEstimateEditorTable();

      expect(
        document.querySelector('[data-estimate-item-id="line-1"]'),
      ).toHaveAttribute("data-visible-columns", "");
      expect(localStorage.getItem("est-col-vis")).toBe("full");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("uses a compact mobile list with quick add and a secondary full-table mode", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(
        (query: string) =>
          ({
            matches: query === "(max-width: 767px)",
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    });

    try {
      const { onAddSection } = renderEstimateEditorTable({
        items: [
          createItem({
            id: "lot-1",
            item_type: "section",
            title: "Plomberie",
            position: 1,
          }),
          createItem({
            id: "line-1",
            parent_id: "lot-1",
            title: "Tube acier",
            quantity: 2,
            line_total_ht_cents: 1900,
            position: 1,
          }),
        ],
      });

      expect(screen.getByTestId("estimate-mobile-list")).toHaveAttribute(
        "data-mobile-view",
        "compact",
      );
      expect(screen.getByTestId("estimate-editor-table-scroll")).toHaveAttribute(
        "data-mobile-view",
        "compact",
      );
      expect(screen.getByText("Tube acier")).toBeInTheDocument();
      expect(screen.getByText("2 × u")).toBeInTheDocument();
      expect(screen.getByText(/19,00/)).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Modifier la ligne Tube acier" }),
      );
      expect(
        screen.getByRole("dialog", { name: "Modifier la ligne" }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Fermer" }));

      fireEvent.click(screen.getByTestId("estimate-mobile-display-button"));
      expect(
        screen.getByRole("dialog", { name: "Options d’affichage" }),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: /Tableau complet/i }),
      );
      expect(screen.getByTestId("estimate-editor-table-scroll")).toHaveAttribute(
        "data-mobile-view",
        "table",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Revenir à la liste compacte" }),
      );

      fireEvent.click(screen.getByTestId("estimate-mobile-quick-add-button"));
      expect(
        screen.getByRole("dialog", { name: "Ajouter dans le chiffrage" }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Lot" }));
      expect(onAddSection).toHaveBeenCalledWith(null);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("opens the line editor only on mobile and supports consecutive entry", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(
        (query: string) =>
          ({
            matches: query === "(max-width: 767px)",
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    });

    try {
      const { onPatchItem } = renderEstimateEditorTable({
        items: [
          createItem({ id: "line-1", title: "Tube acier", position: 1 }),
          createItem({ id: "line-2", title: "Coude acier", position: 2 }),
        ],
      });

      fireEvent.click(screen.getByRole("button", { name: "Modifier line-1" }));

      expect(
        screen.getByRole("dialog", { name: "Modifier la ligne" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("estimate-mobile-line-title-input")).toHaveValue(
        "Tube acier",
      );

      const quantityInput = screen.getByLabelText("Quantité");
      fireEvent.focus(quantityInput);
      fireEvent.change(quantityInput, { target: { value: "3,5" } });
      fireEvent.blur(quantityInput);

      expect(onPatchItem).toHaveBeenCalledWith(
        "line-1",
        { quantity: 3.5 },
        { persist: true },
      );

      fireEvent.click(screen.getByRole("button", { name: "Suivante" }));
      expect(screen.getByTestId("estimate-mobile-line-title-input")).toHaveValue(
        "Coude acier",
      );
      expect(screen.getByRole("button", { name: "Suivante" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Précédente" })).toBeEnabled();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("keeps the mobile line editor absent on tablet", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(
        (query: string) =>
          ({
            matches:
              query === "(min-width: 768px) and (max-width: 1024px)",
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      ),
    });

    try {
      renderEstimateEditorTable();
      expect(
        screen.queryByRole("button", { name: "Modifier line-1" }),
      ).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("propagates deep connector metadata for depth 3 line rows", () => {
    renderEstimateEditorTable({
      items: [
        createItem({
          id: "lot-1",
          item_type: "section",
          title: "Lot",
          position: 1,
        }),
        createItem({
          id: "chapter-1",
          item_type: "section",
          parent_id: "lot-1",
          title: "Chapitre",
          position: 1,
        }),
        createItem({
          id: "subchapter-1",
          item_type: "section",
          parent_id: "chapter-1",
          title: "Sous-chapitre",
          position: 1,
        }),
        createItem({
          id: "line-deep",
          item_type: "line",
          parent_id: "subchapter-1",
          title: "Ligne profonde",
          position: 1,
        }),
      ],
    });

    const deepLineRow = document.querySelector<HTMLElement>(
      '[data-estimate-item-id="line-deep"]',
    );
    expect(deepLineRow).not.toBeNull();
    expect(deepLineRow?.dataset.connectorDepth).toBe("3");
    expect(deepLineRow?.dataset.connectorIsLastChild).toBe("true");
    expect(deepLineRow?.dataset.connectorAncestorFlags).toBe("true,true,true");
    expect(deepLineRow?.dataset.connectorHasVisibleChildren).toBe("false");
  });
});
