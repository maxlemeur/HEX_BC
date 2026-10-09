"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { fetchApi } from "@/components/catalogue/api";
import { DevisPreviewModal, isPreviewableType } from "@/components/DevisPreviewModal";
import { DevisUploader } from "@/components/DevisUploader";
import { ExportDropdown } from "@/components/ExportDropdown";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { ConfirmModal } from "@/components/ui-legacy/ConfirmModal";
import { EmptyState } from "@/components/ui-legacy/EmptyState";
import type { ExportColumn } from "@/lib/export";
import { formatEUR } from "@/lib/money";
import { ChevronRightIcon, CircleXIcon, DownloadIcon, EllipsisVerticalIcon, ExternalLinkIcon, EyeIcon, FileTextIcon, PlusIcon, RotateCwIcon, SearchIcon, ShoppingBagIcon, ShoppingCartIcon, TrashIcon } from "lucide-react";

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
  suppliers: { id: string; name: string } | { id: string; name: string }[] | null;
  delivery_sites: { id: string; name: string } | { id: string; name: string }[] | null;
  devis_count: number;
  has_devis: "with" | "without";
};

type OrderItemRow = {
  id: string;
  designation: string;
  reference: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  line_total_ht_cents: number;
};

type DevisItemRow = {
  id: string;
  name: string;
  originalFilename: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  position: number;
  downloadUrl: string | null;
};

type DevisCache = Record<string, DevisItemRow[] | "loading" | "error">;

type ItemExportRow = {
  order_reference: string;
  order_created_at: string;
  supplier: string;
  delivery_site: string;
  expected_delivery_date: string | null;
  status: PurchaseOrderStatus;
  order_total_ht_cents: number;
  item_designation: string;
  item_reference: string | null;
  item_quantity: number | "";
  item_unit_price_ht_cents: number | "";
  item_line_total_ht_cents: number | "";
};

type ItemsCache = Record<string, OrderItemRow[] | "loading" | "error">;

type OrdersPageResponse = {
  items: PurchaseOrderListRow[];
  suppliers: { id: string; name: string }[];
  delivery_sites: { id: string; name: string }[];
};

const EMPTY_ORDER_LOOKUPS: { id: string; name: string }[] = [];

function statusLabel(status: PurchaseOrderStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyée";
    case "confirmed":
      return "Confirmée";
    case "received":
      return "Reçue";
    case "canceled":
      return "Annulée";
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
  if (dateStr === "TBD") return "À déterminer";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

// Status filter options
const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "confirmed", label: "Confirmée" },
  { value: "received", label: "Reçue" },
  { value: "canceled", label: "Annulée" },
];

// Devis filter options
const DEVIS_OPTIONS = [
  { value: "with", label: "Avec devis" },
  { value: "without", label: "Sans devis" },
];

// Sort options
const SORT_OPTIONS: SortOption[] = [
  { key: "created_at", label: "Création", defaultDirection: "desc" },
  { key: "expected_delivery_date", label: "Livraison" },
  { key: "total_ht_cents", label: "Total HT" },
  { key: "reference", label: "Référence" },
];

// Export columns configuration
const EXPORT_COLUMNS: ExportColumn<PurchaseOrderListRow>[] = [
  { key: "reference", header: "Référence" },
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
    header: "Date de livraison prévue",
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

const ITEM_EXPORT_COLUMNS: ExportColumn<ItemExportRow>[] = [
  { key: "order_reference", header: "Référence commande" },
  {
    key: "order_created_at",
    header: "Date commande",
    formatter: (value) => formatDate(value as string),
  },
  { key: "supplier", header: "Fournisseur" },
  { key: "delivery_site", header: "Chantier" },
  {
    key: "expected_delivery_date",
    header: "Livraison prévue",
    formatter: (value) => formatDate(value as string | null),
  },
  {
    key: "status",
    header: "Statut",
    formatter: (value) => statusLabel(value as PurchaseOrderStatus),
  },
  {
    key: "order_total_ht_cents",
    header: "Total HT commande (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  { key: "item_designation", header: "Designation article" },
  { key: "item_reference", header: "Référence article" },
  { key: "item_quantity", header: "Quantité" },
  {
    key: "item_unit_price_ht_cents",
    header: "P.U. HT (EUR)",
    formatter: (value) =>
      typeof value === "number" ? value / 100 : "",
  },
  {
    key: "item_line_total_ht_cents",
    header: "Total ligne HT (EUR)",
    formatter: (value) =>
      typeof value === "number" ? value / 100 : "",
  },
];

function buildItemsExportRows(
  orders: PurchaseOrderListRow[],
  itemsByOrderId: Record<string, OrderItemRow[]>
): ItemExportRow[] {
  return orders.flatMap((order): ItemExportRow[] => {
    const baseRow = {
      order_reference: order.reference,
      order_created_at: order.created_at,
      supplier: relatedName(order.suppliers),
      delivery_site: relatedName(order.delivery_sites),
      expected_delivery_date: order.expected_delivery_date,
      status: order.status,
      order_total_ht_cents: order.total_ht_cents,
    };

    const items = itemsByOrderId[order.id] ?? [];
    if (items.length === 0) {
      return [
        {
          ...baseRow,
          item_designation: "",
          item_reference: "",
          item_quantity: "" as const,
          item_unit_price_ht_cents: "" as const,
          item_line_total_ht_cents: "" as const,
        },
      ];
    }

    return items.map((item) => ({
      ...baseRow,
      item_designation: item.designation,
      item_reference: item.reference ?? "",
      item_quantity: item.quantity,
      item_unit_price_ht_cents: item.unit_price_ht_cents,
      item_line_total_ht_cents: item.line_total_ht_cents,
    }));
  });
}

export default function OrdersPage() {
  // Filtered data state
  const [displayedOrders, setDisplayedOrders] = useState<PurchaseOrderListRow[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Accordion state - multiple rows can be expanded
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<ItemsCache>({});
  const [devisCache, setDevisCache] = useState<DevisCache>({});
  const [previewDevis, setPreviewDevis] = useState<DevisItemRow | null>(null);
  const [showUploaderForOrder, setShowUploaderForOrder] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [downloadingOrderId, setDownloadingOrderId] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState<{ id: string; reference: string } | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"down" | "up">("down");
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const fetchOrderItems = useCallback(async (orderId: string) => {
    setItemsCache((prev) => ({ ...prev, [orderId]: "loading" }));

    try {
      const data = await fetchApi<{ items: OrderItemRow[] }>(
        `/api/orders?view=items&order_id=${encodeURIComponent(orderId)}`
      );
      setItemsCache((prev) => ({ ...prev, [orderId]: data.items }));
    } catch {
      setItemsCache((prev) => ({ ...prev, [orderId]: "error" }));
    }
  }, []);

  // Fetch order devis on-demand for accordion
  const fetchOrderDevis = useCallback(async (orderId: string, force = false) => {
    // Skip if already cached and not forcing refresh
    if (!force && devisCache[orderId] && devisCache[orderId] !== "error") {
      return;
    }

    setDevisCache((prev) => ({ ...prev, [orderId]: "loading" }));

    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/devis`);
      if (!response.ok) throw new Error("Failed to fetch devis");
      const data = await response.json();
      setDevisCache((prev) => ({
        ...prev,
        [orderId]: (data.items ?? []) as DevisItemRow[],
      }));
    } catch {
      setDevisCache((prev) => ({ ...prev, [orderId]: "error" }));
    }
  }, [devisCache]);

  const fetchOrderItemsForExport = useCallback(async (orderIds: string[]) => {
    if (orderIds.length === 0) {
      return {};
    }

    const query = new URLSearchParams({ view: "items" });
    orderIds.forEach((orderId) => query.append("order_id", orderId));
    const data = await fetchApi<{ itemsByOrderId: Record<string, OrderItemRow[]> }>(
      `/api/orders?${query.toString()}`
    );
    return data.itemsByOrderId ?? {};
  }, []);

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
        // Fetch devis if not already cached
        if (!devisCache[orderId]) {
          fetchOrderDevis(orderId);
        }
      }
      return newSet;
    });
  }, [itemsCache, devisCache, fetchOrderItems, fetchOrderDevis]);

  const {
    data,
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<OrdersPageResponse>("/api/orders", fetchApi, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });
  const orders = data?.items ?? [];
  const suppliers = data?.suppliers ?? EMPTY_ORDER_LOOKUPS;
  const sites = data?.delivery_sites ?? EMPTY_ORDER_LOOKUPS;

  // Export handlers
  const handleExportExcel = useCallback(async () => {
    if (displayedOrders.length === 0 || isExporting) {
      return;
    }

    setIsExporting(true);
    const filename = `commandes_${new Date().toISOString().split("T")[0]}`;

    try {
      const orderIds = displayedOrders.map((order) => order.id);
      const itemsByOrderId = await fetchOrderItemsForExport(orderIds);
      const itemsRows = buildItemsExportRows(displayedOrders, itemsByOrderId);

      const { exportToExcelWithSheets } = await import("@/lib/export");
      await exportToExcelWithSheets([
        {
          name: "Commandes",
          data: displayedOrders,
          columns: EXPORT_COLUMNS,
        },
        {
          name: "Articles",
          data: itemsRows,
          columns: ITEM_EXPORT_COLUMNS,
        },
      ], { filename });
    } catch (error) {
      console.error("Erreur lors de l'export Excel.", error);
    } finally {
      setIsExporting(false);
    }
  }, [displayedOrders, fetchOrderItemsForExport, isExporting]);

  const handleExportCSV = useCallback(async () => {
    if (displayedOrders.length === 0 || isExporting) {
      return;
    }

    setIsExporting(true);
    const filename = `commandes_${new Date().toISOString().split("T")[0]}`;

    try {
      const orderIds = displayedOrders.map((order) => order.id);
      const itemsByOrderId = await fetchOrderItemsForExport(orderIds);
      const itemsRows = buildItemsExportRows(displayedOrders, itemsByOrderId);
      const { exportToCSV } = await import("@/lib/export");
      await exportToCSV(itemsRows, ITEM_EXPORT_COLUMNS, { filename });
    } catch (error) {
      console.error("Erreur lors de l'export CSV.", error);
    } finally {
      setIsExporting(false);
    }
  }, [displayedOrders, fetchOrderItemsForExport, isExporting]);

  const handleDownloadZip = useCallback(async (orderId: string, reference: string) => {
    if (downloadingOrderId) return;

    setDownloadingOrderId(orderId);
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/zip`);
      if (!response.ok) {
        throw new Error("Erreur lors du telechargement.");
      }

      const blob = await response.blob();
      const filenameBase = reference?.trim() ? reference.trim() : "bon_de_commande";
      const safeName = filenameBase.replace(/[\\/:*?"<>|]+/g, "-");
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    } finally {
      setDownloadingOrderId(null);
      setOpenMenuId(null);
    }
  }, [downloadingOrderId]);

  const handleDeleteOrder = useCallback(async () => {
    if (!confirmDeleteOrder) return;
    setDeletingOrderId(confirmDeleteOrder.id);
    try {
      const res = await fetch(`/api/purchase-orders/${confirmDeleteOrder.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Echec de la suppression.");
      }
      setConfirmDeleteOrder(null);
      setOpenMenuId(null);
      void mutate();
    } catch (error) {
      console.error(error);
    } finally {
      setDeletingOrderId(null);
    }
  }, [confirmDeleteOrder, mutate]);

  useEffect(() => {
    setPortalTarget(typeof document === "undefined" ? null : document.body);
  }, []);

  useEffect(() => {
    if (!openMenuId) return;

    function handleClick(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      if (dropdownRef.current?.contains(event.target as Node)) return;
      setOpenMenuId(null);
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openMenuId]);

  const updateMenuPosition = useCallback(() => {
    if (!openMenuId) return;

    const menuRoot = menuRef.current;
    if (!menuRoot) return;

    const button = menuRoot.querySelector<HTMLElement>(".action-menu__button");
    const dropdown = dropdownRef.current;
    if (!button || !dropdown) return;

    const gap = 8;
    const dropdownRect = dropdown.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    const tableScroll = menuRoot.closest<HTMLElement>(".table-scroll");
    const tableScrollRect = tableScroll?.getBoundingClientRect();

    const boundaryTop = Math.max(tableScrollRect?.top ?? 0, gap);
    const boundaryBottom = Math.min(
      tableScrollRect?.bottom ?? window.innerHeight,
      window.innerHeight - gap
    );

    const spaceBelow = boundaryBottom - buttonRect.bottom;
    const spaceAbove = buttonRect.top - boundaryTop;

    const shouldOpenUp = spaceBelow < dropdownRect.height + gap && spaceAbove > spaceBelow;
    const nextPlacement = shouldOpenUp ? "up" : "down";
    setMenuPlacement(nextPlacement);

    const maxTop = Math.max(gap, window.innerHeight - dropdownRect.height - gap);
    const maxLeft = Math.max(gap, window.innerWidth - dropdownRect.width - gap);

    const top = nextPlacement === "up"
      ? Math.max(buttonRect.top - dropdownRect.height - gap, gap)
      : Math.min(buttonRect.bottom + gap, maxTop);

    const left = Math.min(
      Math.max(buttonRect.right - dropdownRect.width, gap),
      maxLeft
    );

    setMenuPosition({ top, left });
  }, [openMenuId]);

  useLayoutEffect(() => {
    if (!openMenuId || !portalTarget) {
      setMenuPlacement("down");
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();
  }, [openMenuId, portalTarget, updateMenuPosition]);

  useEffect(() => {
    if (!openMenuId) return;

    const handleUpdate = () => updateMenuPosition();

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);
    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [openMenuId, updateMenuPosition]);

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
      type: "select",
      key: "has_devis",
      label: "Devis",
      placeholder: "Tous",
      options: DEVIS_OPTIONS,
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
      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="page-title">Bons de commande</h1>
          <p className="page-description">
            Gérez vos achats fournisseurs et suivez l&apos;état des commandes.
          </p>
        </div>
        <Link href="/dashboard/orders/new" className="btn btn-accent btn-lg w-full shrink-0 sm:w-auto">
          <PlusIcon aria-hidden="true" size={20} />
          Nouveau bon
        </Link>
      </div>

      {/* Error alert */}
      {loadError ? (
        <div className="alert alert-error mb-6">
          <CircleXIcon aria-hidden="true" size={20} />
          {loadError.message}
        </div>
      ) : null}

      {/* Filter Bar */}
      <TableFilterBar
        data={orders}
        onDataChange={setDisplayedOrders}
        search={{
          placeholder: "Rechercher par référence...",
          fields: ["reference"],
        }}
        filters={filterConfig}
        sortOptions={SORT_OPTIONS}
        resultCountLabel="commandes"
        showResultCount
      />

      {/* Table card */}
      <div className="dashboard-card overflow-visible">
        {/* Card header */}
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-800">
              Tous les bons
            </h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-slate-600">
              {orders.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <ExportDropdown
              onExportExcel={handleExportExcel}
              onExportCSV={handleExportCSV}
              disabled={displayedOrders.length === 0 || isExporting}
            />
            <button
              className="btn btn-secondary btn-sm"
              disabled={isValidating}
              onClick={() => void mutate()}
              type="button"
            >
              <RotateCwIcon aria-hidden="true" className={isValidating ? "animate-spin" : ""} size={16} />
              {isValidating ? "Chargement..." : "Actualiser"}
            </button>
          </div>
        </div>

        {/* Mobile and tablet cards */}
        <div className="divide-y divide-border xl:hidden">
          {displayedOrders.length === 0 ? (
            <div className="p-4 sm:p-6">
              {isLoading ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
                  Chargement des commandes...
                </div>
              ) : orders.length === 0 ? (
                <EmptyState
                  icon={
                    <ShoppingCartIcon strokeWidth="1.5" aria-hidden="true" size={26} />
                  }
                  title="Aucune commande"
                  description="Les commandes sont générées depuis un chiffrage accepté."
                  actionLabel="Voir mes affaires"
                  actionHref="/dashboard/affaires"
                  className="border-0 bg-transparent px-2 py-8 shadow-none"
                />
              ) : (
                <EmptyState
                  icon={
                    <SearchIcon strokeWidth="1.5" aria-hidden="true" size={26} />
                  }
                  title="Aucun résultat"
                  description="Modifiez vos filtres pour voir plus de résultats."
                  className="border-0 bg-transparent px-2 py-8 shadow-none"
                />
              )}
            </div>
          ) : (
            displayedOrders.map((order) => (
              <article key={order.id} className="p-4 sm:p-5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle-foreground">
                      Bon de commande
                    </p>
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="mt-1 block break-words text-base font-semibold text-primary hover:underline"
                    >
                      {order.reference}
                    </Link>
                  </div>
                  <span className={`${statusClass(order.status)} shrink-0`}>
                    {statusLabel(order.status)}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs text-subtle-foreground">Fournisseur</dt>
                    <dd className="mt-0.5 truncate font-medium text-slate-800">
                      {relatedName(order.suppliers)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-subtle-foreground">Chantier</dt>
                    <dd className="mt-0.5 truncate text-foreground-secondary">
                      {relatedName(order.delivery_sites)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle-foreground">Création</dt>
                    <dd className="mt-0.5 text-foreground-secondary">{formatDate(order.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle-foreground">Livraison</dt>
                    <dd className="mt-0.5 text-foreground-secondary">
                      {formatDate(order.expected_delivery_date)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-subtle-foreground">Documents</dt>
                    <dd className="mt-0.5 text-foreground-secondary">
                      {order.devis_count} devis
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-end justify-between gap-3 border-t border-border-subtle pt-4">
                  <div>
                    <p className="text-xs text-subtle-foreground">Total HT</p>
                    <p className="mt-0.5 font-mono text-base font-semibold text-foreground">
                      {formatEUR(order.total_ht_cents)}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/orders/${order.id}`}
                    className="btn btn-secondary btn-sm min-h-11 shrink-0"
                    aria-label={`Ouvrir la commande ${order.reference}`}
                  >
                    Ouvrir
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="table-scroll hidden xl:block">
          <table className="data-table data-table--orders">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>Référence</th>
                <th>Création</th>
                <th>Fournisseur</th>
                <th>Chantier</th>
                <th>Livraison</th>
                <th>Statut</th>
                <th className="text-right">Total HT</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary"></div>
                        <span className="text-muted-foreground">Chargement des commandes...</span>
                      </div>
                    ) : orders.length === 0 ? (
                      <EmptyState
                        icon={
                          <ShoppingCartIcon strokeWidth="1.5" aria-hidden="true" size={26} />
                        }
                        title="Aucune commande"
                        description="Les commandes sont generees depuis un chiffrage accepte."
                        actionLabel="Voir mes affaires"
                        actionHref="/dashboard/affaires"
                        className="mx-auto max-w-xl"
                      />
                    ) : (
                      <EmptyState
                        icon={
                          <SearchIcon strokeWidth="1.5" aria-hidden="true" size={26} />
                        }
                        title="Aucun résultat"
                        description="Modifiez vos filtres pour voir plus de résultats."
                        className="mx-auto max-w-xl"
                      />
                    )}
                  </td>
                </tr>
              ) : (
                displayedOrders.map((order, index) => {
                  const isExpanded = expandedOrderIds.has(order.id);
                  const items = itemsCache[order.id];
                  const devis = devisCache[order.id];
                  const isMenuOpen = openMenuId === order.id;
                  const dropdown = isMenuOpen ? (
                    <div
                      ref={dropdownRef}
                      className="action-menu__dropdown action-menu__dropdown--portal"
                      data-placement={menuPlacement}
                      role="menu"
                      style={menuPosition
                        ? { top: menuPosition.top, left: menuPosition.left }
                        : { top: 0, left: 0, visibility: "hidden" }}
                    >
                      <button
                        className="action-menu__item"
                        role="menuitem"
                        type="button"
                        onClick={() => handleDownloadZip(order.id, order.reference)}
                        disabled={downloadingOrderId === order.id}
                      >
                        <DownloadIcon aria-hidden="true" size={16} />
                        {downloadingOrderId === order.id
                          ? "Telechargement..."
                          : "Telecharger ZIP"}
                      </button>
                      <div className="action-menu__section">
                        <span className="action-menu__label">Statut</span>
                        <PurchaseOrderStatusUpdater
                          orderId={order.id}
                          status={order.status}
                          onSaved={() => {
                            void mutate();
                            setOpenMenuId(null);
                          }}
                        />
                      </div>
                      {order.status === "draft" && (
                        <>
                          <div className="action-menu__divider" />
                          <button
                            className="action-menu__item action-menu__item--danger"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setConfirmDeleteOrder({ id: order.id, reference: order.reference });
                            }}
                          >
                            <TrashIcon aria-hidden="true" size={16} />
                            Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  ) : null;

                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`animate-fade-in-static ${isMenuOpen ? "order-row--menu-open" : ""}`}
                        style={{ animationDelay: `${index * 0.03}s` }}
                      >
                        <td>
                          <button
                            type="button"
                            className={`expand-button ${isExpanded ? "expanded" : ""}`}
                            onClick={() => handleToggleExpand(order.id)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "Replier" : "Développer"}
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
                        <td>{formatDate(order.created_at)}</td>
                        <td className="font-medium text-slate-800">
                          {relatedName(order.suppliers)}
                        </td>
                        <td>{relatedName(order.delivery_sites)}</td>
                        <td>{formatDate(order.expected_delivery_date)}</td>
                        <td>
                          <span className={statusClass(order.status)}>
                            {statusLabel(order.status)}
                          </span>
                        </td>
                        <td className="text-right font-mono font-medium text-slate-800">
                          {formatEUR(order.total_ht_cents)}
                        </td>
                        <td className="text-right">
                          <div
                            className="action-menu"
                            ref={isMenuOpen ? menuRef : null}
                          >
                            <button
                              type="button"
                              className={`action-menu__button ${isMenuOpen ? "is-open" : ""}`}
                              aria-haspopup="menu"
                              aria-expanded={isMenuOpen}
                              onClick={() => setOpenMenuId(isMenuOpen ? null : order.id)}
                            >
                              <EllipsisVerticalIcon aria-hidden="true" size={18} />
                              <span className="sr-only">Actions</span>
                            </button>
                          </div>
                          {isMenuOpen && portalTarget ? createPortal(dropdown, portalTarget) : null}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="expanded-content-row">
                          <td colSpan={9}>
                            <div className="expanded-content animate-expand-down">
                              {/* Articles Section */}
                              <div className="mb-2">
                                <div className="mb-4 flex items-center gap-4">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-orange/10">
                                    <ShoppingBagIcon aria-hidden="true" className="h-4 w-4 text-brand-orange" />
                                  </div>
                                  <h4 className="text-sm font-semibold text-slate-800">
                                    Articles commandes
                                  </h4>
                                  {items && Array.isArray(items) && items.length > 0 && (
                                    <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-orange/15 px-1.5 text-[11px] font-semibold leading-none text-brand-orange ring-1 ring-brand-orange/20">
                                      {items.length}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {items === "loading" ? (
                                <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-4">
                                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary"></div>
                                  <span className="text-sm text-muted-foreground">Chargement des articles...</span>
                                </div>
                              ) : items === "error" ? (
                                <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
                                  Erreur lors du chargement des articles.
                                </div>
                              ) : items && items.length > 0 ? (
                                <div className="rounded-xl border border-border-subtle bg-surface-subtle/70 p-2">
                                  <table className="w-full border-separate border-spacing-y-2 text-[15px] leading-relaxed">
                                    <thead>
                                      <tr className="border-b border-border-subtle bg-surface-subtle/70">
                                        <th className="bg-surface-subtle px-6 py-4 text-left text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:rounded-l-lg last:rounded-r-lg">
                                          Designation
                                        </th>
                                        <th className="w-20 bg-surface-subtle px-6 py-4 text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:rounded-l-lg last:rounded-r-lg">
                                          Qte
                                        </th>
                                        <th className="w-28 bg-surface-subtle px-6 py-4 text-right text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:rounded-l-lg last:rounded-r-lg">
                                          P.U. HT
                                        </th>
                                        <th className="w-28 bg-surface-subtle px-6 py-4 text-right text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:rounded-l-lg last:rounded-r-lg">
                                          Total HT
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((item) => (
                                        <tr key={item.id} className="transition-colors hover:brightness-[0.99]">
                                          <td className="bg-surface px-6 py-6 text-foreground-secondary first:rounded-l-xl last:rounded-r-xl">
                                            {item.designation?.trim() || item.reference?.trim() || "-"}
                                          </td>
                                          <td className="bg-surface px-6 py-6 text-center first:rounded-l-xl last:rounded-r-xl">
                                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-muted px-2 text-[12px] font-semibold leading-none text-foreground-secondary">
                                              {item.quantity}
                                            </span>
                                          </td>
                                          <td className="bg-surface px-6 py-6 text-right font-mono text-[14px] text-slate-600 first:rounded-l-xl last:rounded-r-xl">
                                            {formatEUR(item.unit_price_ht_cents)}
                                          </td>
                                          <td className="bg-surface px-6 py-6 text-right font-mono text-[14px] font-semibold text-slate-800 first:rounded-l-xl last:rounded-r-xl">
                                            {formatEUR(item.line_total_ht_cents)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="rounded-xl border-2 border-dashed border-border bg-surface-subtle/50 px-6 py-8 text-center">
                                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                                    <ShoppingBagIcon aria-hidden="true" className="h-6 w-6 text-subtle-foreground" />
                                  </div>
                                  <p className="mt-3 text-sm font-medium text-slate-600">
                                    Aucun article
                                  </p>
                                  <p className="mt-1 text-xs text-subtle-foreground">
                                    Cette commande ne contient pas d&apos;articles
                                  </p>
                                </div>
                              )}

                              {/* Devis Section */}
                              <div className="mt-6 border-t border-border pt-5">
                                <div className="mb-4 flex items-center justify-between">
                                  <div className="flex items-center gap-4">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                                      <FileTextIcon aria-hidden="true" className="h-4 w-4 text-primary" />
                                    </div>
                                    <h4 className="text-sm font-semibold text-slate-800">
                                      Documents joints
                                    </h4>
                                    {order.devis_count > 0 && (
                                      <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold leading-none text-primary ring-1 ring-primary/20">
                                        {order.devis_count}
                                      </span>
                                    )}
                                  </div>
                                  <Link
                                    href={`/dashboard/orders/${order.id}`}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                                  >
                                    <ExternalLinkIcon aria-hidden="true" className="h-3.5 w-3.5" />
                                    Gerer
                                  </Link>
                                </div>

                                {/* Inline Uploader for draft orders */}
                                {order.status === "draft" && (
                                  <div className="mb-4">
                                    {showUploaderForOrder === order.id ? (
                                      <div className="rounded-xl border border-border bg-surface p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                          <h5 className="text-sm font-medium text-foreground-secondary">
                                            Ajouter des documents
                                          </h5>
                                          <button
                                            onClick={() => {
                                              setShowUploaderForOrder(null);
                                              // Force refresh devis after closing uploader
                                              void fetchOrderDevis(order.id, true);
                                              // Also refresh the main orders list to update devis_count
                                              void mutate();
                                            }}
                                            className="text-xs text-muted-foreground hover:text-foreground-secondary"
                                            type="button"
                                          >
                                            Fermer
                                          </button>
                                        </div>
                                        <DevisUploader
                                          orderId={order.id}
                                          canManage={true}
                                          onUploadComplete={() => {
                                            // Refresh devis list after upload
                                            void fetchOrderDevis(order.id, true);
                                            // Also refresh orders to update devis_count
                                            void mutate();
                                          }}
                                        />
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setShowUploaderForOrder(order.id)}
                                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-brand-orange hover:bg-brand-orange/5 hover:text-brand-orange"
                                        type="button"
                                      >
                                        <PlusIcon aria-hidden="true" className="h-4 w-4" />
                                        Ajouter un document
                                      </button>
                                    )}
                                  </div>
                                )}

                                {devis === "loading" ? (
                                  <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-4">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary"></div>
                                    <span className="text-sm text-muted-foreground">Chargement des documents...</span>
                                  </div>
                                ) : devis === "error" ? (
                                  <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
                                    Erreur lors du chargement des documents.
                                  </div>
                                ) : devis && devis.length > 0 ? (
                                  <div className="space-y-3">
                                    {devis.map((item) => (
                                      <div
                                        key={item.id}
                                        className="group flex items-center gap-4 rounded-xl border border-border-subtle bg-surface p-4 transition-all hover:border-border hover:shadow-sm"
                                      >
                                        <FileTypeIcon mimeType={item.mimeType} filename={item.originalFilename} className="!h-11 !w-11 !rounded-xl flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-semibold text-slate-800">
                                            {item.name}
                                          </p>
                                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                            <span className="truncate font-mono" title={item.originalFilename}>
                                              {item.originalFilename}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                              <span className="h-1 w-1 rounded-full bg-slate-300" />
                                              {formatFileSize(item.fileSizeBytes)}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {isPreviewableType(item.mimeType) && (
                                            <button
                                              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-muted hover:text-slate-800 disabled:opacity-50"
                                              onClick={() => setPreviewDevis(item)}
                                              type="button"
                                              disabled={!item.downloadUrl}
                                            >
                                              <EyeIcon aria-hidden="true" className="h-3.5 w-3.5" />
                                              Apercu
                                            </button>
                                          )}
                                          <button
                                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-brand-blue-light disabled:opacity-50"
                                            onClick={() => {
                                              if (item.downloadUrl) {
                                                window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
                                              }
                                            }}
                                            type="button"
                                            disabled={!item.downloadUrl}
                                          >
                                            <DownloadIcon aria-hidden="true" className="h-3.5 w-3.5" />
                                            Telecharger
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-xl border-2 border-dashed border-border bg-surface-subtle/50 px-6 py-8 text-center">
                                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                                      <FileTextIcon aria-hidden="true" className="h-6 w-6 text-subtle-foreground" strokeWidth="1.5" />
                                    </div>
                                    <p className="mt-3 text-sm font-medium text-slate-600">
                                      Aucun document joint
                                    </p>
                                    <p className="mt-1 text-xs text-subtle-foreground">
                                      Les devis fournisseurs apparaitront ici
                                    </p>
                                  </div>
                                )}
                              </div>
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

      {/* Preview Modal */}
      <DevisPreviewModal
        key={previewDevis?.id ?? "devis-preview-closed"}
        open={previewDevis !== null}
        onClose={() => setPreviewDevis(null)}
        devis={previewDevis}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        open={confirmDeleteOrder !== null}
        title="Supprimer le bon de commande"
        message={
          confirmDeleteOrder
            ? `Etes-vous sur de vouloir supprimer le bon « ${confirmDeleteOrder.reference} » ? Cette action est irreversible.`
            : ""
        }
        confirmLabel={deletingOrderId ? "Suppression..." : "Supprimer"}
        variant="danger"
        onConfirm={handleDeleteOrder}
        onCancel={() => setConfirmDeleteOrder(null)}
      />
    </div>
  );
}
