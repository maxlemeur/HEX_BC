"use client";

import { formatEUR } from "@/lib/money";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { FreshnessBadge, formatDate } from "@/components/catalogue/prices-manager/utils";

type PricesTableProps = {
  items: EnrichedPrice[];
  totalItemsCount: number;
  rawItemsCount: number;
  isLoading: boolean;
  loadError: unknown;
  isValidating: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (item: EnrichedPrice) => void;
  onDelete: (item: EnrichedPrice) => void;
};

export function PricesTable({
  items,
  totalItemsCount,
  rawItemsCount,
  isLoading,
  loadError,
  isValidating,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,
}: Readonly<PricesTableProps>) {
  return (
    <div className="dashboard-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Liste des prix fournisseurs
        </h2>
        <button
          className="btn btn-secondary btn-sm"
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

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Fournisseur</th>
              <th>Produit</th>
              <th>Prix HT</th>
              <th>Validité</th>
              <th>Mis à jour le</th>
              <th title="Indique si le prix n'a pas été mis à jour depuis longtemps">Fraîcheur</th>
              <th className="text-right">Actions</th>
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

      {!isLoading && rawItemsCount >= 400 ? (
        <div className="border-t border-[var(--slate-200)] px-6 py-3 text-xs text-[var(--slate-500)]">
          Limite de 400 résultats atteinte. Utilisez les filtres pour affiner votre recherche.
        </div>
      ) : null}
    </div>
  );
}
