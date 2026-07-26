"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  createEstimateVariant,
  duplicateEstimateVersion,
} from "@/lib/estimates/client";

type DuplicateEstimateButtonProps = {
  versionId: string;
  className?: string;
};

export function DuplicateEstimateButton({
  versionId,
  className,
}: DuplicateEstimateButtonProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"duplicate" | "variant" | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!versionId || pendingAction) return;
    setActionError(null);
    setPendingAction("duplicate");

    try {
      const duplicatedVersionId = await duplicateEstimateVersion(versionId);

      router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      );
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, router, versionId]);

  const handleCreateVariant = useCallback(async () => {
    if (!versionId || pendingAction) return;
    setActionError(null);
    setPendingAction("variant");

    try {
      const variantVersionId = await createEstimateVariant(versionId);

      router.push(`/dashboard/estimates/${variantVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      );
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, router, versionId]);

  const buttonClassName = className
    ? `btn btn-ghost btn-sm ${className}`
    : "btn btn-ghost btn-sm";
  const isDuplicating = pendingAction === "duplicate";
  const isCreatingVariant = pendingAction === "variant";
  const isBusy = pendingAction !== null;

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={buttonClassName}
          type="button"
          onClick={() => void handleDuplicate()}
          disabled={isBusy}
          aria-busy={isDuplicating}
        >
          {isDuplicating ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--slate-600)]"></span>
              Duplication...
            </>
          ) : (
            "Dupliquer"
          )}
        </button>
        <button
          className={buttonClassName}
          type="button"
          onClick={() => void handleCreateVariant()}
          disabled={isBusy}
          aria-busy={isCreatingVariant}
        >
          {isCreatingVariant ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--slate-600)]"></span>
              Creation variante...
            </>
          ) : (
            "Créer une variante"
          )}
        </button>
      </div>

      {actionError ? (
        <div className="alert alert-error px-3 py-2 text-xs">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
