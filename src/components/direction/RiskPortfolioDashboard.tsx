import Link from "next/link";
import { ChartColumnIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import type { DirectionPortfolioCard } from "@/lib/direction/server";
import { formatEUR } from "@/lib/money";

type Props = {
  cards: DirectionPortfolioCard[];
};

const APPROVAL_LABEL = {
  not_required: "Sans validation",
  required: "À valider",
  in_review: "En revue",
  approved: "Validée",
  changes_requested: "À reprendre",
} as const;

const APPROVAL_VARIANT = {
  not_required: "neutral",
  required: "warning",
  in_review: "info",
  approved: "success",
  changes_requested: "danger",
} as const;

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(value / 100).toFixed(1)} %`;
}

function formatCoverage(value: number | null) {
  if (value === null) {
    return "À vérifier";
  }

  return `${value} %`;
}

function formatTargetDate(value: string | null) {
  if (!value) {
    return "Sans échéance détectée";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

function riskBadge(score: number) {
  if (score >= 70) {
    return { label: "Critique", variant: "danger" as const };
  }

  if (score >= 40) {
    return { label: "Attention", variant: "warning" as const };
  }

  return { label: "Sous contrôle", variant: "info" as const };
}

export function RiskPortfolioDashboard({ cards }: Readonly<Props>) {
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumnIcon aria-hidden="true" />}
        headingLevel={2}
        title="Aucun dossier dans ce périmètre"
        description="Essayez un autre horizon ou un autre responsable pour recharger le portefeuille."
      />
    );
  }

  return (
    <section aria-labelledby="direction-portfolio-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="direction-portfolio-title" className="text-base font-semibold text-foreground">
            Portefeuille : marge, risque et complétude
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Chaque carte résume l’affaire, les points à surveiller et mène à son cockpit.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((card) => {
          const risk = riskBadge(card.riskScore);

          return (
            <Link
              key={card.projectId}
              href={`/dashboard/affaires/${card.projectId}`}
              className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words text-base font-semibold text-foreground">
                      {card.projectName}
                    </h3>
                    <Badge variant={risk.variant} size="sm">
                      {risk.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {card.clientName ?? "Client non précisé"}
                    {card.ownerName ? ` · ${card.ownerName}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant={APPROVAL_VARIANT[card.approvalStatus]} size="sm">
                    {APPROVAL_LABEL[card.approvalStatus]}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    Échéance {formatTargetDate(card.sendTargetAt)}
                  </Badge>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 2xl:grid-cols-4">
                {[
                  { label: "Montant HT", value: formatEUR(card.amountHtCents) },
                  { label: "Marge", value: formatPercent(card.marginBp) },
                  { label: "Couverture DPGF", value: formatCoverage(card.coveragePercent) },
                  { label: "Hypothèses", value: card.openHypothesesCount },
                ].map((metric) => (
                  <div key={metric.label} className="min-w-0 rounded-control bg-surface-subtle px-3 py-3">
                    <dt className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                      {metric.label}
                    </dt>
                    <dd className="mt-2 text-sm font-semibold tabular-nums text-foreground">
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="neutral">Score {card.riskScore}/100</Badge>
                <Badge variant="neutral">
                  {card.exceptionCount} exception{card.exceptionCount > 1 ? "s" : ""}
                </Badge>
                {card.lotLabels.slice(0, 2).map((label) => (
                  <Badge key={label} variant="outline" className="max-w-full truncate">
                    {label}
                  </Badge>
                ))}
              </div>

              {card.alerts.length > 0 ? (
                <div className="mt-4 rounded-control border border-border bg-surface-subtle p-3">
                  <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                    Alerte de synthèse
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {card.alerts[0]?.label}
                  </p>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    {card.alerts[0]?.reasons[0] ?? "Ouvrez le cockpit pour arbitrer le dossier."}
                  </p>
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
