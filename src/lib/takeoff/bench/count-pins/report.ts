import { MATCH_RADIUS, matchPoints, metrics, type scorePage } from "./score";
import type { JudgedPin, Poste } from "./types";

export function quantityScore(
  proposals: JudgedPin[], truth: JudgedPin[], targets: readonly Poste[], complete = true,
) {
  const requiresDn = new Set(targets.filter((target) => target.requiresDn).map((target) => target.id));
  function counts(pins: JudgedPin[]) {
    const totals = new Map<string, number>();
    for (const pin of pins) {
      if (!pin.poste || (requiresDn.has(pin.poste) && pin.dn === null)) continue;
      const key = JSON.stringify([pin.poste, requiresDn.has(pin.poste) ? pin.dn : null]);
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    return totals;
  }
  const observed = counts(proposals);
  const expected = counts(truth);
  const perKey = [...new Set([...expected.keys(), ...observed.keys()])].sort().map((key) => {
    const [poste, dn] = JSON.parse(key) as [string, string | null];
    return { poste, dn, expected: expected.get(key) ?? 0, proposed: observed.get(key) ?? 0 };
  });
  const found = perKey.filter((key) => key.expected > 0 && key.proposed > 0);
  return {
    complete,
    keys: expected.size, found: found.length,
    exact: complete ? found.filter((key) => key.expected === key.proposed).length : null,
    withinOne: complete ? found.filter((key) => Math.abs(key.expected - key.proposed) <= 1).length : null,
    missed: expected.size - found.length,
    extra: perKey.length - expected.size,
    perKey,
    wholePostes: targets.map(({ id }) => {
      const entries = perKey.filter((entry) => entry.poste === id);
      const unresolvedDn = requiresDn.has(id)
        ? proposals.filter((pin) => pin.poste === id && pin.dn === null).length
        : 0;
      return {
        poste: id,
        expected: entries.reduce((sum, entry) => sum + entry.expected, 0),
        proposed: entries.reduce((sum, entry) => sum + entry.proposed, unresolvedDn),
        unresolvedDn,
        exact: complete ? unresolvedDn === 0 && entries.every((entry) => entry.expected === entry.proposed) : null,
      };
    }),
  };
}

type Spatial = ReturnType<typeof scorePage>["spatial"];
export function aggregateSpatial(scores: Spatial[]) {
  if (scores.length === 0) return null;
  function aggregate(key: keyof Spatial) {
    let tp = 0;
    let predicted = 0;
    let expected = 0;
    for (const score of scores) {
      tp += score[key].tp;
      predicted += score[key].tp + score[key].fp;
      expected += score[key].tp + score[key].fn;
    }
    return metrics(tp, predicted, expected);
  }
  return { drawing: aggregate("drawing"), poste: aggregate("poste"), dn: aggregate("dn") };
}

export function compareReaders(left: JudgedPin[], right: JudgedPin[]) {
  const key = (pin: JudgedPin) => JSON.stringify([pin.poste, pin.dn]);
  const point = ({ x, y }: JudgedPin): [number, number] => [x, y];
  return [...new Set([...left, ...right].map(key))].sort().map((id) => {
    const [poste, dn] = JSON.parse(id) as [string | null, string | null];
    const leftGroup = left.filter((pin) => key(pin) === id);
    const rightGroup = right.filter((pin) => key(pin) === id);
    const pairs = poste === null ? [] : matchPoints(leftGroup, rightGroup, MATCH_RADIUS);
    const matchedLeft = new Set(pairs.map(([i]) => i));
    const matchedRight = new Set(pairs.map(([, j]) => j));
    return {
      poste, dn,
      matches: pairs.map(([i, j]) => [point(leftGroup[i]), point(rightGroup[j])]),
      leftOnly: leftGroup.filter((_, i) => !matchedLeft.has(i)).map(point),
      rightOnly: rightGroup.filter((_, j) => !matchedRight.has(j)).map(point),
    };
  });
}
