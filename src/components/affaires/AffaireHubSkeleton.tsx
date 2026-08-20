import { Skeleton } from "@/components/ui-legacy/Skeleton";

export function AffaireHubSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Skeleton width={60} height={14} />
        <Skeleton width={8} height={14} />
        <Skeleton width={80} height={14} />
        <Skeleton width={8} height={14} />
        <Skeleton width={120} height={14} />
      </div>

      {/* Header: title + actions */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <Skeleton width={280} height={28} />
          <Skeleton width={180} height={16} className="mt-2" />
        </div>
        <div className="flex gap-2">
          <Skeleton width={100} height={36} className="rounded-lg" />
          <Skeleton width={100} height={36} className="rounded-lg" />
        </div>
      </div>

      {/* Financial summary card */}
      <div className="dashboard-card p-5 mb-6">
        <Skeleton width={140} height={16} className="mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Skeleton width={80} height={12} className="mb-2" />
              <Skeleton width={100} height={20} />
            </div>
          ))}
        </div>
      </div>

      {/* Version timeline card */}
      <div className="dashboard-card p-5 mb-6">
        <Skeleton width={120} height={16} className="mb-4" />
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton variant="circle" width={32} height={32} />
              <div className="flex-1">
                <Skeleton width={160} height={14} />
                <Skeleton width={100} height={12} className="mt-1" />
              </div>
              <Skeleton width={80} height={12} />
            </div>
          ))}
        </div>
      </div>

      {/* DPGF source + Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="dashboard-card p-5">
          <Skeleton width={120} height={16} className="mb-3" />
          <Skeleton variant="rect" height={48} />
        </div>
        <div className="dashboard-card p-5">
          <Skeleton width={120} height={16} className="mb-3" />
          <Skeleton variant="rect" height={48} />
        </div>
      </div>
    </div>
  );
}
