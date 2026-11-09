import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="mx-auto w-full max-w-[1440px]">
      <span className="sr-only">Chargement de la vue d’ensemble…</span>
      <div aria-hidden="true">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="px-4 py-4 sm:px-5"><Skeleton className="h-6 w-40" /></div>
            <div className="flex flex-wrap gap-4 px-4 pb-4 sm:px-5">
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-5 w-16" />)}
            </div>
            <div className="h-11 border-y border-border-subtle bg-surface-subtle" />
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-5 border-b border-border-subtle px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1"><Skeleton className="h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></div>
                <Skeleton className="hidden h-4 w-1/5 md:block" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="hidden h-3 w-20 md:block" />
              </div>
            ))}
          </div>
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Skeleton className="h-36" />
            <Skeleton className="h-80" />
          </div>
        </div>
      </div>
    </div>
  );
}
