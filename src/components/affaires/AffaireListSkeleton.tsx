import { Skeleton } from "@/components/ui/Skeleton";

function CardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="dashboard-card p-4 animate-pulse"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Title + version count */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <Skeleton width={160} height={14} />
          <Skeleton width={100} height={12} className="mt-1" />
        </div>
        <Skeleton width={60} height={12} />
      </div>

      {/* Reference */}
      <Skeleton width={120} height={12} className="mb-2" />

      {/* Status badges */}
      <div className="flex gap-1.5 mb-3">
        <Skeleton width={72} height={22} rounded />
        <Skeleton width={56} height={22} rounded />
      </div>

      {/* Amount + date */}
      <div className="flex items-center justify-between">
        <Skeleton width={80} height={12} />
        <Skeleton width={72} height={12} />
      </div>
    </div>
  );
}

export function AffaireListSkeleton() {
  return (
    <div>
      {/* Header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <Skeleton width={160} height={28} />
          <Skeleton width={240} height={16} className="mt-2" />
        </div>
        <Skeleton variant="rect" width={160} height={40} className="rounded-lg" />
      </div>

      {/* Filter bar */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Skeleton width={256} height={40} className="rounded-lg" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={80} height={32} rounded />
          ))}
        </div>
      </div>

      {/* Result count */}
      <Skeleton width={144} height={16} className="mt-4" />

      {/* Card grid */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <CardSkeleton key={i} index={i} />
        ))}
      </div>
    </div>
  );
}
