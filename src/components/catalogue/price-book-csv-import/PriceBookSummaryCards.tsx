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
      <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total detecte</p>
        <p className="mt-1 text-base font-semibold text-foreground">
          {formatNumber(validation.totalRows)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Importables</p>
        <p className="mt-1 text-base font-semibold text-success">
          {formatNumber(validation.acceptedRows)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Ignorees (hors perimetre)
        </p>
        <p className="mt-1 text-base font-semibold text-foreground-secondary">
          {formatNumber(validation.ignoredRowsCount)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">A corriger</p>
        <p className="mt-1 text-base font-semibold text-danger">
          {formatNumber(validation.rejectedRowsCount)}
        </p>
      </div>
    </div>
  );
}
