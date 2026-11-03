import { describe, expect, it } from "vitest";

import type { VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { fillCellPt } from "@/lib/takeoff/vectors/fill";
import { ringArea, squarePointsToSquareMetres } from "@/lib/takeoff/vectors/geometry";
import { vectorItems } from "@/lib/takeoff/vectors/items";
import { vectorItemRecords, vectorPageRecord } from "@/lib/takeoff/vectors/persistence";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";
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
// Second Codex round (written before the fix):
// - on a page rotated 90° (/Rotate 90, texts at +90°), a label printed above
//   its area is not found (« above » read along page y), and the room is lost.
// Third Codex round (written before the fix):
// - a room outline drawn moveTo, four lineTo back to its first point and
//   stroked without closePath (a complete ring, closed flag false) has no
//   measured area; or, once accepted, an outline left open (a door gap, a
//   missing side) is measured as if closed.
// Review of that round (written before the fix): on a page turned by /Rotate
// 180, a label and its area line tilted by a fraction of a degree read at
// angles on both sides of ±π (3.1416 and −3.1364) and are not taken for one
// direction, so the room loses its name.
// Bench of the third round (written before the fix): once outlines drawn back
// to their start count, a building envelope or a sheet frame drawn so (or
// closed) is the smallest ring around every room without its own outline,
// which then takes the envelope's thousands of m²; a ring that holds the
// label of another room is not this room's outline.
// Fill between walls (TI-662 L3c, written before the change; a plan whose
// walls are separate strokes on a wall layer has no ring around any room):
// - a room bounded by wall strokes only (no ring) keeps no area, or its area is
//   not the floor between the walls × scale²; the raster loses half a cell of
//   floor along every wall (a 4 m × 3.5 m room reads 1.9 % short);
// - a doorway closed only by a door symbol (leaf and swing arc on a joinery
//   layer) lets the room flood into the next one (both rejected), or the swing
//   quarter-disc is given to the room on the other side of the opening (it
//   gains 0.65 m², the room the door opens into loses them);
// - a window on the joinery layer does not close its wall, so the room leaks
//   outside; once joinery strokes bound rooms, a gap left open still gives an
//   area instead of no area with its reason;
// - a fill that leaks outside the walls, through an open passage into another
//   labelled room, along the sheet frame, or far from the printed surface (over
//   1.5 times or under 1/1.5 of it) is measured, or measured as the printed
//   surface, instead of being reported without area;
// - furniture or a fixture drawn as a closed shape on the wall layer, or a
//   turning circle crossing a wall, is cut out of the floor; or an unlabelled
//   closed block over the hole limit (a shaft, a core) is counted as floor;
// - the swing of a window drawn into the room on the joinery layer (a
//   casement's triangle against the facade, closed by the wall) is cut out of
//   the floor: on the bench, large rooms read 3 to 4 % short;
// - a room whose printed area lies on a stroke is not filled at all;
// - a room with a ring no longer takes its ring first; a page without wall or
//   partition classes (colours mode) is filled; a wall on a hidden layer bounds
//   a room; a page without measurable scale gives an area;
// - the fill outline is not a closed page-space polygon of at most 2000 points
//   around the measured floor, so persistence (which keeps a surface only with
//   its outline) loses the room, or the item still reads « polygone fermé ».

const POINTS_PER_MM = 72 / 25.4;

/** Sheet points of a site length in metres at 1/denominator. */
function sheet(metres: number, denominator = 50) {
  return ((metres * 1000) / denominator) * POINTS_PER_MM;
}

/** `closed: false`: stroked without closePath; `gap`: the last point stops that many points short of the first (an outline left open). */
type Ring = { x: number; y: number; width: number; height: number; closed?: boolean; gap?: number };

/** One text line, left to right, baseline at y (page space, y down). */
function line(str: string, x: number, y: number, height = 2.5): VectorText {
  return { str, x, y, width: str.length * height * 0.55, height, angle: 0 };
}

/**
 * A page whose stroked rectangles are drawn moveTo, three lineTo and closePath (the extraction pushes the closing point),
 * or with `closed: false` a fourth lineTo back to the first point (`gap` points short of it when set).
 */
function page(texts: VectorText[], rings: Ring[]): VectorPageExtraction {
  const coordinates: number[] = [];
  const paths: VectorPath[] = [];
  for (const ring of rings) {
    const start = coordinates.length / 2;
    const [x0, y0, x1, y1] = [ring.x, ring.y, ring.x + ring.width, ring.y + ring.height];
    coordinates.push(x0, y0, x1, y0, x1, y1, x0, y1, x0, y0 + (ring.gap ?? 0));
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
    // Left open: a door of 0.90 m at 1/50, or the fourth side not drawn.
    for (const outline of [{ ...ROOM_14, closed: false, gap: sheet(0.9) }, { ...ROOM_14, closed: false, gap: ROOM_14.height }]) {
      const [surface] = readRoomSurfaces(page([line("Infirmerie 13.62m²", 150, 200)], [outline]), 50);
      expect(surface).toMatchObject({ room: "Infirmerie", printed_m2: 13.62, polygon_m2: null, polygon_points: null, deviation: null });
    }
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

describe("readRoomSurfaces, rotated page (review of PR #145)", () => {
  it("finds a label printed above its area on a page rotated by 90°", () => {
    const room: Ring = { x: 100, y: 100, width: sheet(4), height: sheet(3.1) }; // 12.40 m²
    const texts = [line("Bureau", 130, 197), line("12.40 m²", 130, 200)];
    const flat = readRoomSurfaces(page(texts, [room]), 50);
    expect(flat.map(({ room: name, polygon_m2 }) => ({ name, polygon_m2 }))).toEqual([{ name: "Bureau", polygon_m2: 12.4 }]);
    // The same sheet viewed at /Rotate 90: page point (x, y) goes to (H − y, x), texts turn to +90°.
    const H = 841.89;
    const rotated = page(texts.map((entry) => ({ ...entry, x: H - entry.y, y: entry.x, angle: Math.PI / 2 })),
      [{ x: H - (room.y + room.height), y: room.x, width: room.height, height: room.width }]);
    expect(readRoomSurfaces(rotated, 50).map(({ room: name, polygon_m2 }) => ({ name, polygon_m2 }))).toEqual([{ name: "Bureau", polygon_m2: 12.4 }]);
  });
});

describe("readRoomSurfaces, outline stroked without closePath (third review of PR #145)", () => {
  it("measures a room whose outline returns to its first point without closePath, never an outline left open", () => {
    const texts = [line("Infirmerie 13.62m²", 150, 200)];
    const read = (ring: Ring) => readRoomSurfaces(page(texts, [ring]), 50).map(({ room, polygon_m2, polygon_points }) => ({ room, polygon_m2, polygon_points }));
    // m, four l back to the first point, S: the ring is complete, only closePath is missing.
    expect(read({ ...ROOM_14, closed: false })).toEqual([{ room: "Infirmerie", polygon_m2: 14, polygon_points: 5 }]);
    // A CAD export whose last point is rounded 0.2 pt off the first still closes the room.
    expect(read({ ...ROOM_14, closed: false, gap: 0.2 })).toEqual([{ room: "Infirmerie", polygon_m2: 14, polygon_points: 5 }]);
    // Left open: a door of 0.90 m at 1/50, or the fourth side not drawn.
    expect(read({ ...ROOM_14, closed: false, gap: sheet(0.9) })).toEqual([{ room: "Infirmerie", polygon_m2: null, polygon_points: null }]);
    expect(read({ ...ROOM_14, closed: false, gap: ROOM_14.height })).toEqual([{ room: "Infirmerie", polygon_m2: null, polygon_points: null }]);
  });
});

describe("readRoomSurfaces, one room per outline (bench of the third review of PR #145)", () => {
  it("never gives a room the area of a ring that also holds another room's label, and keeps a room's own ring inside it", () => {
    // An envelope around three rooms (drawn back to its start, or closed): only the office has its own outline.
    const envelope: Ring = { x: 50, y: 50, width: sheet(30), height: sheet(20) };
    const office: Ring = { x: 400, y: 100, width: sheet(4), height: sheet(3.1) }; // 12.40 m²
    const texts = [line("Infirmerie 13.62m²", 150, 200), line("Archives 9.10 m²", 250, 300), line("Bureau 12.40 m²", 420, 150)];
    for (const outline of [{ ...envelope, closed: false }, envelope]) {
      const surfaces = readRoomSurfaces(page(texts, [outline, office]), 50);
      expect(surfaces.map(({ room, polygon_m2 }) => ({ room, polygon_m2 }))).toEqual([
        { room: "Bureau", polygon_m2: 12.4 },
        { room: "Infirmerie", polygon_m2: null },
        { room: "Archives", polygon_m2: null },
      ]);
    }
    // Alone in the envelope, a room takes it: the envelope is then its outline.
    expect(readRoomSurfaces(page([texts[0]], [envelope]), 50).map(({ polygon_m2 }) => polygon_m2)).toEqual([600]);
  });
});

describe("readRoomSurfaces, upside-down page (review of the third round of PR #145)", () => {
  it("finds the name above a slightly tilted area line on a page turned by /Rotate 180", () => {
    const room: Ring = { x: 100, y: 100, width: sheet(4), height: sheet(3.1) }; // 12.40 m²
    const texts = [line("Bureau", 130, 197), { ...line("12.40 m²", 130, 200), angle: 0.005 }];
    expect(readRoomSurfaces(page(texts, [room]), 50).map(({ room: name, polygon_m2 }) => ({ name, polygon_m2 }))).toEqual([{ name: "Bureau", polygon_m2: 12.4 }]);
    // The same sheet viewed at /Rotate 180: page point (x, y) goes to (W − x, H − y), texts turn by π (3.1416 and −3.1364).
    const W = 1190.55, H = 841.89;
    const turned = page(texts.map((entry) => ({ ...entry, x: W - entry.x, y: H - entry.y, angle: Math.atan2(Math.sin(entry.angle + Math.PI), Math.cos(entry.angle + Math.PI)) })),
      [{ x: W - (room.x + room.width), y: H - (room.y + room.height), width: room.width, height: room.height }]);
    expect(readRoomSurfaces(turned, 50).map(({ room: name, polygon_m2 }) => ({ name, polygon_m2 }))).toEqual([{ name: "Bureau", polygon_m2: 12.4 }]);
  });
});

describe("readRoomSurfaces, fill between walls (TI-662 L3c)", () => {
  const A3 = { width: 1190.55, height: 841.89 };
  const WALLS = "1R", JOINERY = "2R", HIDDEN = "3R";
  /** Strokes on layers: separate segments unless `closed` (a ring). */
  type Stroke = { layer: string; points: number[]; closed?: boolean };

  function layered(texts: VectorText[], strokes: Stroke[], size = A3): VectorPageExtraction {
    const layers = [{ id: WALLS, name: "FICTIF_MURS", visible: true }, { id: JOINERY, name: "FICTIF_MENUISERIES", visible: true },
      { id: HIDDEN, name: "FICTIF_MURS_ANCIEN", visible: false }];
    const coordinates: number[] = [];
    const paths: VectorPath[] = strokes.map((stroke) => {
      const start = coordinates.length / 2;
      coordinates.push(...stroke.points);
      return { group: layers.findIndex((layer) => layer.id === stroke.layer), start, count: stroke.points.length / 2, closed: stroke.closed ?? false };
    });
    return {
      page: 1, pages: 1, width: size.width, height: size.height, userUnit: 1, rotate: 0, layers,
      groups: layers.map((layer) => ({ layer: layer.id, color: "#000000", width: 0.25, dash: null })),
      texts, paths, points: Float32Array.from(coordinates),
      counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
      timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 },
      memory: { max_rss_kb: 0, heap_used_mb: 0 },
    };
  }

  function read(extraction: VectorPageExtraction, denominator: number | null = 50) {
    return readVectorPage(extraction, { calibration: denominator === null ? null : { page: 1, denominator, source: "test" }, clock: () => 0 });
  }

  /** The four sides of a box as separate wall strokes (no ring). */
  function box(x0: number, y0: number, x1: number, y1: number, layer = WALLS): Stroke[] {
    return [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]].map((points) => ({ layer, points }));
  }

  // Walls on the middle of the raster's cells (fillCellPt, from the page origin): 114 × 100 cells, 3.99 m × 3.50 m at 1/50.
  const c = fillCellPt(50, A3.width, A3.height);
  const at = (k: number) => (k + 0.5) * c;
  const [X0, X1, X2, Y0, Y1] = [at(50), at(164), at(278), at(50), at(150)];
  const ROOM_M2 = squarePointsToSquareMetres((X1 - X0) * (Y1 - Y0), 50);
  const pick = (reading: ReturnType<typeof read>) => reading.surfaces.map(({ room, polygon_m2, method, fill_rejected }) => ({ room, polygon_m2, method, fill_rejected }));

  it("measures a room bounded by four wall strokes as the floor between them, half a cell restored along each wall", () => {
    const reading = read(layered([line("Bureau 13.97 m²", X0 + 60, Y0 + 90)], box(X0, Y0, X1, Y1)));
    const [surface] = reading.surfaces;
    expect(surface).toMatchObject({ room: "Bureau", method: "fill", fill_rejected: null });
    // Without the half cell along its 14.98 m of walls, the room would read 0.26 m² short.
    expect(Math.abs((surface.polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.02);
    expect(surface.deviation).toBeCloseTo(((surface.polygon_m2 ?? 0) - 13.97) / 13.97, 4);
  });

  it("closes a doorway by its door symbol, the swing quarter-disc staying in the room the door opens into", () => {
    // Two rooms share the wall at X1; a 0.91 m doorway in it, the door hinged at its top, opening into the right room.
    const r = 26 * c, [D0, D1] = [at(80), at(80) + r];
    const walls = [...box(X0, Y0, X1, Y1).filter((_, index) => index !== 1), ...box(X1, Y0, X2, Y1).filter((_, index) => index !== 3),
      { layer: WALLS, points: [X1, Y0, X1, D0] }, { layer: WALLS, points: [X1, D1, X1, Y1] }];
    const arc = Array.from({ length: 9 }, (_, index) => [X1 + r * Math.cos((index * Math.PI) / 16), D0 + r * Math.sin((index * Math.PI) / 16)]).flat();
    const door = [{ layer: JOINERY, points: [X1, D0, X1 + r, D0] }, { layer: JOINERY, points: arc }];
    const texts = [line("Bureau 13.97 m²", X0 + 60, Y0 + 90), line("Archives 13.97 m²", X1 + 40, Y0 + 150)];
    const doorway = pick(read(layered(texts, [...walls, ...door])));
    expect(doorway.map(({ method }) => method)).toEqual(["fill", "fill"]);
    for (const { polygon_m2 } of doorway) expect(Math.abs((polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.05);
    // Without its door symbol the doorway is an open passage: the two rooms are one outline, neither is measured.
    expect(pick(read(layered(texts, walls)))).toEqual([
      { room: "Bureau", polygon_m2: null, method: null, fill_rejected: "rooms" },
      { room: "Archives", polygon_m2: null, method: null, fill_rejected: "rooms" },
    ]);
  });

  it("closes a wall by its window on the joinery layer, and reports a room whose wall is left open", () => {
    const left = box(X0, Y0, X1, Y1).filter((_, index) => index !== 3);
    const [W0, W1] = [at(70), at(104)];
    const walls = [...left, { layer: WALLS, points: [X0, Y1, X0, W1] }, { layer: WALLS, points: [X0, W0, X0, Y0] }];
    const texts = [line("Bureau 13.97 m²", X0 + 60, Y0 + 90)];
    const windowed = read(layered(texts, [...walls, { layer: JOINERY, points: [X0, W0, X0, W1] }, { layer: JOINERY, points: [X0 - 3, W0, X0 - 3, W1] }]));
    expect(windowed.surfaces[0]).toMatchObject({ method: "fill", fill_rejected: null });
    expect(Math.abs((windowed.surfaces[0].polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.05);
    expect(pick(read(layered(texts, walls)))).toEqual([{ room: "Bureau", polygon_m2: null, method: null, fill_rejected: "border" }]);
  });

  it("never measures a fill far from its printed surface, nor one along the sheet frame: they are reported", () => {
    const walls = box(X0, Y0, X1, Y1);
    for (const printed of ["7.00", "30.00"]) {
      expect(pick(read(layered([line(`Bureau ${printed} m²`, X0 + 60, Y0 + 90)], walls))))
        .toEqual([{ room: "Bureau", polygon_m2: null, method: null, fill_rejected: "ratio" }]);
    }
    // A sheet frame drawn as four wall strokes 20 pt inside an A3 page at 1/100, around one hall printed with its own area.
    const frame = box(20, 20, A3.width - 20, A3.height - 20);
    const hall = Math.round(squarePointsToSquareMetres((A3.width - 40) * (A3.height - 40), 100));
    expect(pick(read(layered([line(`Hall ${hall}.00 m²`, 500, 400)], frame), 100)))
      .toEqual([{ room: "Hall", polygon_m2: null, method: null, fill_rejected: "frame" }]);
  });

  it("counts furniture and a turning circle as floor, never an unlabelled block over the hole limit", () => {
    const desk = { layer: WALLS, points: [X0 + 40, Y0 + 40, X0 + 40 + sheet(1), Y0 + 40, X0 + 40 + sheet(1), Y0 + 40 + sheet(0.6), X0 + 40, Y0 + 40 + sheet(0.6), X0 + 40, Y0 + 40], closed: true };
    // A turning circle of 1.50 m crossing the right wall (centre 0.50 m inside it).
    const [cx, cy, radius] = [X1 - sheet(0.5), Y0 + sheet(2), sheet(0.75)];
    const circle = { layer: WALLS, closed: true,
      points: Array.from({ length: 33 }, (_, index) => [cx + radius * Math.cos((index * Math.PI) / 16), cy + radius * Math.sin((index * Math.PI) / 16)]).flat() };
    const [furnished] = read(layered([line("Bureau 13.97 m²", X0 + 60, Y0 + 150)], [...box(X0, Y0, X1, Y1), desk, circle])).surfaces;
    expect(furnished).toMatchObject({ method: "fill", fill_rejected: null });
    expect(Math.abs((furnished.polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.05);
    // A closed core of 3 m × 2 m (6 m²) inside the room is not its floor.
    const core = { layer: WALLS, closed: true, points: [X0 + 30, Y0 + 30, X0 + 30 + sheet(3), Y0 + 30, X0 + 30 + sheet(3), Y0 + 30 + sheet(2), X0 + 30, Y0 + 30 + sheet(2), X0 + 30, Y0 + 30] };
    const [cored] = read(layered([line("Hall 7.97 m²", X0 + 60, Y1 - 20)], [...box(X0, Y0, X1, Y1), core])).surfaces;
    expect(cored.method).toBe("fill");
    expect(Math.abs((cored.polygon_m2 ?? 0) - (ROOM_M2 - 6))).toBeLessThan(0.1);
  });

  it("counts the swing of a window drawn into the room as its floor", () => {
    // Two casements of 1.20 m on the top wall, their swings drawn as triangles 0.60 m deep (0.36 m² each).
    const swing = (x: number) => ({ layer: JOINERY, points: [x, Y0, x + sheet(0.6), Y0 + sheet(0.6), x + sheet(1.2), Y0] });
    const [surface] = read(layered([line("Bureau 13.97 m²", X0 + 60, Y0 + 150)], [...box(X0, Y0, X1, Y1), swing(X0 + 20), swing(X0 + 120)])).surfaces;
    expect(surface).toMatchObject({ method: "fill", fill_rejected: null });
    expect(Math.abs((surface.polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.05);
  });

  it("fills a room whose printed area lies on a stroke from the nearest free cell", () => {
    const label = line("Bureau 13.97 m²", X0 + 60, Y0 + 90);
    // A free-standing stroke (a bench) through the label's centre.
    const yc = label.y - label.height / 2;
    const [surface] = read(layered([label], [...box(X0, Y0, X1, Y1), { layer: WALLS, points: [X0 + 40, yc, X0 + 160, yc] }])).surfaces;
    expect(surface).toMatchObject({ method: "fill", fill_rejected: null });
    expect(Math.abs((surface.polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.05);
    // A label printed across the left wall, its centre 0.3 pt inside the room: the fill starts inside, the wall stays whole.
    const across = { ...label, x: X0 + 0.3 - label.width / 2 };
    const [leaning] = read(layered([across], box(X0, Y0, X1, Y1))).surfaces;
    expect(leaning).toMatchObject({ method: "fill", fill_rejected: null });
    expect(Math.abs((leaning.polygon_m2 ?? 0) - ROOM_M2)).toBeLessThan(0.05);
  });

  it("takes a ring first, fills only between wall or partition classes, never through a hidden wall nor without scale", () => {
    const texts = [line("Bureau 13.97 m²", X0 + 60, Y0 + 90)];
    const ring = { layer: WALLS, closed: true, points: [X0, Y0, X1, Y0, X1, Y1, X0, Y1, X0, Y0] };
    expect(read(layered(texts, [ring])).surfaces[0]).toMatchObject({ method: "ring", fill_rejected: null, outline: { group: "oc:1R" } });
    // The same four strokes in colours mode: nothing says they are walls.
    const colours = { ...layered(texts, box(X0, Y0, X1, Y1)), layers: [] };
    colours.groups = colours.groups.map((group) => ({ ...group, layer: null }));
    expect(pick(read(colours))).toEqual([{ room: "Bureau", polygon_m2: null, method: null, fill_rejected: null }]);
    // One side on a hidden layer: the room is open.
    const hidden = box(X0, Y0, X1, Y1).map((stroke, index) => (index === 1 ? { ...stroke, layer: HIDDEN } : stroke));
    expect(pick(read(layered(texts, hidden)))).toEqual([{ room: "Bureau", polygon_m2: null, method: null, fill_rejected: "border" }]);
    // Without a measurable scale, no area.
    expect(pick(read(layered(texts, box(X0, Y0, X1, Y1)), null))).toEqual([{ room: "Bureau", polygon_m2: null, method: null, fill_rejected: null }]);
  });

  it("keeps the fill outline as a closed page-space polygon that persistence and the items keep", () => {
    // A 3.99 m × 3.50 m room turned by 30° about its corner: no wall on the raster's axes.
    const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const turn = (x: number, y: number) => [400 + (x - X0) * cos - (y - Y0) * sin, 150 + (x - X0) * sin + (y - Y0) * cos];
    const corners = [turn(X0, Y0), turn(X1, Y0), turn(X1, Y1), turn(X0, Y1)];
    const walls = corners.map((corner, index) => ({ layer: WALLS, points: [...corner, ...corners[(index + 1) % 4]] }));
    const [cx, cy] = turn(X0 + 110, Y0 + 100);
    const reading = read(layered([line("Bureau 13.97 m²", cx - 20, cy)], walls));
    const [surface] = reading.surfaces;
    expect(surface).toMatchObject({ method: "fill", fill_rejected: null, outline: { group: "fill:mur" } });
    expect(Math.abs((surface.polygon_m2 ?? 0) - ROOM_M2) / ROOM_M2).toBeLessThan(0.02);
    const points = surface.outline?.points ?? [];
    expect(points.length / 2).toBeLessThanOrEqual(2000);
    expect(points.slice(0, 2)).toEqual(points.slice(-2));
    // The outline holds the floor it measures, within one cell along its walls.
    const outlineM2 = squarePointsToSquareMetres(ringArea(points, 0, points.length / 2), 50);
    expect(Math.abs(outlineM2 - (surface.polygon_m2 ?? 0))).toBeLessThan(squarePointsToSquareMetres(c * 2 * (X1 - X0 + Y1 - Y0), 50));
    expect(surface.polygon_points).toBe(points.length / 2);
    // The item says how the room was measured; persistence keeps the room with its outline, the page record unchanged.
    const [item] = vectorItems(reading, "fictif.pdf");
    expect(item).toMatchObject({ unit: "m2", quantity: surface.polygon_m2, category: "surface (remplissage entre murs)" });
    expect(item.evidence).toMatch(/remplissage entre murs/);
    const location = { zone: null, level: null, source: null };
    const [record] = vectorItemRecords(reading, location);
    expect(record.item.category).toBe("surface (remplissage entre murs)");
    expect(record.geometry).toMatchObject({ kind: "surface", groups: ["fill:mur"], area_m2: surface.polygon_m2 });
    expect(record.geometry.polygon_m).toHaveLength(points.length);
    expect(vectorPageRecord(reading, location).surfaces).toEqual([
      { room: "Bureau", printed_m2: 13.97, polygon_m2: surface.polygon_m2, deviation: surface.deviation },
    ]);
  });
});
