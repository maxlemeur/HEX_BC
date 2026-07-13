"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { ApprovalQueueItem } from "@/lib/approvals/server";
import type { ApprovalQueueSortBy } from "@/lib/approvals/schemas";
import type { SortOption, SortState } from "@/components/TableFilterBar/types";
import { SortControl } from "@/components/TableFilterBar/SortControl";
import { ApprovalQueueCardList } from "./ApprovalQueueCardList";

const SORT_OPTIONS: SortOption[] = [
  { key: "priority", label: "Priorité", defaultDirection: "desc" },
  { key: "amount", label: "Montant", defaultDirection: "desc" },
  { key: "margin", label: "Marge", defaultDirection: "asc" },
  { key: "age", label: "Ancienneté", defaultDirection: "asc" },
];

type ApprovalQueuePageProps = {
  initialData: ApprovalQueueItem[];
  initialSortBy: ApprovalQueueSortBy;
  initialOnlyExceptions: boolean;
};

export function ApprovalQueuePage({
  initialData,
  initialSortBy,
  initialOnlyExceptions,
}: ApprovalQueuePageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = (searchParams.get("sortBy") as ApprovalQueueSortBy) || initialSortBy;
  const onlyExceptions = searchParams.get("onlyExceptions") === "true" || initialOnlyExceptions;

  const sortState: SortState = useMemo(() => {
    const option = SORT_OPTIONS.find((o) => o.key === sortBy);
    return { key: sortBy, direction: option?.defaultDirection ?? "desc" };
  }, [sortBy]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.push(`/dashboard/approvals?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleSortChange = useCallback(
    (key: string) => {
      updateParams({ sortBy: key });
    },
    [updateParams]
  );

  const handleExceptionsToggle = useCallback(() => {
    updateParams({
      onlyExceptions: onlyExceptions ? null : "true",
    });
  }, [updateParams, onlyExceptions]);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div role="status" aria-live="polite" aria-atomic="true">
          <h1 className="text-lg font-semibold text-[var(--slate-800)]">
            File d&apos;approbation
          </h1>
          <p className="text-sm text-[var(--slate-500)]">
            <strong>{initialData.length}</strong> affaire{initialData.length !== 1 ? "s" : ""} en attente de revue
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:flex sm:items-center">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--slate-600)]">
            <input
              type="checkbox"
              checked={onlyExceptions}
              onChange={handleExceptionsToggle}
              className="h-4 w-4 rounded border-[var(--slate-300)] text-[var(--brand-blue)] focus:ring-[var(--brand-blue)]"
            />
            Exceptions seulement
          </label>

          <div className="min-w-0">
            <SortControl
              options={SORT_OPTIONS}
              value={sortState}
              onSortChange={handleSortChange}
              onDirectionToggle={() => {}}
            />
          </div>
        </div>
      </div>

      {/* Card list */}
      <ApprovalQueueCardList items={initialData} />
    </div>
  );
}
