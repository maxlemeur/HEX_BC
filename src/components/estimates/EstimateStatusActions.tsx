"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

type EstimateStatus = "draft" | "sent" | "accepted" | "archived";

type EstimateStatusActionsProps = {
  versionId: string;
  currentStatus: EstimateStatus;
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

export function EstimateStatusActions({
  versionId,
  currentStatus,
}: EstimateStatusActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

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
  if (transitions.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
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
  );
}
