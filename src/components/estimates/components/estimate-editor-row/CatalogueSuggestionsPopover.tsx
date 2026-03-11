"use client";

import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import {
  type CataloguePriceSuggestion,
  type SupplierAlternative,
  formatCompactDate,
  resolveDisplayCurrency,
  toAlternativeKindLabel,
} from "@/components/estimates/components/estimate-editor-row/shared";

type CatalogueSuggestionsPopoverProps = {
  itemId: string;
  estimateCurrency: SupportedEstimateCurrency;
  catalogueListboxId: string;
  isCatalogueLoading: boolean;
  catalogueError: string | null;
  catalogueSuggestions: CataloguePriceSuggestion[];
  activeCatalogueSuggestionIndex: number;
  isReadOnly: boolean;
  onApplySuggestion: (
    suggestion: CataloguePriceSuggestion,
    alternative?: SupplierAlternative
  ) => void;
};

export function CatalogueSuggestionsPopover({
  itemId,
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
      id={catalogueListboxId}
      className="estimate-catalogue-suggestions"
      role="listbox"
      onMouseDown={(event) => event.preventDefault()}
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
      {catalogueSuggestions.map((suggestion, suggestionIndex) => (
        <div
          key={`${itemId}:${suggestion.supplier_price_id}`}
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
              <span className="estimate-catalogue-suggestion__supplier">
                {suggestion.supplier_name}
              </span>
              <span className="estimate-catalogue-suggestion__price">
                {formatCurrency(
                  suggestion.adjusted_unit_price_cents,
                  resolveDisplayCurrency(
                    suggestion.currency,
                    estimateCurrency
                  )
                )}
              </span>
            </div>
            <div className="estimate-catalogue-suggestion__meta">
              <span>{suggestion.product_designation}</span>
              <span>{formatCompactDate(suggestion.updated_at)}</span>
              <span>{suggestion.supplier_reference ?? "-"}</span>
              {suggestion.is_stale ? (
                <span className="estimate-catalogue-suggestion__stale">
                  Prix ancien
                </span>
              ) : null}
            </div>
          </button>
          {suggestion.alternatives.length > 0 ? (
            <div className="estimate-catalogue-suggestion__alternatives">
              {suggestion.alternatives.map((alternative) => (
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
                      estimateCurrency
                    )
                  )}{" "}
                  | {formatCompactDate(alternative.updated_at)} |{" "}
                  {alternative.supplier_reference ?? "-"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
