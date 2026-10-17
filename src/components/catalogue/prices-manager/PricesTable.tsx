"use client";

import Link from "next/link";
import { PencilIcon, PlusIcon, RotateCwIcon, SearchIcon, TagsIcon, TrashIcon } from "lucide-react";

import { ListPagination } from "@/components/catalogue/ListPagination";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { FreshnessBadge, formatDate } from "@/components/catalogue/prices-manager/utils";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { supplierOfferZeroPriceLabel } from "@/lib/estimates/supplier-offer-price";
import { formatCurrency, formatEUR, normalizeEstimateCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

function formatPrice(item: EnrichedPrice) {
  const zeroPriceLabel = supplierOfferZeroPriceLabel(item.zero_price_kind);
  if (zeroPriceLabel) return zeroPriceLabel;
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
    <section
      aria-labelledby="prices-list-title"
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card transition-opacity",
        isValidating && items.length > 0 && "opacity-70"
      )}
      aria-busy={isValidating}
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 id="prices-list-title" className="text-sm font-semibold text-foreground">
            Liste des prix fournisseurs
          </h2>
          {filteredItemsCount > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pageStart}–{pageEnd} sur {filteredItemsCount} prix
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="md"
          className="min-h-11 w-full sm:min-h-0 sm:w-auto"
          disabled={isValidating}
          onClick={onRefresh}
          leftIcon={
            <RotateCwIcon
              aria-hidden="true"
              className={isValidating ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          }
        >
          Actualiser
        </Button>
      </div>

      {loadError ? (
        <div className="p-4">
          <Alert variant="danger">
            {loadError instanceof Error ? loadError.message : "Impossible de charger les prix fournisseur."}
          </Alert>
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
                  <p className="break-words text-sm text-foreground">{item._productName}</p>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    Réf. fournisseur : {item.supplier_sku || "non renseignée"}
                    {typeof item.min_quantity === "number" ? ` · minimum ${item.min_quantity} ${item.unit || "u"}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-foreground">
                  <p className="font-mono text-sm font-semibold">{formatPrice(item)} / {item.unit || "u"}</p>
                  <p className="text-xs text-foreground-secondary">Prix unitaire HT</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="md"
                    className="min-h-11 sm:min-h-0"
                    leftIcon={<PencilIcon aria-hidden="true" />}
                    onClick={() => onEdit(item)}
                  >
                    Voir / modifier l’offre
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    className="min-h-11 sm:min-h-0"
                    leftIcon={<TrashIcon aria-hidden="true" />}
                    onClick={() => onDelete(item)}
                  >
                    Supprimer le tarif
                  </Button>
                </div>
              </div>
              <details className="mt-2 text-xs text-foreground-secondary">
                <summary className="cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  Conditions et historique du tarif
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface-subtle p-3">
                  <span>
                    Validité :{" "}
                    {item.valid_from || item.valid_to
                      ? `${formatDate(item.valid_from)} → ${item.valid_to ? formatDate(item.valid_to) : "fin à régulariser"}`
                      : "Non définie"}
                  </span>
                  <span>Mis à jour le {formatDate(item.updated_at ?? item.created_at)}</span>
                  <span>
                    Transport :{" "}
                    {item.transport_mode === "included"
                      ? "inclus"
                      : item.transport_mode === "excluded"
                        ? "non inclus"
                        : "à préciser"}
                  </span>
                  <FreshnessBadge level={item._freshnessLevel} ageDays={item._ageDays} />
                  {item.product_url ? (
                    <a
                      href={item.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Fiche article du fournisseur
                      <span className="sr-only"> (nouvel onglet)</span>
                    </a>
                  ) : null}
                  {item.notes ? <p className="w-full whitespace-pre-wrap">{item.notes}</p> : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : isLoading ? (
        <LoadingState label="Chargement des prix fournisseurs…" />
      ) : (
        <EmptyState
          variant="plain"
          icon={totalItemsCount === 0 ? <TagsIcon /> : <SearchIcon />}
          title={totalItemsCount === 0 ? "Aucun prix fournisseur" : "Aucun résultat"}
          description={
            totalItemsCount === 0
              ? "Ajoutez un prix manuellement ou importez un fichier CSV pour démarrer."
              : "Modifiez vos filtres pour voir plus de résultats."
          }
          action={
            totalItemsCount === 0 ? (
              <Button className="min-h-11" leftIcon={<PlusIcon aria-hidden="true" />} onClick={onCreate}>
                Ajouter un fournisseur / tarif
              </Button>
            ) : null
          }
        />
      )}
      {filteredItemsCount > 0 ? (
        <ListPagination
          label="Pagination des prix fournisseurs"
          itemsLabel="Prix"
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizes={pageSizes}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </section>
  );
}
