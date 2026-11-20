import { expect, it } from "vitest";
import { combine } from "./fusion";
import type { Pin } from "./types";

const pin = (x: number, dn: string | null): Pin => ({
  x,
  y: 0,
  sheet: "a",
  generation: "a1",
  page: 1,
  organ: "vanne",
  dn,
  method: "label",
  evidence: ["A"],
});
it("pairs only across readers, preserves neighbours, and exposes diameter conflicts", () => {
  const result = combine([pin(0, "DN 20"), pin(3, "DN 32")], [pin(1, null), pin(4, "DN 25")], 4);
  expect(result.map((p) => p.dn)).toEqual(["DN 20", null]);
  expect(result[1].evidence).toContain("conflicting-DN");
  expect(combine(result, [pin(4, "DN 32")], 4)[1].dn).toBeNull();
});
