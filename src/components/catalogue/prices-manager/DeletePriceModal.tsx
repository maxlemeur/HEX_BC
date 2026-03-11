"use client";

import { useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatEUR } from "@/lib/money";

type DeletePriceModalProps = {
  open: boolean;
  target: EnrichedPrice | null;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
};

export function DeletePriceModal({
  open,
  target,
  onClose,
  onDeleted,
}: Readonly<DeletePriceModalProps>) {
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  async function confirmDelete() {
    if (!target) return;
    setIsDeleting(true);

    try {
      await fetchApi<{ deleted_id: string }>("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: target.id }),
      });

      toast.success({ title: "Prix fournisseur supprimé." });
      onClose();
      await onDeleted();
    } catch (deleteError) {
      toast.error({
        title: "Erreur",
        description:
          deleteError instanceof Error
            ? deleteError.message
            : "Impossible de supprimer le prix fournisseur.",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Modal.Content className="max-w-md">
        <Modal.Header>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--danger)]/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--danger)"
                strokeWidth="1.75"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </div>
            <div>
              <Modal.Title>Confirmer la suppression</Modal.Title>
              <p className="text-sm text-[var(--slate-500)]">Cette action est irréversible.</p>
            </div>
          </div>
        </Modal.Header>

        {target ? (
          <Modal.Body>
            <p className="text-sm text-[var(--slate-700)]">
              Voulez-vous supprimer le prix de <strong>{target._supplierName}</strong> pour{" "}
              <strong>{target._productName}</strong> (
              {typeof target.unit_price_cents === "number" ? formatEUR(target.unit_price_cents) : "-"}) ?
            </p>
          </Modal.Body>
        ) : null}

        <Modal.Footer>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirmDelete()}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                Suppression...
              </>
            ) : (
              "Supprimer"
            )}
          </button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
