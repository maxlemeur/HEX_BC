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

  const requestDelete = useCallback(
    (projectId: string, projectName: string) => {
      setTarget({ projectId, projectName });
    },
    []
  );

  const cancelDelete = useCallback(() => {
    setTarget(null);
  }, []);

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
      setTarget(null);
      router.refresh();
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
          onConfirm: confirmDelete,
          onCancel: cancelDelete,
        }
      : { open: false, title: "", message: "", onConfirm: () => {}, onCancel: () => {} },
  };
}
