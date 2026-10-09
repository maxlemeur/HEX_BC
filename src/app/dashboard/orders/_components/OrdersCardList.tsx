import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { formatEUR } from "@/lib/money";

import {
  formatOrderDate,
  relatedName,
  statusClass,
  statusLabel,
  type PurchaseOrderListRow,
} from "./orders-model";

type OrdersCardListProps = {
  orders: PurchaseOrderListRow[];
  /** Row menu rendered next to the "Ouvrir" link. */
  renderActions: (order: PurchaseOrderListRow) => React.ReactNode;
  empty: React.ReactNode;
};

/** Mobile and tablet layout of the order list (the table takes over from `xl`). */
export function OrdersCardList({ orders, renderActions, empty }: OrdersCardListProps) {
  if (orders.length === 0) {
    return <div className="p-4 sm:p-6 xl:hidden">{empty}</div>;
  }

  return (
    <ul className="divide-y divide-border xl:hidden" aria-label="Bons de commande">
      {orders.map((order) => (
        <li key={order.id} className="p-4 sm:p-5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                Bon de commande
              </p>
              <Link
                href={`/dashboard/orders/${order.id}`}
                className="mt-1 block break-words text-base font-semibold text-primary hover:underline"
              >
                {order.reference}
              </Link>
            </div>
            <span className={`${statusClass(order.status)} shrink-0`}>{statusLabel(order.status)}</span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2 min-w-0">
              <dt className="text-xs text-muted-foreground">Fournisseur</dt>
              <dd className="mt-0.5 truncate font-medium text-foreground">{relatedName(order.suppliers)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Chantier</dt>
              <dd className="mt-0.5 truncate text-foreground-secondary">{relatedName(order.delivery_sites)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Création</dt>
              <dd className="mt-0.5 text-foreground-secondary">{formatOrderDate(order.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Livraison</dt>
              <dd className="mt-0.5 text-foreground-secondary">{formatOrderDate(order.expected_delivery_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Documents</dt>
              <dd className="mt-0.5 text-foreground-secondary">{order.devis_count} devis</dd>
            </div>
          </dl>

          <div className="mt-4 flex items-end justify-between gap-3 border-t border-border-subtle pt-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total HT</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-foreground">
                {formatEUR(order.total_ht_cents)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {renderActions(order)}
              <Link
                href={`/dashboard/orders/${order.id}`}
                className={buttonVariants({ variant: "outline", size: "md", className: "min-h-11" })}
                aria-label={`Ouvrir le bon ${order.reference}`}
              >
                Ouvrir
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
