"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
} from "react";

const CELL_ID_SEPARATOR = "::";

type SpreadsheetEditorElement =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;
type SpreadsheetCellElement = HTMLDivElement;

export type SpreadsheetMoveDirection =
  | "next"
  | "previous"
  | "down"
  | "up";

type NormalizedCell = {
  id: string;
  rowId: string;
  columnKey: string;
  rowIndex: number;
};

export type SpreadsheetNavigationModel = {
  flat: NormalizedCell[];
  flatIds: string[];
  flatIdSet: Set<string>;
  byId: Map<string, NormalizedCell>;
  byFlatIndex: Map<string, number>;
  rowOrder: string[];
  rowColumns: Map<string, string[]>;
};

export type SpreadsheetCell = {
  rowId: string;
  columnKey: string;
};

export type SpreadsheetNavigationRow = {
  rowId: string;
  columnKeys: string[];
};

export type SpreadsheetNavigationOptions = {
  rows: SpreadsheetNavigationRow[];
  disabled?: boolean;
};

export type SpreadsheetCellProps = {
  ref: RefCallback<SpreadsheetCellElement>;
  role: "gridcell";
  tabIndex: number;
  onFocus: (event: FocusEvent<SpreadsheetCellElement>) => void;
  onBlur: (event: FocusEvent<SpreadsheetCellElement>) => void;
  onKeyDown: (event: KeyboardEvent<SpreadsheetCellElement>) => void;
  onMouseDown: () => void;
  onDoubleClick: () => void;
  "data-cell-id": string;
};

export type SpreadsheetEditorProps<T extends SpreadsheetEditorElement> = {
  ref: RefCallback<T>;
  tabIndex: -1;
  onFocus: (event: FocusEvent<T>) => void;
  onBlur: (event: FocusEvent<T>) => void;
  onKeyDown: (event: KeyboardEvent<T>) => void;
};

export type SpreadsheetNavigationResult = {
  activeCell: SpreadsheetCell | null;
  editingCell: SpreadsheetCell | null;
  isCellActive: (cell: SpreadsheetCell) => boolean;
  isCellEditing: (cell: SpreadsheetCell) => boolean;
  getCellProps: (cell: SpreadsheetCell) => SpreadsheetCellProps;
  getEditorProps: <T extends SpreadsheetEditorElement>(
    cell: SpreadsheetCell
  ) => SpreadsheetEditorProps<T>;
};

function toCellId(cell: SpreadsheetCell) {
  return `${cell.rowId}${CELL_ID_SEPARATOR}${cell.columnKey}`;
}

function isEditorElement(value: EventTarget | null): value is SpreadsheetEditorElement {
  return (
    value instanceof HTMLInputElement ||
    value instanceof HTMLSelectElement ||
    value instanceof HTMLTextAreaElement
  );
}

function readEditorValue(editor: SpreadsheetEditorElement) {
  return editor.value;
}

function writeEditorValue(editor: SpreadsheetEditorElement, value: string) {
  if (editor.value === value) return;

  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(editor),
    "value"
  );
  descriptor?.set?.call(editor, value);

  if (!descriptor?.set) {
    editor.value = value;
  }

  const eventName = editor instanceof HTMLSelectElement ? "change" : "input";
  editor.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function mod(value: number, modulo: number) {
  return ((value % modulo) + modulo) % modulo;
}

export function createSpreadsheetNavigationModel(
  rows: SpreadsheetNavigationRow[]
): SpreadsheetNavigationModel {
  const flat: NormalizedCell[] = [];
  const byId = new Map<string, NormalizedCell>();
  const byFlatIndex = new Map<string, number>();
  const rowOrder: string[] = [];
  const rowColumns = new Map<string, string[]>();

  rows.forEach((row) => {
    const columns = row.columnKeys.filter((columnKey, index, arr) => {
      return columnKey.trim().length > 0 && arr.indexOf(columnKey) === index;
    });

    if (columns.length === 0) return;

    const rowIndex = rowOrder.length;
    rowOrder.push(row.rowId);
    rowColumns.set(row.rowId, columns);

    columns.forEach((columnKey) => {
      const cell: NormalizedCell = {
        id: toCellId({ rowId: row.rowId, columnKey }),
        rowId: row.rowId,
        columnKey,
        rowIndex,
      };
      byFlatIndex.set(cell.id, flat.length);
      flat.push(cell);
      byId.set(cell.id, cell);
    });
  });

  const flatIds = flat.map((cell) => cell.id);
  return {
    flat,
    flatIds,
    flatIdSet: new Set(flatIds),
    byId,
    byFlatIndex,
    rowOrder,
    rowColumns,
  };
}

export function resolveSpreadsheetNextCellId(
  model: SpreadsheetNavigationModel,
  fromCellId: string,
  direction: SpreadsheetMoveDirection
) {
  if (model.flatIds.length === 0) return null;

  const flatIndex = model.byFlatIndex.get(fromCellId);
  if (flatIndex === undefined) {
    return model.flatIds[0] ?? null;
  }

  if (direction === "next" || direction === "previous") {
    const delta = direction === "next" ? 1 : -1;
    const nextIndex = mod(flatIndex + delta, model.flatIds.length);
    return model.flatIds[nextIndex] ?? null;
  }

  const currentCell = model.byId.get(fromCellId);
  if (!currentCell || model.rowOrder.length === 0) {
    return fromCellId;
  }

  const delta = direction === "down" ? 1 : -1;
  const rowCount = model.rowOrder.length;

  for (let offset = 1; offset <= rowCount; offset += 1) {
    const nextRowIndex = mod(currentCell.rowIndex + delta * offset, rowCount);
    const nextRowId = model.rowOrder[nextRowIndex];
    const nextRowColumns = model.rowColumns.get(nextRowId) ?? [];

    if (!nextRowColumns.includes(currentCell.columnKey)) {
      continue;
    }

    return toCellId({
      rowId: nextRowId,
      columnKey: currentCell.columnKey,
    });
  }

  return fromCellId;
}

export function useSpreadsheetNavigation({
  rows,
  disabled = false,
}: SpreadsheetNavigationOptions): SpreadsheetNavigationResult {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);

  const cellElementsRef = useRef<Map<string, SpreadsheetCellElement>>(new Map());
  const editorElementsRef = useRef<Map<string, SpreadsheetEditorElement>>(new Map());
  const editInitialValuesRef = useRef<Map<string, string>>(new Map());

  const navigationModel = useMemo(() => createSpreadsheetNavigationModel(rows), [rows]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (disabled || navigationModel.flatIds.length === 0) {
      setActiveCellId(null);
      setEditingCellId(null);
      editInitialValuesRef.current.clear();
      return;
    }

    setActiveCellId((previous) => {
      if (previous && navigationModel.flatIdSet.has(previous)) {
        return previous;
      }
      return navigationModel.flatIds[0] ?? null;
    });

    setEditingCellId((previous) => {
      if (previous && navigationModel.flatIdSet.has(previous)) {
        return previous;
      }
      return null;
    });
  }, [disabled, navigationModel.flatIdSet, navigationModel.flatIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (disabled) return;
    if (!activeCellId) return;
    if (editingCellId === activeCellId) return;

    const cellElement = cellElementsRef.current.get(activeCellId);
    if (!cellElement) return;

    if (document.activeElement !== cellElement) {
      cellElement.focus();
    }
  }, [activeCellId, disabled, editingCellId]);

  const resolveCellById = useCallback(
    (cellId: string | null): SpreadsheetCell | null => {
      if (!cellId) return null;
      const cell = navigationModel.byId.get(cellId);
      if (!cell) return null;
      return { rowId: cell.rowId, columnKey: cell.columnKey };
    },
    [navigationModel.byId]
  );

  const resolveNextCellId = useCallback(
    (fromCellId: string, direction: SpreadsheetMoveDirection) => {
      return resolveSpreadsheetNextCellId(navigationModel, fromCellId, direction);
    },
    [navigationModel]
  );

  const moveActiveCell = useCallback(
    (fromCellId: string, direction: SpreadsheetMoveDirection) => {
      const nextCellId = resolveNextCellId(fromCellId, direction);
      if (!nextCellId) return;
      setEditingCellId(null);
      setActiveCellId(nextCellId);
    },
    [resolveNextCellId]
  );

  const registerCellElement = useCallback(
    (cellId: string, element: SpreadsheetCellElement | null) => {
      if (element) {
        cellElementsRef.current.set(cellId, element);
        return;
      }
      cellElementsRef.current.delete(cellId);
    },
    []
  );

  const registerEditorElement = useCallback(
    (cellId: string, element: SpreadsheetEditorElement | null) => {
      if (element) {
        editorElementsRef.current.set(cellId, element);
        return;
      }
      editorElementsRef.current.delete(cellId);
    },
    []
  );

  const startEditing = useCallback(
    (cellId: string, selectAll: boolean) => {
      if (disabled) return;

      const editor = editorElementsRef.current.get(cellId);
      if (!editor) return;

      setActiveCellId(cellId);
      setEditingCellId((previous) => {
        if (previous !== cellId) {
          editInitialValuesRef.current.set(cellId, readEditorValue(editor));
        }
        return cellId;
      });

      editor.focus();
      if (
        selectAll &&
        (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)
      ) {
        editor.select();
      }
    },
    [disabled]
  );

  const handleEscape = useCallback((cellId: string, editor: SpreadsheetEditorElement) => {
    const initialValue = editInitialValuesRef.current.get(cellId);
    if (initialValue !== undefined) {
      writeEditorValue(editor, initialValue);
    }

    editor.blur();
    setEditingCellId(null);
    setActiveCellId(cellId);
    editInitialValuesRef.current.delete(cellId);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, cellId: string, fromEditor: boolean) => {
      if (disabled) return;

      const moveDirection = (() => {
        if (event.key === "Tab") {
          return event.shiftKey ? "previous" : "next";
        }
        if (event.key === "ArrowLeft") return "previous";
        if (event.key === "ArrowRight") return "next";
        if (event.key === "ArrowDown" || event.key === "Enter") return "down";
        if (event.key === "ArrowUp") return "up";
        return null;
      })();

      if (event.key === "Escape" && fromEditor) {
        event.preventDefault();
        handleEscape(cellId, event.currentTarget as SpreadsheetEditorElement);
        return;
      }

      if (event.key === "F2" && !fromEditor) {
        event.preventDefault();
        startEditing(cellId, true);
        return;
      }

      if (!moveDirection) {
        return;
      }

      if (
        fromEditor &&
        event.key !== "Tab" &&
        event.key !== "Enter"
      ) {
        return;
      }

      event.preventDefault();
      if (fromEditor) {
        (event.currentTarget as SpreadsheetEditorElement).blur();
      }
      moveActiveCell(cellId, moveDirection);
    },
    [disabled, handleEscape, moveActiveCell, startEditing]
  );

  const handleCellFocus = useCallback(
    (cellId: string, event: FocusEvent<SpreadsheetCellElement>) => {
      if (disabled) return;

      setActiveCellId(cellId);
      if (!isEditorElement(event.target)) {
        return;
      }

      const editor = event.target;
      editorElementsRef.current.set(cellId, editor);
      setEditingCellId((previous) => {
        if (previous !== cellId) {
          editInitialValuesRef.current.set(cellId, readEditorValue(editor));
        }
        return cellId;
      });
    },
    [disabled]
  );

  const handleCellBlur = useCallback(
    (cellId: string, event: FocusEvent<SpreadsheetCellElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }

      setEditingCellId((previous) => (previous === cellId ? null : previous));
      editInitialValuesRef.current.delete(cellId);
    },
    []
  );

  const handleEditorFocus = useCallback(
    (cellId: string, event: FocusEvent<SpreadsheetEditorElement>) => {
      const editor = event.currentTarget;
      editorElementsRef.current.set(cellId, editor);
      setActiveCellId(cellId);
      setEditingCellId((previous) => {
        if (previous !== cellId) {
          editInitialValuesRef.current.set(cellId, readEditorValue(editor));
        }
        return cellId;
      });
    },
    []
  );

  const handleEditorBlur = useCallback((cellId: string) => {
    setEditingCellId((previous) => (previous === cellId ? null : previous));
    editInitialValuesRef.current.delete(cellId);
  }, []);

  const getCellProps = useCallback(
    (cell: SpreadsheetCell): SpreadsheetCellProps => {
      const cellId = toCellId(cell);
      return {
        ref: (element) => registerCellElement(cellId, element),
        role: "gridcell",
        tabIndex: !disabled && activeCellId === cellId ? 0 : -1,
        onFocus: (event) => handleCellFocus(cellId, event),
        onBlur: (event) => handleCellBlur(cellId, event),
        onKeyDown: (event) => handleKeyDown(event, cellId, false),
        onMouseDown: () => {
          if (disabled) return;
          setActiveCellId(cellId);
        },
        onDoubleClick: () => startEditing(cellId, true),
        "data-cell-id": cellId,
      };
    },
    [
      activeCellId,
      disabled,
      handleCellBlur,
      handleCellFocus,
      handleKeyDown,
      registerCellElement,
      startEditing,
    ]
  );

  const getEditorProps = useCallback(
    <T extends SpreadsheetEditorElement>(
      cell: SpreadsheetCell
    ): SpreadsheetEditorProps<T> => {
      const cellId = toCellId(cell);
      return {
        ref: (element) => registerEditorElement(cellId, element),
        tabIndex: -1,
        onFocus: (event) => handleEditorFocus(cellId, event),
        onBlur: () => handleEditorBlur(cellId),
        onKeyDown: (event) => handleKeyDown(event, cellId, true),
      };
    },
    [handleEditorBlur, handleEditorFocus, handleKeyDown, registerEditorElement]
  );

  const activeCell = useMemo(() => resolveCellById(activeCellId), [
    activeCellId,
    resolveCellById,
  ]);
  const editingCell = useMemo(() => resolveCellById(editingCellId), [
    editingCellId,
    resolveCellById,
  ]);

  const isCellActive = useCallback(
    (cell: SpreadsheetCell) => toCellId(cell) === activeCellId,
    [activeCellId]
  );

  const isCellEditing = useCallback(
    (cell: SpreadsheetCell) => toCellId(cell) === editingCellId,
    [editingCellId]
  );

  return {
    activeCell,
    editingCell,
    isCellActive,
    isCellEditing,
    getCellProps,
    getEditorProps,
  };
}
