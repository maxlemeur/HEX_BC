"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { useToast } from "@/components/feedback/toast-provider";
import type {
  EstimateEditorTableProps,
  EstimateSectionDuplicateTarget,
} from "@/hooks/estimate-editor-view-props";
import { deferEffectStateUpdate } from "@/hooks/useEstimateEditorAutoSave";
import type { EstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import type { useEstimateEditorDocument } from "@/hooks/useEstimateEditorDocument";
import {
  acquireEstimateDraftLock,
  duplicateEstimateSection,
  fetchEstimateDraftVersions,
  releaseEstimateDraftLock,
} from "@/lib/estimates/client";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import {
  formatSectionDuplicateTargetLabel,
  resolveEstimateActionError,
} from "@/lib/estimates/editor-presentation";
import { describeV3ConvertedLines } from "@/lib/estimates/v3-converted-lines";

/** The draft versions of the affaire a section can be copied to, read again with the version. */
export function useEstimateEditorSectionDuplicateTargets(
  resolvedVersionId: string,
  reloadNonce: number
) {
  const [sectionDuplicateTargets, setSectionDuplicateTargets] = useState<
    EstimateSectionDuplicateTarget[]
  >([]);

  useEffect(() => {
    if (!resolvedVersionId) {
      return deferEffectStateUpdate(() => {
        setSectionDuplicateTargets([]);
      });
    }

    let active = true;

    async function loadSectionDuplicateTargets() {
      try {
        const targets = await fetchEstimateDraftVersions(resolvedVersionId);
        if (!active) return;

        setSectionDuplicateTargets(
          targets.map((target) => ({
            versionId: target.id,
            label: formatSectionDuplicateTargetLabel({
              versionNumber: target.versionNumber,
              title: target.title,
            }),
          }))
        );
      } catch {
        if (!active) return;
        setSectionDuplicateTargets([]);
      }
    }

    void loadSectionDuplicateTargets();

    return () => {
      active = false;
    };
  }, [reloadNonce, resolvedVersionId]);

  return sectionDuplicateTargets;
}

/** Copies a section to another draft version, under that version's lock, then opens that version. */
export function useEstimateEditorSectionCopyToVersion({
  isReadOnly,
  readOnlyActionErrorMessage,
  isConflictLocked,
  conflictState,
  versionRef,
  hasUnsavedSettings,
  ensureGroupedActionCanProceed,
  handleDuplicateSection,
  setActionError,
}: {
  isReadOnly: boolean;
  readOnlyActionErrorMessage: string;
  isConflictLocked: boolean;
  conflictState: EstimateEditorSyncController["state"]["conflict"];
  versionRef: ReturnType<typeof useEstimateEditorDocument>["versionRef"];
  hasUnsavedSettings: boolean;
  ensureGroupedActionCanProceed: EstimateEditorSyncController["actions"]["ensureGroupedActionCanProceed"];
  handleDuplicateSection: (sectionId: string) => Promise<void>;
  setActionError: Dispatch<SetStateAction<string | null>>;
}) {
  const router = useRouter();
  const toast = useToast();

  const handleDuplicateSectionToVersion = useCallback<
    NonNullable<EstimateEditorTableProps["onDuplicateSectionToVersion"]>
  >(
    async ({ sectionId, targetVersionId }) => {
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

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      if (targetVersionId === versionSnapshot.id) {
        await handleDuplicateSection(sectionId);
        return;
      }

      if (hasUnsavedSettings) {
        setActionError(
          "Enregistrez le paramétrage avant de dupliquer cette section vers une autre version."
        );
        return;
      }

      if (
        !(await ensureGroupedActionCanProceed(
          "dupliquer cette section vers une autre version"
        ))
      ) {
        return;
      }

      const synchronizedVersionSnapshot = versionRef.current;
      if (!synchronizedVersionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      setActionError(null);
      let targetLockAcquired = false;
      let redirected = false;

      try {
        const lockResult = await acquireEstimateDraftLock(targetVersionId);
        const isOwnedByCurrentUser =
          lockResult.lock?.isOwnedByCurrentUser !== false;

        if (!lockResult.acquired || !isOwnedByCurrentUser) {
          const holderName = lockResult.lock?.holderName?.trim() ?? "";
          const holder = holderName.length > 0 ? holderName : "un autre utilisateur";
          setActionError(`La version cible est verrouillée par ${holder}.`);
          return;
        }

        targetLockAcquired = true;
        const duplicated = await duplicateEstimateSection(synchronizedVersionSnapshot.id, sectionId, {
          targetVersionId,
        });
        // Sous-lot 2.8b (A6, P-12) : section v1/v2 copiée dans une v3, lignes dont les heures changent.
        const converted = describeV3ConvertedLines(duplicated.convertedLines);
        if (converted) {
          toast.warning({ title: "Section copiée au moteur de calcul 3", description: converted, durationMs: 15_000 });
        }

        redirected = true;
        router.push(`/dashboard/estimates/${targetVersionId}/edit`);
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible de dupliquer la section vers cette version."
          )
        );
      } finally {
        if (targetLockAcquired && !redirected) {
          try {
            await releaseEstimateDraftLock(targetVersionId);
          } catch {
            // Best-effort cleanup of a lock acquired for a failed cross-version duplication.
          }
        }
      }
    },
    [
      conflictState?.message,
      ensureGroupedActionCanProceed,
      handleDuplicateSection,
      versionRef,
      hasUnsavedSettings,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      router,
      setActionError,
      toast,
    ]
  );

  return handleDuplicateSectionToVersion;
}
