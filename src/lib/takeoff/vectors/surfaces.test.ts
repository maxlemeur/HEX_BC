import { describe, expect, it } from "vitest";

import type { VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { squarePointsToSquareMetres } from "@/lib/takeoff/vectors/geometry";
import { readRoomSurfaces } from "@/lib/takeoff/vectors/surfaces";

// Ways the room surfaces of a page (TI-662 step 4) could give a wrong area or
// lose a room, written from the module contract before the tests. Rooms and
// sizes are fictional:
// - a label printed in the same text as its area (« Infirmerie 13.62m² ») is
//   not read, or keeps the area in the room name;
// - a label printed on the line above its area (« circulation » / « 84.95 m² »)
//   is not read; the lines of a two-line label are not joined in reading order;
//   a text further up, detached from the label, is absorbed into it;
// - a French decimal comma (« 6,40 m² ») is misread as another value;
// - a label printed before the area on the same baseline but in another text
//   item (pdfjs splits a line at a font change, as labels.ts mergeTextLines
//   says) is not read, so the room is lost;
// - a printed area without label (alone, or under another printed area) is
//   read as a room;
// - the polygon area is converted with the scale instead of its square (a
//   closed square of 100 mm side at 1/50 is 25 m², at 1/100 100 m²);
// - of two nested closed rings around the area, the larger one is taken, or a
//   smaller ring that does not hold the area is taken;
// - a room without closed polygon (an open outline) takes its printed surface
//   as measure, or the area of some other ring;
// - a scale not measurable (denominator null) still yields an area;
// - the deviation is not (polygon − printed) / printed, or loses its sign.
// Review of PR #145 (Codex, 3/11/2026, written before the fix):
// - a room outline on a layer hidden by the document's default configuration
//   (OFF, not printed) gives a visible room its area, or a smaller hidden
//   outline replaces the visible one.

const POINTS_PER_MM = 72 / 25.4;

/** Sheet points of a site length in metres at 1/denominator. */
function sheet(metres: number, denominator = 50) {
  return ((metres * 1000) / denominator) * POINTS_PER_MM;
}

type Ring = { x: number; y: number; width: number; height: number; closed?: boolean };

/** One text line, left to right, baseline at y (page space, y down). */
function line(str: string, x: number, y: number, height = 2.5): VectorText {
  return { str, x, y, width: str.length * height * 0.55, height, angle: 0 };
}

/** A page whose stroked rectangles are drawn moveTo, three lineTo and closePath (the extraction pushes the closing point). */
function page(texts: VectorText[], rings: Ring[]): VectorPageExtraction {
  const coordinates: number[] = [];
  const paths: VectorPath[] = [];
  for (const ring of rings) {
    const start = coordinates.length / 2;
    const [x0, y0, x1, y1] = [ring.x, ring.y, ring.x + ring.width, ring.y + ring.height];
    coordinates.push(x0, y0, x1, y0, x1, y1, x0, y1, x0, y0);
    paths.push({ group: 0, start, count: 5, closed: ring.closed ?? true });
  }
  return {
    page: 1, pages: 1, width: 1190.55, height: 841.89, userUnit: 1, rotate: 0, layers: [],
    groups: [{ layer: null, color: "#000000", width: 0.5, dash: null }],
    texts, paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: rings.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 },
    memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

/** A 4 m × 3.5 m room at 1/50 (14.00 m²), from (100, 100). */
const ROOM_14: Ring = { x: 100, y: 100, width: sheet(4), height: sheet(3.5) };

describe("readRoomSurfaces", () => {
  it("reads a room label printed in the same text as its area", () => {
    const [surface, ...others] = readRoomSurfaces(page([line("Infirmerie 13.62m²", 150, 200)], [ROOM_14]), 50);
    expect(others).toEqual([]);
    expect(surface).toMatchObject({ room: "Infirmerie", printed_m2: 13.62, polygon_m2: 14, polygon_points: 5 });
  });

  it("reads the label line above an area printed alone, and joins a two-line label in reading order", () => {
    const corridor: Ring = { x: 400, y: 100, width: sheet(10), height: sheet(8.5) };
    const technical: Ring = { x: 100, y: 450, width: sheet(2), height: sheet(3.2) };
    const surfaces = readRoomSurfaces(page([
      line("circulation", 600, 297), line("84.95 m²", 600, 300),
      line("Local", 130, 497), line("technique", 130, 500), line("6,40 m²", 130, 503),
    ], [corridor, technical]), 50);
    expect(surfaces.map(({ room, printed_m2, polygon_m2 }) => ({ room, printed_m2, polygon_m2 }))).toEqual([
      { room: "circulation", printed_m2: 84.95, polygon_m2: 85 },
      { room: "Local technique", printed_m2: 6.4, polygon_m2: 6.4 },
    ]);
  });

  it("keeps a text detached above the label (more than 1.7 heights) out of the room name", () => {
    // « Stockage » 1.2 heights above the area, a note 2 heights above « Stockage » (3.2 heights above the area).
    const surfaces = readRoomSurfaces(page([line("Note", 150, 190), line("Stockage", 150, 195), line("13.62 m²", 150, 198)], [ROOM_14]), 50);
    expect(surfaces.map((surface) => surface.room)).toEqual(["Stockage"]);
  });

  it("reads a label printed before the area on the same baseline in another text item", () => {
    // pdfjs splits « Infirmerie 13.62m² » into two items when the area is set in another font.
    const label = line("Infirmerie", 150, 200);
    const area = line("13.62m²", label.x + label.width + 1, 200);
    const surfaces = readRoomSurfaces(page([label, area], [ROOM_14]), 50);
    expect(surfaces.map(({ room, printed_m2, polygon_m2 }) => ({ room, printed_m2, polygon_m2 }))).toEqual([
      { room: "Infirmerie", printed_m2: 13.62, polygon_m2: 14 },
    ]);
  });

  it("ignores a printed area without label, alone or under another printed area", () => {
    const lone = readRoomSurfaces(page([line("12.40 m²", 150, 200)], [ROOM_14]), 50);
    const stacked = readRoomSurfaces(page([line("8.10 m²", 150, 197), line("12.40 m²", 150, 200)], [ROOM_14]), 50);
    expect(lone).toEqual([]);
    expect(stacked).toEqual([]);
  });

  it("converts the polygon area with the square of the scale", () => {
    const side = 100 * POINTS_PER_MM;
    expect(squarePointsToSquareMetres(side * side, 50)).toBeCloseTo(25, 6);
    expect(squarePointsToSquareMetres(side * side, 100)).toBeCloseTo(100, 6);
    const square = page([line("Bureau 24.80m²", 150, 200)], [{ x: 100, y: 100, width: side, height: side }]);
    expect(readRoomSurfaces(square, 50)[0].polygon_m2).toBe(25);
    expect(readRoomSurfaces(square, 100)[0].polygon_m2).toBe(100);
  });

  it("takes the smallest closed ring around the area, never a ring that does not hold it", () => {
    const flat: Ring = { x: 50, y: 50, width: sheet(12), height: sheet(10) };
    const cupboard: Ring = { x: 400, y: 120, width: sheet(1), height: sheet(1) };
    const [surface] = readRoomSurfaces(page([line("Infirmerie 13.62m²", 150, 200)], [flat, ROOM_14, cupboard]), 50);
    expect(surface).toMatchObject({ room: "Infirmerie", polygon_m2: 14 });
  });

  it("gives no measured area to a room without closed polygon, its printed surface kept as control only", () => {
    const outline: Ring = { ...ROOM_14, closed: false };
    const [surface] = readRoomSurfaces(page([line("Infirmerie 13.62m²", 150, 200)], [outline]), 50);
    expect(surface).toMatchObject({ room: "Infirmerie", printed_m2: 13.62, polygon_m2: null, polygon_points: null, deviation: null });
  });

  it("gives no measured area when the page scale is not measurable", () => {
    const [surface] = readRoomSurfaces(page([line("Infirmerie 13.62m²", 150, 200)], [ROOM_14]), null);
    expect(surface).toMatchObject({ room: "Infirmerie", printed_m2: 13.62, polygon_m2: null, deviation: null });
  });

  it("reports the deviation as (polygon - printed) / printed, with its sign", () => {
    const larger = readRoomSurfaces(page([line("Infirmerie 13.62m²", 150, 200)], [ROOM_14]), 50)[0];
    const smaller = readRoomSurfaces(page([line("Infirmerie 15.00m²", 150, 200)], [ROOM_14]), 50)[0];
    expect(larger.deviation).toBeCloseTo((14 - 13.62) / 13.62, 4);
    expect(larger.deviation).toBeGreaterThan(0);
    expect(smaller.deviation).toBeCloseTo((14 - 15) / 15, 4);
    expect(smaller.deviation).toBeLessThan(0);
  });
});

describe("readRoomSurfaces, review of PR #145", () => {
  it("never measures a room with an outline on a hidden layer", () => {
    // Visible 14 m² room on layer 1R; on the hidden layer 2R, a smaller outline around the same label and a room of its own.
    const extraction = page([line("Infirmerie 13.62m²", 150, 200), line("Archives 9.00m²", 650, 200)],
      [ROOM_14, { x: 120, y: 150, width: sheet(2), height: sheet(1.5) }, { x: 600, y: 100, width: sheet(3), height: sheet(3) }]);
    extraction.layers = [{ id: "1R", name: "FICTIF_MURS", visible: true }, { id: "2R", name: "FICTIF_MURS_ANCIEN", visible: false }];
    extraction.groups = [{ layer: "1R", color: "#000000", width: 0.5, dash: null }, { layer: "2R", color: "#000000", width: 0.5, dash: null }];
    extraction.paths = extraction.paths.map((path, index) => ({ ...path, group: index === 0 ? 0 : 1 }));
    const surfaces = readRoomSurfaces(extraction, 50);
    expect(surfaces.map(({ room, polygon_m2 }) => ({ room, polygon_m2 }))).toEqual([
      { room: "Infirmerie", polygon_m2: 14 },
      { room: "Archives", polygon_m2: null },
    ]);
  });
});
