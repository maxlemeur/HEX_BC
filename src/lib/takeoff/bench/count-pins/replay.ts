import { z } from "zod";
import { boxContains, type Box } from "../../vectors/geometry";
import { MATCH_RADIUS } from "./score";
import type { JudgedPin, PageFrame, Pin } from "./types";

import { WIDE_PAGE } from "../../count-mark-schedule";

export const TILE_OVERLAP = 12;
export { WIDE_PAGE };
export const REPLAY_SCHEMA_VERSION = 2;

const unit = z.number().min(0).max(1);
const tilePin = z.object({
  poste: z.string(),
  dn: z.number().int().positive().max(3000).nullable(),
  x0: unit, y0: unit, x1: unit, y1: unit,
}).strict().refine((b) => b.x0 < b.x1 && b.y0 < b.y1);
const source = z.object({
  sheet: z.string().min(1), generation: z.string().min(1), page: z.number().int().positive(),
}).strict();
const response = z.discriminatedUnion("status", [
  z.object({ id: z.number().int(), source, status: z.literal("complete"), pins: z.array(tilePin).max(500) }).strict(),
  z.object({ id: z.number().int(), source, status: z.literal("truncated"), pins: z.array(z.unknown()).optional() }).strict(),
]);

export function tileLayout({ width, height }: PageFrame) {
  const cols = width > WIDE_PAGE ? 3 : 2;
  const cellWidth = width / cols;
  const cellHeight = height / 2;
  return Array.from({ length: cols * 2 }, (_, id) => {
    const col = id % cols;
    const row = Math.floor(id / cols);
    const core = { x0: col * cellWidth, x1: (col + 1) * cellWidth, y0: row * cellHeight, y1: (row + 1) * cellHeight };
    const crop = {
      x0: Math.max(0, core.x0 - TILE_OVERLAP), x1: Math.min(width, core.x1 + TILE_OVERLAP),
      y0: Math.max(0, core.y0 - TILE_OVERLAP), y1: Math.min(height, core.y1 + TILE_OVERLAP),
    };
    return { id, core, crop };
  });
}

function tileCentre(low: number, high: number, cropLow: number, cropHigh: number, coreLow: number, coreHigh: number) {
  const centre = cropLow + ((low + high) / 2) * (cropHigh - cropLow);
  // Independent crop transforms can round in opposite directions at a seam.
  const tolerance = Number.EPSILON * cropHigh * 4;
  if (Math.abs(centre - coreLow) <= tolerance) return coreLow;
  if (Math.abs(centre - coreHigh) <= tolerance) return coreHigh;
  return centre;
}

type CropDetection = { pin: JudgedPin; tile: ReturnType<typeof tileLayout>[number] };

// Reconcile in page space first. A component is one object only when every source tile
// contributes once and every pair corroborates it. Nearby competing objects keep their positions.
function reconcileTiles(detections: CropDetection[]): JudgedPin[] {
  const cells = new Map<string, number[]>();
  const peers = detections.map(() => [] as number[]);
  for (const [i, { pin, tile }] of detections.entries()) {
    const x = Math.floor(pin.x / MATCH_RADIUS), y = Math.floor(pin.y / MATCH_RADIUS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of cells.get(`${x + dx},${y + dy}`) ?? []) {
        const other = detections[j];
        if (other.tile.id === tile.id || other.pin.poste !== pin.poste ||
          !boxContains(tile.crop, other.pin) || !boxContains(other.tile.crop, pin) ||
          Math.hypot(pin.x - other.pin.x, pin.y - other.pin.y) > MATCH_RADIUS) continue;
        peers[i].push(j);
        peers[j].push(i);
      }
    }
    const key = `${x},${y}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(i);
  }
  const seen = new Set<number>();
  const result: JudgedPin[] = [];
  for (let i = 0; i < detections.length; i++) {
    if (seen.has(i)) continue;
    const group = [i];
    seen.add(i);
    for (const j of group) for (const k of peers[j]) {
      if (!seen.has(k)) { seen.add(k); group.push(k); }
    }
    if (group.some((j) => peers[j].length !== group.length - 1)) {
      for (const j of group) {
        const { pin } = detections[j];
        result.push({ ...pin, evidence: [...pin.evidence, "ambiguous-neighbours"] });
      }
      continue;
    }
    const sources = group.map((j) => detections[j]);
    const x = sources.reduce((sum, source) => sum + source.pin.x, 0) / sources.length;
    const y = sources.reduce((sum, source) => sum + source.pin.y, 0) / sources.length;
    const owner = sources.find(({ tile: { core } }) => x >= core.x0 && x < core.x1 && y >= core.y0 && y < core.y1);
    const pin = (owner ?? sources[0]).pin;
    const diameters = new Set(sources.map((source) => source.pin.dn).filter((dn) => dn !== null));
    result.push(diameters.size > 1 ? { ...pin, dn: null, evidence: [...pin.evidence, "conflicting-DN"] }
      : { ...pin, dn: [...diameters][0] ?? null });
  }
  return result;
}

export function replayTiles(page: PageFrame, targets: readonly { id: string; organ: Pin["organ"]; requiresDn: boolean }[], recordings: unknown[]) {
  const planned = tileLayout(page);
  const tiles = { planned: planned.length, complete: 0, truncated: 0, invalid: 0, missing: 0, unexpected: 0 };
  const byId = new Map<number, unknown[]>();
  for (const recording of recordings) {
    const id = recording && typeof recording === "object" && "id" in recording ? recording.id : null;
    if (typeof id !== "number" || !planned.some((tile) => tile.id === id)) {
      tiles.unexpected++;
      continue;
    }
    byId.set(id, [...(byId.get(id) ?? []), recording]);
  }
  const detections: CropDetection[] = [];
  const catalogue = new Map(targets.map((target) => [target.id, target]));
  for (const tile of planned) {
    const { id, crop, core } = tile;
    const inputs = byId.get(id);
    if (!inputs) {
      tiles.missing++;
      continue;
    }
    const parsed = response.safeParse(inputs[0]);
    if (inputs.length !== 1 || !parsed.success) {
      tiles.invalid++;
      continue;
    }
    const recorded = parsed.data.source;
    if (recorded.sheet !== page.sheet || recorded.generation !== page.generation || recorded.page !== page.page) {
      tiles.invalid++;
      continue;
    }
    if (parsed.data.status === "truncated") {
      tiles.truncated++;
      continue;
    }
    if (parsed.data.pins.some((pin) => !catalogue.has(pin.poste) || (pin.dn !== null && !catalogue.get(pin.poste)?.requiresDn))) {
      tiles.invalid++;
      continue;
    }
    tiles.complete++;
    for (const hit of parsed.data.pins) {
      const box: Box = {
        x0: crop.x0 + hit.x0 * (crop.x1 - crop.x0), x1: crop.x0 + hit.x1 * (crop.x1 - crop.x0),
        y0: crop.y0 + hit.y0 * (crop.y1 - crop.y0), y1: crop.y0 + hit.y1 * (crop.y1 - crop.y0),
      };
      const x = tileCentre(hit.x0, hit.x1, crop.x0, crop.x1, core.x0, core.x1);
      const y = tileCentre(hit.y0, hit.y1, crop.y0, crop.y1, core.y0, core.y1);
      detections.push({ tile, pin: {
        x, y, box, ...recorded,
        poste: hit.poste, organ: catalogue.get(hit.poste)!.organ,
        dn: hit.dn === null ? null : "DN " + hit.dn,
        method: "tile-replay", evidence: ["tile-" + id],
      } });
    }
  }
  return { status: tiles.complete === planned.length && tiles.unexpected === 0 ? "complete" as const : "partial" as const, pins: reconcileTiles(detections), tiles };
}
