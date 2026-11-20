import type { Box } from "../../vectors/geometry";
import { distance, type JudgedPin, type Location } from "./types";

type Pair = [number, number];
type Edge = { j: number; cost: bigint };
type Exclusion = { pair?: Pair; left?: number; right?: number };

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

function matchingEdges(left: Location[], right: Location[], radius: number): Edge[][] {
  const bytes = new DataView(new ArrayBuffer(8));
  return left.map((a) => right.flatMap((b, j) => {
    const d = matchDistance(a, b, radius);
    return d === null ? [] : [{ j, cost: distanceUnits(d, bytes) }];
  }));
}

// Successive shortest augmenting paths. The reverse edge removes the cost of
// an old pair, and exclusions let the scorer test whether an optimum survives.
function solveMatching(edges: Edge[][], rightCount: number, exclude: Exclusion = {}) {
  const mate = edges.map(() => -1);
  const owner = new Array<number>(rightCount).fill(-1);
  const matchedCost = edges.map(() => BigInt(0));
  for (;;) {
    const dl = mate.map((j) => j < 0 ? BigInt(0) : null);
    const dr = new Array<bigint | null>(rightCount).fill(null);
    const via = new Array<number>(rightCount).fill(-1);
    const viaCost = new Array<bigint>(rightCount).fill(BigInt(0));
    const queue = mate.flatMap((j, i) => j < 0 && i !== exclude.left ? [i] : []);
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      for (const { j, cost } of edges[i]) {
        if (j === mate[i] || j === exclude.right || (i === exclude.pair?.[0] && j === exclude.pair[1])) continue;
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
  return {
    pairs: mate.flatMap((j, i) => j < 0 ? [] : [[i, j] as Pair]),
    distance: matchedCost.reduce((sum, cost) => sum + cost, BigInt(0)),
  };
}

export function matchPoints(left: Location[], right: Location[], radius: number): Pair[] {
  return solveMatching(matchingEdges(left, right, radius), right.length).pairs;
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
export const NEGATIVE_ZONE_TOLERANCE = 1e-6;

type NegativeZone = { name: string; contains: (pin: Location) => boolean };

export function negativeZone(name: string, bounds: Box): NegativeZone {
  const tolerance = NEGATIVE_ZONE_TOLERANCE;
  return {
    name,
    contains: ({ x, y }) => x >= bounds.x0 - tolerance && x <= bounds.x1 + tolerance &&
      y >= bounds.y0 - tolerance && y <= bounds.y1 + tolerance,
  };
}

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

function matchScoredPins(proposed: JudgedPin[], truth: JudgedPin[], candidateIndices: number[]) {
  const left = orderedPins(proposed, candidateIndices);
  const right = orderedPins(truth, truth.map((_, i) => i));
  const edges = matchingEdges(left.map(({ pin }) => pin), right.map(({ pin }) => pin), MATCH_RADIUS);
  const optimum = solveMatching(edges, right.length);
  const preservesOptimum = (exclude: Exclusion) => {
    const alternative = solveMatching(edges, right.length, exclude);
    return alternative.pairs.length === optimum.pairs.length && alternative.distance === optimum.distance;
  };
  const forced = optimum.pairs.filter((pair) => !preservesOptimum({ pair }));
  const forcedLeft = new Set(forced.map(([i]) => i));
  const forcedRight = new Set(forced.map(([, j]) => j));
  const leftCanBeUnmatched = new Set(candidateIndices);
  const alwaysMatchedTruth: number[] = [];
  for (const [i, j] of optimum.pairs) {
    if (forcedLeft.has(i) || !preservesOptimum({ left: i })) leftCanBeUnmatched.delete(left[i].index);
    if (forcedRight.has(j) || !preservesOptimum({ right: j })) alwaysMatchedTruth.push(right[j].index);
  }
  const originalIndices = ([i, j]: Pair): Pair => [left[i].index, right[j].index];
  return {
    pairs: optimum.pairs.map(originalIndices),
    forcedPairs: forced.map(originalIndices),
    leftCanBeUnmatched,
    alwaysMatchedTruth,
  };
}

function scoreWithoutExamples(
  proposed: JudgedPin[], truth: JudgedPin[], eligible: number[], supplied: Set<number>,
) {
  const references = orderedPins(truth, truth.map((_, i) => i));
  const echoes = new Set<number>();
  const firstEcho = new Map<number, { prediction: number; distance: number }>();
  for (const { pin, index } of orderedPins(proposed, eligible)) {
    let nearest: { truthIndex: number; distance: number } | undefined;
    for (const reference of references) {
      const d = matchDistance(pin, reference.pin, MATCH_RADIUS);
      if (d === null) continue;
      if (!nearest || d < nearest.distance ||
        (d === nearest.distance && supplied.has(reference.index) && !supplied.has(nearest.truthIndex))) {
        nearest = { truthIndex: reference.index, distance: d };
      }
    }
    if (!nearest || !supplied.has(nearest.truthIndex)) continue;
    echoes.add(index);
    const previous = firstEcho.get(nearest.truthIndex);
    if (!previous || nearest.distance < previous.distance) {
      firstEcho.set(nearest.truthIndex, { prediction: index, distance: nearest.distance });
    }
  }
  const consumed = new Set([...firstEcho.values()].map(({ prediction }) => prediction));
  const eligibleSet = new Set(eligible);
  const remaining = proposed.flatMap((pin, i) => consumed.has(i) ? [] : [{ pin, index: i }]);
  const independent = truth.filter((_, i) => !supplied.has(i));
  const discoveries = remaining.flatMap(({ index }, i) => eligibleSet.has(index) && !echoes.has(index) ? [i] : []);
  const pins = remaining.map(({ pin }) => pin);
  const matching = matchScoredPins(pins, independent, discoveries);
  return {
    spatial: spatialScore(pins, independent, matching.pairs, matching.forcedPairs),
    consumed: consumed.size,
    duplicateEchoes: echoes.size - consumed.size,
  };
}

function spatialScore(proposed: JudgedPin[], truth: JudgedPin[], pairs: Pair[], forcedPairs: Pair[]) {
  const named = forcedPairs.filter(([i, j]) => correctPoste(proposed[i], truth[j]));
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
  const { pairs, forcedPairs, leftCanBeUnmatched, alwaysMatchedTruth } = matchScoredPins(proposed, truth, eligible);
  const matched = new Set(pairs.map(([i]) => i));
  const eligibleSet = new Set(eligible);
  const matchedTruth = new Set(pairs.map(([, j]) => j));
  const supplied = new Set(suppliedTruth);
  const spatial = spatialScore(proposed, truth, pairs, forcedPairs);
  const heldOut = supplied.size > 0
    ? scoreWithoutExamples(proposed, truth, eligible, supplied)
    : { spatial, consumed: 0, duplicateEchoes: 0 };
  const unmatched = proposed.filter((_, i) => !matched.has(i));
  return {
    spatial,
    withoutSuppliedExamples: heldOut.spatial,
    suppliedExamples: {
      occurrences: supplied.size,
      spatiallyPaired: heldOut.consumed,
      duplicateEchoes: heldOut.duplicateEchoes,
    },
    abstentions: {
      poste: proposed.filter((p) => p.poste === null).length,
      dn: forcedPairs.filter(([i, j]) => truth[j].dn !== null && correctPoste(proposed[i], truth[j]) && proposed[i].dn === null).length,
    },
    contradictions: proposed.filter((p) => p.evidence.includes("conflicting-DN")).length,
    duplicates: unmatched.filter((p) => truth.some((t) => samePageInRadius(p, t, MATCH_RADIUS))).length,
    negativeZones,
    pairs,
    forcedPairs,
    alwaysMatchedTruth,
    missed: truth.filter((_, j) => !matchedTruth.has(j)),
    unmatched,
    possiblyUnmatched: proposed.filter((_, i) => !eligibleSet.has(i) || leftCanBeUnmatched.has(i)),
  };
}

function matchDistance(a: Location, b: Location, radius: number) {
  if (a.sheet !== b.sheet || a.generation !== b.generation || a.page !== b.page) return null;
  const points = distance(a, b);
  return points <= radius ? points : null;
}

export function samePageInRadius(a: Location, b: Location, radius: number) {
  return matchDistance(a, b, radius) !== null;
}
