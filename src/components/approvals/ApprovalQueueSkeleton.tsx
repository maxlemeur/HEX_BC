export function ApprovalQueueSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-5 w-40 animate-pulse rounded bg-[var(--slate-200)]" />
        <div className="h-9 w-36 animate-pulse rounded-lg bg-[var(--slate-200)]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="dashboard-card animate-pulse space-y-3 p-5"
          >
            <div className="flex items-start justify-between">
              <div className="h-5 w-3/5 rounded bg-[var(--slate-200)]" />
              <div className="h-5 w-10 rounded-full bg-[var(--slate-200)]" />
            </div>
            <div className="h-4 w-2/5 rounded bg-[var(--slate-100)]" />
            <div className="flex gap-3">
              <div className="h-4 w-20 rounded bg-[var(--slate-100)]" />
              <div className="h-4 w-16 rounded bg-[var(--slate-100)]" />
              <div className="h-4 w-24 rounded bg-[var(--slate-100)]" />
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-20 rounded-full bg-[var(--slate-100)]" />
              <div className="h-6 w-24 rounded-full bg-[var(--slate-100)]" />
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="h-3 w-24 rounded bg-[var(--slate-100)]" />
              <div className="h-6 w-16 rounded-full bg-[var(--slate-100)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
