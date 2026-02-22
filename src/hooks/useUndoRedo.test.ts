import { describe, expect, it, vi } from "vitest";

import {
  canRedoState,
  canUndoState,
  createUndoRedoState,
  createUndoRedoStore,
  pushUndoRedoCommand,
  type UndoRedoCommand,
} from "@/hooks/useUndoRedo";

type TestCommand = UndoRedoCommand & {
  id: string;
};

function createCommand(
  id: string,
  overrides: Partial<UndoRedoCommand> = {}
): TestCommand {
  return {
    id,
    undo: overrides.undo ?? (async () => {}),
    redo: overrides.redo ?? (async () => {}),
  };
}

function createDeferredPromise<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("useUndoRedo state helpers", () => {
  it("push clears future history when pointer is not at the stack end", () => {
    const first = createCommand("first");
    const second = createCommand("second");
    const replacement = createCommand("replacement");

    let state = createUndoRedoState<TestCommand>();
    state = pushUndoRedoCommand(state, first, 50);
    state = pushUndoRedoCommand(state, second, 50);

    const rewoundState = {
      ...state,
      pointer: 1,
    };
    const nextState = pushUndoRedoCommand(rewoundState, replacement, 50);

    expect(nextState.stack).toEqual([first, replacement]);
    expect(nextState.pointer).toBe(2);
    expect(canUndoState(nextState)).toBe(true);
    expect(canRedoState(nextState)).toBe(false);
  });

  it("enforces configured stack size and keeps pointer consistent", () => {
    const first = createCommand("first");
    const second = createCommand("second");
    const third = createCommand("third");

    let state = createUndoRedoState<TestCommand>();
    state = pushUndoRedoCommand(state, first, 2);
    state = pushUndoRedoCommand(state, second, 2);
    state = pushUndoRedoCommand(state, third, 2);

    expect(state.stack).toEqual([second, third]);
    expect(state.pointer).toBe(2);

    const rewoundState = {
      ...state,
      pointer: 1,
    };

    expect(canUndoState(rewoundState)).toBe(true);
    expect(canRedoState(rewoundState)).toBe(true);
  });
});

describe("useUndoRedo store behavior", () => {
  it("respects max stack size and clears state when requested", () => {
    const store = createUndoRedoStore<UndoRedoCommand>({
      maxStackSize: 2,
    });

    store.push(createCommand("first"));
    store.push(createCommand("second"));
    store.push(createCommand("third"));

    expect(store.getState().stack).toHaveLength(2);
    expect(store.getState().pointer).toBe(2);
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(store.getSnapshot().canRedo).toBe(false);

    store.clear();

    expect(store.getState().stack).toEqual([]);
    expect(store.getState().pointer).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  it("moves pointer only when undo succeeds", async () => {
    const successfulUndo = vi.fn(async () => {});
    const successfulRedo = vi.fn(async () => {});
    const failingUndo = vi.fn(async () => {
      throw new Error("undo failed");
    });

    const store = createUndoRedoStore<UndoRedoCommand>();
    store.push({
      undo: successfulUndo,
      redo: successfulRedo,
    });
    store.push({
      undo: failingUndo,
      redo: successfulRedo,
    });

    const result = await store.undo();

    expect(result).toBe(false);
    expect(failingUndo).toHaveBeenCalledTimes(1);
    expect(successfulUndo).not.toHaveBeenCalled();
    expect(store.getState().pointer).toBe(2);
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  it("moves pointer only when redo succeeds", async () => {
    const successfulUndo = vi.fn(async () => {});
    const failingRedo = vi.fn(async () => {
      throw new Error("redo failed");
    });

    const store = createUndoRedoStore<UndoRedoCommand>();
    store.push({
      undo: successfulUndo,
      redo: failingRedo,
    });

    expect(await store.undo()).toBe(true);
    expect(store.getState().pointer).toBe(0);
    expect(store.getSnapshot().canRedo).toBe(true);

    const result = await store.redo();

    expect(result).toBe(false);
    expect(failingRedo).toHaveBeenCalledTimes(1);
    expect(store.getState().pointer).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(true);
  });

  it("serializes async executions and keeps execution state until queue drain", async () => {
    const deferred = createDeferredPromise<void>();
    const queuedUndo = vi.fn(async () => {});
    const blockingUndo = vi.fn(() => deferred.promise);

    const store = createUndoRedoStore<UndoRedoCommand>();
    store.push({
      undo: queuedUndo,
      redo: vi.fn(async () => {}),
    });
    store.push({
      undo: blockingUndo,
      redo: vi.fn(async () => {}),
    });

    const firstUndoPromise = store.undo();
    const secondUndoPromise = store.undo();

    await Promise.resolve();

    expect(store.getSnapshot().isExecuting).toBe(true);
    expect(blockingUndo).toHaveBeenCalledTimes(1);
    expect(queuedUndo).toHaveBeenCalledTimes(0);

    deferred.resolve();

    await expect(firstUndoPromise).resolves.toBe(true);
    await expect(secondUndoPromise).resolves.toBe(true);

    expect(queuedUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().pointer).toBe(0);
    expect(store.getSnapshot().isExecuting).toBe(false);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(true);
  });

  it("guards push and clear while an execution is in flight", async () => {
    const deferred = createDeferredPromise<void>();
    const blockingUndo = vi.fn(() => deferred.promise);

    const store = createUndoRedoStore<UndoRedoCommand>();
    store.push({
      undo: blockingUndo,
      redo: vi.fn(async () => {}),
    });

    const undoPromise = store.undo();

    expect(store.getSnapshot().isExecuting).toBe(true);
    expect(store.getState().pointer).toBe(1);

    store.push(createCommand("ignored"));
    store.clear();

    expect(store.getState().stack).toHaveLength(1);
    expect(store.getState().pointer).toBe(1);

    deferred.resolve();
    await undoPromise;

    expect(store.getState().stack).toHaveLength(1);
    expect(store.getState().pointer).toBe(0);
    expect(store.getSnapshot().isExecuting).toBe(false);
  });
});
