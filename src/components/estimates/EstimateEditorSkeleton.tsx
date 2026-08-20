import { Skeleton } from "@/components/ui-legacy/Skeleton";
import { ProductionRibbon, ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";

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
    <div className="animate-fade-in" role="status" aria-live="polite">
      <span className="sr-only">Chargement du chiffrage...</span>
      <ProductionRibbon ariaLabel="Ruban métier du chiffrage">
        <ProductionRibbonHeader
          breadcrumbs={[{ label: "Chiffrage" }]}
          title="Chargement du chiffrage"
          description="Préparation de l'espace de production"
          metrics={
            <div className="flex gap-2">
              <Skeleton width={86} height={28} rounded />
              <Skeleton width={112} height={28} rounded />
            </div>
          }
          actions={
            <div className="flex gap-2">
              <Skeleton width={90} height={36} className="rounded-lg" />
              <Skeleton width={120} height={36} className="rounded-lg" />
            </div>
          }
        />
        <div className="production-ribbon__tabs" aria-hidden="true">
          <Skeleton width={94} height={28} className="my-1" rounded />
          <Skeleton width={82} height={28} className="my-1" rounded />
          <Skeleton width={138} height={28} className="my-1" rounded />
        </div>
        <div className="production-ribbon__commands" aria-hidden="true">
          <Skeleton width={130} height={36} rounded />
          <Skeleton width={280} height={36} rounded />
          <Skeleton width={100} height={36} rounded />
        </div>
      </ProductionRibbon>

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
