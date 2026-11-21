import { expect, it } from "vitest";
import type { NetworkRun } from "../../vectors/measure";
import { attachedSize } from "./pipes";

const pin = {
  x: 0,
  y: 0,
  ports: [
    { x: -5, y: 0 },
    { x: 5, y: 0 },
  ],
};
function run(x0: number, y0: number, x1: number, y1: number, dn = 20): NetworkRun {
  return {
    network: "EF",
    candidates: [],
    segment: { x0, y0, x1, y1 },
    dn,
    notation: "DN",
    attached: "label",
    material: null,
    length_pt: 40,
    width_pt: 1,
    label: null,
    insulated: false,
  };
}
const left = run(-45, 0, -5, 0),
  right = run(5, 0, 45, 0);
it("requires two distinct outward run ends on opposite drawing ports", () => {
  expect(attachedSize(pin, [left, right])).toBe("DN 20");
  expect(attachedSize(pin, [left])).toBeNull();
  expect(attachedSize(pin, [left, run(5, 1, 45, 1)])).toBeNull();
  expect(attachedSize(pin, [left, run(5, 0, 45, 0, 32)])).toBeNull();
  expect(attachedSize(pin, [left, right, run(5, 0, 5, 30)])).toBeNull();
  expect(attachedSize(pin, [left, right, run(0, -30, 0, 30)])).toBeNull();
});
