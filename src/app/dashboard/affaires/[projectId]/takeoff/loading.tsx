
export default function TakeoffLoading() {
  return (
    <div className="animate-pulse">
      {/* Breadcrumb skeleton */}
      <div className="mb-4 h-5 w-64 rounded bg-[var(--slate-200)]" />

      {/* Header skeleton */}
      <div className="mb-6">
        <div className="h-7 w-32 rounded bg-[var(--slate-200)]" />
        <div className="mt-2 h-4 w-96 rounded bg-[var(--slate-200)]" />
      </div>

      {/* Filters skeleton */}
      <div className="dashboard-card p-5 sm:p-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="mb-1 h-4 w-16 rounded bg-[var(--slate-200)]" />
              <div className="h-9 w-full rounded bg-[var(--slate-200)]" />
            </div>
          ))}
        </div>

        {/* Counter cards skeleton */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--slate-200)] bg-white p-3"
            >
              <div className="h-3 w-16 rounded bg-[var(--slate-200)]" />
              <div className="mt-2 h-6 w-10 rounded bg-[var(--slate-200)]" />
            </div>
          ))}
        </div>
      </div>

      {/* Table skeleton */}
      <div className="dashboard-card mt-4 p-6">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-4 rounded bg-[var(--slate-200)]"
              style={{ width: `${65 + (index % 3) * 10}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
