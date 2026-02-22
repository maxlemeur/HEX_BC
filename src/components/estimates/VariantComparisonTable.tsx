"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { promoteEstimateVariant } from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";

type EstimateVariantComparisonItem = {
  id: string;
  project_id: string;
  version_number: number;
  status: "draft" | "sent" | "accepted" | "archived";
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
    case "sent":
      return "Envoye";
    case "accepted":
      return "Accepte";
    case "archived":
      return "Archive";
    default:
      return "Inconnu";
  }
}

function statusClass(status: EstimateVariantComparisonItem["status"]) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
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
    <section className="dashboard-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Comparatif variantes
          </h2>
          <p className="text-xs text-[var(--slate-500)]">
            HT, TVA, TTC et volume des lignes par version.
          </p>
        </div>
      </div>

      {actionError ? (
        <div className="alert alert-error mt-4 px-3 py-2 text-xs">{actionError}</div>
      ) : null}

      <div className="table-scroll mt-4">
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
              <tr>
                <td colSpan={7}>
                  <div className="text-sm text-[var(--slate-500)]">
                    Aucune variante disponible.
                  </div>
                </td>
              </tr>
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
                        <span className="font-medium text-[var(--slate-800)]">
                          {variant
                            ? `Variante ${item.variant_label} · V${item.version_number}`
                            : `Version ${item.version_number}`}
                        </span>
                        {isCurrent ? (
                          <span className="status-badge status-confirmed">Courante</span>
                        ) : null}
                        {isBase ? (
                          <span className="status-badge status-accepted">Principale</span>
                        ) : null}
                      </div>
                      {item.title ? (
                        <div className="mt-1 text-xs text-[var(--slate-500)]" title={item.title}>
                          {item.title}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={statusClass(item.status)}>{statusLabel(item.status)}</span>
                    </td>
                    <td>{item.line_count}</td>
                    <td>{formatEUR(item.total_ht_cents)}</td>
                    <td>{formatEUR(item.total_tax_cents)}</td>
                    <td>{formatEUR(item.total_ttc_cents)}</td>
                    <td>
                      {canPromote ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          disabled={isPromoting || Boolean(promotingId)}
                          onClick={() => void handlePromote(item.id)}
                        >
                          {isPromoting ? "Promotion..." : "Promouvoir"}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--slate-500)]">
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
  );
}
