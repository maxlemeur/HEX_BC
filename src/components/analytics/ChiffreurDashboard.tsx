"use client";

import Link from "next/link";
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
  sent: "Envoyé",
  accepted: "Accepté",
  archived: "Archivé",
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
    <div
      className={`dashboard-card min-w-0 p-4 animate-fade-in sm:p-5 ${staggerClass}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--slate-500)] sm:text-xs">
        {label}
      </p>
      <p className="mt-2 break-words text-xl font-bold leading-tight text-[var(--slate-900)] [overflow-wrap:anywhere] sm:text-2xl">
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
  const accessibleSummary = trend
    .map(
      (point) =>
        `${point.label}: ${point.createdCount} créé${point.createdCount > 1 ? "s" : ""}, ${point.acceptedCount} accepté${point.acceptedCount > 1 ? "s" : ""}`,
    )
    .join("; ");

  return (
    <div className="dashboard-card p-4 animate-fade-in stagger-5 sm:p-5">
      <h2 className="text-sm font-semibold text-[var(--slate-700)] mb-4">
        Tendance sur 6 mois
      </h2>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-[var(--slate-500)]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: "var(--brand-blue)" }}
          />
          Créés
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: "var(--success)" }}
          />
          Acceptés
        </span>
      </div>

      {/* Bar grid */}
      <div
        className="flex items-end gap-1.5 sm:gap-3"
        style={{ height: 160 }}
        role="img"
        aria-label={`Graphique de tendance sur 6 mois. ${accessibleSummary}`}
      >
        {trend.map((point) => (
          <div
            key={point.key}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
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
                title={`${point.label}: ${point.createdCount} créé(s)`}
              />
              <div
                className="flex-1 rounded-t transition-all duration-300"
                style={{
                  height: `${(point.acceptedCount / maxCount) * 100}%`,
                  background: "var(--success)",
                  minHeight: point.acceptedCount > 0 ? 4 : 0,
                }}
                title={`${point.label}: ${point.acceptedCount} accepté(s)`}
              />
            </div>
            <span
              className="block max-w-full truncate whitespace-nowrap text-[9px] text-[var(--slate-400)] sm:text-[10px]"
              title={point.label}
            >
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
  if (items.length === 0) {
    return (
      <div className="dashboard-card p-8 text-center animate-fade-in stagger-6">
        <p className="text-sm text-[var(--slate-500)]">
          Aucune affaire récente.
        </p>
      </div>
    );
  }

  const resolveTargetHref = (item: AnalyticsTopAffaire) =>
    item.hasCurrentVersion && item.currentVersionId
      ? item.currentStatus === "draft"
        ? `/dashboard/estimates/${item.currentVersionId}/edit`
        : `/dashboard/estimates/${item.currentVersionId}`
      : `/dashboard/affaires/${item.projectId}`;

  return (
    <div className="dashboard-card overflow-hidden animate-fade-in stagger-6">
      <div className="px-5 py-4 border-b border-[var(--slate-100)]">
        <h2 className="text-sm font-semibold text-[var(--slate-700)]">
          Top 10 affaires récentes
        </h2>
      </div>

      <div
        className="divide-y divide-[var(--slate-100)] md:hidden"
        data-testid="analytics-top-affaires-mobile"
      >
        {items.map((item) => {
          const targetHref = resolveTargetHref(item);

          return (
            <Link
              key={item.projectId}
              href={targetHref}
              className="block p-4 transition-colors hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand-blue)]"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--slate-900)]">
                    {item.projectName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--slate-500)]">
                    {item.projectClient ??
                      item.projectReference ??
                      "Client non renseigné"}
                  </p>
                </div>
                {item.currentStatus ? (
                  <Badge
                    variant={STATUS_BADGE_VARIANT[item.currentStatus] ?? "neutral"}
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                  >
                    V{item.currentVersionNumber} -{" "}
                    {STATUS_LABEL[item.currentStatus] ?? item.currentStatus}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--slate-700)]">
                  {item.currentTotalHtCents != null
                    ? formatEUR(item.currentTotalHtCents)
                    : "Montant non renseigné"}
                </span>
                <span className="text-[var(--slate-400)]">
                  Mis à jour le {formatDate(item.currentUpdatedAt)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <div
        className="hidden overflow-x-auto md:block"
        data-testid="analytics-top-affaires-desktop"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--slate-200)] bg-[var(--slate-50)]">
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Affaire
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
                Mise à jour
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const targetHref = resolveTargetHref(item);

              return (
                <tr
                  key={item.projectId}
                  className="border-b border-[var(--slate-100)] transition-colors hover:bg-[var(--slate-50)]"
                >
                  <td className="px-4 py-3 font-medium text-[var(--slate-900)] max-w-[200px] truncate">
                    <Link
                      href={targetHref}
                      className="rounded-sm text-[var(--slate-900)] hover:text-[var(--brand-blue)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]"
                    >
                      {item.projectName}
                    </Link>
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
      className="btn btn-secondary w-full min-w-0 max-w-full text-sm sm:w-auto"
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
        <div className="h-10 w-full animate-pulse rounded-lg bg-[var(--slate-200)]/50 sm:w-48" />
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
        "Mon activité";

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-description">{scopeLabel}</p>
        </div>
        {scope.isAdmin && owners.length > 0 ? (
          <OwnerSelector owners={owners} />
        ) : null}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <KpiCard
          label="Affaires actives"
          value={String(kpis.activeAffaires)}
          staggerClass="stagger-1"
        />
        <KpiCard
          label="CA accepté"
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
          label="Délai avant 1re acceptation"
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
        Mis à jour : {new Date(initialData.generatedAt).toLocaleString("fr-FR")}
      </p>
    </div>
  );
}
