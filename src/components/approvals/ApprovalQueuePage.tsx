"use client";

import { useCallback, useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { ApprovalQueueItem } from "@/lib/approvals/server";
import type {
  ApprovalQueueSortBy,
  ApprovalQueueSortDirection,
} from "@/lib/approvals/schemas";
import type {
  SortDirection,
  SortOption,
  SortState,
} from "@/components/TableFilterBar/types";
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
  initialSortDir: ApprovalQueueSortDirection;
  initialOnlyExceptions: boolean;
};

export function ApprovalQueuePage({
  initialData,
  initialSortBy,
  initialSortDir,
  initialOnlyExceptions,
}: ApprovalQueuePageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const rawSortBy = searchParams.get("sortBy");
  const sortBy = SORT_OPTIONS.some((option) => option.key === rawSortBy)
    ? (rawSortBy as ApprovalQueueSortBy)
    : initialSortBy;
  const rawSortDir = searchParams.get("sortDir");
  const sortDir = rawSortDir === "asc" || rawSortDir === "desc"
    ? rawSortDir
    : initialSortDir;
  const rawOnlyExceptions = searchParams.get("onlyExceptions");
  const onlyExceptions = rawOnlyExceptions === null
    ? initialOnlyExceptions
    : rawOnlyExceptions === "true";

  const sortState: SortState = useMemo(
    () => ({ key: sortBy, direction: sortDir }),
    [sortBy, sortDir]
  );

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

      const query = params.toString();
      const href = query
        ? `/dashboard/approvals?${query}`
        : "/dashboard/approvals";
      startTransition(() => {
        router.push(href);
      });
    },
    [router, searchParams]
  );

  const handleSortChange = useCallback(
    (key: string, direction?: SortDirection) => {
      const option = SORT_OPTIONS.find((candidate) => candidate.key === key);
      if (!option) return;

      updateParams({
        sortBy: option.key,
        sortDir: direction ?? option.defaultDirection ?? "asc",
      });
    },
    [updateParams]
  );

  const handleDirectionToggle = useCallback(() => {
    updateParams({
      sortDir: sortDir === "asc" ? "desc" : "asc",
    });
  }, [sortDir, updateParams]);

  const handleExceptionsToggle = useCallback(() => {
    const nextOnlyExceptions = !onlyExceptions;
    updateParams({
      onlyExceptions:
        nextOnlyExceptions === initialOnlyExceptions
          ? null
          : String(nextOnlyExceptions),
    });
  }, [initialOnlyExceptions, onlyExceptions, updateParams]);

  return (
    <div className="space-y-6" aria-busy={isPending}>
      {isPending ? (
        <p role="status" className="sr-only">
          Actualisation de la file d’approbation…
        </p>
      ) : null}

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
              name="onlyExceptions"
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
              onDirectionToggle={handleDirectionToggle}
            />
          </div>
        </div>
      </div>

      <ApprovalQueueCardList items={initialData} />
    </div>
  );
}
