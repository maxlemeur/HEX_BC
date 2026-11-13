"use client";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import { dpgfChange, dpgfComposition, dpgfFall } from "./dpgf-outcome-text";
import type { Resolution } from "./page-decisions";

// TI-682 lot D4: at the application's confirmation, every DPGF line the application touches, with what it holds now and
// what it will hold: the sum of the takeoffs it keeps, by takeoff and page, at least its DPGF quantity. A line several
// takeoffs feed is shown as such, whatever its unit (an overview and its enlarged plan counted together show here). A
// line that falls says so, with why and where the page's new measure went.

export const DPGF_TARGETS_TITLE = "Lignes DPGF";

export function TakeoffDpgfTargetsPanel({ proposal, resolution }: Readonly<{
  proposal: TakeoffPageReplacementResponse | null;
  resolution: Pick<Resolution, "dpgf"> | null;
}>) {
  if (!proposal || !resolution || resolution.dpgf.length === 0) return null;
  return (
    <section aria-label={DPGF_TARGETS_TITLE} className="space-y-2 rounded-lg border border-border bg-background px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">{DPGF_TARGETS_TITLE}</h2>
      <p className="text-sm text-foreground-secondary">
        Une ligne DPGF tient la somme des métrés qu’elle garde, et au moins sa quantité du DPGF.
      </p>
      {resolution.dpgf.map((outcome) => {
        const fall = dpgfFall(outcome);
        const composition = dpgfComposition(outcome, proposal.jobs);
        return (
          <div key={outcome.target.id} role="group" aria-label={`Ligne DPGF ${outcome.target.title}`}
            className="space-y-1 rounded-md border border-border p-2 text-sm">
            <p>
              <span className="font-medium">{outcome.target.title}</span> : {dpgfChange(outcome)}
              {outcome.takeoffs.length > 1 ? ` — alimentée par ${outcome.takeoffs.length} métrés` : ""}
            </p>
            {fall ? <p role="status" className="text-xs font-medium text-warning">{fall}</p> : null}
            {composition.length > 0 ? (
              <ul aria-label={`Composition de ${outcome.target.title}`} className="list-disc space-y-0.5 pl-5 text-xs text-foreground-secondary">
                {composition.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            ) : <p className="text-xs text-foreground-secondary">Aucun métré ne l’alimente : elle tient sa quantité du DPGF.</p>}
          </div>
        );
      })}
    </section>
  );
}
