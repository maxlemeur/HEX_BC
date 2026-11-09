// Boundary loops of a HATCH. A loop is either a polyline with bulges or a chain
// of edges (lines, arcs, elliptic arcs, splines); both end up as one polyline
// with bulges, so their length and area come from the same exact routine.

import { num, type DxfRecords } from "./dxf-records";
import { bulgedOutline, bulgedPointCount, pointInRing, positiveSweep, radians, splineOutline, splinePointBound, type Outline } from "./geometry";

export type HatchLoop = { points: number[]; length: number; /** Negative for a hole. */ area: number };

/** An edge as x, y, bulge triples from its start to its end (the last bulge is unused). */
type Edge = number[];

function arcEdge(cx: number, cy: number, radius: number, begin: number, end: number, ccw: boolean): Edge {
  const start = begin % 360, turn = positiveSweep(start, end, 360);
  // A clockwise arc stores its angles mirrored about the x axis.
  const from = radians(ccw ? start : -start), sweep = radians(ccw ? turn : -turn);
  const parts = turn > 180 ? 2 : 1;
  const bulge = Math.tan(sweep / parts / 4);
  const edge: Edge = [];
  for (let part = 0; part <= parts; part += 1) {
    const angle = from + (sweep * part) / parts;
    edge.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), part < parts ? bulge : 0);
  }
  return edge;
}

function ellipseEdge(cx: number, cy: number, mx: number, my: number, ratio: number, begin: number, end: number, ccw: boolean): Edge {
  const start = begin % 360, turn = positiveSweep(start, end, 360);
  const from = radians(ccw ? start : -start), sweep = radians(ccw ? turn : -turn);
  const segments = Math.max(2, Math.ceil((turn / 360) * 72));
  const edge: Edge = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = from + (sweep * index) / segments;
    edge.push(cx + mx * Math.cos(t) - ratio * my * Math.sin(t), cy + my * Math.cos(t) + ratio * mx * Math.sin(t), 0);
  }
  return edge;
}

function straight(points: number[]): Edge {
  const edge: Edge = [];
  for (let index = 0; index + 1 < points.length; index += 2) edge.push(points[index], points[index + 1], 0);
  return edge;
}

function reversed(edge: Edge): Edge {
  const count = edge.length / 3, out: Edge = [];
  for (let index = count - 1; index >= 0; index -= 1) out.push(edge[3 * index], edge[3 * index + 1], index > 0 ? -edge[3 * index - 1] : 0);
  return out;
}

const gap = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const startGap = (edge: Edge, x: number, y: number) => gap(edge[0], edge[1], x, y);
const endGap = (edge: Edge, x: number, y: number) => gap(edge[edge.length - 3], edge[edge.length - 2], x, y);

/** Edges put end to start, turned round when drawn the other way. */
function chainEdges(edges: Edge[]): number[] {
  if (edges.length === 0) return [];
  if (edges.length > 1) {
    const [first, second] = edges;
    const fromEnd = Math.min(startGap(second, first[first.length - 3], first[first.length - 2]), endGap(second, first[first.length - 3], first[first.length - 2]));
    const fromStart = Math.min(startGap(second, first[0], first[1]), endGap(second, first[0], first[1]));
    if (fromStart < fromEnd) edges[0] = reversed(first);
  }
  const vertices: number[] = [];
  let x = 0, y = 0;
  edges.forEach((candidate, index) => {
    const edge = index > 0 && endGap(candidate, x, y) < startGap(candidate, x, y) ? reversed(candidate) : candidate;
    for (let at = 0; at < edge.length - 3; at += 1) vertices.push(edge[at]);
    x = edge[edge.length - 3];
    y = edge[edge.length - 2];
  });
  return vertices;
}

/** Null when the loops would hold more than `room` points: none of them is drawn then. */
export function readHatchLoops(record: DxfRecords, room = Infinity): { solid: boolean; loops: HatchLoop[] } | null {
  const { codes, values, count } = record;
  let at = 0, solid = false;
  // Codes 10 and 20 also sit before the loops (elevation) and after them (seeds): the loops are read in sequence from 91.
  while (at < count && codes[at] !== 91) { if (codes[at] === 70) solid = num(values[at]) === 1; at += 1; }
  const total = at < count ? num(values[at]) : 0;
  at += 1;
  const take = (code: number, fallback = 0): number => (at < count && codes[at] === code ? num(values[at++]) : fallback);

  let held = 0;
  const over = (points: number) => held + points > room;

  /** Null when the edge alone would not fit. */
  const readEdge = (): Edge | null => {
    const type = take(72);
    if (type === 1) { const x1 = take(10), y1 = take(20), x2 = take(11), y2 = take(21); return [x1, y1, 0, x2, y2, 0]; }
    if (type === 2) { const cx = take(10), cy = take(20), radius = take(40), start = take(50), end = take(51); return arcEdge(cx, cy, radius, start, end, take(73, 1) !== 0); }
    if (type === 3) {
      const cx = take(10), cy = take(20), mx = take(11), my = take(21), ratio = take(40), start = take(50), end = take(51);
      return ellipseEdge(cx, cy, mx, my, ratio, start, end, take(73, 1) !== 0);
    }
    if (type !== 4) return [];
    const degree = take(94);
    take(73); take(74);
    const knotCount = take(95), controlCount = take(96);
    const knots: number[] = [], control: number[] = [], weights: number[] = [], fit: number[] = [];
    for (let index = 0; index < knotCount && codes[at] === 40; index += 1) knots.push(take(40));
    for (let index = 0; index < controlCount && codes[at] === 10; index += 1) {
      control.push(take(10), take(20));
      if (codes[at] === 42) weights.push(take(42));
    }
    // The fit count (since AutoCAD 2010) shares code 97 with the count of source objects that closes the loop.
    if (codes[at] === 97 && [11, 12, 13, 72, 97].includes(codes[at + 1])) {
      const fitCount = take(97);
      for (let index = 0; index < fitCount && codes[at] === 11; index += 1) fit.push(take(11), take(21));
    }
    while (at < count && [12, 22, 13, 23].includes(codes[at])) at += 1;
    if (over(splinePointBound(degree, knots.length, control.length / 2))) return null;
    return straight(splineOutline(degree, knots, control, weights)?.points ?? (fit.length >= 4 ? fit : control));
  };

  const outlines: Outline[] = [];
  for (let loop = 0; loop < total; loop += 1) {
    while (at < count && codes[at] !== 92) at += 1;
    if (at >= count) break;
    const flag = take(92);
    let vertices: number[] = [];
    if (flag & 2) {
      take(72); take(73);
      const vertexCount = take(93);
      for (let index = 0; index < vertexCount && codes[at] === 10; index += 1) vertices.push(take(10), take(20), take(42));
    } else {
      const edgeCount = take(93), edges: Edge[] = [];
      let chained = 0;
      for (let index = 0; index < edgeCount && codes[at] === 72; index += 1) {
        const edge = readEdge();
        if (edge === null) return null;
        chained += edge.length / 3;
        if (over(chained)) return null;
        if (edge.length >= 6) edges.push(edge);
      }
      vertices = chainEdges(edges);
    }
    if (vertices.length < 6) continue;
    const size = bulgedPointCount(vertices, true);
    if (over(size)) return null;
    held += size;
    outlines.push(bulgedOutline(vertices, true));
  }

  // Even-odd fill: a loop inside an odd number of others is a hole.
  const boxes = outlines.map(({ points }) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let index = 0; index < points.length; index += 2) {
      x0 = Math.min(x0, points[index]); x1 = Math.max(x1, points[index]);
      y0 = Math.min(y0, points[index + 1]); y1 = Math.max(y1, points[index + 1]);
    }
    return [x0, y0, x1, y1];
  });
  const loops = outlines.map((outline, index) => {
    const x = outline.points[0], y = outline.points[1];
    let depth = 0;
    for (let other = 0; other < outlines.length; other += 1) {
      const box = boxes[other];
      if (other !== index && x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && pointInRing(outlines[other].points, x, y)) depth += 1;
    }
    return { points: outline.points, length: outline.length, area: (depth % 2 === 1 ? -1 : 1) * Math.abs(outline.area) };
  });
  return { solid, loops };
}
