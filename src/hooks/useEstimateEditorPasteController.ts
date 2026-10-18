"use client";

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import { computeLineHoursFromHoursPerUnit } from "@/lib/affaires/import-flow";
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
import { commitEstimateV3Operations, type EstimateV3EditorWriter } from "@/lib/estimates/v3-editor-writer";
import { interpretClipboardRowForV3 } from "@/lib/estimates/v3-paste";

const PASTE_CREATE_BATCH_MAX_OPERATIONS = 100;

type RecreatedItems = {
  idMap: Map<string, string>;
  createdItems: EstimateItem[];
};

type EstimateEditorPasteControllerInput = {
  settings: Pick<
    EstimateSettingsState,
    "margin_multiplier" | "tax_rate_bp" | "contractor_role"
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
  /**
   * Lot 2, sous-lot 2.8, règle 2 (lève le refus F26-31 du 2.6) : sur une v3, les lignes collées portent leurs saisies
   * v3 (unité du référentiel ou statut, heures par unité, rôle MO choisi dans l'aperçu) et passent par l'écrivain de lot,
   * comme leur repositionnement et l'annulation du collage ; absent en v1/v2.
   */
  v3Writer?: EstimateV3EditorWriter;
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
  v3Writer,
}: EstimateEditorPasteControllerInput) {
  // v1/v2 : routes directes (inchangées) ; v3 : un lot recalculé et vérifié (D12), dont le jeton de version est repris.
  const reorderSiblings = useCallback(
    async (versionId: string, parentId: string | null, orderedIds: string[]) => {
      if (!v3Writer) return reorderEstimateItems(versionId, parentId, orderedIds);
      const token = await commitEstimateV3Operations(versionId, getVersionSnapshot()?.updated_at ?? "",
        [{ op: "reorder", data: { parent_id: parentId, ordered_ids: orderedIds } }],
        "Impossible de repositionner les lignes collées.");
      applyVersionToken(token.updated_at);
    },
    [applyVersionToken, getVersionSnapshot, v3Writer]
  );
  const deletePastedItems = useCallback(
    async (versionId: string, itemIds: string[]) => {
      if (!v3Writer) {
        for (const itemId of itemIds) {
          await deleteEstimateItem(versionId, itemId);
        }
        return;
      }
      // Un lot v3 porte au plus PASTE_CREATE_BATCH_MAX_OPERATIONS opérations, comme la création.
      for (let start = 0; start < itemIds.length; start += PASTE_CREATE_BATCH_MAX_OPERATIONS) {
        const token = await v3Writer.deleteItems(versionId, getVersionSnapshot()?.updated_at ?? "",
          itemIds.slice(start, start + PASTE_CREATE_BATCH_MAX_OPERATIONS));
        applyVersionToken(token.updated_at);
      }
    },
    [applyVersionToken, getVersionSnapshot, v3Writer]
  );

  const pasteRows = useCallback(
    async ({
      anchorRowId,
      rows,
      laborRoleId = null,
    }: {
      anchorRowId: string | null;
      rows: ClipboardPreviewValues[];
      laborRoleId?: string | null;
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
        reportError("Aucune ligne valide à insérer.");
        return;
      }

      reportError(null);
      const snapshot = getItemsSnapshot();
      const effectiveTaxRateBp =
        settings.contractor_role === "subcontractor"
          ? 0
          : settings.tax_rate_bp;
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
        const normalizedSupplyType = row.supply_type?.trim().toLowerCase();
        const supplyTypeId = normalizedSupplyType
          ? (supplyTypeIdByLowerName.get(normalizedSupplyType) ?? null)
          : null;
        if (v3Writer) {
          // v3 : saisies seulement, jamais d'unité dans description, d'heures de ligne ni de projection (D4, D12).
          const interpretation = interpretClipboardRowForV3(row);
          if (!interpretation.ok) throw new Error(interpretation.reasons[0]);
          const { unit_code, pricing_status, h_mo_per_unit } = interpretation.write;
          const v3Payload: Record<string, unknown> = {
            version_id: targetVersionId,
            parent_id: targetParentId,
            item_type: "line",
            position: nextPosition++,
            title: row.designation?.trim() || "Nouvelle ligne",
            description: null,
            quantity,
            unit_price_ht_cents: unitPriceHtCents,
            tax_rate_bp: settings.tax_rate_bp,
            k_fo: kFo,
            h_mo_majoration: Math.max(toFiniteNumber(row.h_mo_majoration, 1), 0),
            k_mo: Math.max(toFiniteNumber(row.k_mo, 1), 0),
            labor_role_id: (h_mo_per_unit ?? 0) > 0 ? laborRoleId : null,
            category_id: null,
            supply_type_id: supplyTypeId,
            selected_supplier_price_id: null,
            unit_code,
            pricing_status,
            h_mo_per_unit,
          };
          return v3Payload as EstimateItemInsertPayload;
        }
        // Sub-lot 2.8 (P-16): a v1/v2 stores the line's hours; pasted hours per unit become h/u × Q.
        const hMo = row.h_mo_per_unit !== null && row.h_mo_per_unit !== undefined
          ? (computeLineHoursFromHoursPerUnit(quantity, Math.max(row.h_mo_per_unit, 0)) ?? 0)
          : Math.max(toFiniteNumber(row.h_mo, 0), 0);
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
            taxRateBp: effectiveTaxRateBp,
            isLaborSplitEnabled,
          }
        );
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
          supply_type_id: supplyTypeId,
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
                "Une opération de création groupée a échoué."
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
              throw new Error("Impossible de récupérer les lignes collees.");
            }
            createdItems.push(createdItem);
          }
        }
      } catch (error) {
        if (getVersionSnapshot()?.id !== targetVersionId) return;
        const hasConflict = handleVersionConflict(error, {
          persistDraft: true,
        });
        if (createdItems.length > 0 && !hasConflict) {
          triggerVersionReload();
        }
        if (createdItems.length > 0) {
          reportError(`${createdItems.length} ligne(s) ont été enregistrées. Le collage s'est arrêté ; les lignes enregistrées sont conservées.`);
          return;
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
          await reorderSiblings(
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
            await deletePastedItems(currentVersion.id, currentInsertedIds);
            const survivingIds = new Set(
              undoSnapshot
                .filter((item) => !idsToDelete.has(item.id))
                .map((item) => item.id)
            );
            const restoredBeforeOrder = beforeOrderedIds.filter((itemId) =>
              survivingIds.has(itemId)
            );
            if (restoredBeforeOrder.length > 0) {
              await reorderSiblings(
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
            // v3 : un premier lot de suppressions a pu être enregistré ; la grille relit l'état enregistré.
            if (v3Writer) await reloadItems();
            else setItems(undoSnapshot);
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
            await reorderSiblings(
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
      deletePastedItems,
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
      reorderSiblings,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      settings,
      supplyTypeIdByLowerName,
      triggerVersionReload,
      v3Writer,
    ]
  );

  const actions = useMemo(() => ({ pasteRows }), [pasteRows]);
  return { actions };
}
