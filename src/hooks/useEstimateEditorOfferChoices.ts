"use client";

import { useCallback, useMemo } from "react";

import type { useEstimateEditorDocument } from "@/hooks/useEstimateEditorDocument";
import type { useEstimateEditorItemsController } from "@/hooks/useEstimateEditorItemsController";
import type { EstimateEditorStatusController } from "@/hooks/useEstimateEditorStatusController";
import type { EstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import type { useUserContext } from "@/lib/auth/user-context";
import {
  readEstimateLineOfferChoiceSuggestion,
  setEstimateLineOfferChoice,
} from "@/lib/estimates/client";
import type {
  EstimateEditorDocument,
  EstimateEditorDocumentScopeToken,
} from "@/lib/estimates/editor-document-state";
import type { EditorEstimateItem } from "@/lib/estimates/editor-items";
import type { SettingsSection } from "@/lib/estimates/editor-settings-state";
import type { EstimateOfferChoiceInput } from "@/lib/estimates/offer-choice";
import {
  collectReserveItemIds,
  describeReserveLines,
  describeStatusReasonLines,
  listProvisionalQuantityMentions,
  listReservedLineTitles,
} from "@/lib/estimates/offer-choice-lines";
import type { EstimateStatusReason } from "@/lib/estimates/status-reason";

/**
 * TI-682, lot C: the offer's choices on the lines of a v3 — the written reserve and provisional quantity a tenant
 * administrator declares, the lines the precisions take, and the lines the send window names and lets one fix.
 */
export function useEstimateEditorOfferChoices({
  profile,
  isReadOnly,
  isConflictLocked,
  isViewerReadOnly,
  editorDocument,
  documentScope,
  versionRef,
  resolvedVersionId,
  isV3,
  items,
  sendGating,
  flushBufferedItemUpdates,
  handlePatchItem,
  recheckSend,
  closeSendGatingDialog,
  handleOpenSettingsDrawer,
}: {
  profile: ReturnType<typeof useUserContext>["profile"];
  isReadOnly: boolean;
  isConflictLocked: boolean;
  isViewerReadOnly: boolean;
  editorDocument: EstimateEditorDocument;
  documentScope: EstimateEditorDocumentScopeToken;
  versionRef: ReturnType<typeof useEstimateEditorDocument>["versionRef"];
  resolvedVersionId: string;
  isV3: boolean;
  items: EditorEstimateItem[];
  sendGating: EstimateEditorStatusController["state"]["sendGating"];
  flushBufferedItemUpdates: EstimateEditorSyncController["actions"]["flushBufferedItemUpdates"];
  handlePatchItem: ReturnType<typeof useEstimateEditorItemsController>["actions"]["patchItem"];
  recheckSend: EstimateEditorStatusController["actions"]["requestSend"];
  closeSendGatingDialog: EstimateEditorStatusController["actions"]["closeSendGatingDialog"];
  handleOpenSettingsDrawer: (section?: SettingsSection) => void;
}) {
  // TI-682, lot C, PR 4 : réserve écrite d'une ligne « Non chiffrée », par un administrateur du tenant. Les saisies en
  // attente partent d'abord (la ligne doit être enregistrée « Non chiffrée ») ; la route répond par le jeton de version
  // que la file d'écriture publie, et la ligne confirmée prend la réserve.
  const canDeclareOfferReserve = profile?.tenant_role === "admin" && !isReadOnly && !isConflictLocked && !isViewerReadOnly;
  const saveOfferChoice = useCallback(async (itemId: string, choice: EstimateOfferChoiceInput | null) => {
    const flushed = await flushBufferedItemUpdates();
    if (flushed === "error" || flushed === "blocked") {
      throw new Error("Les modifications en cours du devis doivent être enregistrées avant la réserve ou la quantité provisionnelle.");
    }
    const token = versionRef.current?.updated_at;
    if (!token || !editorDocument.isCurrent(documentScope)) throw new Error("Le devis a changé. Rechargez-le.");
    const receipt = await setEstimateLineOfferChoice(resolvedVersionId, itemId, choice, token);
    if (!editorDocument.isCurrent(documentScope)) return;
    editorDocument.acknowledgeItems([{ id: itemId, updates: { offer_choice: receipt.item.offer_choice } }]);
  }, [documentScope, editorDocument, flushBufferedItemUpdates, resolvedVersionId, versionRef]);

  // TI-682, lot C, PR 5 : « Établie sur » part de la note de la ligne de métré.
  const suggestEstablishedOn = useCallback((itemId: string) => readEstimateLineOfferChoiceSuggestion(resolvedVersionId, itemId),
    [resolvedVersionId]);

  const reservedLineTitles = useMemo(() => listReservedLineTitles(isV3 ? items : []), [isV3, items]);
  const provisionalQuantityMentions = useMemo(() => listProvisionalQuantityMentions(isV3 ? items : []), [isV3, items]);

  const statusReasonItemIds = sendGating?.blockingFlags.find((flag) => flag.key === "excluded_without_reason")?.itemIds;
  const statusReasonLines = useMemo(() => describeStatusReasonLines(items, statusReasonItemIds ?? []), [items, statusReasonItemIds]);
  const saveStatusReasonFromSendDialog = useCallback(async (itemId: string, reason: EstimateStatusReason) => {
    await handlePatchItem(itemId, { status_reason: reason }, { persist: true });
    const flushed = await flushBufferedItemUpdates();
    if (flushed === "error" || flushed === "blocked") return;
    await recheckSend();
  }, [flushBufferedItemUpdates, handlePatchItem, recheckSend]);

  const reserveItemIds = useMemo(() => collectReserveItemIds(sendGating), [sendGating]);
  const reserveLines = useMemo(() => describeReserveLines(items, reserveItemIds), [items, reserveItemIds]);
  const openLimitsFromSendDialog = useCallback(() => {
    closeSendGatingDialog();
    handleOpenSettingsDrawer("exclusions");
  }, [closeSendGatingDialog, handleOpenSettingsDrawer]);

  return {
    canDeclareOfferReserve,
    saveOfferChoice,
    suggestEstablishedOn,
    reservedLineTitles,
    provisionalQuantityMentions,
    statusReasonLines,
    saveStatusReasonFromSendDialog,
    reserveLines,
    openLimitsFromSendDialog,
  };
}
