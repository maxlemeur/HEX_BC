import type { Dispatch, RefObject, SetStateAction } from "react";

import { isEstimateEditorOperationScopeCurrent } from "@/hooks/estimate-editor-operation-scope";
import type { useEstimateEditorDocument } from "@/hooks/useEstimateEditorDocument";
import type { EstimateEditorHistoryController } from "@/hooks/useEstimateEditorHistoryController";
import type { EstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import type { EstimateV3SettingsController } from "@/hooks/useEstimateV3Settings";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import { isEstimateApiError } from "@/lib/estimates/client-errors";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import type {
  EstimateEditorDocument,
  EstimateEditorDocumentScopeToken,
} from "@/lib/estimates/editor-document-state";
import type { EstimateVersionView } from "@/lib/estimates/editor-items";
import { isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";
import { resolveEstimateActionError } from "@/lib/estimates/editor-presentation";
import {
  buildEditorSettingsFromVersion,
  buildHistoricalSettingsPayload,
  type EstimateSettingsState,
  type SettingsSection,
} from "@/lib/estimates/editor-settings-state";
import { buildEditorItemSyncBaseline } from "@/lib/estimates/v3-editor";
import { saveEstimateVersion } from "@/lib/estimates/version-settings-client";
import type { Database } from "@/types/database";

type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];

/** Retry only a lock refusal; the caller retains ownership of settings and receipt publication. */
export async function persistEstimateSettingsWithLockRecovery<T>(input: {
  persist: () => Promise<T>;
  recoverLock: () => Promise<boolean>;
  isCurrent: () => boolean;
}): Promise<T> {
  if (!input.isCurrent()) throw new Error("Le document a changé. La sauvegarde des paramètres est annulée.");
  try {
    return await input.persist();
  } catch (error) {
    if (!input.isCurrent() || !isEstimateApiError(error) || error.code !== "LOCK_REQUIRED") throw error;
    const reacquired = await input.recoverLock();
    if (!input.isCurrent() || !reacquired) throw error;
    return input.persist();
  }
}

/**
 * Saves the editor's settings: v3 by the pure module's payload, v1/v2 by the historical one; the saved version and
 * settings become the document's confirmed state, and the undo history is cleared (every line was repriced).
 */
export async function saveEstimateEditorSettings({
  editorDocument,
  documentScope,
  settings,
  version,
  totals,
  isV3,
  v3Settings,
  resolvedVersionId,
  isReadOnly,
  readOnlyActionErrorMessage,
  isConflictLocked,
  conflictState,
  settingsSaveGenerationRef,
  activeRouteVersionIdRef,
  versionRef,
  settingsSaveGuardRef,
  setActiveSettingsSave,
  setActionError,
  ensureGroupedActionCanProceed,
  handleOpenSettingsDrawer,
  getVersionSnapshot,
  recoverDraftLock,
  handleVersionConflict,
  clearUndoRedoHistory,
  discardBulkSuggestUndo,
  deriveBufferedItem,
  markItemsSynced,
  clearConflictDraft,
}: {
  editorDocument: EstimateEditorDocument;
  documentScope: EstimateEditorDocumentScopeToken;
  settings: EstimateSettingsState | null;
  version: EstimateVersionView | null;
  totals: EstimateTotals | null;
  isV3: boolean;
  v3Settings: EstimateV3SettingsController | null;
  resolvedVersionId: string;
  isReadOnly: boolean;
  readOnlyActionErrorMessage: string;
  isConflictLocked: boolean;
  conflictState: EstimateEditorSyncController["state"]["conflict"];
  settingsSaveGenerationRef: RefObject<number>;
  activeRouteVersionIdRef: RefObject<string>;
  versionRef: ReturnType<typeof useEstimateEditorDocument>["versionRef"];
  settingsSaveGuardRef: RefObject<{ isBlocked: boolean; message: string }>;
  setActiveSettingsSave: Dispatch<SetStateAction<{ routeVersionId: string; operationId: number } | null>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
  ensureGroupedActionCanProceed: EstimateEditorSyncController["actions"]["ensureGroupedActionCanProceed"];
  handleOpenSettingsDrawer: (section?: SettingsSection) => void;
  getVersionSnapshot: () => EstimateVersionView | null;
  recoverDraftLock: EstimateEditorSyncController["actions"]["recoverDraftLock"];
  handleVersionConflict: EstimateEditorSyncController["actions"]["handleVersionConflict"];
  clearUndoRedoHistory: EstimateEditorHistoryController["actions"]["clear"];
  discardBulkSuggestUndo: () => void;
  deriveBufferedItem: Parameters<EstimateEditorDocument["acceptItems"]>[1];
  markItemsSynced: EstimateEditorSyncController["actions"]["markItemsSynced"];
  clearConflictDraft: EstimateEditorSyncController["actions"]["clearConflictDraft"];
}) {
  if (!editorDocument.isCurrent(documentScope)) return;
  if (!settings || !version || (!totals && !isV3)) return;
  if (version.id !== resolvedVersionId) return;
  if (isReadOnly) {
    setActionError(readOnlyActionErrorMessage);
    return;
  }
  if (isConflictLocked) {
    setActionError(
      conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE
    );
    return;
  }

  const targetRouteVersionId = resolvedVersionId;
  const targetVersionId = version.id;
  const settingsSnapshot = settings;
  const totalsSnapshot = totals;
  const operationId = settingsSaveGenerationRef.current + 1;
  settingsSaveGenerationRef.current = operationId;
  const settingsSaveScope = {
    routeVersionId: targetRouteVersionId,
    versionId: targetVersionId,
    generation: operationId,
  };
  setActiveSettingsSave({
    routeVersionId: targetRouteVersionId,
    operationId,
  });
  setActionError(null);

  const documentSaveScope = editorDocument.captureScope();
  const isCurrentSettingsSave = () =>
    editorDocument.isCurrent(documentSaveScope) && isEstimateEditorOperationScopeCurrent(settingsSaveScope, {
      routeVersionId: activeRouteVersionIdRef.current,
      versionId: versionRef.current?.id ?? null,
      generation: settingsSaveGenerationRef.current,
    });

  try {
    if (
      !(await ensureGroupedActionCanProceed(
        "sauvegarder les paramètres",
        { allowPendingSettings: true }
      ))
    ) {
      return;
    }
    if (!isCurrentSettingsSave()) return;

    const currentGuard = settingsSaveGuardRef.current;
    if (currentGuard.isBlocked) {
      setActionError(currentGuard.message);
      return;
    }

    // Revue de 2.6 (F26-27) : Ctrl+S, la fermeture du tiroir et la navigation posent aussi la question de propagation
    // de la TVA (tiroir rendu visible), et rien ne part avant la réponse ; Échap n'enregistre rien.
    if (isV3 && v3Settings && !(await v3Settings.askTaxPropagation(() => handleOpenSettingsDrawer("tax")))) return;
    if (!isCurrentSettingsSave()) return;
    const versionSnapshot = getVersionSnapshot();
    if (!versionSnapshot || versionSnapshot.id !== targetVersionId) return;
    // Lot 2, sous-lot 2.6 : charge v3 du module pur (D5, D6, D8), jamais de taux dérivé ni de total client.
    const v3Save = isV3 ? (v3Settings?.buildSavePayload() ?? null) : null;
    if (isV3 && !v3Save?.ok) {
      setActionError(v3Save?.ok === false ? v3Save.message : "Réglages du moteur de calcul 3 indisponibles.");
      return;
    }
    const settingsPayload = v3Save?.ok ? { payload: v3Save.payload as EstimateVersionUpdate, discountPatch: {} }
      : totalsSnapshot ? buildHistoricalSettingsPayload(settingsSnapshot, versionSnapshot, totalsSnapshot) : null;
    if (!settingsPayload) return;
    const { payload, discountPatch } = settingsPayload;

    const persistSettings = () =>
      saveEstimateVersion(
        targetVersionId,
        payload,
        versionSnapshot.updated_at,
        versionSnapshot.content_revision
      );

    let saved: Awaited<ReturnType<typeof saveEstimateVersion>>;
    try {
      saved = await persistEstimateSettingsWithLockRecovery({
        persist: persistSettings,
        recoverLock: recoverDraftLock,
        isCurrent: isCurrentSettingsSave,
      });
    } catch (error) {
      if (!isCurrentSettingsSave()) return;
      if (!handleVersionConflict(error, { persistDraft: true })) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible de sauvegarder le chiffrage."
          )
        );
      }
      return;
    }
    if (!isCurrentSettingsSave()) return;
    // The server repriced every line at these settings, on every engine, and a v3 « Oui » also
    // rewrote each line's VAT rate: an undo captured before would write back the lines of the
    // previous ones, with their totals on v1 and their VAT rate on v3.
    clearUndoRedoHistory();
    discardBulkSuggestUndo();

    const updatedVersion = saved.version;
    const mergedVersion = {
      ...versionSnapshot,
      ...payload,
      ...updatedVersion,
    } as EstimateVersionView;
    if (versionRef.current?.id === targetVersionId &&
        isOlderEstimateVersionToken(mergedVersion.updated_at, versionRef.current.updated_at)) {
      setActionError("Le devis a changé après l'enregistrement. Rechargez pour vérifier les paramètres.");
      return;
    }
    const nextSavedSettings = (isV3 || !totalsSnapshot
      ? buildEditorSettingsFromVersion(mergedVersion, { marginTiers: settingsSnapshot.margin_tiers ?? [], discountCents: 0 })
      : {
          ...settingsSnapshot,
          margin_multiplier: mergedVersion.margin_multiplier,
          margin_mode: settingsSnapshot.margin_mode ?? "fixed",
          discount_cents: mergedVersion.discount_amount_cents ?? totalsSnapshot.discountCents,
          discount_amount_cents: mergedVersion.discount_amount_cents ?? null,
          discount_bp: mergedVersion.discount_bp,
          ...discountPatch,
        }) as EstimateSettingsState;
    editorDocument.transaction(() => {
      editorDocument.setConfirmedVersion(mergedVersion, documentSaveScope);
      editorDocument.setConfirmedSettings(nextSavedSettings);
      editorDocument.setDraftSettings(nextSavedSettings);
      const currentItemsById = new Map(editorDocument.getSnapshot().confirmedItems.map((item) => [item.id, item]));
      editorDocument.acceptItems(saved.items.map((item) => ({ ...currentItemsById.get(item.id), ...item })), deriveBufferedItem, documentSaveScope);
    });
    // v3 : « Oui » réécrit le taux des lignes au serveur (D8) ; leur état relu devient la référence.
    if (isV3) markItemsSynced(saved.items.map((item) => ({ id: item.id, updates: buildEditorItemSyncBaseline(item) })));
    if (isCurrentSettingsSave()) {
      clearConflictDraft({ onlyIfRestored: true });
      return true;
    }
  } finally {
    if (isCurrentSettingsSave()) {
      setActiveSettingsSave((previous) =>
        previous?.operationId === operationId ? null : previous
      );
    }
  }
}
