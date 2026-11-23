import { z } from "zod";

import { combineReaders } from "./bench/count-pins/fusion";
import { replayTiles, tileLayout } from "./bench/count-pins/replay";
import type { JudgedPin, PageFrame, Pin } from "./bench/count-pins/types";

import { COUNT_MARK_READER_VERSION, type MarkCoverage } from "./count-mark-schedule";
export type ReaderTarget = { id: string; organ: Pin["organ"]; requiresDn: boolean };

const unit = z.number().min(0).max(1);
export const locationResponse = z
  .object({
    status: z.enum(["complete", "truncated"]),
    pins: z
      .array(
        z
          .object({ dn: z.number().int().positive().max(3000).nullable(), x0: unit, y0: unit, x1: unit, y1: unit })
          .strict()
          .refine((b) => b.x0 < b.x1 && b.y0 < b.y1),
      )
      .max(500),
  })
  .strict();

type Tile = ReturnType<typeof tileLayout>[number];
type Located = {
  status: "complete";
  pins: Array<z.infer<typeof locationResponse>["pins"][number] & { poste: string }>;
};
type Abstention = { status: "truncated" | "failed" | "unknown" | "not_read"; stop?: boolean };

export async function readCountMarkTiles(
  page: PageFrame,
  target: ReaderTarget,
  read: (tile: Tile) => Promise<Located | Abstention>,
) {
  const layout = tileLayout(page);
  const tiles: MarkCoverage[number]["tiles"] = layout.map(() => "not_read");
  const recordings: unknown[] = [];
  let stopped = false;
  for (const tile of layout) {
    const result = await read(tile);
    tiles[tile.id] = result.status === "complete" ? "read" : result.status;
    if (result.status === "complete") {
      recordings.push({
        id: tile.id,
        source: { sheet: page.sheet, generation: page.generation, page: page.page },
        status: "complete",
        pins: result.pins,
      });
    } else if (result.status === "unknown" || result.stop) {
      stopped = true;
      break;
    }
  }
  const decoded = replayTiles(page, [target], recordings);
  return { pins: decoded.pins, tiles, stopped };
}

export function pageProposals(
  vector: JudgedPin[],
  tiles: JudgedPin[],
  page: PageFrame,
  itemId: string,
  diameter: string | null,
) {
  const onPage = (p: JudgedPin) => p.x >= 0 && p.x <= page.width && p.y >= 0 && p.y <= page.height;
  const drawing = vector.filter(onPage);
  const all = drawing.concat(tiles.filter(onPage));
  const tagged = all.map((pin, i) => ({ ...pin, evidence: [...pin.evidence, "source:" + i] }));
  const fused = combineReaders(tagged.slice(0, drawing.length), tagged.slice(drawing.length));
  const layout = tileLayout(page);
  const marks = fused.slice(0, 5000).map((hit, index) => {
    const sources = hit.evidence.filter((s) => s.startsWith("source:")).map((s) => all[Number(s.slice(7))]);
    const ambiguous = hit.evidence.includes("ambiguous-neighbours");
    const conflict = ambiguous || hit.evidence.includes("conflicting-DN") || (!!diameter && diameter !== hit.dn);
    const proposals = sources.map((p, i) => {
      const tileId = p.method === "tile-replay" ? p.evidence.find((s) => /^tile-\d+$/.test(s)) : null;
      const tile = tileId ? layout[Number(tileId.slice(5))] : null;
      const method = tile ? "tile" : "vector";
      const frame = tile?.crop ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
      const rawX = (x: number) => (x - frame.x0) / (frame.x1 - frame.x0);
      const rawY = (y: number) => (y - frame.y0) / (frame.y1 - frame.y0);
      const box = p.box && [
        Math.max(0, p.box.x0),
        Math.max(0, p.box.y0),
        Math.min(page.width, p.box.x1),
        Math.min(page.height, p.box.y1),
      ];
      const validBox = box && box[0] < box[2] && box[1] < box[3];
      const dn = p.dn?.match(/^DN (\d+)$/)?.[1];
      return {
        item_id: itemId,
        state: conflict ? "to_attribute" : "proposed",
        method,
        method_version: COUNT_MARK_READER_VERSION,
        source_key: [ambiguous ? "neighbours" : "pin", method, page.page, index, i].join(":"),
        source_ref: tile ? "tile:" + (tile.id + 1) : [p.method, ...p.evidence.slice(0, 4)].join(":").slice(0, 200),
        subtype: p.organ,
        x: p.x / page.width,
        y: p.y / page.height,
        raw_centre: [rawX(p.x), rawY(p.y)],
        raw_frame: tile ? "tile_normalized" : "visible_page_points",
        ...(validBox && {
          box: [box[0] / page.width, box[1] / page.height, box[2] / page.width, box[3] / page.height],
          raw_box: [rawX(box[0]), rawY(box[1]), rawX(box[2]), rawY(box[3])],
        }),
        ...(dn && {
          diameter_mm: Number(dn),
          diameter_source: tile ? "model" : p.method === "pipe" ? "connection" : "label",
        }),
      };
    });
    return { page: page.page, x: hit.x / page.width, y: hit.y / page.height, proposals };
  });
  return { marks, limited: fused.length > marks.length };
}
