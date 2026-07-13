"use client";

import { formatEUR } from "@/lib/money";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { FreshnessBadge, formatDate } from "@/components/catalogue/prices-manager/utils";

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
      <div className="flex flex-col gap-3 border-b border-[var(--slate-200)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Liste des prix fournisseurs
          </h2>
          {filteredItemsCount > 0 ? (
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={isValidating ? "animate-spin" : ""}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          {isValidating ? "Chargement..." : "Actualiser"}
        </button>
      </div>

      {loadError ? (
        <div className="alert alert-error m-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {loadError instanceof Error ? loadError.message : "Impossible de charger les prix fournisseur."}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="divide-y divide-[var(--slate-200)] xl:hidden">
          {items.map((item) => (
            <article key={item.id} className="p-4 sm:p-5">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold text-[var(--slate-900)]">
                    {item._productName}
                  </p>
                  <p className="mt-1 break-words text-sm text-[var(--slate-500)]">
                    {item._supplierName}
                  </p>
                </div>
                <FreshnessBadge level={item._freshnessLevel} ageDays={item._ageDays} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-[var(--slate-400)]">Prix HT</dt>
                  <dd className="mt-0.5 font-mono font-semibold text-[var(--slate-900)]">
                    {typeof item.unit_price_cents === "number" ? formatEUR(item.unit_price_cents) : "-"}
                    {item.currency && item.currency !== "EUR" ? ` ${item.currency}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--slate-400)]">Mis à jour le</dt>
                  <dd className="mt-0.5 text-[var(--slate-700)]">
                    {formatDate(item.updated_at ?? item.created_at)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-[var(--slate-400)]">Validité</dt>
                  <dd className="mt-0.5 text-[var(--slate-700)]">
                    {item.valid_from || item.valid_to
                      ? `${formatDate(item.valid_from)} → ${item.valid_to ? formatDate(item.valid_to) : "illimitée"}`
                      : "Non définie"}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--slate-100)] pt-4">
                <button type="button" className="btn btn-secondary btn-sm min-h-11" onClick={() => onEdit(item)}>
                  Modifier
                </button>
                <button type="button" className="btn btn-danger btn-sm min-h-11" onClick={() => onDelete(item)}>
                  Supprimer
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="px-5 py-10 text-center">
          <p className="font-medium text-[var(--slate-700)]">
            {isLoading
              ? "Chargement..."
              : totalItemsCount === 0
                ? "Aucun prix fournisseur"
                : "Aucun résultat"}
          </p>
          {!isLoading ? (
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              {totalItemsCount === 0
                ? "Ajoutez un prix manuellement ou importez un fichier CSV pour démarrer."
                : "Modifiez vos filtres pour voir plus de résultats."}
            </p>
          ) : null}
          {!isLoading && totalItemsCount === 0 ? (
            <button type="button" className="btn btn-primary btn-sm mt-5 min-h-11" onClick={onCreate}>
              Ajouter un prix
            </button>
          ) : null}
        </div>
      )}

      {items.length > 0 ? (
        <div className="hidden overflow-x-auto xl:block">
          <table className="data-table min-w-[900px]">
          <thead>
            <tr>
              <th scope="col">Fournisseur</th>
              <th scope="col">Produit</th>
              <th scope="col">Prix HT</th>
              <th scope="col">Validité</th>
              <th scope="col">Mis à jour le</th>
              <th scope="col" title="Indique si le prix n'a pas été mis à jour depuis longtemps">Fraîcheur</th>
              <th scope="col" className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  {isLoading ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                      <span className="text-[var(--slate-500)]">Chargement...</span>
                    </div>
                  ) : totalItemsCount === 0 ? (
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
                          <path d="M2 17 12 22 22 17" />
                          <path d="M2 12 12 17 22 12" />
                          <path d="M12 2 2 7 12 12 22 7Z" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-[var(--slate-700)]">Aucun prix fournisseur</p>
                        <p className="mt-1 text-sm text-[var(--slate-500)]">
                          Ajoutez un prix manuellement ou importez un fichier CSV pour démarrer.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm mt-2"
                        onClick={onCreate}
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
                        >
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </svg>
                        Ajouter un prix
                      </button>
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
                        <p className="font-medium text-[var(--slate-700)]">Aucun résultat</p>
                        <p className="mt-1 text-sm text-[var(--slate-500)]">
                          Modifiez vos filtres pour voir plus de résultats.
                        </p>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr
                  key={item.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 0.03}s` }}
                >
                  <td className="font-semibold text-[var(--slate-800)]">{item._supplierName}</td>
                  <td className="text-sm text-[var(--slate-700)]">{item._productName}</td>
                  <td className="font-mono font-medium text-[var(--slate-900)]">
                    {typeof item.unit_price_cents === "number" ? formatEUR(item.unit_price_cents) : "-"}
                    {item.currency && item.currency !== "EUR" ? ` ${item.currency}` : ""}
                  </td>
                  <td className="text-sm">
                    {item.valid_from || item.valid_to ? (
                      <>{formatDate(item.valid_from)} {"\u2192"} {item.valid_to ? formatDate(item.valid_to) : "(illimitée)"}</>
                    ) : (
                      <span className="text-[var(--slate-400)]">Non définie</span>
                    )}
                  </td>
                  <td className="text-sm">{formatDate(item.updated_at ?? item.created_at)}</td>
                  <td>
                    <FreshnessBadge level={item._freshnessLevel} ageDays={item._ageDays} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onEdit(item)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => onDelete(item)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          </table>
        </div>
      ) : null}

      {filteredItemsCount > 0 ? (
        <div className="flex flex-col gap-4 border-t border-[var(--slate-200)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--slate-500)]">
            <span>Afficher</span>
            {pageSizes.map((size) => (
              <button
                key={size}
                type="button"
                className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors ${
                  pageSize === size
                    ? "bg-[var(--slate-900)] text-white"
                    : "bg-[var(--slate-100)] text-[var(--slate-600)] hover:bg-[var(--slate-200)]"
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
            <span className="px-2 text-center text-xs text-[var(--slate-500)]">
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
