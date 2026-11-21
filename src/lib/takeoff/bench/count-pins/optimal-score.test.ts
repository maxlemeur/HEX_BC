import { expect, it } from "vitest";
import { scorePage } from "./score";
import type { JudgedPin } from "./types";

type FamilyFigures = { family: string | null; tp: number; fp: number; fn: number };
const byFamily = (figures: FamilyFigures[]) => figures.toSorted((a, b) => String(a.family).localeCompare(String(b.family)));

// Integer, horizontal coordinates make sums exact independently of the scorer.
function enumerateOptima(predictions: JudgedPin[], truth: JudgedPin[]) {
  let best = { cardinality: 0, distance: 0, poste: 0, dn: 0 };
  let common = new Set<number>();
  const families = [...new Set([...predictions, ...truth].map((pin) => pin.organ))];
  const current = new Set<number>();
  const matchedByFamily = () => new Map(families.map((family) => [family, {
    truth: [...current].filter((pair) => truth[pair % truth.length].organ === family).length,
    predictions: [...current].filter((pair) => predictions[Math.floor(pair / truth.length)].organ === family).length,
  }]));
  // Per family, the fewest matched truths and predictions over the optima, from the empty matching on.
  let fewest = matchedByFamily();
  function visit(i: number, assigned: Set<number>, distance: number, poste: number, dn: number) {
    if (i === predictions.length) {
      const cardinality = assigned.size;
      if (cardinality > best.cardinality || (cardinality === best.cardinality && distance < best.distance)) {
        best = { cardinality, distance, poste, dn };
        common = new Set(current);
        fewest = matchedByFamily();
      } else if (cardinality === best.cardinality && distance === best.distance) {
        best.poste = Math.min(best.poste, poste);
        best.dn = Math.min(best.dn, dn);
        for (const pair of common) if (!current.has(pair)) common.delete(pair);
        for (const [family, matched] of matchedByFamily()) {
          const least = fewest.get(family)!;
          least.truth = Math.min(least.truth, matched.truth);
          least.predictions = Math.min(least.predictions, matched.predictions);
        }
      }
      return;
    }
    visit(i + 1, assigned, distance, poste, dn);
    const prediction = predictions[i];
    for (const [j, reference] of truth.entries()) {
      const points = Math.abs(prediction.x - reference.x);
      if (assigned.has(j) || points > 4 || prediction.page !== reference.page) continue;
      const rightPoste = prediction.poste !== null && prediction.poste === reference.poste;
      const rightDn = rightPoste && prediction.dn !== null && prediction.dn === reference.dn;
      const pair = i * truth.length + j;
      assigned.add(j);
      current.add(pair);
      visit(i + 1, assigned, distance + points, poste + Number(rightPoste), dn + Number(rightDn));
      current.delete(pair);
      assigned.delete(j);
    }
  }
  visit(0, new Set(), 0, 0, 0);
  return {
    ...best,
    forcedPairs: [...common].map((pair) => [Math.floor(pair / truth.length), pair % truth.length]),
    families: families.map((family): FamilyFigures => {
      const familyTruth = truth.filter((pin) => pin.organ === family).length;
      const least = fewest.get(family)!;
      return {
        family,
        tp: least.truth,
        fp: predictions.filter((pin) => pin.organ === family).length - least.predictions,
        fn: familyTruth - least.truth,
      };
    }),
  };
}

it("matches exhaustive cardinality, distance and least favourable family figures without exceeding either minimum typed figure", () => {
  let state = 76;
  const random = (size: number) => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 12) % size;
  // A separate stream keeps the positions, pages and attributes of every earlier case.
  let familyState = 410;
  const randomFamily = (size: number) => ((familyState = (Math.imul(familyState, 1664525) + 1013904223) >>> 0) >>> 12) % size;
  const pin = (index: number, truth: boolean): JudgedPin => ({
    x: random(13), y: 0, sheet: "fiction", page: random(6) === 5 ? 2 : 1, generation: "generation",
    poste: ["pipe", "motor", truth ? "valve" : null][random(3)], dn: ["DN 20", "DN 32", null][random(3)],
    organ: (["vanne", "pompe", truth ? "vanne" : null] as const)[randomFamily(3)], method: "test", evidence: [String(index)],
  });
  for (let i = 0; i < 5000; i++) {
    const predictions = Array.from({ length: random(7) }, (_, j) => pin(j, false));
    const truth = Array.from({ length: random(7) }, (_, j) => pin(j, true));
    const expected = enumerateOptima(predictions, truth);
    const original = scorePage(predictions, truth, [], []);
    expect(new Set(original.forcedPairs), "forced pairs in case " + i).toEqual(new Set(expected.forcedPairs));
    expect(byFamily(original.drawingByFamily), "families in case " + i).toEqual(byFamily(expected.families));
    for (const [left, right] of [[predictions, truth], [predictions.toReversed(), truth], [predictions, truth.toReversed()]]) {
      const result = scorePage(left, right, [], []);
      const distance = result.pairs.reduce((sum, [p, q]) => sum + Math.abs(left[p].x - right[q].x), 0);
      expect([result.spatial.drawing.tp, distance], "case " + i).toEqual([expected.cardinality, expected.distance]);
      expect(result.spatial.poste.tp, "poste in case " + i).toBeLessThanOrEqual(expected.poste);
      expect(result.spatial.dn.tp, "DN in case " + i).toBeLessThanOrEqual(expected.dn);
      expect(result.spatial).toEqual(original.spatial);
      expect(byFamily(result.drawingByFamily), "families in order of case " + i).toEqual(byFamily(expected.families));
    }
  }
}, 15_000);
