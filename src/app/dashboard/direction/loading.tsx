import { Skeleton } from "@/components/ui-legacy/Skeleton";

function SummaryCardSkeleton({ index }: { index: number }) {
  return (
    <article
      className="dashboard-card p-4 animate-pulse"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <Skeleton width={90} height={12} />
      <Skeleton width={56} height={28} className="mt-3" />
      <Skeleton width={110} height={12} className="mt-2" />
    </article>
  );
}

function PortfolioCardSkeleton({ index }: { index: number }) {
  return (
    <article
      className="dashboard-card p-5 animate-pulse"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton width={180} height={18} />
          <Skeleton width={220} height={14} />
        </div>
        <div className="flex gap-2">
          <Skeleton width={88} height={28} className="rounded-full" />
          <Skeleton width={108} height={28} className="rounded-full" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, metricIndex) => (
          <div
            key={metricIndex}
            className="rounded-2xl bg-[var(--slate-50)] px-3 py-3"
          >
            <Skeleton width={82} height={10} />
            <Skeleton width={72} height={18} className="mt-3" />
          </div>
        ))}
      </div>
    </article>
  );
}

export default function DirectionLoading() {
  return (
    <div aria-live="polite" aria-busy="true" className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div>
            <Skeleton width={220} height={30} />
            <Skeleton width={320} height={16} className="mt-2" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <SummaryCardSkeleton key={index} index={index} />
            ))}
          </div>
        </div>
      </header>

      <section className="dashboard-card p-4 animate-pulse">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton
              key={index}
              width="100%"
              height={40}
              className="rounded-xl"
            />
          ))}
        </div>
      </section>

      <section className="dashboard-card p-5 animate-pulse">
        <Skeleton width={180} height={18} />
        <Skeleton width={260} height={14} className="mt-2" />
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton
              key={index}
              width="100%"
              height={140}
              className="rounded-2xl"
            />
          ))}
        </div>
      </section>

      <section className="dashboard-card p-5 animate-pulse">
        <Skeleton width={180} height={18} />
        <Skeleton width={260} height={14} className="mt-2" />
        <Skeleton width="100%" height={240} className="mt-4 rounded-2xl" />
      </section>

      <section className="space-y-3">
        <div>
          <Skeleton width={220} height={18} />
          <Skeleton width={280} height={14} className="mt-2" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <PortfolioCardSkeleton key={index} index={index} />
          ))}
        </div>
      </section>
    </div>
  );
}
