"use client";

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2Icon } from "lucide-react";

import {
  RiskAlertBanner,
} from "@/components/direction/RiskAlertBanner";
import {
  RiskPortfolioDashboard,
} from "@/components/direction/RiskPortfolioDashboard";
import {
  WeeklySendPriorityQueue,
} from "@/components/direction/WeeklySendPriorityQueue";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard, StatGrid } from "@/components/layout/stat-card";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { DirectionDashboardPageData } from "@/lib/direction/server";
import type {
  DirectionDashboardQuery,
  DirectionDashboardHorizon,
} from "@/lib/direction/schemas";
import { cn } from "@/lib/utils";

type Props = {
  data: DirectionDashboardPageData;
  initialQuery: DirectionDashboardQuery;
};

const HORIZON_OPTIONS: Array<{
  value: DirectionDashboardHorizon;
  label: string;
}> = [
  { value: "all", label: "Tout voir" },
  { value: "this_week", label: "Cette semaine" },
  { value: "this_month", label: "Ce mois" },
];

function normalizePageParam(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export function DirectionDashboardPage({ data, initialQuery }: Readonly<Props>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentQuery = useMemo<DirectionDashboardQuery>(
    () => ({
      ownerUserId: searchParams.get("owner") ?? initialQuery.ownerUserId,
      lot: searchParams.get("lot") ?? initialQuery.lot,
      horizon:
        (searchParams.get("horizon") as DirectionDashboardHorizon | null) ??
        initialQuery.horizon,
      onlyExceptions:
        searchParams.get("onlyExceptions") === "true" || initialQuery.onlyExceptions,
      page: normalizePageParam(
        searchParams.get("page"),
        initialQuery.page
      ),
    }),
    [initialQuery, searchParams]
  );

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value.length === 0) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }

      router.push(
        params.toString().length > 0 ? `${pathname}?${params.toString()}` : pathname
      );
    },
    [pathname, router, searchParams]
  );

  const summaryLabel = `${data.cards.length} dossier${data.cards.length > 1 ? "s" : ""} affiché${
    data.cards.length > 1 ? "s" : ""
  } sur ${data.pagination.totalCards}.`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cockpit direction"
        description="Priorisez les arbitrages, gardez une vue claire des affaires fragiles et renvoyez rapidement les dossiers à traiter."
      />

      {/*
        UX49 : pas de région live sur les indicateurs — ils ne sont plus relus à
        chaque changement de filtre. Seul le court résumé sous les filtres est annoncé.
      */}
      <StatGrid label="Synthèse du portefeuille" className="lg:grid-cols-3">
        <StatCard
          label="Portefeuille"
          value={data.summary.totalAffaires}
          hint={`affaire${data.summary.totalAffaires > 1 ? "s actives" : " active"}`}
        />
        <StatCard
          label="À surveiller"
          tone="danger"
          value={data.summary.criticalCount}
          hint={`dossier${data.summary.criticalCount > 1 ? "s critiques" : " critique"}`}
        />
        <StatCard
          label="Validation"
          tone="info"
          value={data.summary.validationPendingCount}
          hint={`arbitrage${data.summary.validationPendingCount > 1 ? "s" : ""} en attente`}
          className="col-span-2 lg:col-span-1"
        />
      </StatGrid>

      <section
        aria-labelledby="direction-filters-title"
        className="rounded-lg border border-border bg-surface p-4 shadow-card"
      >
        <h2 id="direction-filters-title" className="sr-only">
          Filtres
        </h2>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="direction-owner-filter" className="text-xs font-semibold text-foreground-secondary">
                Responsable
              </FieldLabel>
              <NativeSelect
                id="direction-owner-filter"
                size="sm"
                value={currentQuery.ownerUserId ?? ""}
                onChange={(event) =>
                  startTransition(() => {
                    updateParams({
                      owner: event.target.value || null,
                      page: null,
                    });
                  })
                }
              >
                <option value="">Tous les responsables</option>
                {data.ownerOptions.map((option) => (
                  <option key={option.userId} value={option.userId}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field className="gap-1.5">
              <FieldLabel htmlFor="direction-lot-filter" className="text-xs font-semibold text-foreground-secondary">
                Lot
              </FieldLabel>
              <NativeSelect
                id="direction-lot-filter"
                size="sm"
                value={currentQuery.lot ?? ""}
                onChange={(event) =>
                  startTransition(() => {
                    updateParams({
                      lot: event.target.value || null,
                      page: null,
                    });
                  })
                }
              >
                <option value="">Tous les lots</option>
                {data.lotOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <div role="group" aria-labelledby="direction-horizon-label" className="space-y-1.5">
              <span id="direction-horizon-label" className="block text-xs font-semibold text-foreground-secondary">
                Horizon
              </span>
              <div className="flex flex-wrap gap-2">
                {HORIZON_OPTIONS.map((option) => {
                  const isActive = currentQuery.horizon === option.value;
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={isActive ? "primary" : "outline"}
                      className="rounded-full shadow-none"
                      aria-pressed={isActive}
                      onClick={() =>
                        startTransition(() => {
                          updateParams({
                            horizon: option.value === "all" ? null : option.value,
                            page: null,
                          });
                        })
                      }
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground-secondary">
            <input
              type="checkbox"
              className="size-4 shrink-0 cursor-pointer rounded-sm border-border-strong accent-primary"
              checked={currentQuery.onlyExceptions}
              onChange={() =>
                startTransition(() => {
                  updateParams({
                    onlyExceptions: currentQuery.onlyExceptions ? null : "true",
                    page: null,
                  });
                })
              }
            />
            Montrer seulement les dossiers avec exceptions
          </label>
        </div>

        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {isPending ? (
            <>
              <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
              Mise à jour des filtres…
            </>
          ) : (
            summaryLabel
          )}
        </p>
      </section>

      <div
        aria-busy={isPending}
        className={cn(
          "space-y-6 transition-opacity duration-150 motion-reduce:transition-none",
          isPending && "opacity-60"
        )}
      >
        <RiskAlertBanner alerts={data.alerts} />

        <WeeklySendPriorityQueue
          items={data.weeklyQueue}
          ownerOptions={data.ownerOptions}
        />

        <RiskPortfolioDashboard cards={data.cards} />

        {data.pagination.totalPages > 1 ? (
          <nav
            aria-label="Pagination du portefeuille"
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-foreground-secondary">
              Page {data.pagination.page} sur {data.pagination.totalPages}
            </p>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isPending || !data.pagination.hasPreviousPage}
                onClick={() =>
                  startTransition(() => {
                    const previousPage = Math.max(1, data.pagination.page - 1);
                    updateParams({
                      page: previousPage > 1 ? String(previousPage) : null,
                    });
                  })
                }
              >
                Précédent
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isPending || !data.pagination.hasNextPage}
                onClick={() =>
                  startTransition(() => {
                    updateParams({
                      page: String(data.pagination.page + 1),
                    });
                  })
                }
              >
                Suivant
              </Button>
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
