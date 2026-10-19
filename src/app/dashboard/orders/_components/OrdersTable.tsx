import Link from "next/link";
import { Fragment } from "react";
import { ChevronRightIcon } from "lucide-react";

import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  formatOrderDate,
  relatedName,
  statusClass,
  statusLabel,
  type PurchaseOrderListRow,
} from "./orders-model";

const COLUMN_COUNT = 9;

type OrdersTableProps = {
  orders: PurchaseOrderListRow[];
  expandedOrderIds: ReadonlySet<string>;
  onToggleExpand: (orderId: string) => void;
  renderActions: (order: PurchaseOrderListRow) => React.ReactNode;
  renderExpanded: (order: PurchaseOrderListRow) => React.ReactNode;
  empty: React.ReactNode;
};

/** Desktop layout of the order list: expandable rows with lines and attached quotes. */
export function OrdersTable({
  orders,
  expandedOrderIds,
  onToggleExpand,
  renderActions,
  renderExpanded,
  empty,
}: OrdersTableProps) {
  return (
    <div
      className="table-scroll relative hidden overflow-x-auto xl:block"
      role="region"
      aria-label="Tableau des bons de commande"
      tabIndex={0}
    >
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="w-12">
              <span className="sr-only">Détails</span>
            </th>
            <th scope="col">Référence</th>
            <th scope="col">Création</th>
            <th scope="col">Fournisseur</th>
            <th scope="col">Chantier</th>
            <th scope="col">Livraison</th>
            <th scope="col">Statut</th>
            <th scope="col" className="text-right">Total HT</th>
            <th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td colSpan={COLUMN_COUNT} className="py-6">
                {empty}
              </td>
            </tr>
          ) : (
            orders.map((order) => {
              const isExpanded = expandedOrderIds.has(order.id);
              const detailsId = `order-details-${order.id}`;
              return (
                <Fragment key={order.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className={cn("expand-button", isExpanded && "expanded")}
                        onClick={() => onToggleExpand(order.id)}
                        aria-expanded={isExpanded}
                        aria-controls={isExpanded ? detailsId : undefined}
                        aria-label={`${isExpanded ? "Replier" : "Afficher"} le détail du bon ${order.reference}`}
                      >
                        <ChevronRightIcon aria-hidden="true" size={16} />
                      </button>
                    </td>
                    <td>
                      <Link
                        href={`/dashboard/orders/${order.id}`}
                        className="font-semibold text-primary hover:text-brand-blue-light hover:underline"
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td>{formatOrderDate(order.created_at)}</td>
                    <td className="font-medium text-foreground">{relatedName(order.suppliers)}</td>
                    <td>{relatedName(order.delivery_sites)}</td>
                    <td>{formatOrderDate(order.expected_delivery_date)}</td>
                    <td>
                      <span className={statusClass(order.status)}>{statusLabel(order.status)}</span>
                    </td>
                    <td className="text-right font-mono font-medium tabular-nums text-foreground">
                      {formatEUR(order.total_ht_cents)}
                    </td>
                    <td className="text-right">{renderActions(order)}</td>
                  </tr>

                  {isExpanded ? (
                    <tr className="expanded-content-row" id={detailsId}>
                      <td colSpan={COLUMN_COUNT}>
                        <div className="expanded-content animate-expand-down">{renderExpanded(order)}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
