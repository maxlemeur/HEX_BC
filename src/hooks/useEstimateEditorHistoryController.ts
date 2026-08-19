"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { useUndoRedo } from "@/hooks/useUndoRedo";

const HISTORY_STACK_LIMIT = 50;

export type EstimateEditorHistoryCommand = {
  label?: string;
  undo: (context?: EstimateEditorHistoryCommandContext) => Promise<void>;
  redo: (context?: EstimateEditorHistoryCommandContext) => Promise<void>;
};

export type EstimateEditorHistoryCommandContext = {
  isCurrentScope: () => boolean;
};

type EstimateEditorHistoryControllerInput = {
  scopeKey: string;
  reportError: (message: string | null) => void;
};

export function useEstimateEditorHistoryController({
  scopeKey,
  reportError,
}: EstimateEditorHistoryControllerInput) {
  const {
    push,
    undo: executeUndo,
    redo: executeRedo,
    clear,
    canUndo,
    canRedo,
    isExecuting,
  } = useUndoRedo<EstimateEditorHistoryCommand>({
    maxStackSize: HISTORY_STACK_LIMIT,
  });
  const scopeToken = useMemo(() => ({ scopeKey }), [scopeKey]);
  const isExecutingRef = useRef(isExecuting);
  const activeScopeTokenRef = useRef(scopeToken);
  const hasPendingScopeClearRef = useRef(false);

  useLayoutEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  useLayoutEffect(() => {
    if (activeScopeTokenRef.current !== scopeToken) {
      activeScopeTokenRef.current = scopeToken;
      hasPendingScopeClearRef.current = true;
    }
    if (!isExecuting && hasPendingScopeClearRef.current) {
      clear();
      hasPendingScopeClearRef.current = false;
    }
  }, [clear, isExecuting, scopeToken]);

  const pushScopedCommand = useCallback(
    (command: EstimateEditorHistoryCommand) => {
      if (activeScopeTokenRef.current !== scopeToken) return;
      const commandScopeToken = scopeToken;
      const context: EstimateEditorHistoryCommandContext = {
        isCurrentScope: () =>
          activeScopeTokenRef.current === commandScopeToken,
      };
      push({
        ...command,
        undo: () => command.undo(context),
        redo: () => command.redo(context),
      });
    },
    [push, scopeToken]
  );

  const undo = useCallback(async () => {
    if (activeScopeTokenRef.current !== scopeToken) return;
    if (isExecutingRef.current || !canUndo) return;
    isExecutingRef.current = true;
    try {
      const didUndo = await executeUndo();
      if (!didUndo && activeScopeTokenRef.current === scopeToken) {
        reportError("Impossible d'annuler la derniere action.");
      }
    } finally {
      isExecutingRef.current = false;
    }
  }, [canUndo, executeUndo, reportError, scopeToken]);

  const redo = useCallback(async () => {
    if (activeScopeTokenRef.current !== scopeToken) return;
    if (isExecutingRef.current || !canRedo) return;
    isExecutingRef.current = true;
    try {
      const didRedo = await executeRedo();
      if (!didRedo && activeScopeTokenRef.current === scopeToken) {
        reportError("Impossible de retablir la derniere action.");
      }
    } finally {
      isExecutingRef.current = false;
    }
  }, [canRedo, executeRedo, reportError, scopeToken]);

  const state = useMemo(
    () => ({
      canUndo,
      canRedo,
      isExecuting,
    }),
    [canRedo, canUndo, isExecuting]
  );

  const actions = useMemo(
    () => ({
      push: pushScopedCommand,
      clear,
      undo,
      redo,
    }),
    [clear, pushScopedCommand, redo, undo]
  );

  return { state, actions };
}

export type EstimateEditorHistoryController = ReturnType<
  typeof useEstimateEditorHistoryController
>;
