"use client";

import { useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui-legacy/Toast";
import { formatEUR } from "@/lib/money";
import { TrashIcon } from "lucide-react";

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
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isDeleting) {
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-danger-subtle text-danger">
            <TrashIcon aria-hidden="true" strokeWidth={1.75} />
          </AlertDialogMedia>
          <AlertDialogTitle>Supprimer ce tarif ?</AlertDialogTitle>
          <AlertDialogDescription>
            {target ? (
              <>
                Le prix de <strong className="text-foreground">{target._supplierName}</strong> pour{" "}
                <strong className="text-foreground">{target._productName}</strong> (
                {typeof target.unit_price_cents === "number" ? formatEUR(target.unit_price_cents) : "-"}) sera
                supprimé. Cette action est irréversible.
              </>
            ) : (
              "Cette action est irréversible."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
          <Button
            variant="danger-solid"
            size="lg"
            onClick={() => void confirmDelete()}
            loading={isDeleting}
          >
            Supprimer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
