import type { ReactNode } from "react";

import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const APPROVAL_STATUS_STYLES: Record<
  EstimateApprovalSummary["approvalStatus"],
  { label: string; className: string }
> = {
  not_required: {
    label: "Non requise",
    className: "bg-[var(--slate-100)] text-[var(--slate-700)]",
  },
  required: {
    label: "A valider",
    className: "bg-[var(--warning-light)] text-[var(--warning)]",
  },
  in_review: {
    label: "En revue",
    className: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  },
  approved: {
    label: "Approuvee",
    className: "bg-[var(--success)]/10 text-[var(--success)]",
  },
  changes_requested: {
    label: "Modifications demandees",
    className: "bg-[var(--danger)]/10 text-[var(--danger)]",
  },
};

const DECISION_LABELS: Record<"missing" | "pending" | "approved" | "rejected", string> =
  {
    missing: "Aucune demande",
    pending: "En attente",
    approved: "Approuvee",
    rejected: "A reprendre",
  };

const UNAVAILABLE_SIGNAL_LABELS: Record<string, string> = {
  critical_exceptions_count: "Exceptions critiques",
  missing_line_evidence_count: "Lignes sans preuve",
  dpgf_coverage_bp: "Couverture DPGF",
  takeoff_evidence_coverage_bp: "Couverture preuves takeoff",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return DATE_TIME_FORMATTER.format(date);
}

function formatActualValue(reason: EstimateApprovalSummary["reasons"][number]) {
  if (reason.actualValue === null) {
    return "Indisponible";
  }

  if (reason.signalKey === "total_ht_cents") {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(reason.actualValue / 100);
  }

  if (
    reason.signalKey === "margin_bp" ||
    reason.signalKey === "discount_bp" ||
    reason.signalKey === "dpgf_coverage_bp" ||
    reason.signalKey === "takeoff_evidence_coverage_bp"
  ) {
    return `${(reason.actualValue / 100).toFixed(1)}%`;
  }

  return String(reason.actualValue);
}

export function EstimateApprovalSummaryCard({
  summary,
  title = "Approbation",
  children,
}: Readonly<{
  summary: EstimateApprovalSummary;
  title?: string;
  children?: ReactNode;
}>) {
  const status = APPROVAL_STATUS_STYLES[summary.approvalStatus];

  return (
    <section className="dashboard-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">{title}</h2>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Analyse du {formatDateTime(summary.evaluatedAt)}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      {summary.reasons.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--slate-600)]">
          Aucun seuil d&apos;approbation n&apos;est actuellement declenche sur cette
          version.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {summary.reasons.map((reason) => {
            const decisionKey =
              reason.approvalStatus === "pending" ||
              reason.approvalStatus === "approved" ||
              reason.approvalStatus === "rejected"
                ? reason.approvalStatus
                : "missing";

            return (
              <article
                key={`${reason.ruleId}-${reason.approvalId ?? "none"}`}
                className="rounded-xl border border-[var(--slate-200)] bg-white/80 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {reason.label}
                    </p>
                    <p className="mt-1 text-sm text-[var(--slate-600)]">
                      {reason.message}
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--slate-600)]">
                    {DECISION_LABELS[decisionKey]}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--slate-500)]">
                  Valeur observee: {formatActualValue(reason)}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {summary.unavailableSignals.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3 text-xs text-[var(--slate-600)]">
          Signaux indisponibles:{" "}
          {summary.unavailableSignals
            .map((signal) => UNAVAILABLE_SIGNAL_LABELS[signal] ?? signal)
            .join(", ")}
        </div>
      ) : null}

      {children ? <div className="mt-4 border-t border-[var(--slate-200)] pt-4">{children}</div> : null}
    </section>
  );
}
