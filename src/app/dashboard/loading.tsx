import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement de la vue d’ensemble</span>
      <header>
        <Skeleton width={120} height={12} />
        <Skeleton width={280} height={38} className="mt-2 max-w-full" />
        <Skeleton width={460} height={18} className="mt-3 max-w-full" />
      </header>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="dashboard-card p-4 sm:p-5">
            <Skeleton width={100} height={14} />
            <Skeleton width={64} height={32} className="mt-3" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
        <div className="dashboard-card p-5">
          <Skeleton width={160} height={18} />
          <Skeleton variant="rect" height={280} className="mt-5 rounded-lg" />
        </div>
        <div className="dashboard-card p-5">
          <Skeleton width={120} height={18} />
          <Skeleton variant="rect" height={220} className="mt-5 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
