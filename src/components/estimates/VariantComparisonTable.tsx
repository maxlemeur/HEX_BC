"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyTableRow } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { promoteEstimateVariant } from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";

type EstimateVariantComparisonItem = {
  id: string;
  project_id: string;
  version_number: number;
  status: "draft" | "sending" | "sent" | "accepted" | "archived";
  title: string | null;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  line_count: number;
  updated_at: string;
  parent_version_id: string | null;
  variant_label: string | null;
};

type VariantComparisonTableProps = {
  currentVersionId: string;
  baseVersionId: string;
  items: EstimateVariantComparisonItem[];
};

function statusLabel(status: EstimateVariantComparisonItem["status"]) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sending":
      return "Envoi en cours";
    case "sent":
      return "Envoyé";
    case "accepted":
      return "Accepté";
    case "archived":
      return "Archivé";
    default:
      return "Inconnu";
  }
}

function statusVariant(status: EstimateVariantComparisonItem["status"]): BadgeProps["variant"] {
  switch (status) {
    case "sending":
      return "warning";
    case "sent":
      return "info";
    case "accepted":
      return "success";
    case "archived":
      return "outline";
    default:
      return "neutral";
  }
}

function isVariant(item: EstimateVariantComparisonItem) {
  return Boolean(item.parent_version_id && item.variant_label);
}

export function VariantComparisonTable({
  currentVersionId,
  baseVersionId,
  items,
}: Readonly<VariantComparisonTableProps>) {
  const router = useRouter();
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handlePromote = useCallback(
    async (versionId: string) => {
      if (!versionId || promotingId) return;

      setActionError(null);
      setPromotingId(versionId);

      try {
        const promotedVersionId = await promoteEstimateVariant(versionId);
        router.push(`/dashboard/estimates/${promotedVersionId}`);
        router.refresh();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Une erreur est survenue."
        );
      } finally {
        setPromotingId(null);
      }
    },
    [promotingId, router]
  );

  return (
    <Card className="p-4 sm:p-5">
      <section aria-labelledby="variant-comparison-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="variant-comparison-title" className="text-sm font-semibold text-foreground">
              Comparatif des variantes
            </h2>
            <p className="text-xs text-muted-foreground">
              HT, TVA, TTC et volume des lignes par version.
            </p>
          </div>
        </div>

        {actionError ? (
          <Alert variant="danger" className="mt-4">
            {actionError}
          </Alert>
        ) : null}

        <div
          className="table-scroll mt-4"
          role="region"
          aria-label="Comparatif des variantes"
          tabIndex={0}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Statut</th>
                <th>Lignes</th>
                <th>Total HT</th>
                <th>TVA</th>
                <th>Total TTC</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <EmptyTableRow
                  colSpan={7}
                  variant="compact"
                  title="Aucune variante disponible."
                />
              ) : (
                items.map((item) => {
                  const variant = isVariant(item);
                  const isCurrent = item.id === currentVersionId;
                  const isBase = item.id === baseVersionId;
                  const canPromote = variant && item.status === "draft";
                  const isPromoting = promotingId === item.id;

                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {variant
                              ? `Variante ${item.variant_label} · V${item.version_number}`
                              : `Version ${item.version_number}`}
                          </span>
                          {isCurrent ? (
                            <Badge variant="brand" size="sm">Courante</Badge>
                          ) : null}
                          {isBase ? (
                            <Badge variant="outline" size="sm">Principale</Badge>
                          ) : null}
                        </div>
                        {item.title ? (
                          <div className="mt-1 text-xs text-muted-foreground" title={item.title}>
                            {item.title}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <Badge variant={statusVariant(item.status)} size="sm" dot>
                          {statusLabel(item.status)}
                        </Badge>
                      </td>
                      <td className="tabular-nums">{item.line_count}</td>
                      <td className="tabular-nums">{formatEUR(item.total_ht_cents)}</td>
                      <td className="tabular-nums">{formatEUR(item.total_tax_cents)}</td>
                      <td className="tabular-nums">{formatEUR(item.total_ttc_cents)}</td>
                      <td>
                        {canPromote ? (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            loading={isPromoting}
                            disabled={Boolean(promotingId)}
                            onClick={() => void handlePromote(item.id)}
                          >
                            Promouvoir
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {variant ? "Statut non promouvable" : "-"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Card>
  );
}
