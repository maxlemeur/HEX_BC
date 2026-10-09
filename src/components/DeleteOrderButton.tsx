"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2Icon } from "lucide-react";

type DeleteOrderButtonProps = {
  orderId: string;
  orderReference: string;
};

export function DeleteOrderButton({
  orderId,
  orderReference,
}: DeleteOrderButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    const response = await fetch(`/api/purchase-orders/${orderId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      router.push("/dashboard/orders");
      router.refresh();
    } else {
      let errorMessage = "Erreur lors de la suppression.";
      try {
        const data = (await response.json()) as { error?: string };
        errorMessage = data.error ?? errorMessage;
      } catch {
        // ignore JSON parse errors
      }
      setError(errorMessage);
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-danger-light px-4 py-2">
        <span className="text-sm font-medium text-danger">
          Supprimer {orderReference} ?
        </span>
        <button
          className="btn btn-sm h-8 rounded-lg bg-danger px-3 text-xs font-bold text-white hover:bg-danger"
          disabled={deleting}
          onClick={handleDelete}
          type="button"
        >
          {deleting ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
          ) : (
            "Oui"
          )}
        </button>
        <button
          className="btn btn-sm h-8 rounded-lg bg-surface px-3 text-xs font-medium text-foreground-secondary hover:bg-surface-subtle"
          disabled={deleting}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          type="button"
        >
          Non
        </button>
        {error && (
          <span className="text-xs text-danger">{error}</span>
        )}
      </div>
    );
  }

  return (
    <button
      className="btn btn-danger"
      onClick={() => setConfirming(true)}
      type="button"
    >
      <Trash2Icon aria-hidden="true" size={16} />
      Supprimer
    </button>
  );
}
