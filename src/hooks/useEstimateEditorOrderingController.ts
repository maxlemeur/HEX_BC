"use client";

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
  const persistMoveItem = useCallback(
    async (versionId: string, move: EstimateItemMovePayload) => {
      await moveEstimateItem(versionId, {
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
          "Impossible de reordonner tant que des elements en creation ne sont pas synchronises."
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
      setItems(updated);

      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot) {
        reportError("Version introuvable.");
        setItems(snapshot);
        return;
      }
      const targetVersionId = versionSnapshot.id;

      try {
        await reorderEstimateItems(targetVersionId, parentId, orderedIds);
        if (getVersionSnapshot()?.id !== targetVersionId) return;

        pushHistoryCommand({
          label: "reorder",
          undo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const undoSnapshot = getItemsSnapshot();
            setItems(
              undoSnapshot.map((item) => {
                if (item.parent_id !== parentId) return item;
                const index = previousOrderedIds.indexOf(item.id);
                return index === -1
                  ? item
                  : { ...item, position: index + 1 };
              })
            );
            try {
              await reorderEstimateItems(
                currentVersion.id,
                parentId,
                previousOrderedIds
              );
              if (context && !context.isCurrentScope()) return;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              setItems(undoSnapshot);
              throw error;
            }
          },
          redo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const redoSnapshot = getItemsSnapshot();
            setItems(
              redoSnapshot.map((item) => {
                if (item.parent_id !== parentId) return item;
                const index = orderedIds.indexOf(item.id);
                return index === -1
                  ? item
                  : { ...item, position: index + 1 };
              })
            );
            try {
              await reorderEstimateItems(
                currentVersion.id,
                parentId,
                orderedIds
              );
              if (context && !context.isCurrentScope()) return;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              setItems(redoSnapshot);
              throw error;
            }
          },
        });
      } catch {
        if (getVersionSnapshot()?.id !== targetVersionId) return;
        reportError("Impossible de reordonner les lignes.");
        setItems(snapshot);
      }
    },
    [
      getItemsSnapshot,
      getVersionSnapshot,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      reportError,
      setItems,
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
          "Impossible de deplacer tant que des elements en creation ne sont pas synchronises."
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
      setItems(applyInterParentMoveOptimistically(snapshot, movePayload));
      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot) {
        reportError("Version introuvable.");
        setItems(snapshot);
        return;
      }
      const targetVersionId = versionSnapshot.id;

      try {
        await persistMoveItem(targetVersionId, movePayload);
        if (getVersionSnapshot()?.id !== targetVersionId) return;
        setTotalsOutOfSync(false);
        pushHistoryCommand({
          label: "move-item",
          undo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const undoSnapshot = getItemsSnapshot();
            setItems(
              applyInterParentMoveOptimistically(
                undoSnapshot,
                undoMovePayload
              )
            );
            try {
              await persistMoveItem(currentVersion.id, undoMovePayload);
              if (context && !context.isCurrentScope()) return;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              setItems(undoSnapshot);
              throw error;
            }
          },
          redo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const redoSnapshot = getItemsSnapshot();
            setItems(
              applyInterParentMoveOptimistically(redoSnapshot, movePayload)
            );
            try {
              await persistMoveItem(currentVersion.id, movePayload);
              if (context && !context.isCurrentScope()) return;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              setItems(redoSnapshot);
              throw error;
            }
          },
        });
      } catch (error) {
        if (getVersionSnapshot()?.id !== targetVersionId) return;
        setItems(snapshot);
        reportError(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de deplacer l'element."
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
      setItems,
      setTotalsOutOfSync,
    ]
  );

  const actions = useMemo(
    () => ({ reorder, move }),
    [move, reorder]
  );

  return { actions };
}
