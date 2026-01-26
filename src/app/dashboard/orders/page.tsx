"use client";

import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import { ExportDropdown } from "@/components/ExportDropdown";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { exportToCSV, exportToExcel, type ExportColumn } from "@/lib/export";
import { formatEUR } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type PurchaseOrderListRow = {
  id: string;
  reference: string;
  created_at: string;
  status: PurchaseOrderStatus;
  expected_delivery_date: string | null;
  total_ht_cents: number;
  suppliers: { name: string } | { name: string }[] | null;
  delivery_sites: { name: string } | { name: string }[] | null;
};

type OrderItemRow = {
  id: string;
  designation: string;
  reference: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  line_total_ht_cents: number;
};

type ItemsCache = Record<string, OrderItemRow[] | "loading" | "error">;

function statusLabel(status: PurchaseOrderStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyee";
    case "confirmed":
      return "Confirmee";
    case "received":
      return "Recue";
    case "canceled":
      return "Annulee";
    default:
      return status;
  }
}

function statusClass(status: PurchaseOrderStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "confirmed":
      return "status-badge status-confirmed";
    case "received":
      return "status-badge status-received";
    case "canceled":
      return "status-badge status-canceled";
    default:
      return "status-badge status-draft";
  }
}

function relatedName(value: PurchaseOrderListRow["suppliers"]) {
  if (!value) return "-";
  if (Array.isArray(value)) return value[0]?.name ?? "-";
  return value.name;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Status filter options
const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyee" },
  { value: "confirmed", label: "Confirmee" },
  { value: "received", label: "Recue" },
  { value: "canceled", label: "Annulee" },
];

// Sort options
const SORT_OPTIONS: SortOption[] = [
  { key: "created_at", label: "Creation", defaultDirection: "desc" },
  { key: "expected_delivery_date", label: "Livraison" },
  { key: "total_ht_cents", label: "Total HT" },
  { key: "reference", label: "Reference" },
];

// Export columns configuration
const EXPORT_COLUMNS: ExportColumn<PurchaseOrderListRow>[] = [
  { key: "reference", header: "Reference" },
  {
    key: "created_at",
    header: "Date de creation",
    formatter: (value) => formatDate(value as string),
  },
  {
    key: "suppliers",
    header: "Fournisseur",
    formatter: (value) =>
      relatedName(value as PurchaseOrderListRow["suppliers"]),
  },
  {
    key: "delivery_sites",
    header: "Chantier",
    formatter: (value) =>
      relatedName(value as PurchaseOrderListRow["delivery_sites"]),
  },
  {
    key: "expected_delivery_date",
    header: "Date de livraison prevue",
    formatter: (value) => formatDate(value as string | null),
  },
  {
    key: "status",
    header: "Statut",
    formatter: (value) => statusLabel(value as PurchaseOrderStatus),
  },
  {
    key: "total_ht_cents",
    header: "Total HT (EUR)",
    formatter: (value) => (value as number) / 100,
  },
];

export default function OrdersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Filtered data state
  const [displayedOrders, setDisplayedOrders] = useState<PurchaseOrderListRow[]>([]);

  // Accordion state - multiple rows can be expanded
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<ItemsCache>({});

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        "id, reference, created_at, status, expected_delivery_date, total_ht_cents, suppliers ( id, name ), delivery_sites ( id, name )"
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as unknown as PurchaseOrderListRow[];
  }, [supabase]);

  // Fetch suppliers for filter dropdown
  const fetchSuppliers = useCallback(async () => {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name")
      .order("name");
    return (data ?? []) as { id: string; name: string }[];
  }, [supabase]);

  // Fetch sites for filter dropdown
  const fetchSites = useCallback(async () => {
    const { data } = await supabase
      .from("delivery_sites")
      .select("id, name")
      .order("name");
    return (data ?? []) as { id: string; name: string }[];
  }, [supabase]);

  // Fetch order items on-demand for accordion
  const fetchOrderItems = useCallback(async (orderId: string) => {
    setItemsCache((prev) => ({ ...prev, [orderId]: "loading" }));

    try {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("id, designation, reference, quantity, unit_price_ht_cents, line_total_ht_cents")
        .eq("purchase_order_id", orderId)
        .order("position", { ascending: true });

      if (error) throw error;

      setItemsCache((prev) => ({
        ...prev,
        [orderId]: (data ?? []) as OrderItemRow[],
      }));
    } catch {
      setItemsCache((prev) => ({ ...prev, [orderId]: "error" }));
    }
  }, [supabase]);

  // Toggle accordion expansion
  const handleToggleExpand = useCallback((orderId: string) => {
    setExpandedOrderIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
        // Fetch items if not already cached
        if (!itemsCache[orderId]) {
          fetchOrderItems(orderId);
        }
      }
      return newSet;
    });
  }, [itemsCache, fetchOrderItems]);

  const {
    data: orders = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<PurchaseOrderListRow[]>("purchase-orders", fetchOrders, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const { data: suppliers = [] } = useSWR("suppliers-filter-options", fetchSuppliers);
  const { data: sites = [] } = useSWR("sites-filter-options", fetchSites);

  // Export handlers
  const handleExportExcel = useCallback(() => {
    const filename = `commandes_${new Date().toISOString().split("T")[0]}`;
    exportToExcel(displayedOrders, EXPORT_COLUMNS, {
      filename,
      sheetName: "Commandes",
    });
  }, [displayedOrders]);

  const handleExportCSV = useCallback(() => {
    const filename = `commandes_${new Date().toISOString().split("T")[0]}`;
    exportToCSV(displayedOrders, EXPORT_COLUMNS, { filename });
  }, [displayedOrders]);

  // Build filter configuration with dynamic options
  const filterConfig: FilterConfig[] = useMemo(() => [
    {
      type: "multi-select",
      key: "status",
      label: "Statut",
      placeholder: "Tous les statuts",
      options: STATUS_OPTIONS,
    },
    {
      type: "select",
      key: "suppliers.id",
      label: "Fournisseur",
      placeholder: "Tous les fournisseurs",
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      type: "select",
      key: "delivery_sites.id",
      label: "Chantier",
      placeholder: "Tous les chantiers",
      options: sites.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      type: "date-range",
      key: "created_at",
      label: "Date",
      placeholderFrom: "Du",
      placeholderTo: "Au",
    },
  ], [suppliers, sites]);

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Bons de commande</h1>
          <p className="page-description">
            Gerez vos achats fournisseurs et suivez l&apos;etat des commandes.
          </p>
        </div>
        <Link href="/dashboard/orders/new" className="btn btn-accent btn-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Nouveau bon
        </Link>
      </div>

      {/* Error alert */}
      {loadError ? (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {loadError.message}
        </div>
      ) : null}

      {/* Filter Bar */}
      <TableFilterBar
        data={orders}
        onDataChange={setDisplayedOrders}
        search={{
          placeholder: "Rechercher par reference...",
          fields: ["reference"],
        }}
        filters={filterConfig}
        sortOptions={SORT_OPTIONS}
        resultCountLabel="commandes"
        showResultCount
      />

      {/* Table card */}
      <div className="dashboard-card overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Tous les bons
            </h2>
            <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]">
              {orders.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown
              onExportExcel={handleExportExcel}
              onExportCSV={handleExportCSV}
              disabled={displayedOrders.length === 0}
            />
            <button
              className="btn btn-secondary btn-sm"
              disabled={isValidating}
              onClick={() => void mutate()}
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isValidating ? "animate-spin" : ""}
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {isValidating ? "Chargement..." : "Actualiser"}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>Reference</th>
                <th>Creation</th>
                <th>Fournisseur</th>
                <th>Chantier</th>
                <th>Livraison</th>
                <th>Statut</th>
                <th className="text-right">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {displayedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                        <span className="text-[var(--slate-500)]">Chargement des commandes...</span>
                      </div>
                    ) : orders.length === 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun bon de commande</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Commencez par creer votre premier bon de commande.</p>
                        </div>
                        <Link href="/dashboard/orders/new" className="btn btn-primary btn-sm mt-2">
                          Creer un bon
                        </Link>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun resultat</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Modifiez vos filtres pour voir plus de resultats.</p>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                displayedOrders.map((order, index) => {
                  const isExpanded = expandedOrderIds.has(order.id);
                  const items = itemsCache[order.id];

                  return (
                    <Fragment key={order.id}>
                      <tr
                        className="animate-fade-in"
                        style={{ animationDelay: `${index * 0.03}s` }}
                      >
                        <td>
                          <button
                            type="button"
                            className={`expand-button ${isExpanded ? "expanded" : ""}`}
                            onClick={() => handleToggleExpand(order.id)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "Replier" : "Developper"}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </button>
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/orders/${order.id}`}
                            className="font-semibold text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] hover:underline"
                          >
                            {order.reference}
                          </Link>
                        </td>
                        <td>{formatDate(order.created_at)}</td>
                        <td className="font-medium text-[var(--slate-800)]">
                          {relatedName(order.suppliers)}
                        </td>
                        <td>{relatedName(order.delivery_sites)}</td>
                        <td>{formatDate(order.expected_delivery_date)}</td>
                        <td>
                          <span className={statusClass(order.status)}>
                            {statusLabel(order.status)}
                          </span>
                        </td>
                        <td className="text-right font-mono font-medium text-[var(--slate-800)]">
                          {formatEUR(order.total_ht_cents)}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="expanded-content-row">
                          <td colSpan={8}>
                            <div className="expanded-content animate-expand-down">
                              {items === "loading" ? (
                                <div className="flex items-center gap-2 py-4 text-sm text-[var(--slate-500)]">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                                  Chargement des articles...
                                </div>
                              ) : items === "error" ? (
                                <div className="py-4 text-sm text-[var(--error)]">
                                  Erreur lors du chargement des articles.
                                </div>
                              ) : items && items.length > 0 ? (
                                <table className="expanded-content-table">
                                  <thead>
                                    <tr>
                                      <th>Designation</th>
                                      <th className="w-20 text-center">Qte</th>
                                      <th className="w-28 text-right">P.U. HT</th>
                                      <th className="w-28 text-right">Total HT</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((item) => (
                                      <tr key={item.id}>
                                        <td>{item.designation?.trim() || item.reference?.trim() || "-"}</td>
                                        <td className="text-center font-medium">
                                          {item.quantity}
                                        </td>
                                        <td className="text-right font-mono">
                                          {formatEUR(item.unit_price_ht_cents)}
                                        </td>
                                        <td className="text-right font-mono font-medium">
                                          {formatEUR(item.line_total_ht_cents)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <div className="py-4 text-sm text-[var(--slate-500)]">
                                  Aucun article dans cette commande.
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
