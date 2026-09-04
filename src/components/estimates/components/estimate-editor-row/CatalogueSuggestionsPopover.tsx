"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import {
  type CataloguePriceSuggestion,
  type SupplierAlternative,
  formatCompactDate,
  resolveDisplayCurrency,
  toAlternativeKindLabel,
} from "@/components/estimates/components/estimate-editor-row/shared";

const NON_INFORMATIVE_TECHNICAL_DETAILS = new Set([
  "autre",
  "autres",
  "n a",
  "non applicable",
  "non renseigne",
  "non renseignee",
]);

function normalizeComparableText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[×✕]/g, "x")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getTechnicalDetails(suggestion: CataloguePriceSuggestion) {
  const materialAndGrade = [
    suggestion.product_material,
    suggestion.product_grade,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");

  const normalizedDesignation = normalizeComparableText(
    suggestion.product_designation,
  );
  const seenDetails = new Set<string>();

  return [
    suggestion.product_type,
    materialAndGrade,
    suggestion.product_dimensions,
    suggestion.product_standard,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .filter((value) => {
      const normalizedValue = normalizeComparableText(value);
      if (
        !normalizedValue ||
        NON_INFORMATIVE_TECHNICAL_DETAILS.has(normalizedValue) ||
        seenDetails.has(normalizedValue)
      ) {
        return false;
      }

      seenDetails.add(normalizedValue);
      return !` ${normalizedDesignation} `.includes(` ${normalizedValue} `);
    });
}

type CatalogueSuggestionsPopoverProps = {
  anchor: HTMLDivElement;
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

type CataloguePopoverPosition = {
  placement: "top" | "bottom";
  style: CSSProperties;
};

const VIEWPORT_PADDING = 16;
const POPOVER_GAP = 6;
const POPOVER_MAX_WIDTH = 520;

function resolvePopoverPosition(
  anchor: HTMLElement,
  popover: HTMLElement,
): CataloguePopoverPosition {
  const anchorRect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    POPOVER_MAX_WIDTH,
    Math.max(0, viewportWidth - VIEWPORT_PADDING * 2),
  );
  const availableBelow = Math.max(
    0,
    viewportHeight - anchorRect.bottom - POPOVER_GAP - VIEWPORT_PADDING,
  );
  const availableAbove = Math.max(
    0,
    anchorRect.top - POPOVER_GAP - VIEWPORT_PADDING,
  );
  const naturalHeight = popover.scrollHeight;
  const placement =
    availableBelow >= Math.min(naturalHeight, 320) ||
    availableBelow >= availableAbove
      ? "bottom"
      : "top";
  const availableHeight =
    placement === "bottom" ? availableBelow : availableAbove;
  const renderedHeight = Math.min(naturalHeight, availableHeight);
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    viewportWidth - width - VIEWPORT_PADDING,
  );
  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_PADDING),
    maxLeft,
  );
  const top =
    placement === "bottom"
      ? anchorRect.bottom + POPOVER_GAP
      : Math.max(
          VIEWPORT_PADDING,
          anchorRect.top - POPOVER_GAP - renderedHeight,
        );

  return {
    placement,
    style: {
      position: "fixed",
      top,
      left,
      width,
      maxHeight: availableHeight,
      visibility: "visible",
    },
  };
}

export function CatalogueSuggestionsPopover({
  anchor,
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
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CataloguePopoverPosition | null>(
    null,
  );

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;

    const updatePosition = () => {
      if (!anchor.isConnected) return;
      setPosition(resolvePopoverPosition(anchor, popover));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePosition);
    resizeObserver?.observe(anchor);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
      resizeObserver?.disconnect();
    };
  }, [
    anchor,
    catalogueError,
    catalogueSuggestions.length,
    isCatalogueLoading,
  ]);

  const content = (
    <div
      ref={popoverRef}
      className="estimate-catalogue-suggestions"
      data-placement={position?.placement}
      style={
        position?.style ?? {
          position: "fixed",
          visibility: "hidden",
        }
      }
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
          const priceSource = suggestion.price_source;
          const hasSupplierPrice =
            priceSource === "supplier" && suggestion.supplier_price_id !== null;
          const alternativeOffers = suggestion.alternatives.filter(
            (alternative) =>
              alternative.supplier_price_id !== suggestion.supplier_price_id,
          );
          const offerCount = hasSupplierPrice
            ? Math.max(
                suggestion.supplier_offer_count,
                alternativeOffers.length + 1,
              )
            : 0;
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
                    {priceSource === "none"
                      ? "Prix à renseigner"
                      : formatCurrency(
                          suggestion.adjusted_unit_price_cents,
                          resolveDisplayCurrency(
                            suggestion.currency,
                            estimateCurrency,
                          ),
                        )}
                    {suggestion.unit ? <small>/{suggestion.unit}</small> : null}
                  </span>
                </div>
                {technicalDetails.length > 0 ||
                suggestion.product_reference ||
                suggestion.product_category ? (
                  <div className="estimate-catalogue-suggestion__tags">
                    {technicalDetails.map((detail) => (
                      <span key={`technical:${detail}`}>{detail}</span>
                    ))}
                    {suggestion.product_reference ? (
                      <span>{suggestion.product_reference}</span>
                    ) : null}
                    {suggestion.product_category ? (
                      <span>{suggestion.product_category}</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="estimate-catalogue-suggestion__supplier-row">
                  {hasSupplierPrice ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <span>
                        <strong>
                          {priceSource === "reference"
                            ? "Prix de référence produit"
                            : "Aucun prix enregistré"}
                        </strong>
                        {suggestion.updated_at
                          ? ` · produit mis à jour le ${formatCompactDate(suggestion.updated_at)}`
                          : ""}
                      </span>
                      <span className="estimate-catalogue-suggestion__stale">
                        Sans offre fournisseur
                      </span>
                    </>
                  )}
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

  return typeof document === "undefined"
    ? null
    : createPortal(content, document.body);
}
