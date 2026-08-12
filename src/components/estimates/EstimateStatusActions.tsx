"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";
import type { EstimateStatus } from "@/lib/estimates/status";

type EstimateStatusActionsProps = {
  versionId: string;
  currentStatus: EstimateStatus;
  /** updated_at réel de la version, utilisé comme jeton de concurrence (If-Match). */
  updatedAt: string;
  projectName?: string;
  clientEmail?: string;
};

const STATUS_TRANSITIONS: Record<
  EstimateStatus,
  { label: string; nextStatus: EstimateStatus }[]
> = {
  draft: [{ label: "Marquer envoyé", nextStatus: "sent" }],
  sending: [],
  sent: [
    { label: "Marquer accepté", nextStatus: "accepted" },
    { label: "Archiver", nextStatus: "archived" },
  ],
  accepted: [{ label: "Archiver", nextStatus: "archived" }],
  archived: [],
};

const SEND_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <path d="m21.854 2.147-10.94 10.939" />
  </svg>
);

export function EstimateStatusActions({
  versionId,
  currentStatus,
  updatedAt,
  projectName,
  clientEmail,
}: EstimateStatusActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = useCallback(
    async (nextStatus: EstimateStatus) => {
      setIsPending(true);
      setError(null);
      try {
        const response = await fetch(`/api/estimates/${versionId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            // Jeton de concurrence réel : ne jamais fabriquer un horodatage,
            // sous peine de conflit systématique ou de contournement.
            "If-Match": updatedAt,
          },
          // Pas de force: la transition draft -> sent passe par le gating
          // (anomalies bloquantes, PDF, scellement). Le forçage reste réservé
          // au flux d'envoi dédié réservé aux administrateurs.
          body: JSON.stringify({ status: nextStatus }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          const errorObject =
            data && typeof data === "object" && "error" in data
              ? (data as { error?: { message?: string; code?: string } }).error
              : null;
          const code = errorObject?.code;
          let message =
            errorObject?.message ?? "Impossible de mettre à jour le statut.";
          if (code === "ESTIMATE_GATING_BLOCKED") {
            message =
              "Envoi bloqué : des anomalies bloquantes doivent être corrigées avant de marquer le devis envoyé.";
          } else if (code === "VERSION_CONFLICT") {
            message =
              "Le devis a été modifié entre-temps. Rechargez la page avant de réessayer.";
          }
          setError(message);
          return;
        }

        router.refresh();
      } catch {
        setError("Impossible de mettre à jour le statut. Réessayez.");
      } finally {
        setIsPending(false);
      }
    },
    [versionId, updatedAt, router]
  );

  const transitions = STATUS_TRANSITIONS[currentStatus];
  const showEmailButton =
    currentStatus === "draft" ||
    currentStatus === "sending" ||
    currentStatus === "sent";

  if (transitions.length === 0 && !showEmailButton) return null;

  const defaultSubject = projectName
    ? `Devis - ${projectName}`
    : "Devis";

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {showEmailButton && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--brand-blue)] bg-[var(--brand-blue)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--brand-blue)]/90 disabled:opacity-50"
            disabled={isPending}
            onClick={() => setSendModalOpen(true)}
          >
            {SEND_ICON}
            {currentStatus === "draft"
              ? "Envoyer par email"
              : currentStatus === "sending"
                ? "Reprendre l’envoi"
                : "Renvoyer par email"}
          </button>
        )}
        {transitions.map((transition) => (
          <button
            key={transition.nextStatus}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--slate-200)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-50)] disabled:opacity-50"
            disabled={isPending}
            onClick={() => void handleStatusChange(transition.nextStatus)}
          >
            {isPending ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--slate-600)]" />
            ) : null}
            {transition.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-[var(--error)]" role="alert">
          {error}
        </p>
      )}
      <SendEstimateModal
        open={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        versionId={versionId}
        defaultSubject={defaultSubject}
        defaultRecipient={clientEmail}
        onSent={() => router.refresh()}
      />
    </>
  );
}
