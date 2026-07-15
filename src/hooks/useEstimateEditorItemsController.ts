"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import {
  createEstimateItem,
  deleteEstimateItem,
  reorderEstimateItems,
} from "@/lib/estimates/client";
import {
  buildEstimateItemInsertPayload,
  buildEstimateItemUpdatePayload,
  createOptimisticLineItem,
  createOptimisticSectionItem,
  createTempEstimateItemId,
  isPendingCreateEstimateItem,
  isTempEstimateItemId,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemInsertPayload,
  type EstimateItemUpdatePayload,
  type EstimateVersionRow,
  type LaborSplitItemFields,
} from "@/lib/estimates/editor-items";
import {
  markTempItemsRemoved,
  reconcileCreatedItemWithLocalDraft,
  rollbackRemovedTempItems,
} from "@/lib/estimates/editor-optimistic";
import { getDefaultSectionTitleForLevel } from "@/lib/estimates/hierarchy";
import {
  buildSiblingOrderByParent,
  collectSubtreeItemIds,
  sortItemsForTreeRecreation,
} from "@/app/dashboard/estimates/[versionId]/edit/utils/item-tree";

export type EstimateEditorItemPatch = Partial<
  Pick<
    EstimateItem,
    | "title"
    | "aid"
    | "description"
    | "quantity"
    | "unit_price_ht_cents"
    | "tax_rate_bp"
    | "k_fo"
    | "h_mo"
    | "h_mo_majoration"
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
    | "supply_type_id"
    | "selected_supplier_price_id"
  >
> &
  LaborSplitItemFields;

type EstimateEditorItemsControllerInput = {
  version: Pick<EstimateVersionRow, "id" | "tenant_id"> | null;
  settings: Pick<
    EstimateSettingsState,
    "margin_multiplier" | "tax_rate_bp"
  > | null;
  isLaborSplitEnabled: boolean;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  normalizePatchedItem: (item: EditorEstimateItem) => EditorEstimateItem;
  enqueueItemUpdate: (
    itemId: string,
    payload: EstimateItemUpdatePayload
  ) => void;
  pushHistoryCommand: (command: EstimateEditorHistoryCommand) => void;
  reloadItems: () => Promise<void>;
};

export function useEstimateEditorItemsController({
  version,
  settings,
  isLaborSplitEnabled,
  isMutationBlocked,
  mutationBlockedMessage,
  getItemsSnapshot,
  getVersionSnapshot,
  setItems,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  normalizePatchedItem,
  enqueueItemUpdate,
  pushHistoryCommand,
  reloadItems,
}: EstimateEditorItemsControllerInput) {
  const queuedPatchesByTempIdRef = useRef<
    Map<string, EstimateItemUpdatePayload>
  >(new Map());
  const removedTempItemIdsRef = useRef<Set<string>>(new Set());
  const activeVersionIdRef = useRef(version?.id ?? null);

  useLayoutEffect(() => {
    if (activeVersionIdRef.current === (version?.id ?? null)) return;
    activeVersionIdRef.current = version?.id ?? null;
    queuedPatchesByTempIdRef.current.clear();
    removedTempItemIdsRef.current.clear();
  }, [version?.id]);

  const isCurrentVersion = useCallback(
    (versionId: string) => activeVersionIdRef.current === versionId,
    []
  );

  const getNextPosition = useCallback(
    (parentId: string | null) => {
      const siblings = getItemsSnapshot().filter(
        (item) => item.parent_id === parentId
      );
      return (
        siblings.reduce(
          (maximum, item) => Math.max(maximum, item.position),
          0
        ) + 1
      );
    },
    [getItemsSnapshot]
  );

  const resolveParentSectionLevel = useCallback(
    (parentId: string | null) => {
      if (!parentId) return 0;

      const itemById = new Map(
        getItemsSnapshot().map((item) => [item.id, item])
      );
      let level = 0;
      let cursorId: string | null = parentId;
      let guard = 0;

      while (cursorId && guard < 200) {
        guard += 1;
        const parent = itemById.get(cursorId);
        if (!parent || parent.item_type !== "section") break;
        level += 1;
        cursorId = parent.parent_id;
      }

      return level;
    },
    [getItemsSnapshot]
  );

  const recreateItemsFromSnapshots = useCallback(
    async (versionId: string, snapshots: EstimateItem[]) => {
      const idMap = new Map<string, string>();
      const createdItems: EstimateItem[] = [];

      for (const snapshotItem of sortItemsForTreeRecreation(snapshots)) {
        const mappedParentId = snapshotItem.parent_id
          ? (idMap.get(snapshotItem.parent_id) ?? snapshotItem.parent_id)
          : null;
        const payload = buildEstimateItemInsertPayload(versionId, snapshotItem, {
          parentId: mappedParentId,
          position: snapshotItem.position,
          title: snapshotItem.title,
        });
        const created = await createEstimateItem(versionId, payload);
        idMap.set(snapshotItem.id, created.id);
        createdItems.push(created);
      }

      return { idMap, createdItems };
    },
    []
  );

  const applySiblingOrder = useCallback(
    async (
      versionId: string,
      siblingOrderByParent: Map<string | null, string[]>,
      idMap: Map<string, string> = new Map(),
      isCurrentScope: () => boolean = () => true
    ) => {
      if (siblingOrderByParent.size === 0) return;

      const currentItemIds = new Set(
        getItemsSnapshot().map((item) => item.id)
      );
      const nextPositionById = new Map<string, number>();

      for (const [parentId, orderedIds] of siblingOrderByParent.entries()) {
        const mappedParentId = parentId ? (idMap.get(parentId) ?? parentId) : null;
        const mappedOrderedIds = orderedIds
          .map((itemId) => idMap.get(itemId) ?? itemId)
          .filter((itemId) => currentItemIds.has(itemId));
        if (mappedOrderedIds.length === 0) continue;

        await reorderEstimateItems(
          versionId,
          mappedParentId,
          mappedOrderedIds
        );
        if (!isCurrentScope()) return;
        mappedOrderedIds.forEach((itemId, index) => {
          nextPositionById.set(itemId, index + 1);
        });
      }

      if (nextPositionById.size === 0 || !isCurrentScope()) return;
      setItems((previous) =>
        previous.map((item) =>
          nextPositionById.has(item.id)
            ? {
                ...item,
                position: nextPositionById.get(item.id) ?? item.position,
              }
            : item
        )
      );
    },
    [getItemsSnapshot, setItems]
  );

  const addSection = useCallback(
    async (parentId: string | null) => {
      if (!version) return;
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      const targetVersion = version;
      reportError(null);
      const position = getNextPosition(parentId);
      const tempId = createTempEstimateItemId();
      const optimisticSection = createOptimisticSectionItem({
        tempId,
        tenantId: targetVersion.tenant_id,
        versionId: targetVersion.id,
        parentId,
        position,
        title: getDefaultSectionTitleForLevel(
          resolveParentSectionLevel(parentId) + 1
        ),
      });

      setItems((previous) => [...previous, optimisticSection]);

      try {
        const created = await createEstimateItem(targetVersion.id, {
          version_id: targetVersion.id,
          parent_id: parentId,
          item_type: "section",
          position,
          title: optimisticSection.title,
        });

        if (!isCurrentVersion(targetVersion.id)) {
          queuedPatchesByTempIdRef.current.delete(tempId);
          removedTempItemIdsRef.current.delete(tempId);
          return;
        }

        if (removedTempItemIdsRef.current.has(tempId)) {
          removedTempItemIdsRef.current.delete(tempId);
          queuedPatchesByTempIdRef.current.delete(tempId);
          try {
            await deleteEstimateItem(targetVersion.id, created.id);
          } catch {
            // Best-effort cleanup after a temp item was removed in flight.
          }
          return;
        }

        const queuedPatch = queuedPatchesByTempIdRef.current.get(tempId);
        queuedPatchesByTempIdRef.current.delete(tempId);
        setItems((previous) =>
          previous.map((item) =>
            item.id === tempId
              ? (reconcileCreatedItemWithLocalDraft(
                  created,
                  buildEstimateItemUpdatePayload(item),
                  queuedPatch
                ) as EditorEstimateItem)
              : item
          )
        );
        if (queuedPatch) enqueueItemUpdate(created.id, queuedPatch);

        let currentSectionId = created.id;
        pushHistoryCommand({
          label: "add-section",
          undo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const snapshot = getItemsSnapshot();
            const idsToRemove = collectSubtreeItemIds(
              snapshot,
              currentSectionId
            );
            setItems((previous) =>
              previous.filter((item) => !idsToRemove.has(item.id))
            );
            try {
              await deleteEstimateItem(versionSnapshot.id, currentSectionId);
              if (context && !context.isCurrentScope()) return;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              setItems(snapshot);
              throw error;
            }
          },
          redo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const payload = buildEstimateItemInsertPayload(
              versionSnapshot.id,
              created,
              {
                parentId,
                position: created.position,
                title: created.title,
              }
            );
            const recreated = await createEstimateItem(
              versionSnapshot.id,
              payload
            );
            if (context && !context.isCurrentScope()) return;
            currentSectionId = recreated.id;
            setItems((previous) => [...previous, recreated]);
            setTotalsOutOfSync(false);
          },
        });
      } catch (error) {
        queuedPatchesByTempIdRef.current.delete(tempId);
        if (!isCurrentVersion(targetVersion.id)) return;
        setItems((previous) =>
          previous.filter((item) => item.id !== tempId)
        );
        reportError(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de creer le chapitre."
          )
        );
      }
    },
    [
      enqueueItemUpdate,
      getItemsSnapshot,
      getNextPosition,
      getVersionSnapshot,
      isCurrentVersion,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      reportError,
      resolveErrorMessage,
      resolveParentSectionLevel,
      setItems,
      setTotalsOutOfSync,
      version,
    ]
  );

  const addLine = useCallback(
    async (parentId: string | null) => {
      if (!version || !settings) return;
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      const targetVersion = version;
      reportError(null);
      const position = getNextPosition(parentId);
      const lineValues = computeEstimateLineValues(
        {
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          pu_ht_cents: 0,
          labor_role_hourly_rate_cents: 0,
          h_mo_atelier: 0,
          k_mo_atelier: 1,
          labor_role_atelier_id: null,
          labor_role_atelier_hourly_rate_cents: 0,
          h_mo_chantier: 0,
          k_mo_chantier: 1,
          labor_role_chantier_id: null,
          labor_role_chantier_hourly_rate_cents: 0,
        },
        {
          marginMultiplier: settings.margin_multiplier,
          taxRateBp: settings.tax_rate_bp,
          isLaborSplitEnabled,
        }
      );
      const tempId = createTempEstimateItemId();
      const optimisticLine = createOptimisticLineItem({
        tempId,
        tenantId: targetVersion.tenant_id,
        versionId: targetVersion.id,
        parentId,
        position,
        title: "Nouvelle ligne",
        quantity: 1,
        taxRateBp: settings.tax_rate_bp,
        puHtCents: lineValues.puHtCents,
        lineTotalHtCents: lineValues.saleLineCents,
        lineTaxCents: lineValues.taxLineCents,
        lineTotalTtcCents: lineValues.ttcLineCents,
        isLaborSplitEnabled,
      });
      setItems((previous) => [...previous, optimisticLine]);

      const createPayload: EstimateItemInsertPayload = {
        version_id: targetVersion.id,
        parent_id: parentId,
        item_type: "line",
        position,
        title: optimisticLine.title,
        description: null,
        quantity: 1,
        unit_price_ht_cents: 0,
        tax_rate_bp: settings.tax_rate_bp,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        pu_ht_cents: lineValues.puHtCents,
        labor_role_id: null,
        category_id: null,
        supply_type_id: null,
        selected_supplier_price_id: null,
        line_total_ht_cents: lineValues.saleLineCents,
        line_tax_cents: lineValues.taxLineCents,
        line_total_ttc_cents: lineValues.ttcLineCents,
      };
      if (isLaborSplitEnabled) {
        createPayload.h_mo_atelier = 0;
        createPayload.k_mo_atelier = 1;
        createPayload.labor_role_atelier_id = null;
        createPayload.h_mo_chantier = 0;
        createPayload.k_mo_chantier = 1;
        createPayload.labor_role_chantier_id = null;
      }

      try {
        const created = await createEstimateItem(
          targetVersion.id,
          createPayload
        );
        if (!isCurrentVersion(targetVersion.id)) {
          queuedPatchesByTempIdRef.current.delete(tempId);
          removedTempItemIdsRef.current.delete(tempId);
          return;
        }

        if (removedTempItemIdsRef.current.has(tempId)) {
          removedTempItemIdsRef.current.delete(tempId);
          queuedPatchesByTempIdRef.current.delete(tempId);
          try {
            await deleteEstimateItem(targetVersion.id, created.id);
          } catch {
            // Best-effort cleanup after a temp item was removed in flight.
          }
          return;
        }

        const queuedPatch = queuedPatchesByTempIdRef.current.get(tempId);
        queuedPatchesByTempIdRef.current.delete(tempId);
        setItems((previous) =>
          previous.map((item) =>
            item.id === tempId
              ? (reconcileCreatedItemWithLocalDraft(
                  created,
                  buildEstimateItemUpdatePayload(item),
                  queuedPatch
                ) as EditorEstimateItem)
              : item
          )
        );
        if (queuedPatch) enqueueItemUpdate(created.id, queuedPatch);

        let currentLineId = created.id;
        pushHistoryCommand({
          label: "add-line",
          undo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const snapshot = getItemsSnapshot();
            setItems((previous) =>
              previous.filter((item) => item.id !== currentLineId)
            );
            try {
              await deleteEstimateItem(versionSnapshot.id, currentLineId);
              if (context && !context.isCurrentScope()) return;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              setItems(snapshot);
              throw error;
            }
          },
          redo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const payload = buildEstimateItemInsertPayload(
              versionSnapshot.id,
              created,
              {
                parentId,
                position: created.position,
                title: created.title,
              }
            );
            const recreated = await createEstimateItem(
              versionSnapshot.id,
              payload
            );
            if (context && !context.isCurrentScope()) return;
            currentLineId = recreated.id;
            setItems((previous) => [...previous, recreated]);
            setTotalsOutOfSync(false);
          },
        });
      } catch (error) {
        queuedPatchesByTempIdRef.current.delete(tempId);
        if (!isCurrentVersion(targetVersion.id)) return;
        setItems((previous) =>
          previous.filter((item) => item.id !== tempId)
        );
        reportError(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible d'ajouter la ligne."
          )
        );
      }
    },
    [
      enqueueItemUpdate,
      getItemsSnapshot,
      getNextPosition,
      getVersionSnapshot,
      isCurrentVersion,
      isLaborSplitEnabled,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      settings,
      version,
    ]
  );

  const deleteItem = useCallback(
    async (itemId: string) => {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      const snapshot = getItemsSnapshot();
      const idsToRemove = collectSubtreeItemIds(snapshot, itemId);
      const impactedCount = idsToRemove.size;
      const impactedLabel =
        impactedCount > 1
          ? `${impactedCount} elements (cet element + ${impactedCount - 1} enfant${
              impactedCount - 1 > 1 ? "s" : ""
            })`
          : "cet element";
      if (!window.confirm(`Supprimer ${impactedLabel} ?`)) return;
      reportError(null);

      const deletedSnapshots = snapshot.filter((item) =>
        idsToRemove.has(item.id)
      );
      const allSiblingOrders = buildSiblingOrderByParent(snapshot);
      const siblingOrderByParent = new Map<string | null, string[]>();
      const affectedParentIds = new Set<string | null>();
      deletedSnapshots.forEach((item) => {
        affectedParentIds.add(item.parent_id ?? null);
      });
      affectedParentIds.forEach((parentId) => {
        const order = allSiblingOrders.get(parentId);
        if (order) siblingOrderByParent.set(parentId, order);
      });
      setItems((previous) =>
        previous.filter((item) => !idsToRemove.has(item.id))
      );

      const removedTempIds = Array.from(idsToRemove).filter((id) =>
        isTempEstimateItemId(id)
      );
      const removedTempQueuedPatches = markTempItemsRemoved(
        removedTempIds,
        removedTempItemIdsRef.current,
        queuedPatchesByTempIdRef.current
      );
      const rollbackRemovedTempIds = () => {
        rollbackRemovedTempItems(
          removedTempIds,
          removedTempQueuedPatches,
          removedTempItemIdsRef.current,
          queuedPatchesByTempIdRef.current
        );
      };

      if (isTempEstimateItemId(itemId)) {
        setTotalsOutOfSync(false);
        return;
      }

      const targetVersionId = version?.id;
      if (!targetVersionId) {
        rollbackRemovedTempIds();
        reportError("Version introuvable.");
        await reloadItems();
        return;
      }

      try {
        await deleteEstimateItem(targetVersionId, itemId);
        if (!isCurrentVersion(targetVersionId)) return;

        let currentDeletedRootId = itemId;
        pushHistoryCommand({
          label: "delete-item",
          undo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const undoSnapshot = getItemsSnapshot();
            try {
              const recreated = await recreateItemsFromSnapshots(
                versionSnapshot.id,
                deletedSnapshots
              );
              if (context && !context.isCurrentScope()) return;
              setItems([...undoSnapshot, ...recreated.createdItems]);
              try {
                await applySiblingOrder(
                  versionSnapshot.id,
                  siblingOrderByParent,
                  recreated.idMap,
                  context?.isCurrentScope
                );
              } catch (error) {
                if (context && !context.isCurrentScope()) return;
                console.error(
                  "Impossible de restaurer l'ordre exact apres annulation de suppression.",
                  error
                );
              }
              if (context && !context.isCurrentScope()) return;
              currentDeletedRootId =
                recreated.idMap.get(itemId) ?? currentDeletedRootId;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (context && !context.isCurrentScope()) return;
              await reloadItems();
              throw error;
            }
          },
          redo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const redoSnapshot = getItemsSnapshot();
            const redoIdsToRemove = collectSubtreeItemIds(
              redoSnapshot,
              currentDeletedRootId
            );
            setItems((previous) =>
              previous.filter((item) => !redoIdsToRemove.has(item.id))
            );
            try {
              await deleteEstimateItem(
                versionSnapshot.id,
                currentDeletedRootId
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
      } catch (error) {
        rollbackRemovedTempIds();
        if (!isCurrentVersion(targetVersionId)) return;
        reportError(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de supprimer la ligne."
          )
        );
        await reloadItems();
      }
    },
    [
      applySiblingOrder,
      getItemsSnapshot,
      getVersionSnapshot,
      isCurrentVersion,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
      reloadItems,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      version?.id,
    ]
  );

  const patchItem = useCallback(
    async (
      itemId: string,
      patch: EstimateEditorItemPatch,
      options?: { persist?: boolean }
    ) => {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      const persist = options?.persist ?? false;
      const snapshot = getItemsSnapshot();
      const current = snapshot.find((item) => item.id === itemId);
      if (!current) return;
      const previousItem = current;
      let updated: EditorEstimateItem = { ...current, ...patch };
      if (updated.item_type === "line") {
        updated = normalizePatchedItem(updated);
      }

      const applyLocalItemPatch = () => {
        setItems((previous) =>
          previous.map((item) => (item.id === itemId ? updated : item))
        );
      };
      applyLocalItemPatch();
      if (!persist) return;

      if (isTempEstimateItemId(itemId) || isPendingCreateEstimateItem(current)) {
        const queuedPayload = buildEstimateItemUpdatePayload(updated);
        const existingPayload =
          queuedPatchesByTempIdRef.current.get(itemId) ?? {};
        queuedPatchesByTempIdRef.current.set(itemId, {
          ...existingPayload,
          ...queuedPayload,
        });
        setTotalsOutOfSync(false);
        return;
      }

      if (!version?.id) {
        reportError("Version introuvable.");
        setItems(snapshot);
        return;
      }

      enqueueItemUpdate(itemId, buildEstimateItemUpdatePayload(updated));
      setTotalsOutOfSync(false);
      pushHistoryCommand({
        label: "patch-item",
        undo: async () => {
          setItems((previous) =>
            previous.map((item) =>
              item.id === itemId ? previousItem : item
            )
          );
          enqueueItemUpdate(
            itemId,
            buildEstimateItemUpdatePayload(previousItem)
          );
          setTotalsOutOfSync(false);
        },
        redo: async () => {
          setItems((previous) =>
            previous.map((item) => (item.id === itemId ? updated : item))
          );
          enqueueItemUpdate(itemId, buildEstimateItemUpdatePayload(updated));
          setTotalsOutOfSync(false);
        },
      });
    },
    [
      enqueueItemUpdate,
      getItemsSnapshot,
      isMutationBlocked,
      mutationBlockedMessage,
      normalizePatchedItem,
      pushHistoryCommand,
      reportError,
      setItems,
      setTotalsOutOfSync,
      version?.id,
    ]
  );

  const actions = useMemo(
    () => ({
      addSection,
      addLine,
      deleteItem,
      patchItem,
      recreateItemsFromSnapshots,
      applySiblingOrder,
    }),
    [
      addLine,
      addSection,
      applySiblingOrder,
      deleteItem,
      patchItem,
      recreateItemsFromSnapshots,
    ]
  );

  return { actions };
}
