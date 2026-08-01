"use client";

import { useCallback, useState } from "react";

import type { BulkDeleteAffairesResult } from "@/lib/affaires/delete-server";

type UseBulkDeleteAffairesOptions = {
  onCompleted: (result: BulkDeleteAffairesResult) => void;
};

export function useBulkDeleteAffaires({
  onCompleted,
}: UseBulkDeleteAffairesOptions) {
  const [targetIds, setTargetIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestDelete = useCallback((projectIds: string[]) => {
    const uniqueIds = [...new Set(projectIds)];
    if (uniqueIds.length === 0) return;
    setErrorMessage(null);
    setTargetIds(uniqueIds);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleting) return;
    setErrorMessage(null);
    setTargetIds(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!targetIds || deleting) return;

    setDeleting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/affaires/bulk-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectIds: targetIds }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error?.message ?? "Echec de la suppression groupee."
        );
      }

      const result = body.data as BulkDeleteAffairesResult;
      setTargetIds(null);
      onCompleted(result);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Echec de la suppression groupee."
      );
    } finally {
      setDeleting(false);
    }
  }, [deleting, onCompleted, targetIds]);

  const targetCount = targetIds?.length ?? 0;

  return {
    requestDelete,
    modalProps: targetIds
      ? {
          open: true,
          title: `Supprimer ${targetCount} affaire${targetCount > 1 ? "s" : ""}`,
          message: `Vous allez supprimer définitivement ${targetCount} affaire${targetCount > 1 ? "s" : ""} sélectionnée${targetCount > 1 ? "s" : ""}. Leurs versions, chiffrages, métrés et historiques directement rattachés seront aussi supprimés. Les documents associés ne seront plus accessibles depuis ces affaires. Seules les affaires dont toutes les versions sont en brouillon seront supprimées. Cette action est irréversible.`,
          confirmLabel: deleting
            ? "Suppression..."
            : `Supprimer ${targetCount} affaire${targetCount > 1 ? "s" : ""}`,
          variant: "danger" as const,
          confirmDisabled: deleting,
          cancelDisabled: deleting,
          errorMessage,
          onConfirm: confirmDelete,
          onCancel: cancelDelete,
        }
      : {
          open: false,
          title: "",
          message: "",
          onConfirm: () => {},
          onCancel: () => {},
        },
  };
}
