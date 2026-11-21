import { z } from "zod";
import type { Box } from "../../vectors/geometry";
import type { JudgedPin, PageFrame, Poste } from "./types";

export const TILE_OVERLAP = 12;
export const WIDE_PAGE = 700;
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

export function replayTiles(page: PageFrame, targets: readonly Poste[], recordings: unknown[]) {
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
  const pins: JudgedPin[] = [];
  const catalogue = new Map(targets.map((target) => [target.id, target]));
  for (const { id, crop, core } of planned) {
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
      // Half-open cores assign interior boundaries to the next tile on each axis.
      const x = tileCentre(hit.x0, hit.x1, crop.x0, crop.x1, core.x0, core.x1);
      const y = tileCentre(hit.y0, hit.y1, crop.y0, crop.y1, core.y0, core.y1);
      if (x < core.x0 || y < core.y0 || x >= core.x1 || y >= core.y1) continue;
      pins.push({
        x, y, box, ...recorded,
        poste: hit.poste, organ: catalogue.get(hit.poste)!.organ,
        dn: hit.dn === null ? null : "DN " + hit.dn,
        method: "tile-replay", evidence: ["tile-" + id],
      });
    }
  }
  return { status: tiles.complete === planned.length && tiles.unexpected === 0 ? "complete" as const : "partial" as const, pins, tiles };
}
