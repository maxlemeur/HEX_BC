import { Skeleton } from "@/components/ui/skeleton";

export function ApprovalQueueSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">Chargement des approbations…</span>
      <div aria-hidden="true" className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-56 max-w-full" />
      </div>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5"
          >
            <div className="flex items-start justify-between">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-4 w-2/5" />
            <div className="flex gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
