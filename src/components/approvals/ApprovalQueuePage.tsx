"use client";

import { useCallback, useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2Icon } from "lucide-react";

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
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

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

  const count = initialData.length;
  const countLabel = onlyExceptions
    ? `${count} affaire${count !== 1 ? "s" : ""} avec exception en attente de revue`
    : `${count} affaire${count !== 1 ? "s" : ""} en attente de revue`;

  return (
    <div>
      <PageHeader
        title="Approbations"
        description={
          // Seul le décompte est annoncé quand le tri ou le filtre change.
          <span role="status" aria-live="polite" aria-atomic="true">
            {countLabel}
          </span>
        }
        actions={
          <>
            {isPending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                Actualisation…
              </span>
            ) : null}
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground-secondary">
              <input
                type="checkbox"
                name="onlyExceptions"
                checked={onlyExceptions}
                onChange={handleExceptionsToggle}
                className="size-4 cursor-pointer rounded-sm border-border-strong accent-primary"
              />
              Exceptions seulement
            </label>
            <SortControl
              options={SORT_OPTIONS}
              value={sortState}
              onSortChange={handleSortChange}
              onDirectionToggle={handleDirectionToggle}
            />
          </>
        }
      />

      <div
        aria-busy={isPending}
        className={cn(
          "transition-opacity duration-150 motion-reduce:transition-none",
          isPending && "pointer-events-none opacity-60"
        )}
      >
        <ApprovalQueueCardList items={initialData} onlyExceptions={onlyExceptions} />
      </div>
    </div>
  );
}
