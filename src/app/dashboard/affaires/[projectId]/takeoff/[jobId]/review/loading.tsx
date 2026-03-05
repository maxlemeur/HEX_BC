export default function Loading() {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="h-8 w-64 animate-pulse rounded bg-[var(--slate-200)]" />
      <div className="h-4 w-96 animate-pulse rounded bg-[var(--slate-200)]" />
      <div className="dashboard-card p-6">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-[var(--slate-200)]" style={{ width: `${60 + (i % 3) * 15}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
