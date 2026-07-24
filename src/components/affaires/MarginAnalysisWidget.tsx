"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import type { AffaireHubMarginAnalysisResult } from "@/lib/affaires/server";
import { formatEUR } from "@/lib/money";

/* ------------------------------------------------------------------ */
/*  Margin threshold helpers                                           */
/* ------------------------------------------------------------------ */

const MARGIN_THRESHOLDS = { good: 25, fair: 15 } as const;

function getMarginTier(percent: number): "good" | "fair" | "poor" {
  if (percent >= MARGIN_THRESHOLDS.good) return "good";
  if (percent >= MARGIN_THRESHOLDS.fair) return "fair";
  return "poor";
}

function getMarginBadgeVariant(tier: string): "success" | "warning" | "error" {
  return tier === "good" ? "success" : tier === "fair" ? "warning" : "error";
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
          <p className="text-xs text-[var(--slate-500)]">Marge globale</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={getMarginBadgeVariant(tier)} size="sm">
              {global.marginPercent.toFixed(1)}%
            </Badge>
          </div>
        </div>

        <div>
          <p className="text-xs text-[var(--slate-500)]">Montant marge</p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
            {formatEUR(global.marginEurCents)}
          </p>
        </div>

        <div>
          <p className="text-xs text-[var(--slate-500)]">Coeff. de marge</p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
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
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--slate-100)] pt-3 text-xs text-[var(--slate-500)]">
          {global.globalCoefficient !== 1 ? (
            <span>
              Coefficient global{" "}
              <span className="font-medium text-[var(--slate-700)] tabular-nums">
                x{global.globalCoefficient.toFixed(3)}
              </span>
            </span>
          ) : null}
          {global.discountCents > 0 ? (
            <span>
              Remise{" "}
              <span className="font-medium text-[var(--slate-700)] tabular-nums">
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
      <p className="text-sm text-[var(--slate-500)]">
        Aucune section disponible.
      </p>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">
        Ventilation par lot
      </h3>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--slate-200)] text-left text-xs text-[var(--slate-500)]">
              <th className="pb-2 pr-3 font-medium">Lot / Section</th>
              <th className="pb-2 pr-3 text-right font-medium">Cout</th>
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
                <tr key={section.sectionId} className="border-b border-[var(--slate-100)]">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/dashboard/estimates/${currentVersionId}/edit#section-${section.sectionId}`}
                      className="text-[var(--slate-800)] hover:text-[var(--brand-blue)] hover:underline"
                    >
                      {section.sectionTitle}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--slate-600)]">
                    {formatEUR(section.costCents)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--slate-600)]">
                    {formatEUR(section.saleCents)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--slate-600)]">
                    {formatEUR(section.marginEurCents)}
                  </td>
                  <td className="py-2 pr-1 text-right">
                    <Badge variant={getMarginBadgeVariant(tier)} size="sm">
                      {section.marginPercent.toFixed(1)}%
                    </Badge>
                  </td>
                  <td className="py-2 text-[var(--slate-400)]">
                    <Link
                      href={`/dashboard/estimates/${currentVersionId}/edit#section-${section.sectionId}`}
                      aria-label={`Ouvrir ${section.sectionTitle}`}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
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
              className="flex items-center justify-between rounded-lg border border-[var(--slate-200)] px-3 py-2.5 transition-colors hover:bg-[var(--slate-50)]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--slate-800)]">
                  {section.sectionTitle}
                </p>
                <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                  {formatEUR(section.costCents)} → {formatEUR(section.saleCents)}
                </p>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                <Badge variant={getMarginBadgeVariant(tier)} size="sm">
                  {section.marginPercent.toFixed(1)}%
                </Badge>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--slate-400)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
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
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">
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
  data: AffaireHubMarginAnalysisResult | null;
  errorMessage?: string;
}) {
  // Don't render an empty card — it wastes vertical space
  if (!data && !errorMessage) return null;

  return (
    <section className="dashboard-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--slate-800)]">
        Analyse de marge
      </h2>

      {errorMessage ? (
        <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage}
        </div>
      ) : !data ? null : (
        <div className="space-y-5">
          <MarginGlobalSummary global={data.global} />
          <MarginSectionTable
            sections={data.sections}
            currentVersionId={data.currentVersionId}
          />
          {data.versionEvolution.length > 1 && (
            <MarginVersionChart points={data.versionEvolution} />
          )}
        </div>
      )}
    </section>
  );
}
