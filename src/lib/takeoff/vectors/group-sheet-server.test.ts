import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import { GROUP_SHEET, planContactSheet } from "@/lib/takeoff/vectors/group-sheet";
import { renderGroupSheets, renderLegendExtract } from "@/lib/takeoff/vectors/group-sheet-server";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";

// Ways the images of the Decisions batches (TI-662 L3c, group-sheet-server.ts:
// a killable child process with @napi-rs/canvas, and pdfjs for the legend
// extract) could break a page's classification, written before the code. Real
// child processes, fictional geometry and PDF.
// - a tile is drawn at another place of the sheet than its plan (tile 2's
//   group in tile 1), the group not in its dark colour, or the context not in
//   light grey: the model reads another group;
// - the alias is not printed (the font is not registered and the text draws
//   nothing): the model cannot tell which tile it answers for;
// - no canvas module, a JPEG over its budget or a child past its deadline
//   throws (or hangs) instead of returning the reason, so the page is dropped
//   rather than left « à revoir »;
// - the legend extract throws on bytes that are not a PDF, or renders the whole
//   page when given a crop.

const SPAWN = { timeout: 60_000 } as const;
const RED = "#ff0000";
const BLUE = "#0000ff";

function page(strokes: ReadonlyArray<{ color: string; points: readonly number[] }>): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (const stroke of strokes) {
    let group = groups.findIndex((key) => key.color === stroke.color);
    if (group < 0) {
      group = groups.length;
      groups.push({ layer: null, color: stroke.color, width: 0.5, dash: null });
    }
    paths.push({ group, start: coordinates.length / 2, count: stroke.points.length / 2, closed: false });
    coordinates.push(...stroke.points);
  }
  return {
    page: 1, pages: 1, width: 1190.55, height: 841.89, userUnit: 1, rotate: 0, layers: [], groups, texts: [], paths,
    points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

async function pixels(data: string) {
  const image = await loadImage(Buffer.from(data, "base64"));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const at = (x: number, y: number) => {
    const [r, g, b] = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return { r, g, b };
  };
  const darkIn = (x0: number, y0: number, x1: number, y1: number) => {
    const { data: values } = context.getImageData(x0, y0, x1 - x0, y1 - y0);
    let dark = 0;
    for (let index = 0; index < values.length; index += 4) if (values[index] < 100 && values[index + 1] < 100 && values[index + 2] < 100) dark += 1;
    return dark;
  };
  const darkest = (x0: number, y0: number, x1: number, y1: number) => {
    const left = Math.round(x0), top = Math.round(y0);
    const { data: values } = context.getImageData(left, top, Math.round(x1) - left + 1, Math.round(y1) - top + 1);
    let best = { r: 255, g: 255, b: 255 };
    for (let index = 0; index < values.length; index += 4) {
      if (values[index] + values[index + 1] + values[index + 2] < best.r + best.g + best.b) best = { r: values[index], g: values[index + 1], b: values[index + 2] };
    }
    return best;
  };
  return { width: image.width, height: image.height, at, darkIn, darkest };
}

function sheetOfTwo() {
  // A red horizontal pipe crossed by a blue one; each group's tile shows the other as context.
  const model = buildPageModel(page([{ color: RED, points: [300, 400, 700, 400] }, { color: BLUE, points: [500, 300, 500, 500] }]));
  return planContactSheet(model, [{ alias: "groupe_01", group: 0 }, { alias: "groupe_02", group: 1 }]);
}

describe("Decisions images (group-sheet-server.ts)", () => {
  it("draws each tile where its plan says, the group dark and thick over light grey context, under its alias", SPAWN, async () => {
    const sheet = sheetOfTwo();
    const result = await renderGroupSheets([sheet]);
    expect(result.issue).toBeNull();
    const [image] = result.images;
    if (!image) throw new Error("no sheet");
    expect(image).toMatchObject({ mimeType: "image/jpeg", width: 6 * 384, height: 384 });
    expect(image.bytes).toBeLessThanOrEqual(GROUP_SHEET.maxBytes);
    const picture = await pixels(image.data);
    const [first, second] = sheet.tiles;
    // Tile 1: a point in the middle of the red pipe is dark red; a point of the blue pipe away from the crossing, light grey.
    const redMiddle = first.plan.group[0];
    const red = picture.at(first.x + redMiddle[0] + (redMiddle[2] - redMiddle[0]) / 4, first.y + redMiddle[1]);
    expect(red.r).toBeGreaterThan(90);
    expect(Math.max(red.g, red.b)).toBeLessThan(60);
    const context = first.plan.context[0];
    const cx = first.x + context[0], cy = first.y + context[1] + (context[3] - context[1]) / 6;
    const grey = picture.darkest(cx - 3, cy - 1, cx + 3, cy + 1);
    expect(Math.min(grey.r, grey.g, grey.b)).toBeGreaterThan(150);
    expect(Math.max(grey.r, grey.g, grey.b)).toBeLessThan(245);
    expect(Math.max(grey.r, grey.g, grey.b) - Math.min(grey.r, grey.g, grey.b)).toBeLessThan(30);
    // Tile 2: the blue pipe is dark blue, at its own tile's offset.
    const blueLine = second.plan.group[0];
    const blue = picture.at(second.x + blueLine[0], second.y + (blueLine[1] + blueLine[3]) / 2 + 20);
    expect(blue.b).toBeGreaterThan(90);
    expect(Math.max(blue.r, blue.g)).toBeLessThan(60);
    // The alias is printed in each tile's band; an empty tile slot stays white.
    expect(picture.darkIn(first.x, first.y, first.x + 200, first.y + GROUP_SHEET.labelPx)).toBeGreaterThan(40);
    expect(picture.darkIn(second.x, second.y, second.x + 200, second.y + GROUP_SHEET.labelPx)).toBeGreaterThan(40);
    expect(Math.min(...Object.values(picture.at(3 * 384 + 192, 192)))).toBeGreaterThan(240);
    expect(result.render_ms).toHaveLength(1);
  });

  it("returns the reason instead of throwing: no canvas, a JPEG over budget, a child past its deadline", SPAWN, async () => {
    const sheet = sheetOfTwo();
    await expect(renderGroupSheets([sheet], { canvasPath: null })).resolves.toMatchObject({ images: [null], issue: "canvas_unavailable" });
    await expect(renderGroupSheets([sheet], { maxBytes: 200 })).resolves.toMatchObject({ images: [null], issue: "too_large" });
    await expect(renderGroupSheets([sheet, sheet], { timeoutMs: 1 })).resolves.toMatchObject({ images: [null, null], issue: "timeout" });
  });

  it("renders the legend crop of a PDF page, the whole page without a crop, and no image for bytes that are not a PDF", SPAWN, async () => {
    const doc = await PDFDocument.create();
    const pdfPage = doc.addPage([600, 400]);
    pdfPage.drawRectangle({ x: 40, y: 300, width: 60, height: 40, color: rgb(1, 0, 0) });
    const bytes = await doc.save();
    const crop = await renderLegendExtract(bytes, 1, { x0: 30, y0: 50, x1: 110, y1: 110 });
    expect(crop.issue).toBeNull();
    expect([crop.image?.width, crop.image?.height]).toEqual([80 * GROUP_SHEET.legendMaxScale, 60 * GROUP_SHEET.legendMaxScale]);
    const centre = (await pixels(crop.image!.data)).at(40 * GROUP_SHEET.legendMaxScale, 30 * GROUP_SHEET.legendMaxScale);
    expect(centre.r).toBeGreaterThan(200);
    expect(centre.g).toBeLessThan(80);
    const whole = await renderLegendExtract(bytes, 1, null);
    expect([whole.image?.width, whole.image?.height]).toEqual([600, 400]);
    await expect(renderLegendExtract(new Uint8Array([1, 2, 3, 4]), 1, null)).resolves.toMatchObject({ image: null, issue: "render_failed" });
  });
});
