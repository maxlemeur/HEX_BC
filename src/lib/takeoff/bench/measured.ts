import { measuredKey, type MeasuredTruthFile } from "@/lib/takeoff/bench/schemas";
import type { ScopeScore } from "@/lib/takeoff/bench/score";

// Lengths measured by hand along the drawn line (truth/measured, TI-662, decision of 11 Nov). A devis may price
// more pipe than the plan draws (drops to the fixtures, allowances, rounding of each section), so a reading that
// follows the drawing is short of it however well it reads. The lengths of a measured plan are therefore also
// judged on a measurement along the axis of the drawn pipe, beside the judgment on the devis, which stays the
// headline (vector-report.ts).
// - A measurement is the measurement of one plan, and it is judged on the truth of that plan alone. A truth of
//   several plans (a level, a lot) has keys a single plan draws in part, or not at all: its scope is named and
//   left to its devis, and takeoff:bench:check refuses the measurement of one of its plans.
// - A line without length (length_m null: the measurer could not follow it on the plan) gives its key no
//   measurement; the key is left to the devis and counted among the scored lengths nobody measured.

export { measuredKey };

export type MeasuredLengths = {
  /** Scope id of a scope of one plan, then measuredKey of a length key: metres along the drawn line. */
  by_scope: Map<string, Map<string, number>>;
  /** Scopes of several plans one of which has a measurement: never judged on it. */
  several_plans: string[];
};

export function measuredLengthsByScope(files: readonly MeasuredTruthFile[], scopes: ReadonlyArray<Pick<ScopeScore, "id" | "documents">>): MeasuredLengths {
  const byDocument = new Map(files.map((file) => [file.document, file]));
  const measured: MeasuredLengths = { by_scope: new Map(), several_plans: [] };
  for (const scope of scopes) {
    if (measured.by_scope.has(scope.id) || measured.several_plans.includes(scope.id)) continue;
    const plans = scope.documents.flatMap((id) => byDocument.get(id) ?? []);
    if (plans.length === 0) continue;
    if (scope.documents.length > 1) {
      measured.several_plans.push(scope.id);
      continue;
    }
    measured.by_scope.set(scope.id, new Map(plans[0].lines.flatMap((line) => (line.length_m === null ? [] : [[measuredKey(line), line.length_m] as const]))));
  }
  measured.several_plans.sort();
  return measured;
}
