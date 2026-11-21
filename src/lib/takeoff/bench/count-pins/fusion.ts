import type { Pin } from "./types";
import { matchPoints } from "./score";

// A reader owns its individual detections. Pair only across readers and only
// within a family. An unresolved conflict survives subsequent combinations.
export function combine<T extends Pin>(primary: T[], secondary: T[], radius: number) {
  const combined = primary.map((p) => ({ ...p, evidence: [...p.evidence] }));
  for (const organ of new Set(secondary.map((p) => p.organ))) {
    const a = combined.filter((p) => p.organ === organ);
    const b = secondary.filter((p) => p.organ === organ);
    const paired = new Set<number>();
    for (const [i, j] of matchPoints(a, b, radius)) {
      paired.add(j);
      const first = a[i],
        second = b[j];
      const evidence = new Set([...first.evidence, ...second.evidence]);
      if (first.dn && second.dn && first.dn !== second.dn) evidence.add("conflicting-DN");
      first.dn = evidence.has("conflicting-DN") ? null : (first.dn ?? second.dn);
      first.evidence = [...evidence];
    }
    combined.push(...b.filter((_, j) => !paired.has(j)));
  }
  return combined;
}
