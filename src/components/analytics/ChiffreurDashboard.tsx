"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useTransition, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FolderOpenIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { StatCard, StatGrid } from "@/components/layout/stat-card";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
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

function StatValue({ value, suffix }: { value: string; suffix?: string }) {
  return (
    <span className="break-words [overflow-wrap:anywhere]">
      {value}
      {suffix ? (
        <span className="ml-1 text-sm font-medium text-muted-foreground">{suffix}</span>
      ) : null}
    </span>
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
        `${point.label} : ${point.createdCount} créé${point.createdCount > 1 ? "s" : ""}, ${point.acceptedCount} accepté${point.acceptedCount > 1 ? "s" : ""}`,
    )
    .join(" ; ");

  return (
    <PageSection
      title="Tendance sur 6 mois"
      id="analytics-trend-title"
      actions={
        <div aria-hidden="true" className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm bg-brand-blue" />
            Créés
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm bg-success" />
            Acceptés
          </span>
        </div>
      }
    >
      <div
        className="flex h-40 items-end gap-1.5 sm:gap-3"
        role="img"
        aria-label={`Graphique de tendance sur 6 mois. ${accessibleSummary}`}
      >
        {trend.map((point) => (
          <div
            key={point.key}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <div className="flex h-32 w-full items-end gap-1">
              <div
                className="flex-1 rounded-t bg-brand-blue transition-all duration-300 motion-reduce:transition-none"
                style={{
                  height: `${(point.createdCount / maxCount) * 100}%`,
                  minHeight: point.createdCount > 0 ? 4 : 0,
                }}
              />
              <div
                className="flex-1 rounded-t bg-success transition-all duration-300 motion-reduce:transition-none"
                style={{
                  height: `${(point.acceptedCount / maxCount) * 100}%`,
                  minHeight: point.acceptedCount > 0 ? 4 : 0,
                }}
              />
            </div>
            <span className="block max-w-full truncate whitespace-nowrap text-micro text-muted-foreground">
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </PageSection>
  );
}

// ---------------------------------------------------------------------------
// Top Affaires Table
// ---------------------------------------------------------------------------

function TopAffairesTable({ items }: { items: AnalyticsTopAffaire[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpenIcon aria-hidden="true" />}
        headingLevel={2}
        title="Aucune affaire récente"
        description="Les affaires créées ou mises à jour apparaîtront ici."
      />
    );
  }

  const resolveTargetHref = (item: AnalyticsTopAffaire) =>
    item.hasCurrentVersion && item.currentVersionId
      ? item.currentStatus === "draft"
        ? `/dashboard/estimates/${item.currentVersionId}/edit`
        : `/dashboard/estimates/${item.currentVersionId}`
      : `/dashboard/affaires/${item.projectId}`;

  return (
    <PageSection title="Top 10 des affaires récentes" id="analytics-top-affaires-title" flush>
      <ul
        className="divide-y divide-border-subtle md:hidden"
        data-testid="analytics-top-affaires-mobile"
      >
        {items.map((item) => {
          const targetHref = resolveTargetHref(item);

          return (
            <li key={item.projectId}>
              <Link
                href={targetHref}
                className="block p-4 transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">
                      {item.projectName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.projectClient ??
                        item.projectReference ??
                        "Client non renseigné"}
                    </p>
                  </div>
                  {item.currentStatus ? (
                    <Badge
                      variant={STATUS_BADGE_VARIANT[item.currentStatus] ?? "neutral"}
                      size="sm"
                      className="shrink-0"
                    >
                      V{item.currentVersionNumber} –{" "}
                      {STATUS_LABEL[item.currentStatus] ?? item.currentStatus}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold tabular-nums text-foreground-secondary">
                    {item.currentTotalHtCents != null
                      ? formatEUR(item.currentTotalHtCents)
                      : "Montant non renseigné"}
                  </span>
                  <span className="text-muted-foreground">
                    Mis à jour le {formatDate(item.currentUpdatedAt)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <div
        role="region"
        aria-labelledby="analytics-top-affaires-title"
        tabIndex={0}
        className="relative hidden overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:block"
        data-testid="analytics-top-affaires-desktop"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle">
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Affaire
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Client
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Statut
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total HT
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                  className="border-b border-border-subtle transition-colors last:border-b-0 hover:bg-surface-subtle"
                >
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium text-foreground">
                    <Link
                      href={targetHref}
                      className="rounded-sm text-foreground hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {item.projectName}
                    </Link>
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-foreground-secondary">
                    {item.projectClient ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {item.currentStatus ? (
                      <Badge
                        variant={
                          STATUS_BADGE_VARIANT[item.currentStatus] ?? "neutral"
                        }
                        size="sm"
                      >
                        V{item.currentVersionNumber} –{" "}
                        {STATUS_LABEL[item.currentStatus] ?? item.currentStatus}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-foreground-secondary">
                    {item.currentTotalHtCents != null
                      ? formatEUR(item.currentTotalHtCents)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                    {formatDate(item.currentUpdatedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PageSection>
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
  const [isPending, startTransition] = useTransition();
  const currentOwner = searchParams.get("owner") ?? "all";

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      const params = new URLSearchParams(searchParams.toString());
      params.set("owner", value);
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <NativeSelect
      value={currentOwner}
      onChange={handleChange}
      size="sm"
      wrapperClassName="w-full sm:w-64"
      aria-label="Filtrer par chiffreur"
      aria-busy={isPending || undefined}
    >
      <option value="all">Tous les chiffreurs</option>
      {owners.map((o) => (
        <option key={o.ownerUserId} value={o.ownerUserId}>
          {o.ownerName} ({o.activeAffairesCount})
        </option>
      ))}
    </NativeSelect>
  );
}

function OwnerSelector({ owners }: { owners: AnalyticsOwnerOption[] }) {
  return (
    <Suspense fallback={<Skeleton className="h-9 w-full sm:w-64" />}>
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
    <div className="space-y-6">
      <PageHeader
        title="Performances"
        description={scopeLabel}
        actions={
          scope.isAdmin && owners.length > 0 ? <OwnerSelector owners={owners} /> : null
        }
      />

      <StatGrid label="Indicateurs clés">
        <StatCard
          label="Affaires actives"
          value={<StatValue value={String(kpis.activeAffaires)} />}
        />
        <StatCard
          label="CA accepté"
          value={<StatValue value={formatEUR(kpis.acceptedRevenueCents)} />}
        />
        <StatCard
          label="Taux d’acceptation"
          value={<StatValue value={String(kpis.acceptanceRate)} suffix="%" />}
        />
        <StatCard
          label="Délai avant 1re acceptation"
          value={
            <StatValue
              value={
                kpis.avgDaysToFirstAcceptance != null
                  ? String(kpis.avgDaysToFirstAcceptance)
                  : "—"
              }
              suffix={kpis.avgDaysToFirstAcceptance != null ? "jours" : undefined}
            />
          }
        />
      </StatGrid>

      <TrendChart trend={trend} />

      <TopAffairesTable items={topAffaires} />

      <p className="text-right text-xs text-muted-foreground">
        Mis à jour : {new Date(initialData.generatedAt).toLocaleString("fr-FR")}
      </p>
    </div>
  );
}
