import { distance, type JudgedPin, type Location } from "./types";

type Pair = [number, number];
type TieBreaker = {
  maximumEdgePenalty: number;
  penalty: (left: number, right: number) => number;
};

// Every finite Float64 is an integer multiple of 2^-1074. Integer edge costs
// preserve differences through sums and residual subtraction, without a tolerance.
function distanceUnits(distance: number, bytes: DataView) {
  bytes.setFloat64(0, distance);
  const bits = bytes.getBigUint64(0);
  const exponent = Number(bits >> BigInt(52));
  if (exponent === 0) return bits;
  const hiddenBit = BigInt(1) << BigInt(52);
  const significand = hiddenBit | (bits & (hiddenBit - BigInt(1)));
  return significand << BigInt(exponent - 1);
}

// Successive shortest augmenting paths. The reverse edge removes the cost of
// an old pair. Total tie penalties are smaller than a single unit of distance.
export function matchPoints(left: Location[], right: Location[], radius: number, tie?: TieBreaker): Pair[] {
  const scale = BigInt(1) + BigInt(Math.min(left.length, right.length)) * BigInt(tie?.maximumEdgePenalty ?? 0);
  const bytes = new DataView(new ArrayBuffer(8));
  const edges = left.map((a, i) =>
    right.flatMap((b, j) => {
      const d = distance(a, b);
      if (!(a.sheet === b.sheet && a.generation === b.generation && a.page === b.page && d <= radius)) return [];
      return [{ j, cost: distanceUnits(d, bytes) * scale + BigInt(tie?.penalty(i, j) ?? 0) }];
    }),
  );
  const mate = left.map(() => -1);
  const owner = right.map(() => -1);
  const matchedCost = left.map(() => BigInt(0));
  for (;;) {
    const dl = mate.map((j) => j < 0 ? BigInt(0) : null);
    const dr = right.map<bigint | null>(() => null);
    const via = right.map(() => -1);
    const viaCost = right.map(() => BigInt(0));
    const queue = mate.flatMap((j, i) => j < 0 ? [i] : []);
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      for (const { j, cost } of edges[i]) {
        if (j === mate[i]) continue;
        const next = dl[i]! + cost;
        const previous = dr[j];
        if (previous !== null && next >= previous) continue;
        dr[j] = next;
        via[j] = i;
        viaCost[j] = cost;
        const old = owner[j];
        if (old < 0) continue;
        const rerouted = next - matchedCost[old];
        const oldDistance = dl[old];
        if (oldDistance === null || rerouted < oldDistance) {
          dl[old] = rerouted;
          queue.push(old);
        }
      }
    }
    let end = -1;
    let best: bigint | null = null;
    dr.forEach((cost, j) => {
      if (owner[j] < 0 && cost !== null && (best === null || cost < best)) {
        end = j;
        best = cost;
      }
    });
    if (end < 0) break;
    while (end >= 0) {
      const i = via[end];
      const old = mate[i];
      mate[i] = end;
      owner[end] = i;
      matchedCost[i] = viaCost[end];
      end = old;
    }
  }
  return mate.flatMap((j, i) => j < 0 ? [] : [[i, j] as Pair]);
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

type NegativeZone = { name: string; contains: (pin: Location) => boolean };

function correctPoste(prediction: JudgedPin, truth: JudgedPin) {
  return prediction.poste !== null && prediction.poste === truth.poste;
}

function correctDn(prediction: JudgedPin, truth: JudgedPin) {
  return prediction.dn !== null && prediction.dn === truth.dn;
}

function orderedPins(pins: JudgedPin[], indices: number[]) {
  return indices.map((index) => {
    const pin = pins[index];
    const key = JSON.stringify([pin.sheet, pin.generation, pin.page, pin.x, pin.y,
      pin.poste, pin.organ, pin.dn, pin.method, pin.evidence, pin.box, pin.ports]);
    return { pin, index, key };
  }).sort((a, b) => a.key < b.key ? -1 : Number(a.key > b.key));
}

function matchScoredPins(
  proposed: JudgedPin[], truth: JudgedPin[], candidateIndices: number[], truthIndices: number[],
  scoreTypes: boolean,
) {
  const left = orderedPins(proposed, candidateIndices);
  const right = orderedPins(truth, truthIndices);
  const weight = Math.min(left.length, right.length) + 1;
  const tie = scoreTypes ? {
    maximumEdgePenalty: 2 * weight + 1,
    penalty(i: number, j: number) {
      const prediction = left[i].pin;
      const reference = right[j].pin;
      if (!correctPoste(prediction, reference)) return 0;
      // Minimize total typed credits first, then poste credits. The order of
      // otherwise indistinguishable assignments is fixed by the pin keys.
      return weight + 1 + (correctDn(prediction, reference) ? weight : 0);
    },
  } : undefined;
  return matchPoints(left.map(({ pin }) => pin), right.map(({ pin }) => pin), MATCH_RADIUS, tie)
    .map(([i, j]): Pair => [left[i].index, right[j].index]);
}

function spatialScore(proposed: JudgedPin[], truth: JudgedPin[], pairs: Pair[]) {
  const named = pairs.filter(([i, j]) => correctPoste(proposed[i], truth[j]));
  const sized = named.filter(([i, j]) => correctDn(proposed[i], truth[j]));
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
  const negativeZones: Record<string, number> = Object.fromEntries(zones.map(({ name }) => [name, 0]));
  const eligible = proposed.flatMap((pin, i) => {
    const excluded = zones.filter((zone) => zone.contains(pin));
    for (const { name } of excluded) negativeZones[name]++;
    return excluded.length === 0 ? [i] : [];
  });
  const pairs = matchScoredPins(proposed, truth, eligible, truth.map((_, i) => i), true);
  const matched = new Set(pairs.map(([i]) => i));
  const suppliedIndices = new Set(suppliedTruth);
  // Reserve the nearest one-to-one matches to supplied examples before
  // allowing their neighbours to claim independent truth.
  const reserved = matchScoredPins(proposed, truth, eligible, [...suppliedIndices], false);
  const suppliedPredictions = new Set(reserved.map(([i]) => i));
  const remainingPredictions = proposed.filter((_, i) => !suppliedPredictions.has(i));
  const remainingTruth = truth.filter((_, j) => !suppliedIndices.has(j));
  const eligibleRemaining = remainingPredictions.flatMap((pin, i) =>
    zones.some((zone) => zone.contains(pin)) ? [] : [i],
  );
  const heldOutPairs = matchScoredPins(
    remainingPredictions, remainingTruth, eligibleRemaining, remainingTruth.map((_, i) => i), true,
  );
  const unmatched = proposed.filter((_, i) => !matched.has(i));
  return {
    spatial: spatialScore(proposed, truth, pairs),
    withoutSuppliedExamples: spatialScore(remainingPredictions, remainingTruth, heldOutPairs),
    suppliedExamples: {
      occurrences: suppliedIndices.size,
      spatiallyPaired: suppliedPredictions.size,
    },
    abstentions: {
      poste: proposed.filter((p) => p.poste === null).length,
      dn: pairs.filter(([i, j]) => truth[j].dn !== null && correctPoste(proposed[i], truth[j]) && proposed[i].dn === null).length,
    },
    contradictions: proposed.filter((p) => p.evidence.includes("conflicting-DN")).length,
    duplicates: unmatched.filter((p) => truth.some((t) => samePageInRadius(p, t, MATCH_RADIUS))).length,
    negativeZones,
    pairs,
    missed: truth.filter((_, j) => !pairs.some((pair) => pair[1] === j)),
    unmatched,
  };
}

function samePageInRadius(a: Location, b: Location, radius: number) {
  return a.sheet === b.sheet && a.generation === b.generation && a.page === b.page && distance(a, b) <= radius;
}
