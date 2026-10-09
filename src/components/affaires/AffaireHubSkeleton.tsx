import { Skeleton } from "@/components/ui/skeleton";

export function AffaireHubSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement de l’affaire…</span>
      <div aria-hidden="true">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2">
          <Skeleton className="h-3.5 w-15" />
          <Skeleton className="h-3.5 w-2" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-2" />
          <Skeleton className="h-3.5 w-30 min-w-0" />
        </div>

        {/* Header: title + actions */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Skeleton className="h-7 w-70 max-w-full" />
            <Skeleton className="mt-2 h-4 w-45 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-25 rounded-lg" />
            <Skeleton className="h-9 w-25 rounded-lg" />
          </div>
        </div>

        {/* Financial summary card */}
        <div className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-card">
          <Skeleton className="mb-4 h-4 w-35" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="min-w-0">
                <Skeleton className="mb-2 h-3 w-20 max-w-full" />
                <Skeleton className="h-5 w-25 max-w-full" />
              </div>
            ))}
          </div>
        </div>

        {/* Version timeline card */}
        <div className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-card">
          <Skeleton className="mb-4 h-4 w-30" />
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-40 max-w-full" />
                  <Skeleton className="mt-1 h-3 w-25 max-w-full" />
                </div>
                <Skeleton className="h-3 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* DPGF source + Quick actions */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
            <Skeleton className="mb-3 h-4 w-30" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
          <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
            <Skeleton className="mb-3 h-4 w-30" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
