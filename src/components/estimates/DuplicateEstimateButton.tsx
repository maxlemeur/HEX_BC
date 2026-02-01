"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DuplicateEstimateButtonProps = {
  versionId: string;
  className?: string;
};

export function DuplicateEstimateButton({
  versionId,
  className,
}: DuplicateEstimateButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!versionId || isDuplicating) return;
    setActionError(null);
    setIsDuplicating(true);

    try {
      const { data, error } = await supabase.rpc(
        "duplicate_estimate_version",
        { source_version_id: versionId }
      );

      if (error || !data) {
        throw new Error(error?.message ?? "Impossible de dupliquer le chiffrage.");
      }

      router.push(`/dashboard/estimates/${data}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      );
    } finally {
      setIsDuplicating(false);
    }
  }, [isDuplicating, router, supabase, versionId]);

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
