"use client";

import { Suspense, useCallback, useEffect, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { formatEUR } from "@/lib/money";
import type {
  AnalyticsPayload,
  AnalyticsOwnerOption,
  AnalyticsTopAffaire,
  AnalyticsTrendPoint,
} from "@/lib/analytics/server";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE_VARIANT: Record<string, "neutral" | "info" | "success"> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  archived: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoye",
  accepted: "Accepte",
  archived: "Archive",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  suffix,
  staggerClass,
}: {
  label: string;
  value: string;
  suffix?: string;
  staggerClass: string;
}) {
  return (
    <div className={`dashboard-card p-5 animate-fade-in ${staggerClass}`}>
      <p className="text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-[var(--slate-900)]">
        {value}
        {suffix ? (
          <span className="ml-1 text-sm font-medium text-[var(--slate-400)]">
            {suffix}
          </span>
        ) : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend Chart (pure CSS vertical bars)
// ---------------------------------------------------------------------------

function TrendChart({ trend }: { trend: AnalyticsTrendPoint[] }) {
  const maxCount = Math.max(
    1,
    ...trend.flatMap((t) => [t.createdCount, t.acceptedCount]),
  );

  return (
    <div className="dashboard-card p-5 animate-fade-in stagger-5">
      <h2 className="text-sm font-semibold text-[var(--slate-700)] mb-4">
        Tendance 6 mois
      </h2>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-[var(--slate-500)]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: "var(--brand-blue)" }}
          />
          Creees
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: "var(--success)" }}
          />
          Acceptees
        </span>
      </div>

      {/* Bar grid */}
      <div
        className="flex items-end gap-3"
        style={{ height: 160 }}
        role="img"
        aria-label="Graphique tendance 6 mois"
      >
        {trend.map((point) => (
          <div
            key={point.key}
            className="flex-1 flex flex-col items-center gap-1"
          >
            <div
              className="flex items-end gap-1 w-full"
              style={{ height: 130 }}
            >
              <div
                className="flex-1 rounded-t transition-all duration-300"
                style={{
                  height: `${(point.createdCount / maxCount) * 100}%`,
                  background: "var(--brand-blue)",
                  minHeight: point.createdCount > 0 ? 4 : 0,
                }}
                title={`${point.label}: ${point.createdCount} creee(s)`}
              />
              <div
                className="flex-1 rounded-t transition-all duration-300"
                style={{
                  height: `${(point.acceptedCount / maxCount) * 100}%`,
                  background: "var(--success)",
                  minHeight: point.acceptedCount > 0 ? 4 : 0,
                }}
                title={`${point.label}: ${point.acceptedCount} acceptee(s)`}
              />
            </div>
            <span className="text-[10px] text-[var(--slate-400)] whitespace-nowrap">
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Affaires Table
// ---------------------------------------------------------------------------

function TopAffairesTable({ items }: { items: AnalyticsTopAffaire[] }) {
  const router = useRouter();

  if (items.length === 0) {
    return (
      <div className="dashboard-card p-8 text-center animate-fade-in stagger-6">
        <p className="text-sm text-[var(--slate-500)]">
          Aucune affaire recente.
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-card overflow-hidden animate-fade-in stagger-6">
      <div className="px-5 py-4 border-b border-[var(--slate-100)]">
        <h2 className="text-sm font-semibold text-[var(--slate-700)]">
          Top 10 affaires recentes
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--slate-200)] bg-[var(--slate-50)]">
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Nom affaire
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Client
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Statut
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Total HT
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Date MAJ
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const targetHref =
                item.hasCurrentVersion && item.currentVersionId
                  ? item.currentStatus === "draft"
                    ? `/dashboard/estimates/${item.currentVersionId}/edit`
                    : `/dashboard/estimates/${item.currentVersionId}`
                  : `/dashboard/affaires/${item.projectId}`;

              return (
                <tr
                  key={item.projectId}
                  className="border-b border-[var(--slate-100)] cursor-pointer hover:bg-[var(--slate-50)] transition-colors"
                  onClick={() => router.push(targetHref)}
                >
                  <td className="px-4 py-3 font-medium text-[var(--slate-900)] max-w-[200px] truncate">
                    {item.projectName}
                  </td>
                  <td className="px-4 py-3 text-[var(--slate-600)] max-w-[160px] truncate">
                    {item.projectClient ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    {item.currentStatus ? (
                      <Badge
                        variant={
                          STATUS_BADGE_VARIANT[item.currentStatus] ?? "neutral"
                        }
                        size="sm"
                      >
                        V{item.currentVersionNumber} -{" "}
                        {STATUS_LABEL[item.currentStatus] ?? item.currentStatus}
                      </Badge>
                    ) : (
                      <span className="text-xs text-[var(--slate-300)]">
                        {"\u2014"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-[var(--slate-700)] whitespace-nowrap">
                    {item.currentTotalHtCents != null
                      ? formatEUR(item.currentTotalHtCents)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--slate-400)] whitespace-nowrap">
                    {formatDate(item.currentUpdatedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owner Selector (admin only)
// ---------------------------------------------------------------------------

function OwnerSelectorInner({
  owners,
}: {
  owners: AnalyticsOwnerOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentOwner = searchParams.get("owner") ?? "all";

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      const params = new URLSearchParams(searchParams.toString());
      params.set("owner", value);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <select
      value={currentOwner}
      onChange={handleChange}
      className="btn btn-secondary text-sm"
      aria-label="Filtrer par chiffreur"
    >
      <option value="all">Tous les chiffreurs</option>
      {owners.map((o) => (
        <option key={o.ownerUserId} value={o.ownerUserId}>
          {o.ownerName} ({o.activeAffairesCount})
        </option>
      ))}
    </select>
  );
}

function OwnerSelector({ owners }: { owners: AnalyticsOwnerOption[] }) {
  return (
    <Suspense
      fallback={
        <div className="h-10 w-48 animate-pulse rounded-lg bg-[var(--slate-200)]/50" />
      }
    >
      <OwnerSelectorInner owners={owners} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

type Props = {
  initialData: AnalyticsPayload;
};

export function ChiffreurDashboard({ initialData }: Readonly<Props>) {
  const router = useRouter();
  const { scope, kpis, trend, topAffaires, owners } = initialData;

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 60_000);
    return () => clearInterval(interval);
  }, [router]);

  const scopeLabel =
    scope.mode === "all"
      ? "Tous les chiffreurs"
      : owners.find((o) => o.ownerUserId === scope.ownerUserId)?.ownerName ??
        "Mon activite";

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-description">{scopeLabel}</p>
        </div>
        {scope.isAdmin && owners.length > 0 ? (
          <OwnerSelector owners={owners} />
        ) : null}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Affaires actives"
          value={String(kpis.activeAffaires)}
          staggerClass="stagger-1"
        />
        <KpiCard
          label="CA accepte"
          value={formatEUR(kpis.acceptedRevenueCents)}
          staggerClass="stagger-2"
        />
        <KpiCard
          label="Taux d'acceptation"
          value={String(kpis.acceptanceRate)}
          suffix="%"
          staggerClass="stagger-3"
        />
        <KpiCard
          label="Delai moyen 1re acceptation"
          value={
            kpis.avgDaysToFirstAcceptance != null
              ? String(kpis.avgDaysToFirstAcceptance)
              : "\u2014"
          }
          suffix={kpis.avgDaysToFirstAcceptance != null ? "jours" : undefined}
          staggerClass="stagger-4"
        />
      </div>

      {/* Trend */}
      <div className="mt-6">
        <TrendChart trend={trend} />
      </div>

      {/* Top affaires */}
      <div className="mt-6">
        <TopAffairesTable items={topAffaires} />
      </div>

      {/* Generated at timestamp */}
      <p className="mt-4 text-xs text-[var(--slate-400)] text-right">
        Mis a jour : {new Date(initialData.generatedAt).toLocaleString("fr-FR")}
      </p>
    </div>
  );
}
