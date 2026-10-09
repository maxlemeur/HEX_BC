"use client";

import { useState } from "react";
import useSWR from "swr";

import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

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

const PAGE_TITLE = "Suivi des métrés";
const PAGE_DESCRIPTION =
  "Observabilité des extractions, des coûts, des corrections humaines et du pilote client.";

function MetricsLoadingState() {
  return (
    <div className="mx-auto min-w-0 max-w-6xl">
      <PageHeader eyebrow="Administration" title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
      <LoadingState label="Chargement des métriques…" className="py-24" />
    </div>
  );
}

function MetricsErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto min-w-0 max-w-6xl">
      <PageHeader eyebrow="Administration" title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
      <Alert variant="danger">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
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
    return <MetricsLoadingState />;
  }

  if (error || !data) {
    return <MetricsErrorState message={error?.message ?? "Impossible de charger les métriques."} />;
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6">
      <PageHeader
        className="mb-0 sm:mb-0"
        eyebrow="Administration"
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <>
            <PeriodSelector value={period} onChange={setPeriod} />
            <LevelSelector value={level} onChange={setLevel} />
            <p className="w-full text-xs text-muted-foreground md:w-auto">
              {formatGeneratedAt(data.generatedAt)}
            </p>
          </>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.3fr] animate-slide-in stagger-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground-secondary">
                Pilote client
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                État du pilote et définition partagée des signaux de décision.
              </p>
            </div>
            <PilotStatusBadge killSwitchEnabled={data.pilot.killSwitchEnabled} />
          </div>

          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Interrupteur de sécurité
              </dt>
              <dd className="mt-1 font-mono text-foreground-secondary">
                {data.pilot.killSwitchFlagKey}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Proxy de satisfaction
              </dt>
              <dd className="mt-1 text-foreground-secondary">
                {data.pilot.satisfactionLabel}
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                {data.pilot.satisfactionDefinition}
              </dd>
            </div>
          </dl>
        </Card>

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
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground-secondary">
              Corrections enregistrées
            </h2>
          </div>
          <CorrectionEventsTable events={data.corrections.eventCounts} />
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground-secondary">
              Lecture métier par niveau
            </h2>
          </div>
          <CorrectionByLevelTable rows={data.corrections.byLevel} />
        </Card>
      </section>

      <Card className="overflow-hidden animate-slide-in stagger-3">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground-secondary">
            Suivi hebdo pilote
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Volume, coût moyen, temps moyen, taux de correction et satisfaction par semaine.
          </p>
        </div>
        <div
          className="relative overflow-x-auto"
          role="region"
          aria-label="Suivi hebdo pilote"
          tabIndex={0}
        >
          <PilotWeeklyTable rows={data.pilot.weeklySnapshots} />
        </div>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr] animate-slide-in stagger-3">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-4 text-xs font-semibold text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              Créés
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
              Échoués
            </span>
          </div>
          <JobTrendChart trend={data.trend} />
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground-secondary">
              Coût par niveau
            </h2>
          </div>
          <CostByLevelTable data={data.costByLevel} />
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2 animate-fade-in stagger-3">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground-secondary">
            Répartition des tokens
          </h2>
          <TokenBreakdownBar data={data.tokenBreakdown} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground-secondary">
            Fiabilité technique
          </h2>
          <ReliabilityCards data={data.reliability} />
        </Card>
      </section>

      <Card className="overflow-hidden animate-fade-in stagger-4">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground-secondary">
            Top codes erreur
          </h2>
        </div>
        <ErrorsTable errors={data.topErrors} />
      </Card>

      <Card className="overflow-hidden animate-fade-in stagger-4">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground-secondary">
            Extractions récentes
          </h2>
        </div>
        <RecentJobsTable jobs={data.recentJobs} />
      </Card>
    </div>
  );
}
