"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { DevisPreviewModal, isPreviewableType } from "@/components/DevisPreviewModal";
import { DevisUploader } from "@/components/DevisUploader";
import { ExportDropdown } from "@/components/ExportDropdown";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import {
  exportToCSV,
  exportToExcelWithSheets,
  type ExportColumn,
} from "@/lib/export";
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

type OrderItemExportRow = OrderItemRow & {
  purchase_order_id: string;
};

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
  { value: "sent", label: "Envoyee" },
  { value: "confirmed", label: "Confirmee" },
  { value: "received", label: "Recue" },
  { value: "canceled", label: "Annulee" },
];

// Devis filter options
const DEVIS_OPTIONS = [
  { value: "with", label: "Avec devis" },
  { value: "without", label: "Sans devis" },
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

const ITEM_EXPORT_COLUMNS: ExportColumn<ItemExportRow>[] = [
  { key: "order_reference", header: "Reference commande" },
  {
    key: "order_created_at",
    header: "Date commande",
    formatter: (value) => formatDate(value as string),
  },
  { key: "supplier", header: "Fournisseur" },
  { key: "delivery_site", header: "Chantier" },
  {
    key: "expected_delivery_date",
    header: "Livraison prevue",
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
  { key: "item_reference", header: "Reference article" },
  { key: "item_quantity", header: "Quantite" },
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
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

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
  const [menuPlacement, setMenuPlacement] = useState<"down" | "up">("down");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchOrders = useCallback(async () => {
    // Fetch orders
    const { data: ordersData, error: ordersError } = await supabase
      .from("purchase_orders")
      .select(
        "id, reference, created_at, status, expected_delivery_date, total_ht_cents, suppliers ( id, name ), delivery_sites ( id, name )"
      )
      .order("created_at", { ascending: false });

    if (ordersError) {
      throw ordersError;
    }

    const orders = ordersData ?? [];

    // Fetch devis counts for all orders
    const orderIds = orders.map((o) => o.id);
    const { data: devisData } = await supabase
      .from("purchase_order_devis")
      .select("purchase_order_id")
      .in("purchase_order_id", orderIds);

    // Count devis per order
    const devisCountMap: Record<string, number> = {};
    (devisData ?? []).forEach((d) => {
      const orderId = d.purchase_order_id;
      devisCountMap[orderId] = (devisCountMap[orderId] ?? 0) + 1;
    });

    // Transform to include devis_count and has_devis
    const transformed = orders.map((order) => {
      const devisCount = devisCountMap[order.id] ?? 0;
      return {
        ...order,
        devis_count: devisCount,
        has_devis: devisCount > 0 ? "with" : "without",
      } as unknown as PurchaseOrderListRow;
    });

    return transformed;
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

    const { data, error } = await supabase
      .from("purchase_order_items")
      .select(
        "id, purchase_order_id, designation, reference, quantity, unit_price_ht_cents, line_total_ht_cents"
      )
      .in("purchase_order_id", orderIds)
      .order("purchase_order_id", { ascending: true })
      .order("position", { ascending: true });

    if (error) {
      throw error;
    }

    const itemsByOrderId: Record<string, OrderItemRow[]> = {};
    (data ?? []).forEach((item) => {
      const typedItem = item as OrderItemExportRow;
      const orderId = typedItem.purchase_order_id;
      const rest: OrderItemRow = {
        id: typedItem.id,
        designation: typedItem.designation,
        reference: typedItem.reference,
        quantity: typedItem.quantity,
        unit_price_ht_cents: typedItem.unit_price_ht_cents,
        line_total_ht_cents: typedItem.line_total_ht_cents,
      };
      if (!itemsByOrderId[orderId]) {
        itemsByOrderId[orderId] = [];
      }
      itemsByOrderId[orderId].push(rest);
    });

    return itemsByOrderId;
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
        // Fetch devis if not already cached
        if (!devisCache[orderId]) {
          fetchOrderDevis(orderId);
        }
      }
      return newSet;
    });
  }, [itemsCache, devisCache, fetchOrderItems, fetchOrderDevis]);

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

      exportToExcelWithSheets([
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
      exportToCSV(itemsRows, ITEM_EXPORT_COLUMNS, { filename });
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

  useEffect(() => {
    if (!openMenuId) return;

    function handleClick(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
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

  useLayoutEffect(() => {
    if (!openMenuId) {
      setMenuPlacement("down");
      return;
    }

    const menuRoot = menuRef.current;
    if (!menuRoot) return;

    const dropdown = menuRoot.querySelector<HTMLElement>(".action-menu__dropdown");
    const button = menuRoot.querySelector<HTMLElement>(".action-menu__button");
    if (!dropdown || !button) return;

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
    setMenuPlacement(shouldOpenUp ? "up" : "down");
  }, [openMenuId]);

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
      <div className="dashboard-card overflow-visible">
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
              disabled={displayedOrders.length === 0 || isExporting}
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
        <div className="table-scroll">
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
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
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
                  const devis = devisCache[order.id];
                  const isMenuOpen = openMenuId === order.id;

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
                              <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <circle cx="12" cy="5" r="1.8" />
                                <circle cx="12" cy="12" r="1.8" />
                                <circle cx="12" cy="19" r="1.8" />
                              </svg>
                              <span className="sr-only">Actions</span>
                            </button>
                            {isMenuOpen && (
                              <div
                                className={`action-menu__dropdown ${menuPlacement === "up" ? "action-menu__dropdown--up" : ""}`}
                                role="menu"
                              >
                                <button
                                  className="action-menu__item"
                                  role="menuitem"
                                  type="button"
                                  onClick={() => handleDownloadZip(order.id, order.reference)}
                                  disabled={downloadingOrderId === order.id}
                                >
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
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
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="expanded-content-row">
                          <td colSpan={9}>
                            <div className="expanded-content animate-expand-down">
                              {/* Articles Section */}
                              <div className="mb-2">
                                <div className="mb-4 flex items-center gap-4">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-orange)]/10">
                                    <svg className="h-4 w-4 text-[var(--brand-orange)]" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M6 5v1H4.667a1.75 1.75 0 00-1.743 1.598l-.826 9.5A1.75 1.75 0 003.84 19H16.16a1.75 1.75 0 001.743-1.902l-.826-9.5A1.75 1.75 0 0015.333 6H14V5a4 4 0 00-8 0zm4-2.5A2.5 2.5 0 007.5 5v1h5V5A2.5 2.5 0 0010 2.5zM7.5 10a2.5 2.5 0 005 0V8.75a.75.75 0 011.5 0V10a4 4 0 01-8 0V8.75a.75.75 0 011.5 0V10z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                  <h4 className="text-sm font-semibold text-[var(--slate-800)]">
                                    Articles commandes
                                  </h4>
                                  {items && Array.isArray(items) && items.length > 0 && (
                                    <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-orange)]/15 px-1.5 text-[11px] font-semibold leading-none text-[var(--brand-orange)] ring-1 ring-[var(--brand-orange)]/20">
                                      {items.length}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {items === "loading" ? (
                                <div className="flex items-center gap-3 rounded-xl border border-[var(--slate-100)] bg-white p-4">
                                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                                  <span className="text-sm text-[var(--slate-500)]">Chargement des articles...</span>
                                </div>
                              ) : items === "error" ? (
                                <div className="rounded-xl border border-[var(--error)]/20 bg-[var(--error-light)] px-4 py-3 text-sm text-[var(--error)]">
                                  Erreur lors du chargement des articles.
                                </div>
                              ) : items && items.length > 0 ? (
                                <div className="rounded-xl border border-[var(--slate-100)] bg-[var(--slate-50)]/70 p-2">
                                  <table className="w-full border-separate border-spacing-y-2 text-[15px] leading-relaxed">
                                    <thead>
                                      <tr className="border-b border-[var(--slate-100)] bg-[var(--slate-50)]/70">
                                        <th className="bg-[var(--slate-50)] px-6 py-4 text-left text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)] first:rounded-l-lg last:rounded-r-lg">
                                          Designation
                                        </th>
                                        <th className="w-20 bg-[var(--slate-50)] px-6 py-4 text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)] first:rounded-l-lg last:rounded-r-lg">
                                          Qte
                                        </th>
                                        <th className="w-28 bg-[var(--slate-50)] px-6 py-4 text-right text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)] first:rounded-l-lg last:rounded-r-lg">
                                          P.U. HT
                                        </th>
                                        <th className="w-28 bg-[var(--slate-50)] px-6 py-4 text-right text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)] first:rounded-l-lg last:rounded-r-lg">
                                          Total HT
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((item) => (
                                        <tr key={item.id} className="transition-colors hover:brightness-[0.99]">
                                          <td className="bg-white px-6 py-6 text-[var(--slate-700)] first:rounded-l-xl last:rounded-r-xl">
                                            {item.designation?.trim() || item.reference?.trim() || "-"}
                                          </td>
                                          <td className="bg-white px-6 py-6 text-center first:rounded-l-xl last:rounded-r-xl">
                                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-[var(--slate-100)] px-2 text-[12px] font-semibold leading-none text-[var(--slate-700)]">
                                              {item.quantity}
                                            </span>
                                          </td>
                                          <td className="bg-white px-6 py-6 text-right font-mono text-[14px] text-[var(--slate-600)] first:rounded-l-xl last:rounded-r-xl">
                                            {formatEUR(item.unit_price_ht_cents)}
                                          </td>
                                          <td className="bg-white px-6 py-6 text-right font-mono text-[14px] font-semibold text-[var(--slate-800)] first:rounded-l-xl last:rounded-r-xl">
                                            {formatEUR(item.line_total_ht_cents)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="rounded-xl border-2 border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/50 px-6 py-8 text-center">
                                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--slate-100)]">
                                    <svg className="h-6 w-6 text-[var(--slate-400)]" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M6 5v1H4.667a1.75 1.75 0 00-1.743 1.598l-.826 9.5A1.75 1.75 0 003.84 19H16.16a1.75 1.75 0 001.743-1.902l-.826-9.5A1.75 1.75 0 0015.333 6H14V5a4 4 0 00-8 0zm4-2.5A2.5 2.5 0 007.5 5v1h5V5A2.5 2.5 0 0010 2.5z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                  <p className="mt-3 text-sm font-medium text-[var(--slate-600)]">
                                    Aucun article
                                  </p>
                                  <p className="mt-1 text-xs text-[var(--slate-400)]">
                                    Cette commande ne contient pas d&apos;articles
                                  </p>
                                </div>
                              )}

                              {/* Devis Section */}
                              <div className="mt-6 border-t border-[var(--slate-200)] pt-5">
                                <div className="mb-4 flex items-center justify-between">
                                  <div className="flex items-center gap-4">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-blue)]/10">
                                      <svg className="h-4 w-4 text-[var(--brand-blue)]" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
                                      </svg>
                                    </div>
                                    <h4 className="text-sm font-semibold text-[var(--slate-800)]">
                                      Documents joints
                                    </h4>
                                    {order.devis_count > 0 && (
                                      <span className="ml-2 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-blue)]/15 px-1.5 text-[11px] font-semibold leading-none text-[var(--brand-blue)] ring-1 ring-[var(--brand-blue)]/20">
                                        {order.devis_count}
                                      </span>
                                    )}
                                  </div>
                                  <Link
                                    href={`/dashboard/orders/${order.id}`}
                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--brand-blue)] transition-colors hover:bg-[var(--brand-blue)]/5"
                                  >
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                                      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                                    </svg>
                                    Gerer
                                  </Link>
                                </div>

                                {/* Inline Uploader for draft orders */}
                                {order.status === "draft" && (
                                  <div className="mb-4">
                                    {showUploaderForOrder === order.id ? (
                                      <div className="rounded-xl border border-[var(--slate-200)] bg-white p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                          <h5 className="text-sm font-medium text-[var(--slate-700)]">
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
                                            className="text-xs text-[var(--slate-500)] hover:text-[var(--slate-700)]"
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
                                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--slate-300)] px-4 py-2.5 text-sm font-medium text-[var(--slate-600)] transition-colors hover:border-[var(--brand-orange)] hover:bg-[var(--brand-orange)]/5 hover:text-[var(--brand-orange)]"
                                        type="button"
                                      >
                                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                        </svg>
                                        Ajouter un document
                                      </button>
                                    )}
                                  </div>
                                )}

                                {devis === "loading" ? (
                                  <div className="flex items-center gap-3 rounded-xl border border-[var(--slate-100)] bg-white p-4">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                                    <span className="text-sm text-[var(--slate-500)]">Chargement des documents...</span>
                                  </div>
                                ) : devis === "error" ? (
                                  <div className="rounded-xl border border-[var(--error)]/20 bg-[var(--error-light)] px-4 py-3 text-sm text-[var(--error)]">
                                    Erreur lors du chargement des documents.
                                  </div>
                                ) : devis && devis.length > 0 ? (
                                  <div className="space-y-3">
                                    {devis.map((item) => (
                                      <div
                                        key={item.id}
                                        className="group flex items-center gap-4 rounded-xl border border-[var(--slate-100)] bg-white p-4 transition-all hover:border-[var(--slate-200)] hover:shadow-sm"
                                      >
                                        <FileTypeIcon mimeType={item.mimeType} filename={item.originalFilename} className="!h-11 !w-11 !rounded-xl flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                                            {item.name}
                                          </p>
                                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--slate-500)]">
                                            <span className="truncate font-mono" title={item.originalFilename}>
                                              {item.originalFilename}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                              <span className="h-1 w-1 rounded-full bg-[var(--slate-300)]" />
                                              {formatFileSize(item.fileSizeBytes)}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {isPreviewableType(item.mimeType) && (
                                            <button
                                              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-800)] disabled:opacity-50"
                                              onClick={() => setPreviewDevis(item)}
                                              type="button"
                                              disabled={!item.downloadUrl}
                                            >
                                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                                                <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                                              </svg>
                                              Apercu
                                            </button>
                                          )}
                                          <button
                                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand-blue)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--brand-blue-light)] disabled:opacity-50"
                                            onClick={() => {
                                              if (item.downloadUrl) {
                                                window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
                                              }
                                            }}
                                            type="button"
                                            disabled={!item.downloadUrl}
                                          >
                                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                              <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                                              <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                                            </svg>
                                            Telecharger
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-xl border-2 border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/50 px-6 py-8 text-center">
                                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--slate-100)]">
                                      <svg className="h-6 w-6 text-[var(--slate-400)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="16" y1="13" x2="8" y2="13" />
                                        <line x1="16" y1="17" x2="8" y2="17" />
                                      </svg>
                                    </div>
                                    <p className="mt-3 text-sm font-medium text-[var(--slate-600)]">
                                      Aucun document joint
                                    </p>
                                    <p className="mt-1 text-xs text-[var(--slate-400)]">
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
        open={previewDevis !== null}
        onClose={() => setPreviewDevis(null)}
        devis={previewDevis}
      />
    </div>
  );
}
