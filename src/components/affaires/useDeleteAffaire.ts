"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

type DeleteTarget = {
  projectId: string;
  projectName: string;
};

export function useDeleteAffaire() {
  const router = useRouter();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestDelete = useCallback(
    (projectId: string, projectName: string) => {
      setErrorMessage(null);
      setTarget({ projectId, projectName });
    },
    []
  );

  const cancelDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    setErrorMessage(null);
    setTarget(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!target) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/affaires/${target.projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Echec de la suppression.");
      }
      setErrorMessage(null);
      setTarget(null);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Echec de la suppression."
      );
    } finally {
      setDeleting(false);
    }
  }, [target, router]);

  return {
    requestDelete,
    cancelDelete,
    confirmDelete,
    modalProps: target
      ? {
          open: true,
          title: "Supprimer l'affaire",
          message: `Etes-vous sur de vouloir supprimer l'affaire « ${target.projectName} » ? Cette action est irreversible.`,
          confirmLabel: deleting ? "Suppression..." : "Supprimer",
          variant: "danger" as const,
          confirmDisabled: deleting,
          cancelDisabled: deleting,
          errorMessage,
          onConfirm: confirmDelete,
          onCancel: cancelDelete,
        }
      : { open: false, title: "", message: "", onConfirm: () => {}, onCancel: () => {} },
  };
}
