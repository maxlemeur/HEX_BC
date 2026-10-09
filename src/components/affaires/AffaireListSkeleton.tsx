import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      {/* Title + version count */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-40 max-w-full" />
          <Skeleton className="mt-1 h-3 w-25 max-w-full" />
        </div>
        <Skeleton className="h-3 w-15" />
      </div>

      {/* Reference */}
      <Skeleton className="mb-2 h-3 w-30" />

      {/* Status badges */}
      <div className="mb-3 flex gap-1.5">
        <Skeleton className="h-5.5 w-18 rounded-full" />
        <Skeleton className="h-5.5 w-14 rounded-full" />
      </div>

      {/* Amount + date */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-18" />
      </div>
    </div>
  );
}

export function AffaireListSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement des affaires…</span>
      <div aria-hidden="true">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <Skeleton className="h-7 w-40 max-w-full" />
            <Skeleton className="mt-2 h-4 w-60 max-w-full" />
          </div>
          <Skeleton className="h-11 w-full rounded-lg sm:w-40" />
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-10 w-64 max-w-full rounded-lg" />
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-full" />
            ))}
          </div>
        </div>

        {/* Result count */}
        <Skeleton className="mt-4 h-4 w-36" />

        {/* Card grid */}
        <div className="mt-6 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
