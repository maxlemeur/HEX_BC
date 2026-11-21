import { expect, it } from "vitest";

import { indexSymbolPage } from "./symbols";
import type { VectorPageExtraction } from "../../vectors/extraction";

it("pins a rotated, reflected and doubled multipart drawing once, ignoring an isolated shared stroke", () => {
  const strokes = [
    [0, 0, 4, 0, 4, 1],
    [0, 2, 3, 2],
    [10, 10, 10, 18, 12, 18],
    [14, 16, 14, 10],
    [20, 20, 24, 20, 24, 21],
  ];
  let start = 0;
  const page = {
    paths: strokes.map((stroke) => {
      const path = { group: 0, start, count: stroke.length / 2, closed: false };
      start += path.count;
      return path;
    }),
    points: Float32Array.from(strokes.flat()),
    groups: [{ layer: null, color: "#000000" }],
    layers: [],
  } as unknown as VectorPageExtraction;
  const pins = indexSymbolPage(page).match([0, 1]);
  expect(pins.map(({ x, y }) => [x, y])).toEqual([
    [2, 1],
    [12, 14],
  ]);
});

it("finds a non-orthogonal scaled copy and rejects the same bounding box with a different interior vertex", () => {
  const triangle = [
    [2, 2],
    [7, 2],
    [4, 5],
  ];
  const copy = triangle.map(([x, y]) => [100 + 0.9 * x - 1.2 * y, 80 + 1.2 * x + 0.9 * y]);
  const page = {
    paths: [0, 3, 6].map((start) => ({ start, group: 0, count: 3, closed: false })),
    points: Float32Array.from([...triangle, ...copy, [22, 2], [27, 2], [26, 5]].flat()),
    groups: [{ layer: null, color: "#000000" }],
    layers: [],
  } as unknown as VectorPageExtraction;
  const pins = indexSymbolPage(page).match([0]);
  expect(pins).toHaveLength(2);
  expect(pins.some((pin) => Math.abs(pin.scale - 1.5) < 0.001)).toBe(true);
});
