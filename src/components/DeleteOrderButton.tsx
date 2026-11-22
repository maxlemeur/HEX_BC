"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2Icon } from "lucide-react";

import { useConfirm } from "@/components/feedback/confirm-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/feedback/toast-provider";

type DeleteOrderButtonProps = {
  orderId: string;
  orderReference: string;
};

export function DeleteOrderButton({
  orderId,
  orderReference,
}: DeleteOrderButtonProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = await confirm({
      title: "Supprimer le bon de commande ?",
      description: `Le bon « ${orderReference} » sera supprimé définitivement.`,
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeleting(true);

    const response = await fetch(`/api/purchase-orders/${orderId}`, {
      method: "DELETE",
    }).catch(() => null);

    if (response?.ok) {
      // Replace, without refresh: a refresh right after the push re-rendered the deleted order's page while the list
      // was loading (React warned of a use() left halfway in development), and the list reads its orders afresh.
      // Replace also keeps the deleted order out of the history: Back does not lead to a page that no longer exists.
      router.replace("/dashboard/orders");
      return;
    }

    let errorMessage = "Erreur lors de la suppression.";
    try {
      const data = (await response?.json()) as { error?: string } | undefined;
      errorMessage = data?.error ?? errorMessage;
    } catch {
      // ignore JSON parse errors
    }
    toast.error({ title: "Suppression impossible.", description: errorMessage });
    setDeleting(false);
  }

  return (
    <Button
      variant="danger"
      size="lg"
      loading={deleting}
      leftIcon={<Trash2Icon aria-hidden="true" />}
      onClick={() => void handleDelete()}
      type="button"
    >
      Supprimer
    </Button>
  );
}
