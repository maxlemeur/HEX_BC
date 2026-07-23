"use client";

import { useMemo } from "react";

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-6xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-preselection-dialog-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="supplier-preselection-dialog-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              Présélection fournisseurs
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              TIMAX préremplit uniquement les cas simples. Les exceptions restent
              visibles pour arbitrage avant application.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isApplying}
          >
            Fermer
          </button>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        {summary ? (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-[var(--slate-200)] bg-white p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--slate-500)]">
                Propositions
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--slate-800)]">
                {summary.proposed_items}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-white p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--slate-500)]">
                Exceptions
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--slate-800)]">
                {summary.exception_items}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-white p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--slate-500)]">
                Déjà couverts
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--slate-800)]">
                {summary.already_selected_items}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-white p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--slate-500)]">
                Sélection
              </p>
              <p className="mt-1 text-2xl font-semibold text-[var(--slate-800)]">
                {selectedCount}/{proposals.length}
              </p>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="alert alert-info mt-4">Analyse fournisseurs en cours...</div>
        ) : null}

        {!isLoading && proposals.length === 0 && exceptions.length === 0 ? (
          <div className="alert alert-info mt-4">
            Aucune présélection exploitable pour cette version.
          </div>
        ) : null}

        {!isLoading && proposals.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                  Cas simples proposés
                </h3>
                <p className="text-xs text-[var(--slate-500)]">
                  Chaque ligne reste décochable avant application.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--slate-600)]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => onToggleAll(event.target.checked)}
                  disabled={isApplying}
                  aria-label="Sélectionner toutes les préselections fournisseurs"
                />
                Tout sélectionner
              </label>
            </div>
            <div className="table-scroll max-h-[280px]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-12">Sel.</th>
                    <th>Ligne</th>
                    <th>Actuel</th>
                    <th>Préselection</th>
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
                            checked={isSelected}
                            disabled={isApplying}
                            onChange={(event) =>
                              onToggleItem(proposal.item_id, event.target.checked)
                            }
                            aria-label={`Sélectionner ${proposal.item_title}`}
                          />
                        </td>
                        <td>
                          <p className="font-medium text-[var(--slate-800)]">
                            {proposal.item_title}
                          </p>
                        </td>
                        <td className="text-xs text-[var(--slate-600)]">
                          {proposal.current_alternative ? (
                            <div className="space-y-1">
                              <p>{proposal.current_alternative.supplier_name}</p>
                              <p>
                                {formatAlternativeLabel(
                                  proposal.current_alternative.adjusted_unit_price_cents
                                )}
                              </p>
                            </div>
                          ) : (
                            "Aucune sélection"
                          )}
                        </td>
                        <td className="text-xs text-[var(--slate-600)]">
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--slate-800)]">
                              {proposal.proposed_alternative.supplier_name}
                            </p>
                            <p>
                              {formatAlternativeLabel(
                                proposal.proposed_alternative.adjusted_unit_price_cents
                              )}
                            </p>
                            <p>{proposal.proposed_alternative.product_designation}</p>
                          </div>
                        </td>
                        <td className="text-xs text-[var(--slate-600)]">
                          {proposal.explanation}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!isLoading && exceptions.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Exceptions à arbitrer
            </h3>
            <div className="mt-3 grid gap-3">
              {exceptions.map((exception) => (
                <div
                  key={exception.item_id}
                  className="rounded-xl border border-[var(--slate-200)] bg-white p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--slate-800)]">
                      {exception.item_title}
                    </p>
                    <span className="rounded-full bg-[var(--slate-100)] px-2 py-1 text-xs font-medium text-[var(--slate-700)]">
                      {formatExceptionReason(exception.reason)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-3 text-xs text-[var(--slate-600)] md:grid-cols-2">
                    <div>
                      <p className="font-semibold text-[var(--slate-700)]">
                        Sélection actuelle
                      </p>
                      <p>
                        {exception.selected_alternative
                          ? `${exception.selected_alternative.supplier_name} · ${formatAlternativeLabel(exception.selected_alternative.adjusted_unit_price_cents)}`
                          : "Aucune sélection"}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--slate-700)]">
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
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isApplying}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isApplying || isLoading || selectedCount === 0}
          >
            {isApplying ? "Application..." : "Appliquer la sélection"}
          </button>
        </div>
      </div>
    </div>
  );
}
