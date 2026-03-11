"use client";

import type { PriceBookValidationResult } from "@/lib/catalogue/csv-import";

import { formatNumber } from "@/components/catalogue/price-book-csv-import/utils";

export function PriceBookSummaryCards({
  validation,
}: Readonly<{
  validation: PriceBookValidationResult;
}>) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Total detecte</p>
        <p className="mt-1 text-base font-semibold text-[var(--slate-900)]">
          {formatNumber(validation.totalRows)}
        </p>
      </div>
      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Importables</p>
        <p className="mt-1 text-base font-semibold text-[var(--success)]">
          {formatNumber(validation.acceptedRows)}
        </p>
      </div>
      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
          Ignorees (hors perimetre)
        </p>
        <p className="mt-1 text-base font-semibold text-[var(--slate-700)]">
          {formatNumber(validation.ignoredRowsCount)}
        </p>
      </div>
      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">A corriger</p>
        <p className="mt-1 text-base font-semibold text-[var(--danger)]">
          {formatNumber(validation.rejectedRowsCount)}
        </p>
      </div>
    </div>
  );
}
