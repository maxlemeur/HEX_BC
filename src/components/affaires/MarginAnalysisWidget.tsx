"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { AffaireHubMarginAnalysisResult, AffaireHubMarginCardData } from "@/lib/affaires/server";
import { formatEUR } from "@/lib/money";
import { ChevronRightIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Margin threshold helpers                                           */
/* ------------------------------------------------------------------ */

const MARGIN_THRESHOLDS = { good: 25, fair: 15 } as const;

function getMarginTier(percent: number): "good" | "fair" | "poor" {
  if (percent >= MARGIN_THRESHOLDS.good) return "good";
  if (percent >= MARGIN_THRESHOLDS.fair) return "fair";
  return "poor";
}

function getMarginBadgeVariant(tier: string): "success" | "warning" | "danger" {
  return tier === "good" ? "success" : tier === "fair" ? "warning" : "danger";
}

/* ------------------------------------------------------------------ */
/*  MarginGlobalSummary — 3 KPIs in a grid                             */
/* ------------------------------------------------------------------ */

function MarginGlobalSummary({
  global,
}: {
  global: NonNullable<AffaireHubMarginAnalysisResult>["global"];
}) {
  const tier = getMarginTier(global.marginPercent);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Marge globale</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={getMarginBadgeVariant(tier)}>
              {global.marginPercent.toFixed(1)}%
            </Badge>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Montant marge</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {formatEUR(global.marginEurCents)}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Coeff. de marge</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            x{global.marginMultiplier.toFixed(3)}
          </p>
        </div>
      </div>

      {/*
        EST-E26 (T6, étape 11) : coefficient global et remise affichés à part.
        Ils étaient jusqu'ici pliés dans le multiplicateur de marge, ce qui les
        faisait lire comme de la marge. La « Vente HT » ci-dessous les inclut
        (elle est nette, donc égale au total du devis).
      */}
      {global.globalCoefficient !== 1 || global.discountCents > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border-subtle pt-3 text-xs text-muted-foreground">
          {global.globalCoefficient !== 1 ? (
            <span>
              Coefficient global{" "}
              <span className="font-medium text-foreground-secondary tabular-nums">
                x{global.globalCoefficient.toFixed(3)}
              </span>
            </span>
          ) : null}
          {global.discountCents > 0 ? (
            <span>
              Remise{" "}
              <span className="font-medium text-foreground-secondary tabular-nums">
                -{formatEUR(global.discountCents)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MarginSectionTable — breakdown by lot                              */
/* ------------------------------------------------------------------ */

function MarginSectionTable({
  sections,
  currentVersionId,
}: {
  sections: NonNullable<AffaireHubMarginAnalysisResult>["sections"];
  currentVersionId: string;
}) {
  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune section disponible.
      </p>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Ventilation par lot
      </h3>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Lot / Section</th>
              <th className="pb-2 pr-3 text-right font-medium">Coût</th>
              <th className="pb-2 pr-3 text-right font-medium">Vente HT</th>
              <th className="pb-2 pr-3 text-right font-medium">Marge EUR</th>
              <th className="pb-2 pr-1 text-right font-medium">Marge %</th>
              <th className="w-6 pb-2" />
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const tier = getMarginTier(section.marginPercent);
              return (
                <tr key={section.sectionId} className="border-b border-border-subtle">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/dashboard/estimates/${currentVersionId}/edit#section-${section.sectionId}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {section.sectionTitle}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatEUR(section.costCents)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatEUR(section.saleCents)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {formatEUR(section.marginEurCents)}
                  </td>
                  <td className="py-2 pr-1 text-right">
                    <Badge variant={getMarginBadgeVariant(tier)}>
                      {section.marginPercent.toFixed(1)}%
                    </Badge>
                  </td>
                  <td className="py-2 text-subtle-foreground">
                    <Link
                      href={`/dashboard/estimates/${currentVersionId}/edit#section-${section.sectionId}`}
                      aria-label={`Ouvrir ${section.sectionTitle}`}
                    >
                      <ChevronRightIcon aria-hidden="true" size={14} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {sections.map((section) => {
          const tier = getMarginTier(section.marginPercent);
          return (
            <Link
              key={section.sectionId}
              href={`/dashboard/estimates/${currentVersionId}/edit#section-${section.sectionId}`}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-subtle"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {section.sectionTitle}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatEUR(section.costCents)} → {formatEUR(section.saleCents)}
                </p>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                <Badge variant={getMarginBadgeVariant(tier)}>
                  {section.marginPercent.toFixed(1)}%
                </Badge>
                <ChevronRightIcon aria-hidden="true" stroke="var(--slate-400)" size={14} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MarginVersionChart — SVG evolution chart                            */
/* ------------------------------------------------------------------ */

function MarginVersionChart({
  points,
}: {
  points: NonNullable<AffaireHubMarginAnalysisResult>["versionEvolution"];
}) {
  const W = 480;
  const H = 160;
  const PAD_X = 40;
  const PAD_TOP = 24;
  const PAD_BOTTOM = 28;

  const margins = points.map((p) => p.marginPercent);
  const minMargin = Math.min(...margins, 0);
  const maxMargin = Math.max(...margins, 30);
  const rangeMargin = maxMargin - minMargin || 1;

  const chartW = W - PAD_X * 2;
  const chartH = H - PAD_TOP - PAD_BOTTOM;

  function toX(index: number) {
    return PAD_X + (points.length <= 1 ? chartW / 2 : (index / (points.length - 1)) * chartW);
  }

  function toY(percent: number) {
    return PAD_TOP + chartH - ((percent - minMargin) / rangeMargin) * chartH;
  }

  const polylinePoints = points
    .map((p, i) => `${toX(i)},${toY(p.marginPercent)}`)
    .join(" ");

  const TIER_COLORS = {
    good: "var(--success)",
    fair: "var(--warning)",
    poor: "var(--danger)",
  } as const;

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Evolution de la marge
      </h3>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Graphique d'evolution de la marge par version"
      >
        {/* Threshold lines */}
        {[MARGIN_THRESHOLDS.fair, MARGIN_THRESHOLDS.good].map((threshold) => {
          const y = toY(threshold);
          if (y < PAD_TOP || y > H - PAD_BOTTOM) return null;
          return (
            <line
              key={threshold}
              x1={PAD_X}
              y1={y}
              x2={W - PAD_X}
              y2={y}
              stroke="var(--slate-300)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
          );
        })}

        {/* Main polyline */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="var(--brand-blue)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Points + labels */}
        {points.map((p, i) => {
          const x = toX(i);
          const y = toY(p.marginPercent);
          const tier = getMarginTier(p.marginPercent);

          return (
            <g key={p.versionId}>
              <circle cx={x} cy={y} r="4" fill={TIER_COLORS[tier]} />
              {/* Margin % above point */}
              <text
                x={x}
                y={y - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--slate-600)"
              >
                {p.marginPercent.toFixed(1)}%
              </text>
              {/* Version label below */}
              <text
                x={x}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                fill="var(--slate-500)"
              >
                V{p.versionNumber}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MarginAnalysisWidget — main exported component                     */
/* ------------------------------------------------------------------ */

export function MarginAnalysisWidget({
  data,
  errorMessage,
}: {
  data: AffaireHubMarginCardData;
  errorMessage?: string;
}) {
  // Don't render an empty card — it wastes vertical space
  if (!data && !errorMessage) return null;
  // Sous-lot 2.10a (revue Codex de la PR #57) : sans analyse calculable (v3 vierge), l'avis v3 reste seul.
  const analysis = data && "global" in data ? data : null;
  const unavailableV3 = data?.versionEvolutionUnavailableV3 ?? [];

  return (
    <section className="rounded-lg border border-border bg-surface shadow-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-foreground">
        Analyse de marge
      </h2>

      {errorMessage ? (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-sm text-foreground-secondary">
          {errorMessage}
        </div>
      ) : !data ? null : (
        <div className="space-y-5">
          {analysis && (
            <>
              <MarginGlobalSummary global={analysis.global} />
              <MarginSectionTable
                sections={analysis.sections}
                currentVersionId={analysis.currentVersionId}
              />
              {analysis.versionEvolution.length > 1 && (
                <MarginVersionChart points={analysis.versionEvolution} />
              )}
            </>
          )}
          {/* Sous-lot 2.10a (A16, D-d) : une v3 est nommée, jamais retirée sans le dire. */}
          {unavailableV3.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="margin-evolution-v3-notice">
              Évolution de la marge indisponible pour le moteur de calcul 3 :{" "}
              {unavailableV3.map((versionNumber) => `V${versionNumber}`).join(", ")}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
