import type { ReactNode } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DISCOUNT_PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 8,
});

const APPROVAL_MONEY_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const APPROVAL_STATUS_STYLES: Record<
  EstimateApprovalSummary["approvalStatus"],
  { label: string; variant: BadgeVariant }
> = {
  not_required: {
    label: "Non requise",
    variant: "neutral",
  },
  required: {
    label: "À valider",
    variant: "warning",
  },
  in_review: {
    label: "En revue",
    variant: "info",
  },
  approved: {
    label: "Approuvée",
    variant: "success",
  },
  changes_requested: {
    label: "Modifications demandées",
    variant: "danger",
  },
};

const DECISION_LABELS: Record<"missing" | "pending" | "approved" | "rejected", string> =
  {
    missing: "Aucune demande",
    pending: "En attente",
    approved: "Approuvée",
    rejected: "À reprendre",
  };

const DECISION_VARIANTS: Record<keyof typeof DECISION_LABELS, BadgeVariant> = {
  missing: "outline",
  pending: "info",
  approved: "success",
  rejected: "danger",
};

const UNAVAILABLE_SIGNAL_LABELS: Record<string, string> = {
  critical_exceptions_count: "Nombre d'exceptions critiques",
  missing_line_evidence_count: "Nombre de lignes sans justificatif",
  dpgf_coverage_bp: "Taux de couverture DPGF",
  takeoff_evidence_coverage_bp: "Taux de couverture des preuves métré",
  total_ht_cents: "Montant total HT",
  margin_bp: "Taux de marge",
  discount_bp: "Taux de remise",
};

const REVIEW_DECISION_LABELS: Record<
  "approved" | "approved_with_reservations" | "changes_requested",
  string
> = {
  approved: "Approuvée",
  approved_with_reservations: "Approuvée sous réserve",
  changes_requested: "Retour correction",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return DATE_TIME_FORMATTER.format(date);
}

function formatThresholdValue(reason: EstimateApprovalSummary["reasons"][number]) {
  if (reason.signalKey === "total_ht_cents") {
    return APPROVAL_MONEY_FORMATTER.format(reason.thresholdValue / 100);
  }

  if (reason.signalKey === "discount_bp") {
    return `${DISCOUNT_PERCENT_FORMATTER.format(reason.thresholdValue / 100)}%`;
  }

  if (
    reason.signalKey === "margin_bp" ||
    reason.signalKey === "dpgf_coverage_bp" ||
    reason.signalKey === "takeoff_evidence_coverage_bp"
  ) {
    return `${(reason.thresholdValue / 100).toFixed(1)}%`;
  }

  return String(reason.thresholdValue);
}

function formatActualValue(reason: EstimateApprovalSummary["reasons"][number]) {
  if (reason.actualValue === null) {
    return "Indisponible";
  }

  if (reason.signalKey === "total_ht_cents") {
    return APPROVAL_MONEY_FORMATTER.format(reason.actualValue / 100);
  }

  if (reason.signalKey === "discount_bp") {
    return `${DISCOUNT_PERCENT_FORMATTER.format(reason.actualValue / 100)}%`;
  }

  if (
    reason.signalKey === "margin_bp" ||
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
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Analyse du {formatDateTime(summary.evaluatedAt)}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {summary.latestDecision ? (
        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
          <p className="font-medium text-foreground">Dernier cycle</p>
          <p className="mt-1 text-xs text-foreground-secondary">
            {summary.latestDecision.cycleNumber
              ? `Cycle ${summary.latestDecision.cycleNumber}`
              : "Décision récente"}
            {" • "}
            {summary.latestDecision.decision
              ? REVIEW_DECISION_LABELS[summary.latestDecision.decision]
              : DECISION_LABELS[summary.latestDecision.status]}
            {" • "}
            {summary.latestDecision.decidedAt
              ? `décidé le ${formatDateTime(summary.latestDecision.decidedAt)}`
              : `ouvert le ${formatDateTime(summary.latestDecision.createdAt)}`}
            {summary.latestDecision.commentCount > 0
              ? ` • ${summary.latestDecision.commentCount} commentaire${summary.latestDecision.commentCount > 1 ? "s" : ""}`
              : ""}
          </p>
        </div>
      ) : null}

      {summary.reasons.length === 0 ? (
        <p className="mt-4 text-sm text-foreground-secondary">
          Aucun seuil d&apos;approbation n&apos;est actuellement déclenché sur cette
          version.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {summary.reasons.map((reason) => {
            const decisionKey =
              reason.approvalStatus === "pending" ||
              reason.approvalStatus === "approved" ||
              reason.approvalStatus === "rejected"
                ? reason.approvalStatus
                : "missing";

            return (
              <li
                key={`${reason.ruleId}-${reason.approvalId ?? "none"}`}
                className="rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">
                      {reason.label}
                    </p>
                    <p className="mt-1 break-words text-sm text-foreground-secondary">
                      {reason.message}
                    </p>
                  </div>
                  <Badge variant={DECISION_VARIANTS[decisionKey]} size="sm">
                    {DECISION_LABELS[decisionKey]}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Valeur constatée : {formatActualValue(reason)}
                  {reason.actualValue !== null && reason.thresholdValue !== undefined && (
                    <span className="ml-1">
                      (seuil : {formatThresholdValue(reason)})
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {summary.unavailableSignals.length > 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3 text-xs text-foreground-secondary">
          <p className="font-medium text-foreground">
            Signaux non encore disponibles
          </p>
          <p className="mt-1">
            Les indicateurs suivants ne peuvent pas encore être évalués :{" "}
            {summary.unavailableSignals
              .map((signal) => UNAVAILABLE_SIGNAL_LABELS[signal] ?? signal)
              .join(", ")}
            . Ils seront pris en compte dès que les données seront renseignées.
          </p>
        </div>
      ) : null}

      {children ? <div className="mt-4 border-t border-border pt-4">{children}</div> : null}
    </Card>
  );
}
