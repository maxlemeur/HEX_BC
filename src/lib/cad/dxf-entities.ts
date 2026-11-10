// Entities of a DXF file, one record at a time, in the coordinates of the space
// that holds them (model space or a block definition). Where they go is the
// business of the sink: straight to the drawing, or kept for a block.

import { aciColor } from "./aci";
import { readHatchLoops } from "./dxf-hatch";
import { num, type DxfRecords } from "./dxf-records";
import { cleanMtext, cleanText } from "./dxf-text";
import {
  arcPoints, bulgedOutline, bulgedPointCount, chainLength, circlePoints, determinant, ellipseOutline, IDENTITY, ocsAffine, positiveSweep, radians,
  ringArea, similarityScale, splineOutline, splinePointBound, turnedAngle, type Affine,
} from "./geometry";
import { CAD_PATH_CLOSED, CAD_PATH_COMPOUND, CAD_PATH_FILLED, type CadTextKind } from "./model";

/** Colours that are not a colour yet: the layer's, or the block reference's. */
export const BYLAYER = -1;
export const BYBLOCK = -2;

const LINE = 0, POLYLINE = 1, ARC = 2, CIRCLE = 3, ELLIPSE = 4, SPLINE = 5, HATCH = 6, SOLID = 7, LEADER = 8;

export type RawText = {
  layer: number; color: number; x: number; y: number; height: number; angle: number;
  align: 0 | 1 | 2; baseline: 0 | 1 | 2 | 3; text: string; kind: CadTextKind;
};

export type RawInsert = {
  layer: number; color: number; name: string; x: number; y: number; /** Radians. */ rotation: number; sx: number; sy: number;
  columns: number; rows: number; dx: number; dy: number; ocs: Affine;
  attributes: { tag: string; value: string }[]; attributeTexts: RawText[];
};

export type RawDimension = { layer: number; color: number; name: string };

export interface EntitySink {
  layerOf(name: string): number;
  path(layer: number, color: number, kind: number, flags: number, points: number[], length: number, area: number): void;
  /** Points the space can still hold: a curve is counted against it before it is drawn. */
  room(): number;
  /** An entity was left out because its points would not fit. */
  overflow(): void;
  text(text: RawText): void;
  /** A constant attribute definition: text the block itself draws at each of its references. */
  constant(text: RawText): void;
  insert(insert: RawInsert): void;
  dimension(dimension: RawDimension): void;
  unsupported(type: string): void;
  splineFit(): void;
  skipped(why: "paper" | "invisible"): void;
}

/** Records that belong to the entity before them. */
export function isSubRecord(type: string): boolean {
  return type === "VERTEX" || type === "ATTRIB" || type === "SEQEND";
}

function field(records: DxfRecords, code: number, fallback = 0): number {
  const value = records.first(code);
  return value === undefined ? fallback : num(value);
}

/** Corners without the repeated ones (a triangle stores its last corner twice). */
function distinctCorners(corners: number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < corners.length; index += 2) {
    const count = out.length;
    if (count >= 2 && out[count - 2] === corners[index] && out[count - 1] === corners[index + 1]) continue;
    out.push(corners[index], corners[index + 1]);
  }
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
}

type PendingPolyline = { layer: number; color: number; ocs: Affine; closed: boolean; flat: boolean; vertices: number[] };

export class EntityReader {
  private polyline: PendingPolyline | null = null;
  private pendingInsert: RawInsert | null = null;
  /** The records that follow belong to an entity that is not read. */
  private skipSub = false;
  private layer = 0;
  private color = BYLAYER;
  private ocs: Affine = IDENTITY;

  constructor(private readonly sink: EntitySink) {}

  /** Closes what a missing SEQEND left open. */
  flush(): void {
    this.skipSub = false;
    const polyline = this.polyline, insert = this.pendingInsert;
    this.polyline = null;
    this.pendingInsert = null;
    if (polyline && polyline.vertices.length >= 6 && !this.over(bulgedPointCount(polyline.vertices, polyline.closed))) {
      const outline = bulgedOutline(polyline.vertices, polyline.closed);
      this.emit(polyline.layer, polyline.color, POLYLINE, polyline.closed ? CAD_PATH_CLOSED : 0, outline.points, outline.length, Math.abs(outline.area), polyline.ocs);
    }
    if (insert) this.sink.insert(insert);
  }

  read(records: DxfRecords): void {
    const type = records.type;
    if (type === "SEQEND") { this.flush(); return; }
    if (type === "VERTEX") {
      const polyline = this.polyline;
      // Flag 16 is a control point of the spline frame, not a point of the curve.
      if (polyline && !this.skipSub && (field(records, 70) & 16) === 0) polyline.vertices.push(field(records, 10), field(records, 20), polyline.flat ? 0 : field(records, 42));
      return;
    }
    if (type === "ATTRIB") { this.attribute(records); return; }
    this.flush();
    const hidden = this.common(records);
    if (hidden) {
      this.sink.skipped(hidden);
      this.skipSub = type === "POLYLINE" || (type === "INSERT" && field(records, 66) === 1);
      return;
    }
    const { layer, color, ocs } = this;
    switch (type) {
      case "LINE": {
        const x1 = field(records, 10), y1 = field(records, 20), x2 = field(records, 11), y2 = field(records, 21);
        this.emit(layer, color, LINE, 0, [x1, y1, x2, y2], Math.hypot(x2 - x1, y2 - y1), 0, IDENTITY);
        return;
      }
      case "LWPOLYLINE": {
        const { codes, values, count } = records, vertices: number[] = [];
        let closed = false;
        for (let index = 0; index < count; index += 1) {
          const code = codes[index];
          if (code === 10) vertices.push(num(values[index]), 0, 0);
          else if (code === 20 && vertices.length > 0) vertices[vertices.length - 2] = num(values[index]);
          else if (code === 42 && vertices.length > 0) vertices[vertices.length - 1] = num(values[index]);
          else if (code === 70) closed = (num(values[index]) & 1) === 1;
        }
        if (vertices.length < 6 || this.over(bulgedPointCount(vertices, closed))) return;
        const outline = bulgedOutline(vertices, closed);
        this.emit(layer, color, POLYLINE, closed ? CAD_PATH_CLOSED : 0, outline.points, outline.length, Math.abs(outline.area), ocs);
        return;
      }
      case "POLYLINE": {
        const flag = field(records, 70);
        if (flag & (16 | 64)) { this.sink.unsupported("POLYLINE (maillage)"); this.skipSub = true; return; }
        // A 3D polyline is in world coordinates and has no arcs: it is read flat.
        const flat = (flag & 8) !== 0;
        this.polyline = { layer, color, ocs: flat ? IDENTITY : ocs, closed: (flag & 1) === 1, flat, vertices: [] };
        return;
      }
      case "ARC": {
        // A radius written negative is the same arc, measured the same.
        const cx = field(records, 10), cy = field(records, 20), radius = Math.abs(field(records, 40)), start = field(records, 50) % 360;
        const sweep = positiveSweep(start, field(records, 51), 360);
        this.emit(layer, color, ARC, 0, arcPoints(cx, cy, radius, radians(start), radians(sweep), true), radius * radians(sweep), 0, ocs);
        return;
      }
      case "CIRCLE": {
        const radius = Math.abs(field(records, 40));
        this.emit(layer, color, CIRCLE, CAD_PATH_CLOSED, circlePoints(field(records, 10), field(records, 20), radius), 2 * Math.PI * radius, Math.PI * radius * radius, ocs);
        return;
      }
      case "ELLIPSE": {
        const mx = field(records, 11), my = field(records, 21), mz = field(records, 31), ratio = field(records, 40, 1);
        let nx = field(records, 210), ny = field(records, 220), nz = field(records, 230, 1);
        const norm = Math.hypot(nx, ny, nz);
        if (norm > 0) { nx /= norm; ny /= norm; nz /= norm; } else { nx = 0; ny = 0; nz = 1; }
        // The minor axis is the normal crossed with the major axis, seen in plan.
        const outline = ellipseOutline(
          field(records, 10), field(records, 20), mx, my, ratio * (ny * mz - nz * my), ratio * (nz * mx - nx * mz),
          field(records, 41), field(records, 42, 2 * Math.PI),
        );
        this.emit(layer, color, ELLIPSE, outline.closed ? CAD_PATH_CLOSED : 0, outline.points, outline.length, Math.abs(outline.area), IDENTITY);
        return;
      }
      case "SPLINE": this.spline(records); return;
      case "INSERT": {
        const insert: RawInsert = {
          layer, color, name: (records.first(2) ?? "").trim(), x: field(records, 10), y: field(records, 20), rotation: radians(field(records, 50)),
          sx: field(records, 41, 1), sy: field(records, 42, 1), columns: Math.max(1, Math.trunc(field(records, 70, 1))), rows: Math.max(1, Math.trunc(field(records, 71, 1))),
          dx: field(records, 44), dy: field(records, 45), ocs, attributes: [], attributeTexts: [],
        };
        if (field(records, 66) === 1) this.pendingInsert = insert; else this.sink.insert(insert);
        return;
      }
      case "TEXT": {
        const text = this.singleLine(records, "text", 73);
        if (text) this.sink.text(text);
        return;
      }
      case "MTEXT": this.mtext(records); return;
      case "DIMENSION": {
        const name = (records.first(2) ?? "").trim();
        if (name !== "") this.sink.dimension({ layer, color, name });
        return;
      }
      case "HATCH": {
        const read = readHatchLoops(records, this.sink.room());
        if (read === null) { this.sink.overflow(); return; }
        const { solid, loops } = read;
        loops.forEach((loop, index) => {
          this.emit(layer, color, HATCH, CAD_PATH_CLOSED | (solid ? CAD_PATH_FILLED : 0) | (index > 0 ? CAD_PATH_COMPOUND : 0), loop.points, loop.length, loop.area, ocs);
        });
        return;
      }
      case "SOLID": case "TRACE": case "3DFACE": {
        const filled = type !== "3DFACE";
        const third = [field(records, 12), field(records, 22)];
        const fourth = records.first(13) === undefined ? third : [field(records, 13), field(records, 23)];
        // A SOLID stores its corners in a Z: first, second, fourth, third.
        const points = distinctCorners([field(records, 10), field(records, 20), field(records, 11), field(records, 21), ...(filled ? [...fourth, ...third] : [...third, ...fourth])]);
        if (points.length < 6) return;
        this.emit(layer, color, SOLID, CAD_PATH_CLOSED | (filled ? CAD_PATH_FILLED : 0), points, chainLength(points, true), Math.abs(ringArea(points)), filled ? ocs : IDENTITY);
        return;
      }
      case "LEADER": {
        const { codes, values, count } = records, points: number[] = [];
        for (let index = 0; index < count; index += 1) {
          if (codes[index] === 10) points.push(num(values[index]), 0);
          else if (codes[index] === 20 && points.length > 0) points[points.length - 1] = num(values[index]);
        }
        if (points.length >= 4) this.emit(layer, color, LEADER, 0, points, chainLength(points, false), 0, IDENTITY);
        return;
      }
      case "ATTDEF": {
        // Constant (2) and not invisible (1): no ATTRIB follows the references, the block writes the value itself.
        const flags = field(records, 70);
        if ((flags & 2) === 0 || (flags & 1) !== 0) return;
        const text = this.singleLine(records, "attribute", 74);
        if (text) this.sink.constant(text);
        return;
      }
      case "POINT": return;
      default: this.sink.unsupported(type);
    }
  }

  /** Layer, colour and extrusion of the record; what hides it, if anything. */
  private common(records: DxfRecords): "paper" | "invisible" | null {
    const { codes, values, count } = records, mtext = records.type === "MTEXT";
    let layer: string | undefined, aci: number | undefined, rgb: number | undefined;
    let paper = false, invisible = false, nx = 0, ny = 0, nz = 1, content = false;
    for (let index = 0; index < count; index += 1) {
      switch (codes[index]) {
        case 8: layer ??= values[index]; break;
        case 62: aci ??= num(values[index]); break;
        // After its content, an MTEXT gives the colour of its background with the same code.
        case 420: if (!content) rgb ??= num(values[index]) & 0xffffff; break;
        case 67: paper ||= num(values[index]) === 1; break;
        case 60: invisible ||= num(values[index]) === 1; break;
        case 210: nx = num(values[index]); break;
        case 220: ny = num(values[index]); break;
        case 230: nz = num(values[index]); break;
        case 1: case 3: content = mtext; break;
        default:
      }
    }
    this.layer = this.sink.layerOf(layer ?? "0");
    this.color = rgb !== undefined ? rgb : aci === undefined || aci === 256 || aci < 0 ? BYLAYER : aci === 0 ? BYBLOCK : aciColor(aci);
    this.ocs = ocsAffine(nx, ny, nz);
    return paper ? "paper" : invisible ? "invisible" : null;
  }

  /** True, and said to the sink, when that many points would not fit: the curve is then not drawn at all. */
  private over(points: number): boolean {
    if (points <= this.sink.room()) return false;
    this.sink.overflow();
    return true;
  }

  private emit(layer: number, color: number, kind: number, flags: number, points: number[], length: number, area: number, ocs: Affine): void {
    if (ocs === IDENTITY) { this.sink.path(layer, color, kind, flags, points, length, area); return; }
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index], y = points[index + 1];
      points[index] = ocs[0] * x + ocs[2] * y;
      points[index + 1] = ocs[1] * x + ocs[3] * y;
    }
    const scale = similarityScale(ocs);
    const placed = scale === null ? chainLength(points, (flags & CAD_PATH_CLOSED) !== 0) : length * scale;
    this.sink.path(layer, color, kind, flags, points, placed, area * Math.abs(determinant(ocs)));
  }

  private spline(records: DxfRecords): void {
    const { codes, values, count } = records;
    const knots: number[] = [], control: number[] = [], weights: number[] = [], fit: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const code = codes[index], value = num(values[index]);
      if (code === 40) knots.push(value);
      else if (code === 41) weights.push(value);
      else if (code === 10) control.push(value, 0);
      else if (code === 20 && control.length > 0) control[control.length - 1] = value;
      else if (code === 11) fit.push(value, 0);
      else if (code === 21 && fit.length > 0) fit[fit.length - 1] = value;
    }
    const degree = field(records, 71, 3);
    if (this.over(splinePointBound(degree, knots.length, control.length / 2))) return;
    const outline = splineOutline(degree, knots, control, weights);
    let points: number[], length: number;
    if (outline) { points = outline.points; length = outline.length; }
    else if (fit.length >= 4) { points = fit; length = chainLength(fit, false); this.sink.splineFit(); }
    else if (control.length >= 4) { points = control; length = chainLength(control, false); }
    else return;
    const last = points.length - 2;
    const reach = 1e-9 * Math.max(1, Math.abs(points[0]), Math.abs(points[1]));
    const closed = points.length >= 8 && Math.hypot(points[last] - points[0], points[last + 1] - points[1]) <= reach;
    if (closed) points.length = last;
    this.emit(this.layer, this.color, SPLINE, closed ? CAD_PATH_CLOSED : 0, points, length, closed ? Math.abs(ringArea(points)) : 0, IDENTITY);
  }

  /** TEXT, ATTRIB or ATTDEF: the vertical alignment has its own code in the first. */
  private singleLine(records: DxfRecords, kind: CadTextKind, verticalCode: number): RawText | null {
    const text = cleanText(records.first(1) ?? "");
    if (text === "") return null;
    const horizontal = field(records, 72), vertical = field(records, verticalCode);
    // Aligned (3) and fit (5) stretch between two points: the text starts at the first.
    const second = (horizontal !== 0 || vertical !== 0) && horizontal !== 3 && horizontal !== 5 && records.first(11) !== undefined;
    const x = field(records, second ? 11 : 10), y = field(records, second ? 21 : 20), ocs = this.ocs;
    return {
      layer: this.layer, color: this.color,
      x: ocs === IDENTITY ? x : ocs[0] * x + ocs[2] * y, y: ocs === IDENTITY ? y : ocs[1] * x + ocs[3] * y,
      height: field(records, 40) * Math.sqrt(Math.abs(determinant(ocs))), angle: turnedAngle(ocs, radians(field(records, 50))),
      align: horizontal === 1 || horizontal === 4 ? 1 : horizontal === 2 ? 2 : 0,
      baseline: horizontal === 4 ? 2 : vertical === 1 ? 1 : vertical === 2 ? 2 : vertical === 3 ? 3 : 0,
      text, kind,
    };
  }

  private mtext(records: DxfRecords): void {
    const { codes, values, count } = records;
    let raw = "";
    for (let index = 0; index < count; index += 1) if (codes[index] === 3 || codes[index] === 1) raw += values[index];
    const text = cleanMtext(raw);
    if (text === "") return;
    const attachment = Math.min(9, Math.max(1, Math.trunc(field(records, 71, 1))));
    const directed = records.first(11) !== undefined;
    this.sink.text({
      layer: this.layer, color: this.color, x: field(records, 10), y: field(records, 20), height: field(records, 40),
      angle: directed ? Math.atan2(field(records, 21), field(records, 11)) : radians(field(records, 50)),
      align: ((attachment - 1) % 3) as 0 | 1 | 2, baseline: ([3, 2, 1] as const)[Math.floor((attachment - 1) / 3)],
      text, kind: "mtext",
    });
  }

  private attribute(records: DxfRecords): void {
    const insert = this.pendingInsert;
    if (!insert || this.skipSub) return;
    const hidden = this.common(records);
    insert.attributes.push({ tag: (records.first(2) ?? "").trim(), value: cleanText(records.first(1) ?? "") });
    if (hidden || (field(records, 70) & 1) === 1) return;
    const text = this.singleLine(records, "attribute", 74);
    if (text) insert.attributeTexts.push(text);
  }
}
