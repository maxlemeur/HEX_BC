import { ProductionRibbon, ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Fixed-size placeholder block (px), decorative. */
function Block({
  width,
  height,
  className,
}: {
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <Skeleton
      aria-hidden="true"
      className={className}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

const TABLE_COLUMN_WIDTHS = [32, 200, 60, 60, 50, 70, 70, 28] as const;

function TableRowSkeleton({ height }: { height: number }) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
      {TABLE_COLUMN_WIDTHS.map((width, column) => (
        <Block
          key={column}
          width={width}
          height={height}
          className={column === 1 ? "flex-1" : undefined}
        />
      ))}
    </div>
  );
}

export function EstimateEditorSkeleton() {
  return (
    <div className="animate-fade-in" role="status" aria-live="polite">
      <span className="sr-only">Chargement du chiffrage…</span>
      <ProductionRibbon ariaLabel="Ruban métier du chiffrage">
        <ProductionRibbonHeader
          breadcrumbs={[{ label: "Chiffrage" }]}
          title="Chargement du chiffrage"
          description="Préparation de l’espace de production"
          metrics={
            <div className="flex gap-2">
              <Block width={86} height={28} className="rounded-full" />
              <Block width={112} height={28} className="rounded-full" />
            </div>
          }
          actions={
            <div className="flex gap-2">
              <Block width={90} height={36} className="rounded-control" />
              <Block width={120} height={36} className="rounded-control" />
            </div>
          }
        />
        <div className="production-ribbon__tabs" aria-hidden="true">
          <Block width={94} height={28} className="my-1 rounded-full" />
          <Block width={82} height={28} className="my-1 rounded-full" />
          <Block width={138} height={28} className="my-1 rounded-full" />
        </div>
        <div className="production-ribbon__commands" aria-hidden="true">
          <Block width={130} height={36} className="rounded-control" />
          <Block width={280} height={36} className="rounded-control" />
          <Block width={100} height={36} className="rounded-control" />
        </div>
      </ProductionRibbon>

      {/* Table */}
      <Card className="mt-6 overflow-hidden" aria-hidden="true">
        <div className="flex items-center gap-3 border-b border-border bg-surface-subtle px-4 py-3">
          {TABLE_COLUMN_WIDTHS.map((width, column) => (
            <Block
              key={column}
              width={width}
              height={12}
              className={column === 1 ? "flex-1" : undefined}
            />
          ))}
        </div>

        {Array.from({ length: 12 }, (_, i) => (
          <TableRowSkeleton key={i} height={14} />
        ))}
      </Card>
    </div>
  );
}
