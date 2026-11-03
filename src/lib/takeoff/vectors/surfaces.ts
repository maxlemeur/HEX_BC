import type { VectorPageExtraction, VectorText } from "@/lib/takeoff/vectors/extraction";
import { pointInRing, ringArea, squarePointsToSquareMetres, type Point } from "@/lib/takeoff/vectors/geometry";
import { mergeTextLines } from "@/lib/takeoff/vectors/labels";

// Room surfaces of a page (TI-662 step 4). The area of the smallest closed
// stroked polygon around the room's printed surface (« Infirmerie 13.62m² »,
// or a label line above « 84.95 m² ») × scale² is the measure; the printed
// surface is its control, never its fallback: a room without closed polygon
// has no measured area and is reported. The printed label and surface stay in
// the reading for the control and the report. Text items of one baseline are
// merged first (pdfjs splits a line at font changes); a ring no larger than 4
// times the text's box is its frame, not the room; a label prefix such as
// « S = » or « Surface : » is not the room's name.

export const SURFACE_RULE_VERSION = 1;
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

/** The label of a surface line: the text before the area in the same line, else the horizontal lines just above it. */
function roomLabel(text: VectorText, before: string, texts: readonly VectorText[]) {
  const own = before.replace(LABEL_PREFIX, "").trim();
  if (own.length >= 2) return own;
  const h = text.height;
  const above = texts.filter((other) => other !== text && Math.abs(other.angle - text.angle) < 0.02 && !AREA_PATTERN.test(other.str)
    && text.y - other.y > 0.5 * h && text.y - other.y < 3.4 * h
    && other.x < text.x + text.width + h && other.x + other.width > text.x - h).sort((left, right) => left.y - right.y);
  // Keep the lines stacked right above the surface (each within 1.7 heights of the next).
  const kept: VectorText[] = [];
  let bottom = text.y;
  for (const line of [...above].reverse()) {
    if (bottom - line.y > 1.7 * h) break;
    kept.unshift(line);
    bottom = line.y;
  }
  return kept.map((line) => line.str.trim()).join(" ").replace(/\s+/g, " ").trim();
}

export function readRoomSurfaces(extraction: VectorPageExtraction, denominator: number | null): RoomSurface[] {
  const surfaces: RoomSurface[] = [];
  const closed = extraction.paths.filter((path) => path.closed && path.count >= 4);
  const lines = mergeTextLines(extraction.texts);
  for (const text of lines) {
    const match = AREA_PATTERN.exec(text.str);
    if (!match) continue;
    const printed = Number(match[1].replace(",", "."));
    if (!Number.isFinite(printed) || printed <= 0) continue;
    const room = roomLabel(text, text.str.slice(0, match.index), lines);
    if (!room) continue;
    const anchor = lineCentre(text);
    let best: { area: number; points: number } | null = null;
    for (const path of closed) {
      if (!pointInRing(anchor, extraction.points, path.start, path.count)) continue;
      const area = ringArea(extraction.points, path.start, path.count);
      if (area <= 4 * text.width * text.height) continue;
      if (!best || area < best.area) best = { area, points: path.count };
    }
    const polygon = best && denominator !== null ? Math.round(squarePointsToSquareMetres(best.area, denominator) * 100) / 100 : null;
    surfaces.push({ room, printed_m2: printed, anchor, polygon_m2: polygon, polygon_points: best?.points ?? null,
      deviation: polygon === null ? null : Math.round(((polygon - printed) / printed) * 10000) / 10000 });
  }
  // Reading order: top to bottom, then left to right.
  return surfaces.sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x);
}
