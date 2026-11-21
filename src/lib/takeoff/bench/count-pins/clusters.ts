import { isNearWhite } from "../../vectors/colors";
import type { VectorPageExtraction } from "../../vectors/extraction";
import { emptyBox, extendBox, type Point } from "../../vectors/geometry";
import type { Pin } from "./types";
import { distance } from "./types";

// Components of short strokes joined at printed vertices in the same paint
// group. A coarse rotation/reflection invariant fingerprint is only a cluster
// hypothesis. Long pipes and leaders must not join neighbouring components.
export function clusters(e: VectorPageExtraction, sheet: string, generation: string): Pin[] {
  const parent = new Int32Array(e.paths.length).fill(-1);
  const vertexOwner = new Map<string, number>();
  function root(i: number) {
    while (i !== parent[i]) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  const visible = e.groups.map(
    (g) => !isNearWhite(g.color) && !e.layers.some((l) => l.id === g.layer && !l.visible),
  );
  const groups = new Map<number, number[]>();
  for (const [i, p] of e.paths.entries()) {
    if (!visible[p.group] || p.count < 2 || p.count > 20) continue;
    const box = emptyBox();
    for (let j = p.start; j < p.start + p.count; j++) extendBox(box, e.points[2 * j], e.points[2 * j + 1]);
    if (Math.max(box.x1 - box.x0, box.y1 - box.y0) > 16) continue;
    parent[i] = i;
    for (let j = p.start; j < p.start + p.count; j++) {
      const key = [p.group, Math.round(e.points[2 * j] * 8), Math.round(e.points[2 * j + 1] * 8)].join("/");
      const other = vertexOwner.get(key);
      if (other === undefined) vertexOwner.set(key, i);
      else parent[root(i)] = root(other);
    }
  }
  parent.forEach((value, i) => {
    if (value < 0) return;
    const k = root(i),
      list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  });
  const families = new Map<string, Pin[]>();
  for (const paths of groups.values()) {
    if (paths.length < 2 || paths.length > 16) continue;
    const vertices: Point[] = [],
      box = emptyBox(),
      lengths: number[] = [];
    for (const i of paths) {
      const p = e.paths[i];
      let length = 0;
      for (let j = p.start; j < p.start + p.count; j++) {
        const point = { x: e.points[2 * j], y: e.points[2 * j + 1] };
        extendBox(box, point.x, point.y);
        if (j > p.start) length += distance(vertices[vertices.length - 1], point);
        vertices.push(point);
      }
      lengths.push(Math.round(length * 4));
    }
    if (vertices.length > 48 || Math.max(box.x1 - box.x0, box.y1 - box.y0) < 2) continue;
    const distances = vertices.flatMap((p, i) => vertices.slice(i + 1).map((q) => Math.round(distance(p, q) * 4)));
    const key = [lengths.sort((a, b) => a - b), distances.sort((a, b) => a - b)].join("/");
    const family = families.get(key) ?? [];
    const horizontal = box.x1 - box.x0 >= box.y1 - box.y0;
    const ordered = vertices.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const ports = [ordered[0], ordered[ordered.length - 1]];
    family.push({
      ports,
      x: (box.x0 + box.x1) / 2,
      y: (box.y0 + box.y1) / 2,
      box,
      sheet,
      generation,
      page: e.page,
      organ: null,
      dn: null,
      method: "cluster",
      evidence: ["component-" + paths[0]],
    });
    families.set(key, family);
  }
  return [...families.values()]
    .filter((group) => group.length >= 2)
    .flatMap((group, i) => group.map((pin) => ({ ...pin, evidence: [...pin.evidence, "cluster-" + i] })));
}
