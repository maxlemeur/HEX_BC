import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DirectionPortfolioCard } from "@/lib/direction/server";
import { formatEUR } from "@/lib/money";

type Props = {
  cards: DirectionPortfolioCard[];
};

const APPROVAL_LABEL = {
  not_required: "Sans validation",
  required: "A valider",
  in_review: "En revue",
  approved: "Validee",
  changes_requested: "A reprendre",
} as const;

const APPROVAL_VARIANT = {
  not_required: "neutral",
  required: "warning",
  in_review: "info",
  approved: "success",
  changes_requested: "error",
} as const;

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(value / 100).toFixed(1)} %`;
}

function formatCoverage(value: number | null) {
  if (value === null) {
    return "A verifier";
  }

  return `${value} %`;
}

function formatTargetDate(value: string | null) {
  if (!value) {
    return "Sans echeance detectee";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

function riskBadge(score: number) {
  if (score >= 70) {
    return { label: "Critique", variant: "error" as const };
  }

  if (score >= 40) {
    return { label: "Attention", variant: "warning" as const };
  }

  return { label: "Sous controle", variant: "info" as const };
}

export function RiskPortfolioDashboard({ cards }: Readonly<Props>) {
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 19h16" />
            <path d="M6 17V9" />
            <path d="M12 17V5" />
            <path d="M18 17v-4" />
          </svg>
        }
        title="Aucun dossier dans ce perimetre"
        description="Essayez un autre horizon ou un autre responsable pour recharger le portefeuille."
      />
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--slate-900)]">
            Portefeuille marge, risque et completude
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Chaque carte donne un scan rapide, les points a surveiller et l&apos;entree vers le cockpit affaire.
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
              className="dashboard-card block p-5 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-blue)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-[var(--slate-900)]">
                      {card.projectName}
                    </h3>
                    <Badge variant={risk.variant} size="sm">
                      {risk.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-[var(--slate-500)]">
                    {card.clientName ?? "Client non precise"}
                    {card.ownerName ? ` · ${card.ownerName}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant={APPROVAL_VARIANT[card.approvalStatus]} size="sm">
                    {APPROVAL_LABEL[card.approvalStatus]}
                  </Badge>
                  <span className="rounded-full border border-[var(--slate-200)] px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                    Echeance {formatTargetDate(card.sendTargetAt)}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                <div className="rounded-2xl bg-[var(--slate-50)] px-3 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                    Montant HT
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--slate-900)]">
                    {formatEUR(card.amountHtCents)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--slate-50)] px-3 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                    Marge
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--slate-900)]">
                    {formatPercent(card.marginBp)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--slate-50)] px-3 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                    Couverture DPGF
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--slate-900)]">
                    {formatCoverage(card.coveragePercent)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--slate-50)] px-3 py-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                    Hypotheses
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--slate-900)]">
                    {card.openHypothesesCount}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--slate-600)]">
                <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 font-medium">
                  Score {card.riskScore}/100
                </span>
                <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 font-medium">
                  {card.exceptionCount} exception{card.exceptionCount > 1 ? "s" : ""}
                </span>
                {card.lotLabels.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-[var(--slate-200)] px-2.5 py-1 text-xs font-medium"
                  >
                    {label}
                  </span>
                ))}
              </div>

              {card.alerts.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-[var(--slate-200)] bg-white/80 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--slate-400)]">
                    Alerte synthetique
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--slate-900)]">
                    {card.alerts[0]?.label}
                  </p>
                  <p className="mt-1 text-sm text-[var(--slate-600)]">
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
