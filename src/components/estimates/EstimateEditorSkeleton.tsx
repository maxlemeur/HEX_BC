import { Skeleton } from "@/components/ui/Skeleton";

function TableRowSkeleton({ index }: { index: number }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-[var(--slate-100)]"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <Skeleton width={32} height={14} />
      <Skeleton width={200} height={14} className="flex-1" />
      <Skeleton width={60} height={14} />
      <Skeleton width={60} height={14} />
      <Skeleton width={50} height={14} />
      <Skeleton width={70} height={14} />
      <Skeleton width={70} height={14} />
      <Skeleton width={28} height={14} />
    </div>
  );
}

export function EstimateEditorSkeleton() {
  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton width={220} height={28} />
          <Skeleton width={300} height={16} className="mt-2" />
        </div>

        {/* Toolbar buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton width={80} height={28} rounded />
          <Skeleton width={36} height={36} className="rounded-lg" />
          <Skeleton width={100} height={36} className="rounded-lg" />
          <Skeleton width={90} height={36} className="rounded-lg" />
          <Skeleton width={36} height={36} className="rounded-lg" />
          <Skeleton width={120} height={36} className="rounded-lg" />
        </div>
      </div>

      {/* Table */}
      <div className="dashboard-card mt-6 overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--slate-50)] border-b border-[var(--slate-200)]">
          <Skeleton width={32} height={12} />
          <Skeleton width={200} height={12} className="flex-1" />
          <Skeleton width={60} height={12} />
          <Skeleton width={60} height={12} />
          <Skeleton width={50} height={12} />
          <Skeleton width={70} height={12} />
          <Skeleton width={70} height={12} />
          <Skeleton width={28} height={12} />
        </div>

        {/* Table rows */}
        <div className="animate-pulse">
          {Array.from({ length: 12 }, (_, i) => (
            <TableRowSkeleton key={i} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
