"use client";

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import type { ClipboardPreviewValues } from "@/lib/estimates/clipboard";
import {
  batchEstimateOperations,
  deleteEstimateItem,
  reorderEstimateItems,
} from "@/lib/estimates/client";
import {
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemInsertPayload,
  type EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import { isRecord, toFiniteNumber } from "@/lib/estimates/editor-values";

const PASTE_CREATE_BATCH_MAX_OPERATIONS = 100;

type RecreatedItems = {
  idMap: Map<string, string>;
  createdItems: EstimateItem[];
};

type EstimateEditorPasteControllerInput = {
  settings: Pick<
    EstimateSettingsState,
    "margin_multiplier" | "tax_rate_bp"
  > | null;
  isLaborSplitEnabled: boolean;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  supplyTypeIdByLowerName: Map<string, string>;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
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
  reloadItems: () => Promise<void>;
};

export function useEstimateEditorPasteController({
  settings,
  isLaborSplitEnabled,
  isMutationBlocked,
  mutationBlockedMessage,
  supplyTypeIdByLowerName,
  getItemsSnapshot,
  getVersionSnapshot,
  setItems,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  applyVersionToken,
  ensureGroupedActionCanProceed,
  handleVersionConflict,
  triggerVersionReload,
  pushHistoryCommand,
  recreateItemsFromSnapshots,
  reloadItems,
}: EstimateEditorPasteControllerInput) {
  const pasteRows = useCallback(
    async ({
      anchorRowId,
      rows,
    }: {
      anchorRowId: string | null;
      rows: ClipboardPreviewValues[];
    }) => {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }
      if (!(await ensureGroupedActionCanProceed("coller les lignes"))) return;

      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot || !settings) {
        reportError("Version introuvable.");
        return;
      }
      const targetVersionId = versionSnapshot.id;
      const validRows = rows.filter(
        (row) =>
          typeof row.designation === "string" &&
          row.designation.trim().length > 0
      );
      if (validRows.length === 0) {
        reportError("Aucune ligne valide a inserer.");
        return;
      }

      reportError(null);
      const snapshot = getItemsSnapshot();
      const anchorItem = anchorRowId
        ? (snapshot.find((item) => item.id === anchorRowId) ?? null)
        : null;
      const targetParentId = anchorItem
        ? anchorItem.item_type === "section"
          ? anchorItem.id
          : (anchorItem.parent_id ?? null)
        : null;
      const insertAfterId =
        anchorItem?.item_type === "line" ? anchorItem.id : null;
      const beforeOrderedIds = snapshot
        .filter((item) => item.parent_id === targetParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      let nextPosition =
        snapshot
          .filter((item) => item.parent_id === targetParentId)
          .reduce((maximum, item) => Math.max(maximum, item.position), 0) + 1;

      const createPayloads: EstimateItemInsertPayload[] = validRows.map((row) => {
        const quantity = Math.max(toFiniteNumber(row.quantity, 1), 0);
        const unitPriceHtCents = Math.round(
          Math.max(toFiniteNumber(row.unit_price_ht, 0), 0) * 100
        );
        const kFo = Math.max(toFiniteNumber(row.k_fo, 1), 0);
        const hMo = Math.max(toFiniteNumber(row.h_mo, 0), 0);
        const kMo = Math.max(toFiniteNumber(row.k_mo, 1), 0);
        const hMoMajoration = Math.max(
          toFiniteNumber(row.h_mo_majoration, 1),
          0
        );
        const lineValues = computeEstimateLineValues(
          {
            quantity,
            unit_price_ht_cents: unitPriceHtCents,
            tax_rate_bp: settings.tax_rate_bp,
            k_fo: kFo,
            h_mo: hMo,
            h_mo_majoration: hMoMajoration,
            k_mo: kMo,
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
        const normalizedSupplyType = row.supply_type?.trim().toLowerCase();
        const payload: EstimateItemInsertPayload = {
          version_id: targetVersionId,
          parent_id: targetParentId,
          item_type: "line",
          position: nextPosition++,
          title: row.designation?.trim() || "Nouvelle ligne",
          description: row.unit?.trim() || null,
          quantity,
          unit_price_ht_cents: unitPriceHtCents,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: kFo,
          h_mo: hMo,
          h_mo_majoration: hMoMajoration,
          k_mo: kMo,
          pu_ht_cents: lineValues.puHtCents,
          labor_role_id: null,
          category_id: null,
          supply_type_id: normalizedSupplyType
            ? (supplyTypeIdByLowerName.get(normalizedSupplyType) ?? null)
            : null,
          selected_supplier_price_id: null,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
        if (isLaborSplitEnabled) {
          payload.h_mo_atelier = 0;
          payload.k_mo_atelier = 1;
          payload.labor_role_atelier_id = null;
          payload.h_mo_chantier = 0;
          payload.k_mo_chantier = 1;
          payload.labor_role_chantier_id = null;
        }
        return payload;
      });

      const createdItems: EstimateItem[] = [];
      let nextVersionToken = versionSnapshot.updated_at;
      try {
        for (
          let startIndex = 0;
          startIndex < createPayloads.length;
          startIndex += PASTE_CREATE_BATCH_MAX_OPERATIONS
        ) {
          const payloadChunk = createPayloads.slice(
            startIndex,
            startIndex + PASTE_CREATE_BATCH_MAX_OPERATIONS
          );
          const batchResult = await batchEstimateOperations(
            targetVersionId,
            nextVersionToken,
            payloadChunk.map((payload) => ({
              op: "create" as const,
              data: payload,
            }))
          );
          if (!batchResult.committed) {
            const failedResult = batchResult.results.find(
              (result) => result.status === "error"
            );
            throw new Error(
              failedResult?.message ??
                "Une operation de creation groupee a echoue."
            );
          }
          nextVersionToken = batchResult.versionToken.updated_at;

          const createdItemsByChunkIndex = new Map<number, EstimateItem>();
          batchResult.results.forEach((result) => {
            if (result.status !== "ok" || result.op !== "create") return;
            if (!isRecord(result.data) || !isRecord(result.data.item)) return;
            createdItemsByChunkIndex.set(
              result.index,
              result.data.item as EstimateItem
            );
          });
          for (let index = 0; index < payloadChunk.length; index += 1) {
            const createdItem = createdItemsByChunkIndex.get(index);
            if (!createdItem) {
              throw new Error("Impossible de recuperer les lignes collees.");
            }
            createdItems.push(createdItem);
          }
        }
      } catch (error) {
        if (createdItems.length > 0) {
          await Promise.allSettled(
            createdItems.map((item) =>
              deleteEstimateItem(targetVersionId, item.id)
            )
          );
        }
        if (getVersionSnapshot()?.id !== targetVersionId) return;
        const hasConflict = handleVersionConflict(error, {
          persistDraft: true,
        });
        if (createdItems.length > 0 && !hasConflict) {
          triggerVersionReload();
        }
        if (hasConflict) return;
        throw new Error(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible d'insérer les lignes collées."
          )
        );
      }

      if (getVersionSnapshot()?.id !== targetVersionId) return;
      if (nextVersionToken !== versionSnapshot.updated_at) {
        applyVersionToken(nextVersionToken);
      }

      const insertedIds = createdItems.map((item) => item.id);
      const mergedItems = [...snapshot, ...createdItems];
      setItems(mergedItems);
      const currentOrderedIds = mergedItems
        .filter((item) => item.parent_id === targetParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      let afterOrderedIds = currentOrderedIds;
      if (insertAfterId) {
        const withoutInserted = currentOrderedIds.filter(
          (itemId) => !insertedIds.includes(itemId)
        );
        const anchorIndex = withoutInserted.indexOf(insertAfterId);
        afterOrderedIds =
          anchorIndex >= 0
            ? [
                ...withoutInserted.slice(0, anchorIndex + 1),
                ...insertedIds,
                ...withoutInserted.slice(anchorIndex + 1),
              ]
            : [...withoutInserted, ...insertedIds];
      }

      if (afterOrderedIds.join("|") !== currentOrderedIds.join("|")) {
        try {
          await reorderEstimateItems(
            targetVersionId,
            targetParentId,
            afterOrderedIds
          );
          if (getVersionSnapshot()?.id !== targetVersionId) return;
          const nextPositionById = new Map<string, number>();
          afterOrderedIds.forEach((itemId, index) => {
            nextPositionById.set(itemId, index + 1);
          });
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
        } catch (error) {
          if (getVersionSnapshot()?.id !== targetVersionId) return;
          await reloadItems();
          throw new Error(
            resolveErrorMessage(
              error instanceof Error
                ? error.message
                : "Impossible de repositionner les lignes collees."
            )
          );
        }
      }
      setTotalsOutOfSync(false);

      let currentInsertedIds = [...insertedIds];
      pushHistoryCommand({
        label: "paste-insert",
        undo: async (context) => {
          const currentVersion = getVersionSnapshot();
          if (!currentVersion) throw new Error("Version introuvable.");
          const undoSnapshot = getItemsSnapshot();
          const idsToDelete = new Set(currentInsertedIds);
          setItems((previous) =>
            previous.filter((item) => !idsToDelete.has(item.id))
          );
          try {
            for (const itemId of currentInsertedIds) {
              await deleteEstimateItem(currentVersion.id, itemId);
            }
            const survivingIds = new Set(
              undoSnapshot
                .filter((item) => !idsToDelete.has(item.id))
                .map((item) => item.id)
            );
            const restoredBeforeOrder = beforeOrderedIds.filter((itemId) =>
              survivingIds.has(itemId)
            );
            if (restoredBeforeOrder.length > 0) {
              await reorderEstimateItems(
                currentVersion.id,
                targetParentId,
                restoredBeforeOrder
              );
              if (context && !context.isCurrentScope()) return;
              const nextPositionById = new Map<string, number>();
              restoredBeforeOrder.forEach((itemId, index) => {
                nextPositionById.set(itemId, index + 1);
              });
              setItems((previous) =>
                previous.map((item) =>
                  nextPositionById.has(item.id)
                    ? {
                        ...item,
                        position:
                          nextPositionById.get(item.id) ?? item.position,
                      }
                    : item
                )
              );
            }
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
          const recreated = await recreateItemsFromSnapshots(
            currentVersion.id,
            createdItems
          );
          if (context && !context.isCurrentScope()) return;
          const remappedAfterOrder = afterOrderedIds.map(
            (itemId) => recreated.idMap.get(itemId) ?? itemId
          );
          setItems([...redoSnapshot, ...recreated.createdItems]);
          currentInsertedIds = createdItems.map(
            (item) => recreated.idMap.get(item.id) ?? item.id
          );
          try {
            await reorderEstimateItems(
              currentVersion.id,
              targetParentId,
              remappedAfterOrder
            );
            if (context && !context.isCurrentScope()) return;
            const nextPositionById = new Map<string, number>();
            remappedAfterOrder.forEach((itemId, index) => {
              nextPositionById.set(itemId, index + 1);
            });
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
            setTotalsOutOfSync(false);
          } catch (error) {
            if (context && !context.isCurrentScope()) return;
            setItems(redoSnapshot);
            throw error;
          }
        },
      });
    },
    [
      applyVersionToken,
      ensureGroupedActionCanProceed,
      getItemsSnapshot,
      getVersionSnapshot,
      handleVersionConflict,
      isLaborSplitEnabled,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
      reloadItems,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      settings,
      supplyTypeIdByLowerName,
      triggerVersionReload,
    ]
  );

  const actions = useMemo(() => ({ pasteRows }), [pasteRows]);
  return { actions };
}
