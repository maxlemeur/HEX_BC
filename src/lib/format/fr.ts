/**
 * French display formatters shared across features: building an Intl formatter costs far more than formatting with
 * it, so each one is built once here.
 */

/** A quantity, with up to three decimals: « 1 234,568 ». */
export const QUANTITY_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/** A count, with the default French options: « 12 345 ». */
export const COUNT_FORMAT = new Intl.NumberFormat("fr-FR");

/** A moment, short date and time in Paris: « 25/10/2026 02:30 ». */
export const PARIS_DATE_TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

/** A day in Paris: « 25/10/2026 ». */
export const PARIS_DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
