"use client";

import { useState } from "react";
import useSWR from "swr";

import {
  MetricCard,
  PilotDecisionCard,
  PilotStatusBadge,
  ReliabilityCards,
} from "@/components/takeoff/metrics/TakeoffMetricsDashboardCards";
import {
  JobTrendChart,
  TokenBreakdownBar,
} from "@/components/takeoff/metrics/TakeoffMetricsDashboardCharts";
import {
  LevelSelector,
  PeriodSelector,
} from "@/components/takeoff/metrics/TakeoffMetricsDashboardControls";
import {
  CorrectionByLevelTable,
  CorrectionEventsTable,
  CostByLevelTable,
  ErrorsTable,
  PilotWeeklyTable,
  RecentJobsTable,
} from "@/components/takeoff/metrics/TakeoffMetricsDashboardTables";
import {
  formatConfidence,
  formatCostCents,
  formatDecimal,
  formatDurationMs,
  formatGeneratedAt,
  formatNumber,
  formatPercent,
} from "@/components/takeoff/metrics/takeoff-metrics-formatters";
import type {
  TakeoffLevel,
  TakeoffMetricsPeriod,
} from "@/lib/takeoff/types";
import {
  TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE,
  TAKEOFF_HIGH_SCORE_THRESHOLD,
  type TakeoffMetricsPilotStatsPayload,
} from "@/lib/takeoff/pilot-metrics";

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
};

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const json = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !json.ok) {
    throw new Error(json.error?.message ?? "Erreur lors du chargement.");
  }
  return json.data as T;
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="dashboard-card p-6 text-center text-sm text-[var(--danger)]">
        {message}
      </div>
    </div>
  );
}

export function TakeoffMetricsDashboard({ tenantId }: { tenantId: string }) {
  const [period, setPeriod] = useState<TakeoffMetricsPeriod>("30d");
  const [level, setLevel] = useState<"all" | TakeoffLevel>("all");
  const levelFilterSuffix = level === "all" ? "" : `&level=${level}`;

  const { data, error, isLoading } = useSWR<TakeoffMetricsPilotStatsPayload>(
    `/api/takeoff/stats?period=${period}${levelFilterSuffix}&t=${tenantId}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  );

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !data) {
    return <ErrorState message={error?.message ?? "Impossible de charger les metriques."} />;
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6">
      <section className="dashboard-card p-6 animate-slide-in stagger-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-[var(--slate-800)]">
              Métriques takeoff
            </h1>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Observabilité des extractions, des coûts, des corrections humaines et du pilote client.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodSelector value={period} onChange={setPeriod} />
            <LevelSelector value={level} onChange={setLevel} />
            <p className="text-xs text-[var(--slate-500)]">
              {formatGeneratedAt(data.generatedAt)}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.3fr] animate-slide-in stagger-2">
        <div className="dashboard-card min-w-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--slate-700)]">
                Pilote client
              </h2>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                État du pilote et définition partagée des signaux de décision.
              </p>
            </div>
            <PilotStatusBadge killSwitchEnabled={data.pilot.killSwitchEnabled} />
          </div>

          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                Interrupteur de sécurité
              </dt>
              <dd className="mt-1 font-mono text-[var(--slate-700)]">
                {data.pilot.killSwitchFlagKey}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
                Proxy de satisfaction
              </dt>
              <dd className="mt-1 text-[var(--slate-700)]">
                {data.pilot.satisfactionLabel}
              </dd>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                {data.pilot.satisfactionDefinition}
              </p>
            </div>
          </dl>
        </div>

        <PilotDecisionCard data={data.pilot.goNoGo} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6 animate-slide-in stagger-2">
        <MetricCard
          label="Total extractions"
          value={String(data.kpis.totalJobs)}
          hint={`${data.kpis.completedJobs} complètes, ${data.kpis.failedJobs} échouées`}
        />
        <MetricCard
          label="Taux de succès"
          value={`${formatPercent(data.kpis.successRate)} %`}
          hint={`${data.kpis.completedJobs} / ${data.kpis.completedJobs + data.kpis.failedJobs + data.kpis.canceledJobs} terminaux`}
          variant={
            data.kpis.successRate >= 90
              ? "success"
              : data.kpis.successRate >= 70
                ? "warning"
                : "danger"
          }
        />
        <MetricCard
          label="Durée moyenne"
          value={formatDurationMs(data.kpis.avgDurationMs)}
          hint="Extractions complètes uniquement"
        />
        <MetricCard
          label="Coût total"
          value={formatCostCents(data.kpis.totalCostCents)}
          hint={`Moy. ${formatCostCents(data.kpis.avgCostCentsPerJob)} / extraction`}
        />
        <MetricCard
          label="Score automatique moyen"
          value={formatConfidence(data.kpis.avgConfidence)}
          hint="Signal automatique, pas une preuve de justesse"
        />
        <MetricCard
          label="Lignes / extraction"
          value={formatDecimal(data.kpis.avgItemsPerJob)}
          hint="Moyenne sur la période"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6 animate-slide-in stagger-2">
        <MetricCard
          label="Dossiers corrigés"
          value={formatNumber(data.corrections.kpis.correctedJobs)}
          hint={`${formatPercent(data.corrections.kpis.correctionRate)} % des dossiers exploitables`}
          variant={data.corrections.kpis.correctedJobs > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Validation rapide"
          value={formatNumber(data.corrections.kpis.quicklyValidatedJobs)}
          hint={`${formatPercent(data.corrections.kpis.quickValidationRate)} % validés après revue`}
          variant={data.corrections.kpis.quicklyValidatedJobs > 0 ? "success" : "default"}
        />
        <MetricCard
          label="Sans retouche"
          value={formatNumber(data.corrections.kpis.untouchedSuccessfulJobs)}
          hint="Dossiers terminés/appliqués sans action explicite"
        />
        <MetricCard
          label="Événements de correction"
          value={formatNumber(data.corrections.kpis.totalEvents)}
          hint="Historique consolidé des corrections humaines"
        />
        <MetricCard
          label="Lignes à score élevé corrigées"
          value={
            data.calibration.appliedHighScoreItems > 0
              ? `${formatPercent(data.calibration.appliedHighScoreMaterialCorrectionRate)} %`
              : "-"
          }
          hint={
            data.calibration.status === "no_data"
              ? `Aucune ligne appliquée avec score ≥ ${formatConfidence(TAKEOFF_HIGH_SCORE_THRESHOLD)}`
              : data.calibration.status === "insufficient"
                ? `${data.calibration.appliedHighScoreMateriallyCorrectedItems}/${data.calibration.appliedHighScoreItems} corrigées · seulement ${data.calibration.appliedHighScoreItems}/${data.calibration.minimumSampleSize} lignes appliquées`
                : `${data.calibration.appliedHighScoreMateriallyCorrectedItems}/${data.calibration.appliedHighScoreItems} lignes appliquées avec score ≥ ${formatConfidence(TAKEOFF_HIGH_SCORE_THRESHOLD)} corrigées`
          }
          variant={
            data.calibration.status !== "sufficient"
              ? "warning"
              : data.calibration.appliedHighScoreMaterialCorrectionRate === 0
                ? "success"
                : data.calibration.appliedHighScoreMaterialCorrectionRate <=
                    TAKEOFF_HIGH_SCORE_MAX_MATERIAL_CORRECTION_RATE
                  ? "warning"
                  : "danger"
          }
        />
        <MetricCard
          label="Preuves niveau C"
          value={
            data.calibration.levelCIncludedItems > 0
              ? `${formatPercent(data.calibration.levelCLocalizedProofCoverage)} %`
              : "-"
          }
          hint={
            data.calibration.levelCIncludedItems > 0
              ? `${data.calibration.levelCLocalizedProofItems}/${data.calibration.levelCIncludedItems} lignes avec preuve et page`
              : "Aucune ligne niveau C exploitable"
          }
          variant={
            data.calibration.levelCIncludedItems === 0
              ? "default"
              : data.calibration.levelCLocalizedProofCoverage === 100
                ? "success"
                : "danger"
          }
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.25fr] animate-slide-in stagger-3">
        <div className="dashboard-card min-w-0 overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Corrections enregistrées
            </h2>
          </div>
          <CorrectionEventsTable events={data.corrections.eventCounts} />
        </div>

        <div className="dashboard-card min-w-0 overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Lecture métier par niveau
            </h2>
          </div>
          <CorrectionByLevelTable rows={data.corrections.byLevel} />
        </div>
      </section>

      <section className="dashboard-card overflow-hidden animate-slide-in stagger-3">
        <div className="border-b border-[var(--slate-200)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--slate-700)]">
            Suivi hebdo pilote
          </h2>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Volume, coût moyen, temps moyen, taux de correction et satisfaction par semaine.
          </p>
        </div>
        <div className="overflow-x-auto">
          <PilotWeeklyTable rows={data.pilot.weeklySnapshots} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr] animate-slide-in stagger-3">
        <div className="dashboard-card min-w-0 p-5">
          <div className="mb-3 flex items-center gap-4 text-xs font-semibold text-[var(--slate-600)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[var(--brand-blue)]" />
              Créés
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[var(--danger)]" />
              Échoués
            </span>
          </div>
          <JobTrendChart trend={data.trend} />
        </div>

        <div className="dashboard-card min-w-0 overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Coût par niveau
            </h2>
          </div>
          <CostByLevelTable data={data.costByLevel} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2 animate-fade-in stagger-3">
        <div className="dashboard-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--slate-700)]">
            Répartition des tokens
          </h2>
          <TokenBreakdownBar data={data.tokenBreakdown} />
        </div>

        <div className="dashboard-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--slate-700)]">
            Fiabilité technique
          </h2>
          <ReliabilityCards data={data.reliability} />
        </div>
      </section>

      <section className="dashboard-card overflow-hidden animate-fade-in stagger-4">
        <div className="border-b border-[var(--slate-200)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--slate-700)]">
            Top codes erreur
          </h2>
        </div>
        <ErrorsTable errors={data.topErrors} />
      </section>

      <section className="dashboard-card overflow-hidden animate-fade-in stagger-4">
        <div className="border-b border-[var(--slate-200)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--slate-700)]">
            Extractions récentes
          </h2>
        </div>
        <RecentJobsTable jobs={data.recentJobs} />
      </section>
    </div>
  );
}
