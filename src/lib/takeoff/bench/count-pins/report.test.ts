import { expect, it } from "vitest";
import { compareReaders, quantityScore } from "./report";
import type { JudgedPin, Poste } from "./types";

const target: Poste = { id: "vanne-ef", organ: "vanne", basis: "installed", discriminants: ["EF"], requiresDn: true };
const pin = (x: number, dn: string | null, page = 1): JudgedPin => ({
  x, y: 10, dn, organ: "vanne", poste: target.id, sheet: "f", generation: "g", page, method: "test", evidence: [],
});

it("scores exact whole-poste quantities independently of placement, over all original pages", () => {
  const truth = [pin(2, "DN 20"), pin(20, "DN 32"), pin(5, "DN 20", 2)];
  expect(quantityScore([pin(2, "DN 32"), pin(20, "DN 20"), pin(105, "DN 20", 2)], truth, [target]))
    .toMatchObject({ keys: 2, found: 2, exact: 2, missed: 0, extra: 0 });
});

it("counts a wrong DN as missed and extra and keeps DN abstentions out of read keys", () => {
  expect(quantityScore([pin(2, "DN 25"), pin(20, null)], [pin(2, "DN 20"), pin(20, "DN 32")], [target]))
    .toMatchObject({ keys: 2, found: 0, exact: 0, missed: 2, extra: 1 });
});

it("withholds whole-poste exactness when an extra position has an unresolved required DN", () => {
  const result = quantityScore([pin(2, "DN 20"), pin(20, null)], [pin(2, "DN 20")], [target]);
  expect(result.exact).toBe(1);
  expect(result.wholePostes).toEqual([{ poste: target.id, expected: 1, proposed: 2, unresolvedDn: 1, exact: false }]);
});

it("reports one reader agreement and both reader-only positions despite equal totals", () => {
  const left = [pin(1, "DN 20"), pin(50, "DN 20")];
  const right = [pin(1, "DN 20"), pin(150, "DN 20")];
  expect(compareReaders(left, right)).toEqual([
    { poste: target.id, dn: "DN 20", matches: [[[1, 10], [1, 10]]], leftOnly: [[50, 10]], rightOnly: [[150, 10]] },
  ]);
});
