import type { VectorText } from "@/lib/takeoff/vectors/extraction";
import { boxArea, emptyBox, extendBox, type Box, type Point } from "@/lib/takeoff/vectors/geometry";
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
export function mergeTextLines(texts: readonly VectorText[]): VectorText[] {
  const items = texts.filter((text) => text.height > 0 && text.str.trim().length > 0);
  const used = new Set<number>();
  const order = items.map((_, index) => index).sort((left, right) => items[left].x - items[right].x || items[left].y - items[right].y);
  const lines: VectorText[] = [];
  for (const start of order) {
    if (used.has(start)) continue;
    used.add(start);
    let line = { ...items[start], str: items[start].str };
    let extended = true;
    while (extended) {
      extended = false;
      const c = Math.cos(line.angle), s = Math.sin(line.angle);
      for (const candidate of order) {
        if (used.has(candidate)) continue;
        const next = items[candidate];
        if (Math.abs(next.angle - line.angle) > 0.02 || Math.abs(next.height - line.height) > 0.3 * Math.max(next.height, line.height)) continue;
        const dx = next.x - line.x, dy = next.y - line.y;
        const along = dx * c + dy * s, across = -dx * s + dy * c;
        if (Math.abs(across) > 0.25 * line.height || along < line.width - 0.5 * line.height || along > line.width + 1.5 * line.height) continue;
        line = { ...line, str: `${line.str}${along > line.width + 0.15 * line.height ? " " : ""}${next.str}`, width: along + next.width };
        used.add(candidate);
        extended = true;
        break;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function readLabelBlocks(texts: readonly VectorText[]): LabelBlock[] {
  const lines = mergeTextLines(texts);
  const parent = lines.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  // Bucket by angle and rough position to keep the pairing local.
  const order = lines.map((_, index) => index).sort((left, right) => lines[left].y - lines[right].y);
  for (let a = 0; a < order.length; a += 1) {
    const first = lines[order[a]];
    for (let b = a + 1; b < order.length; b += 1) {
      const second = lines[order[b]];
      if (second.y - first.y > 4 * Math.max(first.height, second.height) + first.width) break;
      if (Math.abs(first.angle - second.angle) > 0.02 || Math.abs(first.height - second.height) > 0.3 * Math.max(first.height, second.height)) continue;
      const c = Math.cos(first.angle), s = Math.sin(first.angle);
      const dx = second.x - first.x, dy = second.y - first.y;
      const along = dx * c + dy * s;
      const down = -dx * s + dy * c; // perpendicular, positive below the baseline in page space
      const h = first.height;
      if (down < 0.9 * h || down > 1.7 * h) continue;
      if (along > first.width || along + second.width < 0) continue;
      // A line that names its own network starts another label (two pipes labelled side by side).
      if (parsePipeLabel(second.str).network !== null) continue;
      parent[find(order[b])] = find(order[a]);
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
