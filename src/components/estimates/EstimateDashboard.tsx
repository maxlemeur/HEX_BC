import { formatEUR } from "@/lib/money";

export type EstimateStatsTrendPoint = {
  key: string;
  label: string;
  createdCount: number;
  acceptedCount: number;
};

export type EstimateStatsPayload = {
  generatedAt: string;
  kpis: {
    totalEstimates: number;
    byStatus: {
      draft: number;
      sent: number;
      accepted: number;
      archived: number;
    };
    acceptanceRate: number;
    acceptanceRateBase: {
      accepted: number;
      sent: number;
    };
    revenues: {
      acceptedCents: number;
      sentCents: number;
      draftCents: number;
    };
  };
  trend: EstimateStatsTrendPoint[];
};

type EstimateDashboardProps = {
  data: EstimateStatsPayload;
};

type TrendLinePoint = {
  x: number;
  yCreated: number;
  yAccepted: number;
  label: string;
};

function formatPercent(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatGeneratedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";

  return parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTrendPoints(
  trend: EstimateStatsTrendPoint[],
  chartWidth: number,
  chartHeight: number
): { points: TrendLinePoint[]; maxValue: number } {
  const maxValue = Math.max(
    ...trend.flatMap((item) => [item.createdCount, item.acceptedCount]),
    1
  );

  if (trend.length === 0) {
    return {
      points: [],
      maxValue,
    };
  }

  const paddingLeft = 36;
  const paddingRight = 24;
  const usableWidth = Math.max(chartWidth - paddingLeft - paddingRight, 1);
  const stepX = trend.length > 1 ? usableWidth / (trend.length - 1) : 0;

  const toY = (value: number) => {
    const normalized = value / maxValue;
    return 16 + (chartHeight - 24) * (1 - normalized);
  };

  const points = trend.map((item, index) => ({
    x: paddingLeft + stepX * index,
    yCreated: toY(item.createdCount),
    yAccepted: toY(item.acceptedCount),
    label: item.label,
  }));

  return {
    points,
    maxValue,
  };
}

function toPolyline(points: { x: number; y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function TrendChart({ trend }: { trend: EstimateStatsTrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune donnee de tendance disponible.
      </div>
    );
  }

  const chartWidth = 720;
  const chartHeight = 220;
  const { points, maxValue } = buildTrendPoints(trend, chartWidth, chartHeight);

  const createdPoints = toPolyline(
    points.map((point) => ({ x: point.x, y: point.yCreated }))
  );
  const acceptedPoints = toPolyline(
    points.map((point) => ({ x: point.x, y: point.yAccepted }))
  );

  const horizontalGuides = 4;

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight + 24}`}
      className="w-full"
      role="img"
      aria-label="Tendance des chiffrages crees et acceptes sur 6 mois"
    >
      {Array.from({ length: horizontalGuides + 1 }, (_, index) => {
        const y = 16 + ((chartHeight - 24) / horizontalGuides) * index;
        return (
          <line
            key={`guide-${index}`}
            x1={24}
            y1={y}
            x2={chartWidth - 16}
            y2={y}
            stroke="rgba(148, 163, 184, 0.25)"
            strokeWidth="1"
          />
        );
      })}

      <polyline
        points={createdPoints}
        fill="none"
        stroke="var(--brand-blue)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points={acceptedPoints}
        fill="none"
        stroke="var(--success)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.yCreated} r={3.5} fill="var(--brand-blue)" />
          <circle cx={point.x} cy={point.yAccepted} r={3.5} fill="var(--success)" />
          <text
            x={point.x}
            y={chartHeight + 12}
            textAnchor="middle"
            className="fill-[var(--slate-500)]"
            fontSize="10"
          >
            {point.label}
          </text>
        </g>
      ))}

      <text
        x={8}
        y={20}
        className="fill-[var(--slate-500)]"
        fontSize="10"
      >
        {maxValue}
      </text>
    </svg>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--slate-200)] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-[var(--slate-800)]">{value}</p>
      <p className="mt-2 text-xs text-[var(--slate-500)]">{hint}</p>
    </div>
  );
}

export function EstimateDashboard({ data }: EstimateDashboardProps) {
  const { kpis, trend } = data;
  const acceptanceTotalSent = kpis.acceptanceRateBase.accepted + kpis.acceptanceRateBase.sent;

  return (
    <div className="space-y-6">
      <section className="dashboard-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-[var(--slate-800)]">
              Tableau de bord chiffrages
            </h1>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Vue recap des volumes, statuts et performances commerciales.
            </p>
          </div>
          <p className="text-xs text-[var(--slate-500)]">
            Mise a jour: {formatGeneratedAt(data.generatedAt)}
          </p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Total devis"
          value={String(kpis.totalEstimates)}
          hint="Toutes versions visibles"
        />
        <MetricCard
          label="Taux acceptation"
          value={`${formatPercent(kpis.acceptanceRate)} %`}
          hint={`${kpis.acceptanceRateBase.accepted} acceptes / ${acceptanceTotalSent} envoyes`}
        />
        <MetricCard
          label="CA accepte"
          value={formatEUR(kpis.revenues.acceptedCents)}
          hint="Total HT des devis acceptes"
        />
        <MetricCard
          label="CA envoye"
          value={formatEUR(kpis.revenues.sentCents)}
          hint="Total HT des devis envoyes"
        />
        <MetricCard
          label="CA brouillon"
          value={formatEUR(kpis.revenues.draftCents)}
          hint="Total HT des devis brouillon"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="dashboard-card p-5">
          <div className="mb-3 flex items-center gap-4 text-xs font-semibold text-[var(--slate-600)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[var(--brand-blue)]" />
              Crees
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
              Acceptes
            </span>
          </div>
          <TrendChart trend={trend} />
        </div>

        <div className="dashboard-card overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Repartition par statut
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
              <tr>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3 text-right">Volume</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--slate-100)]">
                <td className="px-4 py-3">Brouillon</td>
                <td className="px-4 py-3 text-right font-semibold">{kpis.byStatus.draft}</td>
              </tr>
              <tr className="border-t border-[var(--slate-100)]">
                <td className="px-4 py-3">Envoye</td>
                <td className="px-4 py-3 text-right font-semibold">{kpis.byStatus.sent}</td>
              </tr>
              <tr className="border-t border-[var(--slate-100)]">
                <td className="px-4 py-3">Accepte</td>
                <td className="px-4 py-3 text-right font-semibold">{kpis.byStatus.accepted}</td>
              </tr>
              <tr className="border-t border-[var(--slate-100)]">
                <td className="px-4 py-3">Archive</td>
                <td className="px-4 py-3 text-right font-semibold">{kpis.byStatus.archived}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-card overflow-hidden">
        <div className="border-b border-[var(--slate-200)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--slate-700)]">
            Tendance 6 derniers mois
          </h2>
        </div>
        <div className="table-scroll">
          <table className="w-full min-w-[540px] text-sm">
            <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
              <tr>
                <th className="px-4 py-3">Mois</th>
                <th className="px-4 py-3 text-right">Crees</th>
                <th className="px-4 py-3 text-right">Acceptes</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((item) => (
                <tr key={item.key} className="border-t border-[var(--slate-100)]">
                  <td className="px-4 py-3">{item.label}</td>
                  <td className="px-4 py-3 text-right font-semibold">{item.createdCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">{item.acceptedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
