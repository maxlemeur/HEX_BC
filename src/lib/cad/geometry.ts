// Plane geometry of the CAD reader: affine transforms, the object coordinate
// system of extruded entities, and curves turned into points. Lengths and areas
// come from the exact formulas wherever one exists, never from the points.

/** x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const TURN = 2 * Math.PI;
/** Segments of a full turn. */
const TURN_SEGMENTS = 72;

/** `first` applied, then `then`. */
export function compose(then: Affine, first: Affine): Affine {
  if (then === IDENTITY) return first;
  if (first === IDENTITY) return then;
  return [
    then[0] * first[0] + then[2] * first[1],
    then[1] * first[0] + then[3] * first[1],
    then[0] * first[2] + then[2] * first[3],
    then[1] * first[2] + then[3] * first[3],
    then[0] * first[4] + then[2] * first[5] + then[4],
    then[1] * first[4] + then[3] * first[5] + then[5],
  ];
}

export function translation(x: number, y: number): Affine {
  return x === 0 && y === 0 ? IDENTITY : [1, 0, 0, 1, x, y];
}

export function rotation(radians: number): Affine {
  if (radians === 0) return IDENTITY;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

export function scaling(sx: number, sy: number): Affine {
  return sx === 1 && sy === 1 ? IDENTITY : [sx, 0, 0, sy, 0, 0];
}

export function determinant(matrix: Affine): number {
  return matrix[0] * matrix[3] - matrix[1] * matrix[2];
}

/** Scale of a similarity (rotation, mirror, uniform scale), null when the transform stretches. */
export function similarityScale(matrix: Affine): number | null {
  if (matrix === IDENTITY) return 1;
  const s1 = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
  const s2 = Math.sqrt(matrix[2] * matrix[2] + matrix[3] * matrix[3]);
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3];
  if (Math.abs(s1 - s2) > 1e-9 * Math.max(s1, s2) || Math.abs(dot) > 1e-9 * s1 * s2) return null;
  return s1;
}

/** Angle of a direction once transformed; the angle itself under the identity. */
export function turnedAngle(matrix: Affine, angle: number): number {
  if (matrix === IDENTITY) return angle;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return Math.atan2(matrix[1] * cos + matrix[3] * sin, matrix[0] * cos + matrix[2] * sin);
}

/** Degrees to radians, exact on the quarter turns. */
export function radians(degrees: number): number {
  return (degrees / 180) * Math.PI;
}

/**
 * Object coordinate system of an extrusion direction (arbitrary axis algorithm),
 * seen in plan: the x and y axes of the entity projected on the world plane.
 */
export function ocsAffine(nx: number, ny: number, nz: number): Affine {
  if (nx === 0 && ny === 0 && nz > 0) return IDENTITY;
  const norm = Math.hypot(nx, ny, nz);
  if (!(norm > 0)) return IDENTITY;
  const x = nx / norm, y = ny / norm, z = nz / norm;
  let ax: number, ay: number, az: number;
  if (Math.abs(x) < 1 / 64 && Math.abs(y) < 1 / 64) { ax = z; ay = 0; az = -x; } else { ax = -y; ay = x; az = 0; }
  const length = Math.hypot(ax, ay, az);
  ax /= length; ay /= length; az /= length;
  // Ay = N × Ax.
  return [ax, ay, y * az - z * ay, z * ax - x * az, 0, 0];
}

/** Sweep from `start` to `end` in (0, turn]: a huge angle costs a modulo, never a loop. */
export function positiveSweep(start: number, end: number, turn: number): number {
  const sweep = (end - start) % turn;
  if (!Number.isFinite(sweep)) return turn;
  return sweep <= 0 ? sweep + turn : sweep;
}

function arcSegments(sweep: number): number {
  return Math.max(2, 2 * Math.ceil((Math.abs(sweep) / TURN) * (TURN_SEGMENTS / 2)));
}

/** Points of an arc from `start` over `sweep` radians (signed), ends included or not. */
export function arcPoints(cx: number, cy: number, radius: number, start: number, sweep: number, ends: boolean, out: number[] = []): number[] {
  const segments = arcSegments(sweep);
  for (let index = ends ? 0 : 1; index <= (ends ? segments : segments - 1); index += 1) {
    const angle = start + (sweep * index) / segments;
    out.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  return out;
}

export function circlePoints(cx: number, cy: number, radius: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < TURN_SEGMENTS; index += 1) {
    const angle = (TURN * index) / TURN_SEGMENTS;
    out.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  return out;
}

/** Length of a chain of points, closing segment included when closed. */
export function chainLength(points: ArrayLike<number>, closed: boolean): number {
  const count = points.length / 2;
  let length = 0;
  for (let index = 1; index < count; index += 1) length += Math.hypot(points[2 * index] - points[2 * index - 2], points[2 * index + 1] - points[2 * index - 1]);
  if (closed && count > 2) length += Math.hypot(points[0] - points[2 * count - 2], points[1] - points[2 * count - 1]);
  return length;
}

/** Signed area of a ring (positive counter-clockwise). */
export function ringArea(points: ArrayLike<number>): number {
  const count = points.length / 2;
  let twice = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    twice += points[2 * index] * points[2 * next + 1] - points[2 * next] * points[2 * index + 1];
  }
  return twice / 2;
}

export function pointInRing(points: ArrayLike<number>, x: number, y: number): boolean {
  const count = points.length / 2;
  let inside = false;
  for (let index = 0, previous = count - 1; index < count; previous = index, index += 1) {
    const xi = points[2 * index], yi = points[2 * index + 1], xj = points[2 * previous], yj = points[2 * previous + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type Outline = { points: number[]; length: number; /** Signed, 0 when open. */ area: number };

/** Points `bulgedOutline` gives for these vertices, counted without drawing the arcs. */
export function bulgedPointCount(vertices: ArrayLike<number>, closed: boolean): number {
  const count = vertices.length / 3, last = closed ? count : count - 1;
  let points = count;
  for (let index = 0; index < last; index += 1) {
    const bulge = vertices[3 * index + 2];
    if (bulge !== 0) points += arcSegments(4 * Math.atan(bulge)) - 1;
  }
  return points;
}

/**
 * Polyline whose vertices carry a bulge (tangent of a quarter of the arc to the
 * next vertex, positive counter-clockwise). `vertices` holds x, y, bulge triples.
 */
export function bulgedOutline(vertices: ArrayLike<number>, closed: boolean): Outline {
  const count = vertices.length / 3;
  const points: number[] = [];
  let length = 0, twice = 0, caps = 0;
  const last = closed ? count : count - 1;
  for (let index = 0; index < count; index += 1) {
    const x1 = vertices[3 * index], y1 = vertices[3 * index + 1], bulge = vertices[3 * index + 2];
    points.push(x1, y1);
    if (index >= last) continue;
    const next = (index + 1) % count;
    const x2 = vertices[3 * next], y2 = vertices[3 * next + 1];
    const chord = Math.hypot(x2 - x1, y2 - y1);
    twice += x1 * y2 - x2 * y1;
    if (bulge === 0 || chord === 0) { length += chord; continue; }
    const sweep = 4 * Math.atan(bulge), turn = Math.abs(sweep);
    const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
    const offset = (1 - bulge * bulge) / (4 * bulge);
    const cx = (x1 + x2) / 2 - (y2 - y1) * offset, cy = (y1 + y2) / 2 + (x2 - x1) * offset;
    length += radius * turn;
    caps += Math.sign(bulge) * ((radius * radius) / 2) * (turn - Math.sin(turn));
    arcPoints(cx, cy, radius, Math.atan2(y1 - cy, x1 - cx), sweep, false, points);
  }
  return { points, length, area: closed && count > 1 ? twice / 2 + caps : 0 };
}

export type EllipseOutline = Outline & { closed: boolean };

/** P(t) = C + M cos t + m sin t, from `start` to `end` (radians, counter-clockwise). */
export function ellipseOutline(cx: number, cy: number, mx: number, my: number, nx: number, ny: number, start: number, end: number): EllipseOutline {
  // A whole ellipse is often written from 0 to 6.283185: six decimals close it.
  let sweep = positiveSweep(start, end, TURN);
  const closed = sweep <= 1e-6 || TURN - sweep <= 1e-6;
  if (closed) sweep = TURN;
  const segments = arcSegments(sweep);
  const points: number[] = [];
  for (let index = 0; index <= (closed ? segments - 1 : segments); index += 1) {
    const t = start + (sweep * index) / segments;
    const cos = Math.cos(t), sin = Math.sin(t);
    points.push(cx + mx * cos + nx * sin, cy + my * cos + ny * sin);
  }
  // Simpson on the speed |P'(t)|: no closed form for the perimeter of an ellipse.
  const steps = 512;
  let sum = 0;
  for (let index = 0; index <= steps; index += 1) {
    const t = start + (sweep * index) / steps;
    const speed = Math.hypot(-mx * Math.sin(t) + nx * Math.cos(t), -my * Math.sin(t) + ny * Math.cos(t));
    sum += speed * (index === 0 || index === steps ? 1 : index % 2 === 1 ? 4 : 2);
  }
  return { points, length: (sum * sweep) / steps / 3, area: closed ? Math.PI * (mx * ny - my * nx) : 0, closed };
}

/** Samples kept per knot span; the length is taken on four times as many. */
const SPLINE_SAMPLES = 24;
const SPLINE_LENGTH_FACTOR = 4;
/** No drawing goes past it, and each sample costs the square of the degree. */
const SPLINE_MAX_DEGREE = 25;

const splineFits = (degree: number, knotCount: number, controlCount: number) =>
  Number.isInteger(degree) && degree >= 1 && degree <= SPLINE_MAX_DEGREE && controlCount > degree && knotCount === controlCount + degree + 1;

/** Most points `splineOutline` gives for a curve of these sizes; 0 when it gives none. */
export function splinePointBound(degree: number, knotCount: number, controlCount: number): number {
  return splineFits(degree, knotCount, controlCount) ? (controlCount - degree) * SPLINE_SAMPLES + 1 : 0;
}

/**
 * NURBS curve by de Boor's algorithm in homogeneous coordinates. `control` holds
 * x, y pairs. Null when the knots do not fit the control points, or when the
 * degree is not one a drawing has.
 */
export function splineOutline(degree: number, knots: number[], control: number[], weights: number[]): { points: number[]; length: number } | null {
  const count = control.length / 2;
  if (!splineFits(degree, knots.length, count)) return null;
  const wx = new Float64Array(degree + 1), wy = new Float64Array(degree + 1), ww = new Float64Array(degree + 1);
  const evaluate = (span: number, u: number): [number, number] => {
    for (let index = 0; index <= degree; index += 1) {
      const at = span - degree + index, weight = weights.length === count ? weights[at] : 1;
      wx[index] = control[2 * at] * weight; wy[index] = control[2 * at + 1] * weight; ww[index] = weight;
    }
    for (let level = 1; level <= degree; level += 1) {
      for (let index = degree; index >= level; index -= 1) {
        const at = span - degree + index;
        const span0 = knots[at + degree - level + 1] - knots[at];
        const alpha = span0 === 0 ? 0 : (u - knots[at]) / span0;
        wx[index] = (1 - alpha) * wx[index - 1] + alpha * wx[index];
        wy[index] = (1 - alpha) * wy[index - 1] + alpha * wy[index];
        ww[index] = (1 - alpha) * ww[index - 1] + alpha * ww[index];
      }
    }
    const weight = ww[degree] === 0 ? 1 : ww[degree];
    return [wx[degree] / weight, wy[degree] / weight];
  };
  const points: number[] = [];
  let length = 0, px = 0, py = 0, started = false;
  const fine = SPLINE_SAMPLES * SPLINE_LENGTH_FACTOR;
  for (let span = degree; span < count; span += 1) {
    const from = knots[span], to = knots[span + 1];
    if (!(to > from)) continue;
    for (let index = started ? 1 : 0; index <= fine; index += 1) {
      const [x, y] = evaluate(span, index === fine ? to : from + ((to - from) * index) / fine);
      if (started) length += Math.hypot(x - px, y - py);
      if (index % SPLINE_LENGTH_FACTOR === 0) points.push(x, y);
      px = x; py = y; started = true;
    }
  }
  return points.length >= 4 ? { points, length } : null;
}
