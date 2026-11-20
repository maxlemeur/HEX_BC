import { distance, type JudgedPin, type Location } from "./types";

// Successive shortest augmenting paths. The residual reverse edge removes the
// cost of the old pairing. Attributes never influence which drawing is closest.
export function matchPoints(left: Location[], right: Location[], radius: number): [number, number][] {
  const edges = left.map((a) =>
    right.flatMap((b, j) => {
      const d = distance(a, b);
      return a.sheet === b.sheet && a.generation === b.generation && a.page === b.page && d <= radius ? [{ j, d }] : [];
    }),
  );
  const mate = left.map(() => -1),
    owner = right.map(() => -1);
  const cost = left.map(() => 0);
  for (;;) {
    const dl = mate.map((j) => (j < 0 ? 0 : Infinity));
    const dr = right.map(() => Infinity),
      via = right.map(() => -1);
    const queue = dl.flatMap((d, i) => (d === 0 ? [i] : []));
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      for (const { j, d } of edges[i]) {
        const next = dl[i] + d;
        if (j === mate[i] || next >= dr[j] - 1e-9) continue;
        dr[j] = next;
        via[j] = i;
        const old = owner[j];
        if (old >= 0 && next - cost[old] < dl[old] - 1e-9) {
          dl[old] = next - cost[old];
          queue.push(old);
        }
      }
    }
    let end = -1;
    dr.forEach((d, j) => {
      if (owner[j] < 0 && Number.isFinite(d) && (end < 0 || d < dr[end])) end = j;
    });
    if (end < 0) break;
    while (end >= 0) {
      const i = via[end],
        old = mate[i];
      mate[i] = end;
      owner[end] = i;
      cost[i] = distance(left[i], right[end]);
      end = old;
    }
  }
  return mate.flatMap((j, i) => (j < 0 ? [] : [[i, j] as [number, number]]));
}

export function metrics(tp: number, proposed: number, expected: number) {
  return {
    tp,
    fp: proposed - tp,
    fn: expected - tp,
    precision: proposed ? tp / proposed : null,
    recall: expected ? tp / expected : null,
  };
}

export const MATCH_RADIUS = 4;

type Pair = [number, number];
type NegativeZone = { name: string; contains: (pin: Location) => boolean };

function spatialScore(proposed: JudgedPin[], truth: JudgedPin[], pairs: Pair[]) {
  const named = pairs.filter(([i, j]) => proposed[i].poste !== null && proposed[i].poste === truth[j].poste);
  const sized = named.filter(([i, j]) => proposed[i].dn !== null && proposed[i].dn === truth[j].dn);
  return {
    drawing: metrics(pairs.length, proposed.length, truth.length),
    poste: metrics(named.length, proposed.filter((p) => p.poste !== null).length, truth.length),
    dn: metrics(
      sized.length,
      proposed.filter((p) => p.dn !== null).length,
      truth.filter((p) => p.dn !== null).length,
    ),
  };
}

export function scorePage(
  proposed: JudgedPin[],
  truth: JudgedPin[],
  suppliedTruth: number[],
  zones: NegativeZone[],
) {
  const pairs = matchPoints(proposed, truth, MATCH_RADIUS);
  const matched = new Set(pairs.map(([i]) => i));
  const suppliedPredictions = new Set(pairs.filter(([, j]) => suppliedTruth.includes(j)).map(([i]) => i));
  const remainingPredictions = proposed.filter((_, i) => !suppliedPredictions.has(i));
  const remainingTruth = truth.filter((_, j) => !suppliedTruth.includes(j));
  const unmatched = proposed.filter((_, i) => !matched.has(i));
  return {
    spatial: spatialScore(proposed, truth, pairs),
    withoutSuppliedExamples: spatialScore(
      remainingPredictions, remainingTruth, matchPoints(remainingPredictions, remainingTruth, MATCH_RADIUS),
    ),
    suppliedExamples: {
      occurrences: suppliedTruth.length,
      spatiallyPaired: suppliedPredictions.size,
    },
    abstentions: {
      poste: proposed.filter((p) => p.poste === null).length,
      dn: pairs.filter(([i, j]) => truth[j].dn !== null && proposed[i].poste === truth[j].poste && proposed[i].dn === null).length,
    },
    contradictions: proposed.filter((p) => p.evidence.includes("conflicting-DN")).length,
    duplicates: unmatched.filter((p) => truth.some((t) => samePageInRadius(p, t, MATCH_RADIUS))).length,
    negativeZones: Object.fromEntries(zones.map((zone) => [zone.name, unmatched.filter(zone.contains).length])),
    pairs,
    missed: truth.filter((_, j) => !pairs.some((pair) => pair[1] === j)),
    unmatched,
  };
}

function samePageInRadius(a: Location, b: Location, radius: number) {
  return a.sheet === b.sheet && a.generation === b.generation && a.page === b.page && distance(a, b) <= radius;
}
