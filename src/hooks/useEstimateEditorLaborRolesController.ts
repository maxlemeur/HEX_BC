"use client";

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { useEstimateEditorDocument } from "@/hooks/useEstimateEditorDocument";
import type { useEstimateEditorLineNormalization } from "@/hooks/useEstimateEditorLineNormalization";
import type { EstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import type { useUserContext } from "@/lib/auth/user-context";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import type {
  EstimateEditorDocument,
  EstimateEditorDocumentScopeToken,
} from "@/lib/estimates/editor-document-state";
import {
  buildEstimateItemUpdatePayload,
  type EstimateVersionView,
  type LaborRole,
} from "@/lib/estimates/editor-items";
import type { EstimateSettingsState } from "@/lib/estimates/editor-settings-state";
import { createEstimateLaborRole, updateEstimateLaborRole } from "@/lib/estimates/reference-data-client";
import { recomputeEstimateV3AfterLaborRate } from "@/lib/estimates/v3-editor-writer";

type EditorDocumentPort = ReturnType<typeof useEstimateEditorDocument>;

/**
 * The labor roles of the version, created and edited from the settings drawer. A new hourly rate reprices
 * the lines of that role: v1/v2 in the editor (their writes queued), v3 by the v3 writer.
 */
export function useEstimateEditorLaborRolesController({
  editorDocument,
  documentScope,
  settingsSaveGuardRef,
  isReadOnly,
  readOnlyActionErrorMessage,
  isConflictLocked,
  conflictState,
  profile,
  laborRoles,
  setLaborRoles,
  version,
  getVersionSnapshot,
  itemsRef,
  setItems,
  isV3,
  settings,
  computeLineValuesWithLaborContext,
  enqueueBufferedItemUpdate,
  setActionError,
}: {
  editorDocument: EstimateEditorDocument;
  documentScope: EstimateEditorDocumentScopeToken;
  settingsSaveGuardRef: RefObject<{ isBlocked: boolean; message: string }>;
  isReadOnly: boolean;
  readOnlyActionErrorMessage: string;
  isConflictLocked: boolean;
  conflictState: EstimateEditorSyncController["state"]["conflict"];
  profile: ReturnType<typeof useUserContext>["profile"];
  laborRoles: LaborRole[];
  setLaborRoles: EditorDocumentPort["setLaborRoles"];
  version: EstimateVersionView | null;
  getVersionSnapshot: () => EstimateVersionView | null;
  itemsRef: EditorDocumentPort["itemsRef"];
  setItems: EditorDocumentPort["setItems"];
  isV3: boolean;
  settings: EstimateSettingsState | null;
  computeLineValuesWithLaborContext: ReturnType<
    typeof useEstimateEditorLineNormalization
  >["computeLineValuesWithLaborContext"];
  enqueueBufferedItemUpdate: EstimateEditorSyncController["actions"]["enqueueItemUpdate"];
  setActionError: Dispatch<SetStateAction<string | null>>;
}) {
  const handleCreateRole = useCallback(
    async (payload: { name: string; hourly_rate_cents: number }) => {
      if (!editorDocument.isCurrent(documentScope)) return;
      setActionError(null);
      if (settingsSaveGuardRef.current.isBlocked) {
        setActionError(settingsSaveGuardRef.current.message);
        return;
      }
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
      if (!profile?.id) {
        setActionError("Impossible de charger votre profil.");
        return;
      }

      const nextPosition =
        laborRoles.reduce((max, role) => Math.max(max, role.position), 0) + 1;

      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      let data: LaborRole;
      try {
        data = await createEstimateLaborRole(version.id, {
          name: payload.name,
          hourly_rate_cents: payload.hourly_rate_cents,
          is_active: true,
          position: nextPosition,
        });
      } catch (error) {
        if (!editorDocument.isCurrent(documentScope)) return;
        setActionError(
          error instanceof Error ? error.message : "Impossible de créer le rôle."
        );
        return;
      }

      if (!editorDocument.isCurrent(documentScope)) return;
      setLaborRoles((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
    },
    [
      conflictState?.message,
      editorDocument,
      documentScope,
      isConflictLocked,
      isReadOnly,
      laborRoles,
      setLaborRoles,
      profile,
      readOnlyActionErrorMessage,
      setActionError,
      settingsSaveGuardRef,
      version?.id,
    ]
  );

  const handleUpdateRole = useCallback(
    async (id: string, updates: Partial<LaborRole>) => {
      if (!editorDocument.isCurrent(documentScope)) return;
      setActionError(null);
      if (settingsSaveGuardRef.current.isBlocked) {
        setActionError(settingsSaveGuardRef.current.message);
        return;
      }
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
      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      try {
        await updateEstimateLaborRole(version.id, id, updates);
      } catch (error) {
        if (!editorDocument.isCurrent(documentScope)) return;
        setActionError(error instanceof Error ? error.message : "Impossible de mettre à jour le rôle.");
        return;
      }

      if (!editorDocument.isCurrent(documentScope)) return;
      setLaborRoles((prev) =>
        prev.map((role) => (role.id === id ? { ...role, ...updates } : role))
      );

      // v3 (revue, F26-23) : un lot v3 recalcule et stocke lignes et totaux au nouveau taux (l'aperçu le suit déjà).
      if (isV3 && updates.hourly_rate_cents !== undefined && !isReadOnly && !isConflictLocked) {
        const snapshot = getVersionSnapshot() ?? version;
        await recomputeEstimateV3AfterLaborRate(snapshot.id, snapshot.updated_at, itemsRef.current, id)?.catch((error: unknown) => {
          if (editorDocument.isCurrent(documentScope)) setActionError(`Le taux horaire est enregistré, mais les montants du devis n'ont pas été recalculés : ${error instanceof Error ? error.message : "erreur inconnue"}`);
        });
      }
      if (updates.hourly_rate_cents === undefined || !settings || isV3) return;

      const nextHourlyRate = updates.hourly_rate_cents ?? 0;
      if (!editorDocument.isCurrent(documentScope)) return;
      const snapshot = itemsRef.current;
      const affectedLines = snapshot.filter(
        (item) => item.item_type === "line" && item.labor_role_id === id
      );

      if (affectedLines.length === 0) return;

      const updatedLines = affectedLines.map((item) => {
        const taxRate = settings.tax_rate_bp ?? item.tax_rate_bp ?? 0;
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
          marginMultiplier: settings.margin_multiplier,
          taxRateBp: taxRate,
          rateOverrideByRoleId: id,
          hourlyRateCents: nextHourlyRate,
          vatReverseCharge: settings.contractor_role === "subcontractor",
        });
        return {
          ...item,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          k_mo: lineInput.k_mo,
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      setItems((prev) =>
        prev.map((item) => {
          if (item.item_type !== "line") return item;
          const updated = updatedLines.find((line) => line.id === item.id);
          return updated ?? item;
        })
      );

      if (isReadOnly || isConflictLocked) return;

      updatedLines.forEach((item) => {
        enqueueBufferedItemUpdate(item.id, buildEstimateItemUpdatePayload(item));
      });
    },
    [
      enqueueBufferedItemUpdate,
      itemsRef,
      setItems,
      setLaborRoles,
      conflictState?.message,
      editorDocument,
      documentScope,
      getVersionSnapshot,
      isConflictLocked,
      isReadOnly,
      isV3,
      readOnlyActionErrorMessage,
      setActionError,
      settings,
      settingsSaveGuardRef,
      version,
      computeLineValuesWithLaborContext,
    ]
  );

  return { createRole: handleCreateRole, updateRole: handleUpdateRole };
}
