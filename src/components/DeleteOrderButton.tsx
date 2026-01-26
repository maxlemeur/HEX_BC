"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
      <div className="flex items-center gap-2 rounded-xl bg-[var(--error-light)] px-4 py-2">
        <span className="text-sm font-medium text-[var(--error)]">
          Supprimer {orderReference} ?
        </span>
        <button
          className="btn btn-sm h-8 rounded-lg bg-[var(--error)] px-3 text-xs font-bold text-white hover:bg-red-600"
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
          className="btn btn-sm h-8 rounded-lg bg-white px-3 text-xs font-medium text-[var(--slate-700)] hover:bg-[var(--slate-50)]"
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
          <span className="text-xs text-[var(--error)]">{error}</span>
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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
      Supprimer
    </button>
  );
}
