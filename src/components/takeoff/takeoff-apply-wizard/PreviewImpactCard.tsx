"use client";

export function PreviewImpactCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--slate-500)]">{hint}</p>
    </div>
  );
}
