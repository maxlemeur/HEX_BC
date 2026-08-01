"use client";

import { useCallback, useState } from "react";

import type { BulkArchiveAffairesResult } from "@/lib/affaires/delete-server";

type UseBulkArchiveAffairesOptions = {
  onCompleted: (result: BulkArchiveAffairesResult) => void;
};

export function useBulkArchiveAffaires({
  onCompleted,
}: UseBulkArchiveAffairesOptions) {
  const [targetIds, setTargetIds] = useState<string[] | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestArchive = useCallback((projectIds: string[]) => {
    const uniqueIds = [...new Set(projectIds)];
    if (uniqueIds.length === 0) return;
    setErrorMessage(null);
    setTargetIds(uniqueIds);
  }, []);

  const cancelArchive = useCallback(() => {
    if (archiving) return;
    setErrorMessage(null);
    setTargetIds(null);
  }, [archiving]);

  const confirmArchive = useCallback(async () => {
    if (!targetIds || archiving) return;

    setArchiving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/affaires/bulk-archive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectIds: targetIds }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.ok) {
        throw new Error(
          body?.error?.message ?? "Echec de l'archivage groupe.",
        );
      }

      const result = body.data as BulkArchiveAffairesResult;
      setTargetIds(null);
      onCompleted(result);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Echec de l'archivage groupe.",
      );
    } finally {
      setArchiving(false);
    }
  }, [archiving, onCompleted, targetIds]);

  const targetCount = targetIds?.length ?? 0;

  return {
    requestArchive,
    modalProps: targetIds
      ? {
          open: true,
          title: `Archiver ${targetCount} affaire${targetCount > 1 ? "s" : ""}`,
          message: `Vous allez archiver ${targetCount} affaire${targetCount > 1 ? "s" : ""} selectionnee${targetCount > 1 ? "s" : ""}. Elles disparaitront de la liste active, mais leur historique restera conserve.`,
          confirmLabel: archiving
            ? "Archivage..."
            : `Archiver ${targetCount} affaire${targetCount > 1 ? "s" : ""}`,
          variant: "default" as const,
          confirmDisabled: archiving,
          cancelDisabled: archiving,
          errorMessage,
          onConfirm: confirmArchive,
          onCancel: cancelArchive,
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