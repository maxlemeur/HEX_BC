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
  type EstimateItemUpdatePayload,
  type EstimateVersionRow,
  type EstimateVersionTotalsPatch,
} from "@/lib/estimates/editor-items";
import { toFiniteNumber } from "@/lib/estimates/editor-values";
import type { EstimateV3EditorWriter } from "@/lib/estimates/v3-editor-writer";
import { buildSiblingOrderByParent } from "@/app/dashboard/estimates/[versionId]/edit/utils/item-tree";

type RecreatedItems = {
  idMap: Map<string, string>;
  createdItems: EstimateItem[];
};

// A move is only saved with its placement; the line payload alone omits it.
function withPlacement(
  buildLine: (line: EstimateItem) => EstimateItemUpdatePayload
): (line: EstimateItem) => EstimateItemUpdatePayload {
  return (line) => ({
    ...buildLine(line),
    parent_id: line.parent_id ?? null,
    position: line.position,
  });
}

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
  /**
   * Version totals of these rows, from the editor's persisted-totals calculation (v1/v2). A v3
   * sends none: its writer recalculates and checks them (D12).
   */
  computeVersionTotalsPatch: (
    items: EditorEstimateItem[]
  ) => EstimateVersionTotalsPatch | undefined;
  /** `contentRevision`: returned by the v3 writer only (lot 2, sous-lot 2.6). */
  applyVersionToken: (
    updatedAt: string,
    totals?: EstimateVersionTotalsPatch,
    contentRevision?: number
  ) => void;
  markItemsSynced: (
    entries: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>
  ) => void;
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
  /**
   * Lot 2, sous-lot 2.6 (revue, F26-22) : sur une v3, les lignes modifiées, déplacées ou supprimées en lot partent
   * par l'écrivain de lot (saisies seulement, recalcul et vérification D12) ; absent en v1/v2 (chemins historiques).
   */
  v3Writer?: EstimateV3EditorWriter;
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
  computeVersionTotalsPatch,
  applyVersionToken,
  markItemsSynced,
  ensureGroupedActionCanProceed,
  handleVersionConflict,
  triggerVersionReload,
  pushHistoryCommand,
  recreateItemsFromSnapshots,
  applySiblingOrder,
  reloadItems,
  v3Writer,
}: EstimateEditorBulkControllerInput) {
  const buildLineUpdate = v3Writer?.buildUpdatePayload ?? buildEstimateItemUpdatePayload;
  const buildPlacedLineUpdatePayload = useMemo(() => withPlacement(buildLineUpdate), [buildLineUpdate]);
  const applyBulkLineState = useCallback(
    async (
      targetLines: EstimateItem[],
      failureMessage: string,
      isCurrentScope: () => boolean = () => true,
      buildUpdate: (line: EstimateItem) => EstimateItemUpdatePayload = buildLineUpdate
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
      // The lines and the version totals they imply are written by one RPC: the
      // stored totals feed the affaires list, approvals and documents. A v3
      // sends no client total: its writer recalculates and checks them (D12).
      // A move changes no amount and keeps its line-only write: with a version
      // patch, a v2 draft rewrites every line, and the RPC's negative-position
      // pass then collides on (parent_id, position) when a line moves back
      // beside a sibling holding its old position (bulk-move undo, 409).
      const sendsVersionTotals = !v3Writer && buildUpdate !== buildPlacedLineUpdatePayload;
      const versionTotalsPatch = sendsVersionTotals
        ? computeVersionTotalsPatch(
            snapshot.map((item) => updatedById.get(item.id) ?? item)
          )
        : undefined;
      if (sendsVersionTotals && !versionTotalsPatch) {
        reportError("Impossible de calculer les totaux du devis.");
        throw new Error("Impossible de calculer les totaux du devis.");
      }
      setItems((previous) =>
        previous.map((item) => updatedById.get(item.id) ?? item)
      );
      const updates = targetLines.map((line) => ({
        id: line.id,
        updates: buildUpdate(line),
      }));

      try {
        const bulkResult = v3Writer
          ? { versionToken: await v3Writer.updateItems(targetVersionId, versionSnapshot.updated_at, updates), totals: undefined }
          : await bulkUpdateEstimateItems(
              targetVersionId,
              versionSnapshot.updated_at,
              updates,
              versionTotalsPatch
            );
        if (
          getVersionSnapshot()?.id !== targetVersionId ||
          !isCurrentScope()
        ) {
          return false;
        }
        // v2 returns the totals it recalculated; v1 stores the patch as sent.
        // Only the v3 writer returns the content revision the editor resumes from.
        applyVersionToken(
          bulkResult.versionToken.updated_at,
          bulkResult.totals ?? versionTotalsPatch,
          v3Writer ? bulkResult.versionToken.content_revision : undefined
        );
        // Without a fresh baseline, an edit back to the previous value is dropped.
        markItemsSynced(updates);
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
      buildLineUpdate,
      buildPlacedLineUpdatePayload,
      computeVersionTotalsPatch,
      getItemsSnapshot,
      getVersionSnapshot,
      handleVersionConflict,
      markItemsSynced,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      v3Writer,
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
              "Impossible de réappliquer la majoration en lot.",
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
      if (!(await guardBulkAction("supprimer les lignes sélectionnées"))) return;
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
        if (v3Writer) {
          // v3 : un seul lot `delete`, atomique (aucune suppression partielle), recalculé et vérifié.
          await v3Writer.deleteItems(targetVersionId, versionSnapshot.updated_at, selectedLines.map((line) => line.id));
          deletedCount = selectedLines.length;
        } else {
          for (const line of selectedLines) {
            await deleteEstimateItem(targetVersionId, line.id);
            deletedCount += 1;
          }
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
              if (v3Writer) {
                await v3Writer.deleteItems(currentVersion.id, currentVersion.updated_at, currentDeletedLineIds);
              } else {
                for (const lineId of currentDeletedLineIds) {
                  await deleteEstimateItem(currentVersion.id, lineId);
                }
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
              : "Impossible de supprimer toutes les lignes sélectionnées."
          );
          reportError(
            `Suppression partielle détectée (${deletedCount}/${selectedLines.length}) : ${baseMessage}. La version a été rechargee; vérifiez les lignes puis réessayez.`
          );
          return;
        }

        if (!handleVersionConflict(error, { persistDraft: true })) {
          reportError(
            resolveErrorMessage(
              error instanceof Error
                ? error.message
                : "Impossible de supprimer les lignes sélectionnées."
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
      v3Writer,
    ]
  );

  const bulkMoveLines = useCallback(
    async (itemIds: string[], targetParentId: string | null) => {
      if (!(await guardBulkAction("déplacer les lignes sélectionnées"))) return;
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
            "Impossible de déplacer les lignes sélectionnées.",
            undefined,
            buildPlacedLineUpdatePayload
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-move-lines",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler le déplacement des lignes.",
              context?.isCurrentScope,
              buildPlacedLineUpdatePayload
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              movedLines,
              "Impossible de réappliquer le déplacement des lignes.",
              context?.isCurrentScope,
              buildPlacedLineUpdatePayload
            );
          },
        });
      } catch {
        // applyBulkLineState already restored state and reported the failure.
      }
    },
    [
      applyBulkLineState,
      buildPlacedLineUpdatePayload,
      getItemsSnapshot,
      getVersionSnapshot,
      guardBulkAction,
      pushHistoryCommand,
      reportError,
    ]
  );

  const bulkSetCategory = useCallback(
    async (itemIds: string[], categoryId: string | null) => {
      if (!(await guardBulkAction("appliquer la catégorie en lot"))) return;
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
            "Impossible d'appliquer la catégorie en lot."
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-set-category",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler la catégorie en lot.",
              context?.isCurrentScope
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de réappliquer la catégorie en lot.",
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
      if (!(await guardBulkAction("appliquer le rôle MO en lot"))) return;
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
            "Impossible d'appliquer le rôle MO en lot."
          ))
        ) {
          return;
        }
        pushHistoryCommand({
          label: "bulk-set-labor-role",
          undo: async (context) => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler le rôle MO en lot.",
              context?.isCurrentScope
            );
          },
          redo: async (context) => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de réappliquer le rôle MO en lot.",
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
