"use client";

import type { SupplierPriceFormState } from "@/components/catalogue/prices-manager/types";
import { Badge } from "@/components/ui/badge";

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
    return <Badge variant="success">À jour</Badge>;
  }

  if (level === "aging") {
    return <Badge variant="warning">Vieillissant ({ageDays} j)</Badge>;
  }

  return <Badge variant="danger">Ancien ({ageDays} j)</Badge>;
}
