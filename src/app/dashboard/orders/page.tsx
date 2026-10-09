"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { PlusIcon, RotateCwIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { DevisPreviewModal } from "@/components/DevisPreviewModal";
import { ExportDropdown } from "@/components/ExportDropdown";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { PageHeader } from "@/components/layout/page-header";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui-legacy/Toast";

import { OrderExpandedDetails } from "./_components/OrderExpandedDetails";
import { OrderRowMenu } from "./_components/OrderRowMenu";
import { OrdersCardList } from "./_components/OrdersCardList";
import { OrdersListEmpty } from "./_components/OrdersListEmpty";
import { OrderStatusDialog } from "./_components/OrderStatusDialog";
import { OrdersTable } from "./_components/OrdersTable";
import { exportOrdersToCsv, exportOrdersToExcel } from "./_components/orders-export";
import {
  ORDER_STATUS_OPTIONS,
  type DevisCache,
  type DevisItemRow,
  type ItemsCache,
  type OrderItemRow,
  type PurchaseOrderListRow,
} from "./_components/orders-model";

type OrdersPageResponse = {
  items: PurchaseOrderListRow[];
  suppliers: { id: string; name: string }[];
  delivery_sites: { id: string; name: string }[];
};

type OrderRef = Pick<PurchaseOrderListRow, "id" | "reference" | "status">;

const EMPTY_ORDER_LOOKUPS: { id: string; name: string }[] = [];

const DEVIS_OPTIONS = [
  { value: "with", label: "Avec devis" },
  { value: "without", label: "Sans devis" },
];

const SORT_OPTIONS: SortOption[] = [
  { key: "created_at", label: "Création", defaultDirection: "desc" },
  { key: "expected_delivery_date", label: "Livraison" },
  { key: "total_ht_cents", label: "Total HT" },
  { key: "reference", label: "Référence" },
];

export default function OrdersPage() {
  const confirm = useConfirm();
  const toast = useToast();

  const [displayedOrders, setDisplayedOrders] = useState<PurchaseOrderListRow[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Accordion state - several rows can be expanded at once.
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<ItemsCache>({});
  const [devisCache, setDevisCache] = useState<DevisCache>({});
  const [previewDevis, setPreviewDevis] = useState<DevisItemRow | null>(null);
  const [uploaderOrderId, setUploaderOrderId] = useState<string | null>(null);
  const [downloadingOrderId, setDownloadingOrderId] = useState<string | null>(null);
  const [statusOrder, setStatusOrder] = useState<OrderRef | null>(null);

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

  const fetchOrderItems = useCallback(async (orderId: string) => {
    setItemsCache((prev) => ({ ...prev, [orderId]: "loading" }));
    try {
      const result = await fetchApi<{ items: OrderItemRow[] }>(
        `/api/orders?view=items&order_id=${encodeURIComponent(orderId)}`
      );
      setItemsCache((prev) => ({ ...prev, [orderId]: result.items }));
    } catch {
      setItemsCache((prev) => ({ ...prev, [orderId]: "error" }));
    }
  }, []);

  const fetchOrderDevis = useCallback(async (orderId: string) => {
    setDevisCache((prev) => ({ ...prev, [orderId]: "loading" }));
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/devis`);
      if (!response.ok) throw new Error("Failed to fetch devis");
      const payload = (await response.json()) as { items?: DevisItemRow[] };
      setDevisCache((prev) => ({ ...prev, [orderId]: payload.items ?? [] }));
    } catch {
      setDevisCache((prev) => ({ ...prev, [orderId]: "error" }));
    }
  }, []);

  const handleToggleExpand = useCallback(
    (orderId: string) => {
      const isOpening = !expandedOrderIds.has(orderId);
      setExpandedOrderIds((prev) => {
        const next = new Set(prev);
        if (next.has(orderId)) next.delete(orderId);
        else next.add(orderId);
        return next;
      });
      if (!isOpening) return;
      if (!itemsCache[orderId] || itemsCache[orderId] === "error") void fetchOrderItems(orderId);
      if (!devisCache[orderId] || devisCache[orderId] === "error") void fetchOrderDevis(orderId);
    },
    [expandedOrderIds, itemsCache, devisCache, fetchOrderItems, fetchOrderDevis]
  );

  const runExport = useCallback(
    async (format: "excel" | "csv") => {
      if (displayedOrders.length === 0 || isExporting) return;
      setIsExporting(true);
      try {
        if (format === "excel") await exportOrdersToExcel(displayedOrders);
        else await exportOrdersToCsv(displayedOrders);
      } catch (error) {
        console.error(`Erreur lors de l'export ${format}.`, error);
        toast.error({ title: "L'export a échoué.", description: "Réessayez dans quelques instants." });
      } finally {
        setIsExporting(false);
      }
    },
    [displayedOrders, isExporting, toast]
  );

  const handleDownloadZip = useCallback(
    async (order: OrderRef) => {
      if (downloadingOrderId) return;
      setDownloadingOrderId(order.id);
      try {
        const response = await fetch(`/api/purchase-orders/${order.id}/zip`);
        if (!response.ok) throw new Error("Erreur lors du téléchargement.");

        const blob = await response.blob();
        const filenameBase = order.reference?.trim() ? order.reference.trim() : "bon_de_commande";
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
        toast.error({ title: "Téléchargement impossible.", description: `Le ZIP du bon ${order.reference} n'a pas pu être généré.` });
      } finally {
        setDownloadingOrderId(null);
      }
    },
    [downloadingOrderId, toast]
  );

  const handleDeleteOrder = useCallback(
    async (order: OrderRef) => {
      const confirmed = await confirm({
        title: "Supprimer le bon de commande ?",
        description: `Le bon « ${order.reference} » sera supprimé définitivement.`,
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/purchase-orders/${order.id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Échec de la suppression.");
        }
        toast.success({ title: `Bon ${order.reference} supprimé.` });
        void mutate();
      } catch (error) {
        toast.error({
          title: "Suppression impossible.",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [confirm, mutate, toast]
  );

  const refreshOrderDevis = useCallback(
    (orderId: string) => {
      void fetchOrderDevis(orderId);
      // The list carries the document count.
      void mutate();
    },
    [fetchOrderDevis, mutate]
  );

  const filterConfig: FilterConfig[] = useMemo(
    () => [
      {
        type: "multi-select",
        key: "status",
        label: "Statut",
        placeholder: "Tous les statuts",
        options: ORDER_STATUS_OPTIONS,
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
    ],
    [suppliers, sites]
  );

  const renderActions = (order: PurchaseOrderListRow, triggerClassName?: string) => (
    <OrderRowMenu
      order={order}
      isDownloading={downloadingOrderId === order.id}
      onDownloadZip={() => void handleDownloadZip(order)}
      onChangeStatus={() => setStatusOrder({ id: order.id, reference: order.reference, status: order.status })}
      onDelete={() => void handleDeleteOrder(order)}
      triggerClassName={triggerClassName}
    />
  );

  const empty = <OrdersListEmpty isLoading={isLoading} hasOrders={orders.length > 0} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Bons de commande"
        description="Gérez vos achats fournisseurs et suivez l’état des commandes."
        actions={
          <Link
            href="/dashboard/orders/new"
            className={buttonVariants({ variant: "accent", size: "lg", className: "w-full sm:w-auto" })}
          >
            <PlusIcon aria-hidden="true" />
            Nouveau bon de commande
          </Link>
        }
      />

      {loadError ? (
        <Alert variant="danger" className="mb-6">
          {loadError.message}
        </Alert>
      ) : null}

      <TableFilterBar
        data={orders}
        onDataChange={setDisplayedOrders}
        search={{
          placeholder: "Rechercher par référence…",
          fields: ["reference"],
        }}
        filters={filterConfig}
        sortOptions={SORT_OPTIONS}
        resultCountLabel="commandes"
        showResultCount
      />

      <Card>
        <CardHeader className="items-center sm:px-6">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm">Tous les bons</CardTitle>
            <Badge variant="neutral" size="sm">
              {orders.length}
              <span className="sr-only"> au total</span>
            </Badge>
          </div>
          <CardAction className="grid w-full grid-cols-2 sm:flex sm:w-auto">
            <ExportDropdown
              onExportExcel={() => void runExport("excel")}
              onExportCSV={() => void runExport("csv")}
              disabled={displayedOrders.length === 0}
              loading={isExporting}
            />
            <Button
              variant="outline"
              size="md"
              disabled={isValidating}
              onClick={() => void mutate()}
              leftIcon={<RotateCwIcon aria-hidden="true" className={isValidating ? "animate-spin motion-reduce:animate-none" : undefined} />}
            >
              {isValidating ? "Chargement…" : "Actualiser"}
            </Button>
          </CardAction>
        </CardHeader>

        <OrdersCardList
          orders={displayedOrders}
          renderActions={(order) => renderActions(order, "size-11")}
          empty={empty}
        />

        <OrdersTable
          orders={displayedOrders}
          expandedOrderIds={expandedOrderIds}
          onToggleExpand={handleToggleExpand}
          renderActions={(order) => renderActions(order)}
          renderExpanded={(order) => (
            <OrderExpandedDetails
              order={order}
              items={itemsCache[order.id]}
              devis={devisCache[order.id]}
              isUploaderOpen={uploaderOrderId === order.id}
              onOpenUploader={() => setUploaderOrderId(order.id)}
              onCloseUploader={() => {
                setUploaderOrderId(null);
                refreshOrderDevis(order.id);
              }}
              onUploadComplete={() => refreshOrderDevis(order.id)}
              onPreview={setPreviewDevis}
            />
          )}
          empty={empty}
        />
      </Card>

      <DevisPreviewModal
        key={previewDevis?.id ?? "devis-preview-closed"}
        open={previewDevis !== null}
        onClose={() => setPreviewDevis(null)}
        devis={previewDevis}
      />

      <OrderStatusDialog
        order={statusOrder}
        onClose={() => setStatusOrder(null)}
        onSaved={() => {
          setStatusOrder(null);
          void mutate();
        }}
      />
    </div>
  );
}
