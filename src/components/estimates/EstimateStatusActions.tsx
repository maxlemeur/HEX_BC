"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";

type EstimateStatus = "draft" | "sent" | "accepted" | "archived";

type EstimateStatusActionsProps = {
  versionId: string;
  currentStatus: EstimateStatus;
  projectName?: string;
  clientEmail?: string;
};

const STATUS_TRANSITIONS: Record<
  EstimateStatus,
  { label: string; nextStatus: EstimateStatus }[]
> = {
  draft: [{ label: "Marquer envoyé", nextStatus: "sent" }],
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
  projectName,
  clientEmail,
}: EstimateStatusActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);

  const handleStatusChange = useCallback(
    async (nextStatus: EstimateStatus) => {
      setIsPending(true);
      try {
        const response = await fetch(`/api/estimates/${versionId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "If-Match": new Date().toISOString(),
          },
          body: JSON.stringify({
            status: nextStatus,
            updated_at: new Date().toISOString(),
            force: true,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          const message =
            data && typeof data === "object" && "error" in data
              ? (data as { error?: { message?: string } }).error?.message
              : "Impossible de mettre a jour le statut.";
          console.error("Status update failed:", message);
          return;
        }

        router.refresh();
      } catch (error) {
        console.error("Status update error:", error);
      } finally {
        setIsPending(false);
      }
    },
    [versionId, router]
  );

  const transitions = STATUS_TRANSITIONS[currentStatus];
  const showEmailButton = currentStatus === "draft" || currentStatus === "sent";

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
