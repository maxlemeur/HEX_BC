"use client";

import type {
  TakeoffMetricsTokenBreakdown,
  TakeoffMetricsTrendPoint,
} from "@/lib/takeoff/types";

import { formatNumber } from "./takeoff-metrics-formatters";

type TrendLinePoint = {
  x: number;
  yCreated: number;
  yFailed: number;
  label: string;
};

function buildTrendPoints(
  trend: TakeoffMetricsTrendPoint[],
  chartWidth: number,
  chartHeight: number
): { points: TrendLinePoint[]; maxValue: number } {
  const maxValue = Math.max(
    ...trend.flatMap((item) => [item.createdCount, item.failedCount]),
    1
  );

  if (trend.length === 0) {
    return { points: [], maxValue };
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
    yFailed: toY(item.failedCount),
    label: item.label,
  }));

  return { points, maxValue };
}

function toPolyline(points: { x: number; y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function JobTrendChart({ trend }: { trend: TakeoffMetricsTrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune donnée de tendance disponible.
      </div>
    );
  }

  const chartWidth = 720;
  const chartHeight = 220;
  const { points, maxValue } = buildTrendPoints(trend, chartWidth, chartHeight);
  const createdPoints = toPolyline(
    points.map((point) => ({ x: point.x, y: point.yCreated }))
  );
  const failedPoints = toPolyline(
    points.map((point) => ({ x: point.x, y: point.yFailed }))
  );
  const horizontalGuides = 4;

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight + 24}`}
      className="w-full"
      role="img"
      aria-label="Tendance des extractions créées et échouées"
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
        points={failedPoints}
        fill="none"
        stroke="var(--danger)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.yCreated} r={3.5} fill="var(--brand-blue)" />
          <circle cx={point.x} cy={point.yFailed} r={3.5} fill="var(--danger)" />
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

      <text x={8} y={20} className="fill-[var(--slate-500)]" fontSize="10">
        {maxValue}
      </text>
    </svg>
  );
}

export function TokenBreakdownBar({
  data,
}: {
  data: TakeoffMetricsTokenBreakdown;
}) {
  const total = data.inputTokens + data.reasoningTokens + data.outputTokens;
  if (total === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucun token enregistre.
      </div>
    );
  }

  const barWidth = 400;
  const barHeight = 28;
  const inputWidth = (data.inputTokens / total) * barWidth;
  const reasoningWidth = (data.reasoningTokens / total) * barWidth;
  const outputWidth = (data.outputTokens / total) * barWidth;

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${barWidth} ${barHeight}`}
        className="w-full"
        role="img"
        aria-label="Repartition des tokens"
      >
        <rect
          x={0}
          y={0}
          width={inputWidth}
          height={barHeight}
          rx={4}
          fill="var(--brand-blue)"
        />
        <rect
          x={inputWidth}
          y={0}
          width={reasoningWidth}
          height={barHeight}
          fill="var(--warning)"
        />
        <rect
          x={inputWidth + reasoningWidth}
          y={0}
          width={outputWidth}
          height={barHeight}
          rx={4}
          fill="var(--success)"
        />
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-[var(--slate-600)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-blue)]" />
          Input: {formatNumber(data.inputTokens)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
          Reasoning: {formatNumber(data.reasoningTokens)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
          Output: {formatNumber(data.outputTokens)}
        </span>
      </div>
    </div>
  );
}
