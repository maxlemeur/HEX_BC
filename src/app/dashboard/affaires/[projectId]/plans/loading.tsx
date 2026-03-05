export default function PlansLoading() {
  return (
    <div className="animate-pulse">
      {/* Breadcrumb skeleton */}
      <div className="mb-4 h-5 w-48 rounded bg-[var(--slate-200)]" />

      {/* Header skeleton */}
      <div className="mb-6">
        <div className="h-7 w-24 rounded bg-[var(--slate-200)]" />
        <div className="mt-2 h-4 w-80 rounded bg-[var(--slate-200)]" />
      </div>

      {/* Action bar skeleton */}
      <div className="mb-6 flex justify-end">
        <div className="h-9 w-44 rounded bg-[var(--slate-200)]" />
      </div>

      {/* Card skeletons */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="dashboard-card p-5">
            <div className="flex items-center gap-4">
              <div className="h-5 w-48 rounded bg-[var(--slate-200)]" />
              <div className="ml-auto h-4 w-24 rounded bg-[var(--slate-200)]" />
            </div>
            <div className="mt-3 h-4 w-32 rounded bg-[var(--slate-200)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
