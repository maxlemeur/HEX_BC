"use client";

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  RiskAlertBanner,
} from "@/components/direction/RiskAlertBanner";
import {
  RiskPortfolioDashboard,
} from "@/components/direction/RiskPortfolioDashboard";
import {
  WeeklySendPriorityQueue,
} from "@/components/direction/WeeklySendPriorityQueue";
import type { DirectionDashboardPageData } from "@/lib/direction/server";
import type {
  DirectionDashboardQuery,
  DirectionDashboardHorizon,
} from "@/lib/direction/schemas";

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

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="page-title">Cockpit direction</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--slate-500)]">
              Priorisez les arbitrages, gardez une vue claire des affaires
              fragiles et renvoyez rapidement les dossiers a traiter.
            </p>
          </div>

          <div
            className="grid gap-3 sm:grid-cols-3"
            aria-live="polite"
            aria-atomic="true"
          >
            <article className="dashboard-card min-w-[170px] p-4">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                Portefeuille
              </p>
              <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">
                {data.summary.totalAffaires}
              </p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                affaire{data.summary.totalAffaires > 1 ? "s" : ""} active
                {data.summary.totalAffaires > 1 ? "s" : ""}
              </p>
            </article>

            <article className="dashboard-card min-w-[170px] p-4">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                A surveiller
              </p>
              <p className="mt-2 text-2xl font-semibold text-[var(--danger)]">
                {data.summary.criticalCount}
              </p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                dossier{data.summary.criticalCount > 1 ? "s" : ""} critique
                {data.summary.criticalCount > 1 ? "s" : ""}
              </p>
            </article>

            <article className="dashboard-card min-w-[170px] p-4">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-400)]">
                Validation
              </p>
              <p className="mt-2 text-2xl font-semibold text-[var(--brand-blue)]">
                {data.summary.validationPendingCount}
              </p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                arbitrage{data.summary.validationPendingCount > 1 ? "s" : ""} en
                attente
              </p>
            </article>
          </div>
        </div>
      </header>

      <section className="dashboard-card p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold text-[var(--slate-700)]">
                Responsable
              </span>
              <select
                className="form-input form-select form-input--sm min-w-[220px]"
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
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="block text-xs font-semibold text-[var(--slate-700)]">
                Lot
              </span>
              <select
                className="form-input form-select form-input--sm min-w-[220px]"
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
              </select>
            </label>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-[var(--slate-700)]">
                Horizon
              </span>
              <div className="flex flex-wrap gap-2">
                {HORIZON_OPTIONS.map((option) => {
                  const isActive = currentQuery.horizon === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                        isActive
                          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)] text-white"
                          : "border-[var(--slate-200)] bg-white text-[var(--slate-600)] hover:border-[var(--slate-300)] hover:bg-[var(--slate-50)]"
                      }`}
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
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-600)]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--slate-300)] text-[var(--brand-blue)] focus:ring-[var(--brand-blue)]"
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

        <p className="mt-3 text-xs text-[var(--slate-400)]" aria-live="polite">
          {isPending
            ? "Mise a jour des filtres..."
            : `${data.cards.length} dossier(s) sur ${data.pagination.totalCards} affiches.`}
        </p>
      </section>

      <RiskAlertBanner alerts={data.alerts} />

      <WeeklySendPriorityQueue
        items={data.weeklyQueue}
        ownerOptions={data.ownerOptions}
      />

      <RiskPortfolioDashboard cards={data.cards} />

      {data.pagination.totalPages > 1 ? (
        <section className="dashboard-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--slate-600)]">
            Page {data.pagination.page} sur {data.pagination.totalPages}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
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
              Precedent
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
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
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
