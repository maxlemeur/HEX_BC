import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  EstimateItem,
  ItemPatch,
  LaborRole,
  SupplyType,
} from "@/components/estimates/components/estimate-editor-row/shared";
import type { GridNavigationResult, GridSelection } from "@/hooks/useGridNavigation";

import { useEstimateGridCellActions, useEstimateGridClipboardEvents } from "./useEstimateGridCellActions";

const LINE_COLUMNS = ["title", "quantity", "unit_price", "unit", "k_fo", "pu_ht"];

function line(id: string, overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id,
    item_type: "line",
    title: `Ligne ${id}`,
    quantity: 2,
    unit_code: "u",
    description: null,
    unit_price_ht_cents: 1250,
    k_fo: 1.05,
    k_mo: 1,
    pu_ht_cents: 4321,
    line_total_ht_cents: 8642,
    ...overrides,
  } as EstimateItem;
}

function section(id: string, title: string): EstimateItem {
  return { id, item_type: "section", title } as EstimateItem;
}

function single(rowId: string, columnKey: string): GridSelection {
  return { active: { rowId, columnKey }, isRange: false, columnKeys: [columnKey], rows: [{ rowId, columnKeys: [columnKey] }] };
}

function range(rowIds: string[], columnKeys: string[]): GridSelection {
  return {
    active: { rowId: rowIds[0], columnKey: columnKeys[0] },
    isRange: true,
    columnKeys,
    rows: rowIds.map((rowId) => ({ rowId, columnKeys })),
  };
}

type HarnessOptions = {
  items: EstimateItem[];
  isReadOnly?: boolean;
  isV3?: boolean;
  hasSelectedLines?: boolean;
  withBulkWriter?: boolean;
  /** What the editor answers to a grouped write; `false` is a refusal. */
  bulkAnswer?: boolean;
};

function createHarness({
  items,
  isReadOnly = false,
  isV3 = true,
  hasSelectedLines = false,
  withBulkWriter = true,
  bulkAnswer = true,
}: HarnessOptions) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows = items.map((item) => ({
    rowId: item.id,
    columnKeys: item.item_type === "section" ? ["title"] : LINE_COLUMNS,
  }));
  const onPatchItem = vi.fn<(itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => void>();
  const onApplyCellPatches = vi.fn(
    async (entries: ReadonlyArray<{ itemId: string; patch: ItemPatch }>) => {
      void entries;
      return bulkAnswer;
    },
  );
  const onLegacyUnitDraftChange = vi.fn<(itemId: string, value: string) => void>();
  const onLegacyUnitDraftDiscard = vi.fn<(itemId: string, rowId: string) => void>();
  const onLeftovers = vi.fn<(message: { title: string; description: string }) => void>();
  const supplyTypes: SupplyType[] = [];
  const laborRoles: LaborRole[] = [];
  const legacyUnitByItemId = {};
  const getItem = (rowId: string) => byId.get(rowId);

  const view = renderHook(
    (props: { isReadOnly: boolean; hasSelectedLines: boolean }) =>
      useEstimateGridCellActions({
        isReadOnly: props.isReadOnly,
        isV3,
        currency: "EUR",
        supplyTypes,
        laborRoles,
        legacyUnitByItemId,
        rows,
        getItem,
        hasSelectedLines: props.hasSelectedLines,
        onPatchItem,
        onApplyCellPatches: withBulkWriter ? onApplyCellPatches : undefined,
        onLegacyUnitDraftChange,
        onLegacyUnitDraftDiscard,
        onLeftovers,
      }),
    { initialProps: { isReadOnly, hasSelectedLines } },
  );

  return {
    view,
    onPatchItem,
    onApplyCellPatches,
    onLegacyUnitDraftChange,
    onLegacyUnitDraftDiscard,
    onLeftovers,
  };
}

describe("useEstimateGridCellActions", () => {
  it("sends the cells of several stored lines as one grouped write", () => {
    const harness = createHarness({ items: [line("a", { k_fo: 1.02 }), line("b"), line("c")] });

    harness.view.result.current.onFillDown(range(["a", "b", "c"], ["k_fo"]));

    expect(harness.onApplyCellPatches).toHaveBeenCalledTimes(1);
    expect(harness.onApplyCellPatches).toHaveBeenCalledWith([
      { itemId: "b", patch: { k_fo: 1.02, k_fo_manual: true } },
      { itemId: "c", patch: { k_fo: 1.02, k_fo_manual: true } },
    ]);
    expect(harness.onPatchItem).not.toHaveBeenCalled();
    expect(harness.onLeftovers).not.toHaveBeenCalled();
  });

  it("merges the cells of one line into one patch of the grouped write", () => {
    const harness = createHarness({ items: [line("a"), line("b")] });

    expect(harness.view.result.current.pasteText("3\t9,5\n4\t10", single("a", "quantity"))).toBe(true);

    expect(harness.onApplyCellPatches).toHaveBeenCalledWith([
      { itemId: "a", patch: { quantity: 3, unit_price_ht_cents: 950 } },
      { itemId: "b", patch: { quantity: 4, unit_price_ht_cents: 1000 } },
    ]);
  });

  it("writes a single line through the ordinary line write", () => {
    const harness = createHarness({ items: [line("a")] });

    expect(harness.view.result.current.pasteText("7", single("a", "quantity"))).toBe(true);

    expect(harness.onApplyCellPatches).not.toHaveBeenCalled();
    expect(harness.onPatchItem).toHaveBeenCalledTimes(1);
    expect(harness.onPatchItem).toHaveBeenCalledWith("a", { quantity: 7 }, { persist: true });
  });

  it("keeps the single write for a section title and for a line still being created", () => {
    const harness = createHarness({
      items: [
        section("s", "Lot 1"),
        line("a"),
        line("tmp:1", { title: "Brouillon" }),
        line("b", { _pendingCreate: true } as Partial<EstimateItem>),
      ],
    });

    harness.view.result.current.onClearSelection(range(["s", "a", "tmp:1", "b"], ["title"]));

    expect(harness.onApplyCellPatches).not.toHaveBeenCalled();
    expect(harness.onPatchItem.mock.calls.map(([itemId]) => itemId).sort()).toEqual(["a", "b", "s", "tmp:1"]);
    for (const [itemId, patch, options] of harness.onPatchItem.mock.calls) {
      // A row is never left nameless: the cleared designation takes the editor's default name.
      expect(patch).toEqual({ title: itemId === "s" ? "Sans titre" : "Nouvelle ligne" });
      expect(options).toEqual({ persist: true });
    }
  });

  it("writes the rest of a mixed gesture only once the grouped write is accepted", async () => {
    const harness = createHarness({
      items: [section("s", "Lot 1"), line("a"), line("b"), line("tmp:1", { title: "Brouillon" })],
    });

    harness.view.result.current.pasteText("Même nom", range(["s", "a", "b", "tmp:1"], ["title"]));

    expect(harness.onApplyCellPatches).toHaveBeenCalledWith([
      { itemId: "a", patch: { title: "Même nom" } },
      { itemId: "b", patch: { title: "Même nom" } },
    ]);
    // Nothing is written beside the batch until the editor has answered.
    expect(harness.onPatchItem).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(harness.onPatchItem).toHaveBeenCalledTimes(2));
    expect(harness.onPatchItem.mock.calls).toEqual([
      ["s", { title: "Même nom" }, { persist: true }],
      ["tmp:1", { title: "Même nom" }, { persist: true }],
    ]);
  });

  it("writes nothing at all when the editor refuses the grouped write", async () => {
    const harness = createHarness({
      items: [section("s", "Lot 1"), line("a"), line("b")],
      isV3: false,
      bulkAnswer: false,
    });

    harness.view.result.current.pasteText("abc", range(["s", "a", "b"], ["title", "unit", "quantity"]));

    expect(harness.onApplyCellPatches).toHaveBeenCalledTimes(1);
    await harness.onApplyCellPatches.mock.results[0].value;
    await Promise.resolve();

    expect(harness.onPatchItem).not.toHaveBeenCalled();
    expect(harness.onLegacyUnitDraftChange).not.toHaveBeenCalled();
    expect(harness.onLegacyUnitDraftDiscard).not.toHaveBeenCalled();
    // The editor already said why it refused: no second message about the cells left out.
    expect(harness.onLeftovers).not.toHaveBeenCalled();
  });

  it("reports the cells left out once the grouped write is accepted", async () => {
    const harness = createHarness({ items: [line("a"), line("b"), line("c")] });

    harness.view.result.current.pasteText("1\nabc\n3", single("a", "quantity"));

    expect(harness.onLeftovers).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.onLeftovers).toHaveBeenCalledTimes(1));
    expect(harness.onLeftovers.mock.calls[0][0].title).toBe("Collage incomplet");
  });

  it("falls back to one write per line when the editor has no grouped write", () => {
    const harness = createHarness({ items: [line("a", { k_fo: 1.02 }), line("b"), line("c")], withBulkWriter: false });

    harness.view.result.current.onFillDown(range(["a", "b", "c"], ["k_fo"]));

    expect(harness.onPatchItem.mock.calls).toEqual([
      ["b", { k_fo: 1.02, k_fo_manual: true }, { persist: true }],
      ["c", { k_fo: 1.02, k_fo_manual: true }, { persist: true }],
    ]);
  });

  it("says what a paste left out and still writes the rest", () => {
    const harness = createHarness({ items: [line("a"), line("b")] });

    harness.view.result.current.pasteText("abc\n5", single("a", "quantity"));

    expect(harness.onPatchItem).toHaveBeenCalledWith("b", { quantity: 5 }, { persist: true });
    expect(harness.onLeftovers).toHaveBeenCalledTimes(1);
    const [message] = harness.onLeftovers.mock.calls[0];
    expect(message.title).toBe("Collage incomplet");
    expect(message.description).toContain("« abc »");
  });

  it("says that a fill down met a computed cell", () => {
    const harness = createHarness({ items: [line("a"), line("b")] });

    harness.view.result.current.onFillDown(range(["a", "b"], ["pu_ht"]));

    expect(harness.onPatchItem).not.toHaveBeenCalled();
    expect(harness.onLeftovers).toHaveBeenCalledWith({
      title: "Recopie incomplète",
      description: "Une cellule calculée n'a pas été modifiée.",
    });
  });

  it("clears inputs without a word about the computed cells of the selection", () => {
    const harness = createHarness({ items: [line("a")] });

    expect(harness.view.result.current.onClearSelection(range(["a"], ["unit_price", "pu_ht"]))).toBe(true);

    expect(harness.onPatchItem).toHaveBeenCalledWith("a", { unit_price_ht_cents: 0 }, { persist: true });
    expect(harness.onLeftovers).not.toHaveBeenCalled();
  });

  it("drops the unit draft of a stored legacy line so the cell shows what was written", () => {
    const harness = createHarness({ items: [line("a")], isV3: false });

    harness.view.result.current.pasteText("ml", single("a", "unit"));

    // The stored value is what undo restores: a draft kept over it would hide the undo.
    expect(harness.onLegacyUnitDraftDiscard).toHaveBeenCalledWith("a", "a");
    expect(harness.onLegacyUnitDraftChange).not.toHaveBeenCalled();
    expect(harness.onPatchItem).toHaveBeenCalledWith("a", { description: "ml" }, { persist: true });
  });

  it("drops the unit drafts of a grouped legacy write once it is accepted", async () => {
    const harness = createHarness({ items: [line("a"), line("b")], isV3: false });

    harness.view.result.current.pasteText("ml", range(["a", "b"], ["unit"]));

    expect(harness.onLegacyUnitDraftDiscard).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.onLegacyUnitDraftDiscard).toHaveBeenCalledTimes(2));
    expect(harness.onLegacyUnitDraftDiscard.mock.calls).toEqual([
      ["a", "a"],
      ["b", "b"],
    ]);
    expect(harness.onPatchItem).not.toHaveBeenCalled();
  });

  it("keeps the unit draft of a legacy line still being created", () => {
    const harness = createHarness({ items: [line("tmp:1")], isV3: false });

    harness.view.result.current.pasteText("ml", single("tmp:1", "unit"));

    expect(harness.onLegacyUnitDraftChange).toHaveBeenCalledWith("tmp:1", "ml");
    expect(harness.onLegacyUnitDraftDiscard).not.toHaveBeenCalled();
    expect(harness.onPatchItem).toHaveBeenCalledWith("tmp:1", { description: "ml" }, { persist: true });
  });

  it("leaves a block pasted on a designation to the line import", () => {
    const harness = createHarness({ items: [line("a"), line("b")] });
    const actions = harness.view.result.current;

    expect(actions.pasteText("Tube cuivre\t12\nCoude\t4", single("a", "title"))).toBe(false);
    expect(actions.pasteText("Tube cuivre\nCoude", single("a", "title"))).toBe(false);
    expect(harness.onPatchItem).not.toHaveBeenCalled();
    expect(harness.onApplyCellPatches).not.toHaveBeenCalled();

    expect(actions.pasteText("Tube cuivre", single("a", "title"))).toBe(true);
    expect(harness.onPatchItem).toHaveBeenCalledWith("a", { title: "Tube cuivre" }, { persist: true });
  });

  it("does not take an empty clipboard", () => {
    const harness = createHarness({ items: [line("a")] });

    expect(harness.view.result.current.pasteText("", single("a", "quantity"))).toBe(false);
    expect(harness.onPatchItem).not.toHaveBeenCalled();
  });

  it("writes nothing in a read-only estimate but still copies", () => {
    const harness = createHarness({ items: [line("a", { k_fo: 1.02 }), line("b")], isReadOnly: true });
    const actions = harness.view.result.current;

    expect(actions.onClearSelection(single("a", "quantity"))).toBe(false);
    expect(actions.pasteText("7", single("a", "quantity"))).toBe(false);
    actions.onFillDown(range(["a", "b"], ["k_fo"]));

    expect(harness.onPatchItem).not.toHaveBeenCalled();
    expect(harness.onApplyCellPatches).not.toHaveBeenCalled();
    expect(actions.copySelection(range(["a", "b"], ["k_fo"]))).toBe("1,02\n1,05");
  });

  it("leaves Suppr, copy, paste and fill down to the checked lines", () => {
    const harness = createHarness({
      items: [line("a", { k_fo: 1.02 }), line("b"), line("c")],
      hasSelectedLines: true,
    });
    const actions = harness.view.result.current;

    expect(actions.onClearSelection(single("a", "quantity"))).toBe(false);
    expect(actions.copySelection(single("a", "quantity"))).toBeNull();
    expect(actions.pasteText("7", single("a", "quantity"))).toBe(false);
    actions.onFillDown(range(["a", "b", "c"], ["k_fo"]));
    expect(harness.onPatchItem).not.toHaveBeenCalled();
    expect(harness.onApplyCellPatches).not.toHaveBeenCalled();
  });

  it("keeps the same actions across renders and reads the latest editor state", () => {
    const harness = createHarness({ items: [line("a")] });
    const actions = harness.view.result.current;

    harness.view.rerender({ isReadOnly: true, hasSelectedLines: false });

    expect(harness.view.result.current).toBe(actions);
    expect(actions.pasteText("7", single("a", "quantity"))).toBe(false);
    expect(harness.onPatchItem).not.toHaveBeenCalled();
  });
});

describe("useEstimateGridClipboardEvents", () => {
  function mountClipboard(options: { isReadOnly?: boolean; copied?: string | null } = {}) {
    const card = document.createElement("div");
    const cell = document.createElement("div");
    cell.setAttribute("data-cell-column-key", "quantity");
    cell.tabIndex = 0;
    const field = document.createElement("input");
    card.append(cell, field);
    document.body.append(card);

    const selection = single("a", "quantity");
    const navigation = { getSelection: vi.fn(() => selection) } as unknown as GridNavigationResult;
    const cellActions = {
      onClearSelection: vi.fn(() => true),
      onFillDown: vi.fn(),
      copySelection: vi.fn(() => (options.copied === undefined ? "2" : options.copied)),
      pasteText: vi.fn(() => true),
    };
    const cellPasteHandlerRef: { current: ((text: string, target: Element) => boolean) | null } = { current: null };
    const view = renderHook(() =>
      useEstimateGridClipboardEvents({
        navigation,
        cellActions,
        tableCardRef: { current: card },
        cellPasteHandlerRef,
        isReadOnly: options.isReadOnly ?? false,
      }),
    );
    const dispatch = (type: "copy" | "cut") => {
      const setData = vi.fn();
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { setData } });
      window.dispatchEvent(event);
      return { event, setData };
    };
    const cleanup = () => {
      view.unmount();
      card.remove();
    };
    return { cell, field, selection, cellActions, cellPasteHandlerRef, dispatch, cleanup, view };
  }

  it("copies the selection when a cell has the focus", () => {
    const grid = mountClipboard();
    grid.cell.focus();

    const { event, setData } = grid.dispatch("copy");

    expect(setData).toHaveBeenCalledWith("text/plain", "2");
    expect(event.defaultPrevented).toBe(true);
    expect(grid.cellActions.onClearSelection).not.toHaveBeenCalled();
    grid.cleanup();
  });

  it("cuts by copying then clearing, and only copies in a read-only estimate", () => {
    const grid = mountClipboard();
    grid.cell.focus();
    grid.dispatch("cut");
    expect(grid.cellActions.onClearSelection).toHaveBeenCalledWith(grid.selection);
    grid.cleanup();

    const readOnly = mountClipboard({ isReadOnly: true });
    readOnly.cell.focus();
    const { setData } = readOnly.dispatch("cut");
    expect(setData).toHaveBeenCalledWith("text/plain", "2");
    expect(readOnly.cellActions.onClearSelection).not.toHaveBeenCalled();
    readOnly.cleanup();
  });

  it("leaves the browser clipboard alone while a field is being typed", () => {
    const grid = mountClipboard();
    grid.field.focus();

    const { event, setData } = grid.dispatch("copy");

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    grid.cleanup();
  });

  it("leaves the clipboard to the checked lines when the cells do not own it", () => {
    const grid = mountClipboard({ copied: null });
    grid.cell.focus();

    const { event, setData } = grid.dispatch("copy");

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    grid.cleanup();
  });

  it("pastes into the cells from a cell and not from a field", () => {
    const grid = mountClipboard();

    expect(grid.cellPasteHandlerRef.current?.("7", grid.cell)).toBe(true);
    expect(grid.cellActions.pasteText).toHaveBeenCalledWith("7", grid.selection);
    expect(grid.cellPasteHandlerRef.current?.("7", grid.field)).toBe(false);

    grid.cleanup();
    expect(grid.cellPasteHandlerRef.current).toBeNull();
  });
});
