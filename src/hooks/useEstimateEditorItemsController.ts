"use client";

import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { useEstimateEditorItemsOperation } from "@/hooks/useEstimateEditorItemsOperation";

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
import {
  createEstimateDeletionRestorer,
  type EstimateDeletionRecreationOptions,
} from "@/hooks/estimate-editor-deletion-history";
import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import {
  createEstimateItem,
  deleteEstimateItem,
  reorderEstimateItems,
  type EstimateVersionToken,
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
import { DEFAULT_FO_PROVISION, supplyTypeChanged } from "@/lib/estimates/fo-provision";
import { resolvePromotedEstimateLineNature } from "@/lib/estimates/line-nature";
import {
  markTempItemsRemoved,
  reconcileCreatedItemWithLocalDraft,
  rollbackRemovedTempItems,
} from "@/lib/estimates/editor-optimistic";
import type { EstimateV3EditorWriter } from "@/lib/estimates/v3-editor-writer";
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
    | "line_nature"
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
    | "product_id"
    | "selected_supplier_price_id"
    // Lot 2, sous-lot 2.6 : saisies d'une ligne v3 (D4, D9), jamais leurs totaux dérivés.
    | "unit_code" | "pricing_status" | "h_mo_per_unit" | "h_mo_atelier_per_unit" | "h_mo_chantier_per_unit"
  >
> &
  LaborSplitItemFields;

type EstimateEditorItemsControllerInput = {
  document?: EstimateEditorDocument;
  version: Pick<EstimateVersionRow, "id" | "tenant_id"> | null;
  settings: Pick<
    EstimateSettingsState,
    "margin_multiplier" | "tax_rate_bp" | "contractor_role"
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
  applyVersionToken: (updatedAt: string) => void;
  enqueueItemUpdate: (
    itemId: string,
    payload: EstimateItemUpdatePayload
  ) => void;
  pushHistoryCommand: (command: EstimateEditorHistoryCommand) => void;
  reloadItems: () => Promise<void>;
  /** Lot 2, sous-lot 2.6 : charge de ligne du moteur (v3 : saisies seulement) ; historique par défaut. */
  buildItemUpdatePayload?: (item: EstimateItem) => EstimateItemUpdatePayload;
  /**
   * Lot 2, sous-lot 2.6 (revue, F26-21) : sur une v3, suppressions et recréations par l'écrivain de lot (qui
   * recalcule), jamais par la suppression directe que 2.5 refuse ; absent en v1/v2 (chemins historiques).
   */
  v3Writer?: EstimateV3EditorWriter;
};

export function useEstimateEditorItemsController({
  document,
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
  applyVersionToken,
  enqueueItemUpdate,
  pushHistoryCommand,
  reloadItems,
  buildItemUpdatePayload = buildEstimateItemUpdatePayload,
  v3Writer,
}: EstimateEditorItemsControllerInput) {
  const { beginItemsOperation, isItemsOperationCurrent, isItemsDocumentCurrent, rollbackItems, acceptItemsReceipt, acceptDeletedItems, releaseItemsOperation } = useEstimateEditorItemsOperation({
    document, getItemsSnapshot, setItems, applyVersionToken: (updatedAt) => applyVersionToken(updatedAt),
  });
  const buildItemInsertPayload = v3Writer?.buildInsertPayload ?? buildEstimateItemInsertPayload;
  // v1/v2 : suppression directe (inchangée) ; v3 : un lot `delete`, recalculé et vérifié (D12).
  const deleteItemRecord = useCallback(async (versionId: string, itemId: string) => {
    if (!v3Writer) return deleteEstimateItem(versionId, itemId);
    const versionToken = await v3Writer.deleteItems(versionId, getVersionSnapshot()?.updated_at ?? "", [itemId]);
    return { versionToken };
  }, [getVersionSnapshot, v3Writer]);
  const acceptDeletionReceipt = useCallback((operation: ReturnType<typeof beginItemsOperation>, receipt: Awaited<ReturnType<typeof deleteItemRecord>>) => {
    let accepted = false;
    const accept = () => {
      if (document && "deletedIds" in receipt && !acceptDeletedItems(operation, { version: receipt.versionToken, deletedIds: receipt.deletedIds })) {
        rollbackItems(operation);
        return;
      }
      accepted = acceptItemsReceipt(operation, { version: receipt.versionToken });
    };
    if (document) document.transaction(accept);
    else accept();
    return accepted;
  }, [acceptDeletedItems, acceptItemsReceipt, document, rollbackItems]);
  // Nettoyage d'un élément retiré pendant sa création : au mieux en v1/v2 (inchangé) ; en v3, l'échec est signalé
  // et la grille relue, sinon une ligne orpheline resterait enregistrée, invisible jusqu'au prochain rechargement.
  const reportCleanupFailure = useCallback(async (error: unknown) => {
    if (!v3Writer) return;
    reportError(resolveErrorMessage(error instanceof Error ? error.message : "Impossible de supprimer la ligne."));
    await reloadItems();
  }, [reloadItems, reportError, resolveErrorMessage, v3Writer]);
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

  const applyCreatedItemVersionToken = useCallback(
    (versionToken: Pick<EstimateVersionRow, "id" | "updated_at">) => {
      if (!isCurrentVersion(versionToken.id)) return;
      const currentUpdatedAt = getVersionSnapshot()?.updated_at ?? null;
      const currentTimestamp = currentUpdatedAt
        ? Date.parse(currentUpdatedAt)
        : Number.NaN;
      const nextTimestamp = Date.parse(versionToken.updated_at);
      if (
        Number.isFinite(currentTimestamp) &&
        Number.isFinite(nextTimestamp) &&
        nextTimestamp < currentTimestamp
      ) {
        return;
      }
      applyVersionToken(versionToken.updated_at);
    },
    [applyVersionToken, getVersionSnapshot, isCurrentVersion]
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
    async (
      versionId: string,
      snapshots: EstimateItem[],
      options: EstimateDeletionRecreationOptions = {}
    ) => {
      const scope = document?.captureScope();
      const isDocumentCurrent = () => !document || Boolean(scope && document.isCurrent(scope));
      const idMap = new Map<string, string>();
      const createdItems: EstimateItem[] = [];
      if (!isItemsDocumentCurrent()) return { idMap, createdItems };

      for (const snapshotItem of sortItemsForTreeRecreation(snapshots)) {
        if (!isDocumentCurrent() || !isCurrentVersion(versionId) || options.isCurrentScope?.() === false) break;
        const mappedParentId = snapshotItem.parent_id
          ? (idMap.get(snapshotItem.parent_id) ?? snapshotItem.parent_id)
          : null;
        const payload = buildItemInsertPayload(versionId, snapshotItem, {
          parentId: mappedParentId,
          position: snapshotItem.position,
          title: snapshotItem.title,
        });
        let createdVersionToken: EstimateVersionToken | undefined;
        const created = await createEstimateItem(versionId, payload, {
          documentOwnsReceipt: Boolean(document),
          onVersionToken: (token) => {
            createdVersionToken = token;
            if (!document && isDocumentCurrent()) applyCreatedItemVersionToken(token);
          },
        });
        if (!isDocumentCurrent() || !isCurrentVersion(versionId) || options.isCurrentScope?.() === false) break;
        if (document && !document.acceptCreatedItem(null, created, scope, undefined, createdVersionToken)) {
          throw new Error("Une version plus récente du devis a été chargée. Vérifiez les lignes restaurées avant de poursuivre.");
        }
        idMap.set(snapshotItem.id, created.id);
        createdItems.push(created);
        options.onProgress?.({ idMap: new Map(idMap), createdItems: [...createdItems] });
      }

      return { idMap, createdItems };
    },
    [isItemsDocumentCurrent, applyCreatedItemVersionToken, buildItemInsertPayload, document, isCurrentVersion]
  );

  const applySiblingOrder = useCallback(
    async (
      versionId: string,
      siblingOrderByParent: Map<string | null, string[]>,
      idMap: Map<string, string> = new Map(),
      isCurrentScope: () => boolean = () => true
    ) => {
      if (!isItemsDocumentCurrent()) return false;
      if (siblingOrderByParent.size === 0) return;
      const scope = document?.captureScope();
      const isDocumentCurrent = () => !document || Boolean(scope && document.isCurrent(scope));

      const currentItemIds = new Set(
        [...getItemsSnapshot().map((item) => item.id), ...idMap.values()]
      );

      for (const [parentId, orderedIds] of siblingOrderByParent.entries()) {
        if (!isDocumentCurrent() || !isCurrentScope()) return false;
        const mappedParentId = parentId ? (idMap.get(parentId) ?? parentId) : null;
        const mappedOrderedIds = orderedIds
          .map((itemId) => idMap.get(itemId) ?? itemId)
          .filter((itemId) => currentItemIds.has(itemId));
        if (mappedOrderedIds.length === 0) {
          throw new Error("Impossible de confirmer l'ordre des lignes restaurées.");
        }

        const operation = beginItemsOperation((previous) => previous);
        if (!isItemsOperationCurrent(operation)) return false;
        try {
          const receipt = await reorderEstimateItems(versionId, mappedParentId, mappedOrderedIds);
          // Acknowledged parents are not written again when later ordering fails.
          if (!isDocumentCurrent() || !isCurrentScope()) return false;
          const updates = mappedOrderedIds.map((id, index) => ({ id, updates: { position: index + 1 } }));
          if (!acceptItemsReceipt(operation, { version: receipt.versionToken, updates })) return false;
          siblingOrderByParent.delete(parentId);
          if (!document) {
            const nextPositionById = new Map(mappedOrderedIds.map((itemId, index) => [itemId, index + 1]));
            setItems((previous) => previous.map((item) => nextPositionById.has(item.id)
              ? { ...item, position: nextPositionById.get(item.id) ?? item.position } : item));
          }
        } catch (error) {
          rollbackItems(operation);
          throw error;
        }
      }
    },
    [acceptItemsReceipt, beginItemsOperation, isItemsOperationCurrent, rollbackItems, isItemsDocumentCurrent, document, getItemsSnapshot, setItems]
  );

  const addSection = useCallback(
    async (parentId: string | null) => {
      if (!isItemsDocumentCurrent() || !version) return;
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      if (parentId && (isTempEstimateItemId(parentId) || getItemsSnapshot().some((item) =>
        item.id === parentId && isPendingCreateEstimateItem(item)))) {
        reportError("La section est en cours d’enregistrement. Attendez sa confirmation avant d’ajouter une ligne ou un chapitre.");
        return;
      }

      const targetVersion = version;
      const documentScope = document?.captureScope();
      const isDocumentCurrent = () => !document || Boolean(documentScope && document.isCurrent(documentScope));
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
        let createdVersionToken: EstimateVersionToken | undefined;
        const created = await createEstimateItem(
          targetVersion.id,
          {
            version_id: targetVersion.id,
            parent_id: parentId,
            item_type: "section",
            position,
            title: optimisticSection.title,
          },
          { documentOwnsReceipt: Boolean(document), onVersionToken: (token) => {
            createdVersionToken = token;
            if (!document && isDocumentCurrent()) applyCreatedItemVersionToken(token);
          } }
        );

        if (!isDocumentCurrent() || !isCurrentVersion(targetVersion.id)) {
          queuedPatchesByTempIdRef.current.delete(tempId);
          removedTempItemIdsRef.current.delete(tempId);
          return;
        }

        if (removedTempItemIdsRef.current.has(tempId)) {
          removedTempItemIdsRef.current.delete(tempId);
          queuedPatchesByTempIdRef.current.delete(tempId);
          if (document && createdVersionToken && !document.setConfirmedVersion(
            (current) => current ? { ...current, ...createdVersionToken } : null, documentScope
          )) return;
          try {
            const receipt = await deleteItemRecord(targetVersion.id, created.id);
            if (isDocumentCurrent()) {
              if (document) document.confirmDeletedItems("deletedIds" in receipt ? receipt.deletedIds : [created.id], documentScope, receipt.versionToken);
              else applyVersionToken(receipt.versionToken.updated_at);
            }
          } catch (error) {
            // Best-effort cleanup after a temp item was removed in flight (v1/v2).
            if (isDocumentCurrent()) await reportCleanupFailure(error);
          }
          return;
        }

        const queuedPatch = queuedPatchesByTempIdRef.current.get(tempId);
        queuedPatchesByTempIdRef.current.delete(tempId);
        const reconcileCreated = (item: EditorEstimateItem) => reconcileCreatedItemWithLocalDraft(
          created, buildEstimateItemUpdatePayload(item), queuedPatch, item._clientKey ?? tempId
        ) as EditorEstimateItem;
        if (document) {
          const local = getItemsSnapshot().find((item) => item.id === tempId);
          let accepted = false;
          document.transaction(() => {
            if (queuedPatch) document.enqueueItem(tempId, queuedPatch);
            accepted = document.acceptCreatedItem(tempId, created, documentScope, local ? reconcileCreated(local) : undefined, createdVersionToken);
          });
          if (!accepted) return;
        } else {
          setItems((previous) => previous.map((item) => item.id === tempId ? reconcileCreated(item) : item));
        }
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
            const undoOperation = beginItemsOperation((previous) =>
              previous.filter((item) => !idsToRemove.has(item.id))
            );
            if (!isItemsOperationCurrent(undoOperation)) return false;
            try {
              const receipt = await deleteItemRecord(versionSnapshot.id, currentSectionId);
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              if (!acceptDeletionReceipt(undoOperation, receipt)) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(undoOperation);
              throw error;
            }
          },
          redo: async (context) => {
            if (!isDocumentCurrent() || (context && !context.isCurrentScope())) return;
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const payload = buildItemInsertPayload(
              versionSnapshot.id,
              created,
              {
                parentId,
                position: created.position,
                title: created.title,
              }
            );
            let recreatedVersionToken: EstimateVersionToken | undefined;
            const recreated = await createEstimateItem(
              versionSnapshot.id,
              payload,
              { documentOwnsReceipt: Boolean(document), onVersionToken: (token) => {
                recreatedVersionToken = token;
                if (!document && isDocumentCurrent()) applyCreatedItemVersionToken(token);
              } }
            );
            if (!isDocumentCurrent() || (context && !context.isCurrentScope())) return;
            if (document) {
              if (!document.acceptCreatedItem(null, recreated, documentScope, undefined, recreatedVersionToken)) return false;
            } else setItems((previous) => [...previous, recreated]);
            currentSectionId = recreated.id;
            setTotalsOutOfSync(false);
          },
        });
      } catch (error) {
        queuedPatchesByTempIdRef.current.delete(tempId);
        if (!isDocumentCurrent() || !isCurrentVersion(targetVersion.id)) return;
        setItems((previous) =>
          previous.filter((item) => item.id !== tempId)
        );
        reportError(
          resolveErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de créer le chapitre."
          )
        );
      }
    },
    [
      isItemsDocumentCurrent,
      acceptDeletionReceipt,
      beginItemsOperation,
      isItemsOperationCurrent,
      rollbackItems,
      document,
      applyCreatedItemVersionToken,
      applyVersionToken,
      buildItemInsertPayload,
      deleteItemRecord,
      enqueueItemUpdate,
      getItemsSnapshot,
      getNextPosition,
      getVersionSnapshot,
      isCurrentVersion,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      reportCleanupFailure,
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
      if (!isItemsDocumentCurrent() || !version || !settings) return;
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }

      if (parentId && (isTempEstimateItemId(parentId) || getItemsSnapshot().some((item) =>
        item.id === parentId && isPendingCreateEstimateItem(item)))) {
        reportError("La section est en cours d’enregistrement. Attendez sa confirmation avant d’ajouter une ligne ou un chapitre.");
        return;
      }

      const targetVersion = version;
      const documentScope = document?.captureScope();
      const isDocumentCurrent = () => !document || Boolean(documentScope && document.isCurrent(documentScope));
      reportError(null);
      const position = getNextPosition(parentId);
      const effectiveTaxRateBp =
        settings.contractor_role === "subcontractor"
          ? 0
          : settings.tax_rate_bp;
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
          taxRateBp: effectiveTaxRateBp,
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
        // TI-534 : une ligne v3 sans type FO reçoit 1,010 du serveur.
        foProvision: v3Writer ? DEFAULT_FO_PROVISION : 1,
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
        product_id: null,
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
        let createdVersionToken: EstimateVersionToken | undefined;
        const created = await createEstimateItem(
          targetVersion.id,
          createPayload,
          { documentOwnsReceipt: Boolean(document), onVersionToken: (token) => {
            createdVersionToken = token;
            if (!document && isDocumentCurrent()) applyCreatedItemVersionToken(token);
          } }
        );
        if (!isDocumentCurrent() || !isCurrentVersion(targetVersion.id)) {
          queuedPatchesByTempIdRef.current.delete(tempId);
          removedTempItemIdsRef.current.delete(tempId);
          return;
        }

        if (removedTempItemIdsRef.current.has(tempId)) {
          removedTempItemIdsRef.current.delete(tempId);
          queuedPatchesByTempIdRef.current.delete(tempId);
          if (document && createdVersionToken && !document.setConfirmedVersion(
            (current) => current ? { ...current, ...createdVersionToken } : null, documentScope
          )) return;
          try {
            const receipt = await deleteItemRecord(targetVersion.id, created.id);
            if (isDocumentCurrent()) {
              if (document) document.confirmDeletedItems("deletedIds" in receipt ? receipt.deletedIds : [created.id], documentScope, receipt.versionToken);
              else applyVersionToken(receipt.versionToken.updated_at);
            }
          } catch (error) {
            // Best-effort cleanup after a temp item was removed in flight (v1/v2).
            if (isDocumentCurrent()) await reportCleanupFailure(error);
          }
          return;
        }

        const queuedPatch = queuedPatchesByTempIdRef.current.get(tempId);
        queuedPatchesByTempIdRef.current.delete(tempId);
        const reconcileCreated = (item: EditorEstimateItem) => {
          const reconciled = reconcileCreatedItemWithLocalDraft(
            created, buildItemUpdatePayload(item), queuedPatch, item._clientKey ?? tempId
          ) as EditorEstimateItem;
          // Keep the provision derived from the FO type edited during creation.
          return v3Writer && supplyTypeChanged(created.supply_type_id, reconciled.supply_type_id)
            ? { ...reconciled, fo_provision: item.fo_provision }
            : reconciled;
        };
        if (document) {
          const local = getItemsSnapshot().find((item) => item.id === tempId);
          let accepted = false;
          document.transaction(() => {
            if (queuedPatch) document.enqueueItem(tempId, queuedPatch);
            accepted = document.acceptCreatedItem(tempId, created, documentScope, local ? reconcileCreated(local) : undefined, createdVersionToken);
          });
          if (!accepted) return;
        } else {
          setItems((previous) => previous.map((item) => item.id === tempId ? reconcileCreated(item) : item));
        }
        if (queuedPatch) enqueueItemUpdate(created.id, queuedPatch);

        let currentLineId = created.id;
        pushHistoryCommand({
          label: "add-line",
          undo: async (context) => {
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const undoOperation = beginItemsOperation((previous) =>
              previous.filter((item) => item.id !== currentLineId)
            );
            if (!isItemsOperationCurrent(undoOperation)) return false;
            try {
              const receipt = await deleteItemRecord(versionSnapshot.id, currentLineId);
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              if (!acceptDeletionReceipt(undoOperation, receipt)) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(undoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(undoOperation);
              throw error;
            }
          },
          redo: async (context) => {
            if (!isDocumentCurrent() || (context && !context.isCurrentScope())) return;
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot) throw new Error("Version introuvable.");
            const payload = buildItemInsertPayload(
              versionSnapshot.id,
              created,
              {
                parentId,
                position: created.position,
                title: created.title,
              }
            );
            let recreatedVersionToken: EstimateVersionToken | undefined;
            const recreated = await createEstimateItem(
              versionSnapshot.id,
              payload,
              { documentOwnsReceipt: Boolean(document), onVersionToken: (token) => {
                recreatedVersionToken = token;
                if (!document && isDocumentCurrent()) applyCreatedItemVersionToken(token);
              } }
            );
            if (!isDocumentCurrent() || (context && !context.isCurrentScope())) return;
            if (document) {
              if (!document.acceptCreatedItem(null, recreated, documentScope, undefined, recreatedVersionToken)) return false;
            } else setItems((previous) => [...previous, recreated]);
            currentLineId = recreated.id;
            setTotalsOutOfSync(false);
          },
        });
      } catch (error) {
        queuedPatchesByTempIdRef.current.delete(tempId);
        if (!isDocumentCurrent() || !isCurrentVersion(targetVersion.id)) return;
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
      isItemsDocumentCurrent,
      acceptDeletionReceipt,
      beginItemsOperation,
      isItemsOperationCurrent,
      rollbackItems,
      document,
      applyCreatedItemVersionToken,
      applyVersionToken,
      buildItemInsertPayload,
      buildItemUpdatePayload,
      deleteItemRecord,
      enqueueItemUpdate,
      getItemsSnapshot,
      getNextPosition,
      getVersionSnapshot,
      isCurrentVersion,
      isLaborSplitEnabled,
      isMutationBlocked,
      mutationBlockedMessage,
      pushHistoryCommand,
      reportCleanupFailure,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
      settings,
      v3Writer,
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
      const operation = beginItemsOperation((previous) =>
        previous.filter((item) => !idsToRemove.has(item.id))
      );
      if (!isItemsOperationCurrent(operation)) return;

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
        releaseItemsOperation(operation);
        setTotalsOutOfSync(false);
        return;
      }

      const targetVersionId = version?.id;
      if (!targetVersionId) {
        rollbackItems(operation);
        rollbackRemovedTempIds();
        reportError("Version introuvable.");
        await reloadItems();
        return;
      }

      try {
        const receipt = await deleteItemRecord(targetVersionId, itemId);
        if (!isItemsOperationCurrent(operation) || !isCurrentVersion(targetVersionId)) return;
        if (!acceptDeletionReceipt(operation, receipt)) return;

        let currentDeletedRootId = itemId;
        const restorer = createEstimateDeletionRestorer({
          versionId: targetVersionId,
          snapshots: deletedSnapshots,
          siblingOrderByParent,
          itemId,
          plural: deletedSnapshots.length > 1,
          isCurrentVersion: () => getVersionSnapshot()?.id === targetVersionId,
          recreateItemsFromSnapshots,
          applySiblingOrder,
          setItems: document ? () => undefined : setItems,
          onRestored: (idMap) => {
            currentDeletedRootId = idMap.get(itemId) ?? currentDeletedRootId;
          },
        });
        pushHistoryCommand({
          label: "delete-item",
          undo: async (context) => {
            if ((await restorer.undo(context)) === false) return false;
            if (context && !context.isCurrentScope()) return;
            if (getVersionSnapshot()?.id !== targetVersionId) return;
            setTotalsOutOfSync(false);
          },
          redo: async (context) => {
            if (context && !context.isCurrentScope()) return;
            const versionSnapshot = getVersionSnapshot();
            if (!versionSnapshot || versionSnapshot.id !== targetVersionId) return;
            const redoSnapshot = getItemsSnapshot();
            const redoIdsToRemove = collectSubtreeItemIds(
              redoSnapshot,
              currentDeletedRootId
            );
            const redoOperation = beginItemsOperation((previous) =>
              previous.filter((item) => !redoIdsToRemove.has(item.id))
            );
            if (!isItemsOperationCurrent(redoOperation)) return false;
            try {
              const receipt = await deleteItemRecord(
                versionSnapshot.id,
                currentDeletedRootId
              );
              if (!isItemsOperationCurrent(redoOperation) || (context && !context.isCurrentScope())) return false;
              if (getVersionSnapshot()?.id !== targetVersionId) return;
              restorer.reset();
              if (!acceptDeletionReceipt(redoOperation, receipt)) return false;
              setTotalsOutOfSync(false);
            } catch (error) {
              if (!isItemsOperationCurrent(redoOperation) || (context && !context.isCurrentScope())) return false;
              rollbackItems(redoOperation);
              throw error;
            }
          },
        });
      } catch (error) {
        rollbackRemovedTempIds();
        if (!isItemsOperationCurrent(operation) || !isCurrentVersion(targetVersionId)) return;
        rollbackItems(operation);
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
      acceptDeletionReceipt,
      beginItemsOperation,
      isItemsOperationCurrent,
      rollbackItems,
      releaseItemsOperation,
      applySiblingOrder,
      document,
      deleteItemRecord,
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
        updated.line_nature = resolvePromotedEstimateLineNature(current, patch);
        updated = normalizePatchedItem(updated);
      }

      const operation = beginItemsOperation((previous) =>
        previous.map((item) => (item.id === itemId ? updated : item))
      );
      if (!isItemsOperationCurrent(operation)) return;
      if (!persist) { releaseItemsOperation(operation); return; }

      if (isTempEstimateItemId(itemId) || isPendingCreateEstimateItem(current)) {
        const queuedPayload = buildItemUpdatePayload(updated);
        const existingPayload =
          queuedPatchesByTempIdRef.current.get(itemId) ?? {};
        queuedPatchesByTempIdRef.current.set(itemId, {
          ...existingPayload,
          ...queuedPayload,
        });
        setTotalsOutOfSync(false);
        releaseItemsOperation(operation);
        return;
      }

      if (!version?.id) {
        reportError("Version introuvable.");
        rollbackItems(operation);
        return;
      }

      enqueueItemUpdate(itemId, buildItemUpdatePayload(updated));
      releaseItemsOperation(operation);
      setTotalsOutOfSync(false);
      // TI-534 : en v3, une ligne rétablie (annuler, rétablir) qui change de type FO en redérive la provision, et garde
      // sinon celle de la ligne en place, côté serveur comme ici.
      const restoreLine = (item: EditorEstimateItem) =>
        v3Writer && item.item_type === "line" ? normalizePatchedItem(item) : item;
      pushHistoryCommand({
        label: "patch-item",
        undo: async () => {
          const restoredItem = restoreLine(previousItem);
          setItems((previous) =>
            previous.map((item) =>
              item.id === itemId ? restoredItem : item
            )
          );
          enqueueItemUpdate(
            itemId,
            buildItemUpdatePayload(previousItem)
          );
          setTotalsOutOfSync(false);
        },
        redo: async () => {
          const redoneItem = restoreLine(updated);
          setItems((previous) =>
            previous.map((item) => (item.id === itemId ? redoneItem : item))
          );
          enqueueItemUpdate(itemId, buildItemUpdatePayload(updated));
          setTotalsOutOfSync(false);
        },
      });
    },
    [
      isItemsOperationCurrent,
      beginItemsOperation,
      releaseItemsOperation,
      rollbackItems,
      buildItemUpdatePayload,
      enqueueItemUpdate,
      getItemsSnapshot,
      isMutationBlocked,
      mutationBlockedMessage,
      normalizePatchedItem,
      pushHistoryCommand,
      reportError,
      setItems,
      setTotalsOutOfSync,
      v3Writer,
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
