import Link from "next/link";

import { cn } from "@/lib/utils";

type StatTone = "default" | "brand" | "success" | "warning" | "danger" | "info";

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-foreground",
  brand: "text-brand-orange-dark",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
  icon?: React.ReactNode;
  href?: string;
  className?: string;
};

/**
 * One key figure. Renders a `<div>` pair for use inside a `<dl>` grid (StatGrid), so the
 * label/value relation is exposed to assistive technologies. No live region: figures that
 * change with filters must not be re-announced on every change.
 */
export function StatCard({ label, value, hint, tone = "default", icon, href, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "relative min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5",
        href && "transition-shadow hover:shadow-card-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring",
        className
      )}
    >
      <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground sm:text-sm">
        {icon ? <span aria-hidden="true" className="text-subtle-foreground [&_svg]:size-4">{icon}</span> : null}
        {href ? (
          // Stretched link: the whole card is clickable while the dt/dd structure stays valid.
          <Link href={href} className="min-w-0 truncate outline-none after:absolute after:inset-0 after:content-['']">
            {label}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{label}</span>
        )}
      </dt>
      <dd className={cn("mt-2 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl", VALUE_TONE[tone])}>
        {value}
      </dd>
      {hint ? <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Responsive grid of StatCards (2 columns on mobile, up to 4 on desktop). */
export function StatGrid({
  children,
  label,
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <dl aria-label={label} className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", className)}>
      {children}
    </dl>
  );
}
