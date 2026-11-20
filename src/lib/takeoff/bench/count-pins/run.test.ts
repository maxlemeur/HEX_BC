import { beforeAll, expect, it, vi } from "vitest";
import { FICTION_SEED } from "./fiction";
import * as fiction from "./fiction";
import * as proposers from "./propose";
import { runCountBench } from "./run";

let result: Awaited<ReturnType<typeof runCountBench>>;
beforeAll(async () => {
  result = await runCountBench(["label", "cluster"], FICTION_SEED);
}, 15_000);

it("withholds whole-poste exactness on the unread scan, including zero-count postes", () => {
  const label = result.methods.find(({ method }) => method === "label")!;
  expect(label.coverage.rasterAbstentions).toBe(1);
  const scan = label.quantitiesByDossier.find(({ dossier }) => dossier === "fiction-scan")!;
  expect(scan.quantities?.exact).toBeNull();
  expect(scan.quantities?.wholePostes).toEqual(expect.arrayContaining([
    expect.objectContaining({ poste: "pompe-service", expected: 0, proposed: 0, exact: null }),
    expect.objectContaining({ poste: "clapet-ef", expected: 0, proposed: 0, exact: null }),
    expect.objectContaining({ poste: "vanne-ef", expected: 2, proposed: 0, exact: null }),
  ]));
});

it("keeps both unattributed cluster false positives visible and withholds precision by family", () => {
  const cluster = result.methods.find(({ method }) => method === "cluster")!;
  expect(cluster.evaluatedSpatial?.drawing).toMatchObject({ tp: 23, fp: 2 });
  expect(cluster.byPoste.find(({ poste }) => poste === null)?.spatial?.drawing).toMatchObject({ tp: 0, fp: 2, fn: 0 });
  for (const family of cluster.byPoste.filter(({ poste }) => poste !== null)) {
    expect(family.spatial?.drawing.precision).toBeNull();
  }
});

it("includes a paired reader comparison on each page both selected readers completed", () => {
  expect(result.readerComparisons).toEqual(expect.arrayContaining([
    expect.objectContaining({
      leftMethod: "label", rightMethod: "cluster",
      frame: expect.objectContaining({ sheet: "fiction-1", page: 1 }),
      groups: expect.any(Array),
    }),
    expect.objectContaining({
      leftMethod: "label", rightMethod: "cluster",
      frame: expect.objectContaining({ sheet: "fiction-scan", page: 1 }),
      groups: null,
    }),
  ]));
});

it("withholds precision for a family that an optionally unmatched unknown mark could touch", async () => {
  const [fixture] = await fiction.fictionalSheets();
  const truth: typeof fixture.truth = [
    { ...fixture.truth[0], x: 2, y: 10, organ: "vanne", poste: "vanne-ef", dn: "DN 20" },
    { ...fixture.truth[0], x: 50, y: 10, organ: "pompe", poste: "pompe-service", dn: null },
  ];
  const read = proposers.readDeterministic;
  const fixtures = vi.spyOn(fiction, "fictionalSheets").mockResolvedValue([{
    ...fixture, truth, examples: [], negativeZones: {}, replay: [],
  }]);
  const reader = vi.spyOn(proposers, "readDeterministic").mockImplementation((sheet) => ({
    ...read(sheet),
    cluster: ([
      { x: 1, organ: null, dn: null },
      { x: 3, organ: "clapet-anti-retour", dn: "DN 20" },
      { x: 50, organ: "pompe", dn: null },
    ] as const).map((mark) => ({
      ...mark, y: 10, sheet: sheet.id, generation: sheet.generation, page: sheet.extraction.page,
      method: "test", evidence: [],
    })),
  }));
  try {
    const receipt = await runCountBench(["cluster"], FICTION_SEED);
    const byPoste = receipt.methods[0].byPoste;
    expect(byPoste.find((row) => row.poste === "vanne-ef")?.spatial?.drawing.precision).toBeNull();
    expect(byPoste.find((row) => row.poste === "pompe-service")?.spatial?.drawing.precision).toBe(1);
  } finally {
    reader.mockRestore();
    fixtures.mockRestore();
  }
});

it("rejects a replayed legend-boundary mark after CropBox and rotation roundoff", async () => {
  const fixture = (await fiction.fictionalSheets()).find(({ id }) => id === "fiction-4")!;
  expect(fixture.rotation).toBe(180);
  expect(fixture.negativeZones.legend.x1).toBe(111);
  const fixtures = vi.spyOn(fiction, "fictionalSheets").mockResolvedValue([{
    ...fixture, truncateTile: undefined, examples: [],
    truth: [{ ...fixture.truth[0], x: 114, y: 371, organ: "vanne", poste: "vanne-ef", dn: "DN 20" }],
    replay: [[111, 371, "vanne-ef", 20]],
  }]);
  try {
    const receipt = await runCountBench(["tile-replay"], FICTION_SEED);
    const result = receipt.pages[0].results[0];
    expect(result.pins[0].x).toBe(111.00000000000001);
    expect(result.score?.negativeZones.legend).toBe(1);
    expect(result.score?.spatial.dn).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  } finally {
    fixtures.mockRestore();
  }
}, 15_000);
