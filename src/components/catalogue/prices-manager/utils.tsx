"use client";

import type { SupplierPriceFormState } from "@/components/catalogue/prices-manager/types";

export const EMPTY_FORM: SupplierPriceFormState = {
  supplier_id: "",
  product_id: "",
  unit_price_euros: "",
  currency: "EUR",
  valid_from: "",
  valid_to: "",
  source: "",
  notes: "",
};

export function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function toEuroInput(unitPriceCents: number | undefined) {
  if (typeof unitPriceCents !== "number") return "";
  return (unitPriceCents / 100).toFixed(2).replace(".", ",");
}

export function FreshnessBadge({
  level,
  ageDays,
}: {
  level: "fresh" | "aging" | "stale";
  ageDays: number;
}) {
  if (level === "fresh") {
    return (
      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        À jour
      </span>
    );
  }

  if (level === "aging") {
    return (
      <span className="inline-flex rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
        Vieillissant ({ageDays}j)
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-danger/30 bg-error-light px-2 py-0.5 text-xs font-medium text-danger">
      Ancien ({ageDays}j)
    </span>
  );
}
