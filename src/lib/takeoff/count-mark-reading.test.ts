import { describe, expect, it } from "vitest";
import { pageProposals, readCountMarkTiles } from "./count-mark-reading";
import { tileLayout } from "./bench/count-pins/replay";

import { countMarkSchedule, countMarkReaderStatus, publishedMarkCoverage } from "./count-mark-schedule";

const page = { width: 700, height: 400, sheet: "fiction", generation: "g1", page: 7 };
const target = { id: "valve-a", organ: "vanne" as const, requiresDn: true, basis: "u", discriminants: [] };
const schedule = (widths: number[]) =>
  countMarkSchedule(
    widths.map((width_points, i) => ({ page: i + 1, width_points })),
    3,
  );

describe("the confirmed count-mark readers", () => {
  it("opens earlier readings with unrelated provider metadata", () => {
    expect(publishedMarkCoverage({ format: "previous" })).toBeUndefined();
  });

  it("counts all reads on the exact pages and refuses an overrun", () => {
    expect(schedule([700, 701, 700, 701, 700])).toMatchObject({ tile_calls: 24, other_calls: 3, total_calls: 27 });
    expect(() => schedule([700, 701, 701, 701, 700])).toThrow();
    expect(countMarkReaderStatus("tile", "vanne")).toBe("non qualifié");
  });

  it("makes one serial call per tile and keeps only the owner of a centre in an overlap", async () => {
    const visits: number[] = [];
    let active = 0;
    const result = await readCountMarkTiles(page, target, async (tile) => {
      expect(++active).toBe(1);
      visits.push(tile.id);
      await Promise.resolve();
      active--;
      if (tile.id >= 2) return { status: "complete", pins: [] };
      const { crop } = tile;
      return {
        status: "complete",
        pins: [
          {
            poste: target.id,
            dn: 20,
            x0: (349 - crop.x0) / (crop.x1 - crop.x0),
            x1: (353 - crop.x0) / (crop.x1 - crop.x0),
            y0: 0.25,
            y1: 0.27,
          },
        ],
      };
    });
    expect(visits).toEqual(tileLayout(page).map((tile) => tile.id));
    expect(result.pins).toHaveLength(1);
    expect(result.pins[0]).toMatchObject({ page: 7, dn: "DN 20", evidence: ["tile-1"] });
  });

  it.each([[349.75, 350.25], [350.25, 349.75]])("reconciles seam estimates %s and %s into one object", async (left, right) => {
    const result = await readCountMarkTiles(page, target, async ({ id, crop }) => {
      const x = id === 0 ? left : right;
      const localX = (value: number) => (value - crop.x0) / (crop.x1 - crop.x0);
      return { status: "complete", pins: id > 1 ? [] : [
        { poste: target.id, dn: 20, x0: localX(x - 2), x1: localX(x + 2), y0: 0.3, y1: 0.32 },
      ] };
    });
    expect(result.tiles).toEqual(Array(4).fill("read"));
    expect(pageProposals([], result.pins, page, target.id, "DN 20").marks).toHaveLength(1);
  });

  it("retains actual coverage and makes no further attempt after an unknown outcome", async () => {
    const visits: number[] = [];
    const result = await readCountMarkTiles(page, target, async ({ id }) => {
      visits.push(id);
      return id === 0 ? { status: "truncated" } : { status: "unknown" };
    });
    expect(visits).toEqual([0, 1]);
    expect(result.tiles).toEqual(["truncated", "unknown", "not_read", "not_read"]);
    expect(result.pins).toEqual([]);
  });
});

it("keeps ambiguous neighbours separate, and both source positions when two readers agree", () => {
  const at = (x: number, tile = false) => ({
    ...page,
    x,
    y: 55,
    dn: "DN 20",
    organ: target.organ,
    poste: target.id,
    method: tile ? "tile-replay" : "label",
    evidence: tile ? ["tile-0"] : ["leader-2"],
  });
  const agreed = pageProposals([at(60)], [at(61, true)], page, target.id, "DN 20");
  expect(agreed.marks[0].proposals.map((p) => [p.method, p.state, p.raw_frame])).toEqual([
    ["vector", "proposed", "visible_page_points"],
    ["tile", "proposed", "tile_normalized"],
  ]);
  const nearby = pageProposals([at(50), at(54)], [at(52, true)], page, target.id, "DN 20");
  expect(nearby.marks).toHaveLength(3);
  expect(nearby.marks.every((m) => m.proposals.every((p) => p.state === "to_attribute"))).toBe(true);
  expect(pageProposals([at(-1)], [], page, target.id, null).marks).toEqual([]);
});
