"use client";

import Link from "next/link";
import { formatCurrency, formatEUR, normalizeEstimateCurrency } from "@/lib/money";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { FreshnessBadge, formatDate } from "@/components/catalogue/prices-manager/utils";
import { CircleXIcon, RotateCwIcon } from "lucide-react";

function formatPrice(item: EnrichedPrice) {
  const currency = normalizeEstimateCurrency(item.currency);
  if (currency) return formatCurrency(item.unit_price_cents, currency);
  if (item.currency?.trim()) return `${(item.unit_price_cents / 100).toFixed(2)} ${item.currency.trim()}`;
  return formatEUR(item.unit_price_cents);
}
type PricesTableProps = {
  items: EnrichedPrice[];
  filteredItemsCount: number;
  totalItemsCount: number;
  isLoading: boolean;
  loadError: unknown;
  isValidating: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (item: EnrichedPrice) => void;
  onDelete: (item: EnrichedPrice) => void;

  page: number;
  pageSize: number;
  pageSizes: readonly number[];
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function PricesTable({
  items,
  filteredItemsCount,
  totalItemsCount,
  isLoading,
  loadError,
  isValidating,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,

  page,
  pageSize,
  pageSizes,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: Readonly<PricesTableProps>) {
  const pageStart = filteredItemsCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, filteredItemsCount);

  return (
    <div
      className={`dashboard-card overflow-hidden transition-opacity ${isValidating && items.length > 0 ? "opacity-70" : ""}`}
      aria-busy={isValidating}
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            Liste des prix fournisseurs
          </h2>
          {filteredItemsCount > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pageStart}–{pageEnd} sur {filteredItemsCount} prix
            </p>
          ) : null}
        </div>
        <button
          className="btn btn-secondary btn-sm min-h-11 w-full sm:min-h-0 sm:w-auto"
          disabled={isValidating}
          onClick={onRefresh}
          type="button"
        >
          <RotateCwIcon aria-hidden="true" className={isValidating ? "animate-spin" : ""} size={16} />
          {isValidating ? "Chargement..." : "Actualiser"}
        </button>
      </div>

      {loadError ? (
        <div className="alert alert-error m-4">
          <CircleXIcon aria-hidden="true" size={18} />
          {loadError instanceof Error ? loadError.message : "Impossible de charger les prix fournisseur."}
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-border" aria-label="Offres fournisseurs">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3 sm:px-6">
              <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="min-w-0">
                  <Link href="/dashboard/suppliers" className="text-sm font-semibold text-primary hover:underline">
                    {item._supplierName}
                  </Link>
                  <p className="break-words text-sm text-slate-800">{item._productName}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Réf. fournisseur : {item.supplier_sku || "non renseignée"}
                    {typeof item.min_quantity === "number" ? ` · minimum ${item.min_quantity} ${item.unit || "u"}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-950">
                  <p className="font-mono text-sm font-semibold">{formatPrice(item)} / {item.unit || "u"}</p>
                  <p className="text-xs">Prix unitaire HT</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-secondary btn-sm min-h-11 sm:min-h-0" onClick={() => onEdit(item)}>
                    Voir / modifier l’offre
                  </button>
                  <button type="button" className="btn btn-danger btn-sm min-h-11 sm:min-h-0" onClick={() => onDelete(item)}>
                    Supprimer le tarif
                  </button>
                </div>
              </div>
              <details className="mt-2 text-xs text-slate-600">
                <summary className="cursor-pointer py-1">Conditions et historique du tarif</summary>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface-subtle p-3">
                  <span>Validité : {item.valid_from || item.valid_to
                    ? `${formatDate(item.valid_from)} → ${item.valid_to ? formatDate(item.valid_to) : "fin à régulariser"}`
                    : "Non définie"}</span>
                  <span>Mis à jour le {formatDate(item.updated_at ?? item.created_at)}</span>
                  <span>Transport : {item.transport_mode === "included" ? "inclus" : item.transport_mode === "excluded" ? "non inclus" : "à préciser"}</span>
                  <FreshnessBadge level={item._freshnessLevel} ageDays={item._ageDays} />
                  {item.product_url ? <a href={item.product_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Fiche article du fournisseur</a> : null}
                  {item.notes ? <p className="w-full whitespace-pre-wrap">{item.notes}</p> : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="font-medium text-foreground-secondary">
            {isLoading ? "Chargement..." : totalItemsCount === 0 ? "Aucun prix fournisseur" : "Aucun résultat"}
          </p>
          {!isLoading ? <p className="mt-1 text-sm text-muted-foreground">
            {totalItemsCount === 0 ? "Ajoutez un prix manuellement ou importez un fichier CSV pour démarrer." : "Modifiez vos filtres pour voir plus de résultats."}
          </p> : null}
          {!isLoading && totalItemsCount === 0 ? <button type="button" className="btn btn-primary btn-sm mt-5 min-h-11" onClick={onCreate}>Ajouter un fournisseur / tarif</button> : null}
        </div>
      )}
      {filteredItemsCount > 0 ? (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Afficher</span>
            {pageSizes.map((size) => (
              <button
                key={size}
                type="button"
                className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors ${
                  pageSize === size
                    ? "bg-slate-900 text-white"
                    : "bg-muted text-slate-600 hover:bg-slate-200"
                }`}
                onClick={() => onPageSizeChange(size)}
              >
                {size}
              </button>
            ))}
            <span>par page</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm min-h-11"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              Précédent
            </button>
            <span className="px-2 text-center text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm min-h-11"
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            >
              Suivant
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
