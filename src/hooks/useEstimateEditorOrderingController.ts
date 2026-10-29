"use client";

import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { useEstimateEditorItemsOperation } from "@/hooks/useEstimateEditorItemsOperation";

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { moveEstimateItem, reorderEstimateItems } from "@/lib/estimates/client";
import {
  applyInterParentMoveOptimistically,
  isPendingCreateEstimateItem,
  isTempEstimateItemId,
  type EditorEstimateItem,
  type EstimateItemMovePayload,
  type EstimateVersionRow,
} from "@/lib/estimates/editor-items";

type EstimateEditorOrderingControllerInput = {
  document?: EstimateEditorDocument;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  pushHistoryCommand: (command: EstimateEditorHistoryCommand) => void;
};

export function useEstimateEditorOrderingController({
  document,
  isMutationBlocked,
  mutationBlockedMessage,
  getItemsSnapshot,
  getVersionSnapshot,
  setItems,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  pushHistoryCommand,
}: EstimateEditorOrderingControllerInput) {
  const { beginItemsOperation, isItemsOperationCurrent, rollbackItems, acceptItemsReceipt } = useEstimateEditorItemsOperation({
    document, getItemsSnapshot, setItems,
  });
  const persistMoveItem = useCallback(
    async (versionId: string, move: EstimateItemMovePayload) => {
      return moveEstimateItem(versionId, {
        item_id: move.itemId,
        from_parent_id: move.fromParentId,
        to_parent_id: move.toParentId,
        ordered_source_ids: move.orderedSourceIds,
        ordered_target_ids: move.orderedTargetIds,
      });
    },
    []
  );

  const reorder = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      const snapshot = getItemsSnapshot();
      const hasPendingCreation = orderedIds.some((id) => {
        const item = snapshot.find((candidate) => candidate.id === id);
        return Boolean(
          item &&
            (isPendingCreateEstimateItem(item) ||
              isTempEstimateItemId(item.id))
        );
      });
      if (hasPendingCreation) {
        reportError(
          "Impossible de réordonner tant que des éléments en création ne sont pas synchronisés."
        );
        return;
      }

      const previousOrderedIds = snapshot
        .filter((item) => item.parent_id === parentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      if (previousOrderedIds.join("|") === orderedIds.join("|")) return;

      const updated = snapshot.map((item) => {
        if (item.parent_id !== parentId) return item;
        const index = orderedIds.indexOf(item.id);
        return index === -1 ? item : { ...item, position: index + 1 };
      });
      const operation = beginItemsOperation(updated);
      if (!isItemsOperationCurrent(operation)) return;

      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot) {
        reportError("Version introuvable.");
        rollbackItems(operation);
        return;
      }
      const targetVersionId = versionSnapshot.id;

      try {
        const receipt = await reorderEstimateItems(targetVersionId, parentId, orderedIds);
        if (!isItemsOperationCurrent(operation) || getVersionSnapshot()?.id !== targetVersionId) return;
        if (!acceptItemsReceipt(operation, { version: receipt.versionToken })) return;

        pushHistoryCommand({
          label: "reorder",
          undo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const undoSnapshot = getItemsSnapshot();
            const undoOperation = beginItemsOperation(
              undoSnapshot.map((item) => {
                if (item.parent_id !== parentId) return item;
                const index = previousOrderedIds.indexOf(item.id);
                return index === -1
                  ? item
                  : { ...item, position: index + 1 };
              })
            );
            if (!isItemsOperationCurrent(undoOperation)) return false;
            try {
              const receipt = await reorderEstimateItems(
                currentVersion.id,
                parentId,
                previousOrderedIds
              );
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              if (!acceptItemsReceipt(undoOperation, { version: receipt.versionToken })) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(undoOperation);
              throw error;
            }
          },
          redo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const redoSnapshot = getItemsSnapshot();
            const redoOperation = beginItemsOperation(
              redoSnapshot.map((item) => {
                if (item.parent_id !== parentId) return item;
                const index = orderedIds.indexOf(item.id);
                return index === -1
                  ? item
                  : { ...item, position: index + 1 };
              })
            );
            if (!isItemsOperationCurrent(redoOperation)) return false;
            try {
              const receipt = await reorderEstimateItems(
                currentVersion.id,
                parentId,
                orderedIds
              );
              if (!isItemsOperationCurrent(redoOperation) || (context && !context.isCurrentScope())) return false;
              if (!acceptItemsReceipt(redoOperation, { version: receipt.versionToken })) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(redoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(redoOperation);
              throw error;
            }
          },
        });
      } catch {
        if (!isItemsOperationCurrent(operation) || getVersionSnapshot()?.id !== targetVersionId) return;
        reportError("Impossible de reordonner les lignes.");
        rollbackItems(operation);
      }
    },
    [
      getItemsSnapshot,
      getVersionSnapshot,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      reportError,
      acceptItemsReceipt,
      beginItemsOperation,
      isItemsOperationCurrent,
      rollbackItems,
      setTotalsOutOfSync,
    ]
  );

  const move = useCallback(
    async (
      itemId: string,
      fromParentId: string | null,
      toParentId: string | null,
      orderedSourceIds: string[],
      orderedTargetIds: string[]
    ) => {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }
      if (fromParentId === toParentId) {
        await reorder(fromParentId, orderedTargetIds);
        return;
      }

      const snapshot = getItemsSnapshot();
      const hasPendingCreation = [
        itemId,
        ...orderedSourceIds,
        ...orderedTargetIds,
      ].some((id) => {
        const item = snapshot.find((candidate) => candidate.id === id);
        return Boolean(
          item &&
            (isPendingCreateEstimateItem(item) ||
              isTempEstimateItemId(item.id))
        );
      });
      if (hasPendingCreation) {
        reportError(
          "Impossible de déplacer tant que des éléments en création ne sont pas synchronisés."
        );
        return;
      }

      const movedItem = snapshot.find((item) => item.id === itemId);
      if (!movedItem) return;
      const previousSourceOrderedIds = snapshot
        .filter((item) => item.parent_id === fromParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      const previousTargetOrderedIds = snapshot
        .filter((item) => item.parent_id === toParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);

      const movePayload: EstimateItemMovePayload = {
        itemId,
        fromParentId,
        toParentId,
        orderedSourceIds: [...orderedSourceIds],
        orderedTargetIds: [...orderedTargetIds],
      };
      const undoSourceOrderedIds = movePayload.orderedTargetIds.filter(
        (targetItemId) => targetItemId !== itemId
      );
      const undoTargetOrderedIds = movePayload.orderedSourceIds.filter(
        (sourceItemId) => sourceItemId !== itemId
      );
      const previousSourceIndex = previousSourceOrderedIds.indexOf(itemId);
      undoTargetOrderedIds.splice(
        previousSourceIndex === -1
          ? undoTargetOrderedIds.length
          : Math.min(previousSourceIndex, undoTargetOrderedIds.length),
        0,
        itemId
      );
      const undoMovePayload: EstimateItemMovePayload = {
        itemId,
        fromParentId: toParentId,
        toParentId: fromParentId,
        orderedSourceIds: undoSourceOrderedIds,
        orderedTargetIds: undoTargetOrderedIds,
      };
      if (
        (movedItem.parent_id ?? null) === toParentId &&
        previousSourceOrderedIds.join("|") === orderedSourceIds.join("|") &&
        previousTargetOrderedIds.join("|") === orderedTargetIds.join("|")
      ) {
        return;
      }

      reportError(null);
      const operation = beginItemsOperation(applyInterParentMoveOptimistically(snapshot, movePayload));
      if (!isItemsOperationCurrent(operation)) return;
      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot) {
        reportError("Version introuvable.");
        rollbackItems(operation);
        return;
      }
      const targetVersionId = versionSnapshot.id;

      try {
        const receipt = await persistMoveItem(targetVersionId, movePayload);
        if (!isItemsOperationCurrent(operation) || getVersionSnapshot()?.id !== targetVersionId) return;
        if (!acceptItemsReceipt(operation, { version: receipt.versionToken })) return;
        setTotalsOutOfSync(false);
        pushHistoryCommand({
          label: "move-item",
          undo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const undoSnapshot = getItemsSnapshot();
            const undoOperation = beginItemsOperation(
              applyInterParentMoveOptimistically(
                undoSnapshot,
                undoMovePayload
              )
            );
            if (!isItemsOperationCurrent(undoOperation)) return false;
            try {
              const receipt = await persistMoveItem(currentVersion.id, undoMovePayload);
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              if (!acceptItemsReceipt(undoOperation, { version: receipt.versionToken })) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(undoOperation);
              throw error;
            }
          },
          redo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const redoSnapshot = getItemsSnapshot();
            const redoOperation = beginItemsOperation(
              applyInterParentMoveOptimistically(redoSnapshot, movePayload)
            );
            if (!isItemsOperationCurrent(redoOperation)) return false;
            try {
              const receipt = await persistMoveItem(currentVersion.id, movePayload);
              if (!isItemsOperationCurrent(redoOperation) || (context && !context.isCurrentScope())) return false;
              if (!acceptItemsReceipt(redoOperation, { version: receipt.versionToken })) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(redoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(redoOperation);
              throw error;
            }
          },
        });
      } catch (error) {
        if (!isItemsOperationCurrent(operation) || getVersionSnapshot()?.id !== targetVersionId) return;
        rollbackItems(operation);
        reportError(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de déplacer l'élément."
          )
        );
      }
    },
    [
      getItemsSnapshot,
      getVersionSnapshot,
      isMutationBlocked,
      mutationBlockedMessage,
      persistMoveItem,
      pushHistoryCommand,
      reorder,
      reportError,
      resolveErrorMessage,
      acceptItemsReceipt,
      beginItemsOperation,
      isItemsOperationCurrent,
      rollbackItems,
      setTotalsOutOfSync,
    ]
  );

  const actions = useMemo(
    () => ({ reorder, move }),
    [move, reorder]
  );

  return { actions };
}
