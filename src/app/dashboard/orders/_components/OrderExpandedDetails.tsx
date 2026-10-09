"use client";

import Link from "next/link";
import { DownloadIcon, ExternalLinkIcon, EyeIcon, FileTextIcon, PlusIcon, ShoppingBagIcon } from "lucide-react";

import { isPreviewableType } from "@/components/DevisPreviewModal";
import { DevisUploader } from "@/components/DevisUploader";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatEUR } from "@/lib/money";

import {
  formatFileSize,
  type DevisItemRow,
  type LazyRows,
  type OrderItemRow,
  type PurchaseOrderListRow,
} from "./orders-model";

type OrderExpandedDetailsProps = {
  order: PurchaseOrderListRow;
  items: LazyRows<OrderItemRow> | undefined;
  devis: LazyRows<DevisItemRow> | undefined;
  isUploaderOpen: boolean;
  onOpenUploader: () => void;
  onCloseUploader: () => void;
  onUploadComplete: () => void;
  onPreview: (devis: DevisItemRow) => void;
};

function SectionHeading({
  icon,
  title,
  count,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  tone: "accent" | "brand";
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={
          tone === "accent"
            ? "flex size-8 items-center justify-center rounded-lg bg-brand-orange/10 text-brand-orange-dark [&_svg]:size-4"
            : "flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4"
        }
      >
        {icon}
      </span>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {count ? (
        <Badge variant={tone} size="sm">
          {count}
        </Badge>
      ) : null}
    </div>
  );
}

function OrderedItems({ items }: { items: LazyRows<OrderItemRow> | undefined }) {
  if (items === undefined || items === "loading") {
    return <LoadingState label="Chargement des articles…" className="py-4" />;
  }
  if (items === "error") {
    return <Alert variant="danger">Erreur lors du chargement des articles.</Alert>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        variant="compact"
        headingLevel={4}
        icon={<ShoppingBagIcon aria-hidden="true" />}
        title="Aucun article"
        description="Ce bon de commande ne contient pas d’article."
        className="rounded-lg border border-dashed border-border bg-surface"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-subtle">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Désignation
            </th>
            <th scope="col" className="w-20 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Qté
            </th>
            <th scope="col" className="w-32 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              P.U. HT
            </th>
            <th scope="col" className="w-32 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total HT
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3 text-foreground-secondary">
                {item.designation?.trim() || item.reference?.trim() || "-"}
              </td>
              <td className="px-4 py-3 text-center font-semibold tabular-nums text-foreground-secondary">
                {item.quantity}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground-secondary">
                {formatEUR(item.unit_price_ht_cents)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-foreground">
                {formatEUR(item.line_total_ht_cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttachedDevis({
  devis,
  onPreview,
}: {
  devis: LazyRows<DevisItemRow> | undefined;
  onPreview: (devis: DevisItemRow) => void;
}) {
  if (devis === undefined || devis === "loading") {
    return <LoadingState label="Chargement des documents…" className="py-4" />;
  }
  if (devis === "error") {
    return <Alert variant="danger">Erreur lors du chargement des documents.</Alert>;
  }
  if (devis.length === 0) {
    return (
      <EmptyState
        variant="compact"
        headingLevel={4}
        icon={<FileTextIcon aria-hidden="true" />}
        title="Aucun document joint"
        description="Les devis fournisseurs apparaîtront ici."
        className="rounded-lg border border-dashed border-border bg-surface"
      />
    );
  }

  return (
    <ul className="space-y-2" aria-label="Documents joints">
      {devis.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:border-border"
        >
          <FileTypeIcon mimeType={item.mimeType} filename={item.originalFilename} className="!h-10 !w-10 !rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">{item.originalFilename}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{formatFileSize(item.fileSizeBytes)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPreviewableType(item.mimeType, item.originalFilename) ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<EyeIcon aria-hidden="true" />}
                onClick={() => onPreview(item)}
                disabled={!item.downloadUrl}
                aria-label={`Aperçu de ${item.name}`}
              >
                Aperçu
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<DownloadIcon aria-hidden="true" />}
              onClick={() => {
                if (item.downloadUrl) {
                  window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
                }
              }}
              disabled={!item.downloadUrl}
              aria-label={`Télécharger ${item.name}`}
            >
              Télécharger
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Ordered lines and attached supplier quotes of an expanded order row. */
export function OrderExpandedDetails({
  order,
  items,
  devis,
  isUploaderOpen,
  onOpenUploader,
  onCloseUploader,
  onUploadComplete,
  onPreview,
}: OrderExpandedDetailsProps) {
  const itemCount = Array.isArray(items) ? items.length : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SectionHeading icon={<ShoppingBagIcon />} title="Articles commandés" count={itemCount} tone="accent" />
        <OrderedItems items={items} />
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading icon={<FileTextIcon />} title="Documents joints" count={order.devis_count} tone="brand" />
          <Link
            href={`/dashboard/orders/${order.id}`}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "text-primary" })}
            aria-label={`Gérer les documents du bon ${order.reference}`}
          >
            <ExternalLinkIcon aria-hidden="true" />
            Gérer
          </Link>
        </div>

        {order.status === "draft" ? (
          isUploaderOpen ? (
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-foreground-secondary">Ajouter des documents</h4>
                <Button variant="ghost" size="sm" onClick={onCloseUploader}>
                  Fermer
                </Button>
              </div>
              <DevisUploader orderId={order.id} canManage onUploadComplete={onUploadComplete} />
            </div>
          ) : (
            <Button variant="outline" size="md" leftIcon={<PlusIcon aria-hidden="true" />} onClick={onOpenUploader}>
              Ajouter un document
            </Button>
          )
        ) : null}

        <AttachedDevis devis={devis} onPreview={onPreview} />
      </div>
    </div>
  );
}
