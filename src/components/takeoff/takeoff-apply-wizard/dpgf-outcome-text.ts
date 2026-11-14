import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import type { DpgfTargetOutcome } from "./page-decisions";

// TI-682 D4: how the application's confirmation says what a DPGF line will hold. A line that falls says so on the line,
// with why (the page no longer feeds it) and where the page's new measure went: it never reads as unchanged.

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const quantity = (value: number | null) => (value === null ? "—" : quantityFormat.format(value));

/** « 40 → 30 (−10) ». */
export function dpgfChange(outcome: DpgfTargetOutcome) {
  const { before, after } = outcome;
  if (before === null) return `— → ${quantity(after)}`;
  if (after === before) return `${quantity(before)}, inchangée`;
  return `${quantity(before)} → ${quantity(after)} (${after > before ? "+" : "−"}${quantity(Math.abs(after - before))})`;
}

/** Why a line falls, page by page; null when it does not. */
export function dpgfFall(outcome: DpgfTargetOutcome) {
  if (!outcome.falls) return null;
  const why = outcome.drops.map((drop) => (drop.refed
    ? `${drop.label} est remesurée plus bas.`
    : `${drop.label} n’alimente plus cette ligne DPGF ; sa nouvelle mesure ${drop.destinations.length > 0
      ? `est entrée hors DPGF : ${drop.destinations.map((line) => `« ${line.designation} » (${quantity(line.quantity)} ${line.unit})`).join(", ")}`
      : "n’est entrée nulle part"}.`));
  return `Baisse : ${dpgfChange(outcome)}. ${why.join(" ")}`.trim();
}

/** « le métré du 10/11/2026 (niveau B) », or « ce métré ». */
export function dpgfTakeoffName(jobId: string | null, jobs: TakeoffPageReplacementResponse["jobs"]) {
  if (jobId === null) return "ce métré";
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) return "un autre métré";
  const date = new Date(job.created_at);
  return `le métré du ${Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date)}${job.level ? ` (niveau ${job.level})` : ""}`;
}

/** Each takeoff the line will keep, with its measure by page. */
export function dpgfComposition(outcome: DpgfTargetOutcome, jobs: TakeoffPageReplacementResponse["jobs"]) {
  return outcome.takeoffs.map((entry) => {
    const name = dpgfTakeoffName(entry.job_id, jobs);
    const pages = entry.pages.map((page) => (page.quantity === null ? `${page.label}, part par page inconnue` : `${page.label} : ${quantity(page.quantity)}`));
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} : ${quantity(entry.quantity)} (${pages.join(" ; ")})`;
  });
}
