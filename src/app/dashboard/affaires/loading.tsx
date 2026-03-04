export default function AffairesLoading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <div className="h-7 w-48 rounded bg-slate-200" />
          <div className="mt-2 h-4 w-72 rounded bg-slate-100" />
        </div>
        <div className="h-10 w-40 rounded-lg bg-slate-200" />
      </div>

      {/* Filter bar */}
      <div className="mt-6 flex flex-wrap gap-3">
        <div className="h-10 w-64 rounded-lg bg-slate-100" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-20 rounded-full bg-slate-100" />
          ))}
        </div>
      </div>

      {/* Result count */}
      <div className="mt-4 h-4 w-36 rounded bg-slate-100" />

      {/* Table rows */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-slate-50" />
        ))}
      </div>
    </div>
  );
}
