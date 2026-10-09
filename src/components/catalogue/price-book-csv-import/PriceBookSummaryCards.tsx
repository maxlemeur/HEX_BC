"use client";

import type { PriceBookValidationResult } from "@/lib/catalogue/csv-import";

import { formatNumber } from "@/components/catalogue/price-book-csv-import/utils";
import { cn } from "@/lib/utils";

export function PriceBookSummaryCards({
  validation,
}: Readonly<{
  validation: PriceBookValidationResult;
}>) {
  const cards = [
    { label: "Total détecté", value: validation.totalRows, tone: "text-foreground" },
    { label: "Importables", value: validation.acceptedRows, tone: "text-success" },
    { label: "Ignorées (hors périmètre)", value: validation.ignoredRowsCount, tone: "text-foreground-secondary" },
    { label: "À corriger", value: validation.rejectedRowsCount, tone: "text-danger" },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
          <dt className="text-micro uppercase tracking-wide text-muted-foreground">{card.label}</dt>
          <dd className={cn("mt-1 text-base font-semibold", card.tone)}>{formatNumber(card.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
