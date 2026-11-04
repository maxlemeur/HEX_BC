import { isGrey, isNearWhite, lightnessSaturation, parseHexColor } from "@/lib/takeoff/vectors/colors";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { groupId } from "@/lib/takeoff/vectors/page-model";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import type { TakeoffFrameTransform } from "@/lib/takeoff/rules/types";

// Registration of two plans of one level (TI-664 step 1, « recalage »): the
// translation that brings a page's metres into the frame of another, computed
// from the building, never from the title block.
// - Anchors of a page, kept by the worker: the texts printed once on it (their
//   start, in metres at the page scale) and its longest building lines, the
//   strokes of the architecture background (grey or near-white, never near
//   black: frames and title blocks are drawn in black) or of a wall, partition
//   or background layer.
// - Two zone plans of one level are views of one drawing: a text of the
//   drawing (a room, a pipe label, a grid bubble, a level mark) sits at the
//   same place of the building on both, shifted by the translation between
//   the views. The texts printed once on both pages give candidate
//   translations (their offsets, clustered); the title block's texts give
//   theirs too, usually none (same sheet place).
// - The building lines decide: a candidate is kept by the count of building
//   lines of one page that land on a line of the other, both ends within
//   REGISTRATION.lineTolerance_m. The best candidate needs at least
//   REGISTRATION.minLines lines and twice the lines of the next one; the
//   translation is then refined on its matched ends, and its residual (RMS of
//   the ends' distances) must stay under REGISTRATION.maxResidual_m. Anything
//   else is « non recalé »: the rule never guesses a frame.
// - A translation needs REGISTRATION.minTexts of its texts on the building it
//   lands (inside the box of its landed lines, within buildingMargin_m): the
//   title block, away from the drawing, never proposes the frame alone, even
//   when two identical wings are plotted at one sheet place.
// - Only translations: a plan drawn rotated or at another scale than its
//   page's (a view turned on its sheet) is not registered.
// - Anchors fit takeoff_vector_pages.rule_anchors (262,144 bytes of jsonb
//   text, TI-677): past it, the shortest texts are left out first (every
//   building line is kept), and a text the database cannot store (a NUL, a
//   lone surrogate) is never kept. The bench reads the same anchors.

export const REGISTRATION_VERSION = 1;

export const REGISTRATION = {
  /** Texts per page kept as anchors (printed once, at most this many, longest first). */
  maxTexts: 1500,
  /** Building lines per page kept as anchors (the longest). */
  maxLines: 1500,
  /** A building line shorter than this is no anchor (hatches, symbols). */
  minLineLength_m: 0.5,
  /** Offsets of two texts within this distance propose one translation. */
  textCluster_m: 0.1,
  /** A candidate translation needs this many texts, printed on the building it lands. */
  minTexts: 2,
  /** A text within this distance of the box of the building lines a translation lands is printed on the building. */
  buildingMargin_m: 1,
  /** A line lands on another when both its ends are within this distance. */
  lineTolerance_m: 0.05,
  /** Lines that must land for a translation to be kept. */
  minLines: 20,
  /** The best translation needs this many times the lines of the next one. */
  dominance: 2,
  /**
   * RMS distance of the matched ends after refinement. Measured at 2.4 mm on B R+4 Z1/Z2 (bench, outside the
   * reserve); kept well under ZONE_OVERLAP.distance_m so that a registered duplicate is never missed.
   */
  maxResidual_m: 0.02,
} as const;

/** What a page keeps for its registration: [text, x, y] and [x0, y0, x1, y1] in metres from its top-left corner. */
export type PageAnchors = {
  version: number;
  texts: Array<[string, number, number]>;
  lines: Array<[number, number, number, number]>;
};

/** The check of takeoff_vector_pages.rule_anchors: octet_length(rule_anchors::text) <= 262144. */
export const RULE_ANCHORS_MAX_BYTES = 262_144;

/** Bytes of the first `count` entries of a jsonb array whose entries measure `sizes` (", " between two). */
function arrayBytes(prefix: readonly number[], count: number) {
  return 2 + prefix[count] + 2 * Math.max(0, count - 1);
}

function prefixSums(sizes: readonly number[]) {
  const sums = [0];
  for (const size of sizes) sums.push(sums[sums.length - 1] + size);
  return sums;
}

/**
 * Anchors as the column stores them: texts the database cannot store left out, then, past `maxBytes` of jsonb text,
 * the last texts (the shortest: texts come longest first), and only when no text is left, the last lines (the
 * shortest). Deterministic, and the identity on anchors that fit.
 */
export function boundPageAnchors(anchors: PageAnchors, maxBytes = RULE_ANCHORS_MAX_BYTES): PageAnchors {
  const texts = anchors.texts.filter((text) => Number.isFinite(jsonbTextBytes(text)));
  const textSums = prefixSums(texts.map((text) => jsonbTextBytes(text)));
  const lineSums = prefixSums(anchors.lines.map((line) => jsonbTextBytes(line)));
  // {"lines": […], "texts": […], "version": n}: braces, keys, ": " and ", " around the two arrays.
  const frame = jsonbTextBytes({ version: anchors.version, texts: [], lines: [] }) - 4;
  const size = (textCount: number, lineCount: number) => frame + arrayBytes(textSums, textCount) + arrayBytes(lineSums, lineCount);
  let textCount = texts.length;
  let lineCount = anchors.lines.length;
  while (textCount > 0 && size(textCount, lineCount) > maxBytes) textCount -= 1;
  while (lineCount > 0 && size(textCount, lineCount) > maxBytes) lineCount -= 1;
  if (textCount === anchors.texts.length && lineCount === anchors.lines.length) return anchors;
  return { version: anchors.version, texts: texts.slice(0, textCount), lines: anchors.lines.slice(0, lineCount) };
}

const BUILDING_CLASSES = new Set(["mur", "cloison", "fond"]);
/** Frames and title blocks are near black: never building lines. */
const NEAR_BLACK_LIGHTNESS = 0.2;

function isBuildingColour(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return false;
  if (lightnessSaturation(rgb).lightness < NEAR_BLACK_LIGHTNESS) return false;
  return isGrey(color) || isNearWhite(color);
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Anchors of a page read at 1/denominator. `classes` gives the class of each group of the reading (its id): a wall,
 * partition or background layer is building whatever its colour. A layer hidden by default is not printed: not read.
 */
export function pageAnchors(extraction: Pick<VectorPageExtraction, "texts" | "paths" | "points" | "groups" | "layers">,
  denominator: number, classes: ReadonlyMap<string, string | null> = new Map()): PageAnchors {
  const metres = (value: number) => (value * MM_PER_POINT * denominator) / 1000;
  const counts = new Map<string, number>();
  for (const text of extraction.texts) {
    const key = normalizeText(text.str);
    if (key.length > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const texts = extraction.texts
    .map((text) => ({ key: normalizeText(text.str), x: text.x, y: text.y }))
    .filter((text) => text.key.length > 0 && text.key.length <= 80 && counts.get(text.key) === 1)
    .sort((left, right) => right.key.length - left.key.length || (left.key < right.key ? -1 : 1))
    .slice(0, REGISTRATION.maxTexts)
    .map((text): [string, number, number] => [text.key, round(metres(text.x)), round(metres(text.y))]);

  const hidden = new Set(extraction.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const building = extraction.groups.map((key) => {
    if (key.layer !== null && hidden.has(key.layer)) return false;
    const cls = classes.get(groupId(key));
    return (cls !== undefined && cls !== null && BUILDING_CLASSES.has(cls)) || isBuildingColour(key.color);
  });
  const minLength = REGISTRATION.minLineLength_m;
  const lines: Array<{ line: [number, number, number, number]; length: number }> = [];
  const seen = new Set<string>();
  const { points } = extraction;
  for (const path of extraction.paths) {
    if (!building[path.group]) continue;
    for (let index = path.start + 1; index < path.start + path.count; index += 1) {
      const x0 = metres(points[2 * index - 2]), y0 = metres(points[2 * index - 1]);
      const x1 = metres(points[2 * index]), y1 = metres(points[2 * index + 1]);
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (!(length >= minLength)) continue;
      // One direction per line: its ends in order, so a line drawn twice (or back) is kept once.
      const ordered: [number, number, number, number] = x0 < x1 || (x0 === x1 && y0 <= y1)
        ? [round(x0), round(y0), round(x1), round(y1)] : [round(x1), round(y1), round(x0), round(y0)];
      const id = ordered.join(",");
      if (seen.has(id)) continue;
      seen.add(id);
      lines.push({ line: ordered, length });
    }
  }
  lines.sort((left, right) => right.length - left.length || left.line.join(",").localeCompare(right.line.join(",")));
  return boundPageAnchors({ version: REGISTRATION_VERSION, texts, lines: lines.slice(0, REGISTRATION.maxLines).map(({ line }) => line) });
}

export type Registration =
  | { status: "registered"; dx: number; dy: number; residual_m: number; texts: number; lines: number; runner_up_lines: number }
  | { status: "unregistered"; reason: "no_anchor" | "no_candidate" | "no_building_text" | "too_few_lines" | "ambiguous" | "residual"; residual_m?: number;
    lines?: number; runner_up_lines?: number };

class EndIndex {
  private readonly cells = new Map<string, number[]>();
  constructor(private readonly ends: ReadonlyArray<readonly [number, number]>, private readonly cell: number) {
    ends.forEach(([x, y], id) => {
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      const list = this.cells.get(key);
      if (list) list.push(id);
      else this.cells.set(key, [id]);
    });
  }

  near(x: number, y: number, radius: number): number[] {
    const found: number[] = [];
    for (let cx = Math.floor((x - radius) / this.cell); cx <= Math.floor((x + radius) / this.cell); cx += 1) {
      for (let cy = Math.floor((y - radius) / this.cell); cy <= Math.floor((y + radius) / this.cell); cy += 1) {
        for (const id of this.cells.get(`${cx},${cy}`) ?? []) {
          const [ex, ey] = this.ends[id];
          if (Math.hypot(ex - x, ey - y) <= radius) found.push(id);
        }
      }
    }
    return found;
  }
}

/** A proposed translation and the texts that propose it (their place on the reference page). */
type Candidate = { dx: number; dy: number; texts: number; at: Array<[number, number]> };

/** Offsets (reference minus other) of the texts printed once on both pages, clustered; largest clusters first. */
function candidates(reference: PageAnchors, other: PageAnchors): Candidate[] {
  const positions = new Map(other.texts.map(([text, x, y]) => [text, [x, y] as const]));
  const offsets: Array<{ offset: [number, number]; at: [number, number] }> = [];
  for (const [text, x, y] of reference.texts) {
    const position = positions.get(text);
    if (position) offsets.push({ offset: [x - position[0], y - position[1]], at: [x, y] });
  }
  const clusters: Array<{ members: typeof offsets }> = [];
  offsets.sort((left, right) => left.offset[0] - right.offset[0] || left.offset[1] - right.offset[1]);
  for (const entry of offsets) {
    const cluster = clusters.find(({ members }) =>
      Math.hypot(members[0].offset[0] - entry.offset[0], members[0].offset[1] - entry.offset[1]) <= REGISTRATION.textCluster_m);
    if (cluster) cluster.members.push(entry);
    else clusters.push({ members: [entry] });
  }
  return clusters
    .filter(({ members }) => members.length >= REGISTRATION.minTexts)
    .map(({ members }) => ({
      dx: members.reduce((sum, { offset }) => sum + offset[0], 0) / members.length,
      dy: members.reduce((sum, { offset }) => sum + offset[1], 0) / members.length,
      texts: members.length,
      at: members.map(({ at }) => at),
    }))
    .sort((left, right) => right.texts - left.texts || left.dx - right.dx || left.dy - right.dy);
}

type Landing = { lines: number; offsets: Array<[number, number]>; box: [number, number, number, number] | null };

/**
 * Lines of `other`, moved by (dx, dy), that land on a line of `reference`, both ends within the tolerance. Each line of
 * `reference` is credited once: strokes drawn over one another never add up to the support of a translation.
 */
function land(reference: PageAnchors, other: PageAnchors, index: EndIndex, dx: number, dy: number): Landing {
  const tolerance = REGISTRATION.lineTolerance_m;
  const offsets: Array<[number, number]> = [];
  const credited = new Set<number>();
  let lines = 0;
  let box: [number, number, number, number] | null = null;
  for (const [x0, y0, x1, y1] of other.lines) {
    const ax = x0 + dx, ay = y0 + dy, bx = x1 + dx, by = y1 + dy;
    let best: [number, number, number, number] | null = null;
    let bestLine = -1;
    let bestDistance = Infinity;
    for (const id of index.near(ax, ay, tolerance)) {
      const line = reference.lines[id >> 1];
      // Ends are indexed in pairs: 2k is the start of line k, 2k + 1 its end.
      const [sx, sy, ex, ey] = id % 2 === 0 ? line : [line[2], line[3], line[0], line[1]];
      const far = Math.hypot(ex - bx, ey - by);
      if (far > tolerance) continue;
      const distance = Math.hypot(sx - ax, sy - ay) + far;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [sx, sy, ex, ey];
        bestLine = id >> 1;
      }
    }
    if (!best || credited.has(bestLine)) continue;
    credited.add(bestLine);
    lines += 1;
    offsets.push([best[0] - x0, best[1] - y0], [best[2] - x1, best[3] - y1]);
    box = [Math.min(box?.[0] ?? Infinity, best[0], best[2]), Math.min(box?.[1] ?? Infinity, best[1], best[3]),
      Math.max(box?.[2] ?? -Infinity, best[0], best[2]), Math.max(box?.[3] ?? -Infinity, best[1], best[3])];
  }
  return { lines, offsets, box };
}

/** Texts of a candidate printed on the building it lands (within the box of its landed lines, plus a margin). */
function textsOnBuilding(candidate: Candidate, landing: Landing) {
  const box = landing.box;
  if (!box) return 0;
  const margin = REGISTRATION.buildingMargin_m;
  return candidate.at.filter(([x, y]) => x >= box[0] - margin && x <= box[2] + margin && y >= box[1] - margin && y <= box[3] + margin).length;
}

/**
 * The translation (dx, dy) that brings `other`'s page metres onto `reference`'s (x + dx, y + dy), or why there is
 * none. Deterministic: the same anchors always give the same answer.
 */
export function registerPages(reference: PageAnchors, other: PageAnchors): Registration {
  if (reference.lines.length === 0 || other.lines.length === 0 || reference.texts.length === 0 || other.texts.length === 0) {
    return { status: "unregistered", reason: "no_anchor" };
  }
  const proposals = candidates(reference, other);
  if (proposals.length === 0) return { status: "unregistered", reason: "no_candidate" };
  const ends = reference.lines.flatMap(([x0, y0, x1, y1]) => [[x0, y0], [x1, y1]] as Array<readonly [number, number]>);
  const index = new EndIndex(ends, Math.max(REGISTRATION.lineTolerance_m * 4, 0.2));
  // A translation only the title block proposes (its texts away from the building lines it lands) is no candidate.
  const scored = proposals
    .map((proposal) => ({ proposal, landing: land(reference, other, index, proposal.dx, proposal.dy) }))
    .filter(({ proposal, landing }) => textsOnBuilding(proposal, landing) >= REGISTRATION.minTexts)
    .sort((left, right) => right.landing.lines - left.landing.lines || right.proposal.texts - left.proposal.texts);
  if (scored.length === 0) return { status: "unregistered", reason: "no_building_text" };
  const [best, next] = scored;
  const runnerUp = next?.landing.lines ?? 0;
  if (best.landing.lines < REGISTRATION.minLines) {
    return { status: "unregistered", reason: "too_few_lines", lines: best.landing.lines, runner_up_lines: runnerUp };
  }
  if (best.landing.lines < REGISTRATION.dominance * runnerUp) {
    return { status: "unregistered", reason: "ambiguous", lines: best.landing.lines, runner_up_lines: runnerUp };
  }
  const mean = (offsets: ReadonlyArray<[number, number]>) => [
    offsets.reduce((sum, [x]) => sum + x, 0) / offsets.length,
    offsets.reduce((sum, [, y]) => sum + y, 0) / offsets.length,
  ] as const;
  // Refined once on the matched ends (the texts' offset is only a proposal), then measured on the lines it lands.
  const [firstDx, firstDy] = mean(best.landing.offsets);
  const refined = land(reference, other, index, firstDx, firstDy);
  const used = refined.lines >= best.landing.lines ? refined : best.landing;
  const [dx, dy] = mean(used.offsets);
  const residual = Math.sqrt(used.offsets.reduce((sum, [x, y]) => sum + (x - dx) ** 2 + (y - dy) ** 2, 0) / used.offsets.length);
  if (residual > REGISTRATION.maxResidual_m) {
    return { status: "unregistered", reason: "residual", residual_m: round(residual, 4), lines: used.lines, runner_up_lines: runnerUp };
  }
  return {
    status: "registered", dx: round(dx, 4), dy: round(dy, 4), residual_m: round(residual, 4), texts: best.proposal.texts,
    lines: used.lines, runner_up_lines: runnerUp,
  };
}

export function translation(dx: number, dy: number): TakeoffFrameTransform {
  return [1, 0, 0, 1, dx, dy];
}

export function applyTransform(transform: TakeoffFrameTransform, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f];
}

export function composeTranslations(first: TakeoffFrameTransform, then: TakeoffFrameTransform): TakeoffFrameTransform {
  return translation(first[4] + then[4], first[5] + then[5]);
}
