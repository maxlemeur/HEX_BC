"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { duplicateEstimateVersion } from "@/lib/estimates/client";

type DuplicateEstimateButtonProps = {
  versionId: string;
  className?: string;
};

export function DuplicateEstimateButton({
  versionId,
  className,
}: DuplicateEstimateButtonProps) {
  const router = useRouter();
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!versionId || isDuplicating) return;
    setActionError(null);
    setIsDuplicating(true);

    try {
      const duplicatedVersionId = await duplicateEstimateVersion(versionId);

      router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      );
    } finally {
      setIsDuplicating(false);
    }
  }, [isDuplicating, router, versionId]);

  const buttonClassName = className
    ? `btn btn-ghost btn-sm ${className}`
    : "btn btn-ghost btn-sm";

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className={buttonClassName}
        type="button"
        onClick={() => void handleDuplicate()}
        disabled={isDuplicating}
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

      {actionError ? (
        <div className="alert alert-error px-3 py-2 text-xs">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
