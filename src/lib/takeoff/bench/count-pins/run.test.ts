import { beforeAll, expect, it } from "vitest";
import { FICTION_SEED } from "./fiction";
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
