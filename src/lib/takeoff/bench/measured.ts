import type { MeasuredTruthFile } from "@/lib/takeoff/bench/schemas";
import type { KeyLabel, ScopeScore } from "@/lib/takeoff/bench/score";

// Lengths measured by hand along the drawn line (truth/measured, TI-662, decision of 11 Nov). A devis may price
// more pipe than the plan draws (drops to the fixtures, allowances, rounding of each section), so a reading that
// follows the drawing is short of it however well it reads. The lengths of a measured plan are therefore also
// judged on a measurement along the axis of the drawn pipe, beside the judgment on the devis, which stays the
// headline (vector-report.ts).
// - A scope is judged only when every one of its plans has a measurement: a scope measured in part is named and
//   left to its devis.
// - A key is judged only when every plan of its scope gives it a length; the lengths are added. A key a plan does
//   not list, or lists as not drawn in plan view (length_m null), is not judged.

export type MeasuredLengths = {
  /** Scope id, then measuredKey of a length key: metres along the drawn line, added over the plans of the scope. */
  by_scope: Map<string, Map<string, number>>;
  /** Scopes with a measurement that does not cover all their plans. */
  partial: string[];
};

/** The identity of a length key in a measurement: the fields of its truth key that a length has. */
export function measuredKey(key: Pick<KeyLabel, "zone" | "level" | "network" | "material" | "dn">) {
  return JSON.stringify([key.zone, key.level, key.network, key.material, key.dn]);
}

export function measuredLengthsByScope(files: readonly MeasuredTruthFile[], scopes: ReadonlyArray<Pick<ScopeScore, "id" | "documents">>): MeasuredLengths {
  const byDocument = new Map(files.map((file) => [file.document, file]));
  const measured: MeasuredLengths = { by_scope: new Map(), partial: [] };
  for (const scope of scopes) {
    if (measured.by_scope.has(scope.id) || measured.partial.includes(scope.id)) continue;
    const plans = scope.documents.map((id) => byDocument.get(id));
    if (plans.every((plan) => plan === undefined)) continue;
    if (plans.some((plan) => plan === undefined)) {
      measured.partial.push(scope.id);
      continue;
    }
    const given = (plans as MeasuredTruthFile[]).map((plan) => new Map(plan.lines.map((line) => [measuredKey(line), line.length_m])));
    const lengths = new Map<string, number>();
    for (const key of given[0].keys()) {
      const parts = given.map((plan) => plan.get(key) ?? null);
      if (parts.every((part): part is number => part !== null)) lengths.set(key, Math.round(parts.reduce((sum, part) => sum + part, 0) * 1e6) / 1e6);
    }
    measured.by_scope.set(scope.id, lengths);
  }
  measured.partial.sort();
  return measured;
}
