"use client";

import { formatDisplayDate } from "@/lib/display-format";
import { Badge } from "@/components/ui/badge";

export function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDisplayDate(date);
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
