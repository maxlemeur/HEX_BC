"use client";

import { useCallback, useState } from "react";

import {
  createMarginTier as createMarginTierClient,
  deleteMarginTier as deleteMarginTierClient,
  updateMarginTier as updateMarginTierClient,
} from "@/lib/estimates/client";
import type {
  EstimateEditorDocument,
  EstimateEditorDocumentScopeToken,
} from "@/lib/estimates/editor-document-state";
import type { EstimateSettingsState } from "@/lib/estimates/editor-settings-state";

/** The tenant's margin tiers, edited from the settings drawer: the document's settings take the confirmed tiers. */
export function useEstimateEditorMarginTiersController({
  editorDocument,
  documentScope,
}: {
  editorDocument: EstimateEditorDocument;
  documentScope: EstimateEditorDocumentScopeToken;
}) {
  const [isSavingMarginTiers, setIsSavingMarginTiers] = useState(false);
  const [marginTiersError, setMarginTiersError] = useState<string | null>(null);
  const resetMarginTiers = useCallback(() => {
    setIsSavingMarginTiers(false);
    setMarginTiersError(null);
  }, []);

  const applyConfirmedMarginTiers = useCallback((update: (
    tiers: NonNullable<EstimateSettingsState["margin_tiers"]>
  ) => NonNullable<EstimateSettingsState["margin_tiers"]>) => {
    if (!editorDocument.isCurrent(documentScope)) return;
    editorDocument.transaction(() => {
      editorDocument.setConfirmedSettings((previous) => previous
        ? { ...previous, margin_tiers: update(previous.margin_tiers ?? []) } : previous);
      editorDocument.setDraftSettings((current) => current
        ? { ...current, margin_tiers: update(current.margin_tiers ?? []) } : current);
    });
  }, [editorDocument, documentScope]);

  const handleCreateTier = useCallback(
    async (payload: { threshold_cents: number; multiplier: number }) => {
      if (!editorDocument.isCurrent(documentScope)) return;
      setMarginTiersError(null);
      setIsSavingMarginTiers(true);
      try {
        const data = await createMarginTierClient(payload);
        applyConfirmedMarginTiers((tiers) => [...tiers, data].sort((left, right) => left.threshold_cents - right.threshold_cents));
      } catch (error) {
        if (!editorDocument.isCurrent(documentScope)) return;
        setMarginTiersError(
          error instanceof Error ? error.message : "Erreur création tranche."
        );
      } finally {
        if (editorDocument.isCurrent(documentScope)) setIsSavingMarginTiers(false);
      }
    },
    [applyConfirmedMarginTiers, editorDocument, documentScope]
  );

  const handleUpdateTier = useCallback(
    async (
      id: string,
      updates: { threshold_cents?: number; multiplier?: number }
    ) => {
      if (!editorDocument.isCurrent(documentScope)) return;
      setMarginTiersError(null);
      setIsSavingMarginTiers(true);
      try {
        const data = await updateMarginTierClient(id, updates);
        applyConfirmedMarginTiers((tiers) => tiers.map((tier) => tier.id === id ? data : tier)
          .sort((left, right) => left.threshold_cents - right.threshold_cents));
      } catch (error) {
        if (!editorDocument.isCurrent(documentScope)) return;
        setMarginTiersError(
          error instanceof Error
            ? error.message
            : "Erreur mise à jour tranche."
        );
      } finally {
        if (editorDocument.isCurrent(documentScope)) setIsSavingMarginTiers(false);
      }
    },
    [applyConfirmedMarginTiers, editorDocument, documentScope]
  );

  const handleDeleteTier = useCallback(async (id: string) => {
    if (!editorDocument.isCurrent(documentScope)) return;
    setMarginTiersError(null);
    setIsSavingMarginTiers(true);
    try {
      await deleteMarginTierClient(id);
      applyConfirmedMarginTiers((tiers) => tiers.filter((tier) => tier.id !== id));
    } catch (error) {
      if (!editorDocument.isCurrent(documentScope)) return;
      setMarginTiersError(
        error instanceof Error
          ? error.message
          : "Erreur suppression tranche."
      );
    } finally {
      if (editorDocument.isCurrent(documentScope)) setIsSavingMarginTiers(false);
    }
  }, [applyConfirmedMarginTiers, editorDocument, documentScope]);

  return {
    isSaving: isSavingMarginTiers,
    error: marginTiersError,
    reset: resetMarginTiers,
    createTier: handleCreateTier,
    updateTier: handleUpdateTier,
    deleteTier: handleDeleteTier,
  };
}
