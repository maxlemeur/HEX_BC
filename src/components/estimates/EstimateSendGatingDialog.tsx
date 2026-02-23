"use client";

import type { EstimateSendGatingFlag } from "@/lib/estimates/client";

type EstimateSendGatingDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  phaseLabel: string | null;
  blockingFlags: EstimateSendGatingFlag[];
  warningFlags: EstimateSendGatingFlag[];
  canForce: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onForceConfirm: () => void;
};

function renderFlagDetails(flag: EstimateSendGatingFlag) {
  const detailsLines: string[] = [];
  const details = flag.details ?? {};
  const stalePriceDays = details.stale_price_days;
  const marginMode = details.margin_mode;
  const marginTiersCount = details.margin_tiers_count;
  const totalHtCents = details.total_ht_cents;
  const budgetCeilingHtCents = details.budget_ceiling_ht_cents;
  const ruleViolations = Array.isArray(details.violations)
    ? details.violations
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const message = record.message;
          if (typeof message === "string" && message.trim().length > 0) {
            return message.trim();
          }
          return null;
        })
        .filter((entry): entry is string => entry !== null)
    : [];

  if (typeof stalePriceDays === "number") {
    detailsLines.push(`Seuil d'obsolescence: ${stalePriceDays} jour(s).`);
  }
  if (typeof marginMode === "string") {
    detailsLines.push(`Mode de marge: ${marginMode}.`);
  }
  if (typeof marginTiersCount === "number") {
    detailsLines.push(`Tranches configurees: ${marginTiersCount}.`);
  }
  if (typeof totalHtCents === "number") {
    detailsLines.push(`Total HT courant: ${totalHtCents} cents.`);
  }
  if (typeof budgetCeilingHtCents === "number") {
    detailsLines.push(`Plafond budget HT: ${budgetCeilingHtCents} cents.`);
  }
  if (ruleViolations.length > 0) {
    ruleViolations.slice(0, 3).forEach((message) => {
      detailsLines.push(`Regle: ${message}`);
    });
    if (ruleViolations.length > 3) {
      detailsLines.push(`...${ruleViolations.length - 3} regle(s) supplementaire(s).`);
    }
  }
  if (flag.itemIds.length > 0) {
    const preview = flag.itemIds.slice(0, 5).join(", ");
    detailsLines.push(
      flag.itemIds.length > 5
        ? `Lignes impactees (extrait): ${preview}...`
        : `Lignes impactees: ${preview}`
    );
  }

  if (detailsLines.length === 0) return null;

  return (
    <ul className="mt-1 list-disc pl-4 text-xs text-[var(--slate-600)]">
      {detailsLines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function renderFlags(flags: EstimateSendGatingFlag[]) {
  if (flags.length === 0) {
    return (
      <p className="text-sm text-[var(--slate-500)]">
        Aucun element.
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {flags.map((flag) => (
        <li
          key={`${flag.key}-${flag.severity}`}
          className="rounded-lg border border-[var(--slate-200)] bg-[var(--surface-subtle)] px-3 py-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-[var(--slate-800)]">
              {flag.label}
            </span>
            <span className="text-xs text-[var(--slate-500)]">
              {flag.count} occurrence(s)
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            {flag.description}
          </p>
          {renderFlagDetails(flag)}
        </li>
      ))}
    </ul>
  );
}

export function EstimateSendGatingDialog({
  isOpen,
  isSubmitting,
  phaseLabel,
  blockingFlags,
  warningFlags,
  canForce,
  onClose,
  onConfirm,
  onForceConfirm,
}: Readonly<EstimateSendGatingDialogProps>) {
  if (!isOpen) return null;

  const hasBlocking = blockingFlags.length > 0;
  const canConfirmWithoutForce = !hasBlocking;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-2xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-send-gating-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="estimate-send-gating-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              Verification avant envoi
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Controlez les anomalies detectees avant de passer la version en statut envoye.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Fermer
          </button>
        </div>

        {phaseLabel ? (
          <div className="alert alert-info mb-4 flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--brand-blue)]" />
            <span>{phaseLabel}</span>
          </div>
        ) : null}

        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--danger)]">
              Bloquants ({blockingFlags.length})
            </h3>
            {renderFlags(blockingFlags)}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--warning)]">
              Avertissements ({warningFlags.length})
            </h3>
            {renderFlags(warningFlags)}
          </section>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isSubmitting || !canConfirmWithoutForce}
          >
            Envoyer
          </button>
          {hasBlocking && canForce ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={onForceConfirm}
                disabled={isSubmitting}
              >
                Forcer l&apos;envoi
              </button>
            ) : null}
        </div>
      </div>
    </div>
  );
}
