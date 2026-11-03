import { describe, expect, it } from "vitest";

import { lightnessSaturation, parseHexColor } from "@/lib/takeoff/vectors/colors";
import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import { darkRendition, GROUP_SHEET, legendCrop, planContactSheet, planDedicated, planTile } from "@/lib/takeoff/vectors/group-sheet";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";

// Ways the images of the Decisions batches (TI-662 L3c, group-sheet.ts: what
// each tile draws, computed from the extracted geometry) could mislead the
// model or blow the call's bounds, written before the code. Pages are
// fictional hand-built extractions.
// - a tile stretches its group (a 100 × 10 pt run drawn as a square), or
//   crops it: a point of the group falls outside its tile;
// - the context draws a stroke far outside the tile's window, a stroke of a
//   hidden layer (not printed), or the group itself in grey;
// - a group of 100 000 strokes is drawn whole: the child process's input and
//   the JPEG grow without bound (points capped per tile, subsampled);
// - the dark rendition of a light colour (a pale yellow) stays light, or of a
//   red turns another hue; a grey group turns a colour;
// - a contact sheet of 36 groups is not 6 × 6 tiles of 384 px, two tiles
//   overlap, or a tile loses its alias;
// - the legend crop is not the union of the legend boxes with a margin, or
//   runs off the page.

const A3 = { width: 1190.55, height: 841.89 };
type Stroke = { color: string; points: readonly number[]; layer?: string | null };

function page(strokes: readonly Stroke[], layers: ReadonlyArray<{ id: string; visible: boolean }> = []): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const index = new Map<string, number>();
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (const stroke of strokes) {
    const key: VectorGroupKey = { layer: stroke.layer ?? null, color: stroke.color, width: 0.5, dash: null };
    const id = JSON.stringify(key);
    let group = index.get(id);
    if (group === undefined) {
      group = groups.length;
      index.set(id, group);
      groups.push(key);
    }
    paths.push({ group, start: coordinates.length / 2, count: stroke.points.length / 2, closed: false });
    coordinates.push(...stroke.points);
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0,
    layers: layers.map((layer) => ({ id: layer.id, name: `FICTIF_${layer.id}`, visible: layer.visible })),
    groups, texts: [], paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

const RED = "#ff0000";
const BLUE = "#0000ff";

function allPoints(polylines: readonly (readonly number[])[]) {
  return polylines.reduce((sum, polyline) => sum + polyline.length / 2, 0);
}

describe("tiles of the Decisions images (group-sheet.ts)", () => {
  it("draws the group whole, unstretched, over the context inside its window only", () => {
    const extraction = page([
      { color: RED, points: [500, 400, 600, 400, 600, 410] },
      { color: BLUE, points: [480, 405, 620, 405] }, // crosses the window: context
      { color: BLUE, points: [50, 50, 80, 50] }, // far away: not drawn
    ]);
    const model = buildPageModel(extraction);
    const red = model.groups.findIndex((group) => group.key.color === RED);
    const tile = planTile(model, red, GROUP_SHEET.tilePx, "tile");
    const xs = tile.group.flatMap((polyline) => polyline.filter((_, index) => index % 2 === 0));
    const ys = tile.group.flatMap((polyline) => polyline.filter((_, index) => index % 2 === 1));
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(GROUP_SHEET.tilePx);
    expect(Math.min(...ys)).toBeGreaterThan(GROUP_SHEET.labelPx);
    expect(Math.max(...ys)).toBeLessThan(GROUP_SHEET.tilePx);
    // 100 pt across and 10 pt down keep their ratio.
    expect((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))).toBeCloseTo(10, 1);
    expect(tile.window.x0).toBeLessThan(500);
    expect(tile.window.x1).toBeGreaterThan(600);
    expect(tile.context).toHaveLength(1);
    expect(allPoints(tile.context)).toBe(2);
    expect(tile.color).not.toBe(RED);
  });

  it("never draws a hidden layer's strokes as context", () => {
    const extraction = page([
      { color: RED, points: [500, 400, 600, 400] },
      { color: BLUE, points: [480, 402, 620, 402], layer: "OFF" },
    ], [{ id: "OFF", visible: false }]);
    const model = buildPageModel(extraction);
    const red = model.groups.findIndex((group) => group.key.color === RED);
    expect(planTile(model, red, GROUP_SHEET.tilePx, "tile").context).toEqual([]);
  });

  it("caps the points of a huge group and of its context", () => {
    const strokes: Stroke[] = [];
    for (let index = 0; index < 100_000; index += 1) strokes.push({ color: RED, points: [100 + (index % 1000), 100 + Math.floor(index / 1000) * 6, 100.5 + (index % 1000), 100 + Math.floor(index / 1000) * 6] });
    for (let index = 0; index < 50_000; index += 1) strokes.push({ color: BLUE, points: [100, 101 + index * 0.01, 1100, 101 + index * 0.01] });
    const model = buildPageModel(page(strokes));
    const red = model.groups.findIndex((group) => group.key.color === RED);
    const tile = planTile(model, red, GROUP_SHEET.tilePx, "tile");
    expect(allPoints(tile.group)).toBeLessThanOrEqual(GROUP_SHEET.maxPoints.tile);
    expect(allPoints(tile.group)).toBeGreaterThan(GROUP_SHEET.maxPoints.tile / 4);
    expect(allPoints(tile.context)).toBeLessThanOrEqual(GROUP_SHEET.maxPoints.tile);
    expect(tile.points).toMatchObject({ groupTotal: 200_000, contextTotal: 100_000 });
    const dedicated = planDedicated(model, { alias: "groupe_01", group: red });
    expect(allPoints(dedicated.tiles[0].plan.group)).toBeLessThanOrEqual(GROUP_SHEET.maxPoints.dedicated);
    expect(dedicated).toMatchObject({ width: GROUP_SHEET.dedicatedPx, height: GROUP_SHEET.dedicatedPx });
  });

  it("darkens a colour within its hue, a grey to a dark grey", () => {
    const red = parseHexColor(darkRendition("#ff0000"))!;
    expect(lightnessSaturation(red).lightness).toBeLessThanOrEqual(0.35);
    expect(red.r).toBeGreaterThan(3 * Math.max(red.g, red.b, 1));
    const yellow = parseHexColor(darkRendition("#ffff80"))!;
    expect(lightnessSaturation(yellow).lightness).toBeLessThanOrEqual(0.35);
    expect(Math.abs(yellow.r - yellow.g)).toBeLessThanOrEqual(2);
    expect(yellow.b).toBeLessThan(yellow.r);
    const grey = parseHexColor(darkRendition("#c0c0c0"))!;
    expect(grey.r).toBe(grey.g);
    expect(grey.g).toBe(grey.b);
    expect(grey.r).toBeLessThan(100);
    expect(darkRendition("pattern")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("contact sheets and legend crop (group-sheet.ts)", () => {
  it("lays 36 groups as 6 × 6 tiles of 384 px, each with its alias, never overlapping", () => {
    const strokes = Array.from({ length: 36 }, (_, index) => ({ color: `#ff00${(index * 7).toString(16).padStart(2, "0")}`, points: [100, 20 + 20 * index, 900, 20 + 20 * index] }));
    const model = buildPageModel(page(strokes));
    const sheet = planContactSheet(model, model.groups.map((_, index) => ({ alias: `groupe_${String(index + 1).padStart(2, "0")}`, group: index })));
    expect(sheet).toMatchObject({ width: 6 * 384, height: 6 * 384 });
    expect(sheet.tiles.map((tile) => tile.label)).toEqual(model.groups.map((_, index) => `groupe_${String(index + 1).padStart(2, "0")}`));
    expect(new Set(sheet.tiles.map((tile) => `${tile.x},${tile.y}`)).size).toBe(36);
    expect(sheet.tiles.every((tile) => tile.x % 384 === 0 && tile.y % 384 === 0 && tile.size === 384)).toBe(true);
    const seven = planContactSheet(model, model.groups.slice(0, 7).map((_, index) => ({ alias: `groupe_0${index + 1}`, group: index })));
    expect(seven).toMatchObject({ width: 6 * 384, height: 2 * 384 });
  });

  it("crops the legend boxes with a margin, inside the page; none without a legend", () => {
    expect(legendCrop([{ x0: 20, y0: 30, x1: 120, y1: 80 }, { x0: 100, y0: 70, x1: 200, y1: 140 }], A3.width, A3.height))
      .toEqual({ x0: 20 - GROUP_SHEET.legendMarginPt, y0: 30 - GROUP_SHEET.legendMarginPt, x1: 200 + GROUP_SHEET.legendMarginPt, y1: 140 + GROUP_SHEET.legendMarginPt });
    expect(legendCrop([{ x0: 2, y0: 3, x1: 1189, y1: 840 }], A3.width, A3.height)).toEqual({ x0: 0, y0: 0, x1: A3.width, y1: A3.height });
    expect(legendCrop([], A3.width, A3.height)).toBeNull();
  });
});
