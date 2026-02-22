"use client";

import { formatEUR } from "@/lib/money";

export type SupplierComparisonAlternative = {
  supplier_price_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  currency: string | null;
  supplier_reference: string | null;
  updated_at: string | null;
  is_stale: boolean;
  catalogue_url: string | null;
  product_designation: string | null;
};

type SupplierComparisonPanelProps = {
  isOpen: boolean;
  itemTitle: string;
  alternatives: SupplierComparisonAlternative[];
  bestSupplierPriceId: string | null;
  isLoading: boolean;
  error: string | null;
  isReadOnly: boolean;
  onClose: () => void;
  onSelectAlternative: (alternative: SupplierComparisonAlternative) => void;
};

function formatCompactDate(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return date.toLocaleDateString("fr-FR");
}

export function SupplierComparisonPanel({
  isOpen,
  itemTitle,
  alternatives,
  bestSupplierPriceId,
  isLoading,
  error,
  isReadOnly,
  onClose,
  onSelectAlternative,
}: SupplierComparisonPanelProps) {
  if (!isOpen) return null;

  const visibleAlternatives = alternatives.slice(0, 3);

  return (
    <div className="estimate-supplier-comparison-backdrop">
      <button
        type="button"
        className="estimate-supplier-comparison-backdrop__dismiss"
        onClick={onClose}
        aria-label="Fermer la comparaison fournisseurs"
      />
      <div
        className="estimate-supplier-comparison-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-supplier-comparison-title"
      >
        <div className="estimate-supplier-comparison-panel__header">
          <div>
            <h2
              id="estimate-supplier-comparison-title"
              className="estimate-supplier-comparison-panel__title"
            >
              Comparer fournisseurs
            </h2>
            <p className="estimate-supplier-comparison-panel__subtitle">
              {itemTitle || "Ligne sans titre"}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="estimate-supplier-comparison-panel__content">
          {isLoading ? (
            <div className="estimate-supplier-comparison-state">
              Chargement des alternatives fournisseurs...
            </div>
          ) : null}

          {!isLoading && error ? (
            <div className="estimate-supplier-comparison-state estimate-supplier-comparison-state--error">
              {error}
            </div>
          ) : null}

          {!isLoading && !error && visibleAlternatives.length === 0 ? (
            <div className="estimate-supplier-comparison-state">
              Aucune alternative fournisseur.
            </div>
          ) : null}

          {!isLoading && !error
            ? visibleAlternatives.map((alternative) => {
                const isBestPrice =
                  bestSupplierPriceId !== null &&
                  alternative.supplier_price_id === bestSupplierPriceId;

                return (
                  <article
                    key={alternative.supplier_price_id}
                    className={`estimate-supplier-comparison-option${
                      isBestPrice
                        ? " estimate-supplier-comparison-option--best"
                        : ""
                    }`}
                  >
                    <div className="estimate-supplier-comparison-option__header">
                      <div>
                        <div className="estimate-supplier-comparison-option__name">
                          {alternative.supplier_name}
                        </div>
                        <div className="estimate-supplier-comparison-option__reference">
                          Ref: {alternative.supplier_reference ?? "-"}
                        </div>
                      </div>
                      <div className="estimate-supplier-comparison-option__price">
                        {formatEUR(alternative.adjusted_unit_price_cents)}
                        {alternative.currency ? ` ${alternative.currency}` : ""}
                      </div>
                    </div>

                    <div className="estimate-supplier-comparison-option__meta">
                      <span>Date: {formatCompactDate(alternative.updated_at)}</span>
                      {isBestPrice ? (
                        <span className="estimate-supplier-comparison-option__badge estimate-supplier-comparison-option__badge--best">
                          Meilleur prix
                        </span>
                      ) : null}
                      {alternative.is_stale ? (
                        <span className="estimate-supplier-comparison-option__badge estimate-supplier-comparison-option__badge--stale">
                          Prix ancien
                        </span>
                      ) : null}
                    </div>

                    <div className="estimate-supplier-comparison-option__footer">
                      {alternative.catalogue_url ? (
                        <a
                          href={alternative.catalogue_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="estimate-supplier-comparison-option__link"
                        >
                          Ouvrir la fiche fournisseur
                        </a>
                      ) : (
                        <span className="estimate-supplier-comparison-option__link estimate-supplier-comparison-option__link--muted">
                          URL catalogue indisponible
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onSelectAlternative(alternative)}
                        disabled={isReadOnly}
                      >
                        Selectionner
                      </button>
                    </div>
                  </article>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}
