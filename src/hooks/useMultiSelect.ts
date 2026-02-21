"use client";

import { useCallback, useMemo, useState } from "react";

export type SelectionInput =
  | ReadonlySet<string>
  | readonly string[]
  | ReadonlyMap<string, boolean>
  | Readonly<Record<string, boolean>>;

export type MultiSelectState = {
  selected: Set<string>;
  anchorId: string | null;
};

export type MultiSelectItemAction = {
  type: "selectItem";
  id: string;
  visibleIds: readonly string[];
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type MultiSelectAction =
  | MultiSelectItemAction
  | {
      type: "selectAll";
      ids: readonly string[];
    }
  | {
      type: "clear";
    }
  | {
      type: "prune";
      visibleIds: readonly string[];
    };

export type UseMultiSelectOptions = {
  visibleIds: readonly string[];
  initialSelected?: SelectionInput;
  initialAnchorId?: string | null;
};

export type MultiSelectItemInteraction = {
  id: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type UseMultiSelectResult = {
  selectedIds: string[];
  anchorId: string | null;
  isSelected: (id: string) => boolean;
  handleItemSelection: (interaction: MultiSelectItemInteraction) => void;
  selectAll: (ids?: readonly string[]) => void;
  clear: () => void;
};

function toSelectionSet(selection: SelectionInput): Set<string> {
  if (selection instanceof Set) {
    return new Set(selection);
  }

  if (Array.isArray(selection)) {
    return new Set(selection);
  }

  if (selection instanceof Map) {
    const nextSelection = new Set<string>();
    selection.forEach((isSelected, id) => {
      if (isSelected) {
        nextSelection.add(id);
      }
    });
    return nextSelection;
  }

  const nextSelection = new Set<string>();
  Object.entries(selection).forEach(([id, isSelected]) => {
    if (isSelected) {
      nextSelection.add(id);
    }
  });
  return nextSelection;
}

function areSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }

  return true;
}

function resolveNextState(
  currentState: MultiSelectState,
  nextSelected: ReadonlySet<string>,
  nextAnchorId: string | null
): MultiSelectState {
  if (
    currentState.anchorId === nextAnchorId &&
    areSetsEqual(currentState.selected, nextSelected)
  ) {
    return currentState;
  }

  return {
    selected: new Set(nextSelected),
    anchorId: nextAnchorId,
  };
}

export function toggleItemSelection(selection: SelectionInput, id: string): Set<string> {
  const nextSelection = toSelectionSet(selection);

  if (nextSelection.has(id)) {
    nextSelection.delete(id);
    return nextSelection;
  }

  nextSelection.add(id);
  return nextSelection;
}

export function selectRange(
  visibleIds: readonly string[],
  startId: string,
  endId: string
): Set<string> {
  const startIndex = visibleIds.indexOf(startId);
  const endIndex = visibleIds.indexOf(endId);

  if (startIndex === -1 || endIndex === -1) {
    return clearSelection();
  }

  const [fromIndex, toIndex] =
    startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

  const nextSelection = new Set<string>();
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const id = visibleIds[index];
    if (id) {
      nextSelection.add(id);
    }
  }

  return nextSelection;
}

export function selectAll(ids: readonly string[]): Set<string> {
  const nextSelection = new Set<string>();
  ids.forEach((id) => {
    nextSelection.add(id);
  });
  return nextSelection;
}

export function clearSelection(): Set<string> {
  return new Set<string>();
}

export function pruneSelection(
  selection: SelectionInput,
  visibleIds: readonly string[]
): Set<string> {
  const selectedSet = toSelectionSet(selection);
  const nextSelection = new Set<string>();

  visibleIds.forEach((id) => {
    if (selectedSet.has(id)) {
      nextSelection.add(id);
    }
  });

  return nextSelection;
}

export function getOrderedSelectedIds(
  selection: SelectionInput,
  visibleIds: readonly string[]
) {
  return Array.from(pruneSelection(selection, visibleIds));
}

export function createMultiSelectState(
  params: {
    selected?: SelectionInput;
    anchorId?: string | null;
  } = {}
): MultiSelectState {
  return {
    selected:
      params.selected === undefined
        ? clearSelection()
        : toSelectionSet(params.selected),
    anchorId: params.anchorId ?? null,
  };
}

function reduceSelectItem(
  state: MultiSelectState,
  action: MultiSelectItemAction
): MultiSelectState {
  const visibleIdSet = new Set(action.visibleIds);

  if (!visibleIdSet.has(action.id)) {
    return state;
  }

  const hasToggleModifier = Boolean(action.ctrlKey || action.metaKey);

  if (action.shiftKey) {
    const anchorId =
      state.anchorId !== null && visibleIdSet.has(state.anchorId)
        ? state.anchorId
        : action.id;

    const nextSelected = selectRange(action.visibleIds, anchorId, action.id);
    return resolveNextState(state, nextSelected, anchorId);
  }

  if (hasToggleModifier) {
    const nextSelected = toggleItemSelection(state.selected, action.id);
    return resolveNextState(state, nextSelected, action.id);
  }

  return resolveNextState(state, new Set([action.id]), action.id);
}

export function reduceMultiSelectState(
  state: MultiSelectState,
  action: MultiSelectAction
): MultiSelectState {
  switch (action.type) {
    case "selectItem":
      return reduceSelectItem(state, action);
    case "selectAll": {
      const nextSelected = selectAll(action.ids);
      const nextAnchorId =
        state.anchorId !== null && nextSelected.has(state.anchorId)
          ? state.anchorId
          : action.ids[0] ?? null;

      return resolveNextState(state, nextSelected, nextAnchorId);
    }
    case "clear":
      return resolveNextState(state, clearSelection(), null);
    case "prune": {
      const nextSelected = pruneSelection(state.selected, action.visibleIds);
      const visibleIdSet = new Set(action.visibleIds);
      const nextAnchorId =
        state.anchorId !== null && visibleIdSet.has(state.anchorId)
          ? state.anchorId
          : null;

      return resolveNextState(state, nextSelected, nextAnchorId);
    }
    default:
      return state;
  }
}

export function useMultiSelect({
  visibleIds,
  initialSelected = [],
  initialAnchorId = null,
}: UseMultiSelectOptions): UseMultiSelectResult {
  const [state, setState] = useState<MultiSelectState>(() => {
    const initialState = createMultiSelectState({
      selected: initialSelected,
      anchorId: initialAnchorId,
    });
    return reduceMultiSelectState(initialState, {
      type: "prune",
      visibleIds,
    });
  });

  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  const handleItemSelection = useCallback(
    (interaction: MultiSelectItemInteraction) => {
      setState((previousState) =>
        reduceMultiSelectState(previousState, {
          type: "selectItem",
          id: interaction.id,
          visibleIds,
          shiftKey: interaction.shiftKey,
          ctrlKey: interaction.ctrlKey,
          metaKey: interaction.metaKey,
        })
      );
    },
    [visibleIds]
  );

  const selectAllItems = useCallback(
    (ids?: readonly string[]) => {
      setState((previousState) =>
        reduceMultiSelectState(previousState, {
          type: "selectAll",
          ids: ids ?? visibleIds,
        })
      );
    },
    [visibleIds]
  );

  const clear = useCallback(() => {
    setState((previousState) =>
      reduceMultiSelectState(previousState, {
        type: "clear",
      })
    );
  }, []);

  const isSelected = useCallback(
    (id: string) => {
      return visibleIdSet.has(id) && state.selected.has(id);
    },
    [state.selected, visibleIdSet]
  );

  const selectedIds = useMemo(() => {
    return getOrderedSelectedIds(state.selected, visibleIds);
  }, [state.selected, visibleIds]);

  return {
    selectedIds,
    anchorId: state.anchorId,
    isSelected,
    handleItemSelection,
    selectAll: selectAllItems,
    clear,
  };
}
