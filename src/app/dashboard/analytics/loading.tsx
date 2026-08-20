import { Skeleton } from "@/components/ui-legacy/Skeleton";

function KpiCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="dashboard-card p-5 animate-pulse"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <Skeleton width={100} height={12} />
      <Skeleton width={80} height={28} className="mt-3" />
    </div>
  );
}

export default function AnalyticsLoading() {
  return (
    <div aria-live="polite" aria-busy="true">
      {/* Header */}
      <div className="page-header">
        <div>
          <Skeleton width={180} height={28} />
          <Skeleton width={280} height={16} className="mt-2" />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <KpiCardSkeleton key={i} index={i} />
        ))}
      </div>

      {/* Trend placeholder */}
      <div className="dashboard-card p-5 mt-6 animate-pulse">
        <Skeleton width={160} height={16} />
        <Skeleton variant="rect" height={160} className="mt-4 rounded-lg" />
      </div>

      {/* Top affaires placeholder */}
      <div className="dashboard-card p-5 mt-6 animate-pulse">
        <Skeleton width={200} height={16} />
        <Skeleton variant="rect" height={200} className="mt-4 rounded-lg" />
      </div>
    </div>
  );
}
