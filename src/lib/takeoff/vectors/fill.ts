import { isClassified, type GroupClass } from "@/lib/takeoff/vectors/classify";
import { isNearWhite } from "@/lib/takeoff/vectors/colors";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { MM_PER_POINT, type Point, type Segment } from "@/lib/takeoff/vectors/geometry";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import { isOpeningLayerName } from "@/lib/takeoff/vectors/vocabulary";

// Room floors filled between walls (TI-662 L3c), for the rooms no ring
// bounds (surfaces.ts keeps the ring first). Many plans draw walls as separate
// strokes: no closed path goes around a room, but its walls do.
// - Barriers: the strokes of groups classified « mur » or « cloison » (any
//   source the reading accepts: isClassified), and of joinery or opening
//   layers (vocabulary.ts isOpeningLayerName: their doors and windows close
//   the walls' gaps). Never a hidden layer nor a near-white stroke. A page
//   without wall or partition group is not filled.
// - Door symbols: an arc of DOOR_ARC sweep and radius on site, its points
//   equidistant from a centre (the hinge), alone around that centre (copies
//   of one arc stroked twice are one arc: same ends and same point halfway,
//   the two halves of a circle are two arcs), with a stroke ending at the hinge
//   (the leaf, a jamb: within DOOR_HINGE of it), is the door's swing: it is no
//   barrier, its two radii are (the leaf, and the opening line from the hinge
//   along the wall to the arc's far end). The swing quarter-disc thus stays in
//   the room the door opens into. A door drawn as one subpath (hinge, leaf
//   tip, arc, far end: a polyline export) is read so too. An arc with nothing
//   at its centre (a rounded wall corner) stays a barrier. A circle
//   (ISLAND_CIRCLE: pieces around one centre making a full turn, small on
//   site) is a column, a fixture or a turning circle: no barrier.
// - Raster: cells of FILL_CELL_M on site from the page origin (fillCellPt),
//   larger when the page would pass FILL_MAX_CELLS; beyond FILL_MAX_CELL_M a
//   page is not filled (« resolution »). Strokes mark the cells they cross.
// - Each room floods 4-connected from its printed area's centre, or the
//   nearest free cell within FILL_SEED_REACH_HEIGHTS text heights (« seed »
//   when none). Rejected, reported and never measured: a fill reaching the
//   raster's edge (outside the walls: « border »), holding another room's
//   printed area (« rooms »: one room per outline), past FILL_SANITY_RATIO
//   times its printed surface or under its inverse (« ratio »: the printed
//   surface is a control, never the quantity), or spanning FILL_FRAME_SHARE of
//   the sheet (along its frame: « frame »).
// - Closed shapes inside the floor (furniture, fixtures drawn on a wall
//   layer) up to FILL_HOLE_MAX_M2 each are floor; a larger one (a shaft, a
//   core) or one holding a room's printed area is not. So are the closed
//   pockets behind the joinery bordering the floor (a window's swing drawn
//   into the room), up to FILL_HOLE_MAX_M2 each, each taken whole: a pocket
//   any part of which reaches a printed area, the raster's edge or that limit
//   is none (never what is left of the next room behind a glazed partition).
//   A pocket the joinery of two rooms borders (a niche between them), or one
//   on another room's floor, is in neither.
// - Area: the cells, plus half a cell along every edge between the floor and
//   a stroke (a stroke crosses its cells anywhere: on average half a cell of
//   floor lies beyond the cells reached).
// - Outline: the outer boundary of the floor and its pockets (joined to it
//   through the joinery cells between them), moved half a cell out onto the
//   strokes as the area counts them, in page space: it encloses the measured
//   area (a core left out of the floor stays inside it, the outline has no
//   hole). Simplified to at most FILL_OUTLINE_MAX_POINTS points (the persisted
//   polygon limit), its group FILL_GROUP_ID.

/** Side of a raster cell on site: a room's floor is counted within a fraction of the surface tolerance (max(2 %, 0.5 m²)). */
export const FILL_CELL_M = 0.035;
/** Most cells of a page raster (an A0 sheet at 1 pt): beyond, the cells grow. */
export const FILL_MAX_CELLS = 8_400_000;
/** Largest cell on site a page is filled with. */
export const FILL_MAX_CELL_M = 0.1;
/** A fill over this many times its printed surface, or under its inverse, is not the room's floor. */
export const FILL_SANITY_RATIO = 1.5;
/** Largest closed shape inside a floor counted as floor (furniture, fixtures). */
export const FILL_HOLE_MAX_M2 = 4;
/** A printed area on a stroke starts its fill from the nearest free cell within this many text heights. */
export const FILL_SEED_REACH_HEIGHTS = 2;
/** A fill spanning this share of the sheet's width or height runs along its frame. */
export const FILL_FRAME_SHARE = 0.9;
/** Most points of a fill outline (VECTOR_GEOMETRY_LIMITS.polygon of persistence.ts). */
export const FILL_OUTLINE_MAX_POINTS = 2000;
/** Group id of a fill outline (no group of the page draws it). */
export const FILL_GROUP_ID = "fill:mur";
/**
 * A door swing: an arc of this sweep and radius on site, of at least minPoints points (three chords: a bent wall of two
 * strokes is no arc) and chords of at most maxChordDeg (a flattened curve or a polyline).
 */
export const DOOR_ARC = { minSweepDeg: 60, maxSweepDeg: 120, minRadiusM: 0.5, maxRadiusM: 1.6, maxChordDeg: 46, minPoints: 4 } as const;
/** A stroke ends at a door's hinge within this many points, or this share of the swing's radius when larger. */
export const DOOR_HINGE = { minPt: 1, radiusShare: 0.05 } as const;
/** A circle (arcs around one centre turning at least minSweepDeg) of at most maxRadiusM on site bounds no room. */
export const ISLAND_CIRCLE = { minSweepDeg: 300, maxRadiusM: 1 } as const;

export type FillRejection = "seed" | "border" | "rooms" | "ratio" | "frame" | "resolution";
/** A printed room: its area's centre, printed surface, text height, and whether it needs a fill (no ring). */
export type FillRoom = { anchor: Point; printed_m2: number; height: number; fill: boolean };
export type FillResult = { area_m2: number; outline: number[] } | { rejected: FillRejection };

/** Side of the raster cells of a page, in points: FILL_CELL_M on site, larger when the page would pass FILL_MAX_CELLS. */
export function fillCellPt(denominator: number, width: number, height: number) {
  const site = (FILL_CELL_M * 1000) / (MM_PER_POINT * denominator);
  return Math.max(site, Math.sqrt((width * height) / FILL_MAX_CELLS));
}

/** An arc; `mid`: its point halfway along; `leaf`: its subpath also draws a radius from its centre (a door drawn hinge, leaf, arc in one subpath). */
type Arc = { centre: Point; radius: number; sweep: number; points: number; ends: [Point, Point]; mid: Point; leaf: boolean };

/** An arc: at least 3 points within tolerance of one circle, turning one way by chords of at most DOOR_ARC.maxChordDeg. */
function arcOf(points: ArrayLike<number>, start: number, count: number): Arc | null {
  if (count < 3) return null;
  const at = (k: number) => ({ x: points[2 * (start + k)], y: points[2 * (start + k) + 1] });
  // Three points spread along the path (a full circle ends where it starts).
  const a = at(0), b = at(Math.floor(count / 3)), c = at(Math.max(Math.floor((2 * count) / 3), Math.floor(count / 3) + 1));
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const centre = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  const radius = Math.hypot(a.x - centre.x, a.y - centre.y);
  const tolerance = Math.max(0.02 * radius, 0.15);
  const maxChord = (DOOR_ARC.maxChordDeg * Math.PI) / 180;
  const first = Math.atan2(a.y - centre.y, a.x - centre.x);
  let sweep = 0, sign = 0, previous = first;
  for (let k = 1; k < count; k += 1) {
    const p = at(k);
    if (Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - radius) > tolerance) return null;
    const angle = Math.atan2(p.y - centre.y, p.x - centre.x);
    const delta = Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
    previous = angle;
    if (Math.abs(delta) < 1e-9) continue;
    if (Math.abs(delta) > maxChord || (sign !== 0 && Math.sign(delta) !== sign)) return null;
    sign = Math.sign(delta);
    sweep += delta;
  }
  const mid = { x: centre.x + radius * Math.cos(first + sweep / 2), y: centre.y + radius * Math.sin(first + sweep / 2) };
  return { centre, radius, sweep: (Math.abs(sweep) * 180) / Math.PI, points: count, ends: [a, at(count - 1)], mid, leaf: false };
}

const hingeTolerance = (arc: Pick<Arc, "radius">) => Math.max(DOOR_HINGE.minPt, DOOR_HINGE.radiusShare * arc.radius);

/**
 * The arc of a subpath: the whole path, or a door drawn in one subpath, its first or last point (or both) at the
 * centre of the arc the rest draws (the hinge, then the leaf to the arc).
 */
function arcOfPath(points: ArrayLike<number>, start: number, count: number): Arc | null {
  const whole = arcOf(points, start, count);
  if (whole) return whole;
  if (count < 5) return null;
  const at = (k: number) => ({ x: points[2 * (start + k)], y: points[2 * (start + k) + 1] });
  for (const [skipFirst, skipLast] of [[1, 0], [0, 1], [1, 1]] as const) {
    const arc = arcOf(points, start + skipFirst, count - skipFirst - skipLast);
    if (!arc) continue;
    const hinges = [...(skipFirst ? [at(0)] : []), ...(skipLast ? [at(count - 1)] : [])];
    if (hinges.every((hinge) => Math.hypot(hinge.x - arc.centre.x, hinge.y - arc.centre.y) <= hingeTolerance(arc))) return { ...arc, leaf: true };
  }
  return null;
}

/**
 * Whether two arcs are copies of one (same centre, radius, ends in either direction and point halfway within 1 pt): the
 * two halves of one circle share their centre, radius and ends, never their point halfway.
 */
function sameArc(left: Arc, right: Arc) {
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1;
  return near(left.centre, right.centre) && Math.abs(left.radius - right.radius) < 1 && near(left.mid, right.mid)
    && ((near(left.ends[0], right.ends[0]) && near(left.ends[1], right.ends[1])) || (near(left.ends[0], right.ends[1]) && near(left.ends[1], right.ends[0])));
}

/** Bucket side of the stroke points a door's hinge is looked up in. */
const HINGE_BUCKET_PT = 4;

// Cell values, by precedence when strokes cross (a wall over a door's opening line over joinery); seeds are free.
const FREE = 0, SEED = 1, JOINERY = 2, DOOR = 3, WALL = 4;

/** Barrier strokes of a page: walls, partitions and joinery, door swings replaced by their radii, small circles left out. */
function barrierStrokes(extraction: VectorPageExtraction, model: PageModel, classes: readonly GroupClass[], metresPerPoint: number) {
  const role = model.groups.map((group, index) => {
    if (group.hidden) return FREE;
    const entry = classes[index];
    if (isClassified(entry) && (entry.class === "mur" || entry.class === "cloison")) return WALL;
    // An opening layer stays joinery whatever Decisions proposes for it (short of a wall, above); a keyword, document or
    // user class decides otherwise.
    const undecided = entry.class === null || entry.source === "decisions";
    return undecided && group.layerName !== null && isOpeningLayerName(group.layerName) ? JOINERY : FREE;
  });
  const walls = role.includes(WALL);
  const { points, paths } = extraction;
  const value = paths.map((path) => (isNearWhite(extraction.groups[path.group].color) ? FREE : role[model.groupOf[path.group]]));
  const kept = value.map((entry) => entry !== FREE);
  // Arcs, bucketed by rounded centre and radius to find the pieces of one circle.
  const arcs = new Map<number, Arc>();
  const buckets = new Map<string, number[]>();
  const keyOf = (x: number, y: number, r: number) => `${x}|${y}|${r}`;
  paths.forEach((path, id) => {
    if (!kept[id] || path.count < 3) return;
    const arc = arcOfPath(points, path.start, path.count);
    if (!arc || arc.radius * metresPerPoint > DOOR_ARC.maxRadiusM) return;
    arcs.set(id, arc);
    const key = keyOf(Math.round(arc.centre.x), Math.round(arc.centre.y), Math.round(arc.radius));
    buckets.set(key, [...(buckets.get(key) ?? []), id]);
  });
  // The points of the barrier strokes, bucketed by HINGE_BUCKET_PT, where a door's hinge looks for a stroke ending at it.
  let ends: Map<string, Point[]> | null = null;
  const endsNear = (centre: Point, tolerance: number) => {
    if (ends === null) {
      const built = new Map<string, Point[]>();
      paths.forEach((path, id) => {
        if (value[id] === FREE) return;
        for (let k = path.start; k < path.start + path.count; k += 1) {
          const key = `${Math.floor(points[2 * k] / HINGE_BUCKET_PT)}|${Math.floor(points[2 * k + 1] / HINGE_BUCKET_PT)}`;
          const list = built.get(key);
          if (list) list.push({ x: points[2 * k], y: points[2 * k + 1] });
          else built.set(key, [{ x: points[2 * k], y: points[2 * k + 1] }]);
        }
      });
      ends = built;
    }
    const reach = Math.ceil(tolerance / HINGE_BUCKET_PT);
    const [bx, by] = [Math.floor(centre.x / HINGE_BUCKET_PT), Math.floor(centre.y / HINGE_BUCKET_PT)];
    for (let dx = -reach; dx <= reach; dx += 1) for (let dy = -reach; dy <= reach; dy += 1) {
      if ((ends.get(`${bx + dx}|${by + dy}`) ?? []).some((point) => Math.hypot(point.x - centre.x, point.y - centre.y) <= tolerance)) return true;
    }
    return false;
  };
  const doors: Arc[] = [];
  for (const [id, arc] of arcs) {
    const [cx, cy, cr] = [Math.round(arc.centre.x), Math.round(arc.centre.y), Math.round(arc.radius)];
    // The arcs around this centre, copies of one arc (stroked twice) counted once.
    const twins: Arc[] = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dr = -1; dr <= 1; dr += 1) {
      for (const other of buckets.get(keyOf(cx + dx, cy + dy, cr + dr)) ?? []) {
        const twin = arcs.get(other) as Arc;
        if (Math.hypot(twin.centre.x - arc.centre.x, twin.centre.y - arc.centre.y) >= 1 || Math.abs(twin.radius - arc.radius) >= 1) continue;
        if (!twins.some((known) => sameArc(known, twin))) twins.push(twin);
      }
    }
    const radius = arc.radius * metresPerPoint;
    if (twins.reduce((sum, twin) => sum + twin.sweep, 0) >= ISLAND_CIRCLE.minSweepDeg && radius <= ISLAND_CIRCLE.maxRadiusM) {
      kept[id] = false;
      continue;
    }
    if (twins.length === 1 && arc.points >= DOOR_ARC.minPoints && arc.sweep >= DOOR_ARC.minSweepDeg && arc.sweep <= DOOR_ARC.maxSweepDeg && radius >= DOOR_ARC.minRadiusM
      && (arc.leaf || endsNear(arc.centre, hingeTolerance(arc)))) {
      kept[id] = false;
      // A copy of a door already read adds no stroke.
      if (!doors.some((door) => sameArc(door, arc))) doors.push(arc);
    }
  }
  const strokes: Array<{ segment: Segment; value: number }> = [];
  paths.forEach((path, id) => {
    if (!kept[id]) return;
    for (let k = path.start + 1; k < path.start + path.count; k += 1) {
      strokes.push({ segment: { x0: points[2 * k - 2], y0: points[2 * k - 1], x1: points[2 * k], y1: points[2 * k + 1] }, value: value[id] });
    }
  });
  for (const door of doors) {
    for (const end of door.ends) strokes.push({ segment: { x0: door.centre.x, y0: door.centre.y, x1: end.x, y1: end.y }, value: DOOR });
  }
  return { strokes, walls };
}

class Raster {
  readonly cols: number;
  readonly rows: number;
  readonly grid: Uint8Array;
  private readonly mark: Uint16Array;
  private stamp = 0;

  constructor(readonly x0: number, readonly y0: number, cols: number, rows: number, readonly cell: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = new Uint8Array(cols * rows);
    this.mark = new Uint16Array(cols * rows);
  }

  cellOf(point: Point) {
    const cx = Math.floor((point.x - this.x0) / this.cell), cy = Math.floor((point.y - this.y0) / this.cell);
    return cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows ? -1 : cy * this.cols + cx;
  }

  /** Marks every cell the segment crosses (sampled every half cell: 8-connected, so no 4-connected fill passes). */
  draw(segment: Segment, value: number) {
    const steps = Math.max(1, Math.ceil((2 * Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0)) / this.cell));
    for (let step = 0; step <= steps; step += 1) {
      const index = this.cellOf({ x: segment.x0 + ((segment.x1 - segment.x0) * step) / steps, y: segment.y0 + ((segment.y1 - segment.y0) * step) / steps });
      if (index >= 0 && value > this.grid[index]) this.grid[index] = value;
    }
  }

  /** The first of `count` fresh visit stamps (the marks are reset when the stamps run out). */
  nextStamp(count = 1) {
    if (this.stamp + count > 65_535) {
      this.mark.fill(0);
      this.stamp = 0;
    }
    this.stamp += count;
    return this.stamp - count + 1;
  }

  /** The nearest free cell to a cell within reach cells (the cell itself when free), or −1. */
  nearestFree(point: Point, reachPt: number) {
    const from = this.cellOf(point);
    if (from < 0) return -1;
    if (this.grid[from] <= SEED) return from;
    // The free cell whose centre is nearest the point itself: a label leaning into a room starts in that room.
    const reach = Math.ceil(reachPt / this.cell);
    const fx = from % this.cols, fy = (from - fx) / this.cols;
    let best = -1, bestDistance = reachPt * reachPt;
    for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) {
      const x = fx + dx, y = fy + dy;
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || this.grid[y * this.cols + x] > SEED) continue;
      const distance = (this.x0 + (x + 0.5) * this.cell - point.x) ** 2 + (this.y0 + (y + 0.5) * this.cell - point.y) ** 2;
      if (distance <= bestDistance) {
        best = y * this.cols + x;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * 4-connected flood from seed over free cells: stops at the raster's edge, at another seed, past limit cells, or at a
   * cell marked `poison` (« rooms »: a pocket rejected before). Cells marked with `stamp` (a flood before, of the same
   * room) are not entered again; every cell marked is in `cells`; `joinery` lists the joinery cells next to them.
   */
  flood(seed: number, limit: number, stamp = this.nextStamp(), poison = -1): { status: "ok" | "border" | "rooms" | "ratio"; cells: Int32Array; joinery: number[] } {
    const { cols, rows, grid, mark } = this;
    let queue = new Int32Array(Math.min(limit + 1, 1 << 16));
    let size = 1;
    const joinery: number[] = [];
    queue[0] = seed;
    mark[seed] = stamp;
    const neighbours = [-1, 1, -cols, cols];
    for (let head = 0; head < size; head += 1) {
      const index = queue[head];
      const x = index % cols;
      if (x === 0 || x === cols - 1 || index < cols || index >= (rows - 1) * cols) return { status: "border", cells: queue.subarray(0, size), joinery };
      for (const offset of neighbours) {
        const next = index + offset;
        if (mark[next] === stamp) continue;
        if (mark[next] === poison) return { status: "rooms", cells: queue.subarray(0, size), joinery };
        const value = grid[next];
        if (value > SEED) {
          if (value === JOINERY) joinery.push(next);
          continue;
        }
        if (value === SEED) return { status: "rooms", cells: queue.subarray(0, size), joinery };
        if (size >= limit) return { status: "ratio", cells: queue.subarray(0, size), joinery };
        mark[next] = stamp;
        if (size === queue.length) {
          const grown = new Int32Array(Math.min(limit + 1, 2 * queue.length));
          grown.set(queue);
          queue = grown;
        }
        queue[size++] = next;
      }
    }
    return { status: "ok", cells: queue.subarray(0, size), joinery };
  }

  /**
   * The closed pockets behind the joinery next to a floor flooded with `stamp` (a window's or a door's swing drawn into
   * the room), each of at most `limit` cells and holding no printed area: floor of that room. A pocket rejected is
   * rejected whole: its cells are marked `poison`, and a flood from another joinery cell that meets them is rejected too
   * (never what is left of the next room once its printed area was met).
   */
  pockets(floor: { cells: Int32Array; joinery: number[] }, limit: number, stamp: number, poison: number) {
    const found: Int32Array[] = [];
    for (const cell of floor.joinery) {
      for (const offset of [-1, 1, -this.cols, this.cols]) {
        const next = cell + offset;
        if (this.mark[next] === stamp || this.mark[next] === poison || this.grid[next] !== FREE) continue;
        const pocket = this.flood(next, limit, stamp, poison);
        if (pocket.status === "ok") found.push(pocket.cells);
        else for (const index of pocket.cells) this.mark[index] = poison;
      }
    }
    return found;
  }
}

/** Cells of a window of the raster: 1 floor, 2 outside, 0 other (strokes, closed shapes inside the floor). */
type Window = { x0: number; y0: number; w: number; h: number; mask: Uint8Array };

function windowOf(raster: Raster, cells: Int32Array): Window {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const index of cells) {
    const x = index % raster.cols, y = (index - x) / raster.cols;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // One cell of margin: the floor never touches the window's edge.
  const window = { x0: minX - 1, y0: minY - 1, w: maxX - minX + 3, h: maxY - minY + 3, mask: new Uint8Array(0) };
  window.mask = new Uint8Array(window.w * window.h);
  for (const index of cells) {
    const x = index % raster.cols, y = (index - x) / raster.cols;
    window.mask[(y - window.y0) * window.w + (x - window.x0)] = 1;
  }
  return window;
}

/** Fills the closed shapes inside the floor up to holeMax cells each, none holding a printed area (a seed). */
function fillHoles(raster: Raster, window: Window, holeMax: number) {
  const { w, h, mask } = window;
  const stack = [0];
  mask[0] = 2;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % w, y = (index - x) / w;
    if (x > 0 && mask[index - 1] === 0) { mask[index - 1] = 2; stack.push(index - 1); }
    if (x < w - 1 && mask[index + 1] === 0) { mask[index + 1] = 2; stack.push(index + 1); }
    if (y > 0 && mask[index - w] === 0) { mask[index - w] = 2; stack.push(index - w); }
    if (y < h - 1 && mask[index + w] === 0) { mask[index + w] = 2; stack.push(index + w); }
  }
  for (let start = 0; start < w * h; start += 1) {
    if (mask[start] !== 0) continue;
    const component = [start];
    mask[start] = 3;
    let seeded = false;
    for (let head = 0; head < component.length; head += 1) {
      const index = component[head];
      const x = index % w, y = (index - x) / w;
      if (raster.grid[(y + window.y0) * raster.cols + (x + window.x0)] === SEED) seeded = true;
      for (const next of [index - 1, index + 1, index - w, index + w]) {
        if (mask[next] !== 0) continue;
        mask[next] = 3;
        component.push(next);
      }
    }
    if (seeded || component.length > holeMax) continue;
    for (const index of component) mask[index] = 1;
  }
}

/** Cells of the floor and edges between the floor and anything else. */
function floorCount(window: Window) {
  const { w, mask } = window;
  let cells = 0, edges = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1) continue;
    cells += 1;
    if (mask[index - 1] !== 1) edges += 1;
    if (mask[index + 1] !== 1) edges += 1;
    if (mask[index - w] !== 1) edges += 1;
    if (mask[index + w] !== 1) edges += 1;
  }
  return { cells, edges };
}

/** Douglas–Peucker on an open chain of x, y pairs (end points kept). */
function simplifyChain(chain: number[], epsilon: number): number[] {
  const count = chain.length / 2;
  if (count <= 2) return chain;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: Array<[number, number]> = [[0, count - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const [ax, ay, bx, by] = [chain[2 * first], chain[2 * first + 1], chain[2 * last], chain[2 * last + 1]];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let farthest = -1, distance = epsilon;
    for (let k = first + 1; k < last; k += 1) {
      const d = Math.abs((bx - ax) * (ay - chain[2 * k + 1]) - (ax - chain[2 * k]) * (by - ay)) / length;
      if (d > distance) {
        distance = d;
        farthest = k;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  const kept: number[] = [];
  for (let k = 0; k < count; k += 1) if (keep[k]) kept.push(chain[2 * k], chain[2 * k + 1]);
  return kept;
}

/**
 * The floor's outer boundary in page space, its cell corners moved half a cell out (onto the strokes, as the area
 * counts half a cell along them), simplified to at most FILL_OUTLINE_MAX_POINTS points, closed.
 */
function traceOutline(raster: Raster, window: Window): number[] {
  const { w, h, mask } = window;
  const stride = w + 1;
  // Boundary edges between corners, clockwise around the floor (y down); several out of a corner where the floor pinches.
  const out = new Map<number, number[]>();
  const add = (from: number, to: number) => {
    const list = out.get(from);
    if (list) list.push(to);
    else out.set(from, [to]);
  };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const index = y * w + x;
    if (mask[index] !== 1) continue;
    if (mask[index - w] !== 1) add(y * stride + x, y * stride + x + 1);
    if (mask[index + 1] !== 1) add(y * stride + x + 1, (y + 1) * stride + x + 1);
    if (mask[index + w] !== 1) add((y + 1) * stride + x + 1, (y + 1) * stride + x);
    if (mask[index - 1] !== 1) add((y + 1) * stride + x, y * stride + x);
  }
  let best: number[] = [], bestArea = 0;
  for (const [start, targets] of out) {
    while (targets.length > 0) {
      const loop = [start];
      let at = targets.pop() as number;
      while (at !== start) {
        loop.push(at);
        const next = out.get(at);
        if (!next || next.length === 0) break;
        at = next.pop() as number;
      }
      let twice = 0;
      for (let k = 0; k < loop.length; k += 1) {
        const [p, q] = [loop[k], loop[(k + 1) % loop.length]];
        twice += (p % stride) * Math.floor(q / stride) - (q % stride) * Math.floor(p / stride);
      }
      if (Math.abs(twice) > bestArea) {
        bestArea = Math.abs(twice);
        best = loop;
      }
    }
  }
  if (best.length < 3) return [];
  const { cell } = raster;
  const corners: number[] = [];
  for (let k = 0; k < best.length; k += 1) {
    const [previous, current, next] = [best[(k + best.length - 1) % best.length], best[k], best[(k + 1) % best.length]];
    // Corners only: a straight run of cell edges is one side.
    const dx0 = (current % stride) - (previous % stride), dy0 = Math.floor(current / stride) - Math.floor(previous / stride);
    const dx1 = (next % stride) - (current % stride), dy1 = Math.floor(next / stride) - Math.floor(current / stride);
    if (dx0 === dx1 && dy0 === dy1) continue;
    // Half a cell out: along the outward normals of both sides (the floor lies on the right of the boundary, y down).
    const ox = (dy0 + dy1) / 2, oy = -(dx0 + dx1) / 2;
    corners.push(raster.x0 + (window.x0 + (current % stride) + ox) * cell, raster.y0 + (window.y0 + Math.floor(current / stride) + oy) * cell);
  }
  // A ring split at its first point and the point farthest from it, each half simplified (the steps of a slanted wall become one side).
  let far = 0, farDistance = -1;
  for (let k = 1; k < corners.length / 2; k += 1) {
    const d = Math.hypot(corners[2 * k] - corners[0], corners[2 * k + 1] - corners[1]);
    if (d > farDistance) {
      farDistance = d;
      far = k;
    }
  }
  let simplified: number[] = [];
  for (let epsilon = cell; ; epsilon *= 2) {
    const first = simplifyChain(corners.slice(0, 2 * far + 2), epsilon);
    const second = simplifyChain([...corners.slice(2 * far), corners[0], corners[1]], epsilon);
    simplified = [...first, ...second.slice(2)];
    if (simplified.length / 2 <= FILL_OUTLINE_MAX_POINTS) break;
  }
  return simplified.map((value) => Math.round(value * 100) / 100);
}

/**
 * Fills the floors of the rooms marked `fill` between the page's walls; every room's printed area counts as another
 * room's (one room per outline). Null when the page has no wall or partition group (nothing is filled).
 */
export function fillRooms(input: {
  extraction: VectorPageExtraction;
  model: PageModel;
  classes: readonly GroupClass[];
  denominator: number;
  rooms: readonly FillRoom[];
}): Array<FillResult | null> | null {
  const { extraction, model, classes, denominator, rooms } = input;
  const metresPerPoint = (MM_PER_POINT * denominator) / 1000;
  const { strokes, walls } = barrierStrokes(extraction, model, classes, metresPerPoint);
  if (!walls || strokes.length === 0) return null;
  const pending = rooms.map((room) => room.fill);
  if (!pending.some(Boolean)) return rooms.map(() => null);
  const cell = fillCellPt(denominator, extraction.width, extraction.height);
  if (cell * metresPerPoint > FILL_MAX_CELL_M) return rooms.map((room) => (room.fill ? { rejected: "resolution" as const } : null));
  // The raster covers the strokes with two cells of margin, its cells counted from the page origin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { segment } of strokes) {
    minX = Math.min(minX, segment.x0, segment.x1);
    maxX = Math.max(maxX, segment.x0, segment.x1);
    minY = Math.min(minY, segment.y0, segment.y1);
    maxY = Math.max(maxY, segment.y0, segment.y1);
  }
  const [cx0, cy0] = [Math.floor(minX / cell) - 2, Math.floor(minY / cell) - 2];
  const raster = new Raster(cx0 * cell, cy0 * cell, Math.floor(maxX / cell) - cx0 + 3, Math.floor(maxY / cell) - cy0 + 3, cell);
  for (const { segment, value } of strokes) raster.draw(segment, value);
  const seeds = rooms.map((room) => raster.nearestFree(room.anchor, FILL_SEED_REACH_HEIGHTS * room.height));
  // Two printed areas on one cell are two rooms in one outline.
  const shared = new Set(seeds.filter((seed, index) => seed >= 0 && seeds.indexOf(seed) !== index));
  for (const seed of seeds) if (seed >= 0) raster.grid[seed] = SEED;
  const cellM2 = (cell * metresPerPoint) ** 2;
  const holeMax = Math.floor(FILL_HOLE_MAX_M2 / cellM2);
  // Every room's floor and the pockets behind its joinery first: a pocket two rooms find is in neither.
  type Flooded = { flood: ReturnType<Raster["flood"]>; pockets: Int32Array[] } | { rejected: FillRejection } | null;
  const floods = rooms.map((room, index): Flooded => {
    if (!room.fill) return null;
    const seed = seeds[index];
    if (seed < 0) return { rejected: "seed" };
    if (shared.has(seed)) return { rejected: "rooms" };
    const limit = Math.max(1, Math.ceil((FILL_SANITY_RATIO * room.printed_m2) / cellM2));
    // Two stamps: the floor and its pockets, the pockets rejected.
    const stamp = raster.nextStamp(2);
    const flood = raster.flood(seed, limit, stamp);
    if (flood.status !== "ok") return { rejected: flood.status };
    return { flood, pockets: raster.pockets(flood, holeMax, stamp, stamp + 1) };
  });
  // Every floor and pocket claims its cells: a pocket on another room's floor, or another room's pocket, is in neither.
  const claims = new Uint8Array(raster.cols * raster.rows);
  for (const entry of floods) {
    if (entry === null || !("flood" in entry)) continue;
    for (const cells of [entry.flood.cells, ...entry.pockets]) for (const index of cells) if (claims[index] < 2) claims[index] += 1;
  }
  return rooms.map((room, index): FillResult | null => {
    const entry = floods[index];
    if (entry === null || !("flood" in entry)) return entry;
    const { flood } = entry;
    const pockets = entry.pockets.filter((pocket) => pocket.every((cell) => claims[cell] === 1));
    const all = new Int32Array(pockets.reduce((sum, pocket) => sum + pocket.length, flood.cells.length));
    all.set(flood.cells);
    pockets.reduce((offset, pocket) => {
      all.set(pocket, offset);
      return offset + pocket.length;
    }, flood.cells.length);
    const window = windowOf(raster, all);
    if ((window.w - 2) * cell >= FILL_FRAME_SHARE * extraction.width || (window.h - 2) * cell >= FILL_FRAME_SHARE * extraction.height) {
      return { rejected: "frame" };
    }
    fillHoles(raster, window, holeMax);
    const { cells, edges } = floorCount(window);
    const area = (cells + edges / 2) * cellM2;
    if (area > FILL_SANITY_RATIO * room.printed_m2 || area < room.printed_m2 / FILL_SANITY_RATIO) return { rejected: "ratio" };
    const outline = traceOutline(raster, bridged(raster, window, flood.joinery, pockets));
    return outline.length >= 8 ? { area_m2: area, outline } : { rejected: "seed" };
  });
}

/**
 * The floor's window with its pockets joined to it: the joinery cells between the floor and a pocket (next to both)
 * become floor, so that the outline goes around the pockets the area counts.
 */
function bridged(raster: Raster, window: Window, joinery: readonly number[], pockets: readonly Int32Array[]): Window {
  if (pockets.length === 0) return window;
  const local = (index: number) => {
    const x = index % raster.cols, y = (index - x) / raster.cols;
    return (y - window.y0) * window.w + (x - window.x0);
  };
  const pocket = new Uint8Array(window.mask.length);
  for (const cells of pockets) for (const index of cells) pocket[local(index)] = 1;
  const mask = window.mask.slice();
  for (const index of joinery) {
    const at = local(index);
    const x = at % window.w;
    if (x <= 0 || x >= window.w - 1 || at < window.w || at >= mask.length - window.w) continue;
    if ([at - 1, at + 1, at - window.w, at + window.w].some((next) => pocket[next] === 1)) mask[at] = 1;
  }
  return { ...window, mask };
}
