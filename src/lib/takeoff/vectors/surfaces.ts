import type { GroupClass } from "@/lib/takeoff/vectors/classify";
import type { VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { FILL_GROUP_ID, fillRooms, type FillRejection } from "@/lib/takeoff/vectors/fill";
import { angleGap, pointInRing, returnsToStart, ringArea, squarePointsToSquareMetres, type Point } from "@/lib/takeoff/vectors/geometry";
import { mergeTextLines } from "@/lib/takeoff/vectors/labels";
import { groupId, type PageModel } from "@/lib/takeoff/vectors/page-model";

// Room surfaces of a page (TI-662 step 4). The area of the smallest closed
// stroked polygon around the room's printed surface (« Local fictif 13.80m² »,
// or a label line above « 84.95 m² ») × scale² is the measure; the printed
// surface is its control, never the quantity nor its fallback: a room with
// neither a closed polygon nor a valid fill between walls (below) has no
// measured area and is reported. The printed label and surface stay in
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
// The polygon taken keeps its group and points (page space, 0.01 pt) for the
// geometry the worker persists (persistence.ts); the bench report leaves them out.
// A room no ring bounds is filled between the page's walls (fill.ts, TI-662
// L3c): its floor's area is the measure and its outline the polygon (group
// FILL_GROUP_ID). A fill rejected (outside the walls, around another room,
// along the frame, far from the printed surface) gives no area: its reason is
// reported, the printed surface stays a control, never the quantity.

export const SURFACE_RULE_VERSION = 5;
const AREA_PATTERN = /(\d{1,5}(?:[.,]\d{1,2})?)\s*m\s*[²2](?![\d])/i;

export type RoomSurface = {
  room: string;
  printed_m2: number;
  anchor: Point;
  /** Area of the closed polygon around the anchor, in m² (null: no polygon, or scale not measurable). */
  polygon_m2: number | null;
  polygon_points: number | null;
  /** That polygon: its group id and its x, y pairs in page space (sheet points, y down; the closing point repeats the first). */
  /** Holes (TI-677): what a filled floor leaves out inside its outline (another room, a core), page space. */
  outline: { group: string; points: number[]; holes?: number[][] } | null;
  deviation: number | null;
  /** How the polygon was found: the smallest ring around the label, or the floor filled between walls (null: none). */
  method: "ring" | "fill" | null;
  /** Why the fill between walls gave no area (reported, never measured); null when not filled or measured. */
  fill_rejected: FillRejection | null;
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

/**
 * Room surfaces of a page: the smallest ring around each printed area first, else (given the page's groups and
 * classes) the floor filled between its walls.
 */
export function readRoomSurfaces(extraction: VectorPageExtraction, denominator: number | null,
  walls?: { model: PageModel; classes: readonly GroupClass[] }): RoomSurface[] {
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
  const rings: Array<{ area: number; path: VectorPath } | null> = rooms.map(({ text, anchor }) => {
    let best: { area: number; path: VectorPath } | null = null;
    for (const path of closed) {
      if (!pointInRing(anchor, extraction.points, path.start, path.count)) continue;
      const area = ringArea(extraction.points, path.start, path.count);
      if (area <= 4 * text.width * text.height || (best && area >= best.area)) continue;
      // One room per outline: a ring around another room's label too is an envelope or a frame.
      if (rooms.some((other) => other.text !== text && pointInRing(other.anchor, extraction.points, path.start, path.count))) continue;
      best = { area, path };
    }
    return best;
  });
  // The rooms no ring bounds, filled between the walls when the page has some and a measurable scale.
  const fills = walls && denominator !== null && rings.some((ring) => ring === null)
    ? fillRooms({ extraction, model: walls.model, classes: walls.classes, denominator,
      rooms: rooms.map(({ text, printed, anchor }, index) => ({ anchor, printed_m2: printed, height: text.height, fill: rings[index] === null })) })
    : null;
  rooms.forEach(({ room, printed, anchor }, index) => {
    const best = rings[index];
    const fill = fills?.[index] ?? null;
    const filled = fill !== null && "area_m2" in fill ? fill : null;
    const polygon = best && denominator !== null ? Math.round(squarePointsToSquareMetres(best.area, denominator) * 100) / 100
      : filled ? Math.round(filled.area_m2 * 100) / 100 : null;
    const outline = best !== null ? {
      group: groupId(extraction.groups[best.path.group]),
      points: Array.from(extraction.points.subarray(2 * best.path.start, 2 * (best.path.start + best.path.count)), (value) => Math.round(value * 100) / 100),
    } : filled ? { group: FILL_GROUP_ID, points: filled.outline, ...(filled.holes.length > 0 ? { holes: filled.holes } : {}) } : null;
    surfaces.push({ room, printed_m2: printed, anchor, polygon_m2: polygon, polygon_points: best ? best.path.count : filled ? filled.outline.length / 2 : null,
      outline, deviation: polygon === null ? null : Math.round(((polygon - printed) / printed) * 10000) / 10000,
      method: best ? "ring" : filled ? "fill" : null, fill_rejected: fill !== null && "rejected" in fill ? fill.rejected : null });
  });
  // Reading order: top to bottom, then left to right.
  return surfaces.sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x);
}
