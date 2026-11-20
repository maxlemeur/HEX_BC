import { expect, it } from "vitest";
import { matchPoints, scorePage } from "./score";
import type { JudgedPin } from "./types";

const pin = (x: number, dn: string | null = "DN 20", poste: string | null = "vanne-ef"): JudgedPin => ({
  x, y: 10, dn, organ: "vanne", poste, sheet: "a", generation: "a1", page: 1, method: "test", evidence: [],
});

it("maximizes cardinality before minimizing distance for nearby symbols", () => {
  expect(matchPoints([pin(1), pin(0)], [pin(0), pin(3)], 2)).toEqual([[0, 1], [1, 0]]);
  expect(matchPoints([pin(2), pin(0)], [pin(0), pin(2)], 3)).toEqual([[0, 1], [1, 0]]);
  expect(matchPoints([pin(0)], [pin(4)], 4)).toEqual([[0, 0]]);
});

it("keeps pairs spatially fixed when DN or poste is wrong at an otherwise exact total", () => {
  const truth = [pin(1), pin(20, "DN 32")];
  const swapped = scorePage([pin(1, "DN 32"), pin(20)], truth, [], []);
  expect(swapped.spatial.drawing.tp).toBe(2);
  expect(swapped.spatial.poste.tp).toBe(2);
  expect(swapped.spatial.dn).toMatchObject({ tp: 0, fp: 2, fn: 2 });
  const misplaced = scorePage([pin(50), pin(150, "DN 32")], truth, [], []);
  expect(misplaced.spatial.drawing).toMatchObject({ tp: 0, fp: 2, fn: 2 });
  const wrongPoste = scorePage([pin(1, "DN 20", "vanne-ecs")], [truth[0]], [], []);
  expect(wrongPoste.spatial.poste).toMatchObject({ tp: 0, fp: 1, fn: 1 });
});

it("counts one pair per object and rejects the wrong generation, sheet or physical page", () => {
  const a = pin(2);
  const score = scorePage([a, a, { ...a, sheet: "b" }, { ...a, page: 2 }, { ...a, generation: "a2" }], [a], [], []);
  expect(score.spatial.drawing).toMatchObject({ tp: 1, fp: 4, fn: 0 });
  expect(score.duplicates).toBe(1);
});

it("reports abstentions and does not credit a supplied example in the held-out score", () => {
  const score = scorePage([pin(1), pin(20, null), pin(40, null, null)], [pin(1), pin(20), pin(40)], [0], []);
  expect(score.spatial.drawing.tp).toBe(3);
  expect(score.spatial.dn).toMatchObject({ tp: 1, fp: 0, fn: 2 });
  expect(score.abstentions).toMatchObject({ poste: 1, dn: 1 });
  expect(score.withoutSuppliedExamples.drawing.tp).toBe(2);
  expect(score.withoutSuppliedExamples.dn).toMatchObject({ tp: 0, precision: null, recall: 0 });
  expect(scorePage([], [], [], []).spatial.drawing).toMatchObject({ precision: null, recall: null });
});

it("reserves the supplied prediction before pairing independent discoveries", () => {
  const score = scorePage([pin(10), pin(7)], [pin(10), pin(13)], [0], []);
  expect(score.spatial.drawing.tp).toBe(2);
  expect(score.withoutSuppliedExamples.drawing).toMatchObject({ tp: 0, fp: 1, fn: 1, precision: 0, recall: 0 });
});

it("awards the fewest typed true positives on a distance tie in either prediction order", () => {
  const truth = [pin(0), pin(4, "DN 32")];
  const predictions = [pin(2), pin(2, "DN 32")];
  const expected = { tp: 0, fp: 2, fn: 2 };
  expect(scorePage(predictions, truth, [], []).spatial.dn).toMatchObject(expected);
  expect(scorePage([...predictions].reverse(), [...truth].reverse(), [], []).spatial.dn).toMatchObject(expected);
});

it("takes the strictly shorter match even below a billionth of a point", () => {
  const score = scorePage([pin(2.0000000002), pin(2, "DN 32")], [pin(0)], [], []);
  expect(score.pairs).toEqual([[1, 0]]);
  expect(score.spatial.dn).toMatchObject({ tp: 0, fp: 2, fn: 1 });
});

it("counts a mark on the legend boundary as a false positive before matching", () => {
  const score = scorePage([pin(2)], [pin(5)], [], [{ name: "legend", contains: (point) => point.x <= 2 }]);
  for (const metrics of Object.values(score.spatial)) {
    expect(metrics).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  }
  expect(score.negativeZones).toEqual({ legend: 1 });
});

it.each([
  ["sheet", { sheet: "b" }],
  ["physical page", { page: 2 }],
  ["generation", { generation: "a2" }],
])("rejects a lone prediction from a foreign %s", (_, identity) => {
  const score = scorePage([{ ...pin(2), ...identity }], [pin(2)], [], []);
  expect(score.spatial.drawing).toMatchObject({ tp: 0, fp: 1, fn: 1 });
});
