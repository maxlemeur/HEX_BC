"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";

import type {
  EstimateItem,
  ItemPatch,
  LaborRole,
  SupplyType,
} from "@/components/estimates/components/estimate-editor-row/shared";
import { SPREADSHEET_COLUMN_KEYS } from "@/components/estimates/components/estimate-editor-row/shared";
import {
  describeEstimateGridPlanLeftovers,
  groupEstimateGridWrites,
  parseClipboardMatrix,
  planEstimateGridClear,
  planEstimateGridFillDown,
  planEstimateGridPaste,
  serializeEstimateGridSelection,
  type EstimateGridCellContext,
  type EstimateGridWritePlan,
} from "@/components/estimates/grid/estimate-grid-cell-actions";
import type { GridNavigationResult, GridSelection } from "@/hooks/useGridNavigation";
import type { SpreadsheetNavigationRow } from "@/hooks/useSpreadsheetNavigation";
import { isPendingCreateEstimateItem, isTempEstimateItemId } from "@/lib/estimates/editor-items";
import type { SupportedEstimateCurrency } from "@/lib/money";

// Cell-level « Suppr », Ctrl+D, Ctrl+C, Ctrl+X and Ctrl+V of the estimate grid:
// the pure planners decide what to write, this hook sends the writes through
// the editor (one history entry for several lines) and says what was left out.

type UseEstimateGridCellActionsParams = {
  isReadOnly: boolean;
  isV3: boolean;
  currency: SupportedEstimateCurrency;
  supplyTypes: readonly SupplyType[];
  laborRoles: readonly LaborRole[];
  /** v1/v2 only: unit text shown per line id. */
  legacyUnitByItemId: Readonly<Record<string, string>>;
  rows: readonly SpreadsheetNavigationRow[];
  /** Row id (client key) → item. */
  getItem: (rowId: string) => EstimateItem | undefined;
  /** Checked lines own Suppr, copy and paste: the cells then leave the keys alone. */
  hasSelectedLines: boolean;
  onPatchItem: (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => void;
  /** Several stored lines in one write and one undo step. `false`: refused, nothing was written. */
  onApplyCellPatches?: (
    entries: ReadonlyArray<{ itemId: string; patch: ItemPatch }>,
  ) => Promise<boolean | void>;
  /** v1/v2 unit of a line still being created: the cell shows the draft until the line is stored. */
  onLegacyUnitDraftChange: (itemId: string, value: string) => void;
  /** v1/v2 unit of a stored line: the cell goes back to the stored value, which undo restores. */
  onLegacyUnitDraftDiscard: (itemId: string, rowId: string) => void;
  onLeftovers: (message: { title: string; description: string }) => void;
};

export type EstimateGridCellActions = {
  /** Suppr. `false` leaves the key to the page (checked lines, read-only). */
  onClearSelection: (selection: GridSelection) => boolean;
  /** Ctrl+D. */
  onFillDown: (selection: GridSelection) => void;
  /** Tab-separated text of the selection, `null` when the cells do not own the clipboard. */
  copySelection: (selection: GridSelection) => string | null;
  /** `true` when the cells took the text; `false` leaves it to the line import. */
  pasteText: (text: string, selection: GridSelection) => boolean;
};

export function useEstimateGridCellActions(
  params: UseEstimateGridCellActionsParams,
): EstimateGridCellActions {
  const { isV3, currency, supplyTypes, laborRoles, legacyUnitByItemId } = params;

  const context = useMemo<EstimateGridCellContext>(
    () => ({
      isV3,
      currency,
      supplyTypeOptions: supplyTypes.map((type) => ({ id: type.id, code: type.code, label: type.name })),
      laborRoleOptions: laborRoles.map((role) => ({
        id: role.id,
        label: role.name,
        disabled: !role.is_active,
      })),
      legacyUnitByItemId,
    }),
    [currency, isV3, laborRoles, legacyUnitByItemId, supplyTypes],
  );

  // The grid calls these from key handlers long after the render that built
  // them: they read the latest editor state instead of closing over it.
  const latestRef = useRef({ params, context });
  useLayoutEffect(() => {
    latestRef.current = { params, context };
  });

  const applyPlan = useCallback((plan: EstimateGridWritePlan, title: string) => {
    const { params: latest } = latestRef.current;
    const rowIdByItemId = new Map(plan.writes.map((write) => [write.itemId, write.rowId]));
    type Entry = { itemId: string; rowId: string; patch: ItemPatch; legacyUnitDraft?: string; isStoredLine: boolean };
    const bulkEntries: Entry[] = [];
    const singleEntries: Entry[] = [];

    for (const write of groupEstimateGridWrites(plan.writes)) {
      const rowId = rowIdByItemId.get(write.itemId) ?? write.itemId;
      const item = latest.getItem(rowId);
      // A line still being created has no stored row to write in a batch, and
      // a section title is not a line: both keep the single-item write.
      const isStoredLine =
        item?.item_type === "line" && !isTempEstimateItemId(item.id) && !isPendingCreateEstimateItem(item);
      (isStoredLine ? bulkEntries : singleEntries).push({ ...write, rowId, isStoredLine });
    }

    // The unit cell of a v1/v2 line shows a draft over the stored value. On a
    // stored line the write is the value: the draft goes, so undo is visible.
    const syncLegacyUnitDraft = (entry: Entry) => {
      if (entry.legacyUnitDraft === undefined) return;
      if (entry.isStoredLine) latest.onLegacyUnitDraftDiscard(entry.itemId, entry.rowId);
      else latest.onLegacyUnitDraftChange(entry.itemId, entry.legacyUnitDraft);
    };
    const writeOneByOne = (entries: readonly Entry[]) => {
      for (const entry of entries) {
        syncLegacyUnitDraft(entry);
        latest.onPatchItem(entry.itemId, entry.patch, { persist: true });
      }
    };
    const reportLeftovers = () => {
      const leftovers = describeEstimateGridPlanLeftovers(plan);
      if (leftovers) latest.onLeftovers({ title, description: leftovers });
    };

    if (bulkEntries.length > 1 && latest.onApplyCellPatches) {
      // The batch goes first: when the editor refuses it (stale document,
      // save in progress), the rest of the gesture is not written either.
      void latest
        .onApplyCellPatches(bulkEntries.map(({ itemId, patch }) => ({ itemId, patch })))
        .then((applied) => {
          if (applied === false) return;
          bulkEntries.forEach(syncLegacyUnitDraft);
          writeOneByOne(singleEntries);
          reportLeftovers();
        });
      return;
    }

    writeOneByOne([...singleEntries, ...bulkEntries]);
    reportLeftovers();
  }, []);

  const onClearSelection = useCallback(
    (selection: GridSelection) => {
      const { params: latest, context: latestContext } = latestRef.current;
      if (latest.isReadOnly || latest.hasSelectedLines) return false;
      const plan = planEstimateGridClear(selection, latest.getItem, latestContext);
      // Suppr on computed cells only is a no-op, as in a protected sheet: no message.
      applyPlan({ ...plan, readOnlyCount: 0 }, "Cellules non effacées");
      return true;
    },
    [applyPlan],
  );

  const onFillDown = useCallback(
    (selection: GridSelection) => {
      const { params: latest, context: latestContext } = latestRef.current;
      // Checked lines own the editing keys, as for Suppr and paste.
      if (latest.isReadOnly || latest.hasSelectedLines) return;
      applyPlan(
        planEstimateGridFillDown(selection, latest.rows, latest.getItem, latestContext),
        "Recopie incomplète",
      );
    },
    [applyPlan],
  );

  const copySelection = useCallback((selection: GridSelection) => {
    const { params: latest, context: latestContext } = latestRef.current;
    if (latest.hasSelectedLines) return null;
    return serializeEstimateGridSelection(selection, latest.getItem, latestContext);
  }, []);

  const pasteText = useCallback(
    (text: string, selection: GridSelection) => {
      const { params: latest, context: latestContext } = latestRef.current;
      if (latest.isReadOnly || latest.hasSelectedLines) return false;
      const matrix = parseClipboardMatrix(text);
      if (matrix.length === 0) return false;
      const isBlock = matrix.length > 1 || matrix.some((line) => line.length > 1);
      // A block pasted on a designation is a list of lines to import, with its
      // preview: the grid keeps that door open on the first column.
      if (isBlock && selection.active.columnKey === SPREADSHEET_COLUMN_KEYS.title) return false;
      applyPlan(
        planEstimateGridPaste(selection, matrix, latest.rows, latest.getItem, latestContext),
        "Collage incomplet",
      );
      return true;
    },
    [applyPlan],
  );

  return useMemo(
    () => ({ onClearSelection, onFillDown, copySelection, pasteText }),
    [copySelection, onClearSelection, onFillDown, pasteText],
  );
}

function isGridCellElement(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.hasAttribute("data-cell-column-key");
}

type UseEstimateGridClipboardEventsParams = {
  navigation: GridNavigationResult;
  cellActions: EstimateGridCellActions;
  tableCardRef: RefObject<HTMLElement | null>;
  /** Filled here, read by the table's paste listener before it opens the line import. */
  cellPasteHandlerRef: RefObject<((text: string, target: Element) => boolean) | null>;
  isReadOnly: boolean;
};

/**
 * Ctrl+C / Ctrl+X on a cell that has the focus (not on its editor: a field
 * being typed keeps the browser's own clipboard), and the cell half of Ctrl+V.
 */
export function useEstimateGridClipboardEvents({
  navigation,
  cellActions,
  tableCardRef,
  cellPasteHandlerRef,
  isReadOnly,
}: UseEstimateGridClipboardEventsParams) {
  useEffect(() => {
    cellPasteHandlerRef.current = (text, target) => {
      if (!isGridCellElement(target)) return false;
      const selection = navigation.getSelection();
      if (!selection) return false;
      return cellActions.pasteText(text, selection);
    };
    return () => {
      cellPasteHandlerRef.current = null;
    };
  }, [cellActions, cellPasteHandlerRef, navigation]);

  useEffect(() => {
    const handleCopyOrCut = (event: ClipboardEvent) => {
      const target = document.activeElement;
      if (!isGridCellElement(target)) return;
      if (!tableCardRef.current?.contains(target)) return;
      const selection = navigation.getSelection();
      if (!selection || !event.clipboardData) return;
      const text = cellActions.copySelection(selection);
      if (text === null) return;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      if (event.type === "cut" && !isReadOnly) cellActions.onClearSelection(selection);
    };
    window.addEventListener("copy", handleCopyOrCut);
    window.addEventListener("cut", handleCopyOrCut);
    return () => {
      window.removeEventListener("copy", handleCopyOrCut);
      window.removeEventListener("cut", handleCopyOrCut);
    };
  }, [cellActions, isReadOnly, navigation, tableCardRef]);
}
