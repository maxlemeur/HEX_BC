"use client";

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import {
  bulkUpdateEstimateItems,
  deleteEstimateItem,
} from "@/lib/estimates/client";
import {
  buildEstimateItemUpdatePayload,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import { toFiniteNumber } from "@/lib/estimates/editor-values";
import { buildSiblingOrderByParent } from "@/app/dashboard/estimates/[versionId]/edit/utils/item-tree";

type RecreatedItems = {
  idMap: Map<string, string>;
  createdItems: EstimateItem[];
};

type EstimateEditorBulkControllerInput = {
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  isLaborSplitEnabled: boolean;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  normalizeLine: (item: EditorEstimateItem) => EditorEstimateItem;
  applyVersionToken: (updatedAt: string) => void;
  ensureGroupedActionCanProceed: (actionLabel: string) => Promise<boolean>;
  handleVersionConflict: (
    error: unknown,
    options?: { persistDraft?: boolean }
  ) => boolean;
  triggerVersionReload: () => void;
  pushHistoryCommand: (command: EstimateEditorHistoryCommand) => void;
  recreateItemsFromSnapshots: (
    versionId: string,
    snapshots: EstimateItem[]
  ) => Promise<RecreatedItems>;
  applySiblingOrder: (
    versionId: string,
    siblingOrderByParent: Map<string | null, string[]>,
    idMap?: Map<string, string>,
    isCurrentScope?: () => boolean
  ) => Promise<void>;
  reloadItems: () => Promise<void>;
};

export function useEstimateEditorBulkController({
  isMutationBlocked,
  mutationBlockedMessage,
  isLaborSplitEnabled,
  getItemsSnapshot,
  getVersionSnapshot,
  setItems,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  normalizeLine,
  applyVersionToken,
  ensureGroupedActionCanProceed,
  handleVersionConflict,
  triggerVersionReload,
  pushHistoryCommand,
  recreateItemsFromSnapshots,
  applySiblingOrder,
  reloadItems,
}: EstimateEditorBulkControllerInput) {
  const applyBulkLineState = useCallback(
    async (
      targetLines: EstimateItem[],
      failureMessage: string,
      isCurrentScope: () => boolean = () => true
    ) => {
      const snapshot = getItemsSnapshot();
      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot) {
        reportError("Version introuvable.");
        throw new Error("Version introuvable.");
      }
      const targetVersionId = versionSnapshot.id;
      const updatedById = new Map(
        targetLines.map((line) => [line.id, line])
      );
      setItems((previous) =>
        previous.map((item) => updatedById.get(item.id) ?? item)
      );

      try {
        const bulkResult = await bulkUpdateEstimateItems(
          targetVersionId,
          versionSnapshot.updated_at,
          targetLines.map((line) => ({
            id: line.id,
            updates: buildEstimateItemUpdatePayload(line),
          }))
        );
        if (
          getVersionSnapshot()?.id !== targetVersionId ||
          !isCurrentScope()
        ) {
          return false;
        }
        applyVersionToken(bulkResult.versionToken.updated_at);
        setTotalsOutOfSync(false);
        return true;
      } catch (error) {
        if (
          getVersionSnapshot()?.id !== targetVersionId ||
          !isCurrentScope()
        ) {
          return false;
        }
        setItems(snapshot);
        if (!handleVersionConflict(error, { persistDraft: true })) {
          reportError(
            resolveErrorMessage(
              error instanceof Error ? error.message : failureMessage
            )
          );
        }
        throw error;
      }
    },
    [
      applyVersionToken,
      getItemsSnapshot,
      getVersionSnapshot,
      handleVersionConflict,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
    ]
  );

  const guardBulkAction = useCallback(
    async (actionLabel: string) => {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return false;
      }
      return ensureGroupedActionCanProceed(actionLabel);
    },
    [
      ensureGroupedActionCanProceed,
      isMutationBlocked,
      mutationBlockedMessage,
      reportError,
    ]
  );

  const applyBulkMajoration = useCallback(
    async (itemIds: string[], coefficient: number) => {
      if (!(await guardBulkAction("appliquer la majoration en lot"))) return;
      if (!getVersionSnapshot()) {
        reportError("Version introuvable.");
        return;
      }

      const selectedIds = new Set(itemIds);
      const selectedLines = getItemsSnapshot().filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIds.has(item.id)
      );
      if (selectedLines.length === 0) return;

      reportError(null);
      const normalizedCoefficient = Math.max(
        toFiniteNumber(coefficient, 1),
        0
      );
      const updatedLines = selectedLines.map((item) =>
        normalizeLine({
          ...item,
          h_mo_majoration: normalizedCoefficient,
        })
      );

      try {
        if (
          !(await applyBulkLineState(
            updatedLines,
            "Impossible d'appliquer la majoration en lot."
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-majoration",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler la majoration en lot.",
              context?.isCurrentScope
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de reappliquer la majoration en lot.",
              context?.isCurrentScope
            );
          },
        });
      } catch {
        // applyBulkLineState already restored state and reported the failure.
      }
    },
    [
      applyBulkLineState,
      getItemsSnapshot,
      getVersionSnapshot,
      guardBulkAction,
      normalizeLine,
      pushHistoryCommand,
      reportError,
    ]
  );

  const bulkDeleteLines = useCallback(
    async (itemIds: string[]) => {
      if (!(await guardBulkAction("supprimer les lignes selectionnees"))) return;
      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot) {
        reportError("Version introuvable.");
        return;
      }
      const targetVersionId = versionSnapshot.id;
      const selectedIdSet = new Set(itemIds);
      const snapshot = getItemsSnapshot();
      const selectedLines = snapshot.filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIdSet.has(item.id)
      );
      if (selectedLines.length === 0) return;

      const siblingOrderByParent = new Map<string | null, string[]>();
      const allSiblingOrders = buildSiblingOrderByParent(snapshot);
      selectedLines.forEach((line) => {
        const parentId = line.parent_id ?? null;
        const orderedIds = allSiblingOrders.get(parentId);
        if (orderedIds) siblingOrderByParent.set(parentId, orderedIds);
      });

      reportError(null);
      setItems((previous) =>
        previous.filter((item) => !selectedIdSet.has(item.id))
      );

      let deletedCount = 0;
      try {
        for (const line of selectedLines) {
          await deleteEstimateItem(targetVersionId, line.id);
          deletedCount += 1;
        }
        if (getVersionSnapshot()?.id !== targetVersionId) return;
        setTotalsOutOfSync(false);
        let currentDeletedLineIds = selectedLines.map((line) => line.id);
        pushHistoryCommand({
          label: "bulk-delete-lines",
          undo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const undoSnapshot = getItemsSnapshot();
            try {
              const recreated = await recreateItemsFromSnapshots(
                currentVersion.id,
                selectedLines
              );
              if (context && !context.isCurrentScope()) return;
              setItems([...undoSnapshot, ...recreated.createdItems]);
              if (context) {
                await applySiblingOrder(
                  currentVersion.id,
                  siblingOrderByParent,
                  recreated.idMap,
                  context.isCurrentScope
                );
              } else {
                await applySiblingOrder(
                  currentVersion.id,
                  siblingOrderByParent,
                  recreated.idMap
                );
              }
              if (context && !context.isCurrentScope()) return;
              currentDeletedLineIds = selectedLines.map(
                (line) => recreated.idMap.get(line.id) ?? line.id
              );
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              await reloadItems();
              throw error;
            }
          },
          redo: async (context) => {
            const currentVersion = getVersionSnapshot();
            if (!currentVersion) throw new Error("Version introuvable.");
            const redoSnapshot = getItemsSnapshot();
            const toDelete = new Set(currentDeletedLineIds);
            setItems((previous) =>
              previous.filter((item) => !toDelete.has(item.id))
            );
            try {
              for (const lineId of currentDeletedLineIds) {
                await deleteEstimateItem(currentVersion.id, lineId);
              }
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
        if (deletedCount > 0) {
          const hasConflict = handleVersionConflict(error, {
            persistDraft: true,
          });
          if (!hasConflict) triggerVersionReload();
          const baseMessage = resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de supprimer toutes les lignes selectionnees."
          );
          reportError(
            `Suppression partielle detectee (${deletedCount}/${selectedLines.length}) : ${baseMessage}. La version a ete rechargee; verifiez les lignes puis reessayez.`
          );
          return;
        }

        if (!handleVersionConflict(error, { persistDraft: true })) {
          reportError(
            resolveErrorMessage(
              error instanceof Error
                ? error.message
                : "Impossible de supprimer les lignes selectionnees."
            )
          );
        }
      }
    },
    [
      applySiblingOrder,
      getItemsSnapshot,
      getVersionSnapshot,
      guardBulkAction,
      handleVersionConflict,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
      reloadItems,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      triggerVersionReload,
    ]
  );

  const bulkMoveLines = useCallback(
    async (itemIds: string[], targetParentId: string | null) => {
      if (!(await guardBulkAction("deplacer les lignes selectionnees"))) return;
      if (!getVersionSnapshot()) {
        reportError("Version introuvable.");
        return;
      }

      const selectedIdSet = new Set(itemIds);
      const snapshot = getItemsSnapshot();
      const lineById = new Map(
        snapshot
          .filter((item): item is EstimateItem => item.item_type === "line")
          .map((item) => [item.id, item])
      );
      const selectedLines = itemIds
        .map((itemId) => lineById.get(itemId) ?? null)
        .filter((item): item is EstimateItem => item !== null);
      if (selectedLines.length === 0) return;

      reportError(null);
      let nextPosition =
        snapshot
          .filter(
            (item) =>
              item.parent_id === targetParentId && !selectedIdSet.has(item.id)
          )
          .reduce((maximum, item) => Math.max(maximum, item.position), 0) + 1;
      const movedLines = selectedLines.map((line) => ({
        ...line,
        parent_id: targetParentId,
        position: nextPosition++,
      }));

      try {
        if (
          !(await applyBulkLineState(
            movedLines,
            "Impossible de deplacer les lignes selectionnees."
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-move-lines",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler le deplacement des lignes.",
              context?.isCurrentScope
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              movedLines,
              "Impossible de reappliquer le deplacement des lignes.",
              context?.isCurrentScope
            );
          },
        });
      } catch {
        // applyBulkLineState already restored state and reported the failure.
      }
    },
    [
      applyBulkLineState,
      getItemsSnapshot,
      getVersionSnapshot,
      guardBulkAction,
      pushHistoryCommand,
      reportError,
    ]
  );

  const bulkSetCategory = useCallback(
    async (itemIds: string[], categoryId: string | null) => {
      if (!(await guardBulkAction("appliquer la categorie en lot"))) return;
      if (!getVersionSnapshot()) {
        reportError("Version introuvable.");
        return;
      }
      const selectedIds = new Set(itemIds);
      const selectedLines = getItemsSnapshot().filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIds.has(item.id)
      );
      if (selectedLines.length === 0) return;
      const updatedLines = selectedLines.map((line) => ({
        ...line,
        category_id: categoryId,
      }));

      reportError(null);
      try {
        if (
          !(await applyBulkLineState(
            updatedLines,
            "Impossible d'appliquer la categorie en lot."
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-set-category",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler la categorie en lot.",
              context?.isCurrentScope
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de reappliquer la categorie en lot.",
              context?.isCurrentScope
            );
          },
        });
      } catch {
        // applyBulkLineState already restored state and reported the failure.
      }
    },
    [
      applyBulkLineState,
      getItemsSnapshot,
      getVersionSnapshot,
      guardBulkAction,
      pushHistoryCommand,
      reportError,
    ]
  );

  const bulkSetLaborRole = useCallback(
    async (itemIds: string[], laborRoleId: string | null) => {
      if (!(await guardBulkAction("appliquer le role MO en lot"))) return;
      if (!getVersionSnapshot()) {
        reportError("Version introuvable.");
        return;
      }
      const selectedIds = new Set(itemIds);
      const selectedLines = getItemsSnapshot().filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIds.has(item.id)
      );
      if (selectedLines.length === 0) return;

      reportError(null);
      const updatedLines = selectedLines.map((line) =>
        normalizeLine({
          ...line,
          labor_role_id: laborRoleId,
          ...(isLaborSplitEnabled
            ? {
                labor_role_atelier_id: laborRoleId,
                labor_role_chantier_id: laborRoleId,
              }
            : {}),
        })
      );

      try {
        if (
          !(await applyBulkLineState(
            updatedLines,
            "Impossible d'appliquer le role MO en lot."
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-set-labor-role",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler le role MO en lot.",
              context?.isCurrentScope
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de reappliquer le role MO en lot.",
              context?.isCurrentScope
            );
          },
        });
      } catch {
        // applyBulkLineState already restored state and reported the failure.
      }
    },
    [
      applyBulkLineState,
      getItemsSnapshot,
      getVersionSnapshot,
      guardBulkAction,
      isLaborSplitEnabled,
      normalizeLine,
      pushHistoryCommand,
      reportError,
    ]
  );

  const actions = useMemo(
    () => ({
      applyBulkMajoration,
      bulkDeleteLines,
      bulkMoveLines,
      bulkSetCategory,
      bulkSetLaborRole,
    }),
    [
      applyBulkMajoration,
      bulkDeleteLines,
      bulkMoveLines,
      bulkSetCategory,
      bulkSetLaborRole,
    ]
  );

  return { actions };
}
