// Local bench only. Match selected subpaths as a set within a larger drawing.
// Shape identity ignores paint order, stroke style, surrounding clutter and text.
import { isNearWhite } from "../../vectors/colors";
import type { VectorPageExtraction } from "../../vectors/extraction";
import type { Box } from "../../vectors/geometry";

const EPS = 0.08; // Sheet points. The extractor rounds vertices to hundredths of a point.
const CELL = 12;
type Pose = { a: number; b: number; parity: number; x: number; y: number };
type Pin = { x: number; y: number; scale: number; angle: number; mirrored: boolean };

function mapX(t: Pose, x: number, y: number) {
  return t.x + t.a * x - t.parity * t.b * y;
}
function mapY(t: Pose, x: number, y: number) {
  return t.y + t.b * x + t.parity * t.a * y;
}

export function indexSymbolPage(page: VectorPageExtraction) {
  const { paths, points } = page;
  const visible = page.groups.map(
    (g) => !isNearWhite(g.color) && !page.layers.some((l) => l.id === g.layer && !l.visible),
  );
  const bounds = new Float64Array(paths.length * 4);
  const centers = new Float64Array(paths.length * 2);
  const vertices = new Uint32Array(paths.length);
  const buckets = new Map<string, number[]>();
  // A vertex centroid transforms with the drawing, even at non-orthogonal angles.
  const bucket = (count: number, x: number, y: number) => count + "/" + x + "/" + y;
  paths.forEach((p, id) => {
    if (!visible[p.group]) return;
    const last = p.start + p.count - 1;
    const repeated =
      p.closed && points[2 * p.start] === points[2 * last] && points[2 * p.start + 1] === points[2 * last + 1];
    const n = p.count - Number(repeated);
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity,
      cx = 0,
      cy = 0;
    for (let i = p.start; i < p.start + n; i++) {
      const x = points[2 * i],
        y = points[2 * i + 1];
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      cx += x;
      cy += y;
    }
    bounds.set([left, top, right, bottom], 4 * id);
    cx /= n;
    cy /= n;
    centers.set([cx, cy], 2 * id);
    vertices[id] = n;
    const key = bucket(n, Math.floor(cx / CELL), Math.floor(cy / CELL));
    const list = buckets.get(key);
    if (list) list.push(id);
    else buckets.set(key, [id]);
  });

  function inside(box: Box) {
    const ids: number[] = [];
    paths.forEach((_, id) => {
      const k = 4 * id;
      if (
        vertices[id] &&
        bounds[k] >= box.x0 &&
        bounds[k + 1] >= box.y0 &&
        bounds[k + 2] <= box.x1 &&
        bounds[k + 3] <= box.y1
      )
        ids.push(id);
    });
    return ids;
  }

  function match(seed: number[]): Pin[] {
    if (
      !seed.length ||
      seed.length > 256 ||
      new Set(seed).size !== seed.length ||
      seed.some((i) => !vertices[i])
    ) {
      throw new Error("Select 1 to 256 distinct visible subpaths");
    }
    const span = (i: number) =>
      Math.hypot(bounds[4 * i + 2] - bounds[4 * i], bounds[4 * i + 3] - bounds[4 * i + 1]);
    // A long baseline stabilizes the fit. Among similar extents prefer complex paths.
    const maxSpan = Math.max(...seed.map(span));
    const anchor = [...seed]
      .filter((i) => span(i) >= maxSpan / 2)
      .sort((a, b) => vertices[b] - vertices[a] || span(b) - span(a))[0];
    const ref = paths[anchor].start,
      x0 = points[2 * ref],
      y0 = points[2 * ref + 1];
    const shapes = [anchor, ...seed.filter((i) => i !== anchor)].map((id) => ({
      closed: paths[id].closed,
      n: vertices[id],
      cx: centers[2 * id] - x0,
      cy: centers[2 * id + 1] - y0,
      xy: Array.from(
        points.subarray(2 * paths[id].start, 2 * (paths[id].start + vertices[id])),
        (v, k) => v - (k % 2 ? y0 : x0),
      ),
    }));
    const first = shapes[0];
    let far = 0;
    for (let i = 1; i < first.n; i++)
      if (Math.hypot(first.xy[2 * i], first.xy[2 * i + 1]) > Math.hypot(first.xy[2 * far], first.xy[2 * far + 1]))
        far = i;
    const ux = first.xy[2 * far],
      uy = first.xy[2 * far + 1],
      norm = ux * ux + uy * uy;
    if (norm <= EPS * EPS) throw new Error("Anchor too small to determine orientation");
    const px =
      (Math.min(...seed.map((i) => bounds[4 * i])) + Math.max(...seed.map((i) => bounds[4 * i + 2]))) / 2 - x0;
    const py =
      (Math.min(...seed.map((i) => bounds[4 * i + 1])) + Math.max(...seed.map((i) => bounds[4 * i + 3]))) / 2 - y0;
    const pins: Pin[] = [];
    // Return each subpath in either traversal direction. Closed rings may
    // begin at any vertex. Preserve every interior vertex and closedness.
    function vertex(id: number, start: number, step: number, j: number) {
      return 2 * (paths[id].start + ((vertices[id] + start + step * j) % vertices[id]));
    }
    function aligned(k: number, id: number, t: Pose, start: number, step: number) {
      const shape = shapes[k];
      for (let j = 0; j < shape.n; j++) {
        const v = vertex(id, start, step, j),
          x = shape.xy[2 * j],
          y = shape.xy[2 * j + 1];
        if (Math.abs(points[v] - mapX(t, x, y)) > EPS || Math.abs(points[v + 1] - mapY(t, x, y)) > EPS)
          return false;
      }
      return true;
    }
    function fits(k: number, id: number, t: Pose) {
      const s = shapes[k];
      if (s.closed !== paths[id].closed) return false;
      for (let j = 0; j < (s.closed ? s.n : 1); j++) {
        if (aligned(k, id, t, j, 1) || aligned(k, id, t, s.n - 1 - j, -1)) return true;
      }
      return false;
    }
    // Assign one distinct printed path to each part, including coincident parts.
    function containsRest(anchorId: number, t: Pose) {
      const assigned = new Map<number, number>();
      function assign(k: number, seen: Set<number>): boolean {
        const s = shapes[k],
          cx = mapX(t, s.cx, s.cy),
          cy = mapY(t, s.cx, s.cy);
        for (let bx = Math.floor((cx - EPS) / CELL); bx <= Math.floor((cx + EPS) / CELL); bx++) {
          for (let by = Math.floor((cy - EPS) / CELL); by <= Math.floor((cy + EPS) / CELL); by++) {
            for (const id of buckets.get(bucket(s.n, bx, by)) ?? []) {
              if (
                id === anchorId ||
                seen.has(id) ||
                Math.abs(centers[2 * id] - cx) > EPS ||
                Math.abs(centers[2 * id + 1] - cy) > EPS ||
                !fits(k, id, t)
              )
                continue;
              seen.add(id);
              const previous = assigned.get(id);
              if (previous === undefined || assign(previous, seen)) {
                assigned.set(id, k);
                return true;
              }
            }
          }
        }
        return false;
      }
      return shapes.every((_, k) => k === 0 || assign(k, new Set()));
    }
    paths.forEach((p, id) => {
      if (vertices[id] !== first.n || p.closed !== first.closed) return;
      for (let j = 0; j < (first.closed ? first.n : 1); j++)
        for (const step of [1, -1]) {
          const start = step === 1 ? j : first.n - 1 - j;
          const base = vertex(id, start, step, 0),
            end = vertex(id, start, step, far);
          const dx = points[end] - points[base],
            dy = points[end + 1] - points[base + 1];
          const scale = Math.sqrt((dx * dx + dy * dy) / norm);
          if (scale < 0.25 - 1e-6 || scale > 4 + 1e-6) continue;
          for (const parity of [1, -1]) {
            const a = (ux * dx + parity * uy * dy) / norm,
              b = (ux * dy - parity * uy * dx) / norm;
            const t = { a, b, parity, x: points[base], y: points[base + 1] };
            if (!aligned(0, id, t, start, step) || !containsRest(id, t)) continue;
            const x = mapX(t, px, py),
              y = mapY(t, px, py);
            if (!pins.some((pin) => Math.abs(pin.x - x) <= EPS && Math.abs(pin.y - y) <= EPS))
              pins.push({ x, y, scale, angle: Math.atan2(b, a), mirrored: parity < 0 });
          }
        }
    });
    return pins;
  }
  return { inside, match };
}
