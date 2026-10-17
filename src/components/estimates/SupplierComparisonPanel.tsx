"use client";

import { useId } from "react";
import { ExternalLinkIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  bankersRound,
  formatCurrency,
  formatEUR,
  normalizeEstimateCurrency,
} from "@/lib/money";
import type { SupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";
import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";
import { supplierOfferZeroPriceLabel } from "@/lib/estimates/supplier-offer-price";

/**
 * Affiche un prix fournisseur dans SA devise. Auparavant tout passait par
 * formatEUR avec le code devise concaténé, ce qui produisait « 1 000,00 €USD »
 * (et « 95,00 €EUR ») : un acheteur pouvait prendre un montant USD pour des
 * euros.
 */
function formatSupplierPrice(cents: number, currency: string | null) {
  const normalized = normalizeEstimateCurrency(currency);
  if (normalized) {
    return formatCurrency(cents, normalized);
  }
  if (currency?.trim()) {
    // Devise non supportée : montant brut + code, jamais le symbole €.
    return `${(cents / 100).toFixed(2)} ${currency.trim()}`;
  }
  return formatEUR(cents);
}

export type SupplierComparisonAlternativeKind =
  | "best_price"
  | "most_recent"
  | "preferred_supplier"
  | "selected_current";

export type SupplierComparisonAlternative = SupplierOfferConditions & {
  kind: SupplierComparisonAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  currency: string | null;
  supplier_reference: string | null;
  updated_at: string | null;
  is_stale: boolean;
  catalogue_url: string | null;
  product_designation: string | null;
  is_selected: boolean;
};

type SupplierComparisonPanelProps = {
  isOpen: boolean;
  itemTitle: string;
  alternatives: SupplierComparisonAlternative[];
  bestSupplierPriceId: string | null;
  isLoading: boolean;
  error: string | null;
  isReadOnly: boolean;
  /** Devise du devis : les prix libelles autrement ne sont pas injectables. */
  estimateCurrency: string;
  quantity?: number | null;
  itemUnit?: string | null;
  currentUnitPriceCents?: number | null;
  /** Seuil de fraîcheur des prix (jours) ; affiché avec l'âge des prix anciens quand il est connu. */
  stalePriceDays?: number | null;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Âge du prix en jours entiers, ou null si la date est absente ou invalide. */
function computePriceAgeDays(value: string | null | undefined, now = Date.now()) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

function formatPriceAge(days: number) {
  if (days === 0) return "aujourd’hui";
  return `il y a ${days} j`;
}

function getAlternativeBadgeLabels(input: {
  alternative: SupplierComparisonAlternative;
  isBestPrice: boolean;
}) {
  const labels: string[] = [];

  if (input.isBestPrice) {
    labels.push("Meilleur prix");
  }
  if (input.alternative.kind === "most_recent") {
    labels.push("Prix le plus récent");
  }
  if (input.alternative.kind === "preferred_supplier") {
    labels.push("Fournisseur préféré");
  }
  if (input.alternative.is_selected || input.alternative.kind === "selected_current") {
    labels.push("Sélection actuelle");
  }
  if (input.alternative.is_stale) {
    labels.push("Prix ancien");
  }

  return labels;
}

export function SupplierComparisonPanel({
  isOpen,
  itemTitle,
  alternatives,
  bestSupplierPriceId,
  isLoading,
  error,
  isReadOnly,
  estimateCurrency,
  quantity,
  itemUnit,
  currentUnitPriceCents,
  stalePriceDays = null,
  onClose,
  onSelectAlternative,
}: SupplierComparisonPanelProps) {
  const idPrefix = useId();
  const staleThresholdLabel =
    typeof stalePriceDays === "number" && stalePriceDays > 0
      ? `seuil de fraîcheur : ${stalePriceDays} j`
      : "au-delà du seuil de fraîcheur";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        className="gap-0 overflow-hidden p-0 sm:p-0"
        data-testid="supplier-comparison-panel"
      >
        <DialogHeader className="border-b border-border-subtle px-5 py-4 sm:px-6">
          <DialogTitle>Comparer fournisseurs</DialogTitle>
          <DialogDescription className="break-words">
            {itemTitle || "Ligne sans titre"}
          </DialogDescription>
          {typeof quantity === "number" ? (
            <p className="text-sm text-foreground-secondary">
              Quantité : {quantity} {itemUnit || "u"}
              {typeof currentUnitPriceCents === "number"
                ? ` · Coût retenu : ${formatSupplierPrice(currentUnitPriceCents, estimateCurrency)} / ${itemUnit || "u"}`
                : ""}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Coûts de fourniture HT avant coefficients FO et marge.
          </p>
          {!isLoading && !error && typeof stalePriceDays === "number" && stalePriceDays > 0 ? (
            <p className="text-xs text-muted-foreground">
              Prix ancien au-delà du {staleThresholdLabel}.
            </p>
          ) : null}
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4 sm:px-6">
          {isLoading ? (
            <LoadingState label="Chargement des offres fournisseurs…" className="py-6" />
          ) : null}

          {!isLoading && error ? <Alert variant="danger">{error}</Alert> : null}

          {!isLoading && !error && alternatives.length === 0 ? (
            <EmptyState
              variant="compact"
              title="Aucune autre offre fournisseur"
              description="Le catalogue ne contient pas d’autre prix pour cet article."
            />
          ) : null}

          {!isLoading && !error
            ? alternatives.map((alternative) => {
                const isBestPrice =
                  bestSupplierPriceId !== null &&
                  alternative.supplier_price_id === bestSupplierPriceId;
                const badgeLabels = getAlternativeBadgeLabels({
                  alternative,
                  isBestPrice,
                });
                const ineligibility = supplierOfferIneligibility(alternative, {
                  currency: estimateCurrency, quantity, unit: itemUnit,
                });
                const retainedWithoutChange = alternative.is_selected && (
                  currentUnitPriceCents === undefined || currentUnitPriceCents === null ||
                  currentUnitPriceCents === alternative.adjusted_unit_price_cents
                );
                const ageDays = computePriceAgeDays(alternative.updated_at);
                const ineligibilityId = `${idPrefix}-${alternative.supplier_price_id}-ineligible`;

                return (
                  <article
                    key={alternative.supplier_price_id}
                    className={cn(
                      "flex flex-col gap-3 rounded-lg border bg-surface p-3 sm:p-4",
                      isBestPrice ? "border-primary/40 bg-primary/[0.03] ring-1 ring-primary/10" : "border-border"
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-foreground">
                          {alternative.supplier_name}
                        </h3>
                        <p className="mt-1 text-sm text-foreground-secondary [overflow-wrap:anywhere]">
                          {alternative.product_designation?.trim() ||
                            "Désignation non renseignée"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Réf. : {alternative.supplier_reference ?? "-"}
                        </p>
                      </div>
                      <div className="estimate-supplier-comparison-option__price shrink-0 text-sm font-bold tabular-nums text-primary sm:text-right">
                        {supplierOfferZeroPriceLabel(alternative.zero_price_kind) ?? formatSupplierPrice(
                          alternative.adjusted_unit_price_cents,
                          alternative.currency
                        )}
                        {alternative.unit ? <span className="text-xs"> / {alternative.unit}</span> : null}
                        {typeof quantity === "number" && !ineligibility ? (
                          <p className="mt-1 text-xs font-normal text-foreground-secondary">
                            Total fourniture : {formatSupplierPrice(bankersRound(alternative.adjusted_unit_price_cents * quantity), alternative.currency)} HT
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
                      <span>
                        Mis à jour le {formatCompactDate(alternative.updated_at)}
                        {ageDays !== null ? ` (${formatPriceAge(ageDays)})` : ""}
                      </span>
                      {typeof alternative.min_quantity === "number" ? (
                        <span>
                          Minimum : {alternative.min_quantity} {alternative.unit || "u"}
                        </span>
                      ) : null}
                      {ineligibility ? (
                        <Badge id={ineligibilityId} variant="warning" size="sm">
                          {ineligibility}
                        </Badge>
                      ) : null}
                      {badgeLabels.map((label) => (
                        <Badge
                          key={`${alternative.supplier_price_id}-${label}`}
                          variant={
                            label === "Meilleur prix"
                              ? "brand"
                              : label === "Prix ancien"
                                ? "warning"
                                : "neutral"
                          }
                          size="sm"
                        >
                          {label}
                        </Badge>
                      ))}
                    </div>

                    {alternative.is_stale ? (
                      <p className="text-xs text-warning">
                        {ageDays !== null
                          ? `Prix vieux de ${ageDays} jour${ageDays > 1 ? "s" : ""}`
                          : "Prix ancien"}
                        {" "}({staleThresholdLabel}) : vérifiez-le auprès du fournisseur avant de le retenir.
                      </p>
                    ) : null}

                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                      {alternative.catalogue_url ? (
                        <a
                          href={alternative.catalogue_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline underline-offset-2"
                        >
                          Ouvrir la fiche fournisseur
                          <ExternalLinkIcon aria-hidden="true" className="size-3" />
                          <span className="sr-only">(nouvel onglet)</span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          URL catalogue indisponible
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={() => onSelectAlternative(alternative)}
                        disabled={
                          isReadOnly ||
                          retainedWithoutChange ||
                          Boolean(ineligibility)
                        }
                        aria-describedby={ineligibility ? ineligibilityId : undefined}
                      >
                        {retainedWithoutChange ? "Offre retenue" : alternative.is_selected ? "Actualiser cette offre" : "Retenir cette offre"}
                      </Button>
                    </div>
                  </article>
                );
              })
            : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
