import { Skeleton } from "@/components/ui/skeleton";

import "./journey.css";

/** Loading state shaped like a journey page: its heading, the next step and the « Repères ». */
export function JourneyPageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="journey-page" aria-hidden="true">
        <div className="journey-page-heading">
          <div>
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="mt-3 h-8 w-40 max-w-full" />
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          </div>
        </div>
        <div className="journey-grid">
          <div className="journey-panel">
            <div className="journey-panel-heading">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="journey-panel-body">
              <Skeleton className="h-7 w-72 max-w-full" />
              <Skeleton className="mt-4 h-4 w-full" />
              <Skeleton className="mt-6 h-10 w-44 rounded-lg" />
            </div>
          </div>
          <div className="journey-facts">
            <Skeleton className="h-3 w-16" />
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="mt-6 h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
