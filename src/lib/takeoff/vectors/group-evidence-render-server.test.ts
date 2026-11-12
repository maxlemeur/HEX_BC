import { createCanvas, loadImage } from "@napi-rs/canvas";
import { concatTransformationMatrix, drawObject, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { EvidenceImagePlan } from "@/lib/takeoff/vectors/group-evidence-images";
import { GROUP_EVIDENCE_IMAGES } from "@/lib/takeoff/vectors/group-evidence-images";
import { renderGroupEvidence, startGroupEvidenceRender } from "@/lib/takeoff/vectors/group-evidence-render-server";

// Ways the images of the v2 group questions (TI-704,
// group-evidence-render-server.ts: one killable child, real PDF.js and
// @napi-rs/canvas) could mislead the model or cost the page, written before
// the code. Fictional PDFs built here.
// - panel A is not the real plan where the group lies (another window, its
//   texts missing), B does not redraw the group in its true colour, C and D do
//   not frame the window of the panel before, a caption is missing;
// - a legend block is drawn without its texts;
// - the page is analysed again for every group: each window costs a whole
//   drawing of the page (2.8 s a group on the heaviest development page);
// - a raster above maxEmbeddedImagePixels stops the drawing, and what is
//   painted after it (texts, strokes) is lost (TI-715);
// - no canvas module, a JPEG over budget, a child past its deadline or bytes
//   that are not a PDF throw (or hang) instead of returning the reason.

const SPAWN = { timeout: 90_000 } as const;
const P = GROUP_EVIDENCE_IMAGES.panelPx, C = GROUP_EVIDENCE_IMAGES.captionPx;

async function pixels(data: string) {
  const image = await loadImage(Buffer.from(data, "base64"));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  /** Pixels of the box whose colour `test` accepts, as a share of the box. */
  const share = (box: { x0: number; y0: number; x1: number; y1: number }, test: (r: number, g: number, b: number) => boolean) => {
    const { data: values } = context.getImageData(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    let hits = 0;
    for (let index = 0; index < values.length; index += 4) if (test(values[index], values[index + 1], values[index + 2])) hits += 1;
    return hits / (values.length / 4);
  };
  return { width: image.width, height: image.height, share };
}

const dark = (r: number, g: number, b: number) => r < 90 && g < 90 && b < 90;
const red = (r: number, g: number, b: number) => r > 180 && g < 90 && b < 90;
/** The frame's magenta, through the JPEG's subsampled chroma on a 1.5 px line. */
const magenta = (r: number, g: number, b: number) => r > 150 && b > 150 && g < 140;

/** An A3 landscape plan: a red pipe at y 400 (page space, y down) from x 300 to 900, its label above it, a legend text far left. */
async function plan() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([1190.55, 841.89]);
  const flip = (y: number) => 841.89 - y;
  page.drawLine({ start: { x: 300, y: flip(400) }, end: { x: 900, y: flip(400) }, thickness: 2, color: rgb(1, 0, 0) });
  page.drawText("XYZ DN 25", { x: 500, y: flip(380), size: 12, font, color: rgb(0, 0, 0) });
  page.drawText("LEGENDE FICTIVE", { x: 40, y: flip(80), size: 14, font, color: rgb(0, 0, 0) });
  return doc.save();
}

/** The plan of one group (the red pipe, A's window on it) and one legend block (the legend text). */
function evidencePlan(): EvidenceImagePlan {
  return {
    page: 1,
    legends: [{ box: { x0: 30, y0: 55, x1: 230, y1: 90 }, scale: 5 }],
    groups: [{ alias: "groupe_01", detail: { x0: 520, y0: 320, x1: 680, y1: 480 }, context: { x0: 200, y0: 0, x1: 1000, y1: 800 },
      paths: [{ color: "#ff0000", width: 2, outline: false, points: [300, 400, 900, 400] }], points: { drawn: 2, total: 2 } }],
  };
}

describe("images of the v2 group questions (group-evidence-render-server.ts)", () => {
  it("draws A the real plan over the group's window, B the group in its colour, C and D framed, and the legend with its texts", SPAWN, async () => {
    const result = await renderGroupEvidence(await plan(), evidencePlan());
    expect(result.issue).toBeNull();
    expect(result.dropped_images).toBe(0);
    const [image] = result.groups;
    expect([image?.width, image?.height]).toEqual([2 * P, 2 * P]);
    const sheet = await pixels(image!.data);
    // A: the pipe (y 400, the window from 320) and its label (y 380 to 368) in the real plan, at 3.06 px/pt.
    const scale = (P - C) / GROUP_EVIDENCE_IMAGES.detailPt;
    const pipeY = Math.round(C + (400 - 320) * scale);
    expect(sheet.share({ x0: 20, y0: pipeY - 4, x1: P - 20, y1: pipeY + 4 }, red)).toBeGreaterThan(0.3);
    expect(sheet.share({ x0: 0, y0: C + Math.round((366 - 320) * scale), x1: P, y1: C + Math.round((381 - 320) * scale) }, dark)).toBeGreaterThan(0.02);
    // Every caption printed.
    for (const [x, y] of [[0, 0], [P, 0], [0, P], [P, P]]) expect(sheet.share({ x0: x + 4, y0: y + 4, x1: x + 260, y1: y + C - 4 }, dark)).toBeGreaterThan(0.02);
    // B: the faded view, the group redrawn in its red over it.
    expect(sheet.share({ x0: P + 20, y0: pipeY - 3, x1: 2 * P - 20, y1: pipeY + 3 }, red)).toBeGreaterThan(0.5);
    // C and D: the window of the panel before, framed in magenta.
    expect(sheet.share({ x0: 0, y0: P + C, x1: P, y1: 2 * P }, magenta)).toBeGreaterThan(0.001);
    expect(sheet.share({ x0: P, y0: P + C, x1: 2 * P, y1: 2 * P }, magenta)).toBeGreaterThan(0.0005);
    // The legend block at 5 px/pt with its text.
    const [legend] = result.legends;
    expect([legend?.width, legend?.height]).toEqual([1000, 175]);
    expect((await pixels(legend!.data)).share({ x0: 0, y0: 0, x1: 1000, y1: 175 }, dark)).toBeGreaterThan(0.03);
    expect(result.render_ms.page).not.toBeNull();
    expect(result.render_ms.groups[0]).not.toBeNull();
  });

  it("analyses a heavy page once: each window drawn costs a fraction of the page", SPAWN, async () => {
    // 150 000 strokes over the whole page; six groups asked.
    const doc = await PDFDocument.create();
    const page = doc.addPage([1190.55, 841.89]);
    const strokes = Array.from({ length: 150_000 }, (_, index) => `${(index * 7) % 1190} ${(index * 13) % 841} m ${((index * 7) % 1190) + 3} ${(index * 13) % 841} l S`).join("\n");
    page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(`0 0 1 RG\n${strokes}`)));
    const groups = Array.from({ length: 6 }, (_, index) => ({ alias: `groupe_0${index + 1}`, detail: { x0: 100 * index, y0: 100, x1: 100 * index + 160, y1: 260 },
      context: { x0: 0, y0: 0, x1: 800, y1: 800 }, paths: [{ color: "#ff0000", width: 1, outline: false, points: [100 * index, 180, 100 * index + 160, 180] }],
      points: { drawn: 2, total: 2 } }));
    const result = await renderGroupEvidence(await doc.save(), { page: 1, legends: [], groups });
    expect(result.issue).toBeNull();
    const pageMs = result.render_ms.page as number;
    const windows = result.render_ms.groups as number[];
    expect(windows).toHaveLength(6);
    // A window holds about 2 % of the page's strokes: drawing it again in full would cost about the page.
    expect(Math.max(...windows)).toBeLessThan(pageMs / 2);
  });

  it("starts the page's analysis before its plan: ready once the child has the PDF, drawn later, or cancelled unused", SPAWN, async () => {
    const bytes = await plan();
    const session = startGroupEvidenceRender(bytes, 1);
    await session.ready;
    // The caller computes its evidence here; the child is analysing the page meanwhile.
    const drawn = await session.draw(evidencePlan());
    expect(drawn.issue).toBeNull();
    expect(drawn.groups[0]?.width).toBe(2 * P);
    // A plan sent twice is drawn once.
    expect(await session.draw(evidencePlan())).toBe(drawn);
    const unused = startGroupEvidenceRender(bytes, 1);
    await unused.ready;
    unused.cancel();
    expect(await unused.draw(evidencePlan())).toMatchObject({ groups: [null], legends: [null] });
  });

  it("keeps what a page paints after a raster above the bound, and counts that raster", SPAWN, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([1190.55, 841.89]);
    const side = 4000;
    const raster = doc.context.register(doc.context.flateStream(new Uint8Array((side / 8) * side).fill(0xff), {
      Type: "XObject", Subtype: "Image", Width: side, Height: side, ColorSpace: "DeviceGray", BitsPerComponent: 1,
    }));
    page.node.setXObject(PDFName.of("Im0"), raster);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(100, 0, 0, 100, 450, 250), drawObject("Im0"), popGraphicsState());
    page.drawText("LEGENDE FICTIVE", { x: 40, y: 841.89 - 80, size: 14, font, color: rgb(0, 0, 0) });
    const result = await renderGroupEvidence(await doc.save(), { page: 1, legends: [{ box: { x0: 30, y0: 55, x1: 230, y1: 90 }, scale: 5 }], groups: [] });
    expect(result.issue).toBeNull();
    expect(result.dropped_images).toBe(1);
    expect((await pixels(result.legends[0]!.data)).share({ x0: 0, y0: 0, x1: 1000, y1: 175 }, dark)).toBeGreaterThan(0.03);
  });

  it("returns the reason instead of throwing: no canvas, a JPEG over budget, a child past its deadline, bytes that are no PDF", SPAWN, async () => {
    const bytes = await plan();
    await expect(renderGroupEvidence(bytes, evidencePlan(), { canvasPath: null })).resolves.toMatchObject({ groups: [null], legends: [null], issue: "canvas_unavailable" });
    await expect(renderGroupEvidence(bytes, evidencePlan(), { maxBytes: 200 })).resolves.toMatchObject({ groups: [null], issue: "too_large" });
    await expect(renderGroupEvidence(bytes, evidencePlan(), { timeoutMs: 1 })).resolves.toMatchObject({ groups: [null], legends: [null], issue: "timeout" });
    await expect(renderGroupEvidence(new Uint8Array([1, 2, 3, 4]), evidencePlan())).resolves.toMatchObject({ groups: [null], issue: "render_failed" });
    await expect(renderGroupEvidence(bytes, { page: 1, legends: [], groups: [] })).resolves.toMatchObject({ groups: [], legends: [], issue: null });
  });
});
