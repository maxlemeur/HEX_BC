import type { VectorPageExtraction, VectorText } from "@/lib/takeoff/vectors/extraction";
import { angleGap, pointInRing, returnsToStart, ringArea, squarePointsToSquareMetres, type Point } from "@/lib/takeoff/vectors/geometry";
import { mergeTextLines } from "@/lib/takeoff/vectors/labels";

// Room surfaces of a page (TI-662 step 4). The area of the smallest closed
// stroked polygon around the room's printed surface (« Infirmerie 13.62m² »,
// or a label line above « 84.95 m² ») × scale² is the measure; the printed
// surface is its control, never its fallback: a room without closed polygon
// has no measured area and is reported. The printed label and surface stay in
// the reading for the control and the report. Text items of one baseline are
// merged first (pdfjs splits a line at font changes); a ring no larger than 4
// times the text's box is its frame, not the room; a label prefix such as
// « S = » or « Surface : » is not the room's name. An outline on a layer hidden
// by the document's default configuration (OFF) is not printed: it bounds no room.
// A polygon is closed by its path (h, s, re) or drawn back to its first point
// and stroked without closePath (within RING_CLOSURE_PT, a CAD export may round
// its last point); an outline left open (a door gap, a missing side) bounds no room.
// A ring that also holds the label of another room (a building envelope, a
// sheet frame) is not this room's outline: one room per outline.

export const SURFACE_RULE_VERSION = 4;
const AREA_PATTERN = /(\d{1,5}(?:[.,]\d{1,2})?)\s*m\s*[²2](?![\d])/i;

export type RoomSurface = {
  room: string;
  printed_m2: number;
  anchor: Point;
  /** Area of the closed polygon around the anchor, in m² (null: no polygon, or scale not measurable). */
  polygon_m2: number | null;
  polygon_points: number | null;
  deviation: number | null;
};

function lineCentre(text: VectorText): Point {
  const c = Math.cos(text.angle), s = Math.sin(text.angle);
  return { x: text.x + (c * text.width) / 2 + (s * text.height) / 2, y: text.y + (s * text.width) / 2 - (c * text.height) / 2 };
}

const LABEL_PREFIX = /(?:^|\s)(?:s|surf(?:ace)?\.?|aire)\s*[=:]\s*$/i;

/**
 * The label of a surface line: the text before the area in the same line, else the lines of its direction just
 * above it. « Above » and « along » are read in the text's own frame (baseline and its normal), so a page
 * rotated by /Rotate reads as drawn.
 */
function roomLabel(text: VectorText, before: string, texts: readonly VectorText[]) {
  const own = before.replace(LABEL_PREFIX, "").trim();
  if (own.length >= 2) return own;
  const h = text.height;
  const c = Math.cos(text.angle), s = Math.sin(text.angle);
  // Offsets from the area's baseline start: along its baseline, and up (towards the top of its glyphs, y down).
  const along = (other: VectorText) => (other.x - text.x) * c + (other.y - text.y) * s;
  const up = (other: VectorText) => (other.x - text.x) * s - (other.y - text.y) * c;
  const above = texts.filter((other) => other !== text && angleGap(other.angle, text.angle) < 0.02 && !AREA_PATTERN.test(other.str)
    && up(other) > 0.5 * h && up(other) < 3.4 * h
    && along(other) < text.width + h && along(other) + other.width > -h).sort((left, right) => up(right) - up(left));
  // Keep the lines stacked right above the surface (each within 1.7 heights of the next).
  const kept: VectorText[] = [];
  let bottom = 0;
  for (const line of [...above].reverse()) {
    if (up(line) - bottom > 1.7 * h) break;
    kept.unshift(line);
    bottom = up(line);
  }
  return kept.map((line) => line.str.trim()).join(" ").replace(/\s+/g, " ").trim();
}

export function readRoomSurfaces(extraction: VectorPageExtraction, denominator: number | null): RoomSurface[] {
  const surfaces: RoomSurface[] = [];
  // A layer hidden by the document's default configuration is not printed: its outlines bound no room.
  const hidden = new Set(extraction.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  // A ring: closed by its path, or drawn back to its first point and stroked without closePath (m, l… to the start, S).
  const closed = extraction.paths.filter((path) => path.count >= 4 && (path.closed || returnsToStart(extraction.points, path.start, path.count))
    && !hidden.has(extraction.groups[path.group]?.layer ?? ""));
  const lines = mergeTextLines(extraction.texts);
  const rooms = lines.flatMap((text) => {
    const match = AREA_PATTERN.exec(text.str);
    if (!match) return [];
    const printed = Number(match[1].replace(",", "."));
    if (!Number.isFinite(printed) || printed <= 0) return [];
    const room = roomLabel(text, text.str.slice(0, match.index), lines);
    return room ? [{ text, room, printed, anchor: lineCentre(text) }] : [];
  });
  for (const { text, room, printed, anchor } of rooms) {
    let best: { area: number; points: number } | null = null;
    for (const path of closed) {
      if (!pointInRing(anchor, extraction.points, path.start, path.count)) continue;
      const area = ringArea(extraction.points, path.start, path.count);
      if (area <= 4 * text.width * text.height || (best && area >= best.area)) continue;
      // One room per outline: a ring around another room's label too is an envelope or a frame.
      if (rooms.some((other) => other.text !== text && pointInRing(other.anchor, extraction.points, path.start, path.count))) continue;
      best = { area, points: path.count };
    }
    const polygon = best && denominator !== null ? Math.round(squarePointsToSquareMetres(best.area, denominator) * 100) / 100 : null;
    surfaces.push({ room, printed_m2: printed, anchor, polygon_m2: polygon, polygon_points: best?.points ?? null,
      deviation: polygon === null ? null : Math.round(((polygon - printed) / printed) * 10000) / 10000 });
  }
  // Reading order: top to bottom, then left to right.
  return surfaces.sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x);
}
