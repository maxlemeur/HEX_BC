import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { angleGap, boxArea, emptyBox, extendBox, type Box, type Point } from "@/lib/takeoff/vectors/geometry";
import { parsePipeLabel, type PipeLabel } from "@/lib/takeoff/vectors/vocabulary";

// Pipe labels of a page (TI-662 step 4). Text lines of one label (same angle
// and height within 30 %, the next line 0.9 to 1.7 heights below, overlapping
// along the baseline) form a block, read as one label: network, material, DN
// (vocabulary.ts); a line naming its own network starts another block. A
// block that names neither a network nor a DN is no label.
// Superposed labels (glyph boxes of two different blocks covering ≥ 30 % of
// the smaller) are flagged illegible: they are still attached by geometry and
// position, and a block whose reading is incomplete stays « à revoir ».

export type LabelBlock = {
  text: string;
  label: PipeLabel;
  /** Baseline direction (radians) and line height (pt). */
  angle: number;
  height: number;
  centre: Point;
  box: Box;
  /** Glyph boxes of the lines (axis-aligned), for leader search and superposition. */
  lines: Box[];
  superposed: boolean;
};

function glyphBox(text: VectorText): Box {
  const c = Math.cos(text.angle), s = Math.sin(text.angle);
  // Baseline from (x, y) along (c, s); the glyphs rise along (s, -c) in page space (y down).
  const corners = [[0, 0], [text.width, 0], [0, text.height], [text.width, text.height]].map(([along, up]) => ({
    x: text.x + c * along + s * up, y: text.y + s * along - c * up,
  }));
  const box = emptyBox();
  for (const corner of corners) extendBox(box, corner.x, corner.y);
  return box;
}

function overlap(left: Box, right: Box) {
  const width = Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0);
  const height = Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Text items on one baseline (same angle and height within 30 %, baseline offset under 0.25 height, the next
 * starting within 1.5 heights after the previous end) form one line: pdfjs splits a label at font changes.
 */
/** Buckets of 0.04 rad around the circle: keys −DIRECTION_KEYS … DIRECTION_KEYS − 1, ±π in one bucket. */
const DIRECTION_KEYS = Math.round(Math.PI / 0.04);

/** The neighbour of a direction bucket, around the circle (the last one is next to the first). */
function nextKey(key: number, step: 1 | -1) {
  const next = key + step;
  return next >= DIRECTION_KEYS ? next - 2 * DIRECTION_KEYS : next < -DIRECTION_KEYS ? next + 2 * DIRECTION_KEYS : next;
}

/** Texts of one direction (within 0.02 rad, a bucket of 0.04 rad and its neighbour, across ±π), as the merges compare them. */
function byDirection(items: readonly VectorText[]) {
  const buckets = new Map<number, number[]>();
  items.forEach((item, index) => {
    const turned = Math.round(Math.atan2(Math.sin(item.angle), Math.cos(item.angle)) / 0.04);
    const key = turned >= DIRECTION_KEYS ? turned - 2 * DIRECTION_KEYS : turned;
    const list = buckets.get(key);
    if (list) list.push(index);
    else buckets.set(key, [index]);
  });
  return buckets;
}

const sameStyle = (left: VectorText, right: VectorText) =>
  angleGap(left.angle, right.angle) <= 0.02 && Math.abs(left.height - right.height) <= 0.3 * Math.max(left.height, right.height);

export function mergeTextLines(texts: readonly VectorText[]): VectorText[] {
  const items = texts.filter((text) => text.height > 0 && text.str.trim().length > 0);
  const used = new Uint8Array(items.length);
  const lines: VectorText[] = [];
  const buckets = byDirection(items);
  for (const [key, own] of [...buckets.entries()].sort(([left], [right]) => left - right)) {
    // Each piece is taken once, in the order of its own reading direction (an upward label starts at its bottom).
    const mine = new Set(own);
    const pool = [...own, ...(buckets.get(nextKey(key, 1)) ?? []), ...(buckets.get(nextKey(key, -1)) ?? [])];
    const c = Math.cos(key * 0.04), s = Math.sin(key * 0.04);
    const along = (index: number) => items[index].x * c + items[index].y * s;
    pool.sort((left, right) => along(left) - along(right));
    for (const [position, start] of pool.entries()) {
      if (used[start] || !mine.has(start)) continue;
      used[start] = 1;
      let line = { ...items[start] };
      const lc = Math.cos(line.angle), ls = Math.sin(line.angle);
      const origin = along(start);
      for (let next = position + 1; next < pool.length; next += 1) {
        const candidate = pool[next];
        // The cut-off follows the pool's own order (along the bucket's direction, within 0.02 rad of the line's):
        // a piece the line may still take lies at most its reach plus that tilt across a quarter height further.
        // Measured along the line's own angle instead, a text far off its baseline could end the search early.
        if (along(candidate) - origin > line.width + 1.5 * line.height + 0.25 * line.height * Math.sin(0.02)) break;
        if (used[candidate] || !sameStyle(items[candidate], line)) continue;
        const piece = items[candidate];
        const dx = piece.x - line.x, dy = piece.y - line.y;
        const forward = dx * lc + dy * ls, across = -dx * ls + dy * lc;
        if (Math.abs(across) > 0.25 * line.height || forward > line.width + 1.5 * line.height || forward < line.width - 0.5 * line.height) continue;
        line = { ...line, str: `${line.str}${forward > line.width + 0.15 * line.height ? " " : ""}${piece.str}`, width: forward + piece.width };
        used[candidate] = 1;
      }
      lines.push(line);
    }
  }
  return lines;
}

export function readLabelBlocks(texts: readonly VectorText[]): LabelBlock[] {
  const lines = mergeTextLines(texts);
  const parent = lines.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  // Lines of one direction, ordered across it (the next line of a label is 0.9 to 1.7 heights « below » its baseline).
  const buckets = byDirection(lines);
  for (const [key, own] of buckets) {
    const mine = new Set(own);
    const pool = [...own, ...(buckets.get(nextKey(key, 1)) ?? []), ...(buckets.get(nextKey(key, -1)) ?? [])];
    const c = Math.cos(key * 0.04), s = Math.sin(key * 0.04);
    const downOf = (index: number) => -lines[index].x * s + lines[index].y * c;
    pool.sort((left, right) => downOf(left) - downOf(right));
    for (let a = 0; a < pool.length; a += 1) {
      if (!mine.has(pool[a])) continue;
      const first = lines[pool[a]];
      const h = first.height;
      for (let b = a + 1; b < pool.length; b += 1) {
        const second = lines[pool[b]];
        if (downOf(pool[b]) - downOf(pool[a]) > 1.8 * Math.max(h, second.height)) break;
        if (!sameStyle(first, second)) continue;
        const fc = Math.cos(first.angle), fs = Math.sin(first.angle);
        const dx = second.x - first.x, dy = second.y - first.y;
        const along = dx * fc + dy * fs;
        const down = -dx * fs + dy * fc; // perpendicular, positive below the baseline in page space
        if (down < 0.9 * h || down > 1.7 * h) continue;
        if (along > first.width || along + second.width < 0) continue;
        // A line that names its own network starts another label (two pipes labelled side by side).
        if (parsePipeLabel(second.str).network !== null) continue;
        parent[find(pool[b])] = find(pool[a]);
      }
    }
  }
  const groups = new Map<number, number[]>();
  lines.forEach((_, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), index]));
  const blocks: LabelBlock[] = [];
  for (const members of groups.values()) {
    const sorted = members.map((index) => lines[index]).sort((left, right) => {
      const c = Math.cos(left.angle), s = Math.sin(left.angle);
      return (-(left.x) * s + left.y * c) - (-(right.x) * s + right.y * c) || left.x - right.x;
    });
    const text = sorted.map((line) => line.str.trim()).join(" ").replace(/\s+/g, " ");
    const label = parsePipeLabel(text);
    if (label.network === null && label.dn === null) continue;
    const boxes = sorted.map(glyphBox);
    const box = emptyBox();
    for (const entry of boxes) {
      extendBox(box, entry.x0, entry.y0);
      extendBox(box, entry.x1, entry.y1);
    }
    blocks.push({ text, label, angle: sorted[0].angle, height: sorted[0].height,
      centre: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, box, lines: boxes, superposed: false });
  }
  for (let a = 0; a < blocks.length; a += 1) {
    for (let b = a + 1; b < blocks.length; b += 1) {
      if (blocks[a].text === blocks[b].text) continue;
      const shared = blocks[a].lines.reduce((sum, left) => sum + blocks[b].lines.reduce((inner, right) => inner + overlap(left, right), 0), 0);
      const smaller = Math.min(blocks[a].lines.reduce((sum, line) => sum + boxArea(line), 0), blocks[b].lines.reduce((sum, line) => sum + boxArea(line), 0));
      if (smaller > 0 && shared >= 0.3 * smaller) {
        blocks[a].superposed = true;
        blocks[b].superposed = true;
      }
    }
  }
  return blocks;
}
