import { expect, it } from "vitest";
import { replayTiles, tileLayout } from "./replay";

const page = { sheet: "scan", generation: "revision-a", page: 2, width: 400, height: 300 };
const source = { sheet: page.sheet, generation: page.generation, page: page.page };
const targets = [{ id: "vanne-ef", organ: "vanne", basis: "installed", discriminants: ["EF"], requiresDn: true }] as const;

it("owns an overlap centre once, including on a tile boundary, and uses the actual crop extent", () => {
  const tiles = tileLayout(page);
  const recordings = tiles.map(({ id, crop }) => {
    const x = (200 - crop.x0) / (crop.x1 - crop.x0);
    const y = (75 - crop.y0) / (crop.y1 - crop.y0);
    const pins = id < 2 ? [{ poste: "vanne-ef", dn: 20, x0: x - 0.02, x1: x + 0.02, y0: y - 0.03, y1: y + 0.03 }] : [];
    return { id, source, status: "complete", pins };
  });
  const result = replayTiles(page, targets, recordings);
  expect(result.status).toBe("complete");
  expect(result.pins).toHaveLength(1);
  expect(result.pins[0]).toMatchObject({ x: 200, y: 75, page: 2, generation: "revision-a", evidence: ["tile-1"] });
});

it("keeps exactly one owner when affine roundoff differs between overlapping crops", () => {
  const smallPage = { ...page, width: 50, height: 100 };
  const recordings = tileLayout(smallPage).map(({ id, crop }) => ({
    id, source,
    status: "complete",
    pins: id < 2 ? [{
      poste: "vanne-ef", dn: 20,
      x0: (17.7 - crop.x0) / (crop.x1 - crop.x0),
      x1: (32.3 - crop.x0) / (crop.x1 - crop.x0),
      y0: 0.15, y1: 0.30,
    }] : [],
  }));
  expect(replayTiles(smallPage, targets, recordings).pins).toMatchObject([{ x: 25, evidence: ["tile-1"] }]);
});

it("keeps useful coverage while withholding the score input for absent, truncated or invalid tiles", () => {
  const result = replayTiles(page, targets, [
    { id: 0, source, status: "complete", pins: [] },
    { id: 1, source, status: "truncated", pins: [] },
    { id: 2, source, status: "complete", pins: [{ poste: "vanne-ef", dn: 20, x0: 0.8, x1: 0.2, y0: 0, y1: 2 }] },
  ]);
  expect(result).toMatchObject({
    status: "partial", pins: [], tiles: { planned: 4, complete: 1, truncated: 1, invalid: 1, missing: 1 },
  });
  const unknown = replayTiles(page, targets, Array.from({ length: 4 }, (_, id) => ({
    id, source, status: "complete", pins: [{ poste: "foreign", dn: 20, x0: 0.2, x1: 0.4, y0: 0.2, y1: 0.4 }],
  })));
  expect(unknown.tiles.invalid).toBe(4);
});

it("refuses unbound generation A page 1 tiles presented as generation B page 2", () => {
  const original = { ...page, page: 1, generation: "revision-a" };
  const recordings = tileLayout(original).map(({ id }) => ({
    id, status: "complete", pins: id === 0 ? [{ poste: "vanne-ef", dn: 20, x0: 0.2, x1: 0.4, y0: 0.2, y1: 0.4 }] : [],
  }));
  expect(replayTiles({ ...page, generation: "revision-b" }, targets, recordings)).toMatchObject({
    status: "partial", pins: [], tiles: { complete: 0 },
  });
});

it.each([
  ["generation", { generation: "revision-b" }],
  ["physical page", { page: 2 }],
  ["sheet", { sheet: "foreign" }],
])("accepts the source recordings only on their own %s", (_, mismatch) => {
  const original = { ...page, page: 1 };
  const source = { sheet: original.sheet, page: original.page, generation: original.generation };
  const recordings = tileLayout(original).map(({ id }) => ({
    id, source, status: "complete", pins: id === 0 ? [{ poste: "vanne-ef", dn: 20, x0: 0.2, x1: 0.4, y0: 0.2, y1: 0.4 }] : [],
  }));
  expect(replayTiles(original, targets, recordings)).toMatchObject({ status: "complete", pins: [expect.objectContaining(source)] });
  expect(replayTiles({ ...original, ...mismatch }, targets, recordings)).toMatchObject({
    status: "partial", pins: [], tiles: { complete: 0, invalid: 4 },
  });
});
