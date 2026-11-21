const displayDate = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const displayDateTime = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const displayPercent = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 2,
});

function formatDate(
  value: Date | string | number | null | undefined,
  formatter: Intl.DateTimeFormat,
  fallback: string
) {
  if (value === null || value === undefined) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : fallback;
}

export function formatDisplayDate(value: Date | string | number | null | undefined, fallback = "—") {
  return formatDate(value, displayDate, fallback);
}

export function formatDisplayDateTime(value: Date | string | number | null | undefined) {
  return formatDate(value, displayDateTime, "—");
}

/** 20 denotes 20%; use formatBasisPoints for stored rates. */
export function formatPercentPoints(value: number) {
  return Number.isFinite(value) ? displayPercent.format(value / 100) : "—";
}

/** 2,000 basis points denote 20%. */
export function formatBasisPoints(value: number) {
  return Number.isFinite(value) ? displayPercent.format(value / 10_000) : "—";
}
