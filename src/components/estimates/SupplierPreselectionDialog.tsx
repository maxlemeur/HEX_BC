"use client";

import { useMemo } from "react";

import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EstimateSupplierPreselectionReview } from "@/lib/estimates/supplier-preselection";
import { formatCurrency } from "@/lib/money";

type SupplierPreselectionDialogProps = {
  isOpen: boolean;
  review: EstimateSupplierPreselectionReview | null;
  selectedItemIds: string[];
  isLoading: boolean;
  isApplying: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onToggleItem: (itemId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
};

function formatAlternativeLabel(unitPriceCents: number) {
  return formatCurrency(unitPriceCents, "EUR");
}

function formatExceptionReason(reason: string) {
  switch (reason) {
    case "divergence":
      return "Arbitrage requis";
    case "stale":
      return "Prix obsolète";
    case "ambiguous":
      return "Choix ambigu";
    case "no_price":
      return "Sans couverture";
    case "currency_mismatch":
      return "Devise différente";
    default:
      return reason;
  }
}

export function SupplierPreselectionDialog({
  isOpen,
  review,
  selectedItemIds,
  isLoading,
  isApplying,
  error,
  onClose,
  onConfirm,
  onToggleItem,
  onToggleAll,
}: SupplierPreselectionDialogProps) {
  const proposals = review?.proposals ?? [];
  const exceptions = review?.exceptions ?? [];
  const summary = review?.summary ?? null;
  const selectedIds = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedCount = selectedItemIds.length;
  const allSelected =
    proposals.length > 0 &&
    proposals.every((proposal) => selectedIds.has(proposal.item_id));

  const summaryTiles = summary
    ? [
        { label: "Propositions", value: String(summary.proposed_items) },
        { label: "Exceptions", value: String(summary.exception_items) },
        { label: "Déjà couverts", value: String(summary.already_selected_items) },
        { label: "Sélection", value: `${selectedCount}/${proposals.length}` },
      ]
    : [];

  return (
    <Dialog
      open={isOpen}
      disablePointerDismissal={isApplying}
      onOpenChange={(open) => {
        if (!open && !isApplying) onClose();
      }}
    >
      <DialogContent size="full" className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Présélection fournisseurs</DialogTitle>
          <DialogDescription>
            TIMAX préremplit uniquement les cas simples. Les exceptions restent
            visibles pour arbitrage avant application.
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="danger">{error}</Alert> : null}

        {summaryTiles.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {summaryTiles.map((tile) => (
              <div
                key={tile.label}
                className="rounded-lg border border-border bg-surface-subtle p-3"
              >
                <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {tile.label}
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                  {tile.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {isLoading ? (
          <LoadingState label="Analyse des fournisseurs en cours…" className="py-6" />
        ) : null}

        {!isLoading && proposals.length === 0 && exceptions.length === 0 ? (
          <Alert variant="info">
            Aucune présélection exploitable pour cette version.
          </Alert>
        ) : null}

        {!isLoading && proposals.length > 0 ? (
          <section aria-labelledby="supplier-preselection-proposals-title">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3
                  id="supplier-preselection-proposals-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Cas simples proposés
                </h3>
                <p className="text-xs text-muted-foreground">
                  Chaque ligne reste décochable avant application.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={allSelected}
                  onChange={(event) => onToggleAll(event.target.checked)}
                  disabled={isApplying}
                  aria-label="Sélectionner toutes les présélections fournisseurs"
                />
                Tout sélectionner
              </label>
            </div>
            <div
              className="table-scroll max-h-[280px] rounded-lg border border-border"
              role="region"
              aria-labelledby="supplier-preselection-proposals-title"
              tabIndex={0}
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-12">
                      <span aria-hidden="true">Sél.</span>
                      <span className="sr-only">Sélection</span>
                    </th>
                    <th>Ligne</th>
                    <th>Actuel</th>
                    <th>Présélection</th>
                    <th>Explication</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((proposal) => {
                    const isSelected = selectedIds.has(proposal.item_id);
                    return (
                      <tr key={proposal.item_id}>
                        <td>
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={isSelected}
                            disabled={isApplying}
                            onChange={(event) =>
                              onToggleItem(proposal.item_id, event.target.checked)
                            }
                            aria-label={`Sélectionner ${proposal.item_title}`}
                          />
                        </td>
                        <td>
                          <p className="font-medium text-foreground">
                            {proposal.item_title}
                          </p>
                        </td>
                        <td className="text-xs text-foreground-secondary">
                          {proposal.current_alternative ? (
                            <div className="space-y-1">
                              <p>{proposal.current_alternative.supplier_name}</p>
                              <p className="tabular-nums">
                                {formatAlternativeLabel(
                                  proposal.current_alternative.adjusted_unit_price_cents
                                )}
                              </p>
                            </div>
                          ) : (
                            "Aucune sélection"
                          )}
                        </td>
                        <td className="text-xs text-foreground-secondary">
                          <div className="space-y-1">
                            <p className="font-semibold text-foreground">
                              {proposal.proposed_alternative.supplier_name}
                            </p>
                            <p className="tabular-nums">
                              {formatAlternativeLabel(
                                proposal.proposed_alternative.adjusted_unit_price_cents
                              )}
                            </p>
                            <p>{proposal.proposed_alternative.product_designation}</p>
                          </div>
                        </td>
                        <td className="text-xs text-foreground-secondary">
                          {proposal.explanation}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {!isLoading && exceptions.length > 0 ? (
          <section aria-labelledby="supplier-preselection-exceptions-title">
            <h3
              id="supplier-preselection-exceptions-title"
              className="text-sm font-semibold text-foreground"
            >
              Exceptions à arbitrer
            </h3>
            <ul className="mt-3 grid gap-3">
              {exceptions.map((exception) => (
                <li
                  key={exception.item_id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {exception.item_title}
                    </p>
                    <Badge variant="warning" size="sm">
                      {formatExceptionReason(exception.reason)}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-3 text-xs text-foreground-secondary md:grid-cols-2">
                    <div>
                      <p className="font-semibold text-foreground">
                        Sélection actuelle
                      </p>
                      <p>
                        {exception.selected_alternative
                          ? `${exception.selected_alternative.supplier_name} · ${formatAlternativeLabel(exception.selected_alternative.adjusted_unit_price_cents)}`
                          : "Aucune sélection"}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">
                        Options visibles
                      </p>
                      <p>
                        {exception.alternatives.length > 0
                          ? exception.alternatives
                              .map(
                                (alternative) =>
                                  `${alternative.supplier_name} (${formatAlternativeLabel(alternative.adjusted_unit_price_cents)})`
                              )
                              .join(" · ")
                          : "Aucune option"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={isApplying}
          >
            Annuler
          </Button>
          <Button
            size="lg"
            onClick={onConfirm}
            disabled={isLoading || selectedCount === 0}
            loading={isApplying}
          >
            Appliquer la sélection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
