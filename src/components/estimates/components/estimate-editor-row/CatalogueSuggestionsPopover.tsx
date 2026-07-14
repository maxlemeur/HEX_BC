"use client";

import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import {
  type CataloguePriceSuggestion,
  type SupplierAlternative,
  formatCompactDate,
  resolveDisplayCurrency,
  toAlternativeKindLabel,
} from "@/components/estimates/components/estimate-editor-row/shared";

function getTechnicalDetails(suggestion: CataloguePriceSuggestion) {
  const materialAndGrade = [
    suggestion.product_material,
    suggestion.product_grade,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");

  return [
    suggestion.product_type,
    materialAndGrade,
    suggestion.product_dimensions,
    suggestion.product_standard,
  ].filter((value): value is string => Boolean(value?.trim()));
}

type CatalogueSuggestionsPopoverProps = {
  itemId: string;
  query: string;
  estimateCurrency: SupportedEstimateCurrency;
  catalogueListboxId: string;
  isCatalogueLoading: boolean;
  catalogueError: string | null;
  catalogueSuggestions: CataloguePriceSuggestion[];
  activeCatalogueSuggestionIndex: number;
  isReadOnly: boolean;
  onApplySuggestion: (
    suggestion: CataloguePriceSuggestion,
    alternative?: SupplierAlternative,
  ) => void;
};

export function CatalogueSuggestionsPopover({
  itemId,
  query,
  estimateCurrency,
  catalogueListboxId,
  isCatalogueLoading,
  catalogueError,
  catalogueSuggestions,
  activeCatalogueSuggestionIndex,
  isReadOnly,
  onApplySuggestion,
}: CatalogueSuggestionsPopoverProps) {
  return (
    <div
      className="estimate-catalogue-suggestions"
      onMouseDown={(event) => event.preventDefault()}
    >
      {catalogueSuggestions.length > 0 ? (
        <div
          className="estimate-catalogue-suggestions__header"
          role="presentation"
        >
          {catalogueSuggestions.length} résultat
          {catalogueSuggestions.length > 1 ? "s" : ""} pour « {query.trim()} »
        </div>
      ) : null}
      <div
        id={catalogueListboxId}
        className="estimate-catalogue-suggestions__list"
        role="listbox"
      >
        {isCatalogueLoading ? (
          <div className="estimate-catalogue-suggestions__status">
            Recherche catalogue...
          </div>
        ) : null}
        {catalogueError ? (
          <div className="estimate-catalogue-suggestions__status estimate-catalogue-suggestions__status--error">
            {catalogueError}
          </div>
        ) : null}
        {catalogueSuggestions.map((suggestion, suggestionIndex) => {
          const alternativeOffers = suggestion.alternatives.filter(
            (alternative) =>
              alternative.supplier_price_id !== suggestion.supplier_price_id,
          );
          const offerCount = Math.max(
            suggestion.supplier_offer_count ?? 0,
            alternativeOffers.length + 1,
          );
          const technicalDetails = getTechnicalDetails(suggestion);
          return (
            <div
              key={`${itemId}:${suggestion.product_id}`}
              id={`${catalogueListboxId}-option-${suggestionIndex}`}
              role="option"
              aria-selected={suggestionIndex === activeCatalogueSuggestionIndex}
              className={`estimate-catalogue-suggestion${
                suggestionIndex === activeCatalogueSuggestionIndex
                  ? " estimate-catalogue-suggestion--active"
                  : ""
              }`}
            >
              <button
                type="button"
                className="estimate-catalogue-suggestion__primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onApplySuggestion(suggestion)}
                disabled={isReadOnly}
              >
                <div className="estimate-catalogue-suggestion__head">
                  <span className="estimate-catalogue-suggestion__title">
                    {suggestion.product_designation}
                  </span>
                  <span className="estimate-catalogue-suggestion__price">
                    {formatCurrency(
                      suggestion.adjusted_unit_price_cents,
                      resolveDisplayCurrency(
                        suggestion.currency,
                        estimateCurrency,
                      ),
                    )}
                    {suggestion.unit ? <small>/{suggestion.unit}</small> : null}
                  </span>
                </div>
                {technicalDetails.length > 0 ? (
                  <div className="estimate-catalogue-suggestion__technical">
                    {technicalDetails.join(" · ")}
                  </div>
                ) : null}
                {suggestion.product_reference || suggestion.product_category ? (
                  <div className="estimate-catalogue-suggestion__tags">
                    {suggestion.product_reference ? (
                      <span>{suggestion.product_reference}</span>
                    ) : null}
                    {suggestion.product_category ? (
                      <span>{suggestion.product_category}</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="estimate-catalogue-suggestion__supplier-row">
                  <span>
                    <strong>{suggestion.supplier_name}</strong>
                    {suggestion.supplier_reference
                      ? ` · réf. ${suggestion.supplier_reference}`
                      : ""}
                    {suggestion.updated_at
                      ? ` · prix du ${formatCompactDate(suggestion.updated_at)}`
                      : " · prix non daté"}
                  </span>
                  <span
                    className={
                      suggestion.is_stale
                        ? "estimate-catalogue-suggestion__stale"
                        : "estimate-catalogue-suggestion__fresh"
                    }
                  >
                    {suggestion.is_stale ? "Prix ancien" : "Prix à jour"}
                  </span>
                </div>
              </button>
              {offerCount > 1 ? (
                <details className="estimate-catalogue-suggestion__offers">
                  <summary>{offerCount} offres</summary>
                  <div className="estimate-catalogue-suggestion__alternatives">
                    {alternativeOffers.map((alternative) => (
                      <button
                        key={`${suggestion.supplier_price_id}:alt:${alternative.kind}:${alternative.supplier_price_id}`}
                        type="button"
                        className="estimate-catalogue-suggestion__alternative"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onApplySuggestion(suggestion, alternative);
                        }}
                        disabled={isReadOnly}
                      >
                        {toAlternativeKindLabel(alternative.kind)}:{" "}
                        {alternative.supplier_name} |{" "}
                        {formatCurrency(
                          alternative.adjusted_unit_price_cents,
                          resolveDisplayCurrency(
                            alternative.currency,
                            estimateCurrency,
                          ),
                        )}{" "}
                        | {formatCompactDate(alternative.updated_at)} |{" "}
                        {alternative.supplier_reference ?? "-"}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
      {catalogueSuggestions.length > 0 ? (
        <div
          className="estimate-catalogue-suggestions__footer"
          role="presentation"
        >
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Naviguer
          </span>
          <span>
            <kbd>Entrée</kbd> Insérer
          </span>
          <span>
            <kbd>Échap</kbd> Fermer
          </span>
        </div>
      ) : null}
    </div>
  );
}
