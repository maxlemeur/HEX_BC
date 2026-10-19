"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useUndoRedo } from "@/hooks/useUndoRedo";
import { EstimateDeletionRecoveryError } from "@/hooks/estimate-editor-deletion-history";

const HISTORY_STACK_LIMIT = 50;

export type EstimateEditorHistoryCommand = {
  label?: string;
  undo: (context?: EstimateEditorHistoryCommandContext) => Promise<void>;
  redo: (context?: EstimateEditorHistoryCommandContext) => Promise<void>;
};

export type EstimateEditorHistoryCommandContext = {
  isCurrentScope: () => boolean;
  reportError?: (message: string) => void;
};

export type EstimateEditorHistoryRecovery = {
  message: string;
  itemId: string | null;
  canRetry: boolean;
};

export type EstimateEditorHistoryFeedback = {
  kind: "pending" | "success" | "recovery";
  message: string;
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
  const hasReportedCommandErrorRef = useRef(false);
  const [recovery, setRecovery] = useState<EstimateEditorHistoryRecovery | null>(null);
  const recoveryRef = useRef<EstimateEditorHistoryRecovery | null>(null);
  const [operation, setOperation] = useState<"undo" | "redo" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  useLayoutEffect(() => {
    if (activeScopeTokenRef.current !== scopeToken) {
      activeScopeTokenRef.current = scopeToken;
      hasPendingScopeClearRef.current = true;
      recoveryRef.current = null;
      setRecovery(null);
      setOperation(null);
      setNotice(null);
    }
    if (!isExecuting && hasPendingScopeClearRef.current) {
      clear();
      hasPendingScopeClearRef.current = false;
    }
  }, [clear, isExecuting, scopeToken]);

  const pushScopedCommand = useCallback(
    (command: EstimateEditorHistoryCommand) => {
      if (activeScopeTokenRef.current !== scopeToken || recoveryRef.current) return;
      const commandScopeToken = scopeToken;
      const context: EstimateEditorHistoryCommandContext = {
        isCurrentScope: () =>
          activeScopeTokenRef.current === commandScopeToken,
        reportError: (message) => {
          if (activeScopeTokenRef.current !== commandScopeToken) return;
          hasReportedCommandErrorRef.current = true;
          reportError(message);
        },
      };
      const run = async (direction: "undo" | "redo") => {
        try {
          await command[direction](context);
          if (!context.isCurrentScope()) return;
          recoveryRef.current = null;
          setRecovery(null);
          const isDeletion = command.label === "delete-item" || command.label === "bulk-delete-lines";
          setNotice(isDeletion
            ? direction === "undo" ? "Suppression annulée." : "Suppression rétablie."
            : null);
        } catch (error) {
          if (context.isCurrentScope() && error instanceof EstimateDeletionRecoveryError) {
            const next = { message: error.message, itemId: error.itemId, canRetry: error.canRetry };
            recoveryRef.current = next;
            setRecovery(next);
            hasReportedCommandErrorRef.current = true;
          }
          throw error;
        }
      };
      setNotice(null);
      push({ ...command, undo: () => run("undo"), redo: () => run("redo") });
    },
    [push, reportError, scopeToken]
  );

  const undo = useCallback(async () => {
    if (activeScopeTokenRef.current !== scopeToken) return;
    if (isExecutingRef.current || !canUndo) return;
    if (recoveryRef.current && !recoveryRef.current.canRetry) return;
    isExecutingRef.current = true;
    hasReportedCommandErrorRef.current = false;
    setOperation("undo");
    setNotice(null);
    try {
      const didUndo = await executeUndo();
      if (!didUndo && activeScopeTokenRef.current === scopeToken && !hasReportedCommandErrorRef.current) {
        reportError("Impossible d'annuler la dernière action.");
      }
    } finally {
      isExecutingRef.current = false;
      if (activeScopeTokenRef.current === scopeToken) setOperation(null);
    }
  }, [canUndo, executeUndo, reportError, scopeToken]);

  const redo = useCallback(async () => {
    if (activeScopeTokenRef.current !== scopeToken) return;
    if (isExecutingRef.current || !canRedo || recoveryRef.current) return;
    isExecutingRef.current = true;
    hasReportedCommandErrorRef.current = false;
    setOperation("redo");
    setNotice(null);
    try {
      const didRedo = await executeRedo();
      if (!didRedo && activeScopeTokenRef.current === scopeToken && !hasReportedCommandErrorRef.current) {
        reportError("Impossible de retablir la dernière action.");
      }
    } finally {
      isExecutingRef.current = false;
      if (activeScopeTokenRef.current === scopeToken) setOperation(null);
    }
  }, [canRedo, executeRedo, reportError, scopeToken]);

  const clearHistory = useCallback(() => {
    // A save acknowledgement confirms its values, not the remaining order.
    // Keep the recovery command and its acknowledged UUIDs until undo completes.
    if (isExecutingRef.current || recoveryRef.current) return;
    clear();
    recoveryRef.current = null;
    setRecovery(null);
    setNotice(null);
  }, [clear]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const state = useMemo(
    () => ({
      canUndo: canUndo && !recovery,
      canRedo: canRedo && !recovery,
      isExecuting,
      recovery,
      feedback: operation
        ? { kind: "pending", message: operation === "undo" ? "Annulation…" : "Rétablissement…" } satisfies EstimateEditorHistoryFeedback
        : recovery
          ? { kind: "recovery", message: recovery.message } satisfies EstimateEditorHistoryFeedback
          : notice
            ? { kind: "success", message: notice } satisfies EstimateEditorHistoryFeedback
            : null,
    }),
    [canRedo, canUndo, isExecuting, notice, operation, recovery]
  );

  const actions = useMemo(
    () => ({
      push: pushScopedCommand,
      clear: clearHistory,
      undo,
      redo,
      dismissNotice,
    }),
    [clearHistory, dismissNotice, pushScopedCommand, redo, undo]
  );

  return { state, actions };
}

export type EstimateEditorHistoryController = ReturnType<
  typeof useEstimateEditorHistoryController
>;
