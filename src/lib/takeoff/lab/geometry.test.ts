import { describe, expect, it } from "vitest";

import { cropBoxFor, interestZone, paretoFrontier } from "@/lib/takeoff/lab/geometry";

// Ways the lab's geometry could mislead, written before the code (TI-661). The
// Army fixture answers the same items whatever region it gets and draws no
// chart, so a browser journey cannot see these:
// - crop: the box drawn on the displayed page (top-left origin) is mapped with
//   the PDF origin (bottom-left), so the model reads the mirrored region;
// - crop: a page whose CropBox does not start at 0,0 is cut at the wrong place;
// - crop: /Rotate 90, 180 or 270 is ignored, so a rotated plan is cut beside
//   the region drawn on screen;
// - crop: an empty, inverted or out-of-page box, or a rotation that is not a
//   multiple of 90, reaches pdf-lib instead of being refused;
// - Pareto: a dominated configuration (more tokens and not better judged) stays
//   on the frontier, or a tie (same tokens, same score) drops one of the two;
// - zone of interest: drawn without points, or not « fewer tokens and better
//   judged than the median ».

const page = { left: 0, bottom: 0, right: 600, top: 800 };

describe("crop box of a region drawn on the displayed page", () => {
  it("maps the top-left origin of the screen to the PDF user space", () => {
    expect(cropBoxFor(page, 0, { x: 0.5, y: 0, width: 0.5, height: 0.25 })).toEqual({ left: 300, bottom: 600, right: 600, top: 800 });
  });

  it("keeps the offset of a CropBox that does not start at the origin", () => {
    expect(cropBoxFor({ left: 100, bottom: 50, right: 700, top: 850 }, 0, { x: 0.5, y: 0, width: 0.5, height: 0.25 }))
      .toEqual({ left: 400, bottom: 650, right: 700, top: 850 });
  });

  it("follows a page rotated clockwise when displayed", () => {
    const topLeft = { x: 0, y: 0, width: 0.25, height: 0.5 };
    // 90: the displayed top-left corner is the PDF's bottom-left one.
    expect(cropBoxFor(page, 90, topLeft)).toEqual({ left: 0, bottom: 0, right: 300, top: 200 });
    // 180: the PDF's bottom-right corner.
    expect(cropBoxFor(page, 180, topLeft)).toEqual({ left: 450, bottom: 0, right: 600, top: 400 });
    // 270: the PDF's top-right corner.
    expect(cropBoxFor(page, 270, topLeft)).toEqual({ left: 300, bottom: 600, right: 600, top: 800 });
    expect(cropBoxFor(page, -90, topLeft)).toEqual(cropBoxFor(page, 270, topLeft));
  });

  it("refuses a box that is empty, outside the page or not finite, and an odd rotation", () => {
    for (const box of [
      { x: 0, y: 0, width: 0, height: 0.5 },
      { x: 0.8, y: 0, width: 0.5, height: 0.5 },
      { x: -0.1, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0, width: Number.NaN, height: 0.5 },
    ]) expect(() => cropBoxFor(page, 0, box)).toThrow();
    expect(() => cropBoxFor(page, 45, { x: 0, y: 0, width: 0.5, height: 0.5 })).toThrow();
  });
});

describe("Pareto frontier of judged configurations", () => {
  it("keeps only configurations no other one beats on both axes, cheapest first", () => {
    expect(paretoFrontier([])).toEqual([]);
    const cheapGood = { id: "a", x: 10, y: 0.9 };
    const dearWorse = { id: "b", x: 20, y: 0.8 };
    const dearBetter = { id: "c", x: 30, y: 0.95 };
    const sameTokensWorse = { id: "d", x: 10, y: 0.5 };
    const sameScoreDearer = { id: "e", x: 15, y: 0.9 };
    expect(paretoFrontier([dearBetter, dearWorse, sameTokensWorse, cheapGood, sameScoreDearer]).map((point) => point.id))
      .toEqual(["a", "c"]);
  });

  it("keeps both of two identical configurations", () => {
    expect(paretoFrontier([{ id: "a", x: 10, y: 0.9 }, { id: "b", x: 10, y: 0.9 }]).map((point) => point.id)).toEqual(["a", "b"]);
  });

  it("bounds the zone of interest by the median tokens and the median judgement", () => {
    expect(interestZone([])).toBeNull();
    expect(interestZone([{ id: "a", x: 10, y: 0.2 }, { id: "b", x: 30, y: 0.6 }, { id: "c", x: 20, y: 1 }]))
      .toEqual({ maxX: 20, minY: 0.6 });
    expect(interestZone([{ id: "a", x: 10, y: 0.2 }, { id: "b", x: 30, y: 0.6 }])).toEqual({ maxX: 20, minY: 0.4 });
  });
});
