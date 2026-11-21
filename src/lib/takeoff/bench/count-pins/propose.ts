import { readItemKey } from "../item-keys";
import { indexSymbolPage } from "./symbols";
import { mergeTextLines } from "../../vectors/labels";
import {
  boxContains,
  distanceToSegment,
  emptyBox,
  extendBox,
  SegmentIndex,
  type Point,
  type Segment,
} from "../../vectors/geometry";
import { isNearWhite } from "../../vectors/colors";
import { readVectorPage } from "../../vectors/pipeline";
import { clusters } from "./clusters";
import { combine } from "./fusion";
import { attachedSize } from "./pipes";
import { distance, type Pin, type Sheet } from "./types";

export function union(lists: Pin[][], radius: number) {
  const kept: Pin[] = [];
  for (const list of lists)
    for (const p of list) {
      const old = kept.find(
        (q) =>
          q.sheet === p.sheet &&
          q.generation === p.generation &&
          q.page === p.page &&
          q.organ === p.organ &&
          q.dn === p.dn &&
          distance(p, q) <= radius,
      );
      if (!old) kept.push({ ...p, evidence: [...p.evidence] });
      else old.evidence.push(...p.evidence.filter((e) => !old.evidence.includes(e)));
    }
  return kept;
}

export function readDeterministic(sheet: Sheet) {
  const e = sheet.extraction;
  const index = indexSymbolPage(e);
  const reading = readVectorPage(e);
  const field = (p: Point) => !reading.legend.boxes.some((box) => boxContains(box, p));
  const segments: Segment[] = [];
  const visible = e.groups.map(
    (g) => !isNearWhite(g.color) && !e.layers.some((l) => l.id === g.layer && !l.visible),
  );
  for (const path of e.paths) {
    if (!visible[path.group] || path.count !== 2) continue;
    const j = 2 * path.start;
    segments.push({ x0: e.points[j], y0: e.points[j + 1], x1: e.points[j + 2], y1: e.points[j + 3] });
  }
  const lines = new SegmentIndex(segments, e.width);
  const runs = reading.networks?.runs ?? [];
  const runIndex = new SegmentIndex(
    runs.map((r) => r.segment),
    e.width,
  );
  const labels: Pin[] = [];
  for (const [i, t] of mergeTextLines(e.texts).entries()) {
    const key = readItemKey({ designation: t.str, unit: "u" }, { rooms: [] });
    if (key.status === "out_of_score" || !key.key.organ || !field(t)) continue;
    const c = Math.cos(t.angle),
      s = Math.sin(t.angle);
    const centre = { x: t.x + (c * t.width + s * t.height) / 2, y: t.y + (s * t.width - c * t.height) / 2 };
    const anchor = { x: t.x, y: t.y };
    const tips = [];
    for (const j of lines.near(centre, t.width / 2 + 2 * t.height)) {
      const line = segments[j];
      const ends = [
        { x: line.x0, y: line.y0 },
        { x: line.x1, y: line.y1 },
      ];
      for (const [k, end] of ends.entries()) {
        const rx = end.x - anchor.x,
          ry = end.y - anchor.y;
        const along = rx * c + ry * s,
          up = rx * s - ry * c;
        const tip = ends[1 - k];
        if (
          along >= -t.height &&
          along <= t.width + t.height &&
          up >= -t.height &&
          up <= 2 * t.height &&
          distance(tip, centre) > t.width / 2 + t.height &&
          distance(tip, centre) <= 80
        )
          tips.push(tip);
      }
    }
    const tip = tips.length === 1 ? tips[0] : null;
    const point = tip ?? centre;
    labels.push({
      ...point,
      sheet: sheet.id,
      generation: sheet.generation,
      page: e.page,
      organ: key.key.organ,
      dn: key.key.dn?.printed.startsWith("DN ") ? key.key.dn.printed : null,
      box: {
        x0: Math.max(0, point.x - 80),
        y0: Math.max(0, point.y - 80),
        x1: Math.min(e.width, point.x + 80),
        y1: Math.min(e.height, point.y + 80),
      },
      method: "label",
      evidence: [(tip ? "leader-" : "window-") + i],
    });
  }
  const seen = new Map<string, number>(),
    first: Pin[] = [],
    both: Pin[] = [];
  for (const [i, seed] of sheet.examples.entries()) {
    const n = seen.get(seed.organ) ?? 0;
    if (n === 2) continue;
    seen.set(seed.organ, n + 1);
    const box = emptyBox(),
      vertices: Point[] = [];
    for (const id of seed.paths) {
      const path = e.paths[id];
      for (let j = path.start; j < path.start + path.count; j++) {
        const p = { x: e.points[2 * j], y: e.points[2 * j + 1] };
        extendBox(box, p.x, p.y);
        vertices.push(p);
      }
    }
    const cx = (box.x1 + box.x0) / 2,
      cy = (box.y1 + box.y0) / 2;
    // Port hypothesis from actual extreme vertices of the example, validated
    // separately against the ends and directions of two independent pipe runs.
    const horizontal = box.x1 - box.x0 >= box.y1 - box.y0;
    const axis = (p: Point) => (horizontal ? p.x : p.y);
    const verticesByAxis = vertices.sort((a, b) => axis(a) - axis(b));
    const ends = [verticesByAxis[0], verticesByAxis.at(-1)!];
    const pins = index
      .match(seed.paths)
      .filter(field)
      .map((hit) => {
        const cos = Math.cos(hit.angle),
          sin = Math.sin(hit.angle);
        const ports = ends.map((p) => {
          const dx = (p.x - cx) * hit.scale,
            dy = (p.y - cy) * hit.scale * (hit.mirrored ? -1 : 1);
          return { x: hit.x + cos * dx - sin * dy, y: hit.y + sin * dx + cos * dy };
        });
        return {
          x: hit.x,
          y: hit.y,
          sheet: sheet.id,
          generation: sheet.generation,
          page: e.page,
          organ: seed.organ,
          dn: null,
          ports,
          method: "example",
          evidence: ["example-" + i],
        };
      });
    if (!n) first.push(...pins);
    both.push(...pins);
  }
  const cluster = clusters(e, sheet.id, sheet.generation).filter(field);
  const namedExamples = union([both], 0.15);
  const labelledDrawings = labels.flatMap((label) => {
    // Only one compact drawing may claim the leader tip or window centre.
    const local = cluster.filter((p) => distance(p, label) <= 4);
    if (local.length !== 1) return [];
    return [{ ...local[0], organ: label.organ, evidence: [...label.evidence, ...local[0].evidence] }];
  });
  const pipes = combine(namedExamples, labelledDrawings, 4).map((pin) => {
    const ports = pin.ports ?? [];
    const radius = Math.max(1, ...ports.map((p) => distance(pin, p))) + 1;
    const runIds = runIndex.near(pin, radius);
    const nearby = runIds.map((i) => runs[i]);
    let dn = attachedSize(pin, nearby);
    // A classified run can omit a crossing or tee in an unclassified colour.
    // An additional long visible straight stroke through the occupied span vetoes attribution.
    if (dn && ports.length === 2) {
      const [a, b] = ports;
      const axis = Math.atan2(b.y - a.y, b.x - a.x);
      const blockers = lines
        .near(pin, radius)
        .map((i) => segments[i])
        .filter((s) => {
          const length = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
          return length > radius * 1.8 && Math.abs(Math.sin(Math.atan2(s.y1 - s.y0, s.x1 - s.x0) - axis)) > 0.3;
        })
        .map((segment) => ({ ...nearby[0], segment }));
      if (!attachedSize(pin, [...nearby, ...blockers])) dn = null;
    }
    const evidence = dn
      ? runIds
          .filter((i) => ports.some((p) => distanceToSegment(p, runs[i].segment) <= 0.35))
          .map((i) => "run-" + i)
      : ["à attribuer"];
    return { ...pin, dn, method: "pipe", evidence: [...pin.evidence, ...evidence] };
  });
  const det = combine(pipes, labels, 4);
  // Only previously unnamed clusters may inherit a family from a coincident
  // independently named pin. Never name by reference quantities or by truth.
  const names = new Map<string, Set<Pin["organ"]>>();
  for (const pin of cluster)
    for (const anchor of det) {
      if (distance(pin, anchor) > 4 || !anchor.organ) continue;
      const key = pin.evidence[1],
        set = names.get(key) ?? new Set();
      set.add(anchor.organ);
      names.set(key, set);
    }
  const named = cluster.flatMap((p) => {
    const set = names.get(p.evidence[1]);
    return set?.size === 1 ? [{ ...p, organ: [...set][0], method: "named-cluster" }] : [];
  });
  return {
    label: labels,
    example1: union([first], 0.15),
    example2: namedExamples,
    cluster,
    pipe: pipes,
    "label+example": combine(namedExamples, labels, 4),
    "label+pipe": det,
    "all-deterministic": combine(det, named, 4),
  };
}
