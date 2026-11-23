import type { JudgedPin, Pin } from "./types";
import { MATCH_RADIUS, matchPoints } from "./score";

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

export function combineReaders(vector: JudgedPin[], replay: JudgedPin[]): JudgedPin[] {
  // Index independent detections in four-point cells. Only an uncontested pair corroborates one object.
  // When a tile covers two neighbours (or vice versa), keep all positions for the member to resolve.
  const cells = new Map<string, number[]>();
  const cellKey = (p: JudgedPin, x: number, y: number) =>
    JSON.stringify([p.sheet, p.generation, p.page, p.poste, p.organ, x, y]);
  const cell = (value: number) => Math.floor(value / MATCH_RADIUS);
  vector.forEach((p, i) => {
    const key = cellKey(p, cell(p.x), cell(p.y));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(i);
  });
  const hits = vector.map(() => [] as number[]);
  const candidates = replay.map((p, j) => {
    const found: number[] = [];
    for (let x = cell(p.x) - 1; x <= cell(p.x) + 1; x++) {
      for (let y = cell(p.y) - 1; y <= cell(p.y) + 1; y++) {
        for (const i of cells.get(cellKey(p, x, y)) ?? []) {
          if (Math.hypot(p.x - vector[i].x, p.y - vector[i].y) > MATCH_RADIUS) continue;
          found.push(i);
          hits[i].push(j);
        }
      }
    }
    return found;
  });
  const paired = new Set<number>();
  const unresolved = (p: JudgedPin) => ({ ...p, evidence: [...p.evidence, "ambiguous-neighbours"] });
  const kept = vector.map((p, i) => {
    const peers = hits[i];
    if (!peers.length) return p;
    const [j] = peers;
    if (peers.length !== 1 || candidates[j].length !== 1) return unresolved(p);
    paired.add(j);
    return combine([p], [replay[j]], MATCH_RADIUS)[0];
  });
  return kept.concat(replay.flatMap((p, j) => paired.has(j) ? [] : [candidates[j].length ? unresolved(p) : p]));
}
