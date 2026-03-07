import type { ReactNode } from "react";

import { Sparkline } from "@/components/ui/Sparkline";

type KPICardProps = {
  label: string;
  value: string | number;
  variation?: number;
  sparklineData?: number[];
  accentColor?: string;
  icon?: ReactNode;
};

function VariationBadge({ variation }: { variation: number }) {
  const isPositive = variation >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
        isPositive
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-700"
      }`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={isPositive ? "" : "rotate-180"}
      >
        <path d="M5 8V2M2.5 4.5 5 2l2.5 2.5" />
      </svg>
      {Math.abs(variation).toFixed(1)}%
    </span>
  );
}

export function KPICard({
  label,
  value,
  variation,
  sparklineData,
  accentColor,
  icon,
}: KPICardProps) {
  return (
    <article
      className="dashboard-card p-4"
      style={accentColor ? { borderLeft: `4px solid ${accentColor}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="typo-overline">{label}</p>
        {icon && <div className="text-[var(--slate-400)]">{icon}</div>}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <p className="typo-kpi animate-count-up text-[var(--slate-900)]">{value}</p>
        {variation !== undefined && <VariationBadge variation={variation} />}
      </div>

      {sparklineData && sparklineData.length >= 2 && (
        <div className="mt-3">
          <Sparkline data={sparklineData} color={accentColor} />
        </div>
      )}
    </article>
  );
}
