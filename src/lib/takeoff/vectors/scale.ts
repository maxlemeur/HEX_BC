import { MM_PER_POINT, SegmentIndex, distanceToSegment, orientation, orientationGap, segmentLength, type Segment } from "@/lib/takeoff/vectors/geometry";
import type { VectorText } from "@/lib/takeoff/vectors/extraction";

// Scale of a page (TI-662 step 2): the cartouche scale, checked by a cote.
// - Cartouche: a « 1/n » or « 1 : n » text labelled by « Échelle » / « Scale »
//   (same text, or within 4 text heights after it); every value of a text
//   counts. Several labelled values that differ (views at other scales):
//   ambiguous. Without label, a single value of 1/10 or above on the whole
//   page is taken, never a sheet number (« Page 1/2 »); two or more: ambiguous.
// - Format: an ISO A0 to A4 or « 1398x841 » text labelled by « Format »,
//   compared with the page size (both orientations) within 1 % or 3 mm.
// - Cote: a numeric text (« 5,00 » in metres when it has decimals, « 4500 »
//   in millimetres when it has none, or with its unit) above a stroked segment
//   parallel to it (text centre over the middle 80 % of the segment, 0.1 to 1.5
//   text heights away, the segment at least 4 text heights and 1.5 text widths
//   long), whose two ends are each crossed by another stroke at 30° or more
//   (tick, oblique or extension line); the cote spans the two crossings, the
//   line may run up to 2 % past them. A framed number does not pass: the
//   frame's corners are joints, not crossings. A candidate whose drawn length
//   is more than 4 times, or less than a quarter of, its value is no cote (a
//   number beside a hatch or a table rule): only a print reduction down to A3
//   of an A0 sheet stays within, and is then reported as inconsistent.
// - Consistent within max(2 %, half the rounding unit of the cote) (starting
//   value, Max may change it). Rounding unit: 10^-decimals of the printed unit.
// - Status: « calibrated » with a page calibration (conventions.calibration
//   lifts the block); otherwise « unverified » without cartouche scale, with
//   an ambiguous one, or with any inconsistent cote; « verified » with at
//   least one consistent cote; without cote, « format » when the cartouche
//   format is the page's, « unverified » when it differs or is unknown (a cote
//   is then mandatory). Lengths and areas are given only when measurable;
//   counts always.

export const SCALE_RULE_VERSION = 1;
export const COTE_RELATIVE_TOLERANCE = 0.02;
/** Past this ratio between drawn length and value, a numeric text by a line is not read as a cote. */
export const COTE_PLAUSIBLE_RATIO = 4;
export const FORMAT_TOLERANCE = { relative: 0.01, absoluteMm: 3 } as const;
const DENOMINATORS = new Set([1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 2000, 2500, 5000]);
const ISO_FORMATS: Record<string, [number, number]> = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };

export type PageCalibration =
  | { page: number; denominator: number; source: string }
  | { page: number; from: { x: number; y: number }; to: { x: number; y: number }; distance_m: number; source: string };

export type Cote = {
  text: string;
  value_m: number;
  measured_m: number;
  deviation: number;
  tolerance: number;
  consistent: boolean;
};

export type ScaleStatus = "verified" | "format" | "calibrated" | "unverified";
export type ScaleReason =
  | "no_scale" | "ambiguous_scale" | "dimension_mismatch" | "no_dimension_format_differs" | "no_dimension_format_unknown" | null;

export type PageScale = {
  rule_version: number;
  status: ScaleStatus;
  reason: ScaleReason;
  /** The denominator lengths use: null when the page is not measurable. */
  denominator: number | null;
  cartouche: { denominator: number; text: string; labelled: boolean } | null;
  candidates: number[];
  format: { cartouche: string | null; cartouche_mm: [number, number] | null; page_mm: [number, number]; matches: boolean | null };
  cotes: Cote[];
  calibration: { denominator: number; source: string } | null;
};

const SCALE_PATTERN = /(?:^|[^\d/])1\s*[/:]\s*(\d{1,4})(?![\d/])/g;
const SHEET_NUMBER = /\b(?:page|planche|pl\.|folio|feuille|f°)\s*\d/i;
const LABEL_PATTERN = /[ée]chelle|\bscale\b|\bech\b/i;

function centre(text: VectorText) {
  // x, y is the baseline start; the glyph box rises perpendicular to the baseline.
  const c = Math.cos(text.angle), s = Math.sin(text.angle);
  return { x: text.x + (c * text.width) / 2 + (s * text.height) / 2, y: text.y + (s * text.width) / 2 - (c * text.height) / 2 };
}

function near(label: VectorText, value: VectorText) {
  const h = Math.max(label.height, value.height, 1);
  const dx = value.x - (label.x + label.width), dy = value.y - label.y;
  const below = Math.abs(value.x - label.x) <= Math.max(label.width, value.width) + 2 * h && dy > 0 && dy <= 4 * h;
  const after = dx >= -h && dx <= 8 * h && Math.abs(dy) <= h;
  return below || after;
}

function cartoucheScale(texts: readonly VectorText[]) {
  // Every scale of a text (« ECHELLES : 1/50 - 1/20 » names two).
  const values = texts.flatMap((text) => [...text.str.matchAll(SCALE_PATTERN)].flatMap((match) => {
    const denominator = Number(match[1]);
    return DENOMINATORS.has(denominator) ? [{ text, denominator }] : [];
  }));
  const labels = texts.filter((text) => LABEL_PATTERN.test(text.str));
  const labelled = values.filter(({ text }) => LABEL_PATTERN.test(text.str) || labels.some((label) => label !== text && near(label, text)));
  const distinct = (entries: typeof values) => [...new Set(entries.map((entry) => entry.denominator))];
  const candidates = distinct(values).sort((a, b) => a - b);
  if (labelled.length > 0) {
    const found = distinct(labelled);
    return found.length === 1 ? { scale: { denominator: found[0], text: labelled[0].text.str, labelled: true }, ambiguous: false, candidates }
      : { scale: null, ambiguous: true, candidates };
  }
  // Unlabelled, only a drawing scale (1/10 and above) outside a sheet number (« Page 1/2 », « Planche 1/5 »).
  const unlabelled = distinct(values.filter(({ text, denominator }) => denominator >= 10 && !SHEET_NUMBER.test(text.str)));
  if (unlabelled.length === 1) {
    const entry = values.find((value) => value.denominator === unlabelled[0]) as (typeof values)[number];
    return { scale: { denominator: unlabelled[0], text: entry.text.str, labelled: false }, ambiguous: false, candidates };
  }
  return { scale: null, ambiguous: unlabelled.length > 1, candidates };
}

function cartoucheFormat(texts: readonly VectorText[]): { text: string; mm: [number, number] } | null {
  const labels = texts.filter((text) => /\bformat\b/i.test(text.str));
  for (const text of texts) {
    const iso = /^\s*(?:format\s*:?\s*)?(A[0-4])\s*$/i.exec(text.str);
    const custom = /^\s*(?:format\s*:?\s*)?(\d{3,4})\s*[x×]\s*(\d{3,4})\s*(?:ht|mm)?\s*$/i.exec(text.str);
    if (!iso && !custom) continue;
    if (!/format/i.test(text.str) && !labels.some((label) => near(label, text))) continue;
    if (iso) return { text: text.str.trim(), mm: ISO_FORMATS[iso[1].toUpperCase()] };
    return { text: text.str.trim(), mm: [Number(custom![1]), Number(custom![2])] };
  }
  return null;
}

function formatMatches(cartouche: [number, number], page: [number, number]) {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(FORMAT_TOLERANCE.absoluteMm, FORMAT_TOLERANCE.relative * b);
  const [w, h] = cartouche;
  return (close(page[0], w) && close(page[1], h)) || (close(page[0], h) && close(page[1], w));
}

/** Value in metres and rounding unit of a cote text, or null. */
export function parseCote(text: string): { value_m: number; unit_m: number } | null {
  const match = /^\s*(\d{1,6})(?:[.,](\d{1,3}))?\s*(mm|cm|m)?\s*$/i.exec(text);
  if (!match) return null;
  const decimals = match[2]?.length ?? 0;
  const value = Number(`${match[1]}${decimals ? `.${match[2]}` : ""}`);
  const unit = match[3]?.toLowerCase() ?? (decimals > 0 ? "m" : "mm");
  const metres = unit === "m" ? 1 : unit === "cm" ? 0.01 : 0.001;
  if (value <= 0) return null;
  return { value_m: value * metres, unit_m: metres * 10 ** -decimals };
}

/**
 * Where a tick crosses the dimension line near one of its ends: the parameter
 * along the line (0 at its start, 1 at its end), or null. The tick is at 30° or
 * more, the crossing lies within its middle 70 % (a crossing, not a frame
 * corner), and within the first or last 15 % of the line, or up to 2 % past
 * it: CAD lines often run a little past their ticks.
 */
function tickAt(line: Segment, other: Segment, end: 0 | 1): number | null {
  if (orientationGap(orientation(line), orientation(other)) < Math.PI / 6) return null;
  const rx = line.x1 - line.x0, ry = line.y1 - line.y0, sx = other.x1 - other.x0, sy = other.y1 - other.y0;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const qx = other.x0 - line.x0, qy = other.y0 - line.y0;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (u < 0.15 || u > 0.85) return null;
  if (end === 0 ? t < -0.02 || t > 0.15 : t < 0.85 || t > 1.02) return null;
  return t;
}

/** Readable cotes of the page with the length the drawing gives them at 1/denominator. */
export function findCotes(texts: readonly VectorText[], index: SegmentIndex, denominator: number): Cote[] {
  const cotes: Cote[] = [];
  const segments = index.segments;
  for (const text of texts) {
    const parsed = parseCote(text.str);
    if (!parsed || text.height <= 0) continue;
    const c = centre(text);
    const h = text.height;
    let best: { segment: Segment; distance: number } | null = null;
    for (const id of index.near(c, Math.max(1.5 * h, text.width))) {
      const segment = segments[id];
      const length = segmentLength(segment);
      if (length < Math.max(1.5 * text.width, 4 * h) || orientationGap(orientation(segment), ((text.angle % Math.PI) + Math.PI) % Math.PI) > (2 * Math.PI) / 180) continue;
      const t = ((c.x - segment.x0) * (segment.x1 - segment.x0) + (c.y - segment.y0) * (segment.y1 - segment.y0)) / (length * length);
      if (t < 0.1 || t > 0.9) continue;
      const distance = distanceToSegment(c, segment);
      if (distance < 0.1 * h || distance > 1.5 * h) continue;
      if (!best || distance < best.distance) best = { segment, distance };
    }
    if (!best) continue;
    const line = best.segment;
    const reach = 3 * h;
    const ends = [{ x: line.x0, y: line.y0 }, { x: line.x1, y: line.y1 }];
    // The cote spans its two ticks, even when the line runs past them.
    const ticks = ([0, 1] as const).map((end) => index.near(ends[end], reach).flatMap((id) => {
      const other = segments[id];
      if (other === line || segmentLength(other) > 2 * reach) return [];
      const t = tickAt(line, other, end);
      return t === null ? [] : [t];
    }).sort((left, right) => (end === 0 ? right - left : left - right))[0]);
    if (ticks.some((t) => t === undefined)) continue;
    const measured = (((ticks[1] as number) - (ticks[0] as number)) * segmentLength(line) * MM_PER_POINT * denominator) / 1000;
    if (measured > COTE_PLAUSIBLE_RATIO * parsed.value_m || measured * COTE_PLAUSIBLE_RATIO < parsed.value_m) continue;
    const tolerance = Math.max(COTE_RELATIVE_TOLERANCE * parsed.value_m, parsed.unit_m / 2);
    const deviation = Math.abs(measured - parsed.value_m);
    cotes.push({ text: text.str.trim(), value_m: parsed.value_m, measured_m: Math.round(measured * 1e4) / 1e4,
      deviation: Math.round(deviation * 1e4) / 1e4, tolerance: Math.round(tolerance * 1e4) / 1e4, consistent: deviation <= tolerance + 1e-9 });
  }
  return cotes;
}

function calibrationDenominator(calibration: PageCalibration) {
  if ("denominator" in calibration) return calibration.denominator;
  const sheetMm = Math.hypot(calibration.to.x - calibration.from.x, calibration.to.y - calibration.from.y) * MM_PER_POINT;
  return sheetMm > 0 ? (calibration.distance_m * 1000) / sheetMm : NaN;
}

export function readPageScale(input: {
  texts: readonly VectorText[];
  index: SegmentIndex;
  width: number;
  height: number;
  calibration?: PageCalibration | null;
}): PageScale {
  const page_mm: [number, number] = [Math.round(input.width * MM_PER_POINT), Math.round(input.height * MM_PER_POINT)];
  const { scale, ambiguous, candidates } = cartoucheScale(input.texts);
  const format = cartoucheFormat(input.texts);
  const formatInfo = { cartouche: format?.text ?? null, cartouche_mm: format?.mm ?? null, page_mm,
    matches: format ? formatMatches(format.mm, page_mm) : null };
  const base = { rule_version: SCALE_RULE_VERSION, cartouche: scale, candidates, format: formatInfo, calibration: null };
  if (input.calibration) {
    const denominator = calibrationDenominator(input.calibration);
    if (Number.isFinite(denominator) && denominator > 0) {
      const cotes = findCotes(input.texts, input.index, denominator);
      return { ...base, status: "calibrated", reason: null, denominator, cotes,
        calibration: { denominator: Math.round(denominator * 1000) / 1000, source: input.calibration.source } };
    }
  }
  if (!scale) return { ...base, status: "unverified", reason: ambiguous ? "ambiguous_scale" : "no_scale", denominator: null, cotes: [] };
  const cotes = findCotes(input.texts, input.index, scale.denominator);
  if (cotes.some((cote) => !cote.consistent)) return { ...base, status: "unverified", reason: "dimension_mismatch", denominator: null, cotes };
  if (cotes.length > 0) return { ...base, status: "verified", reason: null, denominator: scale.denominator, cotes };
  if (formatInfo.matches === true) return { ...base, status: "format", reason: null, denominator: scale.denominator, cotes };
  return { ...base, status: "unverified", reason: formatInfo.matches === false ? "no_dimension_format_differs" : "no_dimension_format_unknown",
    denominator: null, cotes };
}
