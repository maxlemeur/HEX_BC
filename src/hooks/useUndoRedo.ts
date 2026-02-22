"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

export const DEFAULT_UNDO_REDO_MAX_STACK_SIZE = 50;

export type UndoRedoCommand = {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

export type UndoRedoState<TCommand extends UndoRedoCommand = UndoRedoCommand> = {
  stack: TCommand[];
  pointer: number;
  isExecuting: boolean;
};

export type UndoRedoSnapshot = {
  canUndo: boolean;
  canRedo: boolean;
  isExecuting: boolean;
};

export type UseUndoRedoOptions = {
  maxStackSize?: number;
};

export type UseUndoRedoResult<TCommand extends UndoRedoCommand = UndoRedoCommand> = {
  push: (command: TCommand) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isExecuting: boolean;
};

export type UndoRedoStore<TCommand extends UndoRedoCommand = UndoRedoCommand> = {
  push: (command: TCommand) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clear: () => void;
  getState: () => UndoRedoState<TCommand>;
  getSnapshot: () => UndoRedoSnapshot;
  subscribe: (listener: () => void) => () => void;
};

export function normalizeUndoRedoMaxStackSize(maxStackSize?: number) {
  if (maxStackSize === undefined) {
    return DEFAULT_UNDO_REDO_MAX_STACK_SIZE;
  }

  if (!Number.isFinite(maxStackSize)) {
    return DEFAULT_UNDO_REDO_MAX_STACK_SIZE;
  }

  return Math.max(1, Math.floor(maxStackSize));
}

export function createUndoRedoState<
  TCommand extends UndoRedoCommand = UndoRedoCommand,
>(): UndoRedoState<TCommand> {
  return {
    stack: [],
    pointer: 0,
    isExecuting: false,
  };
}

export function canUndoState<TCommand extends UndoRedoCommand>(
  state: UndoRedoState<TCommand>
) {
  return state.pointer > 0;
}

export function canRedoState<TCommand extends UndoRedoCommand>(
  state: UndoRedoState<TCommand>
) {
  return state.pointer < state.stack.length;
}

export function pushUndoRedoCommand<TCommand extends UndoRedoCommand>(
  state: UndoRedoState<TCommand>,
  command: TCommand,
  maxStackSize = DEFAULT_UNDO_REDO_MAX_STACK_SIZE
): UndoRedoState<TCommand> {
  const resolvedMaxStackSize = normalizeUndoRedoMaxStackSize(maxStackSize);
  const committedStack = state.stack.slice(0, state.pointer);
  committedStack.push(command);

  if (committedStack.length > resolvedMaxStackSize) {
    const overflowCount = committedStack.length - resolvedMaxStackSize;
    return {
      ...state,
      stack: committedStack.slice(overflowCount),
      pointer: resolvedMaxStackSize,
    };
  }

  return {
    ...state,
    stack: committedStack,
    pointer: committedStack.length,
  };
}

function createUndoRedoSnapshot<TCommand extends UndoRedoCommand>(
  state: UndoRedoState<TCommand>
): UndoRedoSnapshot {
  return {
    canUndo: canUndoState(state),
    canRedo: canRedoState(state),
    isExecuting: state.isExecuting,
  };
}

export function createUndoRedoStore<
  TCommand extends UndoRedoCommand = UndoRedoCommand,
>(options: UseUndoRedoOptions = {}): UndoRedoStore<TCommand> {
  const maxStackSize = normalizeUndoRedoMaxStackSize(options.maxStackSize);
  let state = createUndoRedoState<TCommand>();
  let snapshot = createUndoRedoSnapshot(state);
  const listeners = new Set<() => void>();
  let executionChain: Promise<void> = Promise.resolve();
  let queuedExecutionCount = 0;

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const setState = (nextState: UndoRedoState<TCommand>) => {
    if (nextState === state) {
      return;
    }

    state = nextState;
    snapshot = createUndoRedoSnapshot(state);
    notify();
  };

  const setIsExecuting = (isExecuting: boolean) => {
    if (state.isExecuting === isExecuting) {
      return;
    }

    setState({
      ...state,
      isExecuting,
    });
  };

  const enqueueExecution = <TResult,>(
    callback: () => Promise<TResult>
  ): Promise<TResult> => {
    queuedExecutionCount += 1;
    setIsExecuting(true);

    const runCallback = async () => {
      try {
        return await callback();
      } finally {
        queuedExecutionCount -= 1;
        if (queuedExecutionCount === 0) {
          setIsExecuting(false);
        }
      }
    };

    const queuedExecution = executionChain.then(runCallback, runCallback);
    executionChain = queuedExecution.then(
      () => undefined,
      () => undefined
    );

    return queuedExecution;
  };

  const push = (command: TCommand) => {
    if (state.isExecuting) {
      return;
    }

    setState(pushUndoRedoCommand(state, command, maxStackSize));
  };

  const clear = () => {
    if (state.isExecuting) {
      return;
    }

    if (state.stack.length === 0 && state.pointer === 0) {
      return;
    }

    setState({
      ...state,
      stack: [],
      pointer: 0,
    });
  };

  const undo = () => {
    return enqueueExecution(async () => {
      if (!canUndoState(state)) {
        return false;
      }

      const commandIndex = state.pointer - 1;
      const command = state.stack[commandIndex];
      if (!command) {
        return false;
      }

      try {
        await command.undo();
      } catch {
        return false;
      }

      setState({
        ...state,
        pointer: commandIndex,
      });

      return true;
    });
  };

  const redo = () => {
    return enqueueExecution(async () => {
      if (!canRedoState(state)) {
        return false;
      }

      const command = state.stack[state.pointer];
      if (!command) {
        return false;
      }

      try {
        await command.redo();
      } catch {
        return false;
      }

      setState({
        ...state,
        pointer: state.pointer + 1,
      });

      return true;
    });
  };

  const getState = () => state;
  const getSnapshot = () => snapshot;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    push,
    undo,
    redo,
    clear,
    getState,
    getSnapshot,
    subscribe,
  };
}

export function useUndoRedo<
  TCommand extends UndoRedoCommand = UndoRedoCommand,
>(options: UseUndoRedoOptions = {}): UseUndoRedoResult<TCommand> {
  const [store] = useState(() => createUndoRedoStore<TCommand>(options));
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  const push = useCallback(
    (command: TCommand) => {
      store.push(command);
    },
    [store]
  );

  const undo = useCallback(() => {
    return store.undo();
  }, [store]);

  const redo = useCallback(() => {
    return store.redo();
  }, [store]);

  const clear = useCallback(() => {
    store.clear();
  }, [store]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    isExecuting: snapshot.isExecuting,
  };
}
